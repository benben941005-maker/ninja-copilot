import { useState, useEffect, useRef, useCallback } from "react";

// ─── Config ───
const NINJA_RED = "#E31837";
const NINJA_DARK = "#0D0D1A";
const MAX_IMG_DIM = 800;
const MAX_IMG_BYTES = 4 * 1024 * 1024; // 4MB safety margin under 5MB limit

// ─── AGGRESSIVE Image Compressor — guarantees under 4MB ───
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        // Step 1: Scale down dimensions
        if (w > MAX_IMG_DIM || h > MAX_IMG_DIM) {
          const r = Math.min(MAX_IMG_DIM / w, MAX_IMG_DIM / h);
          w = Math.round(w * r);
          h = Math.round(h * r);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);

        // Step 2: Decrease quality until under 4MB
        let quality = 0.8;
        let base64 = canvas.toDataURL("image/jpeg", quality);
        while (base64.length * 0.75 > MAX_IMG_BYTES && quality > 0.2) {
          quality -= 0.1;
          base64 = canvas.toDataURL("image/jpeg", quality);
        }
        // Step 3: If STILL too big, shrink dimensions further
        if (base64.length * 0.75 > MAX_IMG_BYTES) {
          canvas.width = Math.round(w * 0.5);
          canvas.height = Math.round(h * 0.5);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          base64 = canvas.toDataURL("image/jpeg", 0.5);
        }

        const sizeKB = Math.round((base64.length * 3) / 4 / 1024);
        resolve({
          base64Data: base64.split(",")[1],
          preview: base64,
          w: canvas.width,
          h: canvas.height,
          sizeKB,
          quality: Math.round(quality * 100),
        });
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ─── System Prompt: SHORT + STRUCTURED + NO SLANG ───
const SYSTEM_PROMPT = `You are Ninja Co-Pilot, an AI assistant for delivery drivers.

STRICT RULES:
1. ALL replies must be under 60 words. Maximum 3 bullet points.
2. Professional tone only. NEVER use: "bro", "hey", "dude", "mate", slang, or casual greetings.
3. Start with the action or answer directly. No greetings, no filler.
4. Use this format:
   • Action: [what to do immediately]
   • Reason: [one sentence why, if needed]
5. For issues, give solution first, explanation second.
6. Auto-detect any language on labels without asking.

EXAMPLE good reply:
• Action: Leave parcel at door, take photo as proof.
• Note: Mark as "safe location" in the app.

EXAMPLE bad reply (NEVER do this):
"Hey bro! So what you wanna do is..."`;

// ─── OCR Prompt ───
const OCR_PROMPT = `Extract delivery address from this package label.
Auto-detect the language (English, Chinese, Malay, Tamil, Thai, Vietnamese, Bahasa, etc.).
Respond ONLY in JSON:
{"address":"full address","postal":"code or null","recipient":"name or null","sender":"sender or null","language":"auto-detected language","confidence":"high/medium/low"}`;

// ─── API Call ───
async function callAI(messages, system) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system,
      messages,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${data.error.type}: ${data.error.message}`);
  return data.content?.map((c) => c.text || "").join("") || "";
}

// ─── Voice ───
function useVoice() {
  const synth = useRef(null);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => { synth.current = window.speechSynthesis; }, []);
  const speak = useCallback((text) => {
    if (!synth.current) return;
    synth.current.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    synth.current.speak(u);
  }, []);
  const stop = useCallback(() => { synth.current?.cancel(); setSpeaking(false); }, []);
  return { speak, stop, speaking };
}

// ─── GPS ───
function useGPS() {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return pos;
}

// ─── Nav Steps ───
function makeNav(addr) {
  return [
    { icon: "🚀", text: `Starting: ${addr}`, dist: "" },
    { icon: "⬆️", text: "Head north 200m", dist: "200m" },
    { icon: "➡️", text: "Turn right at junction", dist: "150m" },
    { icon: "⬆️", text: "Straight 500m", dist: "500m" },
    { icon: "⬅️", text: "Turn left, main road", dist: "300m" },
    { icon: "➡️", text: "Turn right, delivery area", dist: "100m" },
    { icon: "📦", text: `Arrived: ${addr}`, dist: "✓" },
  ];
}

const CHIPS = [
  "Cannot find address", "No answer", "Traffic jam",
  "Damaged parcel", "Wrong address", "Gate locked"
];

// ─── Chat Bubble ───
function Bubble({ msg }) {
  const isU = msg.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isU ? "flex-end" : "flex-start", marginBottom: "8px" }}>
      {!isU && <div style={{
        width: "26px", height: "26px", borderRadius: "8px", background: NINJA_RED,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "13px", marginRight: "6px", flexShrink: 0, marginTop: "2px"
      }}>🥷</div>}
      <div style={{
        maxWidth: "78%", padding: "10px 13px", borderRadius: isU ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        background: isU ? NINJA_RED : "rgba(255,255,255,0.07)",
        color: "white", fontSize: "13.5px", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
        fontFamily: "'DM Sans', sans-serif"
      }}>
        {msg.image && <img src={msg.image} alt="" style={{ width: "100%", maxHeight: "120px", objectFit: "contain", borderRadius: "8px", marginBottom: "6px" }} />}
        {msg.text}
      </div>
    </div>
  );
}

// ─── Main ───
export default function App() {
  const [msgs, setMsgs] = useState([{ role: "assistant", text: "Ready. Scan a label or ask a question." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [addr, setAddr] = useState(null);
  const [nav, setNav] = useState([]);
  const [step, setStep] = useState(0);
  const [showNav, setShowNav] = useState(false);
  const [listening, setListening] = useState(false);
  const fileRef = useRef(null);
  const endRef = useRef(null);
  const recRef = useRef(null);
  const { speak, stop, speaking } = useVoice();
  const gps = useGPS();

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const addMsg = (msg) => setMsgs((p) => [...p, msg]);

  // ─── Send Text ───
  const send = async (text) => {
    if (!text.trim() || busy) return;
    addMsg({ role: "user", text: text.trim() });
    setInput("");
    setBusy(true);
    try {
      const reply = await callAI([{ role: "user", content: text.trim() }], SYSTEM_PROMPT);
      addMsg({ role: "assistant", text: reply });
      speak(reply.replace(/[•\-\*]/g, "").replace(/\n+/g, ". "));
    } catch (err) {
      addMsg({ role: "assistant", text: `Error: ${err.message}` });
    }
    setBusy(false);
  };

  // ─── Scan ───
  const scan = async (e) => {
    const file = e.target.files?.[0];
    if (!file || busy) return;
    setBusy(true);
    try {
      const img = await compressImage(file);
      addMsg({ role: "user", text: `📷 Scanned (${img.w}×${img.h}, ${img.sizeKB}KB)`, image: img.preview });

      const reply = await callAI([{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.base64Data } },
          { type: "text", text: OCR_PROMPT }
        ]
      }], SYSTEM_PROMPT);

      let parsed;
      try { parsed = JSON.parse(reply.replace(/```json|```/g, "").trim()); } catch { parsed = null; }

      if (parsed?.address) {
        const out = [
          `📍 ${parsed.address}`,
          parsed.postal ? `📮 Postal: ${parsed.postal}` : null,
          parsed.recipient ? `👤 ${parsed.recipient}` : null,
          `🌐 ${parsed.language} (auto-detected)`,
        ].filter(Boolean).join("\n");
        addMsg({ role: "assistant", text: out });
        setAddr(parsed.address + (parsed.postal ? ` ${parsed.postal}` : ""));
        setNav(makeNav(parsed.address));
        setStep(0);
        speak(`Address: ${parsed.address}. Tap navigate to start.`);
      } else {
        addMsg({ role: "assistant", text: reply });
      }
    } catch (err) {
      addMsg({ role: "assistant", text: `Error: ${err.message}` });
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  // ─── Voice Input ───
  const toggleListen = () => {
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => { setInput(e.results[0][0].transcript); setListening(false); };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recRef.current = r;
    r.start();
    setListening(true);
  };

  const goStep = (n) => { setStep(n); speak(nav[n].text); };

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      background: NINJA_DARK, fontFamily: "'DM Sans', sans-serif",
      maxWidth: "500px", margin: "0 auto"
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: NINJA_RED, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>🥷</div>
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: "13px" }}><span style={{ color: NINJA_RED }}>NINJA</span> CO-PILOT</div>
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "9px", letterSpacing: "1px" }}>AI SENIOR DRIVER ASSISTANT</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "10px", background: gps ? "rgba(76,175,80,0.1)" : "rgba(255,87,34,0.1)" }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: gps ? "#4CAF50" : "#FF5722", boxShadow: `0 0 4px ${gps ? "#4CAF50" : "#FF5722"}` }} />
          <span style={{ color: gps ? "#4CAF50" : "#FF5722", fontSize: "10px", fontWeight: 600 }}>{gps ? `GPS ±${Math.round(gps.acc)}m` : "GPS..."}</span>
        </div>
      </div>

      {/* Quick Chips */}
      <div style={{ display: "flex", gap: "5px", padding: "8px 14px", overflowX: "auto", flexShrink: 0 }}>
        {CHIPS.map((c) => (
          <button key={c} onClick={() => send(c)} style={{
            padding: "5px 10px", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.6)",
            fontSize: "11px", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "'DM Sans', sans-serif"
          }}>{c}</button>
        ))}
      </div>

      {/* Chat */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 10px 6px" }}>
        {msgs.map((m, i) => <Bubble key={i} msg={m} />)}
        {busy && <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "12px", padding: "6px 40px" }}>Processing...</div>}

        {addr && !showNav && (
          <div style={{ padding: "6px 0" }}>
            <button onClick={() => { setShowNav(true); setStep(0); speak(nav[0]?.text); }} style={{
              width: "100%", padding: "12px", borderRadius: "10px", border: "none",
              background: "linear-gradient(135deg, #4CAF50, #2E7D32)",
              color: "white", fontSize: "14px", fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif"
            }}>🗺️ Navigate to Address</button>
          </div>
        )}

        {showNav && nav.length > 0 && (
          <div style={{ padding: "4px 0" }}>
            <div style={{ borderRadius: "10px", overflow: "hidden", marginBottom: "8px", border: `2px solid ${NINJA_RED}` }}>
              <iframe src={`https://maps.google.com/maps?q=${encodeURIComponent(addr)}&z=16&output=embed`}
                width="100%" height="200" style={{ border: 0, display: "block" }} allowFullScreen loading="lazy" title="Map" />
            </div>
            <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: "10px", padding: "14px", border: `1px solid ${NINJA_RED}30` }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "10px", fontWeight: 600 }}>STEP {step + 1}/{nav.length}</span>
                <span style={{ color: NINJA_RED, fontSize: "10px", fontWeight: 600 }}>{nav[step].dist}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                <span style={{ fontSize: "24px" }}>{nav[step].icon}</span>
                <span style={{ color: "white", fontSize: "14px", fontWeight: 600 }}>{nav[step].text}</span>
              </div>
              <div style={{ height: "3px", background: "rgba(255,255,255,0.08)", borderRadius: "2px", marginBottom: "10px" }}>
                <div style={{ height: "100%", background: NINJA_RED, borderRadius: "2px", width: `${((step + 1) / nav.length) * 100}%`, transition: "width 0.3s" }} />
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button onClick={() => goStep(Math.max(0, step - 1))} disabled={step === 0}
                  style={{ flex: 1, padding: "9px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "white", fontWeight: 600, cursor: "pointer", opacity: step === 0 ? 0.3 : 1, fontSize: "12px", fontFamily: "'DM Sans', sans-serif" }}>←</button>
                <button onClick={() => speaking ? stop() : speak(nav[step].text)}
                  style={{ flex: 2, padding: "9px", borderRadius: "8px", border: "none", background: speaking ? "#ff6b6b" : NINJA_RED, color: "white", fontWeight: 600, cursor: "pointer", fontSize: "12px", fontFamily: "'DM Sans', sans-serif" }}>
                  {speaking ? "🔊 Stop" : "🔊 Speak"}</button>
                <button onClick={() => goStep(Math.min(nav.length - 1, step + 1))} disabled={step === nav.length - 1}
                  style={{ flex: 1, padding: "9px", borderRadius: "8px", border: "none", background: "white", color: NINJA_DARK, fontWeight: 600, cursor: "pointer", opacity: step === nav.length - 1 ? 0.3 : 1, fontSize: "12px", fontFamily: "'DM Sans', sans-serif" }}>→</button>
              </div>
            </div>
            <button onClick={() => setShowNav(false)} style={{
              width: "100%", marginTop: "6px", padding: "8px", borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.08)", background: "transparent",
              color: "rgba(255,255,255,0.4)", fontSize: "11px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif"
            }}>Close Nav</button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Speaking bar */}
      {speaking && (
        <div style={{ padding: "5px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(227,24,55,0.08)", borderTop: "1px solid rgba(227,24,55,0.15)" }}>
          <span style={{ color: NINJA_RED, fontSize: "11px", fontWeight: 600 }}>🔊 Speaking...</span>
          <button onClick={stop} style={{ padding: "3px 10px", borderRadius: "10px", border: `1px solid ${NINJA_RED}`, background: "transparent", color: NINJA_RED, fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>Stop</button>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "8px" }}>
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            placeholder="Type or speak in any language..."
            style={{ flex: 1, padding: "10px 12px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "white", fontSize: "13px", outline: "none", fontFamily: "'DM Sans', sans-serif" }} />
          <button onClick={() => send(input)} disabled={!input.trim() || busy} style={{
            width: "38px", height: "38px", borderRadius: "50%", border: "none",
            background: input.trim() ? NINJA_RED : "rgba(255,255,255,0.06)",
            color: "white", fontSize: "14px", cursor: "pointer", flexShrink: 0
          }}>▶</button>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button onClick={toggleListen} style={{
            flex: 2, padding: "12px", borderRadius: "10px", border: "none",
            background: listening ? "#ff4444" : NINJA_RED,
            color: "white", fontSize: "14px", fontWeight: 700, cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif"
          }}>🎙️ {listening ? "LISTENING..." : "TAP TO SPEAK"}</button>
          <button onClick={() => fileRef.current?.click()} style={{
            flex: 1, padding: "12px", borderRadius: "10px", border: "none",
            background: "rgba(255,255,255,0.06)", color: "white", cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif", display: "flex", flexDirection: "column", alignItems: "center", gap: "1px"
          }}>
            <span style={{ fontSize: "18px" }}>📷</span>
            <span style={{ fontSize: "9px", fontWeight: 600 }}>SCAN</span>
          </button>
          {addr && (
            <button onClick={() => { setShowNav(true); goStep(0); }} style={{
              flex: 1, padding: "12px", borderRadius: "10px", border: "none",
              background: "rgba(76,175,80,0.12)", color: "#4CAF50", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif", display: "flex", flexDirection: "column", alignItems: "center", gap: "1px"
            }}>
              <span style={{ fontSize: "18px" }}>🚗</span>
              <span style={{ fontSize: "9px", fontWeight: 600 }}>NAV</span>
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={scan} style={{ display: "none" }} />
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
        * { box-sizing: border-box; margin: 0; -webkit-tap-highlight-color: transparent; }
        body { margin: 0; }
        input::placeholder { color: rgba(255,255,255,0.25); }
      `}</style>
    </div>
  );
}
