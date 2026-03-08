// ═══════════════════════════════════════════════════════════
//  NINJA CO-PILOT — AI Driver Assistant
//  Vanilla JS, no React, no build step
// ═══════════════════════════════════════════════════════════

(function () {
    "use strict";

    // ─── Config ───
    var MAX_DIM = 800;
    var MAX_BYTES = 4 * 1024 * 1024;

    // ─── State ───
    var busy = false;
    var scannedAddr = null;
    var navSteps = [];
    var navStep = 0;
    var isSpeaking = false;
    var isListening = false;
    var recognition = null;
    var gpsPos = null;

    // ─── DOM ───
    var chatEl = document.getElementById("chat");
    var inp = document.getElementById("inp");
    var sendBtn = document.getElementById("sendBtn");
    var voiceBtn = document.getElementById("voiceBtn");
    var scanBtn = document.getElementById("scanBtn");
    var navBtnEl = document.getElementById("navBtn");
    var stopBtnEl = document.getElementById("stopBtn");
    var sbEl = document.getElementById("sb");
    var gpsEl = document.getElementById("gps");
    var chipsEl = document.getElementById("chips");
    var fileIn = document.getElementById("fileIn");

    // ─── Prompts ───
    var SYS = [
        "You are Ninja Co-Pilot, an AI assistant for delivery drivers.",
        "",
        "STRICT RULES:",
        "1. ALL replies must be under 60 words. Maximum 3 bullet points.",
        '2. Professional tone only. NEVER use: "bro", "hey", "dude", "mate", slang, or casual greetings.',
        "3. Start with the action or answer directly. No greetings, no filler.",
        "4. Use this format:",
        "   \u2022 Action: [what to do immediately]",
        "   \u2022 Reason: [one sentence why, if needed]",
        "5. For issues, give solution first, explanation second.",
        "6. Auto-detect any language on labels without asking.",
        "",
        "EXAMPLE good reply:",
        "\u2022 Action: Leave parcel at door, take photo as proof.",
        '\u2022 Note: Mark as "safe location" in the app.',
        "",
        "EXAMPLE bad reply (NEVER do this):",
        '"Hey bro! So what you wanna do is..."'
    ].join("\n");

    var OCR = [
        "Extract delivery address from this package label.",
        "Auto-detect the language (English, Chinese, Malay, Tamil, Thai, Vietnamese, Bahasa, etc.).",
        "Respond ONLY in JSON:",
        '{"address":"full address","postal":"code or null","recipient":"name or null","sender":"sender or null","language":"auto-detected language","confidence":"high/medium/low"}'
    ].join("\n");

    var CHIPS = ["Cannot find address", "No answer", "Traffic jam", "Damaged parcel", "Wrong address", "Gate locked"];

    // ═══════════════════════════════════════════════════════
    //  IMAGE COMPRESSION — guarantees under 4MB
    // ═══════════════════════════════════════════════════════
    function compressImage(file, cb) {
        var reader = new FileReader();
        reader.onload = function (e) {
            var img = new Image();
            img.onload = function () {
                var w = img.width, h = img.height;
                if (w > MAX_DIM || h > MAX_DIM) {
                    var r = Math.min(MAX_DIM / w, MAX_DIM / h);
                    w = Math.round(w * r);
                    h = Math.round(h * r);
                }
                var c = document.createElement("canvas");
                c.width = w;
                c.height = h;
                c.getContext("2d").drawImage(img, 0, 0, w, h);

                var q = 0.8;
                var b64 = c.toDataURL("image/jpeg", q);
                while (b64.length * 0.75 > MAX_BYTES && q > 0.2) {
                    q -= 0.1;
                    b64 = c.toDataURL("image/jpeg", q);
                }
                if (b64.length * 0.75 > MAX_BYTES) {
                    c.width = Math.round(w * 0.5);
                    c.height = Math.round(h * 0.5);
                    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
                    b64 = c.toDataURL("image/jpeg", 0.5);
                    w = c.width;
                    h = c.height;
                }
                cb(null, {
                    base64: b64.split(",")[1],
                    preview: b64,
                    w: w,
                    h: h,
                    kb: Math.round((b64.length * 3) / 4 / 1024)
                });
            };
            img.onerror = function () { cb("Failed to load image"); };
            img.src = e.target.result;
        };
        reader.onerror = function () { cb("Failed to read file"); };
        reader.readAsDataURL(file);
    }

    // ═══════════════════════════════════════════════════════
    //  API CALLS (go through Python backend)
    // ═══════════════════════════════════════════════════════
    function apiChat(text, cb) {
        fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system: SYS,
                messages: [{ role: "user", content: text }]
            })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.error) cb(typeof d.error === "string" ? d.error : JSON.stringify(d.error));
                else cb(null, d.reply || "");
            })
            .catch(function (e) { cb(e.message); });
    }

    function apiScan(base64, cb) {
        fetch("/api/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system: SYS,
                image_base64: base64,
                ocr_prompt: OCR
            })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.error) cb(typeof d.error === "string" ? d.error : JSON.stringify(d.error));
                else cb(null, d.reply || "");
            })
            .catch(function (e) { cb(e.message); });
    }

    // ═══════════════════════════════════════════════════════
    //  TEXT-TO-SPEECH
    // ═══════════════════════════════════════════════════════
    function speak(text) {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.rate = 0.95;
        u.onstart = function () {
            isSpeaking = true;
            sbEl.style.display = "flex";
        };
        u.onend = function () {
            isSpeaking = false;
            sbEl.style.display = "none";
        };
        window.speechSynthesis.speak(u);
    }

    function stopSpeak() {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        isSpeaking = false;
        sbEl.style.display = "none";
    }

    // ═══════════════════════════════════════════════════════
    //  SPEECH-TO-TEXT (auto language detect)
    // ═══════════════════════════════════════════════════════
    function toggleListen() {
        if (isListening) {
            if (recognition) recognition.stop();
            isListening = false;
            voiceBtn.textContent = "\ud83c\udfa4 TAP TO SPEAK";
            voiceBtn.classList.remove("lis");
            return;
        }
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            alert("Speech recognition not supported in this browser");
            return;
        }
        recognition = new SR();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = "";

        recognition.onresult = function (e) {
            inp.value = e.results[0][0].transcript;
            isListening = false;
            voiceBtn.textContent = "\ud83c\udfa4 TAP TO SPEAK";
            voiceBtn.classList.remove("lis");
            updateSend();
        };
        recognition.onerror = function () {
            isListening = false;
            voiceBtn.textContent = "\ud83c\udfa4 TAP TO SPEAK";
            voiceBtn.classList.remove("lis");
        };
        recognition.onend = function () {
            isListening = false;
            voiceBtn.textContent = "\ud83c\udfa4 TAP TO SPEAK";
            voiceBtn.classList.remove("lis");
        };
        recognition.start();
        isListening = true;
        voiceBtn.textContent = "\ud83c\udfa4 LISTENING...";
        voiceBtn.classList.add("lis");
    }

    // ═══════════════════════════════════════════════════════
    //  GPS
    // ═══════════════════════════════════════════════════════
    function initGPS() {
        if (!navigator.geolocation) {
            setGPS(false, "No GPS");
            return;
        }
        navigator.geolocation.watchPosition(
            function (p) {
                gpsPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
                setGPS(true, "GPS \u00b1" + Math.round(gpsPos.acc) + "m");
            },
            function () {
                setGPS(false, "GPS...");
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
    }

    function setGPS(ok, label) {
        var color = ok ? "#4CAF50" : "#FF5722";
        gpsEl.style.background = ok ? "rgba(76,175,80,0.1)" : "rgba(255,87,34,0.1)";
        gpsEl.innerHTML =
            '<div class="gps-dot" style="background:' + color + ";box-shadow:0 0 4px " + color + '"></div>' +
            '<span style="color:' + color + '">' + label + "</span>";
    }

    // ═══════════════════════════════════════════════════════
    //  NAV STEPS
    // ═══════════════════════════════════════════════════════
    function makeNav(addr) {
        return [
            { icon: "\ud83d\ude80", text: "Starting: " + addr, dist: "" },
            { icon: "\u2b06\ufe0f", text: "Head north 200m", dist: "200m" },
            { icon: "\u27a1\ufe0f", text: "Turn right at junction", dist: "150m" },
            { icon: "\u2b06\ufe0f", text: "Straight 500m", dist: "500m" },
            { icon: "\u2b05\ufe0f", text: "Turn left, main road", dist: "300m" },
            { icon: "\u27a1\ufe0f", text: "Turn right, delivery area", dist: "100m" },
            { icon: "\ud83d\udce6", text: "Arrived: " + addr, dist: "\u2713" }
        ];
    }

    // ═══════════════════════════════════════════════════════
    //  RENDER HELPERS
    // ═══════════════════════════════════════════════════════
    function esc(s) {
        var d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    function scrollDown() {
        chatEl.scrollTop = chatEl.scrollHeight;
    }

    function addBubble(role, text, imgUrl) {
        var row = document.createElement("div");
        row.className = "mr " + (role === "user" ? "u" : "a");
        var html = "";
        if (role === "assistant") html += '<div class="av">\ud83e\udd77</div>';
        html += '<div class="bb ' + (role === "user" ? "u" : "a") + '">';
        if (imgUrl) html += '<img src="' + imgUrl + '" alt="">';
        html += esc(text) + "</div>";
        row.innerHTML = html;
        chatEl.appendChild(row);
        scrollDown();
    }

    function showProc() {
        var el = document.createElement("div");
        el.id = "proc";
        el.className = "proc";
        el.textContent = "Processing...";
        chatEl.appendChild(el);
        scrollDown();
    }

    function hideProc() {
        var el = document.getElementById("proc");
        if (el) el.remove();
    }

    function updateSend() {
        if (inp.value.trim()) sendBtn.classList.add("on");
        else sendBtn.classList.remove("on");
    }

    // ═══════════════════════════════════════════════════════
    //  NAV UI
    // ═══════════════════════════════════════════════════════
    function showNavBtn() {
        removeEl("navInline");
        var btn = document.createElement("button");
        btn.id = "navInline";
        btn.className = "nbtn";
        btn.textContent = "\ud83d\uddfa\ufe0f Navigate to Address";
        btn.addEventListener("click", startNav);
        chatEl.appendChild(btn);
        scrollDown();
        navBtnEl.style.display = "flex";
    }

    function startNav() {
        if (!scannedAddr || !navSteps.length) return;
        navStep = 0;
        renderNav();
        speak(navSteps[0].text);
    }

    function renderNav() {
        removeEl("navPanel");
        removeEl("navInline");

        var s = navSteps[navStep];
        var pct = ((navStep + 1) / navSteps.length * 100).toFixed(0);

        var div = document.createElement("div");
        div.id = "navPanel";
        div.innerHTML =
            '<div class="mf"><iframe src="https://maps.google.com/maps?q=' +
            encodeURIComponent(scannedAddr) +
            '&z=16&output=embed" width="100%" height="200" allowfullscreen loading="lazy"></iframe></div>' +
            '<div class="np">' +
            '<div class="nh"><span class="ns">STEP ' + (navStep + 1) + "/" + navSteps.length + '</span><span class="nd">' + s.dist + "</span></div>" +
            '<div class="ni"><span class="ni-i">' + s.icon + '</span><span class="ni-t">' + esc(s.text) + "</span></div>" +
            '<div class="npg"><div class="npf" style="width:' + pct + '%"></div></div>' +
            '<div class="nbs">' +
            '<button class="bk' + (navStep === 0 ? " dis" : "") + '" id="nprev">\u2190</button>' +
            '<button class="spk' + (isSpeaking ? " on" : "") + '" id="nspk">' + (isSpeaking ? "\ud83d\udd0a Stop" : "\ud83d\udd0a Speak") + "</button>" +
            '<button class="nx' + (navStep === navSteps.length - 1 ? " dis" : "") + '" id="nnext">\u2192</button>' +
            "</div></div>" +
            '<button class="cn" id="nclose">Close Navigation</button>';

        chatEl.appendChild(div);
        scrollDown();

        document.getElementById("nprev").addEventListener("click", function () {
            if (navStep > 0) { navStep--; renderNav(); speak(navSteps[navStep].text); }
        });
        document.getElementById("nnext").addEventListener("click", function () {
            if (navStep < navSteps.length - 1) { navStep++; renderNav(); speak(navSteps[navStep].text); }
        });
        document.getElementById("nspk").addEventListener("click", function () {
            if (isSpeaking) stopSpeak();
            else speak(navSteps[navStep].text);
            setTimeout(renderNav, 150);
        });
        document.getElementById("nclose").addEventListener("click", function () {
            removeEl("navPanel");
            showNavBtn();
        });
    }

    function removeEl(id) {
        var el = document.getElementById(id);
        if (el) el.remove();
    }

    // ═══════════════════════════════════════════════════════
    //  SEND TEXT
    // ═══════════════════════════════════════════════════════
    function sendText(overrideText) {
        var text = overrideText || inp.value;
        if (!text || !text.trim() || busy) return;
        addBubble("user", text.trim());
        inp.value = "";
        updateSend();
        busy = true;
        showProc();

        apiChat(text.trim(), function (err, reply) {
            hideProc();
            if (err) addBubble("assistant", "Error: " + err);
            else {
                addBubble("assistant", reply);
                speak(reply.replace(/[\u2022\-\*]/g, "").replace(/\n+/g, ". "));
            }
            busy = false;
        });
    }

    // ═══════════════════════════════════════════════════════
    //  SCAN LABEL
    // ═══════════════════════════════════════════════════════
    function handleScan() {
        var file = fileIn.files && fileIn.files[0];
        if (!file || busy) return;
        busy = true;

        compressImage(file, function (err, img) {
            if (err) {
                addBubble("assistant", "Error: " + err);
                busy = false;
                return;
            }
            addBubble("user", "\ud83d\udcf7 Scanned (" + img.w + "\u00d7" + img.h + ", " + img.kb + "KB)", img.preview);
            showProc();

            apiScan(img.base64, function (err2, reply) {
                hideProc();
                if (err2) {
                    addBubble("assistant", "Error: " + err2);
                    busy = false;
                    fileIn.value = "";
                    return;
                }

                var parsed = null;
                try {
                    parsed = JSON.parse(reply.replace(/```json|```/g, "").trim());
                } catch (e) { /* not json */ }

                if (parsed && parsed.address) {
                    var lines = [
                        "\ud83d\udccd " + parsed.address,
                        parsed.postal ? "\ud83d\udcee Postal: " + parsed.postal : null,
                        parsed.recipient ? "\ud83d\udc64 " + parsed.recipient : null,
                        "\ud83c\udf10 " + (parsed.language || "Unknown") + " (auto-detected)"
                    ].filter(Boolean).join("\n");

                    addBubble("assistant", lines);
                    scannedAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
                    navSteps = makeNav(parsed.address);
                    navStep = 0;
                    showNavBtn();
                    speak("Address: " + parsed.address + ". Tap navigate to start.");
                } else {
                    addBubble("assistant", reply);
                }
                busy = false;
                fileIn.value = "";
            });
        });
    }

    // ═══════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════
    function init() {
        // Render chips
        CHIPS.forEach(function (c) {
            var btn = document.createElement("button");
            btn.className = "chip";
            btn.textContent = c;
            btn.addEventListener("click", function () { sendText(c); });
            chipsEl.appendChild(btn);
        });

        // Wire up events
        sendBtn.addEventListener("click", function () { sendText(); });
        inp.addEventListener("input", updateSend);
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") sendText(); });
        voiceBtn.addEventListener("click", toggleListen);
        scanBtn.addEventListener("click", function () { fileIn.click(); });
        fileIn.addEventListener("change", handleScan);
        navBtnEl.addEventListener("click", startNav);
        stopBtnEl.addEventListener("click", stopSpeak);

        // Start GPS
        initGPS();

        // Welcome message
        addBubble("assistant", "Ready. Scan a label or ask a question.");
    }

    init();
})();
