// ═══════════════════════════════════════════════════════════
//  NINJA CO-PILOT — AI Driver Assistant (Vanilla JS)
//  No React, no build step. Works directly in browser.
// ═══════════════════════════════════════════════════════════

// ─── Config ───
const MAX_IMG_DIM = 800;
const MAX_IMG_BYTES = 4 * 1024 * 1024; // 4MB (under 5MB API limit)

// ─── State ───
let messages = [];
let busy = false;
let scannedAddr = null;
let navSteps = [];
let navStep = 0;
let showNav = false;
let isSpeaking = false;
let isListening = false;
let recognition = null;
let gpsPos = null;
let gpsWatchId = null;

// ─── DOM Elements ───
const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("text-input");
const sendBtn = document.getElementById("send-btn");
const voiceBtn = document.getElementById("voice-btn");
const speakingBar = document.getElementById("speaking-bar");
const gpsBadge = document.getElementById("gps-badge");
const navShortcut = document.getElementById("nav-shortcut");
const fileInput = document.getElementById("file-input");
const chipsEl = document.getElementById("chips");

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

const OCR_PROMPT = `Extract delivery address from this package label.
Auto-detect the language (English, Chinese, Malay, Tamil, Thai, Vietnamese, Bahasa, etc.).
Respond ONLY in JSON:
{"address":"full address","postal":"code or null","recipient":"name or null","sender":"sender or null","language":"auto-detected language","confidence":"high/medium/low"}`;

// ─── Quick Action Chips ───
const CHIPS = [
    "Cannot find address", "No answer", "Traffic jam",
    "Damaged parcel", "Wrong address", "Gate locked"
];

// ═══════════════════════════════════════════════════════════
//  IMAGE COMPRESSION — Guarantees under 4MB
// ═══════════════════════════════════════════════════════════
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                let w = img.width, h = img.height;

                // Step 1: Scale down to max dimension
                if (w > MAX_IMG_DIM || h > MAX_IMG_DIM) {
                    const r = Math.min(MAX_IMG_DIM / w, MAX_IMG_DIM / h);
                    w = Math.round(w * r);
                    h = Math.round(h * r);
                }

                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                canvas.getContext("2d").drawImage(img, 0, 0, w, h);

                // Step 2: Reduce quality until under 4MB
                let quality = 0.8;
                let base64 = canvas.toDataURL("image/jpeg", quality);
                while (base64.length * 0.75 > MAX_IMG_BYTES && quality > 0.2) {
                    quality -= 0.1;
                    base64 = canvas.toDataURL("image/jpeg", quality);
                }

                // Step 3: If still too big, shrink dimensions more
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
                    sizeKB: sizeKB,
                    quality: Math.round(quality * 100)
                });
            };
            img.onerror = function () { reject(new Error("Failed to load image")); };
            img.src = e.target.result;
        };
        reader.onerror = function () { reject(new Error("Failed to read file")); };
        reader.readAsDataURL(file);
    });
}

// ═══════════════════════════════════════════════════════════
//  API CALL (Claude)
// ═══════════════════════════════════════════════════════════
async function callAPI(msgs, system) {
    const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: system, messages: msgs })
    });
    const data = await res.json();
    if (data.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
    return data.reply || data.content || "";
}

// ═══════════════════════════════════════════════════════════
//  VOICE — Text-to-Speech
// ═══════════════════════════════════════════════════════════
function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.onstart = function () { isSpeaking = true; speakingBar.style.display = "flex"; };
    u.onend = function () { isSpeaking = false; speakingBar.style.display = "none"; };
    window.speechSynthesis.speak(u);
}

function stopSpeak() {
    window.speechSynthesis && window.speechSynthesis.cancel();
    isSpeaking = false;
    speakingBar.style.display = "none";
}

// ═══════════════════════════════════════════════════════════
//  VOICE — Speech-to-Text (auto language detect)
// ═══════════════════════════════════════════════════════════
function toggleListen() {
    if (isListening) {
        recognition && recognition.stop();
        isListening = false;
        voiceBtn.textContent = "🎙️ TAP TO SPEAK";
        voiceBtn.classList.remove("listening");
        return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition not supported in this browser"); return; }

    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    // Empty string = browser auto-detects language
    recognition.lang = "";

    recognition.onresult = function (e) {
        inputEl.value = e.results[0][0].transcript;
        isListening = false;
        voiceBtn.textContent = "🎙️ TAP TO SPEAK";
        voiceBtn.classList.remove("listening");
    };
    recognition.onerror = function () {
        isListening = false;
        voiceBtn.textContent = "🎙️ TAP TO SPEAK";
        voiceBtn.classList.remove("listening");
    };
    recognition.onend = function () {
        isListening = false;
        voiceBtn.textContent = "🎙️ TAP TO SPEAK";
        voiceBtn.classList.remove("listening");
    };

    recognition.start();
    isListening = true;
    voiceBtn.textContent = "🎙️ LISTENING...";
    voiceBtn.classList.add("listening");
}

// ═══════════════════════════════════════════════════════════
//  GPS
// ═══════════════════════════════════════════════════════════
function initGPS() {
    if (!navigator.geolocation) {
        gpsBadge.innerHTML = '<div class="gps-dot" style="background:#FF5722;box-shadow:0 0 4px #FF5722"></div><span style="color:#FF5722">No GPS</span>';
        gpsBadge.style.background = "rgba(255,87,34,0.1)";
        return;
    }
    gpsWatchId = navigator.geolocation.watchPosition(
        function (p) {
            gpsPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
            gpsBadge.innerHTML = '<div class="gps-dot" style="background:#4CAF50;box-shadow:0 0 4px #4CAF50"></div><span style="color:#4CAF50">GPS ±' + Math.round(gpsPos.acc) + 'm</span>';
            gpsBadge.style.background = "rgba(76,175,80,0.1)";
        },
        function () {
            gpsBadge.innerHTML = '<div class="gps-dot" style="background:#FF5722;box-shadow:0 0 4px #FF5722"></div><span style="color:#FF5722">GPS...</span>';
            gpsBadge.style.background = "rgba(255,87,34,0.1)";
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
}

// ═══════════════════════════════════════════════════════════
//  NAVIGATION STEPS
// ═══════════════════════════════════════════════════════════
function makeNavSteps(addr) {
    return [
        { icon: "🚀", text: "Starting: " + addr, dist: "" },
        { icon: "⬆️", text: "Head north 200m", dist: "200m" },
        { icon: "➡️", text: "Turn right at junction", dist: "150m" },
        { icon: "⬆️", text: "Straight 500m", dist: "500m" },
        { icon: "⬅️", text: "Turn left, main road", dist: "300m" },
        { icon: "➡️", text: "Turn right, delivery area", dist: "100m" },
        { icon: "📦", text: "Arrived: " + addr, dist: "✓" }
    ];
}

// ═══════════════════════════════════════════════════════════
//  RENDER FUNCTIONS
// ═══════════════════════════════════════════════════════════
function renderChips() {
    chipsEl.innerHTML = CHIPS.map(function (c) {
        return '<button class="chip" onclick="sendText(\'' + c.replace(/'/g, "\\'") + '\')">' + c + '</button>';
    }).join("");
}

function addBubble(role, text, imageUrl) {
    messages.push({ role: role, text: text, image: imageUrl || null });

    const row = document.createElement("div");
    row.className = "msg-row " + role;

    let html = "";
    if (role === "assistant") {
        html += '<div class="msg-avatar">🥷</div>';
    }
    html += '<div class="msg-bubble ' + role + '">';
    if (imageUrl) {
        html += '<img src="' + imageUrl + '" alt="scan">';
    }
    html += escapeHtml(text);
    html += '</div>';

    row.innerHTML = html;
    chatEl.appendChild(row);
    chatEl.scrollTop = chatEl.scrollHeight;
}

function showProcessing() {
    const el = document.createElement("div");
    el.id = "processing";
    el.className = "processing";
    el.textContent = "Processing...";
    chatEl.appendChild(el);
    chatEl.scrollTop = chatEl.scrollHeight;
}

function hideProcessing() {
    const el = document.getElementById("processing");
    if (el) el.remove();
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function updateSendBtn() {
    if (inputEl.value.trim()) {
        sendBtn.classList.add("active");
    } else {
        sendBtn.classList.remove("active");
    }
}

inputEl.addEventListener("input", updateSendBtn);

// ═══════════════════════════════════════════════════════════
//  NAVIGATE BUTTON + NAV PANEL
// ═══════════════════════════════════════════════════════════
function showNavButton() {
    const existing = document.getElementById("nav-btn-inline");
    if (existing) existing.remove();

    const btn = document.createElement("button");
    btn.id = "nav-btn-inline";
    btn.className = "nav-btn";
    btn.textContent = "🗺️ Navigate to Address";
    btn.onclick = startNav;
    chatEl.appendChild(btn);
    chatEl.scrollTop = chatEl.scrollHeight;

    navShortcut.style.display = "flex";
}

function startNav() {
    if (!scannedAddr || navSteps.length === 0) return;
    showNav = true;
    navStep = 0;

    // Remove old nav if exists
    const old = document.getElementById("nav-panel-container");
    if (old) old.remove();
    const oldBtn = document.getElementById("nav-btn-inline");
    if (oldBtn) oldBtn.remove();

    renderNavPanel();
    speak(navSteps[0].text);
}

function renderNavPanel() {
    const old = document.getElementById("nav-panel-container");
    if (old) old.remove();

    const container = document.createElement("div");
    container.id = "nav-panel-container";

    const step = navSteps[navStep];
    const progress = ((navStep + 1) / navSteps.length * 100).toFixed(0);

    container.innerHTML = `
        <div class="map-frame">
            <iframe src="https://maps.google.com/maps?q=${encodeURIComponent(scannedAddr)}&z=16&output=embed"
                width="100%" height="200" allowfullscreen loading="lazy" title="Map"></iframe>
        </div>
        <div class="nav-panel">
            <div class="nav-header">
                <span class="nav-step-label">STEP ${navStep + 1}/${navSteps.length}</span>
                <span class="nav-dist">${step.dist}</span>
            </div>
            <div class="nav-instruction">
                <span class="nav-icon">${step.icon}</span>
                <span class="nav-text">${escapeHtml(step.text)}</span>
            </div>
            <div class="nav-progress">
                <div class="nav-progress-fill" style="width:${progress}%"></div>
            </div>
            <div class="nav-buttons">
                <button class="btn-back ${navStep === 0 ? 'btn-disabled' : ''}" onclick="goNavStep(${navStep - 1})">←</button>
                <button class="btn-speak ${isSpeaking ? 'active' : ''}" onclick="toggleNavSpeak()">
                    ${isSpeaking ? '🔊 Stop' : '🔊 Speak'}
                </button>
                <button class="btn-next ${navStep === navSteps.length - 1 ? 'btn-disabled' : ''}" onclick="goNavStep(${navStep + 1})">→</button>
            </div>
        </div>
        <button class="close-nav" onclick="closeNav()">Close Navigation</button>
    `;

    chatEl.appendChild(container);
    chatEl.scrollTop = chatEl.scrollHeight;
}

function goNavStep(n) {
    if (n < 0 || n >= navSteps.length) return;
    navStep = n;
    renderNavPanel();
    speak(navSteps[n].text);
}

function toggleNavSpeak() {
    if (isSpeaking) {
        stopSpeak();
    } else {
        speak(navSteps[navStep].text);
    }
    // Re-render after small delay to update button
    setTimeout(renderNavPanel, 100);
}

function closeNav() {
    showNav = false;
    const el = document.getElementById("nav-panel-container");
    if (el) el.remove();
    showNavButton();
}

// ═══════════════════════════════════════════════════════════
//  SEND TEXT MESSAGE
// ═══════════════════════════════════════════════════════════
async function sendText(overrideText) {
    const text = overrideText || inputEl.value;
    if (!text || !text.trim() || busy) return;

    addBubble("user", text.trim());
    inputEl.value = "";
    updateSendBtn();
    busy = true;
    showProcessing();

    try {
        const reply = await callAPI(
            [{ role: "user", content: text.trim() }],
            SYSTEM_PROMPT
        );
        hideProcessing();
        addBubble("assistant", reply);
        speak(reply.replace(/[•\-\*]/g, "").replace(/\n+/g, ". "));
    } catch (err) {
        hideProcessing();
        addBubble("assistant", "Error: " + err.message);
    }

    busy = false;
}

// ═══════════════════════════════════════════════════════════
//  SCAN LABEL (camera / upload)
// ═══════════════════════════════════════════════════════════
async function handleScan(event) {
    const file = event.target.files && event.target.files[0];
    if (!file || busy) return;
    busy = true;

    try {
        // Compress image
        const img = await compressImage(file);
        addBubble("user", "📷 Scanned (" + img.w + "×" + img.h + ", " + img.sizeKB + "KB)", img.preview);
        showProcessing();

        // Call backend API with image
        const res = await fetch("/api/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system: SYSTEM_PROMPT,
                image_base64: img.base64Data,
                ocr_prompt: OCR_PROMPT
            })
        });
        const data = await res.json();
        if (data.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));

        hideProcessing();

        const reply = data.reply || data.content || "";

        // Try to parse as JSON
        let parsed = null;
        try {
            parsed = JSON.parse(reply.replace(/```json|```/g, "").trim());
        } catch (e) {
            parsed = null;
        }

        if (parsed && parsed.address) {
            const lines = [
                "📍 " + parsed.address,
                parsed.postal ? "📮 Postal: " + parsed.postal : null,
                parsed.recipient ? "👤 " + parsed.recipient : null,
                "🌐 " + parsed.language + " (auto-detected)"
            ].filter(Boolean).join("\n");

            addBubble("assistant", lines);
            scannedAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
            navSteps = makeNavSteps(parsed.address);
            navStep = 0;
            showNavButton();
            speak("Address: " + parsed.address + ". Tap navigate to start.");
        } else {
            addBubble("assistant", reply);
        }
    } catch (err) {
        hideProcessing();
        addBubble("assistant", "Error: " + err.message);
    }

    busy = false;
    fileInput.value = "";
}

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
function init() {
    renderChips();
    initGPS();
    addBubble("assistant", "Ready. Scan a label or ask a question.");
}

init();
