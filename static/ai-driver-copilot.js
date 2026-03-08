// ═══════════════════════════════════════════════════════════
//  NINJA CO-PILOT — iPhone safer voice version
//  Safari/desktop: SpeechRecognition
//  Chrome iOS: MediaRecorder → backend transcribe
// ═══════════════════════════════════════════════════════════

(function () {
    "use strict";

    var MAX_DIM = 800, MAX_BYTES = 4 * 1024 * 1024;

    // ─── Platform detection ───
    var ua = navigator.userAgent.toLowerCase();
    var isIOS = /iphone|ipad|ipod/.test(ua);
    var hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    var useRecorder = !hasSR;

    var LANGUAGES = [
        { label: "EN", flag: "🇬🇧", code: "en-SG", ai: "English" },
        { label: "中文", flag: "🇨🇳", code: "zh-CN", ai: "Chinese Simplified" },
        { label: "繁體", flag: "🇹🇼", code: "zh-TW", ai: "Chinese Traditional" },
        { label: "廣東話", flag: "🇭🇰", code: "zh-HK", ai: "Cantonese" },
        { label: "Malay", flag: "🇲🇾", code: "ms-MY", ai: "Malay" },
        { label: "Tamil", flag: "🇮🇳", code: "ta-IN", ai: "Tamil" },
        { label: "ไทย", flag: "🇹🇭", code: "th-TH", ai: "Thai" },
        { label: "Việt", flag: "🇻🇳", code: "vi-VN", ai: "Vietnamese" },
        { label: "Indo", flag: "🇮🇩", code: "id-ID", ai: "Bahasa Indonesia" },
        { label: "한국어", flag: "🇰🇷", code: "ko-KR", ai: "Korean" },
        { label: "日本語", flag: "🇯🇵", code: "ja-JP", ai: "Japanese" }
    ];

    var busy = false, scannedAddr = null, isSpeaking = false, micActive = false;
    var isListening = false, recognition = null, gpsPos = null, selectedLang = 0;
    var routeSteps = [], routeStep = 0, speakingRoute = false, currentStreet = "";
    var mediaRecorder = null, audioChunks = [];
    var recordTimer = null;
    var ttsTimer = null;
    var voicesReady = false;
    var speechUnlocked = false;

    // DOM
    var chatEl = document.getElementById("chat"), inp = document.getElementById("inp");
    var sendBtn = document.getElementById("sendBtn"), voiceBtn = document.getElementById("voiceBtn");
    var scanBtn = document.getElementById("scanBtn"), photoBtn = document.getElementById("photoBtn");
    var navBtnEl = document.getElementById("navBtn"), stopBtnEl = document.getElementById("stopBtn");
    var sbEl = document.getElementById("sb"), micBar = document.getElementById("micBar");
    var micLabel = document.getElementById("micLabel");
    var locBar = document.getElementById("locBar"), locAddr = document.getElementById("locAddr");
    var langBar = document.getElementById("langBar"), chipsEl = document.getElementById("chips");
    var cameraIn = document.getElementById("cameraIn"), photoIn = document.getElementById("photoIn");

    function getSysPrompt() {
        var lang = LANGUAGES[selectedLang];
        var locInfo = currentStreet
            ? "\nDriver current location: " + currentStreet + (gpsPos ? " (GPS:" + gpsPos.lat.toFixed(5) + "," + gpsPos.lng.toFixed(5) + ")" : "")
            : "";

        var replyRule = lang.ai === "Cantonese"
            ? "LANGUAGE: Reply ONLY in Cantonese Chinese using Traditional Chinese characters. Do not reply in Mandarin. Keep wording natural for Hong Kong Cantonese speakers."
            : "LANGUAGE: Reply ONLY in " + lang.ai + ".";

        return [
            "You are Ninja Co-Pilot, AI assistant for Ninja Van delivery drivers." + locInfo,
            replyRule,
            "RULES: Under 60 words. Professional. No slang. Action first.",
            "",
            "NAVIGATION REQUESTS:",
            "When driver asks to go to ANY place (restaurant, petrol station, toilet, shop, etc.):",
            "- Find the nearest one based on driver's current location",
            "- You MUST include this exact line in your reply:",
            "  ADDRESS: [full address with street and postal code]",
            "- Without the ADDRESS: line, navigation cannot start",
            "",
            "PARTIAL ADDRESSES:",
            "If driver says just a block number like 'block 214' or 'blk 214',",
            "use their current location to form full address.",
            "Example: driver at Jurong East + says 'block 214' = 'Block 214 Jurong East Street 21, Singapore'"
        ].join("\n");
    }

    function getOcrPrompt() {
        return [
            "Extract delivery info from this package label. Auto-detect language.",
            "Driver is at: " + (currentStreet || "unknown") + ".",
            "If label only shows block/unit without street, infer full address from driver location.",
            "Extract unit/floor/block separately.",
            "JSON ONLY:",
            '{"address":"FULL street address","unit":"unit/block or null","postal":"postal code or null","recipient":"name or null","sender":"sender or null","language":"detected language","confidence":"high/medium/low"}'
        ].join("\n");
    }

    var CHIPS = ["Cannot find address", "No answer", "Traffic jam", "Damaged parcel", "Nearest petrol station", "Nearest toilet"];

    // ═══════════════════════════════════════════════════════
    //  TTS HELPERS
    // ═══════════════════════════════════════════════════════
    function loadVoices() {
        try {
            if (!window.speechSynthesis) return;
            var v = window.speechSynthesis.getVoices() || [];
            if (v.length) voicesReady = true;
        } catch (e) {}
    }

    function unlockSpeech() {
        if (!window.speechSynthesis || speechUnlocked) return;
        try {
            var u = new SpeechSynthesisUtterance(" ");
            u.volume = 0;
            u.rate = 1;
            u.onend = function () { speechUnlocked = true; };
            u.onerror = function () { speechUnlocked = true; };
            window.speechSynthesis.speak(u);
            window.speechSynthesis.cancel();
            speechUnlocked = true;
        } catch (e) {}
    }

    function pickVoice(langCode) {
        if (!window.speechSynthesis) return null;
        var voices = window.speechSynthesis.getVoices() || [];
        if (!voices.length) return null;

        var exact = voices.find(function (v) {
            return (v.lang || "").toLowerCase() === langCode.toLowerCase();
        });
        if (exact) return exact;

        var shortCode = langCode.split("-")[0].toLowerCase();
        var partial = voices.find(function (v) {
            return (v.lang || "").toLowerCase().indexOf(shortCode) === 0;
        });
        return partial || null;
    }

    function speak(text, onDone) {
        if (!window.speechSynthesis || !text) {
            if (onDone) onDone();
            return;
        }

        try {
            window.speechSynthesis.cancel();
            clearInterval(ttsTimer);

            var cleanText = String(text).trim();
            if (!cleanText) {
                if (onDone) onDone();
                return;
            }

            var u = new SpeechSynthesisUtterance(cleanText);
            u.lang = LANGUAGES[selectedLang].code;
            u.rate = 0.92;
            u.pitch = 1;
            u.volume = 1;

            var chosenVoice = pickVoice(u.lang);
            if (chosenVoice) u.voice = chosenVoice;

            u.onstart = function () {
                isSpeaking = true;
                sbEl.style.display = "flex";
            };

            u.onend = function () {
                isSpeaking = false;
                sbEl.style.display = "none";
                clearInterval(ttsTimer);
                if (onDone) onDone();
            };

            u.onerror = function () {
                isSpeaking = false;
                sbEl.style.display = "none";
                clearInterval(ttsTimer);
                if (onDone) onDone();
            };

            window.speechSynthesis.speak(u);
            try { window.speechSynthesis.resume(); } catch (e) {}

            ttsTimer = setInterval(function () {
                try { window.speechSynthesis.resume(); } catch (e) {}
            }, 2000);

        } catch (e) {
            isSpeaking = false;
            sbEl.style.display = "none";
            clearInterval(ttsTimer);
            if (onDone) onDone();
        }
    }

    function stopSpeak() {
        if (window.speechSynthesis) {
            try { window.speechSynthesis.cancel(); } catch (e) {}
        }
        isSpeaking = false;
        sbEl.style.display = "none";
        clearInterval(ttsTimer);
        speakingRoute = false;
    }

    if (window.speechSynthesis) {
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }

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
                unlockSpeech();
                selectedLang = i;
                renderLangBar();
                micLabel.textContent = "MIC • " + lang.flag + " " + lang.ai;
                addBubble("assistant", "🌐 " + lang.flag + " " + lang.ai);
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
                    w = Math.round(w * r);
                    h = Math.round(h * r);
                }

                var c = document.createElement("canvas");
                c.width = w;
                c.height = h;
                c.getContext("2d").drawImage(img, 0, 0, w, h);

                var q = 0.8, b64 = c.toDataURL("image/jpeg", q);
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
            img.onerror = function () { cb("Failed"); };
            img.src = e.target.result;
        };
        reader.onerror = function () { cb("Failed"); };
        reader.readAsDataURL(file);
    }

    // ═══════════════════════════════════════════════════════
    //  API
    // ═══════════════════════════════════════════════════════
    function apiChat(text, cb) {
        fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system: getSysPrompt(),
                messages: [{ role: "user", content: text }]
            })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) { cb(d.error ? String(d.error) : null, d.reply || ""); })
            .catch(function (e) { cb(e.message); });
    }

    function apiScan(base64, cb) {
        fetch("/api/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system: getSysPrompt(),
                image_base64: base64,
                ocr_prompt: getOcrPrompt()
            })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) { cb(d.error ? String(d.error) : null, d.reply || ""); })
            .catch(function (e) { cb(e.message); });
    }

    function apiTranscribe(audioBase64, cb) {
        fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                audio_base64: audioBase64,
                language: LANGUAGES[selectedLang].code
            })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) { cb(d.error ? String(d.error) : null, d.text || ""); })
            .catch(function (e) { cb(e.message); });
    }

    // ═══════════════════════════════════════════════════════
    //  MIC
    // ═══════════════════════════════════════════════════════
    function toggleMic() {
        unlockSpeech();

        if (micActive) {
            stopMic();
            return;
        }

        micActive = true;
        voiceBtn.classList.add("active");
        voiceBtn.querySelector("span:last-child").textContent = "MIC ON";
        micBar.classList.add("on");
        micLabel.textContent = "MIC • " + LANGUAGES[selectedLang].flag + " " + LANGUAGES[selectedLang].ai;

        if (useRecorder) startRecording();
        else startSR();
    }

    function stopMic() {
        micActive = false;
        isListening = false;

        voiceBtn.classList.remove("active");
        voiceBtn.querySelector("span:last-child").textContent = "TAP TO SPEAK";
        micBar.classList.remove("on");

        clearTimeout(recordTimer);

        if (recognition) {
            try { recognition.stop(); } catch (e) {}
        }

        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            try { mediaRecorder.stop(); } catch (e) {}
        }
    }

    // ─── SpeechRecognition mode ───
    function startSR() {
        if (!micActive || isListening || isSpeaking || busy) return;

        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            useRecorder = true;
            startRecording();
            return;
        }

        recognition = new SR();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = LANGUAGES[selectedLang].code;

        recognition.onresult = function (e) {
            for (var i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) {
                    var text = e.results[i][0].transcript.trim();
                    if (text) {
                        stopListeningSR();
                        sendText(text);
                    }
                }
            }
        };

        recognition.onerror = function () {
            isListening = false;
            if (micActive && !isSpeaking && !busy) {
                setTimeout(function () {
                    if (micActive) startSR();
                }, 1000);
            }
        };

        recognition.onend = function () {
            isListening = false;
            if (micActive && !isSpeaking && !busy) {
                setTimeout(function () {
                    if (micActive && !isListening) startSR();
                }, 300);
            }
        };

        try {
            recognition.start();
            isListening = true;
        } catch (e) {
            setTimeout(function () {
                if (micActive) startSR();
            }, 500);
        }
    }

    function stopListeningSR() {
        if (recognition) {
            try { recognition.stop(); } catch (e) {}
        }
        isListening = false;
    }

    // ─── Recorder mode ───
    function startRecording() {
        if (!micActive || isListening || isSpeaking || busy) return;

        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            audioChunks = [];

            var options = { mimeType: "audio/webm" };
            try { mediaRecorder = new MediaRecorder(stream, options); }
            catch (e) { mediaRecorder = new MediaRecorder(stream); }

            mediaRecorder.ondataavailable = function (e) {
                if (e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.onstop = function () {
                clearTimeout(recordTimer);
                stream.getTracks().forEach(function (t) { t.stop(); });

                if (!micActive || audioChunks.length === 0) return;

                var blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });

                if (blob.size < 2500) {
                    isListening = false;
                    if (micActive && !busy) startRecording();
                    return;
                }

                var reader = new FileReader();
                reader.onload = function () {
                    var base64 = reader.result.split(",")[1];
                    isListening = false;
                    showProc();

                    apiTranscribe(base64, function (err, text) {
                        hideProc();

                        if (err || !String(text || "").trim()) {
                            if (err) addBubble("assistant", "Voice input unavailable: " + err);
                            if (micActive && !busy) startRecording();
                            return;
                        }

                        sendText(text.trim());
                    });
                };
                reader.readAsDataURL(blob);
            };

            mediaRecorder.start();
            isListening = true;

            recordTimer = setTimeout(function () {
                if (mediaRecorder && mediaRecorder.state === "recording") {
                    mediaRecorder.stop();
                }
            }, 2500);

        }).catch(function () {
            addBubble("assistant", "Mic access denied. Please allow microphone permission.");
            stopMic();
        });
    }

    function restartMicAfterReply() {
        if (!micActive) return;

        setTimeout(function () {
            if (!micActive || isSpeaking || busy || isListening) return;
            if (useRecorder) startRecording();
            else startSR();
        }, 500);
    }

    // ═══════════════════════════════════════════════════════
    //  GPS
    // ═══════════════════════════════════════════════════════
    function initGPS() {
        if (!navigator.geolocation) {
            locAddr.textContent = "GPS not available";
            return;
        }

        navigator.geolocation.watchPosition(
            function (p) {
                gpsPos = {
                    lat: p.coords.latitude,
                    lng: p.coords.longitude,
                    acc: p.coords.accuracy
                };
                locBar.classList.remove("no-gps");
                reverseGeocode(gpsPos.lat, gpsPos.lng);
            },
            function () {
                locBar.classList.add("no-gps");
                locAddr.textContent = "GPS searching...";
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
    }

    function reverseGeocode(lat, lng) {
        fetch("/api/geocode?lat=" + lat + "&lng=" + lng)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                currentStreet = d.address || "";
                locAddr.textContent = currentStreet || lat.toFixed(5) + "," + lng.toFixed(5);
            })
            .catch(function () {});
    }

    // ═══════════════════════════════════════════════════════
    //  ROUTE
    // ═══════════════════════════════════════════════════════
    function fetchRoute(destAddr, cb) {
        if (!gpsPos) {
            cb("No GPS");
            return;
        }

        fetch("/api/address-to-latlng?address=" + encodeURIComponent(destAddr))
            .then(function (r) { return r.json(); })
            .then(function (g) {
                if (!g.lat) {
                    cb("Address not found");
                    return;
                }

                fetch("/api/route?from_lat=" + gpsPos.lat + "&from_lng=" + gpsPos.lng + "&to_lat=" + g.lat + "&to_lng=" + g.lng)
                    .then(function (r) { return r.json(); })
                    .then(function (rt) { cb(rt.error && !rt.steps.length ? rt.error : null, rt); })
                    .catch(function (e) { cb(e.message); });
            })
            .catch(function (e) { cb(e.message); });
    }

    function showRouteSteps(route) {
        removeEl("routeCard");
        routeSteps = route.steps || [];
        routeStep = 0;
        if (!routeSteps.length) return;

        var div = document.createElement("div");
        div.id = "routeCard";

        var html = '<div style="background:rgba(76,175,80,0.1);border:1px solid rgba(76,175,80,0.2);border-radius:12px;padding:12px;margin:8px 0">';
        html += '<div style="color:#4CAF50;font-size:10px;font-weight:600;letter-spacing:1px;margin-bottom:6px">🛣 ' + esc(route.summary || "") + '</div>';

        routeSteps.forEach(function (s, i) {
            html += '<div id="rs' + i + '" style="display:flex;gap:8px;padding:6px;border-radius:8px;margin-bottom:2px;' + (i === 0 ? 'background:rgba(227,24,55,0.1)' : '') + '">';
            html += '<span style="font-size:16px;width:22px;text-align:center;flex-shrink:0">' + getIcon(s.type, s.modifier) + '</span>';
            html += '<div style="color:#fff;font-size:12px">' + esc(s.text) + '</div></div>';
        });

        html += '<div style="display:flex;gap:6px;margin-top:8px">';
        html += '<button id="rSpk" style="flex:2;padding:10px;border-radius:8px;border:none;background:#E31837;color:#fff;font-size:12px;font-weight:700;cursor:pointer">🔊 Speak</button>';
        html += '<button id="rGm" style="flex:1;padding:10px;border-radius:8px;border:none;background:#4285F4;color:#fff;font-size:11px;font-weight:700;cursor:pointer">Maps</button>';
        html += '<button id="rWz" style="flex:1;padding:10px;border-radius:8px;border:none;background:#33CCFF;color:#000;font-size:11px;font-weight:700;cursor:pointer">Waze</button>';
        html += '</div></div>';

        div.innerHTML = html;
        chatEl.appendChild(div);
        scrollDown();

        document.getElementById("rSpk").addEventListener("click", function () {
            unlockSpeech();
            speakAllSteps();
        });
        document.getElementById("rGm").addEventListener("click", function () { openMaps(scannedAddr); });
        document.getElementById("rWz").addEventListener("click", function () { openWaze(scannedAddr); });
    }

    function getIcon(t, m) {
        if (t === "depart") return "🚀";
        if (t === "arrive") return "🏁";
        if (t === "roundabout" || t === "rotary") return "🔄";
        if (m && m.indexOf("left") >= 0) return "⬅️";
        if (m && m.indexOf("right") >= 0) return "➡️";
        return "⬆️";
    }

    function speakAllSteps() {
        unlockSpeech();
        if (speakingRoute) {
            stopSpeak();
            return;
        }
        speakingRoute = true;
        routeStep = 0;
        speakNext();
    }

    function speakNext() {
        if (!speakingRoute || routeStep >= routeSteps.length) {
            speakingRoute = false;
            restartMicAfterReply();
            return;
        }

        routeSteps.forEach(function (_, i) {
            var el = document.getElementById("rs" + i);
            if (el) el.style.background = i === routeStep ? "rgba(227,24,55,0.1)" : "transparent";
        });

        var el = document.getElementById("rs" + routeStep);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });

        speak(routeSteps[routeStep].text, function () {
            routeStep++;
            setTimeout(speakNext, 300);
        });
    }

    function openMaps(dest) {
        var o = gpsPos ? gpsPos.lat + "," + gpsPos.lng : "";
        if (/android/.test(ua)) {
            window.location.href = "google.navigation:q=" + encodeURIComponent(dest) + "&mode=d";
        } else if (isIOS) {
            window.location.href = "maps://?daddr=" + encodeURIComponent(dest) + "&dirflg=d";
        } else {
            window.open(
                "https://www.google.com/maps/dir/?api=1" +
                (o ? "&origin=" + o : "") +
                "&destination=" + encodeURIComponent(dest) +
                "&travelmode=driving",
                "_blank"
            );
        }
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

        var div = document.createElement("div");
        div.id = "deliveryCard";
        var html = "";

        if (parsed.unit) {
            html += '<div class="unit-card"><div class="unit-label">UNIT / BLOCK</div><div class="unit-num">' + esc(parsed.unit) + '</div><div class="unit-addr">' + esc(parsed.address) + '</div>';
            if (parsed.language) html += '<div class="unit-lang">🌐 ' + esc(parsed.language) + '</div>';
            html += '</div>';
        } else {
            html += '<div class="unit-card"><div class="unit-label">DELIVERY ADDRESS</div><div class="unit-num" style="font-size:20px">' + esc(parsed.address) + '</div>';
            if (parsed.postal) html += '<div class="unit-addr">📮 ' + esc(parsed.postal) + '</div>';
            html += '</div>';
        }

        if (parsed.recipient) {
            html += '<div style="color:rgba(255,255,255,0.6);font-size:12px;padding:4px 0">👤 ' + esc(parsed.recipient) + '</div>';
        }

        html += '<div class="anav"><div class="anav-title"><div class="anav-dot"></div>NAVIGATING</div><div class="mf"><iframe src="' + mapSrc + '" width="100%" height="180" allowfullscreen loading="lazy"></iframe></div></div>';

        div.innerHTML = html;
        chatEl.appendChild(div);
        scrollDown();
    }

    // ═══════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════
    function esc(s) {
        var d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    function scrollDown() {
        chatEl.scrollTop = chatEl.scrollHeight;
    }

    function removeEl(id) {
        var el = document.getElementById(id);
        if (el) el.remove();
    }

    function addBubble(role, text, imgUrl) {
        var row = document.createElement("div");
        row.className = "mr " + (role === "user" ? "u" : "a");

        var html = "";
        if (role === "assistant") html += '<div class="av">🥷</div>';
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
        removeEl("proc");
    }

    function updateSend() {
        sendBtn.classList.toggle("on", !!inp.value.trim());
    }

    function cleanReplyForSpeech(reply) {
        return String(reply || "")
            .replace(/ADDRESS:.*/i, "")
            .replace(/PLACE:.*/i, "")
            .replace(/[•\-\*]/g, "")
            .replace(/\n+/g, ". ")
            .trim();
    }

    // ═══════════════════════════════════════════════════════
    //  SEND TEXT
    // ═══════════════════════════════════════════════════════
    function sendText(text) {
        if (!text || !text.trim() || busy) return;

        addBubble("user", text.trim());
        inp.value = "";
        updateSend();

        busy = true;
        showProc();

        apiChat(text.trim(), function (err, reply) {
            hideProc();
            busy = false;

            if (err) {
                addBubble("assistant", "Error: " + err);
                setTimeout(function () {
                    speak("Error. " + err, restartMicAfterReply);
                }, 150);
                return;
            }

            addBubble("assistant", reply);

            var addrMatch = reply.match(/ADDRESS:\s*(.+)/i);
            if (addrMatch && addrMatch[1]) {
                var navAddr = addrMatch[1].trim();
                scannedAddr = navAddr;

                setTimeout(function () {
                    speak(cleanReplyForSpeech(reply), function () {
                        addBubble("assistant", "🗺 Getting directions...");
                        fetchRoute(navAddr, function (routeErr, route) {
                            if (!routeErr && route && route.steps && route.steps.length) {
                                showRouteSteps(route);
                                speak(
                                    "Route found. " + route.steps.length + " steps. " + Math.round((route.total_duration || 0) / 60) + " minutes.",
                                    function () { speakAllSteps(); }
                                );
                            } else {
                                speak("Opening maps.", function () {
                                    openMaps(navAddr);
                                    restartMicAfterReply();
                                });
                            }
                        });
                    });
                }, 150);
            } else {
                setTimeout(function () {
                    speak(cleanReplyForSpeech(reply), restartMicAfterReply);
                }, 150);
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
            if (err) {
                addBubble("assistant", "Error: " + err);
                busy = false;
                return;
            }

            addBubble("user", "📷 Scanned (" + img.w + "×" + img.h + ", " + img.kb + "KB)", img.preview);
            showProc();

            apiScan(img.base64, function (err2, reply) {
                hideProc();
                busy = false;
                fileInput.value = "";

                if (err2) {
                    addBubble("assistant", "Error: " + err2);
                    speak("Scan error.", restartMicAfterReply);
                    return;
                }

                var parsed = null;
                try {
                    parsed = JSON.parse(reply.replace(/```json|```/g, "").trim());
                } catch (e) {}

                if (parsed && parsed.address) {
                    var fullAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
                    scannedAddr = fullAddr;
                    showDeliveryCard(parsed);

                    var voice = parsed.unit ? "Unit " + parsed.unit + ". " + parsed.address : parsed.address;

                    setTimeout(function () {
                        speak(voice, function () {
                            addBubble("assistant", "🗺 Getting directions...");
                            fetchRoute(fullAddr, function (re, route) {
                                if (!re && route && route.steps && route.steps.length) {
                                    showRouteSteps(route);
                                    speak(
                                        "Route. " + route.steps.length + " steps. " + Math.round((route.total_duration || 0) / 60) + " minutes.",
                                        function () { speakAllSteps(); }
                                    );
                                } else {
                                    speak("Opening maps.", function () {
                                        openMaps(fullAddr);
                                        restartMicAfterReply();
                                    });
                                }
                            });
                        });
                    }, 150);
                } else {
                    addBubble("assistant", reply);
                    setTimeout(function () {
                        speak(reply, restartMicAfterReply);
                    }, 150);
                }
            });
        });
    }

    // ═══════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════
    renderLangBar();

    CHIPS.forEach(function (c) {
        var btn = document.createElement("button");
        btn.className = "chip";
        btn.textContent = c;
        btn.addEventListener("click", function () {
            unlockSpeech();
            sendText(c);
        });
        chipsEl.appendChild(btn);
    });

    sendBtn.addEventListener("click", function () {
        unlockSpeech();
        sendText(inp.value);
    });

    inp.addEventListener("input", updateSend);

    inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
            unlockSpeech();
            sendText(inp.value);
        }
    });

    voiceBtn.addEventListener("click", function () {
        unlockSpeech();
        toggleMic();
    });

    scanBtn.addEventListener("click", function () {
        unlockSpeech();
        cameraIn.click();
    });

    photoBtn.addEventListener("click", function () {
        unlockSpeech();
        photoIn.click();
    });

    cameraIn.addEventListener("change", function () { handleScan(cameraIn); });
    photoIn.addEventListener("change", function () { handleScan(photoIn); });

    navBtnEl.addEventListener("click", function () {
        unlockSpeech();
        if (scannedAddr) {
            fetchRoute(scannedAddr, function (e, r) {
                if (!e && r && r.steps.length) {
                    showRouteSteps(r);
                    speakAllSteps();
                } else {
                    openMaps(scannedAddr);
                }
            });
        }
    });

    stopBtnEl.addEventListener("click", stopSpeak);

    initGPS();

    var mode = useRecorder ? "(recording mode)" : "(voice mode)";
    addBubble("assistant", "Ready " + mode + ".\n1️⃣ Pick language\n2️⃣ Tap 🎙️ once — mic stays on\n3️⃣ Say \"nearest haidilao\" or scan a label");
})();
