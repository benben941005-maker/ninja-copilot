from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import anthropic
import os
from typing import List

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

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
- ALWAYS detect what language the driver is speaking and reply in EXACTLY that same language
- If they speak Malay, reply in Malay. Chinese, reply in Chinese. Thai, reply in Thai. Etc.
- Never switch languages unless the driver switches first
- Be natural and casual in their language like a local coworker

IMPORTANT RESPONSE FORMAT:
- Do NOT use emojis — they get read aloud by voice
- Plain text only, no markdown asterisks or symbols  
- SHORT and ACTIONABLE — max 3 steps
- Casual and encouraging tone

SPECIAL TAGS (add on new line when relevant):
- If driver needs navigation: [NAVIGATE_TO: full address]
- If driver wants to see location: [SHOW_MY_LOCATION]"""


class ChatRequest(BaseModel):
    messages: List[dict]


@app.get("/")
async def root():
    return FileResponse("static/index.html")


@app.get("/health")
async def health():
    return {"status": "ok"}


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

        return {
            "reply": reply_text,
            "dest_address": dest_address,
            "show_my_location": show_my_location
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


app.mount("/", StaticFiles(directory="static", html=True), name="static")
