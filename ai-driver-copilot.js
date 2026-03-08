// ═══════════════════════════════════════════════════════════
//  NINJA CO-PILOT v2 — Enhanced
//  - Embedded Leaflet live map with route polyline
//  - Auto-detect walk/drive mode from GPS speed
//  - Weather display (nice day / bad day)
//  - Photo scan → auto-navigate with embedded map
//  - Step-by-step voice navigation with map tracking
// ═══════════════════════════════════════════════════════════

(function () {
    "use strict";

    // ── Constants ──
    var MAX_DIM = 800, MAX_BYTES = 4 * 1024 * 1024;
    var ETA_NOTIFY_SECONDS = 300;
    var ETA_NOTIFY_METERS = 1200;
    var DEFAULT_CUSTOMER_PHONE = "";
    var WALK_SPEED_THRESHOLD = 2.0; // m/s (~7 km/h). Below = walking
    var SPEED_SAMPLES_MAX = 5;

    var ua = navigator.userAgent.toLowerCase();
    var isIOS = /iphone|ipad|ipod/.test(ua);
    var hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    var useRecorder = !hasSR;

    var LANGUAGES = [
        { label: "EN",     flag: "🇬🇧", code: "en-SG", ai: "English" },
        { label: "中文",    flag: "🇨🇳", code: "zh-CN", ai: "Chinese Simplified" },
        { label: "繁體",    flag: "🇹🇼", code: "zh-TW", ai: "Chinese Traditional" },
        { label: "廣東話",  flag: "🇭🇰", code: "zh-HK", ai: "Cantonese" },
        { label: "Malay",  flag: "🇲🇾", code: "ms-MY", ai: "Malay" },
        { label: "Tamil",  flag: "🇮🇳", code: "ta-IN", ai: "Tamil" },
        { label: "ไทย",    flag: "🇹🇭", code: "th-TH", ai: "Thai" },
        { label: "Việt",   flag: "🇻🇳", code: "vi-VN", ai: "Vietnamese" },
        { label: "Indo",   flag: "🇮🇩", code: "id-ID", ai: "Bahasa Indonesia" },
        { label: "한국어",   flag: "🇰🇷", code: "ko-KR", ai: "Korean" },
        { label: "日本語",   flag: "🇯🇵", code: "ja-JP", ai: "Japanese" }
    ];

    var LANG_TTS = {
        "zh-CN": ["zh-CN", "cmn-CN", "zh"],
        "zh-TW": ["zh-TW", "cmn-TW", "zh-Hant", "zh"],
        "zh-HK": ["zh-HK", "yue-HK", "zh-yue", "yue", "zh-Hant-HK"],
        "ms": ["ms-MY", "ms"],
        "ta": ["ta-IN", "ta"],
        "id": ["id-ID", "id"],
        "th": ["th-TH", "th"],
        "vi": ["vi-VN", "vi"],
        "fil": ["fil-PH", "tl-PH", "fil"],
        "ko": ["ko-KR", "ko"],
        "ja": ["ja-JP", "ja"],
        "en": ["en-SG", "en-US", "en-GB", "en"]
    };

    // ── State ──
    var busy = false, scannedAddr = null, isSpeaking = false, micActive = false;
    var isListening = false, recognition = null, gpsPos = null, selectedLang = 0;
    var currentStreet = "";
    var mediaRecorder = null, audioChunks = [];
    var recordTimer = null, ttsTimer = null, speechUnlocked = false;

    var activeRoute = null, activeStepIndex = 0, lastSpokenStep = -1, navActive = false;
    var lastGpsCheckAt = 0;

    var customerPhone = DEFAULT_CUSTOMER_PHONE;
    var notifyShownForRoute = false, arrivalPromptSpoken = false;
    var rainAlertShownForRoute = false, currentWeatherInfo = null;

    var lastDetectedLang = "en-SG";

    // Transport mode detection
    var transportMode = "driving"; // "driving" or "walking"
    var speedSamples = [];
    var lastGpsTime = 0, lastGpsLat = 0, lastGpsLng = 0;

    // Weather state
    var currentLocationWeather = null;

    // ── Leaflet Map State ──
    var leafletMap = null, driverMarker = null, destMarker = null, routeLine = null;
    var mapInitialized = false, mapFollowing = true;

    // ── DOM ──
    var chatEl = document.getElementById("chat"), inp = document.getElementById("inp");
    var sendBtn = document.getElementById("sendBtn"), voiceBtn = document.getElementById("voiceBtn");
    var scanBtn = document.getElementById("scanBtn"), photoBtn = document.getElementById("photoBtn");
    var navBtnEl = document.getElementById("navBtn"), stopBtnEl = document.getElementById("stopBtn");
    var sbEl = document.getElementById("sb"), micBar = document.getElementById("micBar");
    var micLabel = document.getElementById("micLabel");
    var locBar = document.getElementById("locBar"), locAddr = document.getElementById("locAddr");
    var langBar = document.getElementById("langBar"), chipsEl = document.getElementById("chips");
    var cameraIn = document.getElementById("cameraIn"), photoIn = document.getElementById("photoIn");

    var mapPanel = document.getElementById("mapPanel");
    var mapToggle = document.getElementById("mapToggle");
    var mapClose = document.getElementById("mapClose");
    var mapStepBanner = document.getElementById("mapStepBanner");
    var mapInfoEl = document.getElementById("mapInfo");
    var mapEtaEl = document.getElementById("mapEta");
    var mapDistEl = document.getElementById("mapDist");

    var weatherBadge = document.getElementById("weatherBadge");
    var weatherIcon = document.getElementById("weatherIcon");
    var weatherTemp = document.getElementById("weatherTemp");
    var weatherDesc = document.getElementById("weatherDesc");

    var transportModeEl = document.getElementById("transportMode");
    var transportIconEl = document.getElementById("transportIcon");
    var transportLabelEl = document.getElementById("transportLabel");

    // ═══════════════════════════════════════════
    // LANGUAGE HELPERS
    // ═══════════════════════════════════════════
    function currentLang() { return LANGUAGES[selectedLang]; }
    function syncReplyLanguageToSelection() { lastDetectedLang = currentLang().code; }
    function isCantoneseMode() { return currentLang().code === "zh-HK"; }
    function isTraditionalChineseMode() { return currentLang().code === "zh-TW"; }
    function isSimplifiedChineseMode() { return currentLang().code === "zh-CN"; }

    function getPreferredReplyLanguage() {
        var map = {
            "zh-HK": "Cantonese", "zh-TW": "Traditional Chinese", "zh-CN": "Simplified Chinese",
            "ms-MY": "Malay", "ta-IN": "Tamil", "th-TH": "Thai", "vi-VN": "Vietnamese",
            "id-ID": "Bahasa Indonesia", "ko-KR": "Korean", "ja-JP": "Japanese"
        };
        return map[currentLang().code] || "English";
    }

    function getSysPrompt() {
        var locInfo = currentStreet
            ? "\nDriver current location: " + currentStreet + (gpsPos ? " (GPS:" + gpsPos.lat.toFixed(5) + "," + gpsPos.lng.toFixed(5) + ")" : "")
            : "";

        var modeInfo = "\nDriver is currently " + (transportMode === "walking" ? "WALKING" : "DRIVING") + ".";

        var replyRule;
        if (isCantoneseMode()) {
            replyRule = "IMPORTANT: Reply ONLY in Cantonese. Use Hong Kong Cantonese wording and grammar. Use Traditional Chinese characters. Do NOT reply in Mandarin or simplified Chinese.";
        } else if (isTraditionalChineseMode()) {
            replyRule = "IMPORTANT: Reply ONLY in Traditional Chinese. Use Traditional Chinese characters only.";
        } else if (isSimplifiedChineseMode()) {
            replyRule = "IMPORTANT: Reply ONLY in Simplified Chinese. Use Simplified Chinese characters only.";
        } else {
            replyRule = "IMPORTANT: Reply ONLY in " + getPreferredReplyLanguage() + ". Use natural local wording.";
        }

        return [
            "You are Ninja Co-Pilot, AI assistant for Ninja Van delivery drivers." + locInfo + modeInfo,
            replyRule,
            "RULES: Under 60 words. Professional. Action first.",
            "",
            "NAVIGATION REQUESTS:",
            "When driver asks to go to ANY place (restaurant, petrol station, toilet, shop, block, building, etc.):",
            "- Find the nearest one based on driver's current location",
            "- You MUST include this exact line in your reply:",
            "  ADDRESS: [full Singapore address with street name and postal code]",
            "- Never return only a block number or place name",
            "",
            "PHOTO/IMAGE ANALYSIS:",
            "If the driver sends a photo of a street sign, block number, building, or any location indicator:",
            "- Identify the block number, street name, or any address info visible",
            "- Combine with driver's current GPS location to determine full address",
            "- Return ADDRESS: [full address] so navigation can start automatically",
            "",
            "PARTIAL ADDRESSES:",
            "If driver says only a block number like '214', combine it with current location and return the nearest likely full Singapore address with postal code."
        ].join("\n");
    }

    function getOcrPrompt() {
        return [
            "Look at this image carefully. It could be a parcel label, a street sign, a building number, an HDB block photo, or any location indicator.",
            "Driver is at: " + (currentStreet || "unknown") + (gpsPos ? " (GPS:" + gpsPos.lat.toFixed(5) + "," + gpsPos.lng.toFixed(5) + ")" : "") + ".",
            "",
            "TASKS:",
            "1. If it's a PARCEL LABEL: Extract delivery address, unit, postal code, recipient, phone number.",
            "2. If it's a STREET/BLOCK/BUILDING photo: Identify block number, street name, or any address info visible. Combine with driver location to get full address.",
            "3. If label only shows block/unit without street, infer full address from driver location.",
            "",
            "JSON ONLY:",
            '{"address":"FULL street address with street name","unit":"unit/block or null","postal":"postal code or null","recipient":"name or null","sender":"sender or null","phone":"phone or null","language":"detected language","confidence":"high/medium/low","type":"parcel_label|street_sign|building|other"}'
        ].join("\n");
    }

    // ═══════════════════════════════════════════
    // UI TEXT
    // ═══════════════════════════════════════════
    var CHIPS = [
        "Cannot find address",
        "No answer",
        "Traffic jam",
        "Damaged parcel",
        "Nearest petrol station",
        "Nearest toilet"
    ];

    function uiText(key) {
        var ai = currentLang().ai;
        var zh = {
            ready: "准备好", pick_language: "选择语言", tap_mic_once: "按一下 🎙️",
            scan_label: "扫描包裹标签或拍摄街道/门牌号", ask_route: "输入目的地或说出附近地点",
            rain_popup_note: "天气会自动显示，下雨会提醒",
            route_starting: "正在获取路线...", route_not_found: "找不到路线。",
            notify_arrival: "快到了，要通知客户吗？", eta_about: "预计大约 ",
            eta_minutes: " 分钟内到", close: "关闭",
            rain_near_dest: "目的地附近下雨，要通知客户延迟吗？",
            about_5_min: "还有大约五分钟到，要通知客户吗？",
            raining_prompt: "目的地附近正在下雨，要通知客户可能会稍微延迟吗？",
            arrived: "已经到达目的地。", route_notif: "前方大约 ", meters: " 米，",
            customer_phone_saved: "客户号码已保存：", invalid_phone: "电话号码无效。",
            weather_unknown: "下雨", processing: "处理中...",
            nice_day: "好天气", bad_day: "天气不好",
            auto_walking: "检测到步行模式", auto_driving: "检测到驾驶模式",
            photo_analyzing: "正在分析照片..."
        };
        var yue = {
            ready: "準備好", pick_language: "揀語言", tap_mic_once: "撳一下 🎙️",
            scan_label: "掃描包裹標籤或影街道/門牌號", ask_route: "輸入目的地或者講附近地點",
            rain_popup_note: "天氣會自動顯示，落雨會提醒",
            route_starting: "而家搵緊路線...", route_not_found: "搵唔到路線。",
            notify_arrival: "就快到，要通知客戶嗎？", eta_about: "預計大約 ",
            eta_minutes: " 分鐘內到", close: "關閉",
            rain_near_dest: "目的地附近落雨，要通知客戶延遲嗎？",
            about_5_min: "仲有大約五分鐘到，要通知客戶嗎？",
            raining_prompt: "目的地附近正喺落雨，要通知客戶可能會遲少少嗎？",
            arrived: "已經到咗目的地。", route_notif: "前面大約 ", meters: " 米，",
            customer_phone_saved: "客戶電話已保存：", invalid_phone: "電話號碼無效。",
            weather_unknown: "落雨", processing: "處理中...",
            nice_day: "好天氣", bad_day: "天氣唔好",
            auto_walking: "偵測到行路模式", auto_driving: "偵測到揸車模式",
            photo_analyzing: "分析緊張相..."
        };
        var en = {
            ready: "Ready", pick_language: "Pick language", tap_mic_once: "Tap 🎙️ once",
            scan_label: "Scan parcel label or snap a street/block photo",
            ask_route: "Ask for a route or snap a photo of the address",
            rain_popup_note: "Weather shows automatically. Rain alerts enabled",
            route_starting: "Getting directions...", route_not_found: "Route not found.",
            notify_arrival: "Near destination. Notify customer?", eta_about: "ETA about ",
            eta_minutes: " minutes", close: "Close",
            rain_near_dest: "Rain near destination. Send delay notice?",
            about_5_min: "About 5 minutes to arrival. Notify customer?",
            raining_prompt: "It is raining near destination. Send delay notice?",
            arrived: "You have arrived.", route_notif: "In ", meters: " meters, ",
            customer_phone_saved: "Customer phone saved: ", invalid_phone: "Invalid phone.",
            weather_unknown: "rain", processing: "Processing...",
            nice_day: "Nice day", bad_day: "Bad weather",
            auto_walking: "Walking mode detected", auto_driving: "Driving mode detected",
            photo_analyzing: "Analyzing photo..."
        };
        var map;
        if (ai === "Chinese Simplified" || ai === "Chinese Traditional") map = zh;
        else if (ai === "Cantonese") map = yue;
        else map = en;
        return map[key] || en[key] || key;
    }

    // ═══════════════════════════════════════════
    // CANTONESE TEXT NORMALIZATION
    // ═══════════════════════════════════════════
    function normalizeCantoneseText(text) {
        var t = String(text || "").trim();
        if (!t) return t;
        var replacements = [
            [/最近的/g, "最近嘅"], [/附近的/g, "附近嘅"], [/你的/g, "你嘅"],
            [/当前位置/g, "而家位置"], [/现在/g, "而家"], [/位于/g, "喺"],
            [/这里/g, "呢度"], [/那边/g, "嗰邊"], [/可以前往/g, "可以去"],
            [/请前往/g, "請去"], [/直走/g, "直行"], [/左转/g, "左轉"],
            [/右转/g, "右轉"], [/到达/g, "到咗"], [/已到达/g, "已經到咗"],
            [/厕所/g, "洗手間"], [/没有/g, "冇"], [/是否/g, "係咪"]
        ];
        replacements.forEach(function (pair) { t = t.replace(pair[0], pair[1]); });
        return t;
    }

    function tuneReplyByLanguage(text) {
        var t = String(text || "");
        if (isCantoneseMode()) return normalizeCantoneseText(t);
        return t;
    }

    // ═══════════════════════════════════════════
    // PHONE HELPERS
    // ═══════════════════════════════════════════
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
    function getCustomerPhoneForSms() { return customerPhone.replace(/^\+/, ""); }
    function getCustomerPhoneForWhatsApp() { return customerPhone.replace(/^\+/, ""); }

    function getArrivalMessage() {
        return "Hello, I will arrive in about 5 minutes. Please be ready to receive the parcel. Thank you.";
    }
    function getRainDelayMessage() {
        return "Hello, due to rain and traffic conditions near your destination, your parcel may be slightly delayed. Thank you for your patience.";
    }

    function openSms(phone, message) {
        var body = encodeURIComponent(message || "");
        var url = isIOS ? "sms:" + phone + "&body=" + body : "sms:" + phone + "?body=" + body;
        window.location.href = url;
    }
    function openWhatsApp(phone, message) {
        var p = String(phone || "").replace(/[^\d]/g, "");
        window.open("https://wa.me/" + p + "?text=" + encodeURIComponent(message || ""), "_blank");
    }

    // ═══════════════════════════════════════════
    // LEAFLET MAP
    // ═══════════════════════════════════════════
    function initMap() {
        if (mapInitialized) return;
        leafletMap = L.map("liveMap", {
            zoomControl: false,
            attributionControl: false,
            dragging: true,
            touchZoom: true,
            scrollWheelZoom: true
        }).setView([1.3521, 103.8198], 15); // Default Singapore

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19
        }).addTo(leafletMap);

        mapInitialized = true;

        // Detect user drag → stop auto-follow
        leafletMap.on("dragstart", function () { mapFollowing = false; });
    }

    function showMap() {
        initMap();
        mapPanel.classList.add("open");
        setTimeout(function () {
            leafletMap.invalidateSize();
            if (gpsPos) {
                leafletMap.setView([gpsPos.lat, gpsPos.lng], 16);
            }
        }, 450);
    }

    function hideMap() {
        mapPanel.classList.remove("open", "expanded");
    }

    function toggleMapSize() {
        if (mapPanel.classList.contains("expanded")) {
            mapPanel.classList.remove("expanded");
        } else {
            mapPanel.classList.add("expanded");
        }
        setTimeout(function () { leafletMap.invalidateSize(); }, 450);
    }

    function updateDriverMarker(lat, lng) {
        if (!mapInitialized) return;

        var icon = L.divIcon({
            className: "driver-marker",
            html: '<div class="driver-marker-pulse"></div><div class="driver-marker-inner"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        if (!driverMarker) {
            driverMarker = L.marker([lat, lng], { icon: icon, zIndexOffset: 1000 }).addTo(leafletMap);
        } else {
            driverMarker.setLatLng([lat, lng]);
        }

        if (mapFollowing && mapPanel.classList.contains("open")) {
            leafletMap.panTo([lat, lng], { animate: true, duration: 0.5 });
        }
    }

    function setDestMarker(lat, lng) {
        if (!mapInitialized) return;

        var icon = L.divIcon({
            className: "dest-marker",
            html: '<div class="dest-marker-inner"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });

        if (destMarker) leafletMap.removeLayer(destMarker);
        destMarker = L.marker([lat, lng], { icon: icon }).addTo(leafletMap);
    }

    function drawRoute(geometry) {
        if (!mapInitialized || !geometry) return;

        if (routeLine) leafletMap.removeLayer(routeLine);

        var coords = [];
        if (geometry.type === "LineString" && geometry.coordinates) {
            coords = geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
        }

        if (coords.length > 0) {
            routeLine = L.polyline(coords, {
                color: "#E31837",
                weight: 5,
                opacity: 0.8,
                smoothFactor: 1,
                dashArray: null
            }).addTo(leafletMap);

            leafletMap.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
        }
    }

    function clearRoute() {
        if (routeLine && mapInitialized) {
            leafletMap.removeLayer(routeLine);
            routeLine = null;
        }
        if (destMarker && mapInitialized) {
            leafletMap.removeLayer(destMarker);
            destMarker = null;
        }
        mapStepBanner.classList.remove("show");
        mapInfoEl.style.display = "none";
    }

    function updateMapStepBanner(text) {
        if (!text) {
            mapStepBanner.classList.remove("show");
            return;
        }
        mapStepBanner.textContent = text;
        mapStepBanner.classList.add("show");
    }

    function updateMapInfo(eta, dist) {
        if (!eta && !dist) {
            mapInfoEl.style.display = "none";
            return;
        }
        mapInfoEl.style.display = "block";
        mapEtaEl.textContent = eta || "";
        mapDistEl.textContent = dist || "";
    }

    mapToggle.addEventListener("click", function () { toggleMapSize(); });
    mapClose.addEventListener("click", function () { hideMap(); });

    // ═══════════════════════════════════════════
    // WEATHER
    // ═══════════════════════════════════════════
    function fetchLocationWeather(lat, lng) {
        fetch("/api/weather?lat=" + lat + "&lng=" + lng)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.status === "ok" || d.temp_c != null) {
                    currentLocationWeather = d;
                    updateWeatherBadge(d);
                }
            })
            .catch(function () {});
    }

    function getWeatherEmoji(desc, isRain) {
        var d = String(desc || "").toLowerCase();
        if (isRain || /rain|drizzle|shower|storm|thunder/.test(d)) return "🌧️";
        if (/cloud|overcast/.test(d)) return "☁️";
        if (/fog|mist|haze/.test(d)) return "🌫️";
        if (/snow|sleet|blizzard/.test(d)) return "❄️";
        if (/clear|sunny/.test(d)) return "☀️";
        if (/partly/.test(d)) return "⛅";
        return "🌤️";
    }

    function isNiceWeather(data) {
        if (!data) return true;
        if (data.is_rain) return false;
        var d = String(data.description || "").toLowerCase();
        if (/rain|drizzle|shower|storm|thunder|snow|sleet|blizzard|heavy/.test(d)) return false;
        return true;
    }

    function updateWeatherBadge(data) {
        if (!data) return;
        var emoji = getWeatherEmoji(data.description, data.is_rain);
        var temp = data.temp_c != null ? Math.round(data.temp_c) + "°C" : "--°";
        var desc = data.description || "Unknown";
        var nice = isNiceWeather(data);

        weatherIcon.textContent = emoji;
        weatherTemp.textContent = temp;
        weatherDesc.textContent = desc.length > 12 ? desc.substring(0, 10) + "…" : desc;

        weatherBadge.classList.remove("nice", "bad");
        weatherBadge.classList.add(nice ? "nice" : "bad");
    }

    function showWeatherCard(data) {
        if (!data) return;
        var nice = isNiceWeather(data);
        var emoji = getWeatherEmoji(data.description, data.is_rain);
        var temp = data.temp_c != null ? Math.round(data.temp_c) + "°C" : "";

        var div = document.createElement("div");
        div.className = "weather-card " + (nice ? "nice-day" : "bad-day");
        div.innerHTML =
            '<div class="weather-card-header">' +
                '<span class="weather-card-icon">' + emoji + '</span>' +
                '<div><div class="weather-card-title">' + esc(data.description || "Unknown") + (temp ? " • " + temp : "") + '</div>' +
                '<div class="weather-card-sub">Current weather at your location</div></div>' +
            '</div>' +
            '<div class="weather-card-body">' +
                (nice
                    ? "Good conditions for deliveries. Roads should be clear."
                    : "Take care on the roads. Visibility may be reduced. Drive safely.") +
            '</div>' +
            '<span class="weather-card-tag ' + (nice ? "nice" : "bad") + '">' +
                (nice ? "☀️ " + uiText("nice_day") : "⚠️ " + uiText("bad_day")) +
            '</span>';

        chatEl.appendChild(div);
        scrollDown();
    }

    weatherBadge.addEventListener("click", function () {
        if (currentLocationWeather) {
            showWeatherCard(currentLocationWeather);
        } else {
            addBubble("assistant", "Weather data loading...");
        }
    });

    // ═══════════════════════════════════════════
    // TRANSPORT MODE DETECTION
    // ═══════════════════════════════════════════
    function detectTransportMode(lat, lng, timestamp) {
        if (lastGpsTime > 0 && lastGpsLat !== 0) {
            var dt = (timestamp - lastGpsTime) / 1000; // seconds
            if (dt > 0.5 && dt < 30) {
                var dist = metersBetween(lastGpsLat, lastGpsLng, lat, lng);
                var speed = dist / dt; // m/s

                speedSamples.push(speed);
                if (speedSamples.length > SPEED_SAMPLES_MAX) speedSamples.shift();

                // Average speed
                var avgSpeed = speedSamples.reduce(function (a, b) { return a + b; }, 0) / speedSamples.length;

                var newMode = avgSpeed >= WALK_SPEED_THRESHOLD ? "driving" : "walking";

                if (newMode !== transportMode && speedSamples.length >= 3) {
                    transportMode = newMode;
                    updateTransportModeUI();
                }
            }
        }
        lastGpsTime = timestamp;
        lastGpsLat = lat;
        lastGpsLng = lng;
    }

    function updateTransportModeUI() {
        if (transportMode === "walking") {
            transportModeEl.className = "transport-mode walking";
            transportIconEl.textContent = "🚶";
            transportLabelEl.textContent = "WALK";
        } else {
            transportModeEl.className = "transport-mode driving";
            transportIconEl.textContent = "🚗";
            transportLabelEl.textContent = "DRIVE";
        }
    }

    // ═══════════════════════════════════════════
    // SPEECH / TTS
    // ═══════════════════════════════════════════
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

    function pickVoiceByTargets(targets) {
        if (!window.speechSynthesis) return null;
        var voices = window.speechSynthesis.getVoices() || [];
        if (!voices.length) return null;
        var exact = voices.find(function (v) {
            var lang = (v.lang || "").toLowerCase();
            return targets.some(function (t) { return lang === t.toLowerCase(); });
        });
        if (exact) return exact;
        var partial = voices.find(function (v) {
            var lang = (v.lang || "").toLowerCase();
            return targets.some(function (t) { return lang.indexOf(t.toLowerCase()) === 0; });
        });
        return partial || null;
    }

    function pickCantoneseVoice() {
        if (!window.speechSynthesis) return null;
        var voices = window.speechSynthesis.getVoices() || [];
        return voices.find(function (v) {
            var s = ((v.name || "") + " " + (v.lang || "")).toLowerCase();
            return /yue|cantonese|hong kong|zh-hk/.test(s);
        }) || null;
    }

    function stripEmojis(t) {
        return String(t || "")
            .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
            .replace(/[\u{2600}-\u{27BF}]/gu, "")
            .replace(/[\u{FE00}-\u{FEFF}]/gu, "")
            .replace(/[\u{1F900}-\u{1FAFF}]/gu, "")
            .replace(/[*_#\[\]]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function detectLang(text) {
        var code = currentLang().code;
        var langMap = {
            "zh-HK": "zh-HK", "zh-TW": "zh-TW", "zh-CN": "zh-CN",
            "ms-MY": "ms", "ta-IN": "ta", "th-TH": "th", "vi-VN": "vi",
            "id-ID": "id", "ko-KR": "ko", "ja-JP": "ja"
        };
        if (langMap[code]) { lastDetectedLang = langMap[code]; return; }

        var t = String(text || "");
        if (/[\u0e00-\u0e7f]/.test(t)) { lastDetectedLang = "th"; return; }
        if (/[\uac00-\ud7af]/.test(t)) { lastDetectedLang = "ko"; return; }
        if (/[\u3040-\u30ff]/.test(t)) { lastDetectedLang = "ja"; return; }
        if (/[佢哋而家咗喺咩唔冇啦啲咁樣嗰呢度]/.test(t)) { lastDetectedLang = "zh-HK"; return; }
        if (/[\u4e00-\u9fff]/.test(t)) { lastDetectedLang = "zh-CN"; return; }
        lastDetectedLang = "en";
    }

    function speak(text, onDone) {
        if (!window.speechSynthesis || !text) { if (onDone) onDone(); return; }
        try {
            window.speechSynthesis.cancel();
            clearInterval(ttsTimer);
            var cleanText = stripEmojis(tuneReplyByLanguage(text));
            if (!cleanText) { if (onDone) onDone(); return; }

            var langKey = lastDetectedLang || currentLang().code || "en";
            var targets = LANG_TTS[langKey] || LANG_TTS.en;
            var chosenVoice = langKey === "zh-HK"
                ? (pickVoiceByTargets(targets) || pickCantoneseVoice())
                : pickVoiceByTargets(targets);
            if (!chosenVoice) chosenVoice = pickVoiceByTargets(LANG_TTS.en);

            var u = new SpeechSynthesisUtterance(cleanText);
            u.rate = isCantoneseMode() ? 0.90 : 0.95;
            u.pitch = 1; u.volume = 1;
            if (chosenVoice) { u.voice = chosenVoice; u.lang = chosenVoice.lang || currentLang().code; }
            else { u.lang = currentLang().code; }

            u.onstart = function () { isSpeaking = true; sbEl.style.display = "flex"; };
            u.onend = function () { isSpeaking = false; sbEl.style.display = "none"; clearInterval(ttsTimer); if (onDone) onDone(); };
            u.onerror = function () { isSpeaking = false; sbEl.style.display = "none"; clearInterval(ttsTimer); if (onDone) onDone(); };

            window.speechSynthesis.speak(u);
            try { window.speechSynthesis.resume(); } catch (e) {}
            ttsTimer = setInterval(function () { try { window.speechSynthesis.resume(); } catch (e) {} }, 2000);
        } catch (e) {
            isSpeaking = false; sbEl.style.display = "none"; clearInterval(ttsTimer); if (onDone) onDone();
        }
    }

    function stopSpeak() {
        if (window.speechSynthesis) try { window.speechSynthesis.cancel(); } catch (e) {}
        isSpeaking = false; sbEl.style.display = "none"; clearInterval(ttsTimer);
    }

    if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = function () { try { window.speechSynthesis.getVoices(); } catch (e) {} };
    }

    // ═══════════════════════════════════════════
    // UI HELPERS
    // ═══════════════════════════════════════════
    function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
    function scrollDown() { chatEl.scrollTop = chatEl.scrollHeight; }
    function removeEl(id) { var el = document.getElementById(id); if (el) el.remove(); }

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
        el.id = "proc"; el.className = "proc";
        el.innerHTML = '<div class="proc-dot"></div><div class="proc-dot" style="animation-delay:0.2s"></div><div class="proc-dot" style="animation-delay:0.4s"></div><span style="color:rgba(255,255,255,0.3);font-size:12px;margin-left:4px">' + uiText("processing") + '</span>';
        chatEl.appendChild(el);
        scrollDown();
    }
    function hideProc() { removeEl("proc"); }
    function updateSend() { sendBtn.classList.toggle("on", !!inp.value.trim()); }

    function renderLangBar() {
        langBar.innerHTML = "";
        LANGUAGES.forEach(function (lang, i) {
            var btn = document.createElement("button");
            btn.className = "lang-btn" + (i === selectedLang ? " active" : "");
            btn.textContent = lang.flag + " " + lang.label;
            btn.addEventListener("click", function () {
                unlockSpeech(); selectedLang = i; syncReplyLanguageToSelection();
                renderLangBar();
                micLabel.textContent = "MIC • " + lang.flag + " " + lang.ai;
                addBubble("assistant", "🌐 " + lang.flag + " " + lang.ai);
            });
            langBar.appendChild(btn);
        });
    }

    // ═══════════════════════════════════════════
    // NOTIFICATION CARDS
    // ═══════════════════════════════════════════
    function removeArrivalCard() { removeEl("arrivalNotifyCard"); }
    function removeRainCard() { removeEl("rainDelayCard"); }

    function showArrivalNotifyCard() {
        removeArrivalCard();
        var mins = activeRoute ? Math.max(1, Math.round((activeRoute.total_duration || 0) / 60)) : 5;
        var msg = getArrivalMessage();
        var title = uiText("notify_arrival");
        var etaText = uiText("eta_about") + mins + uiText("eta_minutes");
        var hasPhone = !!customerPhone;

        var div = document.createElement("div");
        div.id = "arrivalNotifyCard";
        div.innerHTML =
            '<div style="background:rgba(227,24,55,0.10);border:1px solid rgba(227,24,55,0.28);border-radius:14px;padding:12px;margin:8px 0;">' +
                '<div style="color:#fff;font-size:13px;font-weight:700;margin-bottom:6px;">' + esc(title) + '</div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:6px;">' + esc(etaText) + '</div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:6px;">Phone: <span style="color:#fff;font-weight:700;">' + esc(customerPhone || "N/A") + '</span></div>' +
                '<div style="color:#fff;font-size:12px;line-height:1.5;background:rgba(255,255,255,0.05);border-radius:10px;padding:10px;margin-bottom:10px;">' + esc(msg) + '</div>' +
                '<div style="display:flex;gap:8px;">' +
                    (hasPhone ? '<button id="arrivalSmsBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:#E31837;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">SMS</button>' : '') +
                    (hasPhone ? '<button id="arrivalWaBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:#25D366;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">WhatsApp</button>' : '') +
                    '<button id="arrivalCloseBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:rgba(255,255,255,0.12);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">' + esc(uiText("close")) + '</button>' +
                '</div></div>';
        chatEl.appendChild(div); scrollDown();
        if (hasPhone) {
            document.getElementById("arrivalSmsBtn").addEventListener("click", function () { openSms(getCustomerPhoneForSms(), msg); });
            document.getElementById("arrivalWaBtn").addEventListener("click", function () { openWhatsApp(getCustomerPhoneForWhatsApp(), msg); });
        }
        document.getElementById("arrivalCloseBtn").addEventListener("click", removeArrivalCard);
    }

    function showRainDelayCard(weatherInfo) {
        removeRainCard();
        var msg = getRainDelayMessage();
        var title = uiText("rain_near_dest");
        var hasPhone = !!customerPhone;
        var div = document.createElement("div");
        div.id = "rainDelayCard";
        div.innerHTML =
            '<div style="background:rgba(30,144,255,0.10);border:1px solid rgba(30,144,255,0.30);border-radius:14px;padding:12px;margin:8px 0;">' +
                '<div style="color:#fff;font-size:13px;font-weight:700;margin-bottom:6px;">' + esc(title) + '</div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:6px;">🌧️ ' + esc(weatherInfo && weatherInfo.description || "") + '</div>' +
                '<div style="color:#fff;font-size:12px;background:rgba(255,255,255,0.05);border-radius:10px;padding:10px;margin-bottom:10px;">' + esc(msg) + '</div>' +
                '<div style="display:flex;gap:8px;">' +
                    (hasPhone ? '<button id="rainSmsBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:#E31837;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">SMS</button>' : '') +
                    (hasPhone ? '<button id="rainWaBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:#25D366;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">WhatsApp</button>' : '') +
                    '<button id="rainCloseBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:rgba(255,255,255,0.12);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">' + esc(uiText("close")) + '</button>' +
                '</div></div>';
        chatEl.appendChild(div); scrollDown();
        if (hasPhone) {
            document.getElementById("rainSmsBtn").addEventListener("click", function () { openSms(getCustomerPhoneForSms(), msg); });
            document.getElementById("rainWaBtn").addEventListener("click", function () { openWhatsApp(getCustomerPhoneForWhatsApp(), msg); });
        }
        document.getElementById("rainCloseBtn").addEventListener("click", removeRainCard);
    }

    // ═══════════════════════════════════════════
    // IMAGE COMPRESSION
    // ═══════════════════════════════════════════
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
                while (b64.length * 0.75 > MAX_BYTES && q > 0.2) {
                    q -= 0.1; b64 = c.toDataURL("image/jpeg", q);
                }
                cb(null, { base64: b64.split(",")[1], preview: b64, w: w, h: h, kb: Math.round((b64.length * 3) / 4 / 1024) });
            };
            img.onerror = function () { cb("Failed"); };
            img.src = e.target.result;
        };
        reader.onerror = function () { cb("Failed"); };
        reader.readAsDataURL(file);
    }

    // ═══════════════════════════════════════════
    // API CALLS
    // ═══════════════════════════════════════════
    function apiChat(text, cb) {
        fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ system: getSysPrompt(), messages: [{ role: "user", content: text }] })
        }).then(function (r) { return r.json(); })
          .then(function (d) { cb(d.error ? String(d.error) : null, d.reply || ""); })
          .catch(function (e) { cb(e.message); });
    }

    function apiScan(base64, cb) {
        fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ system: getSysPrompt(), image_base64: base64, ocr_prompt: getOcrPrompt() })
        }).then(function (r) { return r.json(); })
          .then(function (d) { cb(d.error ? String(d.error) : null, d.reply || ""); })
          .catch(function (e) { cb(e.message); });
    }

    function apiTranscribe(audioBase64, cb) {
        fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" },
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

    // ═══════════════════════════════════════════
    // MIC / VOICE INPUT
    // ═══════════════════════════════════════════
    function toggleMic() {
        unlockSpeech();
        if (micActive) { stopMic(); return; }
        micActive = true; syncReplyLanguageToSelection();
        voiceBtn.classList.add("active");
        voiceBtn.querySelector("span:last-child").textContent = "MIC ON";
        micBar.classList.add("on");
        micLabel.textContent = "MIC • " + currentLang().flag + " " + currentLang().ai;
        if (useRecorder) startRecording(); else startSR();
    }

    function stopMic() {
        micActive = false; isListening = false;
        voiceBtn.classList.remove("active");
        voiceBtn.querySelector("span:last-child").textContent = "TAP TO SPEAK";
        micBar.classList.remove("on");
        clearTimeout(recordTimer);
        if (recognition) try { recognition.stop(); } catch (e) {}
        if (mediaRecorder && mediaRecorder.state !== "inactive") try { mediaRecorder.stop(); } catch (e) {}
    }

    function startSR() {
        if (!micActive || isListening || isSpeaking || busy) return;
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { useRecorder = true; startRecording(); return; }
        recognition = new SR();
        recognition.continuous = true; recognition.interimResults = false;
        recognition.lang = currentLang().code;
        recognition.onresult = function (e) {
            for (var i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) {
                    var text = e.results[i][0].transcript.trim();
                    if (text) { stopListeningSR(); sendText(text); }
                }
            }
        };
        recognition.onerror = function () {
            isListening = false;
            if (micActive && !isSpeaking && !busy) setTimeout(function () { if (micActive) startSR(); }, 1000);
        };
        recognition.onend = function () {
            isListening = false;
            if (micActive && !isSpeaking && !busy) setTimeout(function () { if (micActive && !isListening) startSR(); }, 300);
        };
        try { recognition.start(); isListening = true; } catch (e) {
            setTimeout(function () { if (micActive) startSR(); }, 500);
        }
    }

    function stopListeningSR() { if (recognition) try { recognition.stop(); } catch (e) {} isListening = false; }

    function startRecording() {
        if (!micActive || isListening || isSpeaking || busy) return;
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            audioChunks = [];
            var options = { mimeType: "audio/webm" };
            try { mediaRecorder = new MediaRecorder(stream, options); }
            catch (e) { mediaRecorder = new MediaRecorder(stream); }
            mediaRecorder.ondataavailable = function (e) { if (e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.onstop = function () {
                clearTimeout(recordTimer);
                stream.getTracks().forEach(function (t) { t.stop(); });
                if (!micActive || audioChunks.length === 0) return;
                var blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
                if (blob.size < 2500) { isListening = false; if (micActive && !busy) startRecording(); return; }
                var reader = new FileReader();
                reader.onload = function () {
                    var base64 = reader.result.split(",")[1];
                    isListening = false; showProc();
                    apiTranscribe(base64, function (err, text) {
                        hideProc();
                        if (err || !String(text || "").trim()) {
                            if (err) addBubble("assistant", "Voice error: " + err);
                            if (micActive && !busy) startRecording();
                            return;
                        }
                        sendText(text.trim());
                    });
                };
                reader.readAsDataURL(blob);
            };
            mediaRecorder.start(); isListening = true;
            recordTimer = setTimeout(function () {
                if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
            }, 2500);
        }).catch(function () {
            addBubble("assistant", "Mic access denied."); stopMic();
        });
    }

    function restartMicAfterReply() {
        if (!micActive) return;
        setTimeout(function () {
            if (!micActive || isSpeaking || busy || isListening) return;
            if (useRecorder) startRecording(); else startSR();
        }, 500);
    }

    // ═══════════════════════════════════════════
    // GPS
    // ═══════════════════════════════════════════
    var weatherFetchTimer = 0;

    function initGPS() {
        if (!navigator.geolocation) { locAddr.textContent = "GPS not available"; return; }
        navigator.geolocation.watchPosition(
            function (p) {
                var newLat = p.coords.latitude;
                var newLng = p.coords.longitude;
                var ts = Date.now();

                gpsPos = { lat: newLat, lng: newLng, acc: p.coords.accuracy };
                locBar.classList.remove("no-gps");

                // Reverse geocode (throttled)
                reverseGeocode(newLat, newLng);

                // Update driver marker on map
                updateDriverMarker(newLat, newLng);

                // Detect transport mode
                detectTransportMode(newLat, newLng, ts);

                // Fetch weather every 2 minutes
                if (ts - weatherFetchTimer > 120000) {
                    weatherFetchTimer = ts;
                    fetchLocationWeather(newLat, newLng);
                }

                // Update live navigation
                updateLiveNavigation();
            },
            function () {
                locBar.classList.add("no-gps");
                locAddr.textContent = "GPS searching...";
            },
            { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
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

    // ═══════════════════════════════════════════
    // ROUTING
    // ═══════════════════════════════════════════
    function fetchRoute(destAddr, cb) {
        if (!gpsPos) { cb("No GPS"); return; }

        var profile = transportMode === "walking" ? "foot" : "driving";

        fetch("/api/address-to-latlng?address=" + encodeURIComponent(destAddr))
            .then(function (r) { return r.json(); })
            .then(function (g) {
                if (!g.lat) { cb("Address not found"); return; }

                fetch("/api/route?from_lat=" + gpsPos.lat + "&from_lng=" + gpsPos.lng +
                      "&to_lat=" + g.lat + "&to_lng=" + g.lng + "&profile=" + profile)
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
        var dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // ═══════════════════════════════════════════
    // LIVE NAVIGATION
    // ═══════════════════════════════════════════
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
        mapFollowing = true;

        // Show map with route
        showMap();
        if (route.geometry) drawRoute(route.geometry);
        if (route.dest_lat != null) setDestMarker(route.dest_lat, route.dest_lng);

        // Update map info
        var mins = Math.max(1, Math.round((route.total_duration || 0) / 60));
        var distKm = ((route.total_distance || 0) / 1000).toFixed(1);
        updateMapInfo("ETA: ~" + mins + " min", distKm + " km");

        highlightActiveStep();
        speakCurrentStepIfNeeded(true);

        // Check destination weather
        if (route.dest_lat != null && route.dest_lng != null) {
            apiWeather(route.dest_lat, route.dest_lng, function (err, weatherData) {
                if (!err && weatherData) { currentWeatherInfo = weatherData; }
            });
        }
    }

    function highlightActiveStep() {
        if (!activeRoute || !activeRoute.steps) return;
        activeRoute.steps.forEach(function (_, i) {
            var el = document.getElementById("rs" + i);
            if (el) el.className = "route-step" + (i === activeStepIndex ? " active" : "");
        });
        var activeEl = document.getElementById("rs" + activeStepIndex);
        if (activeEl) activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" });

        // Update map banner
        if (activeRoute.steps[activeStepIndex]) {
            updateMapStepBanner(tuneReplyByLanguage(activeRoute.steps[activeStepIndex].text));
        }
    }

    function speakCurrentStepIfNeeded(force) {
        if (!navActive || !activeRoute || !activeRoute.steps) return;
        if (activeStepIndex >= activeRoute.steps.length) return;
        if (!force && lastSpokenStep === activeStepIndex) return;
        var step = activeRoute.steps[activeStepIndex];
        if (!step || !step.text) return;
        lastSpokenStep = activeStepIndex;
        detectLang(step.text);
        speak(tuneReplyByLanguage(step.text));
    }

    function maybeShowArrivalNotify() {
        if (!navActive || !activeRoute || notifyShownForRoute) return;
        var secs = Number(activeRoute.total_duration || 0);
        var meters = Number(activeRoute.total_distance || 0);
        if ((secs > 0 && secs <= ETA_NOTIFY_SECONDS) || (meters > 0 && meters <= ETA_NOTIFY_METERS)) {
            notifyShownForRoute = true;
            if (!arrivalPromptSpoken) {
                arrivalPromptSpoken = true;
                detectLang(uiText("about_5_min"));
                speak(uiText("about_5_min"));
            }
            showArrivalNotifyCard();
        }
    }

    function maybeShowRainAlert() {
        if (!navActive || rainAlertShownForRoute) return;
        if (!currentWeatherInfo || !currentWeatherInfo.is_rain) return;
        rainAlertShownForRoute = true;
        detectLang(uiText("raining_prompt"));
        speak(uiText("raining_prompt"));
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

        // Approaching next step
        if (dist <= 80 && lastSpokenStep !== activeStepIndex) {
            var warnText = uiText("route_notif") + Math.round(dist) + uiText("meters") + tuneReplyByLanguage(step.text);
            detectLang(warnText);
            speak(warnText);
            lastSpokenStep = activeStepIndex;
            highlightActiveStep();
            maybeShowArrivalNotify();
            maybeShowRainAlert();
            return;
        }

        // Reached step
        if (dist <= 25) {
            activeStepIndex++;
            highlightActiveStep();

            // Update remaining
            var remainSecs = 0, remainMeters = 0;
            for (var i = activeStepIndex; i < activeRoute.steps.length; i++) {
                remainSecs += Number(activeRoute.steps[i].duration || 0);
                remainMeters += Number(activeRoute.steps[i].distance || 0);
            }
            activeRoute.total_duration = remainSecs;
            activeRoute.total_distance = remainMeters;

            var mins = Math.max(1, Math.round(remainSecs / 60));
            var distKm = (remainMeters / 1000).toFixed(1);
            updateMapInfo("ETA: ~" + mins + " min", distKm + " km");

            maybeShowArrivalNotify();
            maybeShowRainAlert();

            if (activeStepIndex < activeRoute.steps.length) {
                lastSpokenStep = -1;
                setTimeout(function () { speakCurrentStepIfNeeded(true); }, 500);
            } else {
                navActive = false;
                detectLang(uiText("arrived"));
                speak(uiText("arrived"));
                updateMapStepBanner("🏁 " + uiText("arrived"));
            }
        }
    }

    function stopLiveNavigation() {
        navActive = false;
        activeRoute = null; activeStepIndex = 0; lastSpokenStep = -1;
        notifyShownForRoute = false; arrivalPromptSpoken = false;
        rainAlertShownForRoute = false; currentWeatherInfo = null;
        removeArrivalCard(); removeRainCard();
        clearRoute();
    }

    function getIcon(t, m) {
        if (t === "depart") return "🚀";
        if (t === "arrive") return "🏁";
        if (t === "roundabout" || t === "rotary") return "🔄";
        if (m && m.indexOf("left") >= 0) return "⬅️";
        if (m && m.indexOf("right") >= 0) return "➡️";
        return "⬆️";
    }

    function showRouteSteps(route) {
        removeEl("routeCard");
        if (!route || !route.steps || !route.steps.length) return;

        var div = document.createElement("div");
        div.id = "routeCard";

        var modeEmoji = transportMode === "walking" ? "🚶" : "🚗";
        var html = '<div style="background:rgba(76,175,80,0.1);border:1px solid rgba(76,175,80,0.2);border-radius:12px;padding:12px;margin:8px 0">';
        html += '<div style="color:#4CAF50;font-size:10px;font-weight:600;letter-spacing:1px;margin-bottom:6px">' + modeEmoji + ' ' + esc(route.summary || "") + '</div>';

        route.steps.forEach(function (s, i) {
            html += '<div id="rs' + i + '" class="route-step">';
            html += '<span class="route-step-icon">' + getIcon(s.type, s.modifier) + '</span>';
            html += '<div class="route-step-text">' + esc(tuneReplyByLanguage(s.text)) + '</div></div>';
        });

        html += '<div style="display:flex;gap:6px;margin-top:8px">';
        html += '<button id="rSpk" style="flex:1;padding:10px;border-radius:8px;border:none;background:#E31837;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">🔊 Repeat Step</button>';
        html += '<button id="rCenter" style="flex:1;padding:10px;border-radius:8px;border:none;background:rgba(66,133,244,0.2);color:#4285F4;font-size:12px;font-weight:700;cursor:pointer;">📍 Center Map</button>';
        html += '</div></div>';

        div.innerHTML = html;
        chatEl.appendChild(div);
        scrollDown();

        document.getElementById("rSpk").addEventListener("click", function () {
            unlockSpeech(); speakCurrentStepIfNeeded(true);
        });
        document.getElementById("rCenter").addEventListener("click", function () {
            mapFollowing = true;
            if (gpsPos && mapInitialized) leafletMap.setView([gpsPos.lat, gpsPos.lng], 17);
        });
    }

    function showDeliveryCard(parsed) {
        removeEl("deliveryCard");
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

        if (parsed.recipient) html += '<div style="color:rgba(255,255,255,0.6);font-size:12px;padding:4px 0">👤 ' + esc(parsed.recipient) + '</div>';
        if (parsed.phone) html += '<div style="color:rgba(255,255,255,0.6);font-size:12px;padding:4px 0">📞 ' + esc(parsed.phone) + '</div>';

        div.innerHTML = html;
        chatEl.appendChild(div);
        scrollDown();
    }

    // ═══════════════════════════════════════════
    // SEND TEXT
    // ═══════════════════════════════════════════
    function cleanReplyForSpeech(reply) {
        return tuneReplyByLanguage(
            String(reply || "")
                .replace(/ADDRESS:\s*.*$/im, "")
                .replace(/PLACE:\s*.*$/im, "")
                .replace(/[•\-\*]/g, "")
                .replace(/\n+/g, ". ")
                .trim()
        );
    }

    function extractPhoneFromText(text) {
        var m = String(text || "").match(/(?:\+?65[-\s]?)?(\d{8})/);
        return m && m[1] ? m[1] : null;
    }

    function sendText(text) {
        if (!text || !text.trim() || busy) return;
        syncReplyLanguageToSelection();
        var rawText = text.trim();

        var phoneMatch = rawText.match(/set customer phone\s+([+\d\s-]+)/i);
        if (phoneMatch && phoneMatch[1]) {
            if (setCustomerPhone(phoneMatch[1])) {
                addBubble("user", rawText);
                addBubble("assistant", uiText("customer_phone_saved") + customerPhone);
            } else { addBubble("assistant", uiText("invalid_phone")); }
            inp.value = ""; updateSend(); return;
        }

        var maybePhone = extractPhoneFromText(rawText);
        if (maybePhone) setCustomerPhone(maybePhone);

        addBubble("user", rawText);
        inp.value = ""; updateSend();
        busy = true; showProc();

        apiChat(rawText, function (err, reply) {
            hideProc(); busy = false;
            if (err) {
                addBubble("assistant", "Error: " + err);
                speak("Error. " + err, restartMicAfterReply);
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
                }, 150);
            } else {
                setTimeout(function () { speak(cleanReplyForSpeech(reply), restartMicAfterReply); }, 150);
            }
        });
    }

    // ═══════════════════════════════════════════
    // SCAN / PHOTO HANDLER
    // ═══════════════════════════════════════════
    function handleScan(fileInput) {
        var file = fileInput.files && fileInput.files[0];
        if (!file || busy) return;
        busy = true;
        syncReplyLanguageToSelection();

        compressImage(file, function (err, img) {
            if (err) { addBubble("assistant", "Error: " + err); busy = false; return; }

            addBubble("user", "📷 Photo (" + img.w + "×" + img.h + ", " + img.kb + "KB)", img.preview);
            showProc();

            apiScan(img.base64, function (err2, reply) {
                hideProc(); busy = false;
                fileInput.value = "";

                if (err2) {
                    addBubble("assistant", "Error: " + err2);
                    speak("Scan error.", restartMicAfterReply);
                    return;
                }

                var parsed = null;
                try { parsed = JSON.parse(reply.replace(/```json|```/g, "").trim()); }
                catch (e) {}

                if (parsed && parsed.phone) setCustomerPhone(parsed.phone);

                if (parsed && parsed.address) {
                    var fullAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
                    scannedAddr = fullAddr;
                    stopLiveNavigation();
                    showDeliveryCard(parsed);

                    var voice = parsed.unit ? "Unit " + parsed.unit + ". " + parsed.address : parsed.address;
                    voice = tuneReplyByLanguage(voice);
                    detectLang(voice);

                    setTimeout(function () {
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
                    }, 150);
                } else {
                    // Could not parse JSON — try to use AI response to navigate
                    reply = tuneReplyByLanguage(reply);
                    detectLang(reply);
                    addBubble("assistant", reply);

                    // Check if reply contains an address
                    var addrMatch = reply.match(/ADDRESS:\s*(.+)/i);
                    if (addrMatch && addrMatch[1]) {
                        var addr = addrMatch[1].trim();
                        scannedAddr = addr;
                        stopLiveNavigation();

                        setTimeout(function () {
                            speak(cleanReplyForSpeech(reply), function () {
                                addBubble("assistant", uiText("route_starting"));
                                fetchRoute(addr, function (re, route) {
                                    if (!re && route && route.steps && route.steps.length) {
                                        showRouteSteps(route);
                                        startLiveNavigation(route);
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
            });
        });
    }

    // ═══════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════
    renderLangBar();
    syncReplyLanguageToSelection();

    CHIPS.forEach(function (c) {
        var btn = document.createElement("button");
        btn.className = "chip"; btn.textContent = c;
        btn.addEventListener("click", function () { unlockSpeech(); sendText(c); });
        chipsEl.appendChild(btn);
    });

    sendBtn.addEventListener("click", function () { unlockSpeech(); sendText(inp.value); });
    inp.addEventListener("input", updateSend);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { unlockSpeech(); sendText(inp.value); } });
    voiceBtn.addEventListener("click", function () { unlockSpeech(); toggleMic(); });
    scanBtn.addEventListener("click", function () { unlockSpeech(); cameraIn.click(); });
    photoBtn.addEventListener("click", function () { unlockSpeech(); photoIn.click(); });
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
                    addBubble("assistant", uiText("route_not_found"));
                }
            });
        } else {
            // No address yet → show map with current position
            showMap();
        }
    });

    stopBtnEl.addEventListener("click", stopSpeak);

    initGPS();

    // Initial weather fetch (Singapore default, will update once GPS locks)
    fetchLocationWeather(1.3521, 103.8198);

    var mode = useRecorder ? "(recording mode)" : "(voice mode)";
    addBubble(
        "assistant",
        uiText("ready") + " " + mode + "\n" +
        "1️⃣ " + uiText("pick_language") + "\n" +
        "2️⃣ " + uiText("tap_mic_once") + "\n" +
        "3️⃣ " + uiText("scan_label") + "\n" +
        "4️⃣ " + uiText("ask_route") + "\n" +
        "5️⃣ " + uiText("rain_popup_note")
    );

})();
