import os
import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder=".", static_url_path="")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
WEATHER_API_KEY = os.environ.get("WEATHER_API_KEY", "")

@app.route("/")
def index():
    return send_from_directory(".", "index.html")

# =============================
# WEATHER CHECK API
# =============================
@app.route("/api/weather")
def weather():
    try:
        lat = request.args.get("lat")
        lng = request.args.get("lng")

        if not lat or not lng:
            return jsonify({"error": "missing lat/lng"}), 400

        if not WEATHER_API_KEY:
            return jsonify({
                "status": "weather_unavailable",
                "is_rain": False
            })

        url = "https://api.weatherapi.com/v1/current.json"

        r = requests.get(
            url,
            params={
                "key": WEATHER_API_KEY,
                "q": f"{lat},{lng}"
            },
            timeout=10
        )

        data = r.json()

        condition = str(data.get("current", {}).get("condition", {}).get("text", "")).lower()

        rain_keywords = [
            "rain",
            "drizzle",
            "shower",
            "storm",
            "thunder"
        ]

        is_rain = any(k in condition for k in rain_keywords)

        return jsonify({
            "status": "ok",
            "is_rain": is_rain,
            "condition": condition,
            "temp_c": data.get("current", {}).get("temp_c")
        })

    except Exception as e:
        return jsonify({
            "status": "error",
            "error": str(e),
            "is_rain": False
        })


# =============================
# ROUTE API (OSRM)
# =============================
@app.route("/api/route")
def route():
    try:
        start_lat = request.args.get("start_lat")
        start_lng = request.args.get("start_lng")
        end_lat = request.args.get("end_lat")
        end_lng = request.args.get("end_lng")

        url = f"http://router.project-osrm.org/route/v1/driving/{start_lng},{start_lat};{end_lng},{end_lat}?overview=false&steps=true"

        r = requests.get(url).json()

        steps = []

        for leg in r["routes"][0]["legs"]:
            for s in leg["steps"]:
                steps.append({
                    "text": s["maneuver"]["type"] + " " + s["maneuver"].get("modifier", ""),
                    "lat": s["maneuver"]["location"][1],
                    "lng": s["maneuver"]["location"][0]
                })

        return jsonify({
            "status": "ok",
            "steps": steps
        })

    except Exception as e:
        return jsonify({
            "status": "error",
            "error": str(e)
        })


# =============================
# AI CHAT API
# =============================
@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.json
    user_msg = data.get("message", "")

    if not ANTHROPIC_API_KEY:
        return jsonify({"reply": "AI key missing."})

    try:

        url = "https://api.anthropic.com/v1/messages"

        payload = {
            "model": "claude-3-haiku-20240307",
            "max_tokens": 200,
            "messages": [
                {"role": "user", "content": user_msg}
            ]
        }

        headers = {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        }

        r = requests.post(url, json=payload, headers=headers)

        resp = r.json()

        reply = resp["content"][0]["text"]

        return jsonify({"reply": reply})

    except Exception as e:
        return jsonify({"reply": str(e)})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
