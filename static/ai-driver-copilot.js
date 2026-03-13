// ═══════════════════════════════════════════════════════════
// NINJA CO-PILOT — CTO DEMO UPGRADE
// Features:
// - Always-on hands-free mic after first tap
// - Turn-by-turn voice navigation
// - Nearest place search (hotel / toilet / MRT / petrol / restaurant / mall)
// - Parcel OCR scan -> auto route
// - ETA 5-minute notify popup (SMS / WhatsApp)
// - Rain delay popup (SMS / WhatsApp)
// - Multi-language voice + UI text
// - Uses backend endpoints: /api/geocode /api/address-to-latlng /api/place-search
//   /api/route /api/weather /api/chat /api/scan /api/transcribe
// ═══════════════════════════════════════════════════════════

(function () {
    "use strict";

    var MAX_DIM = 800;
    var MAX_BYTES = 4 * 1024 * 1024;
    var ETA_NOTIFY_SECONDS = 300;
    var ETA_NOTIFY_METERS = 1200;
    var WEATHER_REFRESH_MS = 5 * 60 * 1000;
    var RECORDER_SEGMENT_MS = 2600;
    var GPS_CHECK_INTERVAL_MS = 1500;
    var DEFAULT_CUSTOMER_PHONE = "88918958";
    var AUTO_HANDS_FREE = true;

    var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    var hasSR = !!SpeechRecognitionCtor;
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

    var CHIPS = [
        "Nearest hotel",
        "Nearest toilet",
        "Nearest MRT",
        "Nearest petrol station",
        "Nearest restaurant",
        "Cannot find address",
        "No answer",
        "Traffic jam",
        "Damaged parcel",
        "Set customer phone 88918958"
    ];

    var state = {
        gpsPos: null,
        currentStreet: "",
        selectedLang: 0,

        micActive: false,
        isListening: false,
        isSpeaking: false,
        speechUnlocked: false,
        recognition: null,
        mediaRecorder: null,
        audioChunks: [],
        recordTimer: null,
        ttsTimer: null,

        busy: false,
        customerPhone: DEFAULT_CUSTOMER_PHONE,
        scannedAddr: null,

        navActive: false,
        activeRoute: null,
        activeStepIndex: 0,
        lastSpokenStep: -1,
        lastGpsCheckAt: 0,
        notifyShownForRoute: false,
        arrivalPromptSpoken: false,
        rainAlertShownForRoute: false,
        currentWeatherInfo: null,
        weatherTimer: null
    };

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

    function currentLang() {
        return LANGUAGES[state.selectedLang];
    }

    function isCantoneseMode() {
        return currentLang().ai === "Cantonese";
    }

    function uiText(key) {
        var ai = currentLang().ai;

        var zh = {
            ready: "准备好",
            pick_language: "选择语言",
            tap_mic_once: "按一下 🎙️",
            scan_label: "扫描包裹标签来读取电话号码",
            ask_route: "输入目的地或说出附近地点",
            rain_popup_note: "如果目的地下雨，会自动弹出延误通知",
            route_starting: "🗺 现在开始导航...",
            route_not_found: "找不到路线。",
            notify_arrival: "📩 快到了，要通知客户吗？",
            eta_about: "预计大约 ",
            eta_minutes: " 分钟内到",
            close: "关闭",
            rain_near_dest: "☔ 目的地附近下雨，要通知客户延迟吗？",
            detected_weather: "检测到目的地天气：",
            about_5_min: "还有大约五分钟到，要通知客户吗？",
            raining_prompt: "目的地附近正在下雨，要通知客户可能会稍微延迟吗？",
            arrived: "已经到达目的地。",
            route_notif: "前方大约 ",
            meters: " 米，",
            customer_phone_saved: "客户号码已保存：",
            invalid_phone: "电话号码无效。",
            weather_unknown: "下雨",
            processing: "处理中...",
            mic_waiting: "免提模式已开启，正在持续听取...",
            tap_once_to_enable: "浏览器限制：请先按一次麦克风启用免提模式。",
            gps_needed: "请先开启 GPS。",
            nearby_failed: "找不到附近地点。",
            listening_on: "免提麦克风已开启。",
            listening_off: "免提麦克风已关闭。",
            route_updated: "路线已更新。",
            eta_alert: "预计五分钟内到达。",
            scan_error: "扫描失败。"
        };

        var yue = {
            ready: "準備好",
            pick_language: "揀語言",
            tap_mic_once: "撳一下 🎙️",
            scan_label: "掃描包裹標籤讀取電話號碼",
            ask_route: "輸入目的地或者講附近地點",
            rain_popup_note: "如果目的地下雨，會自動彈出延誤通知",
            route_starting: "🗺 而家開始導航...",
            route_not_found: "搵唔到路線。",
            notify_arrival: "📩 就快到，要通知客戶嗎？",
            eta_about: "預計大約 ",
            eta_minutes: " 分鐘內到",
            close: "關閉",
            rain_near_dest: "☔ 目的地附近落雨，要通知客戶延遲嗎？",
            detected_weather: "檢測到目的地天氣：",
            about_5_min: "仲有大約五分鐘到，要通知客戶嗎？",
            raining_prompt: "目的地附近正喺落雨，要通知客戶可能會遲少少嗎？",
            arrived: "已經到咗目的地。",
            route_notif: "前面大約 ",
            meters: " 米，",
            customer_phone_saved: "客戶電話已保存：",
            invalid_phone: "電話號碼無效。",
            weather_unknown: "落雨",
            processing: "處理中...",
            mic_waiting: "免提模式已開，持續聽緊...",
            tap_once_to_enable: "瀏覽器限制：請先撳一次咪高峰啟用免提模式。",
            gps_needed: "請先開 GPS。",
            nearby_failed: "搵唔到附近地點。",
            listening_on: "免提咪已開。",
            listening_off: "免提咪已關。",
            route_updated: "路線已更新。",
            eta_alert: "預計五分鐘內到。",
            scan_error: "掃描失敗。"
        };

        var en = {
            ready: "Ready",
            pick_language: "Pick language",
            tap_mic_once: "Tap 🎙️ once",
            scan_label: "Scan parcel label to capture phone",
            ask_route: "Ask for a route",
            rain_popup_note: "Rain delay popup will appear automatically if destination is raining",
            route_starting: "🗺 Getting directions...",
            route_not_found: "Route not found.",
            notify_arrival: "📩 Near destination. Notify customer?",
            eta_about: "Estimated arrival in about ",
            eta_minutes: " minutes",
            close: "Close",
            rain_near_dest: "☔ Rain near destination. Send delay notice to customer?",
            detected_weather: "Detected destination weather: ",
            about_5_min: "About 5 minutes to arrival. Notify customer?",
            raining_prompt: "It is raining near the destination. Send a delay notice to the customer?",
            arrived: "You have arrived.",
            route_notif: "In ",
            meters: " meters, ",
            customer_phone_saved: "Customer phone saved: ",
            invalid_phone: "Invalid phone number.",
            weather_unknown: "rain",
            processing: "Processing...",
            mic_waiting: "Hands-free mode is on. Listening continuously...",
            tap_once_to_enable: "Browser rule: tap the mic once first to enable hands-free mode.",
            gps_needed: "Please turn on GPS first.",
            nearby_failed: "Could not find a nearby place.",
            listening_on: "Hands-free mic is on.",
            listening_off: "Hands-free mic is off.",
            route_updated: "Route updated.",
            eta_alert: "Estimated arrival within 5 minutes.",
            scan_error: "Scan failed."
        };

        var map;
        if (ai === "Chinese Simplified" || ai === "Chinese Traditional") map = zh;
        else if (ai === "Cantonese") map = yue;
        else map = en;
        return map[key] || en[key] || key;
    }

    function normalizeCantoneseText(text) {
        var t = String(text || "").trim();
        if (!t) return t;
        var replacements = [
            [/最近的/g, "最近嘅"], [/附近的/g, "附近嘅"], [/现在/g, "而家"], [/位于/g, "喺"],
            [/左转/g, "左轉"], [/右转/g, "右轉"], [/到达/g, "到咗"], [/厕所/g, "洗手間"],
            [/正在/g, "而家正喺"]
        ];
        replacements.forEach(function (pair) { t = t.replace(pair[0], pair[1]); });
        return t;
    }

    function tuneReplyByLanguage(text) {
        return isCantoneseMode() ? normalizeCantoneseText(text) : String(text || "");
    }

    function esc(s) {
        var d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    function removeEl(id) {
        var el = document.getElementById(id);
        if (el) el.remove();
    }

    function scrollDown() {
        chatEl.scrollTop = chatEl.scrollHeight;
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
        removeEl("proc");
        var el = document.createElement("div");
        el.id = "proc";
        el.className = "proc";
        el.textContent = uiText("processing");
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
        return tuneReplyByLanguage(
            String(reply || "")
                .replace(/ADDRESS:\s*.*$/im, "")
                .replace(/PLACE:\s*.*$/im, "")
                .replace(/\n+/g, ". ")
                .trim()
        );
    }

    function getSysPrompt() {
        var locInfo = state.currentStreet
            ? "\nDriver current location: " + state.currentStreet + (state.gpsPos ? " (GPS:" + state.gpsPos.lat.toFixed(5) + "," + state.gpsPos.lng.toFixed(5) + ")" : "")
            : "";

        var replyRule;
        if (isCantoneseMode()) {
            replyRule = [
                "IMPORTANT: Reply ONLY in Cantonese.",
                "Use Hong Kong Cantonese grammar and wording.",
                "Use Traditional Chinese characters.",
                "Never reply in Mandarin."
            ].join(" ");
        } else {
            replyRule = "LANGUAGE: Reply ONLY in " + currentLang().ai + ".";
        }

        return [
            "You are Ninja Co-Pilot, AI assistant for Ninja Van drivers in Singapore." + locInfo,
            replyRule,
            "STRICT RULES:",
            "- Maximum 15 words.",
            "- GPS navigation style.",
            "- Action first.",
            "NEVER ask questions.",
            "NEVER give multiple options.",
            "For nearby place requests choose the nearest place using GPS.",
            "For navigation replies always include:",
            "ADDRESS: full Singapore address with postal code",
            "PLACE: short place name"
        ].join("\n");
    }

    function getOcrPrompt() {
        return [
            "Extract Singapore delivery information from this parcel image.",
            "Important: text may be handwritten, rotated, tilted, messy, partially hidden, or upside down.",
            "Try all reading orientations.",
            "Singapore formats:",
            "- Phone numbers are 8 digits",
            "- Postal codes are 6 digits",
            "- Blocks may look like 'Blk 123 Street Name'",
            "If you see 'PH' it means phone number.",
            "Return JSON ONLY. No markdown. No backticks.",
            '{"address":"full address or best guess","unit":"unit/block or null","postal":"6 digit postal code or null","recipient":"name or null","sender":"sender or null","phone":"8 digit phone only digits","place":"place name or null","confidence":"high/medium/low"}'
        ].join("\n");
    }

    function extractPhoneFromText(text) {
        var m = String(text || "").match(/(?:\+?65[-\s]?)?(\d{8})/);
        return m && m[1] ? m[1] : null;
    }

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
        state.customerPhone = clean;
        return true;
    }

    function getCustomerPhoneForSms() {
        return state.customerPhone.replace(/^\+/, "");
    }

    function getCustomerPhoneForWhatsApp() {
        return state.customerPhone.replace(/^\+/, "");
    }

    function getArrivalMessage() {
        return "Hello, I will arrive in about 5 minutes. Please be ready to receive the parcel. Thank you.";
    }

    function getRainDelayMessage() {
        return "Hello, due to rain and traffic conditions near your destination, your parcel may be slightly delayed. Thank you for your patience.";
    }

    function openSms(phone, message) {
        var p = String(phone || "");
        var body = encodeURIComponent(message || "");
        var url = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase())
            ? "sms:" + p + "&body=" + body
            : "sms:" + p + "?body=" + body;
        window.location.href = url;
    }

    function openWhatsApp(phone, message) {
        var p = String(phone || "").replace(/[^\d]/g, "");
        var text = encodeURIComponent(message || "");
        window.open("https://wa.me/" + p + "?text=" + text, "_blank");
    }

    function removeArrivalCard() { removeEl("arrivalNotifyCard"); }
    function removeRainCard() { removeEl("rainDelayCard"); }

    function showArrivalNotifyCard() {
        removeArrivalCard();

        var mins = state.activeRoute ? Math.max(1, Math.round((state.activeRoute.total_duration || 0) / 60)) : 5;
        var msg = getArrivalMessage();
        var title = uiText("notify_arrival");
        var etaText = uiText("eta_about") + mins + uiText("eta_minutes");

        var div = document.createElement("div");
        div.id = "arrivalNotifyCard";
        div.innerHTML =
            '<div style="background:rgba(227,24,55,0.10);border:1px solid rgba(227,24,55,0.28);border-radius:14px;padding:12px;margin:8px 0;">' +
                '<div style="color:#fff;font-size:13px;font-weight:700;margin-bottom:6px;">' + esc(title) + '</div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:6px;">' + esc(etaText) + '</div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:6px;">Phone: <span style="color:#fff;font-weight:700;">' + esc(state.customerPhone) + '</span></div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:10px;">' + esc(msg) + '</div>' +
                '<div style="display:flex;gap:8px;">' +
                    '<button id="arrivalSmsBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:#E31837;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">SMS</button>' +
                    '<button id="arrivalWaBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:#25D366;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">WhatsApp</button>' +
                    '<button id="arrivalCloseBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:rgba(255,255,255,0.12);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">' + esc(uiText("close")) + '</button>' +
                '</div>' +
            '</div>';

        chatEl.appendChild(div);
        scrollDown();

        document.getElementById("arrivalSmsBtn").onclick = function () { openSms(getCustomerPhoneForSms(), msg); };
        document.getElementById("arrivalWaBtn").onclick = function () { openWhatsApp(getCustomerPhoneForWhatsApp(), msg); };
        document.getElementById("arrivalCloseBtn").onclick = function () { removeArrivalCard(); };
    }

    function showRainDelayCard(weatherInfo) {
        removeRainCard();

        var msg = getRainDelayMessage();
        var title = uiText("rain_near_dest");
        var detail = uiText("detected_weather") + (weatherInfo && weatherInfo.description ? weatherInfo.description : uiText("weather_unknown"));

        var div = document.createElement("div");
        div.id = "rainDelayCard";
        div.innerHTML =
            '<div style="background:rgba(30,144,255,0.10);border:1px solid rgba(30,144,255,0.30);border-radius:14px;padding:12px;margin:8px 0;">' +
                '<div style="color:#fff;font-size:13px;font-weight:700;margin-bottom:6px;">' + esc(title) + '</div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:6px;">' + esc(detail) + '</div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:6px;">Phone: <span style="color:#fff;font-weight:700;">' + esc(state.customerPhone) + '</span></div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:10px;">' + esc(msg) + '</div>' +
                '<div style="display:flex;gap:8px;">' +
                    '<button id="rainSmsBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:#E31837;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">SMS</button>' +
                    '<button id="rainWaBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:#25D366;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">WhatsApp</button>' +
                    '<button id="rainCloseBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:rgba(255,255,255,0.12);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">' + esc(uiText("close")) + '</button>' +
                '</div>' +
            '</div>';

        chatEl.appendChild(div);
        scrollDown();

        document.getElementById("rainSmsBtn").onclick = function () { openSms(getCustomerPhoneForSms(), msg); };
        document.getElementById("rainWaBtn").onclick = function () { openWhatsApp(getCustomerPhoneForWhatsApp(), msg); };
        document.getElementById("rainCloseBtn").onclick = function () { removeRainCard(); };
    }

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

    function apiPlaceSearch(q, cb) {
        if (!state.gpsPos) {
            cb("No GPS");
            return;
        }

        fetch("/api/place-search?q=" + encodeURIComponent(q) + "&lat=" + encodeURIComponent(state.gpsPos.lat) + "&lng=" + encodeURIComponent(state.gpsPos.lng))
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.error || d.lat == null || d.lng == null) cb(d.error || "Place not found");
            else cb(null, d);
        })
        .catch(function (e) { cb(e.message); });
    }

    function startSR() {
        if (!state.micActive || state.isListening || state.isSpeaking || state.busy) return;
        if (!SpeechRecognitionCtor) {
            useRecorder = true;
            startRecording();
            return;
        }

        state.recognition = new SpeechRecognitionCtor();
        state.recognition.continuous = true;
        state.recognition.interimResults = false;
        state.recognition.lang = currentLang().code;

        state.recognition.onresult = function (e) {
            for (var i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) {
                    var text = e.results[i][0].transcript.trim();
                    if (text) {
                        stopListeningSR();
                        sendText(text);
                        return;
                    }
                }
            }
        };

        state.recognition.onerror = function () {
            state.isListening = false;
            if (state.micActive && !state.isSpeaking && !state.busy) {
                setTimeout(function () { if (state.micActive) startSR(); }, 900);
            }
        };

        state.recognition.onend = function () {
            state.isListening = false;
            if (state.micActive && !state.isSpeaking && !state.busy) {
                setTimeout(function () { if (state.micActive && !state.isListening) startSR(); }, 300);
            }
        };

        try {
            state.recognition.start();
            state.isListening = true;
            micLabel.textContent = uiText("mic_waiting");
        } catch (e) {
            setTimeout(function () { if (state.micActive) startSR(); }, 500);
        }
    }

    function stopListeningSR() {
        if (state.recognition) {
            try { state.recognition.stop(); } catch (e) {}
        }
        state.isListening = false;
    }

    function getSupportedMimeType() {
        var types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
        for (var i = 0; i < types.length; i++) {
            if (window.MediaRecorder && MediaRecorder.isTypeSupported(types[i])) return types[i];
        }
        return "";
    }

    function startRecording() {
        if (!state.micActive || state.isListening || state.isSpeaking || state.busy) return;

        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            state.audioChunks = [];

            var options = {};
            var mime = getSupportedMimeType();
            if (mime) options.mimeType = mime;

            try { state.mediaRecorder = new MediaRecorder(stream, options); }
            catch (e) { state.mediaRecorder = new MediaRecorder(stream); }

            state.mediaRecorder.ondataavailable = function (e) {
                if (e.data.size > 0) state.audioChunks.push(e.data);
            };

            state.mediaRecorder.onstop = function () {
                clearTimeout(state.recordTimer);
                stream.getTracks().forEach(function (t) { t.stop(); });

                if (!state.micActive || state.audioChunks.length === 0) return;

                var blob = new Blob(state.audioChunks, { type: state.mediaRecorder.mimeType || "audio/webm" });
                if (blob.size < 2500) {
                    state.isListening = false;
                    if (state.micActive && !state.busy) startRecording();
                    return;
                }

                var reader = new FileReader();
                reader.onload = function () {
                    var base64 = reader.result.split(",")[1];
                    state.isListening = false;
                    showProc();
                    apiTranscribe(base64, function (err, text) {
                        hideProc();
                        if (err || !String(text || "").trim()) {
                            if (state.micActive && !state.busy) startRecording();
                            return;
                        }
                        sendText(String(text).trim());
                    });
                };
                reader.readAsDataURL(blob);
            };

            state.mediaRecorder.start();
            state.isListening = true;
            micLabel.textContent = uiText("mic_waiting");

            state.recordTimer = setTimeout(function () {
                if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
                    state.mediaRecorder.stop();
                }
            }, RECORDER_SEGMENT_MS);

        }).catch(function () {
            addBubble("assistant", "Mic access denied. Please allow microphone permission.");
            stopMic();
        });
    }

    function toggleMic() {
        unlockSpeech();

        if (state.micActive) {
            stopMic();
            addBubble("assistant", uiText("listening_off"));
            return;
        }

        state.micActive = true;
        voiceBtn.classList.add("active");
        voiceBtn.querySelector("span:last-child").textContent = "MIC ON";
        micBar.classList.add("on");
        micLabel.textContent = "MIC • " + currentLang().flag + " " + currentLang().ai;
        addBubble("assistant", uiText("listening_on"));

        if (useRecorder) startRecording();
        else startSR();
    }

    function stopMic() {
        state.micActive = false;
        state.isListening = false;

        voiceBtn.classList.remove("active");
        voiceBtn.querySelector("span:last-child").textContent = "TAP TO SPEAK";
        micBar.classList.remove("on");

        clearTimeout(state.recordTimer);

        if (state.recognition) {
            try { state.recognition.stop(); } catch (e) {}
        }
        if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
            try { state.mediaRecorder.stop(); } catch (e) {}
        }
    }

    function restartMicAfterReply() {
        if (!AUTO_HANDS_FREE) return;
        if (!state.micActive) return;

        setTimeout(function () {
            if (!state.micActive || state.isSpeaking || state.busy || state.isListening) return;
            if (useRecorder) startRecording();
            else startSR();
        }, 500);
    }

    function detectNearbyIntent(text) {
        var low = String(text || "").toLowerCase();
        var intents = [
            { keys: ["nearest hotel", "hotel near me", "nearby hotel"], q: "hotel" },
            { keys: ["nearest mrt", "mrt near me", "nearby mrt"], q: "mrt station" },
            { keys: ["nearest toilet", "toilet near me", "nearby toilet", "restroom near me"], q: "toilet" },
            { keys: ["nearest petrol station", "petrol near me", "gas station near me", "nearby petrol station"], q: "petrol station" },
            { keys: ["nearest mall", "mall near me", "nearby mall", "shopping mall near me"], q: "shopping mall" },
            { keys: ["nearest restaurant", "restaurant near me", "food near me", "nearby restaurant"], q: "restaurant" }
        ];

        for (var i = 0; i < intents.length; i++) {
            for (var j = 0; j < intents[i].keys.length; j++) {
                if (low.indexOf(intents[i].keys[j]) >= 0) return intents[i].q;
            }
        }
        return null;
    }

    function routeToPlace(place) {
        if (!state.gpsPos) {
            addBubble("assistant", uiText("gps_needed"));
            return;
        }

        state.scannedAddr = place.address || place.name || "";
        stopLiveNavigation();
        addBubble("assistant", "PLACE: " + (place.name || "") + "\nADDRESS: " + (place.address || ""));
        addBubble("assistant", uiText("route_starting"));

        fetch("/api/route?from_lat=" + encodeURIComponent(state.gpsPos.lat) + "&from_lng=" + encodeURIComponent(state.gpsPos.lng) + "&to_lat=" + encodeURIComponent(place.lat) + "&to_lng=" + encodeURIComponent(place.lng))
        .then(function (r) { return r.json(); })
        .then(function (route) {
            if (!route || route.error || !route.steps || !route.steps.length) {
                addBubble("assistant", uiText("route_not_found"));
                restartMicAfterReply();
                return;
            }
            route.dest_lat = place.lat;
            route.dest_lng = place.lng;
            route.dest_display = place.address || place.name || "";
            showRouteSteps(route);
            startLiveNavigation(route);
        })
        .catch(function () {
            addBubble("assistant", uiText("route_not_found"));
            restartMicAfterReply();
        });
    }

    function handleNearbyIntent(text) {
        var q = detectNearbyIntent(text);
        if (!q) return false;

        if (!state.gpsPos) {
            addBubble("assistant", uiText("gps_needed"));
            return true;
        }

        state.busy = true;
        showProc();

        apiPlaceSearch(q, function (err, place) {
            hideProc();
            state.busy = false;

            if (err || !place) {
                addBubble("assistant", uiText("nearby_failed"));
                restartMicAfterReply();
                return;
            }

            speak(place.name || q, function () {
                routeToPlace(place);
            });
        });

        return true;
    }

    function fetchRoute(destAddr, cb) {
        if (!state.gpsPos) {
            cb("No GPS");
            return;
        }

        fetch(
            "/api/address-to-latlng?address=" + encodeURIComponent(destAddr) +
            "&user_lat=" + encodeURIComponent(state.gpsPos.lat) +
            "&user_lng=" + encodeURIComponent(state.gpsPos.lng) +
            "&use_places=1"
        )
        .then(function (r) { return r.json(); })
        .then(function (g) {
            if (!g.lat) {
                cb("Address not found");
                return;
            }

            fetch("/api/route?from_lat=" + encodeURIComponent(state.gpsPos.lat) + "&from_lng=" + encodeURIComponent(state.gpsPos.lng) + "&to_lat=" + encodeURIComponent(g.lat) + "&to_lng=" + encodeURIComponent(g.lng))
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

    function handleVoiceShortcuts(rawText) {
        var t = String(rawText || "").trim().toLowerCase();

        if (t === "mic off" || t === "stop listening") {
            stopMic();
            addBubble("assistant", uiText("listening_off"));
            return true;
        }

        if (t === "mic on" || t === "start listening") {
            if (!state.micActive) toggleMic();
            return true;
        }

        if (t.indexOf("repeat step") >= 0 || t.indexOf("say again") >= 0) {
            speakCurrentStepIfNeeded(true);
            return true;
        }

        if (t.indexOf("stop navigation") >= 0) {
            stopLiveNavigation();
            addBubble("assistant", uiText("route_updated"));
            return true;
        }

        return false;
    }

    function sendText(text) {
        if (!text || !text.trim() || state.busy) return;

        var rawText = text.trim();
        if (handleVoiceShortcuts(rawText)) return;

        var phoneMatch = rawText.match(/set customer phone\s+([+\d\s-]+)/i);
        if (phoneMatch && phoneMatch[1]) {
            if (setCustomerPhone(phoneMatch[1])) {
                addBubble("user", rawText);
                addBubble("assistant", uiText("customer_phone_saved") + state.customerPhone);
            } else {
                addBubble("assistant", uiText("invalid_phone"));
            }
            inp.value = "";
            updateSend();
            restartMicAfterReply();
            return;
        }

        var maybePhone = extractPhoneFromText(rawText);
        if (maybePhone) setCustomerPhone(maybePhone);

        addBubble("user", rawText);
        inp.value = "";
        updateSend();

        if (handleNearbyIntent(rawText)) return;

        state.busy = true;
        showProc();

        var aiText = rawText;
        if (state.gpsPos) {
            aiText += "\n[DRIVER_GPS: " + state.gpsPos.lat.toFixed(6) + "," + state.gpsPos.lng.toFixed(6) + "]";
        }

        apiChat(aiText, function (err, reply) {
            hideProc();
            state.busy = false;

            if (err) {
                addBubble("assistant", "Error: " + err);
                speak("Error. " + err);
                return;
            }

            reply = tuneReplyByLanguage(reply);
            addBubble("assistant", reply);

            var addrMatch = reply.match(/ADDRESS:\s*(.+)/i);
            if (addrMatch && addrMatch[1]) {
                var navAddr = addrMatch[1].trim();
                state.scannedAddr = navAddr;
                stopLiveNavigation();

                speak(cleanReplyForSpeech(reply), function () {
                    addBubble("assistant", uiText("route_starting"));
                    fetchRoute(navAddr, function (routeErr, route) {
                        if (!routeErr && route && route.steps && route.steps.length) {
                            showRouteSteps(route);
                            startLiveNavigation(route);
                        } else {
                            addBubble("assistant", uiText("route_not_found"));
                            restartMicAfterReply();
                        }
                    });
                });
            } else {
                speak(cleanReplyForSpeech(reply));
            }
        });
    }

    function handleScan(fileInput) {
        var file = fileInput.files && fileInput.files[0];
        if (!file || state.busy) return;

        state.busy = true;

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

                addBubble("user", "📷 Scanned (" + w + "×" + h + ")", b64);
                showProc();

                apiScan(b64.split(",")[1], function (err2, reply) {
                    hideProc();
                    state.busy = false;
                    fileInput.value = "";

                    if (err2) {
                        addBubble("assistant", "Error: " + err2);
                        speak(uiText("scan_error"));
                        return;
                    }

                    var parsed = null;
                    try {
                        parsed = JSON.parse(reply.replace(/```json|```/g, "").trim());
                    } catch (e) {}

                    if (parsed && parsed.phone) setCustomerPhone(parsed.phone);

                    if (parsed && parsed.address) {
                        var fullAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
                        state.scannedAddr = fullAddr;
                        stopLiveNavigation();
                        showDeliveryCard(parsed);

                        var voice = parsed.unit ? "Unit " + parsed.unit + ". " + parsed.address : parsed.address;
                        voice = tuneReplyByLanguage(voice);

                        speak(voice, function () {
                            addBubble("assistant", uiText("route_starting"));
                            fetchRoute(fullAddr, function (re, route) {
                                if (!re && route && route.steps && route.steps.length) {
                                    showRouteSteps(route);
                                    startLiveNavigation(route);
                                } else {
                                    addBubble("assistant", uiText("route_not_found"));
                                    restartMicAfterReply();
                                }
                            });
                        });
                    } else {
                        reply = tuneReplyByLanguage(reply);
                        addBubble("assistant", reply);
                        speak(reply);
                    }
                });
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    renderLangBar();

    CHIPS.forEach(function (c) {
        var btn = document.createElement("button");
        btn.className = "chip";
        btn.textContent = c;
        btn.onclick = function () {
            unlockSpeech();
            sendText(c);
        };
        chipsEl.appendChild(btn);
    });

    sendBtn.onclick = function () {
        unlockSpeech();
        sendText(inp.value);
    };

    inp.addEventListener("input", updateSend);

    inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            unlockSpeech();
            sendText(inp.value);
        }
    });

    voiceBtn.onclick = function () {
        unlockSpeech();
        toggleMic();
    };

    scanBtn.onclick = function () {
        unlockSpeech();
        cameraIn.click();
    };

    photoBtn.onclick = function () {
        unlockSpeech();
        photoIn.click();
    };

    cameraIn.onchange = function () { handleScan(cameraIn); };
    photoIn.onchange = function () { handleScan(photoIn); };

    navBtnEl.onclick = function () {
        unlockSpeech();
        if (state.scannedAddr) {
            stopLiveNavigation();
            fetchRoute(state.scannedAddr, function (e, r) {
                if (!e && r && r.steps && r.steps.length) {
                    showRouteSteps(r);
                    startLiveNavigation(r);
                } else {
                    addBubble("assistant", uiText("route_not_found"));
                }
            });
        }
    };

    stopBtnEl.onclick = stopSpeak;

    if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = function () {
            try { window.speechSynthesis.getVoices(); } catch (e) {}
        };
    }

    function initGPS() {
        if (!navigator.geolocation) {
            locAddr.textContent = "GPS not available";
            return;
        }

        navigator.geolocation.watchPosition(
            function (p) {
                state.gpsPos = {
                    lat: p.coords.latitude,
                    lng: p.coords.longitude,
                    acc: p.coords.accuracy
                };
                locBar.classList.remove("no-gps");
                reverseGeocode(state.gpsPos.lat, state.gpsPos.lng);
                updateLiveNavigation();
            },
            function () {
                locBar.classList.add("no-gps");
                locAddr.textContent = "GPS searching...";
            },
            { enableHighAccuracy: true, maximumAge: 4000, timeout: 10000 }
        );
    }

    initGPS();

    var mode = useRecorder ? "(recording mode)" : "(voice mode)";
    addBubble(
        "assistant",
        uiText("ready") + " " + mode + ".\n" +
        "1️⃣ " + uiText("pick_language") + "\n" +
        "2️⃣ " + uiText("tap_mic_once") + "\n" +
        "3️⃣ " + uiText("scan_label") + "\n" +
        "4️⃣ " + uiText("ask_route") + "\n" +
        "5️⃣ " + uiText("rain_popup_note") + "\n" +
        "6️⃣ " + uiText("tap_once_to_enable")
    );
})();
