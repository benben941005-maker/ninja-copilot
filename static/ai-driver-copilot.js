(function () {
    "use strict";

    // Show JS errors visibly in chat for debugging
    window.onerror = function (msg, src, line) {
        var el = document.getElementById("chat");
        if (el) {
            var d = document.createElement("div");
            d.style.cssText = "color:#ff4444;font-size:11px;padding:8px;background:rgba(255,0,0,0.1);border-radius:8px;margin:6px";
            d.textContent = "JS Error: " + msg + " (line " + line + ")";
            el.appendChild(d);
        }
    };

    // =========================================================
    // CONSTANTS
    // =========================================================
    var MAX_DIM = 1600, MAX_BYTES = 5 * 1024 * 1024;
    var ETA_NOTIFY_SECONDS = 300;
    var ETA_NOTIFY_METERS  = 1200;
    var DEFAULT_CUSTOMER_PHONE = "";
    var WEATHER_REFRESH_MS = 5 * 60 * 1000;

    var ua    = navigator.userAgent.toLowerCase();
    var isIOS = /iphone|ipad|ipod/.test(ua);
    var hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    var useRecorder = !hasSR;

    // =========================================================
    // LANGUAGES  — EN / ZH-CN / ZH-TW / ZH-HK / MS / TA / KO / JA
    // =========================================================
    var LANGUAGES = [
        { label: "EN",     flag: "🇬🇧", code: "en-SG", ai: "English" },
        { label: "中文",   flag: "🇨🇳", code: "zh-CN", ai: "Chinese Simplified" },
        { label: "繁體",   flag: "🇹🇼", code: "zh-TW", ai: "Chinese Traditional" },
        { label: "廣東話", flag: "🇭🇰", code: "zh-HK", ai: "Cantonese" },
        { label: "Malay",  flag: "🇲🇾", code: "ms-MY", ai: "Malay" },
        { label: "Tamil",  flag: "🇮🇳", code: "ta-IN", ai: "Tamil" },
        { label: "한국어", flag: "🇰🇷", code: "ko-KR", ai: "Korean" },
        { label: "日本語", flag: "🇯🇵", code: "ja-JP", ai: "Japanese" }
    ];

    var LANG_TTS = {
        "zh-CN": ["zh-CN", "cmn-CN", "zh"],
        "zh-TW": ["zh-TW", "cmn-TW", "zh-Hant", "zh"],
        "zh-HK": ["zh-HK", "yue-HK", "yue", "zh-Hant-HK"],
        "ms-MY": ["ms-MY", "ms"],
        "ta-IN": ["ta-IN", "ta"],
        "ko-KR": ["ko-KR", "ko"],
        "ja-JP": ["ja-JP", "ja"],
        "en":    ["en-SG", "en-US", "en-GB", "en"]
    };

    // =========================================================
    // STATE
    // =========================================================
    var busy = false, scannedAddr = null, isSpeaking = false, micActive = false;
    var isListening = false, recognition = null, gpsPos = null, selectedLang = 0;
    var currentStreet = "";
    var mediaRecorder = null, audioChunks = [];
    var recordTimer = null, ttsTimer = null;
    var speechUnlocked = false;

    var activeRoute = null, activeStepIndex = 0, lastSpokenStep = -1, navActive = false;
    var lastGpsCheckAt = 0;
    var customerPhone = DEFAULT_CUSTOMER_PHONE;
    var notifyShownForRoute = false, arrivalPromptSpoken = false;
    var rainAlertShownForRoute = false, currentWeatherInfo = null;
    var lastDetectedLang = "en-SG";
    var arrivalAutoSent = false;
    var rainAutoSent = false;

    var transportMode = "unknown";
    var lastWeatherRefresh = 0;
    var routingMode = "driving";

    var leafletMap = null, mapMarker = null, routeLayer = null, destMarker = null;
    var mapVisible = false;

    var camActive = false, camStream = null, camAutoInterval = null, camAutoOn = false;

    // =========================================================
    // DOM REFS
    // =========================================================
    var chatEl    = document.getElementById("chat");
    var inp       = document.getElementById("inp");
    var sendBtn   = document.getElementById("sendBtn");
    var voiceBtn  = document.getElementById("voiceBtn");
    var scanBtn   = document.getElementById("scanBtn");
    var photoBtn  = document.getElementById("photoBtn");
    var sbEl      = document.getElementById("sb");
    var micBar    = document.getElementById("micBar");
    var micLabel  = document.getElementById("micLabel");
    var locBar    = document.getElementById("locBar");
    var locAddr   = document.getElementById("locAddr");
    var langBar   = document.getElementById("langBar");
    var chipsEl   = document.getElementById("chips");
    var cameraIn  = document.getElementById("cameraIn");
    var photoIn   = document.getElementById("photoIn");
    var mapBtn    = document.getElementById("mapBtn");
    var mapPanel  = document.getElementById("mapPanel");
    var mapZoomIn = document.getElementById("mapZoomIn");
    var mapZoomOut= document.getElementById("mapZoomOut");
    var mapCenter = document.getElementById("mapCenter");
    var mapClose  = document.getElementById("mapClose");
    var mpDriving = document.getElementById("mpDriving");
    var mpWalking = document.getElementById("mpWalking");
    var liveCamBtn   = document.getElementById("liveCamBtn");
    var camOverlay   = document.getElementById("camOverlay");
    var camVideo     = document.getElementById("camVideo");
    var camSnap      = document.getElementById("camSnap");
    var camCloseBtn  = document.getElementById("camCloseBtn");
    var camAutoToggle= document.getElementById("camAutoToggle");
    var camStatus    = document.getElementById("camStatus");
    var camAiReply   = document.getElementById("camAiReply");
    var modeBadge    = document.getElementById("modeBadge");
    var wxBadge      = document.getElementById("wxBadge");
    var wxIcon       = document.getElementById("wxIcon");
    var wxTemp       = document.getElementById("wxTemp");
    var wxDesc       = document.getElementById("wxDesc");
    var stopBtnEl    = document.getElementById("stopBtn");
    var gpsBtn       = document.getElementById("gpsBtn");

    // =========================================================
    // LANGUAGE HELPERS
    // =========================================================
    function currentLang() { return LANGUAGES[selectedLang]; }
    function syncReplyLanguageToSelection() { lastDetectedLang = currentLang().code; }
    function isCantoneseMode() { return currentLang().code === "zh-HK"; }

    function getPreferredReplyLanguage() {
        var code = currentLang().code;
        if (code === "zh-HK") return "Cantonese";
        if (code === "zh-TW") return "Traditional Chinese";
        if (code === "zh-CN") return "Simplified Chinese";
        if (code === "ms-MY") return "Malay";
        if (code === "ta-IN") return "Tamil";
        if (code === "ko-KR") return "Korean";
        if (code === "ja-JP") return "Japanese";
        return "English";
    }

    // =========================================================
    // PROMPTS
    // =========================================================
    function getSysPrompt() {
        var locInfo  = currentStreet ? ("\nDriver current location: " + currentStreet +
            (gpsPos ? " (GPS:" + gpsPos.lat.toFixed(5) + "," + gpsPos.lng.toFixed(5) + ")" : "")) : "";
        var modeInfo = "\nTransport mode: " + transportMode + ". Routing preference: " + routingMode + ".";
        return [
            "You are Ninja Co-Pilot, AI assistant for Ninja Van drivers in Singapore." + locInfo + modeInfo,
            "Reply only in " + getPreferredReplyLanguage() + ". Under 60 words. Action first.",
            "For navigation requests, ALWAYS include:",
            "ADDRESS: full Singapore address with street name and postal code if known",
            "PLACE: short place name",
            "If it is a nearby business like restaurant, mall, hotel, toilet, petrol station or MRT, choose the nearest reasonable match based on driver GPS."
        ].join("\n");
    }

    function getOcrPrompt() {
        return [
            "Extract Singapore parcel or street information.",
            "Return JSON ONLY.",
            '{"address":"full visible address or best visible address","unit":"unit/block or null","postal":"postal code or null","recipient":"name or null","sender":"sender or null","phone":"phone or null","place":"place name or null","language":"detected language","confidence":"high/medium/low"}'
        ].join("\n");
    }

    function getLiveCamPrompt() {
        return [
            "Analyze this Singapore live street or parcel image.",
            "Return exactly:",
            "ADDRESS: full Singapore address with street and postal code if visible",
            "PLACE: short place name",
            "NOTE: short action guidance",
            "If uncertain, return ADDRESS: UNKNOWN"
        ].join("\n");
    }

    // =========================================================
    // QUICK CHIPS
    // =========================================================
    var CHIPS = ["Nearest petrol station", "Nearest toilet", "Nearest MRT", "Cannot find address", "Traffic jam"];

    // =========================================================
    // UI TEXT
    // =========================================================
    function uiText(key) {
        var en = {
            ready: "Ready",
            pick_language: "Pick language",
            tap_mic_once: "Tap 🎙️ once — mic stays on",
            scan_label: "Scan parcel label",
            ask_route: "Ask for a route",
            rain_popup_note: "Rain delay popup appears automatically",
            route_starting: "Getting directions...",
            route_not_found: "Route not found.",
            about_5_min: "About 5 minutes to arrival. Notify customer?",
            raining_prompt: "It is raining near the destination. Send a delay notice?",
            arrived: "You have arrived.",
            route_notif: "In ",
            meters: " meters, ",
            customer_phone_saved: "Customer phone saved: ",
            invalid_phone: "Invalid phone number.",
            weather_unknown: "rain",
            processing: "Processing..."
        };
        return en[key] || key;
    }

    // =========================================================
    // TRANSPORT MODE
    // =========================================================
    var TRANSPORT_LABELS   = { driving:"🚗 DRIVE", walking:"🚶 WALK", mrt:"🚇 MRT/BUS", unknown:"🚗 --" };
    var TRANSPORT_CLASSES  = { driving:"mode-badge mode-driving", walking:"mode-badge mode-walking", mrt:"mode-badge mode-mrt", unknown:"mode-badge mode-unknown" };

    function detectTransportMode(speedMs) {
        if (speedMs === null || speedMs === undefined || speedMs < 0) return "unknown";
        if (speedMs < 1.4) return "walking";
        if (speedMs < 9)   return "mrt";
        return "driving";
    }

    function updateTransportMode(speedMs) {
        var newMode = detectTransportMode(speedMs);
        if (newMode === transportMode) return;
        transportMode = newMode;
        if (transportMode === "walking" || transportMode === "mrt") { routingMode = "walking"; setMapModePill("walking"); }
        else if (transportMode === "driving")                        { routingMode = "driving"; setMapModePill("driving"); }
        if (modeBadge) {
            modeBadge.className  = TRANSPORT_CLASSES[transportMode] || TRANSPORT_CLASSES.unknown;
            modeBadge.textContent= TRANSPORT_LABELS[transportMode]  || TRANSPORT_LABELS.unknown;
        }
    }

    // =========================================================
    // WEATHER WIDGET
    // =========================================================
    var WEATHER_ICONS = {
        sunny:"☀️", clear:"☀️", cloud:"⛅", overcast:"☁️",
        rain:"🌧️", drizzle:"🌦️", shower:"🌧️", storm:"⛈️",
        thunder:"⛈️", fog:"🌫️", mist:"🌫️", haze:"🌫️"
    };

    function weatherIconFor(desc) {
        var d = String(desc || "").toLowerCase();
        for (var k in WEATHER_ICONS) { if (d.indexOf(k) >= 0) return WEATHER_ICONS[k]; }
        return "🌤";
    }

    function updateWeatherWidget(data) {
        if (!data || data.status === "weather_unavailable" || !wxBadge) return;
        var desc = data.description || "";
        var temp = data.temp_c != null ? Math.round(data.temp_c) + "°C" : "--°C";
        if (wxIcon) wxIcon.textContent = weatherIconFor(desc);
        if (wxTemp) wxTemp.textContent = temp;
        if (wxDesc) wxDesc.textContent = desc || "--";
        wxBadge.style.display = "flex";
        wxBadge.className = "wx-badge" + (data.is_rain ? " rain" : "");
    }

    function maybeRefreshWeather() {
        if (!gpsPos) return;
        var now = Date.now();
        if (now - lastWeatherRefresh < WEATHER_REFRESH_MS) return;
        lastWeatherRefresh = now;
        apiWeather(gpsPos.lat, gpsPos.lng, function (err, data) {
            if (!err && data) { currentWeatherInfo = data; updateWeatherWidget(data); }
        });
    }

    // =========================================================
    // CHAT BUBBLES
    // =========================================================
    function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

    function addBubble(role, text, imgSrc) {
        var row = document.createElement("div");
        row.className = "mr " + (role === "user" ? "u" : "a");
        var html = "";
        if (role === "assistant") html += '<div class="av">🥷</div>';
        html += '<div class="bb ' + (role === "user" ? "u" : "a") + '">';
        if (imgSrc) html += '<img src="' + imgSrc + '" style="max-width:100%;border-radius:8px;margin-bottom:6px;display:block"/>';
        html += esc(text) + '</div>';
        row.innerHTML = html;
        chatEl.appendChild(row);
        chatEl.scrollTop = chatEl.scrollHeight;
    }

    function showProc() {
        hideProc();
        var el = document.createElement("div");
        el.className = "proc"; el.id = "proc";
        el.textContent = uiText("processing");
        chatEl.appendChild(el);
        chatEl.scrollTop = chatEl.scrollHeight;
    }
    function hideProc() { var el = document.getElementById("proc"); if (el) el.remove(); }
    function removeEl(id) { var el = document.getElementById(id); if (el) el.remove(); }

    // =========================================================
    // LANGUAGE BAR
    // =========================================================
    function renderLangBar() {
        if (!langBar) return;
        langBar.innerHTML = "";
        LANGUAGES.forEach(function (lang, i) {
            var btn = document.createElement("button");
            btn.className = "lang-btn" + (i === selectedLang ? " active" : "");
            btn.textContent = lang.flag + " " + lang.label;
            btn.addEventListener("click", function () {
                unlockSpeech();
                selectedLang = i;
                syncReplyLanguageToSelection();
                renderLangBar();
                if (micLabel) micLabel.textContent = "MIC • " + lang.flag + " " + lang.ai;
                addBubble("assistant", "🌐 " + lang.flag + " " + lang.ai);
            });
            langBar.appendChild(btn);
        });
    }

    // =========================================================
    // IMAGE COMPRESSION
    // =========================================================
    function compressImage(file, cb) {
        var reader = new FileReader();
        reader.onload = function (e) {
            var img = new Image();
            img.onload = function () {
                var w = img.width, h = img.height;
                if (w > MAX_DIM || h > MAX_DIM) {
                    var r = Math.min(MAX_DIM / w, MAX_DIM / h);
                    w = Math.round(w * r); h = Math.round(h * r);
                }
                var c = document.createElement("canvas");
                c.width = w; c.height = h;
                c.getContext("2d").drawImage(img, 0, 0, w, h);
                var q = 0.88, b64 = c.toDataURL("image/jpeg", q);
                while (b64.length * 0.75 > MAX_BYTES && q > 0.3) { q -= 0.1; b64 = c.toDataURL("image/jpeg", q); }
                cb(null, { base64: b64.split(",")[1], preview: b64, w: w, h: h, kb: Math.round((b64.length * 3) / 4 / 1024) });
            };
            img.onerror = function () { cb("Failed"); };
            img.src = e.target.result;
        };
        reader.onerror = function () { cb("Failed"); };
        reader.readAsDataURL(file);
    }

    // =========================================================
    // API CALLS
    // =========================================================
    function apiChat(text, cb) {
        fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ system: getSysPrompt(), messages: [{ role: "user", content: text }] })
        }).then(function (r) { return r.json(); })
          .then(function (d) { cb(d.error ? String(d.error) : null, d.reply || ""); })
          .catch(function (e) { cb(e.message); });
    }

    function apiScan(base64, cb) {
        fetch("/api/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ system: getSysPrompt(), image_base64: base64, ocr_prompt: getOcrPrompt() })
        }).then(function (r) { return r.json(); })
          .then(function (d) { cb(d.error ? String(d.error) : null, d.reply || ""); })
          .catch(function (e) { cb(e.message); });
    }

    function apiScanCam(base64, prompt, cb) {
        fetch("/api/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ system: getSysPrompt(), image_base64: base64, ocr_prompt: prompt })
        }).then(function (r) { return r.json(); })
          .then(function (d) { cb(d.error ? String(d.error) : null, d.reply || ""); })
          .catch(function (e) { cb(e.message); });
    }

    function apiTranscribe(audioBase64, cb) {
        fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio_base64: audioBase64, language: currentLang().code })
        }).then(function (r) { return r.json(); })
          .then(function (d) { cb(d.error ? String(d.error) : null, d.text || ""); })
          .catch(function (e) { cb(e.message); });
    }

    function apiWeather(lat, lng, cb) {
        fetch("/api/weather?lat=" + encodeURIComponent(lat) + "&lng=" + encodeURIComponent(lng))
            .then(function (r) { return r.json(); })
            .then(function (d) { cb(null, d); })
            .catch(function (e) { cb(e.message); });
    }

    // =========================================================
    // SPEECH SYNTHESIS
    // =========================================================
    function unlockSpeech() {
        if (!window.speechSynthesis || speechUnlocked) return;
        try {
            var u = new SpeechSynthesisUtterance(" ");
            u.volume = 0;
            u.onend = u.onerror = function () { speechUnlocked = true; };
            window.speechSynthesis.speak(u);
            window.speechSynthesis.cancel();
            speechUnlocked = true;
        } catch (e) {}
    }

    function pickVoiceByTargets(targets) {
        if (!window.speechSynthesis) return null;
        var voices = window.speechSynthesis.getVoices() || [];
        if (!voices.length) return null;
        return voices.find(function (v) { return targets.some(function (t) { return (v.lang || "").toLowerCase() === t.toLowerCase(); }); })
            || voices.find(function (v) { return targets.some(function (t) { return (v.lang || "").toLowerCase().indexOf(t.toLowerCase()) === 0; }); })
            || null;
    }

    function stripEmojis(t) {
        return String(t || "").replace(/[\u{1F000}-\u{1FFFF}]/gu, "").replace(/[\u{2600}-\u{27BF}]/gu, "").trim();
    }

    function detectLang(text) {
        var t = String(text || "");
        var code = currentLang().code;
        if (code === "zh-HK" || code === "zh-TW" || code === "zh-CN") { lastDetectedLang = code; return; }
        if (code === "ko-KR") { lastDetectedLang = "ko-KR"; return; }
        if (code === "ja-JP") { lastDetectedLang = "ja-JP"; return; }
        if (/[\u4e00-\u9fff]/.test(t)) { lastDetectedLang = "zh-CN"; return; }
        if (/[\uAC00-\uD7AF]/.test(t)) { lastDetectedLang = "ko-KR"; return; }
        if (/[\u3040-\u30FF]/.test(t)) { lastDetectedLang = "ja-JP"; return; }
        lastDetectedLang = "en";
    }

    function speak(text, onDone) {
        if (!window.speechSynthesis || !text) { if (onDone) onDone(); return; }
        try {
            window.speechSynthesis.cancel();
            clearInterval(ttsTimer);
            var cleanText = stripEmojis(tuneReplyByLanguage(text));
            if (!cleanText) { if (onDone) onDone(); return; }

            var langKey  = lastDetectedLang || currentLang().code || "en";
            var targets  = LANG_TTS[langKey] || LANG_TTS["en"];
            var chosen   = pickVoiceByTargets(targets) || pickVoiceByTargets(LANG_TTS["en"]);

            var u = new SpeechSynthesisUtterance(cleanText);
            u.rate  = isCantoneseMode() ? 0.9 : 0.95;
            u.pitch = 1; u.volume = 1;
            if (chosen) { u.voice = chosen; u.lang = chosen.lang || currentLang().code; }
            else        { u.lang  = currentLang().code; }

            u.onstart = function () { isSpeaking = true; if (sbEl) sbEl.style.display = "flex"; };
            u.onend = u.onerror = function () {
                isSpeaking = false;
                if (sbEl) sbEl.style.display = "none";
                clearInterval(ttsTimer);
                if (onDone) onDone();
            };

            window.speechSynthesis.speak(u);
            try { window.speechSynthesis.resume(); } catch (e) {}
            ttsTimer = setInterval(function () { try { window.speechSynthesis.resume(); } catch (e) {} }, 2000);
        } catch (e) {
            isSpeaking = false;
            if (sbEl) sbEl.style.display = "none";
            clearInterval(ttsTimer);
            if (onDone) onDone();
        }
    }

    function stopSpeak() {
        if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
        isSpeaking = false;
        if (sbEl) sbEl.style.display = "none";
        clearInterval(ttsTimer);
    }

    // =========================================================
    // MIC — ALWAYS-ON TOGGLE
    // =========================================================
    function toggleMic() {
        unlockSpeech();
        if (micActive) { stopMic(); return; }
        micActive = true;
        syncReplyLanguageToSelection();
        if (voiceBtn) { voiceBtn.classList.add("active"); voiceBtn.querySelector("span:last-child").textContent = "MIC ON"; }
        if (micBar)   micBar.classList.add("on");
        if (micLabel) micLabel.textContent = "MIC • " + currentLang().flag + " " + currentLang().ai;
        if (useRecorder) startRecording(); else startSR();
    }

    function stopMic() {
        micActive = false; isListening = false;
        if (voiceBtn) { voiceBtn.classList.remove("active"); voiceBtn.querySelector("span:last-child").textContent = "TAP TO SPEAK"; }
        if (micBar)   micBar.classList.remove("on");
        clearTimeout(recordTimer);
        if (recognition) try { recognition.stop(); } catch (e) {}
        if (mediaRecorder && mediaRecorder.state !== "inactive") try { mediaRecorder.stop(); } catch (e) {}
    }

    function startSR() {
        if (!micActive || isListening || isSpeaking || busy) return;
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { startRecording(); return; }

        recognition = new SR();
        recognition.continuous    = true;
        recognition.interimResults = false;
        recognition.lang           = currentLang().code;

        recognition.onstart  = function () { isListening = true; };
        recognition.onend    = function () {
            isListening = false;
            if (micActive && !isSpeaking && !busy) setTimeout(startSR, 400);
        };
        recognition.onresult = function (e) {
            var text = "";
            for (var i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) text += e.results[i][0].transcript;
            }
            if (text.trim()) sendText(text.trim());
        };
        recognition.onerror  = function (e) {
            isListening = false;
            if (e.error === "not-allowed") {
                addBubble("assistant", "Mic permission denied. Please allow microphone.");
                stopMic();
            }
        };
        try { recognition.start(); } catch (e) {}
    }

    function startRecording() {
        if (!micActive || isSpeaking || busy) return;
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = function (e) { if (e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.onstop = function () {
                stream.getTracks().forEach(function (t) { t.stop(); });
                if (!micActive) return;
                var blob   = new Blob(audioChunks, { type: "audio/webm" });
                var reader = new FileReader();
                reader.onload = function (e) {
                    var b64 = e.target.result.split(",")[1];
                    apiTranscribe(b64, function (err, text) {
                        if (text && text.trim()) sendText(text.trim());
                        else if (micActive) setTimeout(startRecording, 300);
                    });
                };
                reader.readAsDataURL(blob);
            };
            mediaRecorder.start();
            recordTimer = setTimeout(function () {
                if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
            }, 6000);
        }).catch(function () {
            addBubble("assistant", "Mic permission denied. Please allow microphone.");
            stopMic();
        });
    }

    function restartMicAfterReply() {
        if (!micActive) return;
        setTimeout(function () {
            if (!micActive || isSpeaking || busy || isListening) return;
            if (useRecorder) startRecording(); else startSR();
        }, 500);
    }

    // =========================================================
    // GPS  — FIX: getCurrentPosition first, then watchPosition
    // =========================================================
    var lastGeocodeAt = 0, lastGeocodeLat = 0, lastGeocodeLng = 0;

    function metersBetween(lat1, lng1, lat2, lng2) {
        if (lat2 == null || lng2 == null) return 999999;
        var R = 6371000, toRad = function (d) { return d * Math.PI / 180; };
        var dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function gpsErrorMsg(err) {
        if (!window.isSecureContext) return "GPS blocked: HTTPS required.";
        if (!err) return "GPS unavailable.";
        switch (err.code) {
            case 1: return isIOS
                ? "GPS denied. Settings \u2192 Chrome \u2192 Location \u2192 Allow"
                : "GPS denied. Allow in browser settings.";
            case 2: return "GPS signal lost. Move to open sky.";
            case 3: return "GPS timeout. Tap \uD83D\uDCCD to retry.";
            default: return "GPS unavailable.";
        }
    }

    function initGPS() {
        if (!navigator.geolocation) { if (locAddr) locAddr.textContent = "GPS not available"; return; }

        // ── Fast first fix ──
        navigator.geolocation.getCurrentPosition(function (p) {
            gpsPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy || 999 };
            if (locBar)  { locBar.classList.remove("no-gps"); locBar.classList.add("good"); }
            if (locAddr)   locAddr.textContent = "GPS locked — loading address...";
            if (gpsBtn)    gpsBtn.classList.add("on");
            lastGeocodeLat = p.coords.latitude;
            lastGeocodeLng = p.coords.longitude;
            lastGeocodeAt  = Date.now();
            reverseGeocode(p.coords.latitude, p.coords.longitude);
        }, function (err) {
            if (locBar)  locBar.classList.add("no-gps");
            if (locAddr) locAddr.textContent = gpsErrorMsg(err);
            if (gpsBtn)  gpsBtn.classList.remove("on");
            addBubble("assistant", gpsErrorMsg(err));
        }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });

        // ── Continuous watch ──
        navigator.geolocation.watchPosition(function (p) {
            var acc = p.coords.accuracy || 999;
            gpsPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: acc };
            if (locBar) { locBar.classList.remove("no-gps"); locBar.classList.add("good"); }
            if (gpsBtn) gpsBtn.classList.add("on");

            var now   = Date.now();
            var moved = metersBetween(p.coords.latitude, p.coords.longitude, lastGeocodeLat, lastGeocodeLng);
            if (moved > 15 || now - lastGeocodeAt > 20000) {
                lastGeocodeAt  = now;
                lastGeocodeLat = p.coords.latitude;
                lastGeocodeLng = p.coords.longitude;
                reverseGeocode(p.coords.latitude, p.coords.longitude);
            }

            updateLiveNavigation();
            updateTransportMode(p.coords.speed);
            if (leafletMap) addOrMoveDriverMarker(gpsPos.lat, gpsPos.lng);
            maybeRefreshWeather();

        }, function (err) {
            if (locBar)  locBar.classList.add("no-gps");
            if (locAddr) locAddr.textContent = gpsErrorMsg(err);
            if (gpsBtn)  gpsBtn.classList.remove("on");
        }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 });
    }

    // =========================================================
    // GEOCODING
    // =========================================================
    function reverseGeocode(lat, lng) {
        fetch("/api/geocode?lat=" + lat + "&lng=" + lng)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                currentStreet = d.address || "";
                if (locAddr) locAddr.textContent = currentStreet || lat.toFixed(5) + "," + lng.toFixed(5);
                var srcEl = document.getElementById("locSource");
                if (srcEl) {
                    if (d.source === "onemap")     { srcEl.textContent = "● ONEMAP SG"; srcEl.style.color = "rgba(76,175,80,0.7)"; }
                    else if (d.source === "nominatim") { srcEl.textContent = "● OSM"; srcEl.style.color = "rgba(255,193,7,0.6)"; }
                    else                            { srcEl.textContent = ""; }
                }
            })
            .catch(function () {});
    }

    function searchPlace(text, cb) {
        if (!gpsPos) { cb("No GPS"); return; }
        fetch("/api/place-search?q=" + encodeURIComponent(text) + "&lat=" + encodeURIComponent(gpsPos.lat) + "&lng=" + encodeURIComponent(gpsPos.lng))
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.error || !d.lat) cb(d.error || "Place not found"); else cb(null, d); })
            .catch(function (e) { cb(e.message); });
    }

    function fetchRoute(destAddr, usePlaces, cb) {
        if (!gpsPos) { cb("No GPS"); return; }
        var url = "/api/address-to-latlng?address=" + encodeURIComponent(destAddr) +
            "&user_lat=" + encodeURIComponent(gpsPos.lat) +
            "&user_lng=" + encodeURIComponent(gpsPos.lng) +
            "&use_places=" + (usePlaces ? "1" : "0");
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (g) {
                if (!g.lat) { cb("Address not found"); return; }
                var mode = routingMode;
                fetch("/api/route?from_lat=" + gpsPos.lat + "&from_lng=" + gpsPos.lng +
                    "&to_lat=" + g.lat + "&to_lng=" + g.lng + "&mode=" + mode)
                    .then(function (r) { return r.json(); })
                    .then(function (rt) {
                        if (rt && !rt.error) {
                            rt.dest_lat      = g.lat;
                            rt.dest_lng      = g.lng;
                            rt.dest_display  = g.display || destAddr;
                            rt.place_name    = g.place_name || destAddr;
                            rt.geocode_source= g.source || "";
                        }
                        cb((rt.error && !(rt.steps && rt.steps.length)) ? rt.error : null, rt);
                    })
                    .catch(function (e) { cb(e.message); });
            })
            .catch(function (e) { cb(e.message); });
    }

    // =========================================================
    // SEND TEXT / CHAT
    // =========================================================
    function updateSend() { if (sendBtn) sendBtn.classList.toggle("on", !!inp.value.trim()); }

    function extractPhoneFromText(text) {
        var m = String(text || "").match(/(?:\+?65[-\s]?)?(\d{8})/);
        return m && m[1] ? m[1] : null;
    }

    function sendText(text) {
        if (!text || !text.trim() || busy) return;
        syncReplyLanguageToSelection();
        var rawText = text.trim();

        // Set customer phone shortcut
        var phoneMatch = rawText.match(/set customer phone\s+([+\d\s-]+)/i);
        if (phoneMatch && phoneMatch[1]) {
            if (setCustomerPhone(phoneMatch[1])) {
                addBubble("user", rawText);
                addBubble("assistant", uiText("customer_phone_saved") + customerPhone);
            } else {
                addBubble("assistant", uiText("invalid_phone"));
            }
            if (inp) inp.value = "";
            updateSend();
            return;
        }

        var maybePhone = extractPhoneFromText(rawText);
        if (maybePhone) setCustomerPhone(maybePhone);

        addBubble("user", rawText);
        if (inp) inp.value = "";
        updateSend();
        busy = true;
        showProc();

        // POI shortcut
        var lower = rawText.toLowerCase();
        var looksLikePlace = /nearest|haidilao|hotel|mrt|toilet|petrol|mall|restaurant|station|clinic|hospital|bank|coffee|7-11|seven.eleven/.test(lower);

        if (looksLikePlace && gpsPos) {
            searchPlace(rawText, function (placeErr, place) {
                if (!placeErr && place && place.lat) {
                    hideProc(); busy = false;
                    scannedAddr = place.address || place.name;
                    addBubble("assistant", "📍 " + (place.name || "Place found") + "\nADDRESS: " + (place.address || ""));
                    fetchRoute(place.name || place.address, true, function (routeErr, route) {
                        if (!routeErr && route && route.steps && route.steps.length) {
                            showRouteSteps(route); startLiveNavigation(route);
                        } else {
                            addBubble("assistant", uiText("route_not_found"));
                        }
                    });
                    return;
                }
                apiChat(rawText, handleChatReply);
            });
        } else {
            apiChat(rawText, handleChatReply);
        }

        function handleChatReply(err, reply) {
            hideProc(); busy = false;
            if (err) {
                addBubble("assistant", "Error: " + err);
                setTimeout(function () { speak("Error. " + err, restartMicAfterReply); }, 150);
                return;
            }
            reply = tuneReplyByLanguage(reply);
            detectLang(reply);
            addBubble("assistant", reply);

            var addrMatch = reply.match(/ADDRESS:\s*(.+)/i);
            if (addrMatch && addrMatch[1]) {
                var navAddr = addrMatch[1].trim();
                scannedAddr = navAddr;
                stopLiveNavigation();
                setTimeout(function () {
                    speak(reply.replace(/ADDRESS:\s*.*$/im, "").trim(), function () {
                        addBubble("assistant", uiText("route_starting"));
                        fetchRoute(navAddr, true, function (routeErr, route) {
                            if (!routeErr && route && route.steps && route.steps.length) {
                                showRouteSteps(route); startLiveNavigation(route);
                            } else {
                                addBubble("assistant", uiText("route_not_found"));
                                restartMicAfterReply();
                            }
                        });
                    });
                }, 150);
            } else {
                setTimeout(function () { speak(reply, restartMicAfterReply); }, 150);
            }
        }
    }

    // =========================================================
    // SCAN / PHOTO
    // =========================================================
    function handleScan(fileInput) {
        var file = fileInput.files && fileInput.files[0];
        if (!file || busy) return;
        busy = true;
        syncReplyLanguageToSelection();

        compressImage(file, function (err, img) {
            if (err) { addBubble("assistant", "Error: " + err); busy = false; return; }
            addBubble("user", "📷 Scanned (" + img.w + "×" + img.h + ", " + img.kb + "KB)", img.preview);
            showProc();

            apiScan(img.base64, function (err2, reply) {
                hideProc(); busy = false;
                fileInput.value = "";
                if (err2) { addBubble("assistant", "Error: " + err2); speak("Scan error.", restartMicAfterReply); return; }

                var parsed = null;
                try { parsed = JSON.parse(reply.replace(/```json|```/g, "").trim()); } catch (e) {}

                if (parsed && parsed.phone) setCustomerPhone(parsed.phone);

                if (parsed && parsed.address) {
                    var fullAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
                    scannedAddr = fullAddr;
                    stopLiveNavigation();
                    showDeliveryCard(parsed);

                    var voice = parsed.unit ? ("Unit " + parsed.unit + ". " + parsed.address)
                                            : (parsed.address + (parsed.postal ? " " + parsed.postal : ""));
                    detectLang(voice);
                    setTimeout(function () {
                        speak(voice, function () {
                            addBubble("assistant", uiText("route_starting"));
                            fetchRoute(fullAddr, false, function (re, route) {
                                if (!re && route && route.steps && route.steps.length) {
                                    showRouteSteps(route); startLiveNavigation(route);
                                } else {
                                    addBubble("assistant", uiText("route_not_found"));
                                    restartMicAfterReply();
                                }
                            });
                        });
                    }, 150);
                } else {
                    addBubble("assistant", "No address detected in this image.");
                    speak("No address found.", restartMicAfterReply);
                }
            });
        });
    }

    // =========================================================
    // DELIVERY CARD
    // =========================================================
    function showDeliveryCard(parsed) {
        removeEl("deliveryCard");
        var wrap = document.createElement("div");
        wrap.className = "mr a"; wrap.id = "deliveryCard";
        var html = '<div class="av">🥷</div><div class="bb a"><div class="unit-card">';
        html += '<div class="unit-label">DELIVERY ADDRESS</div>';
        if (parsed.unit)      html += '<div class="unit-num">' + esc(parsed.unit) + '</div>';
        if (parsed.address)   html += '<div class="unit-addr">' + esc(parsed.address) + (parsed.postal ? " " + esc(parsed.postal) : "") + '</div>';
        if (parsed.recipient) html += '<div class="unit-addr">👤 ' + esc(parsed.recipient) + '</div>';
        if (parsed.phone)     html += '<div class="unit-addr">📞 ' + esc(parsed.phone) + '</div>';
        if (parsed.language)  html += '<div class="unit-lang">🌐 ' + esc(parsed.language) + '</div>';
        html += '</div></div>';
        wrap.innerHTML = html;
        chatEl.appendChild(wrap);
        chatEl.scrollTop = chatEl.scrollHeight;
    }

    // =========================================================
    // ROUTE DISPLAY
    // =========================================================
    function getIcon(t, m) {
        if (t === "depart")   return "🚀";
        if (t === "arrive")   return "🏁";
        if (t === "roundabout" || t === "rotary") return "🔄";
        if (m && m.indexOf("left") >= 0)  return "⬅️";
        if (m && m.indexOf("right") >= 0) return "➡️";
        return "⬆️";
    }

    function showRouteSteps(route) {
        removeEl("routeCard");
        if (!route || !route.steps || !route.steps.length) return;

        var modeLabel   = routingMode === "walking" ? "🚶 Walk" : "🚗 Drive";
        var sourceLabel = route.geocode_source ? " · " + route.geocode_source.toUpperCase() : "";
        var totalMin    = route.total_duration ? Math.ceil(Number(route.total_duration) / 60) : 0;
        var totalKm     = route.total_distance ? (Number(route.total_distance) / 1000).toFixed(1) : 0;

        var wrap = document.createElement("div");
        wrap.className = "mr a"; wrap.id = "routeCard";
        var html = '<div class="av">🥷</div><div class="bb a" style="width:100%">';
        html += '<div style="background:rgba(227,24,55,0.08);border:1px solid rgba(227,24,55,0.2);border-radius:12px;padding:12px;margin:4px 0">';
        html += '<div style="color:#E31837;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:8px">';
        html += modeLabel + sourceLabel + ' · ' + totalMin + ' min · ' + totalKm + ' km</div>';

        route.steps.forEach(function (step, i) {
            var icon = getIcon(step.type, step.modifier);
            var dist = step.distance > 0 ? Math.round(step.distance) + "m" : "";
            html += '<div id="rs' + i + '" class="rs-step" style="display:flex;gap:8px;padding:5px;border-radius:8px;cursor:pointer;align-items:flex-start">';
            html += '<span style="width:20px;flex-shrink:0;margin-top:1px">' + icon + '</span>';
            html += '<div style="flex:1"><span style="color:#fff;font-size:12px">' + esc(step.text || "") + '</span>';
            if (dist) html += ' <span style="color:rgba(255,255,255,0.35);font-size:11px">' + dist + '</span>';
            html += '</div></div>';
        });
        html += '</div></div>';
        wrap.innerHTML = html;
        chatEl.appendChild(wrap);
        chatEl.scrollTop = chatEl.scrollHeight;
    }

    // =========================================================
    // LIVE NAVIGATION
    // =========================================================
    function startLiveNavigation(route) {
        if (!route || !route.steps || !route.steps.length) return;
        activeRoute = route; activeStepIndex = 0; lastSpokenStep = -1; navActive = true;
        notifyShownForRoute = false; arrivalPromptSpoken = false;
        rainAlertShownForRoute = false; currentWeatherInfo = null;
        arrivalAutoSent = false; rainAutoSent = false;

        highlightActiveStep();
        speakCurrentStepIfNeeded(true);

        showMap();
        if (leafletMap) {
            setTimeout(function () { drawRouteOnMap(route); leafletMap.invalidateSize(); }, 200);
        }
        if (route.dest_lat != null && route.dest_lng != null) {
            apiWeather(route.dest_lat, route.dest_lng, function (err, wd) { if (!err && wd) currentWeatherInfo = wd; });
        }
    }

    function stopLiveNavigation() {
        navActive = false; activeRoute = null; activeStepIndex = 0; lastSpokenStep = -1;
        notifyShownForRoute = false; arrivalPromptSpoken = false;
        rainAlertShownForRoute = false; currentWeatherInfo = null;
        arrivalAutoSent = false; rainAutoSent = false;
        clearRouteFromMap();
    }

    function updateLiveNavigation() {
        if (!navActive || !gpsPos || !activeRoute || !activeRoute.steps) return;
        if (activeStepIndex >= activeRoute.steps.length) return;
        if (!gpsPos.acc || gpsPos.acc > 35) return;

        var now = Date.now();
        if (now - lastGpsCheckAt < 1500) return;
        lastGpsCheckAt = now;

        var step = activeRoute.steps[activeStepIndex];
        if (!step || step.lat == null || step.lng == null) return;
        var dist = metersBetween(gpsPos.lat, gpsPos.lng, step.lat, step.lng);

        if (dist <= 80 && lastSpokenStep !== activeStepIndex) {
            speak(uiText("route_notif") + Math.round(dist) + uiText("meters") + step.text);
            lastSpokenStep = activeStepIndex;
            highlightActiveStep();
            maybeShowArrivalNotify();
            maybeShowRainAlert();
            return;
        }

        if (dist <= Math.max(20, gpsPos.acc || 20)) {
            activeStepIndex++;
            highlightActiveStep();

            var remainSecs = 0, remainMeters = 0;
            for (var i = activeStepIndex; i < activeRoute.steps.length; i++) {
                remainSecs   += Number(activeRoute.steps[i].duration || 0);
                remainMeters += Number(activeRoute.steps[i].distance || 0);
            }
            activeRoute.total_duration = remainSecs;
            activeRoute.total_distance = remainMeters;
            maybeShowArrivalNotify();
            maybeShowRainAlert();

            if (activeStepIndex < activeRoute.steps.length) {
                lastSpokenStep = -1;
                setTimeout(function () { speakCurrentStepIfNeeded(true); }, 500);
            } else {
                navActive = false; clearRouteFromMap(); speak(uiText("arrived"));
            }
        }
    }

    function highlightActiveStep() {
        if (!activeRoute || !activeRoute.steps) return;
        activeRoute.steps.forEach(function (_, i) {
            var el = document.getElementById("rs" + i);
            if (el) el.style.background = i === activeStepIndex ? "rgba(227,24,55,0.18)" : "transparent";
        });
    }

    function speakCurrentStepIfNeeded(force) {
        if (!navActive || !activeRoute || !activeRoute.steps || activeStepIndex >= activeRoute.steps.length) return;
        if (!force && lastSpokenStep === activeStepIndex) return;
        var step = activeRoute.steps[activeStepIndex];
        if (!step || !step.text) return;
        lastSpokenStep = activeStepIndex;
        detectLang(step.text);
        speak(step.text);
    }

    function maybeShowArrivalNotify() {
        if (!navActive || !activeRoute || notifyShownForRoute) return;
        var secs   = Number(activeRoute.total_duration || 0);
        var meters = Number(activeRoute.total_distance || 0);
        if ((secs > 0 && secs <= ETA_NOTIFY_SECONDS) || (meters > 0 && meters <= ETA_NOTIFY_METERS)) {
            notifyShownForRoute = true;
            if (!arrivalPromptSpoken) { arrivalPromptSpoken = true; speak(uiText("about_5_min")); }
            if (!arrivalAutoSent && customerPhone) { setTimeout(autoSendArrivalWhatsApp, 1200); }
        }
    }

    function maybeShowRainAlert() {
        if (!navActive || rainAlertShownForRoute) return;
        if (!currentWeatherInfo || !currentWeatherInfo.is_rain) return;
        rainAlertShownForRoute = true;
        speak(uiText("raining_prompt"));
        if (!rainAutoSent && customerPhone) { setTimeout(autoSendRainWhatsApp, 1200); }
    }

    // =========================================================
    // WHATSAPP / SMS
    // =========================================================
    function sanitizePhone(raw) {
        var s = String(raw || "").replace(/[^\d+]/g, "");
        if (!s) return "";
        if (s.indexOf("+") === 0) return s;
        if (s.length === 8) return "65" + s;
        return s;
    }
    function setCustomerPhone(raw) { var c = sanitizePhone(raw); if (!c) return false; customerPhone = c; return true; }
    function getCustomerPhoneForWhatsApp() { return customerPhone.replace(/^\+/, ""); }
    function getArrivalMessage()   { return "Hello, I will arrive in about 5 minutes. Please be ready to receive the parcel. Thank you."; }
    function getRainDelayMessage() { return "Hello, due to rain near your destination, I may arrive slightly later than expected. Thank you for your patience."; }

    function fireAutoWhatsApp(phone, message) {
        var p = String(phone || "");
        if (!p) return false;
        var url = "whatsapp://send?phone=" + p + "&text=" + encodeURIComponent(message);
        var fb  = "https://wa.me/" + p + "?text=" + encodeURIComponent(message);
        try { window.location.href = url; setTimeout(function () { window.open(fb, "_blank"); }, 1500); return true; }
        catch (e) { window.open(fb, "_blank"); return true; }
    }

    function showWhatsAppCard(message, onFire) {
        removeEl("waCard");
        var wrap = document.createElement("div"); wrap.className = "mr a"; wrap.id = "waCard";
        var html = '<div class="av">🥷</div><div class="bb a" style="width:100%"><div class="wa-card">';
        html += '<div class="wa-card-title">📱 WHATSAPP NOTIFICATION</div>';
        html += '<div class="wa-msg">' + esc(message) + '</div>';
        html += '<button class="wa-btn" id="waSendBtn">Send via WhatsApp</button>';
        html += '<button class="wa-btn-cancel" id="waCancelBtn">Cancel</button>';
        html += '</div></div>';
        wrap.innerHTML = html;
        chatEl.appendChild(wrap);
        chatEl.scrollTop = chatEl.scrollHeight;
        document.getElementById("waSendBtn").addEventListener("click", function () { onFire(); removeEl("waCard"); });
        document.getElementById("waCancelBtn").addEventListener("click", function () { removeEl("waCard"); });
    }

    function autoSendArrivalWhatsApp() {
        if (arrivalAutoSent || !customerPhone) return;
        arrivalAutoSent = true;
        showWhatsAppCard(getArrivalMessage(), function () {
            fireAutoWhatsApp(getCustomerPhoneForWhatsApp(), getArrivalMessage());
            addBubble("assistant", "📱 WhatsApp sent: arrival notice.");
        });
    }

    function autoSendRainWhatsApp() {
        if (rainAutoSent || !customerPhone) return;
        rainAutoSent = true;
        showWhatsAppCard(getRainDelayMessage(), function () {
            fireAutoWhatsApp(getCustomerPhoneForWhatsApp(), getRainDelayMessage());
            addBubble("assistant", "🌧️ WhatsApp sent: rain delay notice.");
        });
    }

    // =========================================================
    // LEAFLET MAP
    // =========================================================
    function driverIcon() {
        return window.L ? L.divIcon({
            html: '<div style="background:#E31837;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 6px rgba(227,24,55,0.6)"></div>',
            iconSize: [14, 14], iconAnchor: [7, 7], className: ""
        }) : null;
    }

    function destIcon() {
        return window.L ? L.divIcon({
            html: '<div style="background:#4CAF50;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 6px rgba(76,175,80,0.6)"></div>',
            iconSize: [14, 14], iconAnchor: [7, 7], className: ""
        }) : null;
    }

    function initLeafletMap() {
        if (!window.L || leafletMap) return;
        var center = gpsPos ? [gpsPos.lat, gpsPos.lng] : [1.3521, 103.8198];
        leafletMap = L.map("liveMap", { zoomControl: false, attributionControl: false }).setView(center, 15);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(leafletMap);
        if (gpsPos) addOrMoveDriverMarker(gpsPos.lat, gpsPos.lng);
        if (mapZoomIn)  mapZoomIn.addEventListener("click",  function () { leafletMap.zoomIn(); });
        if (mapZoomOut) mapZoomOut.addEventListener("click", function () { leafletMap.zoomOut(); });
        if (mapCenter)  mapCenter.addEventListener("click",  function () { if (gpsPos) leafletMap.setView([gpsPos.lat, gpsPos.lng], 16); });
        if (mapClose)   mapClose.addEventListener("click",   hideMap);
    }

    function addOrMoveDriverMarker(lat, lng) {
        if (!leafletMap || !window.L) return;
        if (mapMarker) { mapMarker.setLatLng([lat, lng]); }
        else           { mapMarker = L.marker([lat, lng], { icon: driverIcon() }).addTo(leafletMap); }
    }

    function drawRouteOnMap(route) {
        if (!leafletMap || !window.L || !route || !route.geometry) return;
        if (routeLayer) { leafletMap.removeLayer(routeLayer); routeLayer = null; }
        if (destMarker) { leafletMap.removeLayer(destMarker); destMarker = null; }
        var coords = route.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
        routeLayer = L.polyline(coords, { color: "#E31837", weight: 4, opacity: 0.85 }).addTo(leafletMap);
        if (route.dest_lat != null && route.dest_lng != null) {
            destMarker = L.marker([route.dest_lat, route.dest_lng], { icon: destIcon() }).addTo(leafletMap);
        }
        var bounds = routeLayer.getBounds();
        if (bounds.isValid()) leafletMap.fitBounds(bounds, { padding: [30, 30] });
    }

    function clearRouteFromMap() {
        if (!leafletMap) return;
        if (routeLayer) { leafletMap.removeLayer(routeLayer); routeLayer = null; }
        if (destMarker) { leafletMap.removeLayer(destMarker); destMarker = null; }
    }

    function showMap() {
        if (mapVisible) return;
        if (mapPanel) { mapPanel.classList.add("visible"); mapPanel.classList.remove("hidden"); }
        mapVisible = true;
        if (mapBtn) mapBtn.classList.add("active");
        if (!leafletMap && window.L) setTimeout(initLeafletMap, 50);
        else if (leafletMap) setTimeout(function () { leafletMap.invalidateSize(); }, 100);
    }

    function hideMap() {
        if (mapPanel) { mapPanel.classList.remove("visible"); mapPanel.classList.add("hidden"); }
        mapVisible = false;
        if (mapBtn) mapBtn.classList.remove("active");
    }

    function setMapModePill(mode) {
        if (!mpDriving || !mpWalking) return;
        if (mode === "walking") { mpDriving.classList.remove("active"); mpWalking.classList.add("active"); }
        else                    { mpWalking.classList.remove("active"); mpDriving.classList.add("active"); }
    }

    // =========================================================
    // LIVE CAM
    // =========================================================
    function openLiveCam() {
        if (camActive) return;
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } })
            .then(function (stream) {
                camStream = stream;
                if (camVideo) { camVideo.srcObject = stream; }
                if (camOverlay) camOverlay.classList.add("open");
                camActive = true;
                if (camStatus)   camStatus.textContent   = "📡 AI Camera — Point at parcel or street sign";
                if (camAiReply)  camAiReply.style.display = "none";
            })
            .catch(function (err) { addBubble("assistant", "Camera error: " + err.message); });
    }

    function closeLiveCam() {
        if (camAutoOn) toggleCamAuto();
        if (camStream) { camStream.getTracks().forEach(function (t) { t.stop(); }); camStream = null; }
        if (camVideo)  { camVideo.srcObject = null; }
        if (camOverlay) camOverlay.classList.remove("open");
        camActive = false;
    }

    function analyzeCamera() {
        if (!camActive || !camVideo || busy) return;
        var canvas = document.createElement("canvas");
        canvas.width = camVideo.videoWidth || 640;
        canvas.height= camVideo.videoHeight || 480;
        canvas.getContext("2d").drawImage(camVideo, 0, 0);
        var b64 = canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
        if (!b64) return;
        if (camStatus) camStatus.textContent = "🔍 Analysing...";
        apiScanCam(b64, getLiveCamPrompt(), function (err, reply) {
            if (camStatus) camStatus.textContent = "📡 AI Camera — ready";
            if (err) { if (camAiReply) { camAiReply.textContent = "Error: " + err; camAiReply.style.display = "block"; } return; }
            if (camAiReply) { camAiReply.textContent = reply; camAiReply.style.display = "block"; }
            var addrMatch = reply.match(/ADDRESS:\s*(.+)/i);
            if (addrMatch && addrMatch[1] && addrMatch[1].trim() !== "UNKNOWN") {
                var camAddr = addrMatch[1].trim();
                addBubble("assistant", "🧭 Camera found: " + camAddr);
                fetchRoute(camAddr, true, function (routeErr, route) {
                    if (!routeErr && route && route.steps && route.steps.length) {
                        showRouteSteps(route); startLiveNavigation(route);
                    } else {
                        addBubble("assistant", uiText("route_not_found"));
                    }
                });
            }
        });
    }

    function toggleCamAuto() {
        camAutoOn = !camAutoOn;
        if (!camAutoToggle) return;
        if (camAutoOn) {
            camAutoToggle.textContent = "⚡ Auto ON";
            camAutoToggle.classList.add("on");
            analyzeCamera();
            camAutoInterval = setInterval(analyzeCamera, 8000);
        } else {
            camAutoToggle.textContent = "⚡ Auto OFF";
            camAutoToggle.classList.remove("on");
            clearInterval(camAutoInterval);
            camAutoInterval = null;
        }
    }

    // =========================================================
    // LANGUAGE TUNING
    // =========================================================
    function normalizeCantoneseText(text) {
        return String(text || "").trim()
            .replace(/现在/g, "而家").replace(/这里/g, "呢度")
            .replace(/左转/g, "左轉").replace(/右转/g, "右轉").replace(/直走/g, "直行");
    }

    function tuneReplyByLanguage(text) {
        var t = String(text || "");
        if (isCantoneseMode()) return normalizeCantoneseText(t);
        return t;
    }

    // =========================================================
    // WIRE UP EVENTS
    // =========================================================
    renderLangBar();
    syncReplyLanguageToSelection();

    CHIPS.forEach(function (c) {
        var btn = document.createElement("button");
        btn.className = "chip"; btn.textContent = c;
        btn.addEventListener("click", function () { unlockSpeech(); sendText(c); });
        if (chipsEl) chipsEl.appendChild(btn);
    });

    if (sendBtn)  sendBtn.addEventListener("click",  function () { unlockSpeech(); sendText(inp ? inp.value : ""); });
    if (inp) {
        inp.addEventListener("input", updateSend);
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { unlockSpeech(); sendText(inp.value); } });
    }

    if (voiceBtn)  voiceBtn.addEventListener("click",  function () { unlockSpeech(); toggleMic(); });
    if (scanBtn)   scanBtn.addEventListener("click",   function () { unlockSpeech(); if (cameraIn) cameraIn.click(); });
    if (photoBtn)  photoBtn.addEventListener("click",  function () { unlockSpeech(); if (photoIn)  photoIn.click();  });
    if (cameraIn)  cameraIn.addEventListener("change", function () { handleScan(cameraIn); });
    if (photoIn)   photoIn.addEventListener("change",  function () { handleScan(photoIn);  });

    if (mapBtn) mapBtn.addEventListener("click", function () {
        unlockSpeech();
        if (mapVisible) hideMap();
        else { showMap(); setTimeout(initLeafletMap, 80); }
    });

    if (mpDriving) mpDriving.addEventListener("click", function () { routingMode = "driving"; setMapModePill("driving"); });
    if (mpWalking) mpWalking.addEventListener("click", function () { routingMode = "walking"; setMapModePill("walking"); });

    if (liveCamBtn)   liveCamBtn.addEventListener("click",   function () { unlockSpeech(); openLiveCam(); });
    if (camSnap)      camSnap.addEventListener("click",      analyzeCamera);
    if (camCloseBtn)  camCloseBtn.addEventListener("click",  closeLiveCam);
    if (camAutoToggle)camAutoToggle.addEventListener("click", toggleCamAuto);
    if (stopBtnEl)    stopBtnEl.addEventListener("click",    stopSpeak);
    if (gpsBtn)       gpsBtn.addEventListener("click",       function () { addBubble("assistant", "Retrying GPS..."); initGPS(); });

    // =========================================================
    // INIT
    // =========================================================
    initGPS();

    var mode = useRecorder ? "(recording mode)" : "(voice mode)";
    addBubble("assistant",
        uiText("ready") + " " + mode + ".\n" +
        "1\uFE0F\u20E3 " + uiText("pick_language") + "\n" +
        "2\uFE0F\u20E3 " + uiText("tap_mic_once")  + "\n" +
        "3\uFE0F\u20E3 " + uiText("scan_label")    + "\n" +
        "4\uFE0F\u20E3 " + uiText("ask_route")     + "\n" +
        "5\uFE0F\u20E3 " + uiText("rain_popup_note") + "\n" +
        "6\uFE0F\u20E3 Tap \uD83D\uDDFA\uFE0F map \u00B7 \uD83D\uDCE1 live cam"
    );

})();
