import os
import json
import base64
import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="/static")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
WEATHER_API_KEY = os.environ.get("WEATHER_API_KEY", "")
GOOGLE_PLACES_API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "")
ONEMAP_EMAIL = os.environ.get("ONEMAP_EMAIL", "")
ONEMAP_PASSWORD = os.environ.get("ONEMAP_PASSWORD", "")
AI_PROVIDER = os.environ.get("AI_PROVIDER", "openai").lower()

_onemap_token = None


# =========================================================
# STATIC FILES
# =========================================================
@app.route("/")
def index():
    return send_from_directory("static", "index.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory("static", path)

@app.route("/health")
def health():
    return jsonify({"status": "ok"})

@app.get("/api/test")
def test():
    return {
        "claude": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "openai": bool(os.environ.get("OPENAI_API_KEY")),
        "google_places": bool(os.environ.get("GOOGLE_PLACES_API_KEY")),
        "onemap": bool(os.environ.get("ONEMAP_EMAIL")),
        "weather": bool(os.environ.get("WEATHER_API_KEY"))
    }
@app.route("/api/verify")
def verify():
    result = {}

    # Claude
        # Google Places API (New)
    try:
        if not GOOGLE_PLACES_API_KEY:
            result["google_places"] = {"ok": False, "error": "Missing API key"}
        else:
            resp = requests.post(
                "https://places.googleapis.com/v1/places:searchText",
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
                    "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location"
                },
                json={"textQuery": "Haidilao Jurong East"},
                timeout=20
            )
            data = resp.json()
            result["google_places"] = {
                "ok": resp.status_code == 200 and "places" in data,
                "status": resp.status_code,
                "preview": str(data)[:200]
            }
    except Exception as e:
        result["google_places"] = {"ok": False, "error": str(e)}
    # OpenAI
    try:
        if not OPENAI_API_KEY:
            result["openai"] = {"ok": False, "error": "Missing API key"}
        else:
            resp = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "user", "content": "Hi"}],
                    "max_tokens": 20
                },
                timeout=20
            )
            data = resp.json()
            result["openai"] = {
                "ok": resp.status_code == 200,
                "status": resp.status_code,
                "preview": str(data)[:200]
            }
    except Exception as e:
        result["openai"] = {"ok": False, "error": str(e)}

    # Google Places
    try:
        if not GOOGLE_PLACES_API_KEY:
            result["google_places"] = {"ok": False, "error": "Missing API key"}
        else:
            resp = requests.get(
                "https://places.googleapis.com/v1/places:searchText",
                params={
                    "query": "Haidilao Jurong East",
                    "key": GOOGLE_PLACES_API_KEY
                },
                timeout=20
            )
            data = resp.json()
            result["google_places"] = {
                "ok": resp.status_code == 200 and data.get("status") in ("OK", "ZERO_RESULTS"),
                "status": resp.status_code,
                "api_status": data.get("status"),
                "preview": str(data)[:200]
            }
    except Exception as e:
        result["google_places"] = {"ok": False, "error": str(e)}

    # Weather
    try:
        if not WEATHER_API_KEY:
            result["weather"] = {"ok": False, "error": "Missing API key"}
        else:
            resp = requests.get(
                "https://api.weatherapi.com/v1/current.json",
                params={"key": WEATHER_API_KEY, "q": "Singapore"},
                timeout=20
            )
            data = resp.json()
            result["weather"] = {
                "ok": resp.status_code == 200 and "current" in data,
                "status": resp.status_code,
                "preview": str(data)[:200]
            }
    except Exception as e:
        result["weather"] = {"ok": False, "error": str(e)}

    # OneMap
    try:
        if not ONEMAP_EMAIL or not ONEMAP_PASSWORD:
            result["onemap"] = {"ok": False, "error": "Missing email/password"}
        else:
            resp = requests.post(
                "https://www.onemap.gov.sg/api/auth/post/getToken",
                json={"email": ONEMAP_EMAIL, "password": ONEMAP_PASSWORD},
                timeout=20
            )
            data = resp.json()
            result["onemap"] = {
                "ok": resp.status_code == 200 and bool(data.get("access_token") or data.get("token")),
                "status": resp.status_code,
                "preview": str(data)[:200]
            }
    except Exception as e:
        result["onemap"] = {"ok": False, "error": str(e)}

    return jsonify(result)

# =========================================================
# ONEMAP TOKEN
# =========================================================
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


# =========================================================
# REVERSE GEOCODE — OneMap primary, Nominatim fallback
# =========================================================
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
                    address = ", ".join(p for p in parts if p.strip())
                    if address:
                        return jsonify({"ok": True, "address": address, "source": "onemap"})
            except Exception:
                pass

        # Nominatim fallback
        resp = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lng, "format": "json", "addressdetails": 1, "zoom": 18},
            headers={"User-Agent": "NinjaCoPilot/1.0"},
            timeout=10
        )
        data = resp.json()
        addr = data.get("address", {})
        parts = []
        block = addr.get("house_number", "")
        road = addr.get("road") or addr.get("pedestrian") or addr.get("footway") or ""
        suburb = addr.get("suburb") or addr.get("neighbourhood") or ""
        postcode = addr.get("postcode", "")
        if road:
            parts.append((block + " " + road).strip())
        if suburb:
            parts.append(suburb)
        if postcode:
            parts.append(f"Singapore {postcode}")
        address = ", ".join(p for p in parts if p.strip()) or data.get("display_name", f"{lat},{lng}")
        return jsonify({"ok": True, "address": address, "source": "nominatim"})

    except Exception as e:
        return jsonify({"ok": False, "address": None, "error": str(e)})


# =========================================================
# FORWARD GEOCODE — OneMap primary, Nominatim fallback
# =========================================================
@app.route("/api/address-to-latlng")
def address_to_latlng():
    try:
        address = request.args.get("address", "").strip()
        user_lat = request.args.get("user_lat")
        user_lng = request.args.get("user_lng")
        use_places = request.args.get("use_places", "0") == "1"
        if not address:
            return jsonify({"error": "Missing address"}), 400

        # Google Places if enabled
                # Google Places API (New)
                # Google Places API (New)
        if use_places and GOOGLE_PLACES_API_KEY:
            try:
                headers = {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
                    "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location"
                }

                body = {
                    "textQuery": address
                }

                if user_lat and user_lng:
                    body["locationBias"] = {
                        "circle": {
                            "center": {
                                "latitude": float(user_lat),
                                "longitude": float(user_lng)
                            },
                            "radius": 5000.0
                        }
                    }

                resp = requests.post(
                    "https://places.googleapis.com/v1/places:searchText",
                    headers=headers,
                    json=body,
                    timeout=8
                )
                data = resp.json()
                places = data.get("places", [])
                if places:
                    p = places[0]
                    loc = p.get("location", {})
                    return jsonify({
                        "lat": loc.get("latitude"),
                        "lng": loc.get("longitude"),
                        "display": p.get("formattedAddress", address),
                        "place_name": p.get("displayName", {}).get("text", address),
                        "source": "google_new"
                    })
            except Exception:
                pass

        # OneMap
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
                        display = r.get("ADDRESS", address)
                        return jsonify({
                            "lat": lat, "lng": lng, "display": display,
                            "place_name": r.get("SEARCHVAL", address),
                            "source": "onemap"
                        })
            except Exception:
                pass

        # Nominatim fallback
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
            "lat": float(first["lat"]), "lng": float(first["lon"]),
            "display": first.get("display_name", address),
            "place_name": address,
            "source": "nominatim"
        })

    except Exception as e:
        return jsonify({"error": str(e), "lat": None, "lng": None})


# =========================================================
# PLACE SEARCH
# =========================================================
@app.route("/api/place-search")
def place_search():
    try:
        q = request.args.get("q", "").strip()
        lat = request.args.get("lat")
        lng = request.args.get("lng")
        if not q:
            return jsonify({"error": "Missing query"}), 400

        # Google Places nearby search
                # Google Places API (New)
                # Google Places API (New)
        if GOOGLE_PLACES_API_KEY:
            try:
                headers = {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
                    "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location"
                }

                body = {
                    "textQuery": q
                }

                if lat and lng:
                    body["locationBias"] = {
                        "circle": {
                            "center": {
                                "latitude": float(lat),
                                "longitude": float(lng)
                            },
                            "radius": 3000.0
                        }
                    }

                resp = requests.post(
                    "https://places.googleapis.com/v1/places:searchText",
                    headers=headers,
                    json=body,
                    timeout=8
                )
                data = resp.json()
                places = data.get("places", [])
                if places:
                    p = places[0]
                    loc = p.get("location", {})
                    return jsonify({
                        "lat": loc.get("latitude"),
                        "lng": loc.get("longitude"),
                        "name": p.get("displayName", {}).get("text", q),
                        "address": p.get("formattedAddress", ""),
                        "source": "google_new"
                    })
            except Exception:
                pass

        # Nominatim fallback
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": q + " Singapore", "format": "json", "limit": 1,
                    "viewbox": "103.6,1.2,104.1,1.5", "bounded": 1},
            headers={"User-Agent": "NinjaCoPilot/1.0"},
            timeout=10
        )
        results = resp.json()
        if results:
            r = results[0]
            return jsonify({
                "lat": float(r["lat"]), "lng": float(r["lon"]),
                "name": q, "address": r.get("display_name", ""),
                "source": "nominatim"
            })

        return jsonify({"error": "Place not found"})

    except Exception as e:
        return jsonify({"error": str(e)})


# =========================================================
# ROUTE — OSRM
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
                text = build_instruction(m_type, modifier, name, distance, mode)
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


def build_instruction(m_type, modifier, name, distance, mode="driving"):
    dist_str = f"{round(distance)}m" if distance < 1000 else f"{round(distance / 1000, 1)}km"
    road = f" onto {name}" if name else ""

    start_verb = "walking" if mode == "walking" else "driving"
    move_verb = "Walk" if mode == "walking" else "Drive"

    if m_type == "depart":
        return f"Start {start_verb}{road} for {dist_str}"
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
            return jsonify({"status": "weather_unavailable", "is_rain": False,
                            "description": "Weather API key not configured"})

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
            "status": "ok", "is_rain": is_rain,
            "description": condition_text or "unknown",
            "temp_c": data.get("current", {}).get("temp_c")
        })

    except Exception as e:
        return jsonify({"status": "weather_error", "is_rain": False, "description": str(e)})


# =========================================================
# CHAT — Claude or OpenAI
# FIX: max_tokens reduced to 80 to force short GPS-style replies
# =========================================================
@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        data = request.json or {}
        system_prompt = data.get("system", "You are Ninja Co-Pilot, AI assistant for Ninja Van drivers in Singapore.")
        messages = data.get("messages", [])
        text = data.get("text", "")

        # Support both formats
        if not messages and text:
            messages = [{"role": "user", "content": text}]

        if not messages:
            return jsonify({"reply": "Tell me where you need to go."})

        if AI_PROVIDER == "openai" and OPENAI_API_KEY:
            reply = call_openai_chat(system_prompt, messages)
        elif ANTHROPIC_API_KEY:
            reply = call_claude_chat(system_prompt, messages)
        else:
            return jsonify({"error": "No AI API key configured"}), 500

        return jsonify({"reply": reply})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


def call_claude_chat(system_prompt, messages):
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        },
        json={
            "model": "claude-sonnet-4-5-20250929",
            "max_tokens": 80,  # FIX: was 300 — forces short GPS-style replies
            "system": system_prompt,
            "messages": messages
        },
        timeout=30
    )
    data = resp.json()
    if resp.status_code != 200:
        raise Exception(data.get("error", {}).get("message", f"HTTP {resp.status_code}"))
    return data["content"][0]["text"]


def call_openai_chat(system_prompt, messages):
    oai_messages = [{"role": "system", "content": system_prompt}] + messages
    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
        json={"model": "gpt-4o", "max_tokens": 80, "messages": oai_messages},  # FIX: was 300
        timeout=30
    )
    data = resp.json()
    if resp.status_code != 200:
        raise Exception(data.get("error", {}).get("message", f"HTTP {resp.status_code}"))
    return data["choices"][0]["message"]["content"]


# =========================================================
# SCAN — image OCR via Claude Vision or GPT-4o
# =========================================================
@app.route("/api/scan", methods=["POST"])
def scan():
    try:
        data = request.json or {}
        image_base64 = data.get("image_base64", "")
        ocr_prompt = data.get("ocr_prompt", "Extract address and parcel info. Return JSON only.")
        system_prompt = data.get("system", "You are a parcel label OCR assistant.")

        if not image_base64:
            return jsonify({"error": "No image provided"}), 400

        if AI_PROVIDER == "openai" and OPENAI_API_KEY:
            reply = scan_openai(image_base64, ocr_prompt, system_prompt)
        elif ANTHROPIC_API_KEY:
            reply = scan_claude(image_base64, ocr_prompt, system_prompt)
        else:
            return jsonify({"error": "No AI API key configured"}), 500

        return jsonify({"reply": reply})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


def scan_claude(image_base64, prompt, system_prompt):
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        },
        json={
            "model": "claude-sonnet-4-5-20250929",
            "max_tokens": 500,  # scan stays at 500 — needs room for JSON output
            "system": system_prompt,
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
    if resp.status_code != 200:
        raise Exception(data.get("error", {}).get("message", f"HTTP {resp.status_code}"))
    return data["content"][0]["text"]


def scan_openai(image_base64, prompt, system_prompt):
    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": "gpt-4o",
            "max_tokens": 500,  # scan stays at 500
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}},
                    {"type": "text", "text": prompt}
                ]}
            ]
        },
        timeout=30
    )
    data = resp.json()
    if resp.status_code != 200:
        raise Exception(data.get("error", {}).get("message", f"HTTP {resp.status_code}"))
    return data["choices"][0]["message"]["content"]


# =========================================================
# TRANSCRIBE — OpenAI Whisper
# =========================================================
@app.route("/api/transcribe", methods=["POST"])
def transcribe():
    try:
        data = request.json or {}
        audio_base64 = data.get("audio_base64", "")
        language = data.get("language", "en")

        if not audio_base64:
            return jsonify({"error": "No audio provided"}), 400

        if not OPENAI_API_KEY:
            return jsonify({"error": "OpenAI API key required for transcription"}), 500

        audio_bytes = base64.b64decode(audio_base64)
        lang_code = language.split("-")[0] if "-" in language else language

        files = {"file": ("audio.webm", audio_bytes, "audio/webm")}
        form_data = {"model": "whisper-1", "language": lang_code}

        resp = requests.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            files=files,
            data=form_data,
            timeout=30
        )
        result = resp.json()
        if resp.status_code != 200:
            raise Exception(result.get("error", {}).get("message", f"HTTP {resp.status_code}"))

        return jsonify({"text": result.get("text", "")})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
