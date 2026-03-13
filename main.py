import os
import base64
import tempfile
import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="/static")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
WEATHER_API_KEY = os.environ.get("WEATHER_API_KEY", "")
GOOGLE_PLACES_API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "")
ONEMAP_EMAIL = os.environ.get("ONEMAP_EMAIL", "")
ONEMAP_PASSWORD = os.environ.get("ONEMAP_PASSWORD", "")
AI_PROVIDER = os.environ.get("AI_PROVIDER", "claude").lower()

_onemap_token = None


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory("static", path)


def get_onemap_token():
    global _onemap_token
    if _onemap_token:
        return _onemap_token
    if not ONEMAP_EMAIL or not ONEMAP_PASSWORD:
        return None
    try:
        resp = requests.post(
            "https://www.onemap.gov.sg/api/auth/post/getToken",
            json={"email": ONEMAP_EMAIL, "password": ONEMAP_PASSWORD},
            timeout=8
        )
        data = resp.json()
        token = data.get("access_token") or data.get("token")
        if token:
            _onemap_token = token
            return token
    except Exception:
        pass
    return None


@app.route("/api/geocode")
def geocode():
    try:
        lat = request.args.get("lat")
        lng = request.args.get("lng")
        if not lat or not lng:
            return jsonify({"error": "Missing lat/lng"}), 400

        token = get_onemap_token()
        if token:
            try:
                resp = requests.get(
                    "https://www.onemap.gov.sg/api/public/revgeocode",
                    params={"location": f"{lat},{lng}", "buffer": 40, "addressType": "All", "otherFeatures": "N"},
                    headers={"Authorization": token},
                    timeout=8
                )
                data = resp.json()
                results = data.get("GeocodeInfo", [])
                if results:
                    r = results[0]
                    parts = []
                    blk = r.get("BLOCK", "")
                    road = r.get("ROAD", "")
                    building = r.get("BUILDINGNAME", "")
                    postal = r.get("POSTALCODE", "")
                    if blk and road:
                        parts.append(f"{blk} {road}")
                    elif road:
                        parts.append(road)
                    if building and building != "NIL":
                        parts.append(building)
                    if postal and postal != "NIL":
                        parts.append(f"Singapore {postal}")
                    address = ", ".join([p for p in parts if p.strip()])
                    if address:
                        return jsonify({"ok": True, "address": address, "source": "onemap"})
            except Exception:
                pass

        resp = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lng, "format": "json", "addressdetails": 1, "zoom": 18},
            headers={"User-Agent": "NinjaCoPilot/1.0"},
            timeout=10
        )
        data = resp.json()
        addr = data.get("address", {})
        parts = []
        house = addr.get("house_number", "")
        road = addr.get("road") or addr.get("pedestrian") or addr.get("footway") or ""
        suburb = addr.get("suburb") or addr.get("neighbourhood") or ""
        postcode = addr.get("postcode", "")
        if road:
            parts.append((house + " " + road).strip())
        if suburb:
            parts.append(suburb)
        if postcode:
            parts.append(f"Singapore {postcode}")
        address = ", ".join([p for p in parts if p.strip()]) or data.get("display_name", f"{lat},{lng}")
        return jsonify({"ok": True, "address": address, "source": "nominatim"})

    except Exception as e:
        return jsonify({"ok": False, "address": None, "error": str(e)})


@app.route("/api/address-to-latlng")
def address_to_latlng():
    try:
        address = request.args.get("address", "").strip()
        user_lat = request.args.get("user_lat")
        user_lng = request.args.get("user_lng")
        use_places = request.args.get("use_places", "0") == "1"

        if not address:
            return jsonify({"error": "Missing address"}), 400

        if use_places and GOOGLE_PLACES_API_KEY:
            try:
                params = {
                    "input": address,
                    "inputtype": "textquery",
                    "fields": "geometry,name,formatted_address",
                    "key": GOOGLE_PLACES_API_KEY
                }
                if user_lat and user_lng:
                    params["locationbias"] = f"circle:5000@{user_lat},{user_lng}"
                resp = requests.get(
                    "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
                    params=params,
                    timeout=8
                )
                data = resp.json()
                candidates = data.get("candidates", [])
                if candidates:
                    c = candidates[0]
                    loc = c.get("geometry", {}).get("location", {})
                    if loc.get("lat") is not None and loc.get("lng") is not None:
                        return jsonify({
                            "lat": loc["lat"],
                            "lng": loc["lng"],
                            "display": c.get("formatted_address", address),
                            "place_name": c.get("name", address),
                            "source": "google"
                        })
            except Exception:
                pass

        token = get_onemap_token()
        if token:
            try:
                resp = requests.get(
                    "https://www.onemap.gov.sg/api/common/elastic/search",
                    params={"searchVal": address, "returnGeom": "Y", "getAddrDetails": "Y", "pageNum": 1},
                    timeout=8
                )
                data = resp.json()
                results = data.get("results", [])
                if results:
                    r = results[0]
                    lat = float(r.get("LATITUDE", 0))
                    lng = float(r.get("LONGITUDE", 0))
                    if lat and lng:
                        return jsonify({
                            "lat": lat,
                            "lng": lng,
                            "display": r.get("ADDRESS", address),
                            "place_name": r.get("SEARCHVAL", address),
                            "source": "onemap"
                        })
            except Exception:
                pass

        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": address + " Singapore", "format": "json", "limit": 1},
            headers={"User-Agent": "NinjaCoPilot/1.0"},
            timeout=10
        )
        results = resp.json()
        if not results:
            return jsonify({"error": "Address not found", "lat": None, "lng": None})

        first = results[0]
        return jsonify({
            "lat": float(first["lat"]),
            "lng": float(first["lon"]),
            "display": first.get("display_name", address),
            "place_name": address,
            "source": "nominatim"
        })

    except Exception as e:
        return jsonify({"error": str(e), "lat": None, "lng": None})


@app.route("/api/place-search")
def place_search():
    try:
        q = request.args.get("q", "").strip()
        lat = request.args.get("lat")
        lng = request.args.get("lng")

        if not q:
            return jsonify({"error": "Missing query"}), 400
        if not lat or not lng:
            return jsonify({"error": "Missing lat/lng"}), 400

        if GOOGLE_PLACES_API_KEY:
            try:
                resp = requests.get(
                    "https://maps.googleapis.com/maps/api/place/textsearch/json",
                    params={"query": q, "location": f"{lat},{lng}", "radius": 2500, "key": GOOGLE_PLACES_API_KEY},
                    timeout=8
                )
                data = resp.json()
                results = data.get("results", [])
                if results:
                    r = results[0]
                    loc = r.get("geometry", {}).get("location", {})
                    return jsonify({
                        "lat": loc.get("lat"),
                        "lng": loc.get("lng"),
                        "name": r.get("name", q),
                        "address": r.get("formatted_address", ""),
                        "source": "google"
                    })
            except Exception:
                pass

        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": q + " Singapore", "format": "json", "limit": 1, "viewbox": "103.6,1.2,104.1,1.5", "bounded": 1},
            headers={"User-Agent": "NinjaCoPilot/1.0"},
            timeout=10
        )
        results = resp.json()
        if results:
            r = results[0]
            return jsonify({
                "lat": float(r["lat"]),
                "lng": float(r["lon"]),
                "name": q,
                "address": r.get("display_name", ""),
                "source": "nominatim"
            })

        return jsonify({"error": "Place not found"})

    except Exception as e:
        return jsonify({"error": str(e)})


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

        profile = "foot" if mode == "walking" else "car"
        url = (
            f"https://router.project-osrm.org/route/v1/{profile}/"
            f"{from_lng},{from_lat};{to_lng},{to_lat}"
            f"?overview=full&steps=true&annotations=false&geometries=geojson"
        )

        resp = requests.get(url, timeout=15)
        data = resp.json()

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

        return jsonify({
            "steps": steps,
            "total_distance": total_dist,
            "total_duration": total_time,
            "summary": f"{total_dist}m, ~{max(1, total_time // 60)} min",
            "geometry": route_data.get("geometry", {})
        })

    except Exception as e:
        return jsonify({"error": str(e), "steps": []})


def build_instruction(m_type, modifier, name, distance):
    dist_str = f"{round(distance)}m" if distance < 1000 else f"{round(distance / 1000, 1)}km"
    road = f" onto {name}" if name else ""

    if m_type == "depart":
        return f"Start driving{road} for {dist_str}"
    elif m_type == "arrive":
        return "Arrived at destination"
    elif m_type == "turn":
        return f"Turn {modifier}{road}, continue {dist_str}"
    elif m_type == "new name":
        return f"Continue{road} for {dist_str}"
    elif m_type == "merge":
        return f"Merge {modifier}{road} for {dist_str}"
    elif m_type == "fork":
        return f"Keep {modifier} at fork{road} for {dist_str}"
    elif m_type in ("roundabout", "rotary"):
        return f"Enter roundabout, exit{road}"
    elif m_type == "end of road":
        return f"Turn {modifier} at end of road{road}"
    elif m_type == "continue":
        return f"Continue straight{road} for {dist_str}"
    elif m_type in ("on ramp", "off ramp"):
        return f"Take ramp {modifier}{road}"
    elif m_type == "notification":
        return None
    else:
        if modifier:
            return f"Go {modifier}{road} for {dist_str}"
        elif name:
            return f"Continue on {name} for {dist_str}"
        return None


@app.route("/api/weather")
def weather():
    try:
        lat = request.args.get("lat")
        lng = request.args.get("lng")
        if not lat or not lng:
            return jsonify({"error": "Missing lat/lng"}), 400

        if not WEATHER_API_KEY:
            return jsonify({"status": "weather_unavailable", "is_rain": False, "description": "Weather API key not configured"})

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
            "temp_c": data.get("current", {}).get("temp_c")
        })

    except Exception as e:
        return jsonify({"status": "weather_error", "is_rain": False, "description": str(e)})


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


@app.route("/api/scan", methods=["POST"])
def scan():
    try:
        data = request.json or {}
        system = data.get("system", "")
        image_base64 = data.get("image_base64", "")
        ocr_prompt = data.get("ocr_prompt", "Extract address from this label.")

        if not image_base64:
            return jsonify({"error": "No image provided"}), 400

        if AI_PROVIDER == "openai" and OPENAI_API_KEY:
            reply = call_openai_vision(system, image_base64, ocr_prompt)
        else:
            reply = call_claude_vision(system, image_base64, ocr_prompt)

        return jsonify({"reply": reply})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/transcribe", methods=["POST"])
def transcribe():
    try:
        data = request.json or {}
        audio_base64 = data.get("audio_base64", "")
        language = data.get("language", "en")

        if not audio_base64:
            return jsonify({"error": "No audio", "text": ""})

        if not OPENAI_API_KEY:
            return jsonify({"error": "OpenAI API key required for transcription", "text": ""})

        audio_bytes = base64.b64decode(audio_base64)

        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
            f.write(audio_bytes)
            temp_path = f.name

        try:
            lang_map = {
                "en": "en", "en-SG": "en", "zh-CN": "zh", "zh-TW": "zh", "zh-HK": "zh",
                "ms-MY": "ms", "ta-IN": "ta", "th-TH": "th", "vi-VN": "vi",
                "id-ID": "id", "ko-KR": "ko", "ja-JP": "ja"
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
                    timeout=30
                )

            result = resp.json()
            os.unlink(temp_path)

            if "text" in result:
                return jsonify({"text": result["text"]})

            return jsonify({"error": result.get("error", {}).get("message", "Whisper error"), "text": ""})

        except Exception as e:
            try:
                os.unlink(temp_path)
            except Exception:
                pass
            return jsonify({"error": str(e), "text": ""})

    except Exception as e:
        return jsonify({"error": str(e), "text": ""})


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
            "max_tokens": 120,
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
            "max_tokens": 400,
            "system": system,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": image_base64}},
                    {"type": "text", "text": prompt}
                ]
            }]
        },
        timeout=30
    )
    data = resp.json()
    if "error" in data:
        raise Exception(data["error"].get("message", str(data["error"])))
    return "".join(block.get("text", "") for block in data.get("content", []))


def call_openai(system, messages):
    if not OPENAI_API_KEY:
        raise Exception("OPENAI_API_KEY is missing")

    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_API_KEY}"},
        json={"model": "gpt-4o", "max_tokens": 120, "messages": [{"role": "system", "content": system}] + messages},
        timeout=30
    )
    data = resp.json()
    if "error" in data:
        raise Exception(data["error"].get("message", "OpenAI error"))
    content = data["choices"][0]["message"]["content"]
    return content or ""


def call_openai_vision(system, image_base64, prompt):
    if not OPENAI_API_KEY:
        raise Exception("OPENAI_API_KEY is missing")

    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_API_KEY}"},
        json={
            "model": "gpt-4o",
            "max_tokens": 400,
            "messages": [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}},
                        {"type": "text", "text": prompt}
                    ]
                }
            ]
        },
        timeout=30
    )
    data = resp.json()
    if "error" in data:
        raise Exception(data["error"].get("message", "OpenAI error"))
    content = data["choices"][0]["message"]["content"]
    return content or ""


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
