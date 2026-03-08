// ═══════════════════════════════════════════════════════════
//  NINJA CO-PILOT — Works on iPhone + Android + Desktop
//  iOS: tap to speak each time (big button after AI replies)
//  Android/Desktop: auto-restart mic (hands-free)
// ═══════════════════════════════════════════════════════════

(function () {
    "use strict";

    var MAX_DIM = 800, MAX_BYTES = 4 * 1024 * 1024;

    // ─── Detect iOS ───
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

    // ─── Languages ───
    var LANGUAGES = [
        { label: "EN",    flag: "\ud83c\uddec\ud83c\udde7", code: "en-SG",  ai: "English" },
        { label: "\u4e2d\u6587",   flag: "\ud83c\udde8\ud83c\uddf3", code: "zh-CN",  ai: "Chinese (Simplified)" },
        { label: "\u7e41\u9ad4",   flag: "\ud83c\uddf9\ud83c\uddfc", code: "zh-TW",  ai: "Chinese (Traditional)" },
        { label: "Malay", flag: "\ud83c\uddf2\ud83c\uddfe", code: "ms-MY",  ai: "Malay" },
        { label: "Tamil", flag: "\ud83c\uddee\ud83c\uddf3", code: "ta-IN",  ai: "Tamil" },
        { label: "\u0e44\u0e17\u0e22",   flag: "\ud83c\uddf9\ud83c\udded", code: "th-TH",  ai: "Thai" },
        { label: "Vi\u1ec7t",  flag: "\ud83c\uddfb\ud83c\uddf3", code: "vi-VN",  ai: "Vietnamese" },
        { label: "Indo",  flag: "\ud83c\uddee\ud83c\udde9", code: "id-ID",  ai: "Bahasa Indonesia" },
        { label: "\ud55c\uad6d\uc5b4",  flag: "\ud83c\uddf0\ud83c\uddf7", code: "ko-KR",  ai: "Korean" },
        { label: "\u65e5\u672c\u8a9e",  flag: "\ud83c\uddef\ud83c\uddf5", code: "ja-JP",  ai: "Japanese" }
    ];

    // ─── State ───
    var busy = false;
    var scannedAddr = null;
    var isSpeaking = false;
    var micActive = false;
    var isListening = false;
    var recognition = null;
    var gpsPos = null;
    var selectedLang = 0;

    // ─── DOM ───
    var chatEl = document.getElementById("chat");
    var inp = document.getElementById("inp");
    var sendBtn = document.getElementById("sendBtn");
    var voiceBtn = document.getElementById("voiceBtn");
    var scanBtn = document.getElementById("scanBtn");
    var photoBtn = document.getElementById("photoBtn");
    var navBtnEl = document.getElementById("navBtn");
    var stopBtnEl = document.getElementById("stopBtn");
    var sbEl = document.getElementById("sb");
    var micBar = document.getElementById("micBar");
    var micLabel = document.getElementById("micLabel");
    var locBar = document.getElementById("locBar");
    var locAddr = document.getElementById("locAddr");
    var langBar = document.getElementById("langBar");
    var chipsEl = document.getElementById("chips");
    var cameraIn = document.getElementById("cameraIn");
    var photoIn = document.getElementById("photoIn");
    var iosTap = document.getElementById("iosTap");
    var iosTapBtn = document.getElementById("iosTapBtn");

    // ─── Prompts ───
    function getSysPrompt() {
        var lang = LANGUAGES[selectedLang];
        return [
            "You are Ninja Co-Pilot, an AI assistant for delivery drivers.",
            "LANGUAGE RULE (MOST IMPORTANT):",
            "The driver speaks " + lang.ai + ". You MUST reply in " + lang.ai + ".",
            "OTHER RULES:",
            "1. ALL replies under 60 words. Max 3 bullet points.",
            '2. Professional tone. No "bro", "hey", "dude".',
            "3. Start with action directly. No greetings.",
            "4. \u2022 Action: [what to do] \u2022 Note: [context]",
            "5. Solution first."
        ].join("\n");
    }

    var OCR = [
        "Extract ALL delivery info from this package label.",
        "Auto-detect the language on the label.",
        "Extract unit/floor/block number separately (e.g. #12-345, Blk 123, Unit 5).",
        "Respond ONLY in JSON:",
        '{"address":"full street address","unit":"unit/floor/block or null","postal":"postal code or null","recipient":"name or null","sender":"sender address or null","language":"detected language","confidence":"high/medium/low"}'
    ].join("\n");

    var CHIPS = ["Cannot find address", "No answer", "Traffic jam", "Damaged parcel", "Wrong address", "Gate locked"];

    // ═══════════════════════════════════════════════════════
    //  LANGUAGE PICKER
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
                if (micActive && recognition) { recognition.stop(); isListening = false; }
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
                if (w > MAX_DIM || h > MAX_DIM) {
                    var r = Math.min(MAX_DIM / w, MAX_DIM / h);
                    w = Math.round(w * r); h = Math.round(h * r);
                }
                var c = document.createElement("canvas");
                c.width = w; c.height = h;
                c.getContext("2d").drawImage(img, 0, 0, w, h);
                var q = 0.8, b64 = c.toDataURL("image/jpeg", q);
                while (b64.length * 0.75 > MAX_BYTES && q > 0.2) { q -= 0.1; b64 = c.toDataURL("image/jpeg", q); }
                if (b64.length * 0.75 > MAX_BYTES) {
                    c.width = Math.round(w * 0.5); c.height = Math.round(h * 0.5);
                    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
                    b64 = c.toDataURL("image/jpeg", 0.5); w = c.width; h = c.height;
                }
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
        fetch("/api/chat", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ system: getSysPrompt(), messages: [{ role: "user", content: text }] })
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.error) cb(typeof d.error === "string" ? d.error : JSON.stringify(d.error));
            else cb(null, d.reply || "");
        }).catch(function (e) { cb(e.message); });
    }

    function apiScan(base64, cb) {
        fetch("/api/scan", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ system: getSysPrompt(), image_base64: base64, ocr_prompt: OCR })
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.error) cb(typeof d.error === "string" ? d.error : JSON.stringify(d.error));
            else cb(null, d.reply || "");
        }).catch(function (e) { cb(e.message); });
    }

    // ═══════════════════════════════════════════════════════
    //  TEXT-TO-SPEECH
    // ═══════════════════════════════════════════════════════
    var ttsTimer = null;
    function speak(text, onDone) {
        if (!window.speechSynthesis) { if (onDone) onDone(); return; }
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.rate = 0.95;
        u.lang = LANGUAGES[selectedLang].code;
        u.onstart = function () { isSpeaking = true; sbEl.style.display = "flex"; };
        u.onend = function () {
            isSpeaking = false; sbEl.style.display = "none";
            clearInterval(ttsTimer);
            if (onDone) onDone();
        };
        // iOS Safari fix: TTS pauses after ~15s, keep it alive
        if (isIOS) {
            ttsTimer = setInterval(function () { window.speechSynthesis.resume(); }, 10000);
        }
        window.speechSynthesis.speak(u);
    }

    function stopSpeak() {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        isSpeaking = false; sbEl.style.display = "none";
        clearInterval(ttsTimer);
    }

    // ═══════════════════════════════════════════════════════
    //  SPEECH-TO-TEXT
    //  iOS: must be from direct user tap (no auto-restart)
    //  Android/Desktop: can auto-restart with setTimeout
    // ═══════════════════════════════════════════════════════
    function doListen() {
        // This is called from a direct user tap (works on iOS)
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { alert("Speech not supported in this browser"); return; }

        // Hide iOS tap button while listening
        iosTap.classList.remove("show");

        recognition = new SR();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = LANGUAGES[selectedLang].code;

        recognition.onresult = function (e) {
            var text = e.results[0][0].transcript;
            isListening = false;
            voiceBtn.querySelector("span:last-child").textContent = micActive ? "MIC ON" : "TAP TO SPEAK";
            if (text.trim()) {
                sendText(text.trim());
            } else {
                // Empty result
                if (!isIOS && micActive) restartMic(500);
                else if (isIOS && micActive) showIOSTap();
            }
        };

        recognition.onerror = function (e) {
            isListening = false;
            voiceBtn.querySelector("span:last-child").textContent = micActive ? "MIC ON" : "TAP TO SPEAK";
            if (!isIOS && micActive) {
                restartMic(e.error === "no-speech" ? 300 : 2000);
            } else if (isIOS && micActive) {
                showIOSTap();
            }
        };

        recognition.onend = function () {
            isListening = false;
            voiceBtn.querySelector("span:last-child").textContent = micActive ? "MIC ON" : "TAP TO SPEAK";
            if (!isIOS && micActive && !busy && !isSpeaking) {
                restartMic(300);
            }
            // iOS: don't auto-restart, wait for user tap
        };

        try {
            recognition.start();
            isListening = true;
            voiceBtn.querySelector("span:last-child").textContent = "LISTENING...";
        } catch (e) {
            if (!isIOS && micActive) restartMic(500);
        }
    }

    function toggleMic() {
        if (micActive) {
            // Turn OFF
            micActive = false; isListening = false;
            if (recognition) recognition.stop();
            voiceBtn.classList.remove("active");
            voiceBtn.querySelector("span:last-child").textContent = "TAP TO SPEAK";
            micBar.classList.remove("on");
            iosTap.classList.remove("show");
            return;
        }
        // Turn ON
        micActive = true;
        voiceBtn.classList.add("active");
        voiceBtn.querySelector("span:last-child").textContent = "MIC ON";
        micBar.classList.add("on");
        micLabel.textContent = "HANDS-FREE \u2022 " + LANGUAGES[selectedLang].flag + " " + LANGUAGES[selectedLang].ai;
        // Start listening — this is from a direct user tap so it works on iOS
        doListen();
    }

    // Android/Desktop only — auto-restart after AI speaks
    function restartMic(delay) {
        if (!micActive || isIOS) return;
        setTimeout(function () {
            if (micActive && !busy && !isSpeaking && !isListening) doListen();
        }, delay || 500);
    }

    // iOS: show big "TAP TO SPEAK AGAIN" button
    function showIOSTap() {
        if (!isIOS || !micActive) return;
        iosTap.classList.add("show");
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
            .then(function (d) { locAddr.textContent = d.address || (lat.toFixed(5) + ", " + lng.toFixed(5)); })
            .catch(function () { locAddr.textContent = lat.toFixed(5) + ", " + lng.toFixed(5); });
    }

    // ═══════════════════════════════════════════════════════
    //  NAVIGATION
    // ═══════════════════════════════════════════════════════
    function autoNavigate(dest) {
        var ua = navigator.userAgent.toLowerCase();
        if (/android/.test(ua)) {
            window.location.href = "google.navigation:q=" + encodeURIComponent(dest) + "&mode=d";
        } else if (/iphone|ipad/.test(ua)) {
            window.location.href = "maps://?daddr=" + encodeURIComponent(dest) + "&dirflg=d";
        } else {
            var o = gpsPos ? gpsPos.lat + "," + gpsPos.lng : "";
            window.open("https://www.google.com/maps/dir/?api=1" + (o ? "&origin=" + o : "") + "&destination=" + encodeURIComponent(dest) + "&travelmode=driving", "_blank");
        }
    }

    function openGoogleMaps(dest) {
        var o = gpsPos ? gpsPos.lat + "," + gpsPos.lng : "";
        window.open("https://www.google.com/maps/dir/?api=1" + (o ? "&origin=" + o : "") + "&destination=" + encodeURIComponent(dest) + "&travelmode=driving", "_blank");
    }
    function openWaze(dest) {
        window.open("https://waze.com/ul?q=" + encodeURIComponent(dest) + "&navigate=yes", "_blank");
    }

    // ═══════════════════════════════════════════════════════
    //  DELIVERY CARD
    // ═══════════════════════════════════════════════════════
    function showDeliveryCard(parsed) {
        removeEl("deliveryCard");
        var fullAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
        var mapSrc = gpsPos
            ? "https://maps.google.com/maps?saddr=" + gpsPos.lat + "," + gpsPos.lng + "&daddr=" + encodeURIComponent(fullAddr) + "&output=embed"
            : "https://maps.google.com/maps?q=" + encodeURIComponent(fullAddr) + "&z=16&output=embed";

        var div = document.createElement("div"); div.id = "deliveryCard";
        var html = "";
        if (parsed.unit) {
            html += '<div class="unit-card"><div class="unit-label">UNIT / BLOCK</div><div class="unit-num">' + esc(parsed.unit) + '</div><div class="unit-addr">' + esc(parsed.address) + '</div>';
            if (parsed.language) html += '<div class="unit-lang">\ud83c\udf10 ' + esc(parsed.language) + '</div>';
            html += '</div>';
        } else {
            html += '<div class="unit-card"><div class="unit-label">DELIVERY ADDRESS</div><div class="unit-num" style="font-size:20px">' + esc(parsed.address) + '</div>';
            if (parsed.postal) html += '<div class="unit-addr">\ud83d\udcee ' + esc(parsed.postal) + '</div>';
            if (parsed.language) html += '<div class="unit-lang">\ud83c\udf10 ' + esc(parsed.language) + '</div>';
            html += '</div>';
        }
        if (parsed.recipient) html += '<div style="color:rgba(255,255,255,0.6);font-size:12px;padding:4px 0">\ud83d\udc64 ' + esc(parsed.recipient) + '</div>';
        html += '<div class="anav"><div class="anav-title"><div class="anav-dot"></div>AUTO-NAVIGATING</div><div class="mf"><iframe src="' + mapSrc + '" width="100%" height="180" allowfullscreen loading="lazy"></iframe></div><div class="anav-btns"><button class="bg" id="navG">\ud83d\uddfa Google Maps</button><button class="bw" id="navW">\ud83d\udea6 Waze</button></div></div>';
        div.innerHTML = html; chatEl.appendChild(div); scrollDown();
        document.getElementById("navG").addEventListener("click", function () { openGoogleMaps(fullAddr); });
        document.getElementById("navW").addEventListener("click", function () { openWaze(fullAddr); });
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

    // Called after AI replies — decide how to restart mic
    function afterAIReply() {
        if (!micActive) return;
        if (isIOS) {
            showIOSTap(); // iOS: show big tap button
        } else {
            restartMic(500); // Android/Desktop: auto-restart
        }
    }

    // ═══════════════════════════════════════════════════════
    //  SEND TEXT
    // ═══════════════════════════════════════════════════════
    function sendText(overrideText) {
        var text = overrideText || inp.value;
        if (!text || !text.trim() || busy) return;
        iosTap.classList.remove("show"); // hide iOS tap while processing
        addBubble("user", text.trim());
        inp.value = ""; updateSend(); busy = true; showProc();
        apiChat(text.trim(), function (err, reply) {
            hideProc(); busy = false;
            if (err) { addBubble("assistant", "Error: " + err); afterAIReply(); }
            else {
                addBubble("assistant", reply);
                speak(reply.replace(/[\u2022\-\*]/g, "").replace(/\n+/g, ". "), function () {
                    afterAIReply();
                });
            }
        });
    }

    // ═══════════════════════════════════════════════════════
    //  SCAN LABEL
    // ═══════════════════════════════════════════════════════
    function handleScan(fileInput) {
        var file = fileInput.files && fileInput.files[0];
        if (!file || busy) return;
        busy = true; iosTap.classList.remove("show");
        compressImage(file, function (err, img) {
            if (err) { addBubble("assistant", "Error: " + err); busy = false; return; }
            addBubble("user", "\ud83d\udcf7 Scanned (" + img.w + "\u00d7" + img.h + ", " + img.kb + "KB)", img.preview);
            showProc();
            apiScan(img.base64, function (err2, reply) {
                hideProc(); busy = false; fileInput.value = "";
                if (err2) { addBubble("assistant", "Error: " + err2); afterAIReply(); return; }
                var parsed = null;
                try { parsed = JSON.parse(reply.replace(/```json|```/g, "").trim()); } catch (e) {}
                if (parsed && parsed.address) {
                    var fullAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
                    scannedAddr = fullAddr;
                    showDeliveryCard(parsed);
                    var voiceMsg = parsed.unit
                        ? "Unit " + parsed.unit + ". " + parsed.address + ". Opening navigation."
                        : parsed.address + ". Opening navigation.";
                    speak(voiceMsg, function () {
                        autoNavigate(fullAddr);
                        // After navigating, show tap button for iOS
                        setTimeout(afterAIReply, 3000);
                    });
                } else { addBubble("assistant", reply); afterAIReply(); }
            });
        });
    }

    // ═══════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════
    renderLangBar();

    CHIPS.forEach(function (c) {
        var btn = document.createElement("button"); btn.className = "chip"; btn.textContent = c;
        btn.addEventListener("click", function () { sendText(c); });
        chipsEl.appendChild(btn);
    });

    sendBtn.addEventListener("click", function () { sendText(); });
    inp.addEventListener("input", updateSend);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") sendText(); });
    voiceBtn.addEventListener("click", toggleMic);
    scanBtn.addEventListener("click", function () { cameraIn.click(); });
    photoBtn.addEventListener("click", function () { photoIn.click(); });
    cameraIn.addEventListener("change", function () { handleScan(cameraIn); });
    photoIn.addEventListener("change", function () { handleScan(photoIn); });
    navBtnEl.addEventListener("click", function () { if (scannedAddr) autoNavigate(scannedAddr); });
    stopBtnEl.addEventListener("click", stopSpeak);

    // iOS: big tap button — this IS a direct user gesture so it works
    iosTapBtn.addEventListener("click", function () {
        iosTap.classList.remove("show");
        doListen();
    });

    initGPS();

    // Show platform-specific welcome
    var welcome = isIOS
        ? "Ready.\n\n1\ufe0f\u20e3 Pick language above\n2\ufe0f\u20e3 Tap \ud83c\udfa4 to start speaking\n3\ufe0f\u20e3 After AI replies, tap the big red button to speak again\n4\ufe0f\u20e3 Scan a label \u2192 auto-navigate"
        : "Ready.\n\n1\ufe0f\u20e3 Pick language above\n2\ufe0f\u20e3 Tap \ud83c\udfa4 once \u2192 hands-free\n3\ufe0f\u20e3 Scan a label \u2192 auto-navigate";
    addBubble("assistant", welcome);

})();
