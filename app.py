from flask import Flask, render_template, request, jsonify
import pandas as pd
import json
from io import BytesIO

app = Flask(__name__)

CAPACITY_DEFAULT = 100

PRICE_TIERS = [
    {"label": "No hay data", "min": None, "max": None, "price": None},
    {"label": "Baja",        "min": 0,    "max": 10,   "price": 1000},
    {"label": "Medio bajo",  "min": 10,   "max": 25,   "price": 2500},
    {"label": "Media",       "min": 25,   "max": 45,   "price": 3500},
    {"label": "Media alta",  "min": 45,   "max": 70,   "price": 5000},
    {"label": "Alta",        "min": 70,   "max": 100,  "price": 6000},
    {"label": "Máxima",      "min": 100,  "max": 100,  "price": None},
]

def get_tier(pct):
    if pct is None:
        return PRICE_TIERS[0]
    if pct >= 100:
        return PRICE_TIERS[6]
    if pct > 70:
        return PRICE_TIERS[5]
    if pct > 45:
        return PRICE_TIERS[4]
    if pct > 25:
        return PRICE_TIERS[3]
    if pct > 10:
        return PRICE_TIERS[2]
    return PRICE_TIERS[1]

def process_excel(file_bytes, capacity):
    df = pd.read_excel(BytesIO(file_bytes))
    df.columns = df.columns.str.strip()

    # Find datetime and action columns (flexible naming)
    date_col = next((c for c in df.columns if 'hora' in c.lower() or 'acceso' in c.lower()), None)
    action_col = next((c for c in df.columns if 'acci' in c.lower()), None)

    if not date_col or not action_col:
        return None, "No se encontraron columnas de fecha/hora o acción en el archivo."

    df['_dt'] = pd.to_datetime(df[date_col], dayfirst=True, errors='coerce')
    df = df.dropna(subset=['_dt'])
    df = df.sort_values('_dt')

    # Normalize action: check-in vs check-out
    df['_checkin'] = df[action_col].str.lower().apply(
        lambda x: 1 if any(w in x for w in ['liberado', 'entrada', 'acesso', 'access']) else -1
    )

    df['_running'] = df['_checkin'].cumsum().clip(lower=0)

    # Build hourly snapshots: occupancy AT start of each hour = running count at that moment
    min_hour = df['_dt'].dt.hour.min()
    max_hour = df['_dt'].dt.hour.max()
    date_str = df['_dt'].dt.date.iloc[0].strftime('%d/%m/%Y')

    hourly = []
    for h in range(min_hour, max_hour + 2):
        # Running count just before this hour begins
        before = df[df['_dt'].dt.hour < h]
        count = int(before['_checkin'].sum()) if len(before) > 0 else 0
        count = max(0, count)
        pct = round((count / capacity) * 100, 1)
        tier = get_tier(pct)

        # Events in this hour
        in_hour = df[df['_dt'].dt.hour == h]
        checkins = int((in_hour['_checkin'] == 1).sum())
        checkouts = int((in_hour['_checkin'] == -1).sum())

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

    return {
        "date": date_str,
        "day_of_week": int(day_of_week),
        "capacity": capacity,
        "total_events": len(df),
        "sede": df["Sede de origen"].iloc[0] if "Sede de origen" in df.columns else "Sede",
        "hourly": hourly,
    }, None


@app.route("/")
def index():
    return render_template("index.html")


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


if __name__ == "__main__":
    app.run(debug=True, port=5050)
