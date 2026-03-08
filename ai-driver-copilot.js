// ═══════════════════════════════════════════════════════════
//  NINJA CO-PILOT — Tap once, mic stays on (ALL platforms)
//  Smart address + nearby place search + voice directions
// ═══════════════════════════════════════════════════════════

(function () {
    "use strict";

    var MAX_DIM = 800, MAX_BYTES = 4 * 1024 * 1024;

    var LANGUAGES = [
        { label: "EN",     flag: "\ud83c\uddec\ud83c\udde7", code: "en-SG",   ai: "English" },
        { label: "\u4e2d\u6587",    flag: "\ud83c\udde8\ud83c\uddf3", code: "zh-CN",   ai: "Chinese Simplified" },
        { label: "\u7e41\u9ad4",    flag: "\ud83c\uddf9\ud83c\uddfc", code: "zh-TW",   ai: "Chinese Traditional" },
        { label: "\u5ee3\u6771\u8a71",   flag: "\ud83c\udded\ud83c\uddf0", code: "yue-Hant-HK", ai: "Cantonese" },
        { label: "Malay",  flag: "\ud83c\uddf2\ud83c\uddfe", code: "ms-MY",   ai: "Malay" },
        { label: "Tamil",  flag: "\ud83c\uddee\ud83c\uddf3", code: "ta-IN",   ai: "Tamil" },
        { label: "\u0e44\u0e17\u0e22",    flag: "\ud83c\uddf9\ud83c\udded", code: "th-TH",   ai: "Thai" },
        { label: "Vi\u1ec7t",   flag: "\ud83c\uddfb\ud83c\uddf3", code: "vi-VN",   ai: "Vietnamese" },
        { label: "Indo",   flag: "\ud83c\uddee\ud83c\udde9", code: "id-ID",   ai: "Bahasa Indonesia" },
        { label: "\ud55c\uad6d\uc5b4",   flag: "\ud83c\uddf0\ud83c\uddf7", code: "ko-KR",   ai: "Korean" },
        { label: "\u65e5\u672c\u8a9e",   flag: "\ud83c\uddef\ud83c\uddf5", code: "ja-JP",   ai: "Japanese" }
    ];

    // ─── State ───
    var busy = false, scannedAddr = null, isSpeaking = false, micActive = false;
    var isListening = false, recognition = null, gpsPos = null, selectedLang = 0;
    var routeSteps = [], routeStep = 0, speakingRoute = false;
    var currentStreet = "";

    // ─── DOM ───
    var chatEl = document.getElementById("chat"), inp = document.getElementById("inp");
    var sendBtn = document.getElementById("sendBtn"), voiceBtn = document.getElementById("voiceBtn");
    var scanBtn = document.getElementById("scanBtn"), photoBtn = document.getElementById("photoBtn");
    var navBtnEl = document.getElementById("navBtn"), stopBtnEl = document.getElementById("stopBtn");
    var sbEl = document.getElementById("sb"), micBar = document.getElementById("micBar");
    var micLabel = document.getElementById("micLabel");
    var locBar = document.getElementById("locBar"), locAddr = document.getElementById("locAddr");
    var langBar = document.getElementById("langBar"), chipsEl = document.getElementById("chips");
    var cameraIn = document.getElementById("cameraIn"), photoIn = document.getElementById("photoIn");

    // ─── Prompts ───
    function getSysPrompt() {
        var lang = LANGUAGES[selectedLang];
        var locInfo = currentStreet ? "\nDriver is currently at: " + currentStreet + (gpsPos ? " (GPS: " + gpsPos.lat.toFixed(5) + "," + gpsPos.lng.toFixed(5) + ")" : "") : "";
        return [
            "You are Ninja Co-Pilot, AI assistant for Ninja Van delivery drivers.",
            "LANGUAGE: Reply in " + lang.ai + ". Driver speaks " + lang.ai + ".",
            locInfo,
            "RULES:",
            "1. Under 60 words. Max 3 bullet points.",
            '2. Professional. No "bro", "hey", slang.',
            "3. Action first, no greetings.",
            "",
            "SPECIAL ABILITIES:",
            "- If driver asks for nearest restaurant/place/shop, respond with the place name and full address.",
            "- If driver mentions just a block number or partial address, use their current location to guess the full address.",
            "- Always include the full street address in your reply so navigation can work.",
            "",
            "When giving a place recommendation, format your reply as:",
            "PLACE: [place name]",
            "ADDRESS: [full address with postal code]",
            "This format helps the navigation system extract the address."
        ].join("\n");
    }

    var OCR = [
        "Extract ALL delivery info from this package label.",
        "Auto-detect the language on the label.",
        "IMPORTANT: If the label only shows a block/unit number without full street name, the driver is currently at: " + (currentStreet || "unknown location") + ".",
        "Use the driver's location context to infer the full address if possible.",
        "Extract unit/floor/block separately.",
        "Respond ONLY in JSON:",
        '{"address":"FULL street address (infer from context if needed)","unit":"unit/floor/block or null","postal":"postal code or null","recipient":"name or null","sender":"sender address or null","language":"detected language","confidence":"high/medium/low"}'
    ].join("\n");

    var CHIPS = ["Cannot find address", "No answer", "Traffic jam", "Damaged parcel", "Nearest petrol station", "Nearest toilet"];

    // ═══════════════════════════════════════════════════════
    //  LANGUAGE PICKER (with Cantonese)
    // ═══════════════════════════════════════════════════════
    function renderLangBar() {
        langBar.innerHTML = "";
        LANGUAGES.forEach(function (lang, i) {
            var btn = document.createElement("button");
            btn.className = "lang-btn" + (i === selectedLang ? " active" : "");
            btn.textContent = lang.flag + " " + lang.label;
            btn.addEventListener("click", function () {
                selectedLang = i;
                renderLangBar();
                micLabel.textContent = "HANDS-FREE \u2022 " + lang.flag + " " + lang.ai;
                if (micActive) { stopListening(); setTimeout(startListening, 300); }
                addBubble("assistant", "\ud83c\udf10 " + lang.flag + " " + lang.ai);
            });
            langBar.appendChild(btn);
        });
    }

    // ═══════════════════════════════════════════════════════
    //  IMAGE COMPRESSION
    // ═══════════════════════════════════════════════════════
    function compressImage(file, cb) {
        var reader = new FileReader();
        reader.onload = function (e) {
            var img = new Image();
            img.onload = function () {
                var w = img.width, h = img.height;
                if (w > MAX_DIM || h > MAX_DIM) { var r = Math.min(MAX_DIM / w, MAX_DIM / h); w = Math.round(w * r); h = Math.round(h * r); }
                var c = document.createElement("canvas"); c.width = w; c.height = h;
                c.getContext("2d").drawImage(img, 0, 0, w, h);
                var q = 0.8, b64 = c.toDataURL("image/jpeg", q);
                while (b64.length * 0.75 > MAX_BYTES && q > 0.2) { q -= 0.1; b64 = c.toDataURL("image/jpeg", q); }
                if (b64.length * 0.75 > MAX_BYTES) { c.width = Math.round(w * 0.5); c.height = Math.round(h * 0.5); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); b64 = c.toDataURL("image/jpeg", 0.5); w = c.width; h = c.height; }
                cb(null, { base64: b64.split(",")[1], preview: b64, w: w, h: h, kb: Math.round((b64.length * 3) / 4 / 1024) });
            };
            img.onerror = function () { cb("Failed to load image"); };
            img.src = e.target.result;
        };
        reader.onerror = function () { cb("Failed to read file"); };
        reader.readAsDataURL(file);
    }

    // ═══════════════════════════════════════════════════════
    //  API
    // ═══════════════════════════════════════════════════════
    function apiChat(text, cb) {
        fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ system: getSysPrompt(), messages: [{ role: "user", content: text }] })
        }).then(function (r) { return r.json(); }).then(function (d) {
            cb(d.error ? (typeof d.error === "string" ? d.error : JSON.stringify(d.error)) : null, d.reply || "");
        }).catch(function (e) { cb(e.message); });
    }

    function apiScan(base64, cb) {
        // Update OCR with current location context
        var ocrPrompt = OCR.replace("unknown location", currentStreet || "unknown");
        fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ system: getSysPrompt(), image_base64: base64, ocr_prompt: ocrPrompt })
        }).then(function (r) { return r.json(); }).then(function (d) {
            cb(d.error ? (typeof d.error === "string" ? d.error : JSON.stringify(d.error)) : null, d.reply || "");
        }).catch(function (e) { cb(e.message); });
    }

    // ═══════════════════════════════════════════════════════
    //  TTS (speaks in selected language)
    // ═══════════════════════════════════════════════════════
    var ttsTimer = null;
    function speak(text, onDone) {
        if (!window.speechSynthesis) { if (onDone) onDone(); return; }
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.rate = 0.95;
        u.lang = LANGUAGES[selectedLang].code;
        u.onstart = function () { isSpeaking = true; sbEl.style.display = "flex"; };
        u.onend = function () { isSpeaking = false; sbEl.style.display = "none"; clearInterval(ttsTimer); if (onDone) onDone(); };
        ttsTimer = setInterval(function () { window.speechSynthesis.resume(); }, 10000);
        window.speechSynthesis.speak(u);
    }
    function stopSpeak() { if (window.speechSynthesis) window.speechSynthesis.cancel(); isSpeaking = false; sbEl.style.display = "none"; clearInterval(ttsTimer); speakingRoute = false; }

    // ═══════════════════════════════════════════════════════
    //  MIC — Tap once = ON, tap again = OFF (all platforms)
    //  Uses continuous mode so it stays alive on iOS
    // ═══════════════════════════════════════════════════════
    function toggleMic() {
        if (micActive) { stopMic(); return; }
        micActive = true;
        voiceBtn.classList.add("active");
        voiceBtn.querySelector("span:last-child").textContent = "MIC ON";
        micBar.classList.add("on");
        micLabel.textContent = "HANDS-FREE \u2022 " + LANGUAGES[selectedLang].flag + " " + LANGUAGES[selectedLang].ai;
        startListening();
    }

    function stopMic() {
        micActive = false; isListening = false;
        stopListening();
        voiceBtn.classList.remove("active");
        voiceBtn.querySelector("span:last-child").textContent = "TAP TO SPEAK";
        micBar.classList.remove("on");
    }

    function startListening() {
        if (!micActive || isListening || isSpeaking || busy) return;
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { alert("Speech not supported"); stopMic(); return; }

        recognition = new SR();
        recognition.continuous = true;   // Stay alive — works better on iOS
        recognition.interimResults = false;
        recognition.lang = LANGUAGES[selectedLang].code;

        recognition.onresult = function (e) {
            // Get the latest final result
            for (var i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) {
                    var text = e.results[i][0].transcript.trim();
                    if (text) {
                        // Pause listening while processing
                        stopListening();
                        sendText(text);
                    }
                }
            }
        };

        recognition.onerror = function (e) {
            isListening = false;
            if (micActive && e.error !== "aborted") {
                setTimeout(function () { if (micActive && !isSpeaking && !busy) startListening(); }, 1000);
            }
        };

        recognition.onend = function () {
            isListening = false;
            // Auto-restart if mic still active
            if (micActive && !isSpeaking && !busy) {
                setTimeout(function () { if (micActive && !isSpeaking && !busy && !isListening) startListening(); }, 300);
            }
        };

        try { recognition.start(); isListening = true; }
        catch (e) { setTimeout(function () { if (micActive) startListening(); }, 500); }
    }

    function stopListening() {
        if (recognition) { try { recognition.stop(); } catch (e) {} }
        isListening = false;
    }

    function restartMicAfterReply() {
        if (!micActive) return;
        setTimeout(function () { if (micActive && !isSpeaking && !busy && !isListening) startListening(); }, 500);
    }

    // ═══════════════════════════════════════════════════════
    //  GPS + REVERSE GEOCODE
    // ═══════════════════════════════════════════════════════
    function initGPS() {
        if (!navigator.geolocation) { locAddr.textContent = "GPS not available"; return; }
        navigator.geolocation.watchPosition(
            function (p) {
                gpsPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
                locBar.classList.remove("no-gps");
                reverseGeocode(gpsPos.lat, gpsPos.lng);
            },
            function () { locBar.classList.add("no-gps"); locAddr.textContent = "GPS searching..."; },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
    }
    function reverseGeocode(lat, lng) {
        fetch("/api/geocode?lat=" + lat + "&lng=" + lng)
            .then(function (r) { return r.json(); })
            .then(function (d) { currentStreet = d.address || ""; locAddr.textContent = currentStreet || (lat.toFixed(5) + ", " + lng.toFixed(5)); })
            .catch(function () { locAddr.textContent = lat.toFixed(5) + ", " + lng.toFixed(5); });
    }

    // ═══════════════════════════════════════════════════════
    //  ROUTE — fetch real directions + speak them
    // ═══════════════════════════════════════════════════════
    function fetchRoute(destAddr, callback) {
        if (!gpsPos) { callback("GPS not available"); return; }
        fetch("/api/address-to-latlng?address=" + encodeURIComponent(destAddr))
            .then(function (r) { return r.json(); })
            .then(function (geo) {
                if (!geo.lat) { callback("Address not found"); return; }
                fetch("/api/route?from_lat=" + gpsPos.lat + "&from_lng=" + gpsPos.lng + "&to_lat=" + geo.lat + "&to_lng=" + geo.lng)
                    .then(function (r) { return r.json(); })
                    .then(function (route) { callback(route.error && !route.steps.length ? route.error : null, route); })
                    .catch(function (e) { callback(e.message); });
            }).catch(function (e) { callback(e.message); });
    }

    function showRouteSteps(route) {
        removeEl("routeCard"); routeSteps = route.steps || []; routeStep = 0;
        if (!routeSteps.length) return;
        var div = document.createElement("div"); div.id = "routeCard";
        var html = '<div style="background:rgba(76,175,80,0.1);border:1px solid rgba(76,175,80,0.2);border-radius:12px;padding:12px;margin:8px 0">';
        html += '<div style="color:#4CAF50;font-size:10px;font-weight:600;letter-spacing:1px;margin-bottom:6px">\ud83d\udea3 ROUTE \u2022 ' + esc(route.summary || "") + '</div>';
        routeSteps.forEach(function (s, i) {
            html += '<div id="rs' + i + '" style="display:flex;align-items:flex-start;gap:8px;padding:6px;border-radius:8px;margin-bottom:2px;' + (i === 0 ? 'background:rgba(227,24,55,0.1)' : '') + '">';
            html += '<span style="font-size:16px;flex-shrink:0;width:22px;text-align:center">' + getIcon(s.type, s.modifier) + '</span>';
            html += '<div style="flex:1"><div style="color:#fff;font-size:12px;font-weight:500">' + esc(s.text) + '</div></div></div>';
        });
        html += '<div style="display:flex;gap:6px;margin-top:8px">';
        html += '<button id="rSpk" style="flex:2;padding:10px;border-radius:8px;border:none;background:#E31837;color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:\'DM Sans\'">\ud83d\udd0a Speak Directions</button>';
        html += '<button id="rGm" style="flex:1;padding:10px;border-radius:8px;border:none;background:#4285F4;color:#fff;font-size:11px;font-weight:700;cursor:pointer;font-family:\'DM Sans\'">\ud83d\uddfa Maps</button>';
        html += '<button id="rWz" style="flex:1;padding:10px;border-radius:8px;border:none;background:#33CCFF;color:#000;font-size:11px;font-weight:700;cursor:pointer;font-family:\'DM Sans\'">\ud83d\udea6 Waze</button>';
        html += '</div></div>';
        div.innerHTML = html; chatEl.appendChild(div); scrollDown();
        document.getElementById("rSpk").addEventListener("click", speakAllSteps);
        document.getElementById("rGm").addEventListener("click", function () { openMaps(scannedAddr); });
        document.getElementById("rWz").addEventListener("click", function () { openWaze(scannedAddr); });
    }

    function getIcon(t, m) {
        if (t === "depart") return "\ud83d\ude80"; if (t === "arrive") return "\ud83c\udfc1";
        if (t === "roundabout" || t === "rotary") return "\ud83d\udd04";
        if (m && m.indexOf("left") >= 0) return "\u2b05\ufe0f";
        if (m && m.indexOf("right") >= 0) return "\u27a1\ufe0f";
        return "\u2b06\ufe0f";
    }

    function speakAllSteps() {
        if (speakingRoute) { stopSpeak(); speakingRoute = false; return; }
        speakingRoute = true; routeStep = 0; speakNextStep();
    }
    function speakNextStep() {
        if (!speakingRoute || routeStep >= routeSteps.length) { speakingRoute = false; restartMicAfterReply(); return; }
        routeSteps.forEach(function (_, i) {
            var el = document.getElementById("rs" + i);
            if (el) el.style.background = i === routeStep ? "rgba(227,24,55,0.1)" : "transparent";
        });
        var el = document.getElementById("rs" + routeStep);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        speak("Step " + (routeStep + 1) + ". " + routeSteps[routeStep].text, function () { routeStep++; setTimeout(speakNextStep, 400); });
    }

    function openMaps(dest) {
        var o = gpsPos ? gpsPos.lat + "," + gpsPos.lng : "";
        var ua = navigator.userAgent.toLowerCase();
        if (/android/.test(ua)) window.location.href = "google.navigation:q=" + encodeURIComponent(dest) + "&mode=d";
        else if (/iphone|ipad/.test(ua)) window.location.href = "maps://?daddr=" + encodeURIComponent(dest) + "&dirflg=d";
        else window.open("https://www.google.com/maps/dir/?api=1" + (o ? "&origin=" + o : "") + "&destination=" + encodeURIComponent(dest) + "&travelmode=driving", "_blank");
    }
    function openWaze(dest) { window.open("https://waze.com/ul?q=" + encodeURIComponent(dest) + "&navigate=yes", "_blank"); }

    // ═══════════════════════════════════════════════════════
    //  DELIVERY CARD
    // ═══════════════════════════════════════════════════════
    function showDeliveryCard(parsed) {
        removeEl("deliveryCard");
        var fullAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
        var mapSrc = gpsPos ? "https://maps.google.com/maps?saddr=" + gpsPos.lat + "," + gpsPos.lng + "&daddr=" + encodeURIComponent(fullAddr) + "&output=embed"
            : "https://maps.google.com/maps?q=" + encodeURIComponent(fullAddr) + "&z=16&output=embed";
        var div = document.createElement("div"); div.id = "deliveryCard"; var html = "";
        if (parsed.unit) {
            html += '<div class="unit-card"><div class="unit-label">UNIT / BLOCK</div><div class="unit-num">' + esc(parsed.unit) + '</div><div class="unit-addr">' + esc(parsed.address) + '</div>';
            if (parsed.language) html += '<div class="unit-lang">\ud83c\udf10 ' + esc(parsed.language) + '</div>';
            html += '</div>';
        } else {
            html += '<div class="unit-card"><div class="unit-label">DELIVERY ADDRESS</div><div class="unit-num" style="font-size:20px">' + esc(parsed.address) + '</div>';
            if (parsed.postal) html += '<div class="unit-addr">\ud83d\udcee ' + esc(parsed.postal) + '</div>';
            html += '</div>';
        }
        if (parsed.recipient) html += '<div style="color:rgba(255,255,255,0.6);font-size:12px;padding:4px 0">\ud83d\udc64 ' + esc(parsed.recipient) + '</div>';
        html += '<div class="anav"><div class="anav-title"><div class="anav-dot"></div>NAVIGATING</div><div class="mf"><iframe src="' + mapSrc + '" width="100%" height="180" allowfullscreen loading="lazy"></iframe></div></div>';
        div.innerHTML = html; chatEl.appendChild(div); scrollDown();
    }

    // ═══════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════
    function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
    function scrollDown() { chatEl.scrollTop = chatEl.scrollHeight; }
    function removeEl(id) { var el = document.getElementById(id); if (el) el.remove(); }
    function addBubble(role, text, imgUrl) {
        var row = document.createElement("div"); row.className = "mr " + (role === "user" ? "u" : "a");
        var html = ""; if (role === "assistant") html += '<div class="av">\ud83e\udd77</div>';
        html += '<div class="bb ' + (role === "user" ? "u" : "a") + '">';
        if (imgUrl) html += '<img src="' + imgUrl + '" alt="">';
        html += esc(text) + "</div>"; row.innerHTML = html; chatEl.appendChild(row); scrollDown();
    }
    function showProc() { var el = document.createElement("div"); el.id = "proc"; el.className = "proc"; el.textContent = "Processing..."; chatEl.appendChild(el); scrollDown(); }
    function hideProc() { removeEl("proc"); }
    function updateSend() { sendBtn.classList.toggle("on", !!inp.value.trim()); }

    // ═══════════════════════════════════════════════════════
    //  SEND TEXT — detect "nearest X" and extract ADDRESS
    // ═══════════════════════════════════════════════════════
    function sendText(overrideText) {
        var text = overrideText || inp.value;
        if (!text || !text.trim() || busy) return;
        addBubble("user", text.trim());
        inp.value = ""; updateSend(); busy = true; showProc();

        apiChat(text.trim(), function (err, reply) {
            hideProc(); busy = false;
            if (err) { addBubble("assistant", "Error: " + err); restartMicAfterReply(); return; }

            addBubble("assistant", reply);

            // Check if AI reply contains an ADDRESS: line — auto-navigate to it
            var addrMatch = reply.match(/ADDRESS:\s*(.+)/i);
            if (addrMatch && addrMatch[1]) {
                var navAddr = addrMatch[1].trim();
                scannedAddr = navAddr;

                speak(reply.replace(/[\u2022\-\*]/g, "").replace(/\n+/g, ". "), function () {
                    // Auto-fetch route and speak directions
                    addBubble("assistant", "\ud83d\uddfa Getting directions to " + navAddr + "...");
                    fetchRoute(navAddr, function (routeErr, route) {
                        if (!routeErr && route && route.steps && route.steps.length) {
                            showRouteSteps(route);
                            speak("Route found. " + route.steps.length + " steps. About " + Math.round((route.total_duration || 0) / 60) + " minutes.", function () {
                                speakAllSteps();
                            });
                        } else {
                            speak("Opening maps navigation.", function () { openMaps(navAddr); restartMicAfterReply(); });
                        }
                    });
                });
            } else {
                // Normal reply — just speak it
                speak(reply.replace(/[\u2022\-\*]/g, "").replace(/\n+/g, ". "), function () { restartMicAfterReply(); });
            }
        });
    }

    // ═══════════════════════════════════════════════════════
    //  SCAN LABEL
    // ═══════════════════════════════════════════════════════
    function handleScan(fileInput) {
        var file = fileInput.files && fileInput.files[0];
        if (!file || busy) return;
        busy = true;
        compressImage(file, function (err, img) {
            if (err) { addBubble("assistant", "Error: " + err); busy = false; return; }
            addBubble("user", "\ud83d\udcf7 Scanned (" + img.w + "\u00d7" + img.h + ", " + img.kb + "KB)", img.preview);
            showProc();
            apiScan(img.base64, function (err2, reply) {
                hideProc(); busy = false; fileInput.value = "";
                if (err2) { addBubble("assistant", "Error: " + err2); restartMicAfterReply(); return; }
                var parsed = null;
                try { parsed = JSON.parse(reply.replace(/```json|```/g, "").trim()); } catch (e) {}
                if (parsed && parsed.address) {
                    var fullAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
                    scannedAddr = fullAddr;
                    showDeliveryCard(parsed);
                    var voiceMsg = parsed.unit ? "Unit " + parsed.unit + ". " + parsed.address + "." : parsed.address + ".";
                    speak(voiceMsg, function () {
                        addBubble("assistant", "\ud83d\uddfa Getting route directions...");
                        fetchRoute(fullAddr, function (routeErr, route) {
                            if (!routeErr && route && route.steps && route.steps.length) {
                                showRouteSteps(route);
                                speak("Route found. " + route.steps.length + " steps.", function () { speakAllSteps(); });
                            } else {
                                speak("Opening maps.", function () { openMaps(fullAddr); restartMicAfterReply(); });
                            }
                        });
                    });
                } else { addBubble("assistant", reply); restartMicAfterReply(); }
            });
        });
    }

    // ═══════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════
    renderLangBar();
    CHIPS.forEach(function (c) {
        var btn = document.createElement("button"); btn.className = "chip"; btn.textContent = c;
        btn.addEventListener("click", function () { sendText(c); }); chipsEl.appendChild(btn);
    });
    sendBtn.addEventListener("click", function () { sendText(); });
    inp.addEventListener("input", updateSend);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") sendText(); });
    voiceBtn.addEventListener("click", toggleMic);
    scanBtn.addEventListener("click", function () { cameraIn.click(); });
    photoBtn.addEventListener("click", function () { photoIn.click(); });
    cameraIn.addEventListener("change", function () { handleScan(cameraIn); });
    photoIn.addEventListener("change", function () { handleScan(photoIn); });
    navBtnEl.addEventListener("click", function () {
        if (scannedAddr) { fetchRoute(scannedAddr, function (e, r) { if (!e && r && r.steps.length) { showRouteSteps(r); speakAllSteps(); } else openMaps(scannedAddr); }); }
    });
    stopBtnEl.addEventListener("click", stopSpeak);
    initGPS();
    addBubble("assistant", "Ready.\n1\ufe0f\u20e3 Pick language\n2\ufe0f\u20e3 Tap \ud83c\udfa4 once \u2192 mic stays on\n3\ufe0f\u20e3 Scan label or say \"nearest haidilao\"");
})();
