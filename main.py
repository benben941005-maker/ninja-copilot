import os
import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder=".", static_url_path="")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
WEATHER_API_KEY = os.environ.get("WEATHER_API_KEY", "")
AI_PROVIDER = os.environ.get("AI_PROVIDER", "claude").lower()


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(".", path)


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


# =========================================================
# REVERSE GEOCODE
# =========================================================
@app.route("/api/geocode")
def geocode():
    try:
        lat = request.args.get("lat")
        lng = request.args.get("lng")

        if not lat or not lng:
            return jsonify({"error": "Missing lat/lng"}), 400

        resp = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={
                "lat": lat,
                "lon": lng,
                "format": "json",
                "addressdetails": 1,
                "zoom": 18
            },
            headers={"User-Agent": "NinjaCoPilot/1.0"},
            timeout=10
        )
        data = resp.json()

        addr = data.get("address", {})
        parts = []

        block = addr.get("house_number", "")
        road = addr.get("road") or addr.get("pedestrian") or addr.get("footway") or ""
        suburb = addr.get("suburb") or addr.get("neighbourhood") or addr.get("quarter") or ""
        city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("county") or ""
        postcode = addr.get("postcode", "")

        if road:
            parts.append((block + " " + road).strip())
        if suburb:
            parts.append(suburb)
        if city:
            parts.append(city)
        if postcode:
            parts.append(postcode)

        address = ", ".join([p for p in parts if p.strip()]) or data.get("display_name", f"{lat},{lng}")

        return jsonify({
            "ok": True,
            "address": address,
            "raw": addr
        })

    except Exception as e:
        return jsonify({
            "ok": False,
            "address": None,
            "error": str(e)
        })


# =========================================================
# FORWARD GEOCODE
# =========================================================
@app.route("/api/address-to-latlng")
def address_to_latlng():
    try:
        address = request.args.get("address", "").strip()
        if not address:
            return jsonify({"error": "Missing address"}), 400

        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": address,
                "format": "json",
                "limit": 1
            },
            headers={"User-Agent": "NinjaCoPilot/1.0"},
            timeout=10
        )
        results = resp.json()

        if not results:
            return jsonify({
                "error": "Address not found",
                "lat": None,
                "lng": None
            })

        first = results[0]
        return jsonify({
            "lat": float(first["lat"]),
            "lng": float(first["lon"]),
            "display": first.get("display_name", address)
        })

    except Exception as e:
        return jsonify({
            "error": str(e),
            "lat": None,
            "lng": None
        })


# =========================================================
# ROUTE
# =========================================================
@app.route("/api/route")
def route():
    try:
        from_lat = request.args.get("from_lat")
        from_lng = request.args.get("from_lng")
        to_lat = request.args.get("to_lat")
        to_lng = request.args.get("to_lng")

        if not all([from_lat, from_lng, to_lat, to_lng]):
            return jsonify({"error": "Missing coordinates"}), 400

        url = (
            f"https://router.project-osrm.org/route/v1/driving/"
            f"{from_lng},{from_lat};{to_lng},{to_lat}"
            f"?overview=full&steps=true&annotations=false&geometries=geojson"
        )

        resp = requests.get(url, timeout=15)
        data = resp.json()

        if data.get("code") != "Ok" or not data.get("routes"):
            return jsonify({"error": "No route found", "steps": []})

        route_data = data["routes"][0]
        legs = route_data.get("legs", [])

        steps = []
        for leg in legs:
            for step in leg.get("steps", []):
                maneuver = step.get("maneuver", {})
                name = step.get("name", "")
                distance = step.get("distance", 0)
                duration = step.get("duration", 0)
                modifier = maneuver.get("modifier", "")
                m_type = maneuver.get("type", "")
                loc = maneuver.get("location", [None, None])

                text = build_instruction(m_type, modifier, name, distance)
                if text:
                    steps.append({
                        "text": text,
                        "distance": round(distance),
                        "duration": round(duration),
                        "type": m_type,
                        "modifier": modifier,
                        "lat": loc[1] if len(loc) > 1 else None,
                        "lng": loc[0] if len(loc) > 0 else None
                    })

        total_dist = round(route_data.get("distance", 0))
        total_time = round(route_data.get("duration", 0))
        geometry = route_data.get("geometry", {})

        return jsonify({
            "steps": steps,
            "total_distance": total_dist,
            "total_duration": total_time,
            "summary": f"{total_dist}m, ~{max(1, total_time // 60)} min",
            "geometry": geometry
        })

    except Exception as e:
        return jsonify({
            "error": str(e),
            "steps": []
        })


def build_instruction(m_type, modifier, name, distance):
    dist_str = f"{round(distance)}m" if distance < 1000 else f"{round(distance / 1000, 1)}km"
    road = f" onto {name}" if name else ""

    if m_type == "depart":
        return f"Start driving{road} for {dist_str}"
    elif m_type == "arrive":
        return f"You have arrived at your destination{road}"
    elif m_type == "turn":
        return f"Turn {modifier}{road}, continue for {dist_str}"
    elif m_type == "new name":
        return f"Continue{road} for {dist_str}"
    elif m_type == "merge":
        return f"Merge {modifier}{road} for {dist_str}"
    elif m_type == "fork":
        return f"Keep {modifier} at the fork{road} for {dist_str}"
    elif m_type in ("roundabout", "rotary"):
        return f"Enter roundabout, exit{road}, continue for {dist_str}"
    elif m_type == "end of road":
        return f"At end of road, turn {modifier}{road} for {dist_str}"
    elif m_type == "continue":
        return f"Continue straight{road} for {dist_str}"
    elif m_type in ("on ramp", "off ramp"):
        return f"Take the ramp {modifier}{road} for {dist_str}"
    elif m_type == "notification":
        return None
    else:
        if modifier:
            return f"Go {modifier}{road} for {dist_str}"
        elif name:
            return f"Continue on {name} for {dist_str}"
        return None


# =========================================================
# WEATHER
# =========================================================
@app.route("/api/weather")
def weather():
    try:
        lat = request.args.get("lat")
        lng = request.args.get("lng")

        if not lat or not lng:
            return jsonify({"error": "Missing lat/lng"}), 400

        if not WEATHER_API_KEY:
            return jsonify({
                "status": "weather_unavailable",
                "is_rain": False,
                "description": "Weather API key not configured"
            })

        resp = requests.get(
            "https://api.weatherapi.com/v1/current.json",
            params={
                "key": WEATHER_API_KEY,
                "q": f"{lat},{lng}"
            },
            timeout=10
        )
        data = resp.json()

        condition_text = str(
            data.get("current", {})
            .get("condition", {})
            .get("text", "")
        ).lower()

        rain_keywords = ["rain", "drizzle", "shower", "storm", "thunder"]
        is_rain = any(k in condition_text for k in rain_keywords)

        return jsonify({
            "status": "ok",
            "is_rain": is_rain,
            "description": condition_text or "unknown",
            "temp_c": data.get("current", {}).get("temp_c")
        })

    except Exception as e:
        return jsonify({
            "status": "weather_error",
            "is_rain": False,
            "description": str(e)
        })


# =========================================================
# CHAT
# =========================================================
@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        data = request.json or {}
        text = str(data.get("text", "")).strip()
        lat = data.get("lat")
        lng = data.get("lng")
        address = data.get("address", "")

        if not text:
            return jsonify({"reply": "Tell me where you need to go."})

        lower = text.lower()

        # simple route intent
        if any(k in lower for k in ["go to", "navigate", "route", "take me to", "find"]) and lat and lng:
            destination = text
            for prefix in ["go to", "navigate to", "take me to", "route to", "find"]:
                if lower.startswith(prefix):
                    destination = text[len(prefix):].strip()
                    break

            return jsonify({
                "reply": f"Got it. I’ll help you navigate to {destination}.",
                "dest_address": destination
            })

        if "where am i" in lower or "my location" in lower or "show location" in lower:
            if address:
                return jsonify({"reply": f"You are near {address}.", "show_my_location": True})
            return jsonify({"reply": "I can show your location once GPS is locked.", "show_my_location": True})

        if "rain" in lower and lat and lng:
            try:
                weather_resp = requests.get(
                    f"http://127.0.0.1:{os.environ.get('PORT', '8080')}/api/weather",
                    params={"lat": lat, "lng": lng},
                    timeout=3
                )
                w = weather_resp.json()
                return jsonify({"reply": f"Current weather: {w.get('description', 'unknown')}."})
            except Exception:
                return jsonify({"reply": "Weather check is not ready right now."})

        return jsonify({
            "reply": "I’m ready. Ask me for route, location, scan, or live navigation."
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
