import os
import json
import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder="static")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
AI_PROVIDER = os.environ.get("AI_PROVIDER", "claude")


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory("static", path)


@app.route("/api/geocode")
def geocode():
    """Reverse geocode GPS coordinates to street address."""
    try:
        lat = request.args.get("lat")
        lng = request.args.get("lng")
        if not lat or not lng:
            return jsonify({"error": "Missing lat/lng"}), 400

        resp = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={
                "lat": lat, "lon": lng,
                "format": "json", "addressdetails": 1, "zoom": 18
            },
            headers={"User-Agent": "NinjaCoPilot/1.0"},
            timeout=5
        )
        data = resp.json()

        # Build readable address from components
        addr = data.get("address", {})
        parts = []
        # Road / street name
        road = addr.get("road") or addr.get("pedestrian") or addr.get("footway") or ""
        if road:
            house = addr.get("house_number", "")
            parts.append((house + " " + road).strip())
        # Neighborhood / suburb
        area = addr.get("suburb") or addr.get("neighbourhood") or addr.get("quarter") or ""
        if area:
            parts.append(area)
        # City
        city = addr.get("city") or addr.get("town") or addr.get("village") or ""
        if city:
            parts.append(city)
        # Postal code
        postcode = addr.get("postcode", "")
        if postcode:
            parts.append(postcode)

        address = ", ".join(parts) if parts else data.get("display_name", str(lat) + "," + str(lng))
        return jsonify({"address": address, "raw": addr})

    except Exception as e:
        return jsonify({"address": None, "error": str(e)})


@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        data = request.json
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
        data = request.json
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


def call_claude(system, messages):
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
    return "".join(b.get("text", "") for b in data.get("content", []))


def call_claude_vision(system, image_base64, prompt):
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
    return "".join(b.get("text", "") for b in data.get("content", []))


def call_openai(system, messages):
    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_API_KEY}"},
        json={"model": "gpt-4o", "max_tokens": 300, "messages": [{"role": "system", "content": system}] + messages},
        timeout=30
    )
    data = resp.json()
    if "error" in data:
        raise Exception(data["error"].get("message", "OpenAI error"))
    return data["choices"][0]["message"]["content"]


def call_openai_vision(system, image_base64, prompt):
    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_API_KEY}"},
        json={
            "model": "gpt-4o", "max_tokens": 300,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}},
                    {"type": "text", "text": prompt}
                ]}
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
