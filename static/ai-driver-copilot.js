// ═══════════════════════════════════════════════════════════
//  NINJA CO-PILOT — Full JS
//  EN / 中文
//  Safari/desktop: SpeechRecognition
//  Chrome iOS: MediaRecorder → backend transcribe
//  Scan label → extract phone
//  In-app live navigation
//  ETA notify + rain delay popup
// ═══════════════════════════════════════════════════════════

(function () {
    "use strict";

    var MAX_DIM = 800, MAX_BYTES = 4 * 1024 * 1024;
    var ETA_NOTIFY_SECONDS = 300; // 5 min
    var ETA_NOTIFY_METERS = 1200; // fallback
    var DEFAULT_CUSTOMER_PHONE = "88918958";

    // ─── Platform detection ───
    var ua = navigator.userAgent.toLowerCase();
    var isIOS = /iphone|ipad|ipod/.test(ua);
    var hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    var useRecorder = !hasSR;

    var LANGUAGES = [
        { label: "EN", flag: "🇬🇧", code: "en-SG", ai: "English" },
        { label: "中文", flag: "🇨🇳", code: "zh-CN", ai: "Chinese" }
    ];

    var busy = false, scannedAddr = null, isSpeaking = false, micActive = false;
    var isListening = false, recognition = null, gpsPos = null, selectedLang = 0;
    var currentStreet = "";
    var mediaRecorder = null, audioChunks = [];
    var recordTimer = null;
    var ttsTimer = null;
    var speechUnlocked = false;

    // route / nav state
    var activeRoute = null;
    var activeStepIndex = 0;
    var lastSpokenStep = -1;
    var navActive = false;
    var lastGpsCheckAt = 0;

    // customer / notify state
    var customerPhone = DEFAULT_CUSTOMER_PHONE;
    var notifyShownForRoute = false;
    var arrivalPromptSpoken = false;
    var rainAlertShownForRoute = false;
    var currentWeatherInfo = null;

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

    function currentLang() {
        return LANGUAGES[selectedLang];
    }

    function isChineseMode() {
        return currentLang().ai === "Chinese";
    }

    function getSysPrompt() {
        var locInfo = currentStreet
            ? "\nDriver current location: " + currentStreet + (gpsPos ? " (GPS:" + gpsPos.lat.toFixed(5) + "," + gpsPos.lng.toFixed(5) + ")" : "")
            : "";

        var replyRule = isChineseMode()
            ? "LANGUAGE: Reply ONLY in Simplified Chinese."
            : "LANGUAGE: Reply ONLY in English.";

        return [
            "You are Ninja Co-Pilot, AI assistant for Ninja Van delivery drivers." + locInfo,
            replyRule,
            "RULES: Under 60 words. Professional. Action first.",
            "",
            "NAVIGATION REQUESTS:",
            "When driver asks to go to ANY place (restaurant, petrol station, toilet, shop, etc.):",
            "- Find the nearest one based on driver's current location",
            "- You MUST include this exact line in your reply:",
            "  ADDRESS: [full address with street and postal code]",
            "- Without the ADDRESS: line, navigation cannot start",
            "",
            "PARTIAL ADDRESSES:",
            "If driver says just a block number like 'block 214' or 'blk 214', use current location to form full address."
        ].join("\n");
    }

    function getOcrPrompt() {
        return [
            "Extract delivery info from this package label. Auto-detect language.",
            "Driver is at: " + (currentStreet || "unknown") + ".",
            "If label only shows block/unit without street, infer full address from driver location.",
            "Extract unit/floor/block separately.",
            "Extract phone number if visible. Return phone as plain digits if possible.",
            "JSON ONLY:",
            '{"address":"FULL street address","unit":"unit/block or null","postal":"postal code or null","recipient":"name or null","sender":"sender or null","phone":"phone or null","language":"detected language","confidence":"high/medium/low"}'
        ].join("\n");
    }

    var CHIPS = [
        "Nearest toilet",
        "Nearest petrol station",
        "Cannot find address",
        "No answer",
        "Traffic jam",
        "Damaged parcel",
        "Set customer phone 88918958"
    ];

    // ═══════════════════════════════════════════════════════
    //  PHONE / MESSAGES
    // ═══════════════════════════════════════════════════════
    function sanitizePhone(raw) {
        var s = String(raw || "").replace(/[^\d+]/g, "");
        if (!s) return "";
        if (s.indexOf("+") === 0) return s;
        if (s.length === 8) return "65" + s;
        return s;
    }

    function setCustomerPhone(raw) {
        var clean = sanitizePhone(raw);
        if (!clean) return false;
        customerPhone = clean;
        return true;
    }

    function getCustomerPhoneForSms() {
        return customerPhone.replace(/^\+/, "");
    }

    function getCustomerPhoneForWhatsApp() {
        return customerPhone.replace(/^\+/, "");
    }

    function getArrivalMessage() {
        if (isChineseMode()) {
            return "您好，我大约五分钟后到，请准备收件，谢谢。";
        }
        return "Hello, I will arrive in about 5 minutes. Please be ready to receive the parcel. Thank you.";
    }

    function getRainDelayMessage() {
        if (isChineseMode()) {
            return "您好，由于目的地下雨和路况影响，您的包裹可能会稍微延迟一点，感谢您的耐心等待。";
        }
        return "Hello, due to rain and traffic conditions near your destination, your parcel may be slightly delayed. Thank you for your patience.";
    }

    function openSms(phone, message) {
        var p = String(phone || "");
        var body = encodeURIComponent(message || "");
        var url = isIOS
            ? "sms:" + p + "&body=" + body
            : "sms:" + p + "?body=" + body;
        window.location.href = url;
    }

    function openWhatsApp(phone, message) {
        var p = String(phone || "").replace(/[^\d]/g, "");
        var text = encodeURIComponent(message || "");
        window.open("https://wa.me/" + p + "?text=" + text, "_blank");
    }

    // ═══════════════════════════════════════════════════════
    //  POPUPS
    // ═══════════════════════════════════════════════════════
    function removeArrivalCard() { removeEl("arrivalNotifyCard"); }
    function removeRainCard() { removeEl("rainDelayCard"); }

    function showArrivalNotifyCard() {
        removeArrivalCard();

        var mins = activeRoute ? Math.max(1, Math.round((activeRoute.total_duration || 0) / 60)) : 5;
        var msg = getArrivalMessage();
        var title = isChineseMode()
            ? "📩 快到了，要通知客户吗？"
            : "📩 Near destination. Notify customer?";
        var etaText = isChineseMode()
            ? "预计大约 " + mins + " 分钟内到"
            : "Estimated arrival in about " + mins + " minutes";

        var div = document.createElement("div");
        div.id = "arrivalNotifyCard";
        div.innerHTML =
            '<div style="background:rgba(227,24,55,0.10);border:1px solid rgba(227,24,55,0.28);border-radius:14px;padding:12px;margin:8px 0;">' +
                '<div style="color:#fff;font-size:13px;font-weight:700;margin-bottom:6px;">' + esc(title) + '</div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:6px;">' + esc(etaText) + '</div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:6px;">Phone: <span style="color:#fff;font-weight:700;">' + esc(customerPhone) + '</span></div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:10px;">' + esc(msg) + '</div>' +
                '<div style="display:flex;gap:8px;">' +
                    '<button id="arrivalSmsBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:#E31837;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">SMS</button>' +
                    '<button id="arrivalWaBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:#25D366;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">WhatsApp</button>' +
                    '<button id="arrivalCloseBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:rgba(255,255,255,0.12);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Close</button>' +
                '</div>' +
            '</div>';

        chatEl.appendChild(div);
        scrollDown();

        document.getElementById("arrivalSmsBtn").addEventListener("click", function () {
            openSms(getCustomerPhoneForSms(), msg);
        });
        document.getElementById("arrivalWaBtn").addEventListener("click", function () {
            openWhatsApp(getCustomerPhoneForWhatsApp(), msg);
        });
        document.getElementById("arrivalCloseBtn").addEventListener("click", function () {
            removeArrivalCard();
        });
    }

    function showRainDelayCard(weatherInfo) {
        removeRainCard();

        var msg = getRainDelayMessage();
        var title = isChineseMode()
            ? "☔ 目的地附近下雨，要通知客户延迟吗？"
            : "☔ Rain near destination. Send delay notice to customer?";
        var detail = isChineseMode()
            ? "检测到目的地天气：" + (weatherInfo && weatherInfo.description ? weatherInfo.description : "下雨")
            : "Detected destination weather: " + (weatherInfo && weatherInfo.description ? weatherInfo.description : "rain");

        var div = document.createElement("div");
        div.id = "rainDelayCard";
        div.innerHTML =
            '<div style="background:rgba(30,144,255,0.10);border:1px solid rgba(30,144,255,0.30);border-radius:14px;padding:12px;margin:8px 0;">' +
                '<div style="color:#fff;font-size:13px;font-weight:700;margin-bottom:6px;">' + esc(title) + '</div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:6px;">' + esc(detail) + '</div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:6px;">Phone: <span style="color:#fff;font-weight:700;">' + esc(customerPhone) + '</span></div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:10px;">' + esc(msg) + '</div>' +
                '<div style="display:flex;gap:8px;">' +
                    '<button id="rainSmsBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:#E31837;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">SMS</button>' +
                    '<button id="rainWaBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:#25D366;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">WhatsApp</button>' +
                    '<button id="rainCloseBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:rgba(255,255,255,0.12);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Close</button>' +
                '</div>' +
            '</div>';

        chatEl.appendChild(div);
        scrollDown();

        document.getElementById("rainSmsBtn").addEventListener("click", function () {
            openSms(getCustomerPhoneForSms(), msg);
        });
        document.getElementById("rainWaBtn").addEventListener("click", function () {
            openWhatsApp(getCustomerPhoneForWhatsApp(), msg);
        });
        document.getElementById("rainCloseBtn").addEventListener("click", function () {
            removeRainCard();
        });
    }

    // ═══════════════════════════════════════════════════════
    //  TTS
    // ═══════════════════════════════════════════════════════
    function unlockSpeech() {
        if (!window.speechSynthesis || speechUnlocked) return;
        try {
            var u = new SpeechSynthesisUtterance(" ");
            u.volume = 0;
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
            u.lang = currentLang().code;
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
    }

    if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = function () {
            try { window.speechSynthesis.getVoices(); } catch (e) {}
        };
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
                language: currentLang().code
            })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) { cb(d.error ? String(d.error) : null, d.text || ""); })
            .catch(function (e) { cb(e.message); });
    }

    function apiWeather(lat, lng, cb) {
        fetch("/api/weather?lat=" + encodeURIComponent(lat) + "&lng=" + encodeURIComponent(lng))
            .then(function (r) { return r.json(); })
            .then(function (d) { cb(null, d); })
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
        micLabel.textContent = "MIC • " + currentLang().flag + " " + currentLang().ai;

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
        recognition.lang = currentLang().code;

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
                updateLiveNavigation();
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
    //  ROUTE / NAV
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
                    .then(function (rt) {
                        if (rt && !rt.error) {
                            rt.dest_lat = g.lat;
                            rt.dest_lng = g.lng;
                            rt.dest_display = g.display || destAddr;
                        }
                        cb(rt.error && !rt.steps.length ? rt.error : null, rt);
                    })
                    .catch(function (e) { cb(e.message); });
            })
            .catch(function (e) { cb(e.message); });
    }

    function metersBetween(lat1, lng1, lat2, lng2) {
        var R = 6371000;
        var toRad = function (d) { return d * Math.PI / 180; };
        var dLat = toRad(lat2 - lat1);
        var dLng = toRad(lng2 - lng1);
        var a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function startLiveNavigation(route) {
        if (!route || !route.steps || !route.steps.length) return;
        activeRoute = route;
        activeStepIndex = 0;
        lastSpokenStep = -1;
        navActive = true;
        notifyShownForRoute = false;
        arrivalPromptSpoken = false;
        rainAlertShownForRoute = false;
        currentWeatherInfo = null;
        removeArrivalCard();
        removeRainCard();
        highlightActiveStep();
        speakCurrentStepIfNeeded(true);

        if (route.dest_lat != null && route.dest_lng != null) {
            apiWeather(route.dest_lat, route.dest_lng, function (err, weatherData) {
                if (!err && weatherData) {
                    currentWeatherInfo = weatherData;
                }
            });
        }
    }

    function highlightActiveStep() {
        if (!activeRoute || !activeRoute.steps) return;

        activeRoute.steps.forEach(function (_, i) {
            var el = document.getElementById("rs" + i);
            if (el) {
                el.style.background = i === activeStepIndex
                    ? "rgba(227,24,55,0.18)"
                    : "transparent";
            }
        });

        var activeEl = document.getElementById("rs" + activeStepIndex);
        if (activeEl) activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function speakCurrentStepIfNeeded(force) {
        if (!navActive || !activeRoute || !activeRoute.steps) return;
        if (activeStepIndex >= activeRoute.steps.length) return;
        if (!force && lastSpokenStep === activeStepIndex) return;

        var step = activeRoute.steps[activeStepIndex];
        if (!step || !step.text) return;

        lastSpokenStep = activeStepIndex;
        speak(step.text);
    }

    function maybeShowArrivalNotify() {
        if (!navActive || !activeRoute || notifyShownForRoute) return;

        var secs = Number(activeRoute.total_duration || 0);
        var meters = Number(activeRoute.total_distance || 0);

        if ((secs > 0 && secs <= ETA_NOTIFY_SECONDS) || (meters > 0 && meters <= ETA_NOTIFY_METERS)) {
            notifyShownForRoute = true;

            if (!arrivalPromptSpoken) {
                arrivalPromptSpoken = true;
                speak(isChineseMode() ? "还有大约五分钟到，要通知客户吗？" : "About 5 minutes to arrival. Notify customer?");
            }

            showArrivalNotifyCard();
        }
    }

    function maybeShowRainAlert() {
        if (!navActive || rainAlertShownForRoute) return;
        if (!currentWeatherInfo || !currentWeatherInfo.is_rain) return;

        rainAlertShownForRoute = true;
        speak(isChineseMode() ? "目的地附近正在下雨，要通知客户可能会稍微延迟吗？" : "It is raining near the destination. Send a delay notice to the customer?");
        showRainDelayCard(currentWeatherInfo);
    }

    function updateLiveNavigation() {
        if (!navActive || !gpsPos || !activeRoute || !activeRoute.steps) return;
        if (activeStepIndex >= activeRoute.steps.length) return;

        var now = Date.now();
        if (now - lastGpsCheckAt < 1500) return;
        lastGpsCheckAt = now;

        var step = activeRoute.steps[activeStepIndex];
        if (!step || step.lat == null || step.lng == null) return;

        var dist = metersBetween(gpsPos.lat, gpsPos.lng, step.lat, step.lng);

        if (dist <= 80 && lastSpokenStep !== activeStepIndex) {
            var warnText = isChineseMode()
                ? "前方大约 " + Math.round(dist) + " 米，" + step.text
                : "In " + Math.round(dist) + " meters. " + step.text;

            speak(warnText);
            lastSpokenStep = activeStepIndex;
            highlightActiveStep();
            maybeShowArrivalNotify();
            maybeShowRainAlert();
            return;
        }

        if (dist <= 25) {
            activeStepIndex++;
            highlightActiveStep();

            if (activeRoute && activeRoute.steps) {
                var remainSecs = 0;
                var remainMeters = 0;
                for (var i = activeStepIndex; i < activeRoute.steps.length; i++) {
                    remainSecs += Number(activeRoute.steps[i].duration || 0);
                    remainMeters += Number(activeRoute.steps[i].distance || 0);
                }
                activeRoute.total_duration = remainSecs;
                activeRoute.total_distance = remainMeters;
                maybeShowArrivalNotify();
                maybeShowRainAlert();
            }

            if (activeStepIndex < activeRoute.steps.length) {
                lastSpokenStep = -1;
                setTimeout(function () {
                    speakCurrentStepIfNeeded(true);
                }, 500);
            } else {
                navActive = false;
                speak(isChineseMode() ? "已经到达目的地。" : "You have arrived.");
            }
        }
    }

    function stopLiveNavigation() {
        navActive = false;
        activeRoute = null;
        activeStepIndex = 0;
        lastSpokenStep = -1;
        notifyShownForRoute = false;
        arrivalPromptSpoken = false;
        rainAlertShownForRoute = false;
        currentWeatherInfo = null;
        removeArrivalCard();
        removeRainCard();
    }

    function showRouteSteps(route) {
        removeEl("routeCard");
        if (!route || !route.steps || !route.steps.length) return;

        var div = document.createElement("div");
        div.id = "routeCard";

        var html = '<div style="background:rgba(76,175,80,0.1);border:1px solid rgba(76,175,80,0.2);border-radius:12px;padding:12px;margin:8px 0">';
        html += '<div style="color:#4CAF50;font-size:10px;font-weight:600;letter-spacing:1px;margin-bottom:6px">🛣 ' + esc(route.summary || "") + '</div>';

        route.steps.forEach(function (s, i) {
            html += '<div id="rs' + i + '" style="display:flex;gap:8px;padding:6px;border-radius:8px;margin-bottom:2px;">';
            html += '<span style="font-size:16px;width:22px;text-align:center;flex-shrink:0">' + getIcon(s.type, s.modifier) + '</span>';
            html += '<div style="color:#fff;font-size:12px">' + esc(s.text) + '</div></div>';
        });

        html += '<div style="display:flex;gap:6px;margin-top:8px">';
        html += '<button id="rSpk" style="flex:1;padding:10px;border-radius:8px;border:none;background:#E31837;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">🔊 Repeat Current Step</button>';
        html += '</div></div>';

        div.innerHTML = html;
        chatEl.appendChild(div);
        scrollDown();

        document.getElementById("rSpk").addEventListener("click", function () {
            unlockSpeech();
            speakCurrentStepIfNeeded(true);
        });
    }

    function getIcon(t, m) {
        if (t === "depart") return "🚀";
        if (t === "arrive") return "🏁";
        if (t === "roundabout" || t === "rotary") return "🔄";
        if (m && m.indexOf("left") >= 0) return "⬅️";
        if (m && m.indexOf("right") >= 0) return "➡️";
        return "⬆️";
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

        if (parsed.phone) {
            html += '<div style="color:rgba(255,255,255,0.6);font-size:12px;padding:4px 0">📞 ' + esc(parsed.phone) + '</div>';
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
            .replace(/ADDRESS:\s*.*$/im, "")
            .replace(/PLACE:\s*.*$/im, "")
            .replace(/[•\-\*]/g, "")
            .replace(/\n+/g, ". ")
            .trim();
    }

    function extractPhoneFromText(text) {
        var m = String(text || "").match(/(?:\+?65[-\s]?)?(\d{8})/);
        if (m && m[1]) return m[1];
        return null;
    }

    // ═══════════════════════════════════════════════════════
    //  SEND TEXT
    // ═══════════════════════════════════════════════════════
    function sendText(text) {
        if (!text || !text.trim() || busy) return;

        var rawText = text.trim();

        var phoneMatch = rawText.match(/set customer phone\s+([+\d\s-]+)/i);
        if (phoneMatch && phoneMatch[1]) {
            if (setCustomerPhone(phoneMatch[1])) {
                addBubble("user", rawText);
                addBubble("assistant", "Customer phone saved: " + customerPhone);
            } else {
                addBubble("assistant", "Invalid phone number.");
            }
            inp.value = "";
            updateSend();
            return;
        }

        var maybePhone = extractPhoneFromText(rawText);
        if (maybePhone) setCustomerPhone(maybePhone);

        addBubble("user", rawText);
        inp.value = "";
        updateSend();

        busy = true;
        showProc();

        apiChat(rawText, function (err, reply) {
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
                stopLiveNavigation();

                setTimeout(function () {
                    speak(cleanReplyForSpeech(reply), function () {
                        addBubble("assistant", isChineseMode() ? "🗺 现在开始导航..." : "🗺 Getting directions...");
                        fetchRoute(navAddr, function (routeErr, route) {
                            if (!routeErr && route && route.steps && route.steps.length) {
                                showRouteSteps(route);
                                startLiveNavigation(route);
                            } else {
                                addBubble("assistant", isChineseMode() ? "找不到路线。" : "Route not found.");
                                restartMicAfterReply();
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

                if (parsed && parsed.phone) setCustomerPhone(parsed.phone);

                if (parsed && parsed.address) {
                    var fullAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
                    scannedAddr = fullAddr;
                    stopLiveNavigation();
                    showDeliveryCard(parsed);

                    var voice = parsed.unit ? "Unit " + parsed.unit + ". " + parsed.address : parsed.address;

                    setTimeout(function () {
                        speak(voice, function () {
                            addBubble("assistant", isChineseMode() ? "🗺 现在开始导航..." : "🗺 Getting directions...");
                            fetchRoute(fullAddr, function (re, route) {
                                if (!re && route && route.steps && route.steps.length) {
                                    showRouteSteps(route);
                                    startLiveNavigation(route);
                                } else {
                                    addBubble("assistant", isChineseMode() ? "找不到路线。" : "Route not found.");
                                    restartMicAfterReply();
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
            stopLiveNavigation();
            fetchRoute(scannedAddr, function (e, r) {
                if (!e && r && r.steps.length) {
                    showRouteSteps(r);
                    startLiveNavigation(r);
                } else {
                    addBubble("assistant", isChineseMode() ? "找不到路线。" : "Route not found.");
                }
            });
        }
    });

    stopBtnEl.addEventListener("click", stopSpeak);

    initGPS();

    var mode = useRecorder ? "(recording mode)" : "(voice mode)";
    addBubble(
        "assistant",
        "Ready " + mode + ".\n" +
        "1️⃣ Pick language\n" +
        "2️⃣ Tap 🎙️ once\n" +
        "3️⃣ Scan parcel label to capture phone\n" +
        "4️⃣ Ask for a route\n" +
        "5️⃣ Rain delay popup will appear automatically if destination is raining"
    );
})();
