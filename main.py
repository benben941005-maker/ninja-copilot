import os
import re
import time
import math
import base64
import tempfile
import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="/static")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
GOOGLE_PLACES_API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "")
WEATHER_API_KEY = os.environ.get("WEATHER_API_KEY", "")
AI_PROVIDER = os.environ.get("AI_PROVIDER", "claude").lower()

ONEMAP_EMAIL = os.environ.get("ONEMAP_EMAIL", "")
ONEMAP_PASSWORD = os.environ.get("ONEMAP_PASSWORD", "")

_onemap_token = None
_onemap_token_expiry = 0


# =========================================================
# STATIC
# =========================================================
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


# =========================================================
# HELPERS
# =========================================================
def safe_json(resp):
    try:
        return resp.json()
    except Exception:
        return {}


def haversine_m(lat1, lng1, lat2, lng2):
    r = 6371000
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def clean_sg_address(text: str) -> str:
    if not text:
        return text
    text = re.sub(r"\bSingapore\s+(\d{6})\b", r"\1", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def nil_clean(val: str) -> str:
    """Return empty string if value is NIL or empty."""
    v = (val or "").strip()
    return "" if v.upper() == "NIL" else v


def parse_onemap_polyline(polyline_str):
    return polyline_str or ""


# =========================================================
# ONEMAP TOKEN
# =========================================================
def get_onemap_token():
    global _onemap_token, _onemap_token_expiry

    if _onemap_token and time.time() < _onemap_token_expiry:
        return _onemap_token

    if not ONEMAP_EMAIL or not ONEMAP_PASSWORD:
        return None

    try:
        resp = requests.post(
            "https://www.onemap.gov.sg/api/auth/post/getToken",
            json={
                "email": ONEMAP_EMAIL,
                "password": ONEMAP_PASSWORD
            },
            timeout=10,
        )
        data = safe_json(resp)
        token = data.get("access_token")

        if not token:
            return None

        _onemap_token = token
        _onemap_token_expiry = time.time() + 3500
        return _onemap_token

    except Exception:
        return None


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

        # 1) OneMap first
        if token:
            try:
                resp = requests.get(
                    "https://www.onemap.gov.sg/api/public/revgeocode",
                    params={
                        "location": f"{lat},{lng}",
                        "buffer": 40,
                        "addressType": "All",
                        "otherFeatures": "N",
                    },
                    headers={"Authorization": token},
                    timeout=8,
                )
                data = safe_json(resp)
                results = data.get("GeocodeInfo", [])

                if results:
                    best = results[0]
                    # FIX: filter out "NIL" values from OneMap
                    block    = nil_clean(best.get("BLOCK", ""))
                    road     = nil_clean(best.get("ROAD", ""))
                    building = nil_clean(best.get("BUILDINGNAME", ""))
                    postal   = nil_clean(best.get("POSTALCODE", ""))

                    parts = []
                    first = f"{block} {road}".strip() if road else block
                    if first:
                        parts.append(first)
                    if building:
                        parts.append(building)
                    if postal:
                        parts.append(postal)

                    address = ", ".join([p for p in parts if p]).strip()
                    if address:
                        return jsonify({
                            "address": clean_sg_address(address),
                            "postal": postal if postal else None,
                            "source": "onemap",
                            "raw": best
                        })
            except Exception:
                pass

        # 2) OSM fallback
        resp = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={
                "lat": lat,
                "lon": lng,
                "format": "json",
                "addressdetails": 1,
                "zoom": 18,
            },
            headers={"User-Agent": "NinjaCoPilot/3.0"},
            timeout=8,
        )
        data = safe_json(resp)
        addr = data.get("address", {})

        parts = []
        road = addr.get("road") or addr.get("pedestrian") or addr.get("footway") or ""
        house = addr.get("house_number") or ""
        suburb = addr.get("suburb") or addr.get("neighbourhood") or addr.get("quarter") or ""
        postcode = addr.get("postcode") or ""

        if road:
            parts.append((house + " " + road).strip())
        if suburb:
            parts.append(suburb)
        if postcode:
            parts.append(postcode)

        address = ", ".join([p for p in parts if p]) or data.get("display_name") or f"{lat},{lng}"

        return jsonify({
            "address": clean_sg_address(address),
            "source": "nominatim",
            "raw": addr
        })

    except Exception as e:
        return jsonify({"error": str(e), "address": None})


# =========================================================
# GOOGLE PLACE SEARCH
# =========================================================
@app.route("/api/place-search")
def place_search():
    try:
        q = (request.args.get("q") or "").strip()
        user_lat = request.args.get("lat")
        user_lng = request.args.get("lng")

        if not q:
            return jsonify({"error": "Missing query"}), 400
        if not user_lat or not user_lng:
            return jsonify({"error": "Missing user lat/lng"}), 400
        if not GOOGLE_PLACES_API_KEY:
            return jsonify({"error": "GOOGLE_PLACES_API_KEY missing"}), 500

        resp = requests.get(
            "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
            params={
                "key": GOOGLE_PLACES_API_KEY,
                "keyword": q,
                "location": f"{user_lat},{user_lng}",
                "radius": 3000,
            },
            timeout=10,
        )
        data = safe_json(resp)
        results = data.get("results", [])

        if not results:
            return jsonify({"error": "Place not found"})

        best = results[0]
        loc = best.get("geometry", {}).get("location", {})

        return jsonify({
            "name": best.get("name", q),
            "address": best.get("vicinity") or best.get("name") or q,
            "lat": loc.get("lat"),
            "lng": loc.get("lng"),
            "source": "google_places",
            "raw": best,
        })

    except Exception as e:
        return jsonify({"error": str(e)})


# =========================================================
# FORWARD GEOCODE
# =========================================================
@app.route("/api/address-to-latlng")
def address_to_latlng():
    try:
        address = clean_sg_address((request.args.get("address") or "").strip())
        user_lat = request.args.get("user_lat")
        user_lng = request.args.get("user_lng")
        use_places = (request.args.get("use_places") or "1") == "1"

        if not address:
            return jsonify({"error": "Missing address"}), 400

        # 1) Google Places first for POI / business search
        if use_places and GOOGLE_PLACES_API_KEY and user_lat and user_lng:
            try:
                resp = requests.get(
                    "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
                    params={
                        "key": GOOGLE_PLACES_API_KEY,
                        "keyword": address,
                        "location": f"{user_lat},{user_lng}",
                        "radius": 3500,
                    },
                    timeout=10,
                )
                data = safe_json(resp)
                results = data.get("results", [])

                if results:
                    best = results[0]
                    loc = best.get("geometry", {}).get("location", {})
                    if loc.get("lat") is not None and loc.get("lng") is not None:
                        return jsonify({
                            "lat": float(loc["lat"]),
                            "lng": float(loc["lng"]),
                            "display": best.get("vicinity") or best.get("name") or address,
                            "place_name": best.get("name") or address,
                            "source": "google_places",
                            "raw": best,
                        })
            except Exception:
                pass

        # 2) OneMap for Singapore addresses
        token = get_onemap_token()
        if token:
            try:
                resp = requests.get(
                    "https://www.onemap.gov.sg/api/common/elastic/search",
                    params={
                        "searchVal": address,
                        "returnGeom": "Y",
                        "getAddrDetails": "Y",
                        "pageNum": 1,
                    },
                    headers={"Authorization": token},
                    timeout=10,
                )
                data = safe_json(resp)
                results = data.get("results", []) or []

                if results:
                    if user_lat and user_lng:
                        ulat = float(user_lat)
                        ulng = float(user_lng)

                        def score(item):
                            try:
                                lat = float(item.get("LATITUDE"))
                                lng = float(item.get("LONGITUDE"))
                                return haversine_m(ulat, ulng, lat, lng)
                            except Exception:
                                return 99999999

                        results = sorted(results, key=score)

                    best = results[0]

                    display_parts = [
                        nil_clean(best.get("BUILDING", "")),
                        nil_clean(best.get("BLK_NO", "")),
                        nil_clean(best.get("ROAD_NAME", "")),
                        nil_clean(best.get("POSTAL", "")),
                    ]
                    display = re.sub(r"\s+", " ", " ".join([p for p in display_parts if p])).strip()

                    return jsonify({
                        "lat": float(best["LATITUDE"]),
                        "lng": float(best["LONGITUDE"]),
                        "display": display or address,
                        "place_name": nil_clean(best.get("BUILDING", "")) or address,
                        "source": "onemap",
                        "raw": best,
                    })
            except Exception:
                pass

        # 3) OSM fallback
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": address, "format": "json", "limit": 5},
            headers={"User-Agent": "NinjaCoPilot/3.0"},
            timeout=10,
        )
        results = safe_json(resp)

        if not results:
            return jsonify({"error": "Address not found", "lat": None, "lng": None})

        best = results[0]

        if user_lat and user_lng:
            ulat = float(user_lat)
            ulng = float(user_lng)

            def score(item):
                return haversine_m(ulat, ulng, float(item["lat"]), float(item["lon"]))

            results = sorted(results, key=score)
            best = results[0]

        return jsonify({
            "lat": float(best["lat"]),
            "lng": float(best["lon"]),
            "display": best.get("display_name", ""),
            "place_name": address,
            "source": "nominatim",
        })

    except Exception as e:
        return jsonify({"error": str(e), "lat": None, "lng": None})


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
        mode = request.args.get("mode", "driving")

        if not all([from_lat, from_lng, to_lat, to_lng]):
            return jsonify({"error": "Missing coordinates"}), 400

        if mode == "walking":
            onemap_mode = "walk"
            osrm_mode = "foot"
        else:
            onemap_mode = "drive"
            osrm_mode = "driving"

        # -------------------------------------------------
        # 1) OneMap routing first
        # -------------------------------------------------
        token = get_onemap_token()
        if token:
            try:
                resp = requests.get(
                    "https://www.onemap.gov.sg/api/public/routingsvc/route",
                    params={
                        "start": f"{from_lat},{from_lng}",
                        "end": f"{to_lat},{to_lng}",
                        "routeType": onemap_mode,
                    },
                    headers={"Authorization": token},
                    timeout=15,
                )
                data = safe_json(resp)

                route_geometry = data.get("route_geometry")
                instructions = data.get("route_instructions", [])
                total_distance = data.get("total_distance")
                total_time = data.get("total_time")

                if route_geometry and instructions:
                    steps = []
                    for item in instructions:
                        text = str(item[0]).strip() if len(item) > 0 else ""
                        road = str(item[1]).strip() if len(item) > 1 else ""
                        dist = float(item[2]) if len(item) > 2 and item[2] not in (None, "") else 0
                        dur = float(item[3]) if len(item) > 3 and item[3] not in (None, "") else 0

                        if road:
                            text = f"{text} on {road}"

                        if text:
                            steps.append({
                                "text": text,
                                "distance": round(dist),
                                "duration": round(dur),
                                "type": "instruction",
                                "modifier": "",
                                "lat": None,
                                "lng": None,
                            })

                    return jsonify({
                        "steps": steps,
                        "total_distance": round(float(total_distance or 0)),
                        "total_duration": round(float(total_time or 0)),
                        "summary": f'{round(float(total_distance or 0))}m, ~{max(1, round(float(total_time or 0)) // 60)} min',
                        "geometry": {
                            "type": "polyline",
                            "coordinates": parse_onemap_polyline(route_geometry)
                        },
                        "source": "onemap"
                    })
            except Exception:
                pass

        # -------------------------------------------------
        # 2) OSRM fallback
        # -------------------------------------------------
        url = (
            f"https://router.project-osrm.org/route/v1/{osrm_mode}/"
            f"{from_lng},{from_lat};{to_lng},{to_lat}"
            f"?overview=full&steps=true&annotations=false&geometries=geojson"
        )

        resp = requests.get(url, timeout=15)
        data = safe_json(resp)

        if data.get("code") != "Ok" or not data.get("routes"):
            return jsonify({"error": "No route found", "steps": []})

        route_data = data["routes"][0]
        steps = []

        for leg in route_data.get("legs", []):
            for step in leg.get("steps", []):
                maneuver = step.get("maneuver", {})
                name = step.get("name", "")
                distance = step.get("distance", 0)
                duration = step.get("duration", 0)
                modifier = maneuver.get("modifier", "")
                m_type = maneuver.get("type", "")
                loc = maneuver.get("location", [None, None])

                text = build_instruction(m_type, modifier, name, distance, mode)
                if text:
                    steps.append({
                        "text": text,
                        "distance": round(distance),
                        "duration": round(duration),
                        "type": m_type,
                        "modifier": modifier,
                        "lat": loc[1] if len(loc) > 1 else None,
                        "lng": loc[0] if len(loc) > 0 else None,
                    })

        return jsonify({
            "steps": steps,
            "total_distance": round(route_data.get("distance", 0)),
            "total_duration": round(route_data.get("duration", 0)),
            "summary": f'{round(route_data.get("distance", 0))}m, ~{max(1, round(route_data.get("duration", 0)) // 60)} min',
            "geometry": route_data.get("geometry", {}),
            "source": "osrm"
        })

    except Exception as e:
        return jsonify({"error": str(e), "steps": []})


def build_instruction(m_type, modifier, name, distance, mode):
    dist_str = f"{round(distance)}m" if distance < 1000 else f"{round(distance / 1000, 1)}km"
    road = f" onto {name}" if name else ""
    start_word = "walking" if mode == "walking" else "driving"

    if m_type == "depart":
        return f"Start {start_word}{road} for {dist_str}"
    if m_type == "arrive":
        return f"You have arrived at your destination{road}"
    if m_type == "turn":
        return f"Turn {modifier}{road}, continue for {dist_str}"
    if m_type == "new name":
        return f"Continue{road} for {dist_str}"
    if m_type == "merge":
        return f"Merge {modifier}{road} for {dist_str}"
    if m_type == "fork":
        return f"Keep {modifier} at the fork{road} for {dist_str}"
    if m_type in ("roundabout", "rotary"):
        return f"Enter roundabout, continue{road} for {dist_str}"
    if m_type == "end of road":
        return f"At end of road, turn {modifier}{road} for {dist_str}"
    if m_type == "continue":
        return f"Continue straight{road} for {dist_str}"
    if m_type in ("on ramp", "off ramp"):
        return f"Take the ramp {modifier}{road} for {dist_str}"
    if m_type == "notification":
        return None
    if modifier:
        return f"Go {modifier}{road} for {dist_str}"
    if name:
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
                "description": "Weather API key not configured",
            })

        resp = requests.get(
            "https://api.weatherapi.com/v1/current.json",
            params={"key": WEATHER_API_KEY, "q": f"{lat},{lng}"},
            timeout=10,
        )
        data = safe_json(resp)

        desc = str(data.get("current", {}).get("condition", {}).get("text", "")).lower()
        rain_keywords = ["rain", "drizzle", "shower", "storm", "thunder"]
        is_rain = any(k in desc for k in rain_keywords)

        return jsonify({
            "status": "ok",
            "is_rain": is_rain,
            "description": desc or "unknown",
            "temp_c": data.get("current", {}).get("temp_c"),
            "raw": data,
        })

    except Exception as e:
        return jsonify({
            "status": "weather_error",
            "is_rain": False,
            "description": str(e),
        })


# =========================================================
# CHAT
# =========================================================
@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        data = request.json or {}
        system = data.get("system", "")
        messages = data.get("messages", [])

        if AI_PROVIDER == "openai" and OPENAI_API_KEY:
            reply = call_openai(system, messages)
        else:
            reply = call_claude(system, messages)

        return jsonify({"reply": reply})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# =========================================================
# OCR / VISION
# =========================================================
@app.route("/api/scan", methods=["POST"])
def scan():
    try:
        data = request.json or {}
        system = data.get("system", "")
        image_base64 = data.get("image_base64", "")
        ocr_prompt = data.get("ocr_prompt", "Extract address from this image.")

        if AI_PROVIDER == "openai" and OPENAI_API_KEY:
            reply = call_openai_vision(system, image_base64, ocr_prompt)
        else:
            reply = call_claude_vision(system, image_base64, ocr_prompt)

        return jsonify({"reply": reply})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# =========================================================
# TRANSCRIBE
# =========================================================
@app.route("/api/transcribe", methods=["POST"])
def transcribe():
    try:
        data = request.json or {}
        audio_base64 = data.get("audio_base64", "")
        language = data.get("language", "en")

        if not audio_base64:
            return jsonify({"error": "No audio", "text": ""})

        if not OPENAI_API_KEY:
            return jsonify({"error": "OPENAI_API_KEY missing for transcription", "text": ""})

        audio_bytes = base64.b64decode(audio_base64)

        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
            f.write(audio_bytes)
            temp_path = f.name

        try:
            lang_map = {
                "en": "en",
                "en-SG": "en",
                "zh-CN": "zh",
                "zh-TW": "zh",
                "zh-HK": "zh",
                "ms-MY": "ms",
                "ta-IN": "ta",
                "th-TH": "th",
                "vi-VN": "vi",
                "id-ID": "id",
                "ko-KR": "ko",
                "ja-JP": "ja",
            }

            whisper_lang = "en"
            for code, wl in lang_map.items():
                if language == code or language.startswith(code.split("-")[0]):
                    whisper_lang = wl
                    break

            with open(temp_path, "rb") as audio_file:
                resp = requests.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                    files={"file": ("audio.webm", audio_file, "audio/webm")},
                    data={"model": "whisper-1", "language": whisper_lang},
                    timeout=30,
                )

            result = safe_json(resp)

            if "text" in result:
                return jsonify({"text": result["text"]})

            return jsonify({
                "error": result.get("error", {}).get("message", "Whisper error"),
                "text": ""
            })

        finally:
            try:
                os.unlink(temp_path)
            except Exception:
                pass

    except Exception as e:
        return jsonify({"error": str(e), "text": ""})


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
            "anthropic-version": "2023-06-01",
        },
        json={
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 300,
            "system": system,
            "messages": messages,
        },
        timeout=30,
    )
    data = safe_json(resp)

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
            "anthropic-version": "2023-06-01",
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
                            "data": image_base64,
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }],
        },
        timeout=30,
    )
    data = safe_json(resp)

    if "error" in data:
        raise Exception(data["error"].get("message", str(data["error"])))

    return "".join(block.get("text", "") for block in data.get("content", []))


def call_openai(system, messages):
    if not OPENAI_API_KEY:
        raise Exception("OPENAI_API_KEY is missing")

    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENAI_API_KEY}",
        },
        json={
            "model": "gpt-4o",
            "max_tokens": 300,
            "messages": [{"role": "system", "content": system}] + messages,
        },
        timeout=30,
    )
    data = safe_json(resp)

    if "error" in data:
        raise Exception(data["error"].get("message", "OpenAI error"))

    return data["choices"][0]["message"]["content"]


def call_openai_vision(system, image_base64, prompt):
    if not OPENAI_API_KEY:
        raise Exception("OPENAI_API_KEY is missing")

    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENAI_API_KEY}",
        },
        json={
            "model": "gpt-4o",
            "max_tokens": 300,
            "messages": [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}
                        },
                        {
                            "type": "text",
                            "text": prompt
                        },
                    ],
                },
            ],
        },
        timeout=30,
    )
    data = safe_json(resp)

    if "error" in data:
        raise Exception(data["error"].get("message", "OpenAI error"))

    return data["choices"][0]["message"]["content"]


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
