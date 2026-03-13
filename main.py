from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
import re
from typing import List, Optional, Any

import httpx

try:
    import anthropic
except Exception:
    anthropic = None


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()

SYSTEM_PROMPT = """You are a seasoned Ninja Van Senior Driver with 10+ years of last-mile delivery experience across Southeast Asia. You talk like a real senior driver — casual, confident, street-smart. You are the driver's trusted buddy riding shotgun, not a corporate bot.

Your expertise:
- Finding difficult addresses using landmarks, delivery notes, NLP tricks
- Smart route re-sequencing when traffic hits or stops are skipped
- Handling absent, angry, or difficult customers professionally
- Incident reporting: damaged parcels, failed deliveries, road accidents
- Ninja Van SOPs and escalation procedures

GPS & NAVIGATION:
- If the driver's message contains [DRIVER_GPS: lat,lng], you know their exact location
- When a driver mentions a delivery address or says they are lost, extract the destination address

When given an IMAGE:
- ADDRESS/building/street sign → give navigation guidance
- DAMAGED PARCEL → guide through incident reporting
- MAP/ROUTE → suggest best sequence
- CUSTOMER NOTE → interpret and advise

CRITICAL LANGUAGE RULE:
- ALWAYS reply in EXACTLY the same language the driver used
- If Malay → reply Malay. Chinese → reply Chinese. Thai → reply Thai. Tamil → reply Tamil. Etc.
- Never switch languages unless the driver switches first
- Be casual and natural like a local coworker

IMPORTANT RESPONSE FORMAT:
- Do NOT use emojis
- Plain text only, no markdown
- SHORT and ACTIONABLE — max 3 steps
- Encouraging tone

SPECIAL TAGS (add on new line when relevant):
- If driver needs navigation: [NAVIGATE_TO: full address]
- If driver wants to see location: [SHOW_MY_LOCATION]
"""


class ChatRequest(BaseModel):
    messages: List[dict]


@app.get("/")
async def root():
    # your frontend file should still be static/index.html
    return FileResponse("static/index.html")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "anthropic_configured": bool(ANTHROPIC_API_KEY),
        "openai_configured": bool(OPENAI_API_KEY),
    }


# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------
def extract_text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
        return "\n".join(p for p in parts if p).strip()

    return ""


def detect_language(text: str) -> str:
    t = (text or "").strip()

    if not t:
        return "en"

    # Chinese
    if re.search(r"[\u4e00-\u9fff]", t):
        return "zh"

    # Japanese
    if re.search(r"[\u3040-\u30ff]", t):
        return "ja"

    # Korean
    if re.search(r"[\uac00-\ud7af]", t):
        return "ko"

    # Thai
    if re.search(r"[\u0e00-\u0e7f]", t):
        return "th"

    # Tamil
    if re.search(r"[\u0b80-\u0bff]", t):
        return "ta"

    # Vietnamese
    if re.search(r"[ăâđêôơưĂÂĐÊÔƠƯàáạảãầấậẩẫằắặẳẵèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]", t):
        return "vi"

    low = t.lower()

    # Malay
    if re.search(r"\b(saya|awak|anda|tak|tidak|boleh|jalan|alamat|parcel|bungkusan|hujan|hantar|dekat)\b", low):
        return "ms"

    # Indonesian
    if re.search(r"\b(saya|kamu|anda|tidak|bisa|jalan|alamat|paket|kirim|dekat|macet)\b", low):
        return "id"

    # Filipino
    if re.search(r"\b(ako|ikaw|saan|hindi|pwede|pakete|malapit|salamat)\b", low):
        return "fil"

    return "en"


def fallback_reply(user_text: str) -> str:
    lang = detect_language(user_text)
    low = user_text.lower()

    wants_location = any(
        x in low for x in [
            "where am i", "show my location", "my location", "where i am",
            "我在哪里", "我的位置", "我在哪", "lokasi saya", "di mana saya",
            "saya dekat mana", "ฉันอยู่ไหน", "我喺邊", "எங்கே இருக்கிறேன்"
        ]
    )

    wants_navigation = any(
        x in low for x in [
            "go to", "navigate to", "show map", "route to", "bring me to",
            "带我去", "导航到", "去", "怎么去",
            "pergi ke", "jalan ke", "navigate",
            "ไป", "นำทาง", "เส้นทาง",
            "đi đến", "chỉ đường",
            "案内", "行きたい",
            "길 안내", "이동"
        ]
    )

    address_guess = extract_destination(user_text)

    if lang == "zh":
        if wants_location:
            return "这是你现在的位置。我帮你开地图。 [SHOW_MY_LOCATION]"
        if wants_navigation and address_guess:
            return f"收到，我帮你导航过去。先看地图再走。 [NAVIGATE_TO: {address_guess}]"
        if "hello" in low or "hi" in low or "你好" in user_text:
            return "收到，我在。你可以直接说地址、拍标签，或问我现在在哪里。"
        return "我收到你的信息了。你可以直接说目的地、问路线，或者拍照给我看。"

    if lang == "ms":
        if wants_location:
            return "Ini lokasi anda sekarang. Saya buka peta untuk anda. [SHOW_MY_LOCATION]"
        if wants_navigation and address_guess:
            return f"Baik, saya bantu navigasi ke sana. [NAVIGATE_TO: {address_guess}]"
        return "Saya terima mesej anda. Boleh beri alamat penuh, tanya arah, atau ambil gambar label."

    if lang == "id":
        if wants_location:
            return "Ini lokasi Anda sekarang. Saya buka peta. [SHOW_MY_LOCATION]"
        if wants_navigation and address_guess:
            return f"Baik, saya bantu navigasi ke sana. [NAVIGATE_TO: {address_guess}]"
        return "Pesan Anda sudah masuk. Silakan kirim alamat lengkap, tanya rute, atau foto label."

    if lang == "th":
        if wants_location:
            return "นี่คือตำแหน่งของคุณตอนนี้ ผมจะเปิดแผนที่ให้ [SHOW_MY_LOCATION]"
        if wants_navigation and address_guess:
            return f"โอเค ผมจะช่วยนำทางไปที่นี่ [NAVIGATE_TO: {address_guess}]"
        return "ผมได้รับข้อความแล้ว คุณส่งที่อยู่ ถามเส้นทาง หรือถ่ายรูปฉลากมาได้เลย"

    if lang == "vi":
        if wants_location:
            return "Đây là vị trí hiện tại của bạn. Tôi sẽ mở bản đồ. [SHOW_MY_LOCATION]"
        if wants_navigation and address_guess:
            return f"Được, tôi sẽ dẫn đường tới đó. [NAVIGATE_TO: {address_guess}]"
        return "Tôi đã nhận tin nhắn. Bạn có thể gửi địa chỉ, hỏi đường hoặc chụp nhãn kiện hàng."

    if lang == "ja":
        if wants_location:
            return "今の場所です。地図を開きます。 [SHOW_MY_LOCATION]"
        if wants_navigation and address_guess:
            return f"了解です。そこまで案内します。 [NAVIGATE_TO: {address_guess}]"
        return "メッセージを受け取りました。住所、ルート、またはラベル写真を送ってください。"

    if lang == "ko":
        if wants_location:
            return "현재 위치입니다. 지도를 열어드릴게요. [SHOW_MY_LOCATION]"
        if wants_navigation and address_guess:
            return f"좋아요. 그곳으로 안내할게요. [NAVIGATE_TO: {address_guess}]"
        return "메시지 받았습니다. 주소를 보내거나 길을 물어보거나 라벨 사진을 찍어주세요."

    if lang == "ta":
        if wants_location:
            return "இது உங்கள் தற்போதைய இடம். நான் வரைபடத்தை திறக்கிறேன். [SHOW_MY_LOCATION]"
        if wants_navigation and address_guess:
            return f"சரி, நான் அந்த இடத்துக்கு வழிகாட்டுகிறேன். [NAVIGATE_TO: {address_guess}]"
        return "உங்கள் செய்தி வந்துவிட்டது. முகவரி, வழி, அல்லது லேபல் படம் அனுப்பலாம்."

    # English
    if wants_location:
        return "This is your current location. I’ll open the map. [SHOW_MY_LOCATION]"
    if wants_navigation and address_guess:
        return f"Got it. I’ll guide you there. [NAVIGATE_TO: {address_guess}]"
    if "hello" in low or "hi" in low:
        return "I’m here. Send the address, ask for route help, or snap a parcel label."
    return "Message received. Send the address, ask for route help, or take a photo of the label."


def extract_destination(text: str) -> Optional[str]:
    if not text:
        return None

    patterns = [
        r"(?:go to|navigate to|route to|bring me to)\s+(.+)",
        r"(?:带我去|导航到|去)\s*(.+)",
        r"(?:pergi ke|jalan ke)\s+(.+)",
        r"(?:đi đến)\s+(.+)",
        r"(?:案内して|行きたい)\s*(.+)",
        r"(?:가자|이동|길 안내)\s*(.+)",
    ]

    for p in patterns:
        m = re.search(p, text, flags=re.IGNORECASE)
        if m:
            dest = m.group(1).strip()
            dest = re.sub(r"\[DRIVER_GPS:.*?\]", "", dest).strip()
            if dest:
                return dest

    return None


def parse_special_tags(full_text: str) -> dict:
    reply_text = full_text or ""
    dest_address = None
    show_my_location = False

    nav_match = re.search(r"\[NAVIGATE_TO:\s*(.*?)\]", reply_text, flags=re.IGNORECASE | re.DOTALL)
    if nav_match:
        dest_address = nav_match.group(1).strip()
        reply_text = re.sub(r"\[NAVIGATE_TO:\s*.*?\]", "", reply_text, flags=re.IGNORECASE | re.DOTALL).strip()

    if re.search(r"\[SHOW_MY_LOCATION\]", reply_text, flags=re.IGNORECASE):
        show_my_location = True
        reply_text = re.sub(r"\[SHOW_MY_LOCATION\]", "", reply_text, flags=re.IGNORECASE).strip()

    return {
        "reply": reply_text.strip() or "OK",
        "dest_address": dest_address,
        "show_my_location": show_my_location,
    }


async def call_claude(messages: List[dict]) -> str:
    if not ANTHROPIC_API_KEY or anthropic is None:
        raise RuntimeError("Claude not configured")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=400,
        system=SYSTEM_PROMPT,
        messages=messages,
    )

    parts = []
    for block in response.content:
        if hasattr(block, "text"):
            parts.append(block.text)

    return "\n".join(parts).strip()


async def call_openai_text(messages: List[dict]) -> str:
    if not OPENAI_API_KEY:
        raise RuntimeError("OpenAI not configured")

    converted_messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")

        if isinstance(content, str):
            converted_messages.append({"role": role, "content": content})
        elif isinstance(content, list):
            text_parts = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    text_parts.append(item.get("text", ""))
            converted_messages.append({"role": role, "content": "\n".join(text_parts).strip()})

    async with httpx.AsyncClient(timeout=35) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={
                "model": "gpt-4o-mini",
                "messages": converted_messages,
                "max_tokens": 300,
            },
        )
        data = resp.json()

    if resp.status_code >= 400:
        raise RuntimeError(str(data))

    return data["choices"][0]["message"]["content"].strip()


# ---------------------------------------------------------
# Transcribe
# ---------------------------------------------------------
@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """
    Uses OpenAI Whisper if OPENAI_API_KEY exists.
    If not, frontend falls back to Web Speech API.
    """
    if not OPENAI_API_KEY:
        return {"transcript": "", "language": "en", "fallback": True}

    try:
        audio_data = await audio.read()

        async with httpx.AsyncClient(timeout=40) as client:
            response = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                files={
                    "file": (
                        audio.filename or "audio.webm",
                        audio_data,
                        audio.content_type or "audio/webm"
                    )
                },
                data={
                    "model": "whisper-1",
                    "response_format": "verbose_json"
                }
            )

        result = response.json()

        if response.status_code >= 400:
            return {
                "transcript": "",
                "language": "en",
                "fallback": True,
                "error": str(result),
            }

        return {
            "transcript": result.get("text", ""),
            "language": result.get("language", "en"),
            "fallback": False
        }

    except Exception as e:
        return {
            "transcript": "",
            "language": "en",
            "fallback": True,
            "error": str(e)
        }


# ---------------------------------------------------------
# Chat
# ---------------------------------------------------------
@app.post("/chat")
async def chat(request: ChatRequest):
    user_text = ""
    if request.messages:
        user_text = extract_text_from_content(request.messages[-1].get("content", ""))

    # 1. Try Claude
    if ANTHROPIC_API_KEY:
        try:
            full_text = await call_claude(request.messages)
            return parse_special_tags(full_text)
        except Exception:
            pass

    # 2. Try OpenAI text fallback
    if OPENAI_API_KEY:
        try:
            full_text = await call_openai_text(request.messages)
            return parse_special_tags(full_text)
        except Exception:
            pass

    # 3. Safe local fallback so app never says "No response"
    full_text = fallback_reply(user_text)
    return parse_special_tags(full_text)


# Serve static files
app.mount("/", StaticFiles(directory="static", html=True), name="static")
