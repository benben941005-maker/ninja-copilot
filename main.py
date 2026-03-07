from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
import anthropic
import os
from typing import List
import io
import re

# Safe import of edge_tts
try:
    import edge_tts
    EDGE_TTS_AVAILABLE = True
    print("edge-tts loaded OK")
except ImportError:
    EDGE_TTS_AVAILABLE = False
    print("WARNING: edge-tts not available, TTS will be disabled")

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

VOICE_MAP = {
    "female": "en-US-AvaMultilingualNeural",
    "male":   "en-US-AndrewMultilingualNeural",
}

SYSTEM_PROMPT = """You are a seasoned Ninja Van Senior Driver with 10+ years of last-mile delivery experience across Southeast Asia. You talk like a real senior driver — casual, confident, street-smart. You are the driver's trusted buddy riding shotgun, not a corporate bot.

Your expertise:
- Finding difficult addresses using landmarks, delivery notes, NLP tricks
- Smart route re-sequencing when traffic hits or stops are skipped
- Handling absent, angry, or difficult customers professionally
- Incident reporting: damaged parcels, failed deliveries, road accidents
- Ninja Van SOPs and escalation procedures

GPS & NAVIGATION:
- If the driver's message contains [DRIVER_GPS: lat,lng], you know their exact location
- When a driver mentions a delivery address or says they are lost, extract the destination

When given an IMAGE:
- ADDRESS/building/street sign -> give navigation guidance
- DAMAGED PARCEL -> guide through incident reporting
- MAP/ROUTE -> suggest best sequence
- CUSTOMER NOTE -> interpret and advise

CRITICAL LANGUAGE RULE:
- ALWAYS reply in EXACTLY the same language the driver used
- If Malay reply Malay. Chinese reply Chinese. Thai reply Thai. Etc.
- Never switch languages unless the driver switches first
- Be casual and natural like a local coworker

IMPORTANT RESPONSE FORMAT:
- Do NOT use emojis - they get read aloud by voice
- Plain text only, no markdown symbols
- SHORT and ACTIONABLE - max 3 steps
- Encouraging tone

SPECIAL TAGS (add on new line when relevant):
- Navigation needed: [NAVIGATE_TO: full address]
- Show location: [SHOW_MY_LOCATION]"""


class ChatRequest(BaseModel):
    messages: List[dict]


class TTSRequest(BaseModel):
    text: str
    gender: str = "female"


def clean_text_for_tts(text: str) -> str:
    # Remove emojis and markdown
    clean = re.sub(r'[\U00010000-\U0010ffff]', '', text)
    clean = re.sub(r'[*_#\[\]]', '', clean)
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean


@app.get("/")
async def root():
    return FileResponse("static/index.html")


@app.get("/health")
async def health():
    return {"status": "ok", "edge_tts": EDGE_TTS_AVAILABLE}


@app.post("/tts")
async def tts(request: TTSRequest):
    if not EDGE_TTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="TTS not available")

    voice = VOICE_MAP.get(request.gender, VOICE_MAP["female"])
    clean = clean_text_for_tts(request.text)

    if not clean:
        raise HTTPException(status_code=400, detail="Empty text")

    try:
        communicate = edge_tts.Communicate(clean, voice)
        audio_buffer = io.BytesIO()

        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_buffer.write(chunk["data"])

        audio_buffer.seek(0)
        audio_data = audio_buffer.read()

        if not audio_data:
            raise HTTPException(status_code=500, detail="No audio generated")

        return Response(
            content=audio_data,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-cache"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if not openai_key:
        return {"transcript": "", "language": "en", "fallback": True}
    try:
        import httpx
        audio_data = await audio.read()
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {openai_key}"},
                files={"file": (audio.filename or "audio.webm", audio_data, audio.content_type or "audio/webm")},
                data={"model": "whisper-1", "response_format": "verbose_json"}
            )
            result = response.json()
            return {"transcript": result.get("text", ""), "language": result.get("language", "en"), "fallback": False}
    except Exception:
        return {"transcript": "", "language": "en", "fallback": True}


@app.post("/chat")
async def chat(request: ChatRequest):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=600,
            system=SYSTEM_PROMPT,
            messages=request.messages,
        )
        full_text = response.content[0].text
        dest_address = None
        show_my_location = False
        reply_text = full_text

        if "[NAVIGATE_TO:" in full_text:
            parts = full_text.split("[NAVIGATE_TO:")
            reply_text = parts[0].strip()
            dest_address = parts[1].split("]")[0].strip()

        if "[SHOW_MY_LOCATION]" in full_text:
            reply_text = full_text.replace("[SHOW_MY_LOCATION]", "").strip()
            show_my_location = True

        return {"reply": reply_text, "dest_address": dest_address, "show_my_location": show_my_location}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


app.mount("/", StaticFiles(directory="static", html=True), name="static")
