from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from groq import Groq
import os
from typing import List, Union, Optional

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")

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
- If Malay → reply Malay. Chinese → reply Chinese. Thai → reply Thai. Tamil → reply Tamil. English → reply English.
- Never switch languages unless the driver switches first
- Be casual and natural like a local coworker

IMPORTANT RESPONSE FORMAT:
- Do NOT use emojis
- Plain text only
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
    return FileResponse("static/index.html")


@app.get("/health")
async def health():
    return {"status": "ok"}


def normalize_content_for_model(content: Union[str, list]) -> str:
    """
    Convert frontend message content into a single text string.
    Keeps image hints as text markers since this free version does not do true vision parsing.
    """
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts = []
        for item in content:
            item_type = item.get("type")

            if item_type == "text":
                parts.append(item.get("text", ""))

            elif item_type == "image":
                parts.append(
                    "[IMAGE ATTACHED: The driver sent an image. "
                    "If the user message mentions address, signboard, parcel damage, route, or note, "
                    "respond as helpfully as possible based on their text description.]"
                )

        return "\n".join(p for p in parts if p).strip()

    return str(content)


@app.post("/chat")
async def chat(request: ChatRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")

    client = Groq(api_key=GROQ_API_KEY)

    try:
        transformed_messages = []

        for msg in request.messages:
            role = msg.get("role", "user")
            content = normalize_content_for_model(msg.get("content", ""))

            # Map assistant role safely
            if role not in ["user", "assistant", "system"]:
                role = "user"

            transformed_messages.append({
                "role": role,
                "content": content
            })

        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                *transformed_messages
            ],
            temperature=0.3,
            max_tokens=300,
        )

        full_text = (response.choices[0].message.content or "").strip()

        dest_address = None
        show_my_location = False
        reply_text = full_text

        if "[NAVIGATE_TO:" in full_text:
            parts = full_text.split("[NAVIGATE_TO:", 1)
            reply_text = parts[0].strip()
            dest_address = parts[1].split("]", 1)[0].strip()

        if "[SHOW_MY_LOCATION]" in reply_text:
            reply_text = reply_text.replace("[SHOW_MY_LOCATION]", "").strip()
            show_my_location = True

        return {
            "reply": reply_text,
            "dest_address": dest_address,
            "show_my_location": show_my_location
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


app.mount("/", StaticFiles(directory="static", html=True), name="static")
