"""
Ninja Co-Pilot — Backend (Flask)
Serves static files + proxies AI API calls.
Deploy on Google Cloud Run.
"""

import os
import json
import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder="static")

# ─── API Keys (set in Cloud Run environment variables) ───
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

# Choose provider: "claude" or "openai"
AI_PROVIDER = os.environ.get("AI_PROVIDER", "claude")


# ═══════════════════════════════════════════════════════════
#  SERVE STATIC FILES
# ═══════════════════════════════════════════════════════════
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory("static", path)


# ═══════════════════════════════════════════════════════════
#  CHAT ENDPOINT (text only)
# ═══════════════════════════════════════════════════════════
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


# ═══════════════════════════════════════════════════════════
#  SCAN ENDPOINT (image + OCR)
# ═══════════════════════════════════════════════════════════
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


# ═══════════════════════════════════════════════════════════
#  CLAUDE API
# ═══════════════════════════════════════════════════════════
def call_claude(system, messages):
    """Call Claude API for text chat."""
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
        raise Exception(f"{data['error'].get('type', 'error')}: {data['error'].get('message', '')}")
    return "".join(block.get("text", "") for block in data.get("content", []))


def call_claude_vision(system, image_base64, prompt):
    """Call Claude API with image for OCR."""
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
        raise Exception(f"{data['error'].get('type', 'error')}: {data['error'].get('message', '')}")
    return "".join(block.get("text", "") for block in data.get("content", []))


# ═══════════════════════════════════════════════════════════
#  OPENAI API (alternative)
# ═══════════════════════════════════════════════════════════
def call_openai(system, messages):
    """Call OpenAI API for text chat."""
    oai_messages = [{"role": "system", "content": system}] + messages
    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENAI_API_KEY}"
        },
        json={
            "model": "gpt-4o",
            "max_tokens": 300,
            "messages": oai_messages
        },
        timeout=30
    )
    data = resp.json()
    if "error" in data:
        raise Exception(data["error"].get("message", "OpenAI error"))
    return data["choices"][0]["message"]["content"]


def call_openai_vision(system, image_base64, prompt):
    """Call OpenAI API with image for OCR."""
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


# ═══════════════════════════════════════════════════════════
#  RUN
# ═══════════════════════════════════════════════════════════
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
