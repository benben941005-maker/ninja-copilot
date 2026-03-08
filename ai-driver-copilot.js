// ═══════════════════════════════════════════════════════════
//  NINJA CO-PILOT — AI Driver Assistant
//  Auto-locate driver → Scan label → Show unit → Auto-navigate
// ═══════════════════════════════════════════════════════════

(function () {
    "use strict";

    var MAX_DIM = 800;
    var MAX_BYTES = 4 * 1024 * 1024;

    // ─── State ───
    var busy = false;
    var scannedAddr = null;
    var isSpeaking = false;
    var micActive = false;
    var isListening = false;
    var recognition = null;
    var gpsPos = null;
    var currentStreet = null;

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
    var locBar = document.getElementById("locBar");
    var locAddr = document.getElementById("locAddr");
    var chipsEl = document.getElementById("chips");
    var cameraIn = document.getElementById("cameraIn");
    var photoIn = document.getElementById("photoIn");

    // ─── Prompts ───
    var SYS = [
        "You are Ninja Co-Pilot, an AI assistant for delivery drivers.",
        "STRICT RULES:",
        "1. ALL replies under 60 words. Max 3 bullet points.",
        '2. Professional tone. NEVER: "bro", "hey", "dude", slang.',
        "3. Start with action directly. No greetings.",
        "4. Format: \u2022 Action: [what to do] \u2022 Note: [context]",
        "5. Solution first, explanation second.",
        "6. Auto-detect any language."
    ].join("\n");

    var OCR = [
        "Extract ALL delivery info from this package label.",
        "Auto-detect the language.",
        "IMPORTANT: Extract the unit/floor/block number separately if visible (e.g. #12-345, Blk 123, Unit 5, Apt 3B, etc).",
        "Respond ONLY in JSON:",
        '{"address":"full street address","unit":"unit/floor/block number or null","postal":"postal code or null","recipient":"name or null","sender":"sender address or null","language":"detected language","confidence":"high/medium/low"}'
    ].join("\n");

    var CHIPS = ["Cannot find address", "No answer", "Traffic jam", "Damaged parcel", "Wrong address", "Gate locked"];

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
            body: JSON.stringify({ system: SYS, messages: [{ role: "user", content: text }] })
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.error) cb(typeof d.error === "string" ? d.error : JSON.stringify(d.error));
            else cb(null, d.reply || "");
        }).catch(function (e) { cb(e.message); });
    }

    function apiScan(base64, cb) {
        fetch("/api/scan", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ system: SYS, image_base64: base64, ocr_prompt: OCR })
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.error) cb(typeof d.error === "string" ? d.error : JSON.stringify(d.error));
            else cb(null, d.reply || "");
        }).catch(function (e) { cb(e.message); });
    }

    // ═══════════════════════════════════════════════════════
    //  GPS — Auto-locate driver + reverse geocode
    // ═══════════════════════════════════════════════════════
    function initGPS() {
        if (!navigator.geolocation) {
            locAddr.textContent = "GPS not available";
            return;
        }
        navigator.geolocation.watchPosition(
            function (p) {
                gpsPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
                locBar.classList.remove("no-gps");
                // Reverse geocode to get street name
                reverseGeocode(gpsPos.lat, gpsPos.lng);
            },
            function () {
                locBar.classList.add("no-gps");
                locAddr.textContent = "GPS searching...";
            },
            { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
        );
    }

    // Use backend to reverse geocode (avoids CORS issues)
    function reverseGeocode(lat, lng) {
        fetch("/api/geocode?lat=" + lat + "&lng=" + lng)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.address) {
                    currentStreet = d.address;
                    locAddr.textContent = d.address;
                } else {
                    locAddr.textContent = lat.toFixed(5) + ", " + lng.toFixed(5);
                }
            })
            .catch(function () {
                locAddr.textContent = lat.toFixed(5) + ", " + lng.toFixed(5);
            });
    }

    // ═══════════════════════════════════════════════════════
    //  TEXT-TO-SPEECH
    // ═══════════════════════════════════════════════════════
    function speak(text, onDone) {
        if (!window.speechSynthesis) { if (onDone) onDone(); return; }
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.rate = 0.95;
        u.onstart = function () { isSpeaking = true; sbEl.style.display = "flex"; };
        u.onend = function () { isSpeaking = false; sbEl.style.display = "none"; if (onDone) onDone(); };
        window.speechSynthesis.speak(u);
    }

    function stopSpeak() {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        isSpeaking = false; sbEl.style.display = "none";
    }

    // ═══════════════════════════════════════════════════════
    //  ALWAYS-ON MIC — tap once ON, tap again OFF
    // ═══════════════════════════════════════════════════════
    function toggleMic() {
        if (micActive) {
            micActive = false; isListening = false;
            if (recognition) recognition.stop();
            voiceBtn.classList.remove("active");
            voiceBtn.querySelector("span:last-child").textContent = "TAP TO SPEAK";
            micBar.classList.remove("on");
            return;
        }
        micActive = true;
        voiceBtn.classList.add("active");
        voiceBtn.querySelector("span:last-child").textContent = "MIC ON";
        micBar.classList.add("on");
        startListening();
    }

    function startListening() {
        if (!micActive || isListening || isSpeaking) return;
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { alert("Speech not supported"); micActive = false; return; }

        recognition = new SR();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = "";

        recognition.onresult = function (e) {
            var text = e.results[0][0].transcript;
            isListening = false;
            if (text.trim()) sendText(text.trim());
            else restartMic(500);
        };
        recognition.onerror = function (e) {
            isListening = false;
            restartMic(e.error === "no-speech" ? 300 : 2000);
        };
        recognition.onend = function () {
            isListening = false;
            if (micActive && !busy && !isSpeaking) restartMic(300);
        };
        try { recognition.start(); isListening = true; }
        catch (e) { restartMic(500); }
    }

    function restartMic(delay) {
        if (!micActive) return;
        setTimeout(function () {
            if (micActive && !busy && !isSpeaking && !isListening) startListening();
        }, delay || 500);
    }

    // ═══════════════════════════════════════════════════════
    //  NAVIGATION — auto-open maps from GPS to destination
    // ═══════════════════════════════════════════════════════
    function autoNavigate(dest) {
        var origin = gpsPos ? gpsPos.lat + "," + gpsPos.lng : "";
        // Try to detect mobile for native app deep links
        var ua = navigator.userAgent.toLowerCase();
        var isIOS = /iphone|ipad/.test(ua);
        var isAndroid = /android/.test(ua);

        if (isAndroid) {
            // Try Google Maps app first
            window.location.href = "google.navigation:q=" + encodeURIComponent(dest) + "&mode=d";
        } else if (isIOS) {
            // Try Apple Maps
            window.location.href = "maps://?daddr=" + encodeURIComponent(dest) + "&dirflg=d";
        } else {
            // Desktop fallback
            var url = "https://www.google.com/maps/dir/?api=1"
                + (origin ? "&origin=" + origin : "")
                + "&destination=" + encodeURIComponent(dest)
                + "&travelmode=driving";
            window.open(url, "_blank");
        }
    }

    function openGoogleMaps(dest) {
        var origin = gpsPos ? gpsPos.lat + "," + gpsPos.lng : "";
        window.open("https://www.google.com/maps/dir/?api=1" + (origin ? "&origin=" + origin : "") + "&destination=" + encodeURIComponent(dest) + "&travelmode=driving", "_blank");
    }
    function openWaze(dest) {
        window.open("https://waze.com/ul?q=" + encodeURIComponent(dest) + "&navigate=yes", "_blank");
    }

    // ═══════════════════════════════════════════════════════
    //  SHOW UNIT NUMBER BIG + MAP + AUTO-NAVIGATE
    // ═══════════════════════════════════════════════════════
    function showDeliveryCard(parsed) {
        removeEl("deliveryCard");

        var fullAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
        var mapSrc = "";
        if (gpsPos) {
            mapSrc = "https://maps.google.com/maps?saddr=" + gpsPos.lat + "," + gpsPos.lng
                + "&daddr=" + encodeURIComponent(fullAddr) + "&output=embed";
        } else {
            mapSrc = "https://maps.google.com/maps?q=" + encodeURIComponent(fullAddr) + "&z=16&output=embed";
        }

        var div = document.createElement("div");
        div.id = "deliveryCard";

        // Build HTML
        var html = "";

        // UNIT NUMBER — BIG
        if (parsed.unit) {
            html += '<div class="unit-card">'
                + '<div class="unit-label">UNIT / BLOCK NUMBER</div>'
                + '<div class="unit-num">' + esc(parsed.unit) + '</div>'
                + '<div class="unit-addr">' + esc(parsed.address) + '</div>';
            if (parsed.language) {
                html += '<div class="unit-lang">\ud83c\udf10 ' + esc(parsed.language) + ' (auto-detected)</div>';
            }
            html += '</div>';
        }

        // If no unit extracted, show address prominently
        if (!parsed.unit) {
            html += '<div class="unit-card">'
                + '<div class="unit-label">DELIVERY ADDRESS</div>'
                + '<div class="unit-num" style="font-size:20px">' + esc(parsed.address) + '</div>';
            if (parsed.postal) html += '<div class="unit-addr">\ud83d\udcee ' + esc(parsed.postal) + '</div>';
            if (parsed.language) html += '<div class="unit-lang">\ud83c\udf10 ' + esc(parsed.language) + '</div>';
            html += '</div>';
        }

        // Recipient
        if (parsed.recipient) {
            html += '<div style="color:rgba(255,255,255,0.6);font-size:12px;padding:4px 0">\ud83d\udc64 ' + esc(parsed.recipient) + '</div>';
        }

        // Auto-navigating card
        html += '<div class="anav">'
            + '<div class="anav-title"><div class="anav-dot"></div>AUTO-NAVIGATING FROM YOUR LOCATION</div>'
            + '<div class="mf"><iframe src="' + mapSrc + '" width="100%" height="180" allowfullscreen loading="lazy"></iframe></div>'
            + '<div class="anav-btns">'
            + '<button class="bg" id="navG">\ud83d\uddfa Google Maps</button>'
            + '<button class="bw" id="navW">\ud83d\udea6 Waze</button>'
            + '</div>'
            + '</div>';

        div.innerHTML = html;
        chatEl.appendChild(div);
        scrollDown();

        // Wire nav buttons (manual re-open)
        document.getElementById("navG").addEventListener("click", function () { openGoogleMaps(fullAddr); });
        document.getElementById("navW").addEventListener("click", function () { openWaze(fullAddr); });
    }

    // ═══════════════════════════════════════════════════════
    //  RENDER HELPERS
    // ═══════════════════════════════════════════════════════
    function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
    function scrollDown() { chatEl.scrollTop = chatEl.scrollHeight; }
    function removeEl(id) { var el = document.getElementById(id); if (el) el.remove(); }

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
        var el = document.createElement("div"); el.id = "proc"; el.className = "proc";
        el.textContent = "Processing..."; chatEl.appendChild(el); scrollDown();
    }
    function hideProc() { removeEl("proc"); }
    function updateSend() { sendBtn.classList.toggle("on", !!inp.value.trim()); }

    // ═══════════════════════════════════════════════════════
    //  SEND TEXT
    // ═══════════════════════════════════════════════════════
    function sendText(overrideText) {
        var text = overrideText || inp.value;
        if (!text || !text.trim() || busy) return;
        addBubble("user", text.trim());
        inp.value = ""; updateSend();
        busy = true; showProc();

        apiChat(text.trim(), function (err, reply) {
            hideProc(); busy = false;
            if (err) { addBubble("assistant", "Error: " + err); restartMic(1000); }
            else {
                addBubble("assistant", reply);
                speak(reply.replace(/[\u2022\-\*]/g, "").replace(/\n+/g, ". "), function () { restartMic(500); });
            }
        });
    }

    // ═══════════════════════════════════════════════════════
    //  SCAN LABEL — extract unit → show big → auto-navigate
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
                if (err2) { addBubble("assistant", "Error: " + err2); restartMic(1000); return; }

                var parsed = null;
                try { parsed = JSON.parse(reply.replace(/```json|```/g, "").trim()); } catch (e) {}

                if (parsed && parsed.address) {
                    var fullAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
                    scannedAddr = fullAddr;

                    // Show unit number BIG + map
                    showDeliveryCard(parsed);

                    // Voice announce + auto-open navigation
                    var voiceMsg = parsed.unit
                        ? "Unit " + parsed.unit + ". " + parsed.address + ". Opening navigation."
                        : parsed.address + ". Opening navigation.";

                    speak(voiceMsg, function () {
                        // Auto-open maps navigation after speaking
                        autoNavigate(fullAddr);
                        restartMic(3000);
                    });
                } else {
                    addBubble("assistant", reply);
                    restartMic(1000);
                }
            });
        });
    }

    // ═══════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════
    CHIPS.forEach(function (c) {
        var btn = document.createElement("button");
        btn.className = "chip"; btn.textContent = c;
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
    navBtnEl.addEventListener("click", function () {
        if (scannedAddr) autoNavigate(scannedAddr);
    });
    stopBtnEl.addEventListener("click", stopSpeak);

    initGPS();
    addBubble("assistant", "Ready. Tap \ud83c\udfa4 once for hands-free. Scan a label \u2014 I\u2019ll show the unit and auto-navigate you there.");

})();
