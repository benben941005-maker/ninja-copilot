import os
import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="/static")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
WEATHER_API_KEY = os.environ.get("WEATHER_API_KEY", "")
GOOGLE_PLACES_API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "")
AI_PROVIDER = os.environ.get("AI_PROVIDER", "claude").lower()


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory("static", path)

# =========================================================
# REVERSE GEOCODE (Google Maps primary, Nominatim fallback)
# =========================================================
@app.route("/api/geocode")
def geocode():
    """Reverse geocode GPS coordinates to street address."""
    try:
        lat = request.args.get("lat")
        lng = request.args.get("lng")

        if not lat or not lng:
            return jsonify({"error": "Missing lat/lng"}), 400

        # --- Google Reverse Geocoding (primary) ---
        if GOOGLE_PLACES_API_KEY:
            try:
                g_resp = requests.get(
                    "https://maps.googleapis.com/maps/api/geocode/json",
                    params={
                        "latlng": f"{lat},{lng}",
                        "key": GOOGLE_PLACES_API_KEY,
                        "language": "en",
                        "result_type": "street_address|route|premise"
                    },
                    timeout=8
                )
                g_data = g_resp.json()
                g_results = g_data.get("results", [])

                if g_results:
                    address = g_results[0].get("formatted_address", "")
                    # Strip ", Singapore" suffix for cleaner display
                    address = address.replace(", Singapore", "").strip()
                    return jsonify({
                        "address": address,
                        "raw": g_results[0].get("address_components", {}),
                        "source": "google"
                    })
            except Exception:
                pass  # Fall through to Nominatim

        # --- Fallback: Nominatim ---
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
            timeout=8
        )
        data = resp.json()

        addr = data.get("address", {})
        parts = []

        road = addr.get("road") or addr.get("pedestrian") or addr.get("footway") or ""
        if road:
            house = addr.get("house_number", "")
            parts.append((house + " " + road).strip())

        area = addr.get("suburb") or addr.get("neighbourhood") or addr.get("quarter") or ""
        if area:
            parts.append(area)

        city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("county") or ""
        if city:
            parts.append(city)

        postcode = addr.get("postcode", "")
        if postcode:
            parts.append(postcode)

        address = ", ".join(parts) if parts else data.get("display_name", f"{lat},{lng}")

        return jsonify({
            "address": address,
            "raw": addr,
            "source": "nominatim"
        })

    except Exception as e:
        return jsonify({
            "address": None,
            "error": str(e)
        })


# =========================================================
# FORWARD GEOCODE (Google Maps primary, Nominatim fallback)
# =========================================================
@app.route("/api/address-to-latlng")
def address_to_latlng():
    """Forward geocode: address text → lat/lng."""
    try:
        address = request.args.get("address", "")
        if not address:
            return jsonify({"error": "Missing address"}), 400

        # --- Google Geocoding API (primary) ---
        if GOOGLE_PLACES_API_KEY:
            try:
                g_resp = requests.get(
                    "https://maps.googleapis.com/maps/api/geocode/json",
                    params={
                        "address": address + ", Singapore",
                        "key": GOOGLE_PLACES_API_KEY,
                        "region": "sg"
                    },
                    timeout=8
                )
                g_data = g_resp.json()
                g_results = g_data.get("results", [])

                if g_results:
                    loc = g_results[0]["geometry"]["location"]
                    return jsonify({
                        "lat": loc["lat"],
                        "lng": loc["lng"],
                        "display": g_results[0].get("formatted_address", address),
                        "source": "google"
                    })
            except Exception:
                pass

        # --- Fallback: Nominatim ---
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": address + " Singapore", "format": "json", "limit": 1},
            headers={"User-Agent": "NinjaCoPilot/1.0"},
            timeout=8
        )
        results = resp.json()

        if not results:
            return jsonify({"error": "Address not found", "lat": None, "lng": None})

        return jsonify({
            "lat": float(results[0]["lat"]),
            "lng": float(results[0]["lon"]),
            "display": results[0].get("display_name", ""),
            "source": "nominatim"
        })

    except Exception as e:
        return jsonify({"error": str(e), "lat": None, "lng": None})


# =========================================================
# POI / BUSINESS SEARCH (Google Places primary)
# =========================================================
@app.route("/api/poi-search")
@app.route("/api/onemap-search")  # backward compat alias
def poi_search():
    """Search for businesses/POIs near driver using Google Places."""
    try:
        query = request.args.get("q", "")
        lat = request.args.get("lat")
        lng = request.args.get("lng")
        limit = int(request.args.get("limit", 5))

        if not query:
            return jsonify({"error": "Missing query", "results": []})

        # --------------------------------------------------
        # Google Places Text Search (New API)
        # --------------------------------------------------
        if GOOGLE_PLACES_API_KEY:
            try:
                body = {
                    "textQuery": query + " Singapore",
                    "maxResultCount": limit
                }

                # Bias results near driver's GPS
                if lat and lng:
                    body["locationBias"] = {
                        "circle": {
                            "center": {
                                "latitude": float(lat),
                                "longitude": float(lng)
                            },
                            "radius": 10000.0
                        }
                    }

                gp_resp = requests.post(
                    "https://places.googleapis.com/v1/places:searchText",
                    headers={
                        "Content-Type": "application/json",
                        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
                        "X-Goog-FieldMask": (
                            "places.displayName,"
                            "places.formattedAddress,"
                            "places.location,"
                            "places.shortFormattedAddress,"
                            "places.googleMapsUri"
                        )
                    },
                    json=body,
                    timeout=8
                )
                gp_data = gp_resp.json()
                gp_places = gp_data.get("places", [])

                if gp_places:
                    results = []
                    for p in gp_places[:limit]:
                        ploc = p.get("location", {})
                        plat = ploc.get("latitude", 0)
                        plng = ploc.get("longitude", 0)

                        dist_m = None
                        if lat and lng and plat and plng:
                            dist_m = _haversine(
                                float(lat), float(lng), plat, plng
                            )

                        display_name = ""
                        dn = p.get("displayName")
                        if isinstance(dn, dict):
                            display_name = dn.get("text", "")
                        elif isinstance(dn, str):
                            display_name = dn

                        results.append({
                            "address": p.get("formattedAddress", ""),
                            "building": display_name,
                            "postal": "",
                            "lat": plat,
                            "lng": plng,
                            "search_val": query,
                            "distance_m": dist_m,
                            "source": "google_places",
                            "maps_url": p.get("googleMapsUri", "")
                        })

                    return jsonify({
                        "results": results,
                        "total": len(results),
                        "query": query,
                        "source": "google_places"
                    })
            except Exception:
                pass  # Fall through to Nominatim

        # --------------------------------------------------
        # Fallback: Nominatim search (free, no API key)
        # --------------------------------------------------
        try:
            nom_q = query + " Singapore" if "singapore" not in query.lower() else query
            nom_resp = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": nom_q, "format": "json", "limit": limit, "addressdetails": 1},
                headers={"User-Agent": "NinjaCoPilot/1.0"},
                timeout=8
            )
            nom_results = nom_resp.json()

            if nom_results:
                results = []
                for r in nom_results[:limit]:
                    rlat = float(r.get("lat", 0))
                    rlng = float(r.get("lon", 0))

                    dist_m = None
                    if lat and lng and rlat and rlng:
                        dist_m = _haversine(float(lat), float(lng), rlat, rlng)

                    results.append({
                        "address": r.get("display_name", ""),
                        "building": r.get("name", query),
                        "postal": "",
                        "lat": rlat,
                        "lng": rlng,
                        "search_val": query,
                        "distance_m": dist_m,
                        "source": "nominatim"
                    })

                if lat and lng:
                    results.sort(key=lambda x: x.get("distance_m") or 999999)

                return jsonify({
                    "results": results,
                    "total": len(results),
                    "query": query,
                    "source": "nominatim"
                })
        except Exception:
            pass

        return jsonify({"results": [], "total": 0, "query": query})

    except Exception as e:
        return jsonify({"error": str(e), "results": []})


def _haversine(lat1, lng1, lat2, lng2):
    """Calculate distance in meters between two GPS points."""
    import math
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = (math.sin(dphi / 2) ** 2 +
         math.cos(phi1) * math.cos(phi2) *
         math.sin(dlam / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c)


# =========================================================
# ROUTE
# =========================================================
@app.route("/api/route")
def route():
    """Get turn-by-turn driving directions using OSRM."""
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

        resp = requests.get(url, timeout=12)
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
            "summary": f"{total_dist}m, ~{total_time // 60} min",
            "geometry": geometry
        })

    except Exception as e:
        return jsonify({
            "error": str(e),
            "steps": []
        })


def build_instruction(m_type, modifier, name, distance):
    """Convert OSRM maneuver into spoken direction."""
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
    """Check weather at destination lat/lng using WeatherAPI."""
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
            "temp_c": data.get("current", {}).get("temp_c"),
            "raw": data
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
# OCR / VISION SCAN
# =========================================================
@app.route("/api/scan", methods=["POST"])
def scan():
    try:
        data = request.json or {}
        system = data.get("system", "")
        image_base64 = data.get("image_base64", "")
        ocr_prompt = data.get("ocr_prompt", "Extract address from this label.")

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
    """Transcribe audio using OpenAI Whisper."""
    try:
        import base64
        import tempfile

        data = request.json or {}
        audio_base64 = data.get("audio_base64", "")
        language = data.get("language", "en")

        if not audio_base64:
            return jsonify({"error": "No audio", "text": ""})

        audio_bytes = base64.b64decode(audio_base64)

        if OPENAI_API_KEY:
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
                    "ja-JP": "ja"
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
                else:
                    return jsonify({
                        "error": result.get("error", {}).get("message", "Whisper error"),
                        "text": ""
                    })

            except Exception as e:
                try:
                    os.unlink(temp_path)
                except Exception:
                    pass
                return jsonify({"error": str(e), "text": ""})

        return jsonify({
            "error": "Set OPENAI_API_KEY for voice in Chrome. Or use Safari browser.",
            "text": ""
        })

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


def call_openai(system, messages):
    if not OPENAI_API_KEY:
        raise Exception("OPENAI_API_KEY is missing")

    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENAI_API_KEY}"
        },
        json={
            "model": "gpt-4o",
            "max_tokens": 300,
            "messages": [{"role": "system", "content": system}] + messages
        },
        timeout=30
    )
    data = resp.json()

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
            "Authorization": f"Bearer {OPENAI_API_KEY}"
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
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}"
                            }
                        },
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ]
                }
            ]
        },
        timeout=30
    )
    data = resp.json()

    if "error" in data:
        raise Exception(data["error"].get("message", "OpenAI error"))

    return data["choices"][0]["message"]["content"]


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
