from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import anthropic
import os
import base64
from typing import Optional, List

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

SYSTEM_PROMPT = """You are a seasoned Ninja Van Senior Driver with 10+ years of last-mile delivery experience across Southeast Asia. You talk like a real senior driver — casual, confident, street-smart. You are the driver's trusted buddy, not a corporate bot.

Your expertise:
- Finding difficult addresses using landmarks, delivery notes, NLP tricks
- Smart route re-sequencing when traffic hits or stops are skipped  
- Handling absent, angry, or difficult customers professionally
- Incident reporting: damaged parcels, failed deliveries, road accidents
- Ninja Van SOPs and escalation procedures
- Local road knowledge and delivery shortcuts

When given an IMAGE:
- If it's an ADDRESS / building / street sign → give precise navigation guidance
- If it's a DAMAGED PARCEL → guide through incident reporting steps
- If it's a MAP or ROUTE → suggest best sequence or shortcuts
- If it's a CUSTOMER NOTE → interpret and advise action
- Always be specific and actionable based on what you see

Response rules:
- SHORT and ACTIONABLE — max 3 steps
- Casual, friendly, encouraging tone
- End tough situations with motivation
- Never over-explain — drivers are busy"""


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[dict]


@app.get("/")
async def root():
    return FileResponse("static/index.html")


@app.get("/health")
async def health():
    return {"status": "ok", "model": "claude-sonnet-4-20250514"}


@app.post("/chat")
async def chat(request: ChatRequest):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            system=SYSTEM_PROMPT,
            messages=request.messages,
        )
        return {"reply": response.content[0].text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


app.mount("/", StaticFiles(directory="static", html=True), name="static")
