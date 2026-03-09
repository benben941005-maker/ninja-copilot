import os
import time
import math
import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="/static")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
WEATHER_API_KEY = os.environ.get("WEATHER_API_KEY", "")
ONEMAP_EMAIL = os.environ.get("ONEMAP_EMAIL", "")
ONEMAP_PASSWORD = os.environ.get("ONEMAP_PASSWORD", "")

_onemap_token = None
_onemap_token_expiry = 0


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/static/<path:path>")
def serve_static(path):
    return send_from_directory("static", path)


# =========================================================
# ONEMAP TOKEN
# =========================================================
def get_onemap_token():
    global _onemap_token, _onemap_token_expiry

    now = time.time()
    if _onemap_token and now < _onemap_token_expiry:
        return _onemap_token

    if not ONEMAP_EMAIL or not ONEMAP_PASSWORD:
        raise Exception("ONEMAP_EMAIL or ONEMAP_PASSWORD is missing")

    resp = requests.post(
        "https://www.onemap.gov.sg/api/auth/post/getToken",
        json={
            "email": ONEMAP_EMAIL,
            "password": ONEMAP_PASSWORD
        },
        timeout=15
    )
    data = resp.json()

    token = data.get("access_token")
    if not token:
        raise Exception(f"Failed to get OneMap token: {data}")

    _onemap_token = token
    _onemap_token_expiry = now + (60 * 60 * 24 * 2.8)
    return _onemap_token


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

        token = get_onemap_token()

        resp = requests.get(
            "https://www.onemap.gov.sg/api/common/elastic/reversegeocode",
            params={
                "location": f"{lat},{lng}",
                "buffer": 20,
                "addressType": "All"
            },
            headers={"Authorization": token},
            timeout=12
        )
        data = resp.json()
        results = data.get("GeocodeInfo", [])

        if not results:
            return jsonify({
                "address": None,
                "raw": {},
                "fallback": f"{lat},{lng}"
            })

        r = results[0]
        block = r.get("BLOCK", "")
        road = r.get("ROAD", "")
        building = r.get("BUILDINGNAME", "")
        postal = r.get("POSTALCODE", "")

        parts = []
        if building and building != "NIL":
            parts.append(building)

        street_line = " ".join(x for x in [block, road] if x and x != "NIL").strip()
        if street_line:
            parts.append(street_line)

        if postal and postal != "NIL":
            parts.append(f"Singapore {postal}")
        else:
            parts.append("Singapore")

        return jsonify({"address": ", ".join(parts), "raw": r})

    except Exception as e:
        return jsonify({"address": None, "error": str(e)})


# =========================================================
# FORWARD GEOCODE / ADDRESS LOOKUP
# =========================================================
@app.route("/api/address-to-latlng")
def address_to_latlng():
    try:
        address = request.args.get("address", "")
        if not address:
            return jsonify({"error": "Missing address"}), 400

        token = get_onemap_token()
        resp = requests.get(
            "https://www.onemap.gov.sg/api/common/elastic/search",
            params={
                "searchVal": address,
                "returnGeom": "Y",
                "getAddrDetails": "Y",
                "pageNum": 1
            },
            headers={"Authorization": token},
            timeout=12
        )
        data = resp.json()
        results = data.get("results", [])

        if not results:
            return jsonify({"error": "Address not found", "lat": None, "lng": None})

        r = results[0]
        display_parts = []
        building = r.get("BUILDING")
        address_line = r.get("ADDRESS")
        postal = r.get("POSTAL")

        if building and building != "NIL":
            display_parts.append(building)
        if address_line and address_line != "NIL":
            display_parts.append(address_line)
        if postal and postal != "NIL":
            display_parts.append(f"Singapore {postal}")

        return jsonify({
            "lat": float(r["LATITUDE"]),
            "lng": float(r["LONGITUDE"]),
            "display": ", ".join(display_parts) if display_parts else address
        })

    except Exception as e:
        return jsonify({"error": str(e), "lat": None, "lng": None})


# =========================================================
# ONEMAP SEARCH (POI / nearest place search)
# =========================================================
def _search_onemap_once(query: str):
    token = get_onemap_token()
    resp = requests.get(
        "https://www.onemap.gov.sg/api/common/elastic/search",
        params={
            "searchVal": query,
            "returnGeom": "Y",
            "getAddrDetails": "Y",
            "pageNum": 1
        },
        headers={"Authorization": token},
        timeout=12
    )
    data = resp.json()
    return data.get("results", [])


@app.route("/api/onemap-search")
def onemap_search():
    try:
        query = request.args.get("q", "").strip()
        lat = request.args.get("lat")
        lng = request.args.get("lng")
        limit = int(request.args.get("limit", 3))

        if not query:
            return jsonify({"error": "Missing q", "results": []}), 400

        trial_queries = [query]
        ql = query.lower()
        if "singapore" not in ql:
            trial_queries.append(f"{query} Singapore")
        if "haidilao" in ql and "restaurant" not in ql:
            trial_queries.extend(["Haidilao Hot Pot", "Haidilao restaurant Singapore"])
        elif "shell" in ql:
            trial_queries.extend(["Shell station Singapore", "Shell petrol station"])
        elif "toilet" in ql:
            trial_queries.extend(["public toilet Singapore", "toilet"])
        elif "petrol" in ql:
            trial_queries.extend(["petrol station Singapore", "Shell petrol station"])
        elif "restaurant" not in ql:
            trial_queries.append(f"{query} restaurant")

        raw_results = []
        for tq in trial_queries:
            raw_results = _search_onemap_once(tq)
            if raw_results:
                break

        results = []
        for r in raw_results:
            try:
                rlat = float(r["LATITUDE"])
                rlng = float(r["LONGITUDE"])
            except Exception:
                continue

            building = r.get("BUILDING", "")
            address = r.get("ADDRESS", "")
            postal = r.get("POSTAL", "")

            distance_m = None
            if lat and lng:
                try:
                    lat1 = float(lat)
                    lng1 = float(lng)
                    R = 6371000
                    dlat = math.radians(rlat - lat1)
                    dlng = math.radians(rlng - lng1)
                    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(rlat)) * math.sin(dlng / 2) ** 2
                    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
                    distance_m = int(R * c)
                except Exception:
                    distance_m = None

            results.append({
                "building": building,
                "address": address,
                "postal": postal,
                "lat": rlat,
                "lng": rlng,
                "distance_m": distance_m
            })

        if lat and lng:
            results.sort(key=lambda x: x["distance_m"] if x["distance_m"] is not None else 999999999)

        return jsonify({"results": results[:limit]})

    except Exception as e:
        return jsonify({"error": str(e), "results": []}), 500


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

        token = get_onemap_token()
        resp = requests.get(
            "https://www.onemap.gov.sg/api/public/routingsvc/route",
            params={
                "start": f"{from_lat},{from_lng}",
                "end": f"{to_lat},{to_lng}",
                "routeType": "drive"
            },
            headers={"Authorization": token},
            timeout=20
        )
        data = resp.json()

        if data.get("status") == "error":
            return jsonify({"error": data.get("message", "No route found"), "steps": []})

        route_summary = data.get("route_summary", {})
        instructions = data.get("route_instructions", [])
        route_geometry = data.get("route_geometry", "")

        steps = []
        for item in instructions:
            text = item[0] if len(item) > 0 else ""
            distance = item[2] if len(item) > 2 and isinstance(item[2], (int, float)) else 0
            duration = item[3] if len(item) > 3 and isinstance(item[3], (int, float)) else 0

            ilat = None
            ilng = None
            if len(item) > 5:
                try:
                    ilat = float(item[4])
                    ilng = float(item[5])
                except Exception:
                    ilat = None
                    ilng = None

            if text:
                steps.append({
                    "text": text,
                    "distance": round(distance),
                    "duration": round(duration),
                    "type": "instruction",
                    "modifier": "",
                    "lat": ilat,
                    "lng": ilng
                })

        total_dist = round(route_summary.get("total_distance", 0))
        total_time = round(route_summary.get("total_time", 0))

        return jsonify({
            "steps": steps,
            "total_distance": total_dist,
            "total_duration": total_time,
            "summary": f"{total_dist}m, ~{max(1, round(total_time / 60))} min",
            "geometry": route_geometry
        })

    except Exception as e:
        return jsonify({"error": str(e), "steps": []})


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
            params={"key": WEATHER_API_KEY, "q": f"{lat},{lng}"},
            timeout=10
        )
        data = resp.json()

        condition_text = str(data.get("current", {}).get("condition", {}).get("text", "")).lower()
        rain_keywords = ["rain", "drizzle", "shower", "storm", "thunder"]
        is_rain = any(k in condition_text for k in rain_keywords)

        return jsonify({
            "status": "ok",
            "is_rain": is_rain,
            "description": condition_text or "unknown",
            "temp_c": data.get("current", {}).get("temp_c"),
            "raw": data
        })

    except Exception as e:
        return jsonify({"status": "weather_error", "is_rain": False, "description": str(e)})


# =========================================================
# CHAT
# =========================================================
@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        data = request.json or {}
        system = data.get("system", "")
        messages = data.get("messages", [])
        reply = call_claude(system, messages)
        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# =========================================================
# OCR / VISION SCAN
# =========================================================
@app.route("/api/scan", methods=["POST"])
def scan():
    try:
        data = request.json or {}
        system = data.get("system", "")
        image_base64 = data.get("image_base64", "")
        ocr_prompt = data.get("ocr_prompt", "Extract address from this label.")
        reply = call_claude_vision(system, image_base64, ocr_prompt)
        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# =========================================================
# TRANSCRIBE
# =========================================================
@app.route("/api/transcribe", methods=["POST"])
def transcribe():
    return jsonify({"error": "OPENAI_API_KEY not configured. Use browser speech recognition fallback.", "text": ""})


# =========================================================
# LLM CALLS
# =========================================================
def call_claude(system, messages):
    if not ANTHROPIC_API_KEY:
        raise Exception("ANTHROPIC_API_KEY is missing")

    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01"
        },
        json={
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 300,
            "system": system,
            "messages": messages
        },
        timeout=30
    )
    data = resp.json()

    if "error" in data:
        raise Exception(data["error"].get("message", str(data["error"])))

    return "".join(block.get("text", "") for block in data.get("content", []))


def call_claude_vision(system, image_base64, prompt):
    if not ANTHROPIC_API_KEY:
        raise Exception("ANTHROPIC_API_KEY is missing")

    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01"
        },
        json={
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 300,
            "system": system,
            "messages": [{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": image_base64
                        }
                    },
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }]
        },
        timeout=30
    )
    data = resp.json()

    if "error" in data:
        raise Exception(data["error"].get("message", str(data["error"])))

    return "".join(block.get("text", "") for block in data.get("content", []))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
