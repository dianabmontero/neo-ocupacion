from flask import Flask, render_template, request, jsonify
import pandas as pd
import json
import os
from io import BytesIO

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import evo_client

app = Flask(__name__)

CAPACITY_DEFAULT = 85

# Configuración por sede. El DNS (EVO_USERNAME) es el mismo para todas (`neocl`);
# lo que cambia es el token (password) que apunta a cada idBranch.
# En Vercel: configurar EVO_USERNAME, EVO_PASSWORD (Plaza Vespucio) y
# EVO_PASSWORD_INDEPENDENCIA por separado.
SEDES_CONFIG = {
    "plaza_vespucio": {
        "name": "NEO Plaza Vespucio",
        "branch_id": 1,
        "capacity": 85,
        "password_env": "EVO_PASSWORD",  # default
    },
    "independencia": {
        "name": "NEO Independencia",
        "branch_id": 2,
        "capacity": 100,
        "password_env": "EVO_PASSWORD_INDEPENDENCIA",
    },
}

# Matriz v5 (May 2026) — umbrales más exigentes y precios +$300 en Media/MA/Alta.
PRICE_TIERS = [
    {"label": "No hay data", "min": None, "max": None,  "price": None, "rank": -1},
    {"label": "Baja",        "min": 0,    "max": 21,    "price": 1000, "rank": 0},
    {"label": "Medio bajo",  "min": 21,   "max": 35,    "price": 2000, "rank": 1},
    {"label": "Media",       "min": 35,   "max": 58,    "price": 3300, "rank": 2},
    {"label": "Media alta",  "min": 58,   "max": 94,    "price": 4300, "rank": 3},
    {"label": "Alta",        "min": 94,   "max": 100,   "price": 5300, "rank": 4},
]

def get_tier(pct):
    if pct is None:
        return PRICE_TIERS[0]
    if pct > 94:
        return PRICE_TIERS[5]
    if pct > 58:
        return PRICE_TIERS[4]
    if pct > 35:
        return PRICE_TIERS[3]
    if pct > 21:
        return PRICE_TIERS[2]
    return PRICE_TIERS[1]

def process_excel(file_bytes, capacity, sede_filter="Interlaken", display_start_hour=None):
    df = pd.read_excel(BytesIO(file_bytes))
    df.columns = df.columns.str.strip()

    # Find datetime and action columns (flexible naming)
    date_col = next((c for c in df.columns if 'hora' in c.lower() or 'acceso' in c.lower()), None)
    action_col = next((c for c in df.columns if 'acci' in c.lower() or 'ação' in c.lower() or 'acao' in c.lower()), None)

    if not date_col or not action_col:
        return None, "No se encontraron columnas de fecha/hora o acción en el archivo."

    # Filter by sede (solo para el upload manual que trae multi-sede).
    # Si sede_filter=None, no filtra — útil cuando la fuente ya filtra
    # por DNS/token (p.ej. /fetch-evo).
    molinete_col = next((c for c in df.columns if 'molinete' in c.lower() or 'torniquete' in c.lower()), None)
    if molinete_col and sede_filter:
        df = df[df[molinete_col].astype(str).str.contains(sede_filter, case=False, na=False)].copy()

    # EVO devuelve ISO 8601 (2026-04-20T12:05:38), Excel manual viene dd/mm/yyyy.
    # Intentamos ISO primero; si falla, caemos a dayfirst para el Excel manual.
    iso_parsed = pd.to_datetime(df[date_col], format='ISO8601', errors='coerce')
    if iso_parsed.notna().all():
        df['_dt'] = iso_parsed
    else:
        df['_dt'] = pd.to_datetime(df[date_col], dayfirst=True, errors='coerce')
    df = df.dropna(subset=['_dt'])
    df = df.sort_values('_dt')

    # Normalize action: +1 check-in, -1 check-out, 0 ignorar (bloqueado, denegado, etc.)
    CHECKIN_WORDS  = ['liberado', 'entrada', 'acesso', 'access']
    CHECKOUT_WORDS = ['saída', 'saida', 'salida', 'exit', 'egreso']
    IGNORE_WORDS   = ['bloqueado', 'bloqueada', 'denegado', 'denied', 'negado']

    def classify_action(x):
        x = str(x).lower()
        if any(w in x for w in IGNORE_WORDS):
            return 0
        if any(w in x for w in CHECKIN_WORDS):
            return 1
        if any(w in x for w in CHECKOUT_WORDS):
            return -1
        return 0   # desconocido → ignorar

    df['_checkin'] = df[action_col].apply(classify_action)
    ignored = int((df['_checkin'] == 0).sum())  # bloqueados/denegados

    # Filtrar solo eventos que cuentan (ignorar 0)
    df = df[df['_checkin'] != 0].copy()

    # Deduplicate per person: ignore repeated check-ins if already inside,
    # and repeated check-outs if already outside (handles turnstile bugs)
    name_col = next((c for c in df.columns if 'nombre' in c.lower()), None)
    if name_col:
        name_state = {}  # True = inside
        keep = []
        for _, row in df.iterrows():
            name = str(row[name_col])
            c = row['_checkin']
            inside = name_state.get(name, False)
            if c == 1 and not inside:
                name_state[name] = True
                keep.append(True)
            elif c == -1 and inside:
                name_state[name] = False
                keep.append(True)
            else:
                keep.append(False)
        ignored += df[~pd.Series(keep, index=df.index)].shape[0]
        df = df[pd.Series(keep, index=df.index)].copy()

    df['_running'] = df['_checkin'].cumsum().clip(lower=0)

    # Build hourly snapshots in Chile time.
    # Si display_start_hour se pasa, fuerza el inicio ahí aunque no haya eventos.
    data_min_hour = df['_dt'].dt.hour.min()
    min_hour = display_start_hour if display_start_hour is not None else int(data_min_hour)
    max_hour = df['_dt'].dt.hour.max()
    date_str = df['_dt'].dt.date.iloc[0].strftime('%d/%m/%Y')

    hourly = []
    for h in range(min_hour, max_hour + 2):
        in_hour = df[df['_dt'].dt.hour == h]
        checkins  = int((in_hour['_checkin'] == 1).sum())
        checkouts = int((in_hour['_checkin'] == -1).sum())

        if h == max_hour:
            # Last hour with events: count everyone still inside at end of that hour
            count = int(df[df['_dt'].dt.hour <= h]['_checkin'].sum())
        else:
            # All other hours (including next empty hour): snapshot at start of hour
            before = df[df['_dt'].dt.hour < h]
            count = int(before['_checkin'].sum()) if len(before) > 0 else 0
        count = max(0, count)
        pct = round((count / capacity) * 100, 1)
        tier = get_tier(pct)

        hourly.append({
            "hour": f"{h:02d}:00",
            "count": count,
            "pct": pct,
            "tier_label": tier["label"],
            "price": tier["price"],
            "checkins_in_hour": checkins,
            "checkouts_in_hour": checkouts,
        })

    day_of_week = df['_dt'].dt.dayofweek.iloc[0]  # 0=Mon … 6=Sun
    last_event = df['_dt'].max()
    current_minute = int(last_event.minute)

    return {
        "date": date_str,
        "day_of_week": int(day_of_week),
        "capacity": capacity,
        "total_events": len(df),
        "ignored_events": ignored,
        "current_minute": current_minute,
        "current_hour": int(last_event.hour),
        "sede": (df["Sede de origen"].dropna().iloc[0]
                 if "Sede de origen" in df.columns and not df["Sede de origen"].dropna().empty
                 else "NEO"),
        "hourly": hourly,
    }, None


def process_checkins(file_bytes):
    df = pd.read_excel(BytesIO(file_bytes))
    df.columns = df.columns.str.strip()

    name_col   = next((c for c in df.columns if 'nombre' in c.lower() or 'nome' in c.lower()), None)
    action_col = next((c for c in df.columns if 'acci' in c.lower() or 'ação' in c.lower() or 'acao' in c.lower()), None)
    date_col   = next((c for c in df.columns if 'hora' in c.lower() or 'acceso' in c.lower() or 'acesso' in c.lower()), None)

    if not name_col or not action_col or not date_col:
        return None, "No se encontraron columnas necesarias en el archivo."

    CHECKIN_WORDS = ['liberado', 'entrada', 'acesso', 'access']
    df = df[df[action_col].astype(str).str.lower().apply(lambda x: any(w in x for w in CHECKIN_WORDS))].copy()

    df['_dt'] = pd.to_datetime(df[date_col], dayfirst=True, errors='coerce')
    df = df.dropna(subset=['_dt'])

    # Date range
    date_from = df['_dt'].dt.date.min().strftime('%d/%m/%Y')
    date_to   = df['_dt'].dt.date.max().strftime('%d/%m/%Y')
    total_days = df['_dt'].dt.date.nunique()

    # Count check-ins per person
    counts = (
        df.groupby(name_col)
          .agg(total=('_dt', 'count'), last_visit=('_dt', 'max'))
          .reset_index()
          .rename(columns={name_col: 'nombre'})
          .sort_values('total', ascending=False)
    )
    counts['last_visit'] = counts['last_visit'].dt.strftime('%d/%m/%Y %H:%M')

    users = counts.to_dict(orient='records')
    return {
        "users": users,
        "date_from": date_from,
        "date_to": date_to,
        "total_days": total_days,
        "total_users": len(users),
        "goal": 12,
    }, None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/checkins")
def checkins():
    return render_template("checkins.html")


@app.route("/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"error": "No se recibió archivo"}), 400
    f = request.files["file"]
    capacity = int(request.form.get("capacity", CAPACITY_DEFAULT))
    if capacity <= 0:
        return jsonify({"error": "La capacidad debe ser mayor a 0"}), 400

    data, err = process_excel(f.read(), capacity)
    if err:
        return jsonify({"error": err}), 400
    return jsonify(data)


@app.route("/upload-checkins", methods=["POST"])
def upload_checkins():
    if "file" not in request.files:
        return jsonify({"error": "No se recibió archivo"}), 400
    f = request.files["file"]
    data, err = process_checkins(f.read())
    if err:
        return jsonify({"error": err}), 400
    return jsonify(data)


@app.route("/fetch-evo", methods=["POST"])
def fetch_evo():
    """
    Trae data en vivo desde EVO y la procesa con la misma lógica que /upload.
    Body JSON: {
      "start_hour": 6,
      "sede_key": "plaza_vespucio" | "independencia"   # default plaza_vespucio
    }
    La capacidad y el branch_id se infieren de SEDES_CONFIG; el token EVO
    se lee del env var correspondiente a esa sede.
    """
    body = request.get_json(silent=True) or {}
    start_hour = int(body.get("start_hour", 6))
    sede_key = body.get("sede_key", "plaza_vespucio")

    if sede_key not in SEDES_CONFIG:
        return jsonify({"error": f"sede_key inválida: {sede_key}"}), 400
    if start_hour < 0 or start_hour > 23:
        return jsonify({"error": "start_hour debe estar entre 0 y 23"}), 400

    cfg = SEDES_CONFIG[sede_key]
    capacity = cfg["capacity"]
    branch_id = cfg["branch_id"]
    sede_name = cfg["name"]
    username = os.environ.get("EVO_USERNAME")
    password = os.environ.get(cfg["password_env"])
    if not password:
        return jsonify({
            "error": f"Falta env var {cfg['password_env']} para la sede {sede_name}"
        }), 500

    try:
        xlsx_bytes = evo_client.fetch_and_build_excel_bytes_from_today(
            start_hour=start_hour,
            sede_name=sede_name,
            branch_id=branch_id,
            username=username,
            password=password,
        )
        occupation = evo_client.fetch_occupation(username=username, password=password)
    except evo_client.EvoAuthError as e:
        return jsonify({"error": f"Credenciales EVO inválidas: {e}"}), 401
    except evo_client.EvoApiError as e:
        return jsonify({"error": f"EVO no respondió: {e}"}), 502

    data, err = process_excel(
        xlsx_bytes, capacity,
        sede_filter=None,
        display_start_hour=start_hour,
    )
    if err:
        return jsonify({"error": err}), 400
    data["source"] = "evo-live"
    data["sede_key"] = sede_key
    data["sede_name"] = sede_name

    # Override del contador actual con la fuente de verdad de EVO.
    if occupation:
        branch_occ = next(
            (o for o in occupation if o.get("idBranch") == branch_id),
            occupation[0],
        )
        data["live_occupation"] = branch_occ.get("occupation")
        data["live_max_occupation"] = branch_occ.get("maxOccupation")

    return jsonify(data)


@app.route("/evo-health")
def evo_health():
    """Prueba rápida para verificar que las credenciales EVO están configuradas."""
    try:
        branches = evo_client.fetch_branches()
        return jsonify({
            "ok": True,
            "branches_count": len(branches),
            "sample": [{"idBranch": b.get("idBranch"), "name": b.get("name")}
                       for b in branches[:3]],
        })
    except evo_client.EvoAuthError as e:
        return jsonify({"ok": False, "error": str(e), "kind": "auth"}), 401
    except evo_client.EvoApiError as e:
        return jsonify({"ok": False, "error": str(e), "kind": "api"}), 502


if __name__ == "__main__":
    app.run(debug=True, port=5050)
