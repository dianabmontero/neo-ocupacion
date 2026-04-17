from flask import Flask, render_template, request, jsonify
import pandas as pd
import json
from io import BytesIO

app = Flask(__name__)

CAPACITY_DEFAULT = 85

PRICE_TIERS = [
    {"label": "No hay data", "min": None, "max": None,  "price": None, "rank": -1},
    {"label": "Baja",        "min": 0,    "max": 30,    "price": 1000, "rank": 0},
    {"label": "Media baja",  "min": 30,   "max": 45,    "price": 2000, "rank": 1},
    {"label": "Media",       "min": 45,   "max": 60,    "price": 3000, "rank": 2},
    {"label": "Media alta",  "min": 60,   "max": 90,    "price": 4000, "rank": 3},
    {"label": "Alta",        "min": 90,   "max": 100,   "price": 5000, "rank": 4},
]

def get_tier(pct):
    if pct is None:
        return PRICE_TIERS[0]
    if pct > 90:
        return PRICE_TIERS[5]
    if pct > 60:
        return PRICE_TIERS[4]
    if pct > 45:
        return PRICE_TIERS[3]
    if pct > 30:
        return PRICE_TIERS[2]
    return PRICE_TIERS[1]

def process_excel(file_bytes, capacity):
    df = pd.read_excel(BytesIO(file_bytes))
    df.columns = df.columns.str.strip()

    # Find datetime and action columns (flexible naming)
    date_col = next((c for c in df.columns if 'hora' in c.lower() or 'acceso' in c.lower()), None)
    action_col = next((c for c in df.columns if 'acci' in c.lower() or 'ação' in c.lower() or 'acao' in c.lower()), None)

    if not date_col or not action_col:
        return None, "No se encontraron columnas de fecha/hora o acción en el archivo."

    # Filter Interlaken only (when molinete/torniquete column exists)
    molinete_col = next((c for c in df.columns if 'molinete' in c.lower() or 'torniquete' in c.lower()), None)
    if molinete_col:
        df = df[df[molinete_col].astype(str).str.contains('Interlaken', case=False, na=False)].copy()

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

    # Build hourly snapshots in Chile time
    min_hour = df['_dt'].dt.hour.min()
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


if __name__ == "__main__":
    app.run(debug=True, port=5050)
