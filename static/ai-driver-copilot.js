// ═══════════════════════════════════════════════════════════
//  NINJA CO-PILOT v2.0
//  NEW: Transport mode detect | Live Leaflet map | Weather widget
//       Better multilingual SG | Live camera AI chat
// ═══════════════════════════════════════════════════════════

(function () {
    "use strict";

    var MAX_DIM = 800, MAX_BYTES = 4 * 1024 * 1024;
    var ETA_NOTIFY_SECONDS = 300;
    var ETA_NOTIFY_METERS = 1200;
    var DEFAULT_CUSTOMER_PHONE = "";
    var WEATHER_REFRESH_MS = 5 * 60 * 1000; // 5 min

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

    // ── State ──────────────────────────────────────────────
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

    // Transport mode
    var transportMode = "unknown"; // driving | walking | mrt | unknown
    var lastWeatherRefresh = 0;

    // Routing mode preference (can be overridden by transport detection)
    var routingMode = "driving"; // driving | walking

    // Leaflet map
    var leafletMap = null, mapMarker = null, routeLayer = null, destMarker = null;
    var mapVisible = false;

    // Live camera
    var camActive = false, camStream = null, camAutoInterval = null, camAutoOn = false;

    // ── DOM refs ───────────────────────────────────────────
    var chatEl       = document.getElementById("chat");
    var inp          = document.getElementById("inp");
    var sendBtn      = document.getElementById("sendBtn");
    var voiceBtn     = document.getElementById("voiceBtn");
    var scanBtn      = document.getElementById("scanBtn");
    var photoBtn     = document.getElementById("photoBtn");
    var sbEl         = document.getElementById("sb");
    var micBar       = document.getElementById("micBar");
    var micLabel     = document.getElementById("micLabel");
    var locBar       = document.getElementById("locBar");
    var locAddr      = document.getElementById("locAddr");
    var langBar      = document.getElementById("langBar");
    var chipsEl      = document.getElementById("chips");
    var cameraIn     = document.getElementById("cameraIn");
    var photoIn      = document.getElementById("photoIn");
    var mapBtn       = document.getElementById("mapBtn");
    var mapPanel     = document.getElementById("mapPanel");
    var mapZoomIn    = document.getElementById("mapZoomIn");
    var mapZoomOut   = document.getElementById("mapZoomOut");
    var mapCenter    = document.getElementById("mapCenter");
    var mapClose     = document.getElementById("mapClose");
    var mpDriving    = document.getElementById("mpDriving");
    var mpWalking    = document.getElementById("mpWalking");
    var liveCamBtn   = document.getElementById("liveCamBtn");
    var camOverlay    = document.getElementById("camOverlay");
    var camVideo      = document.getElementById("camVideo");
    var camSnap       = document.getElementById("camSnap");
    var camExitBtn    = document.getElementById("camExitBtn");
    var camAutoToggle = document.getElementById("camAutoToggle");
    var camStatus     = document.getElementById("camStatus");
    var camAiReply    = document.getElementById("camAiReply");
    var camNavBanner  = document.getElementById("camNavBanner");
    var camNavStep    = document.getElementById("camNavStep");
    var camNavEta     = document.getElementById("camNavEta");
    var camMapPip     = document.getElementById("camMapPip");
    var modeBadge    = document.getElementById("modeBadge");
    var wxBadge      = document.getElementById("wxBadge");
    var wxIcon       = document.getElementById("wxIcon");
    var wxTemp       = document.getElementById("wxTemp");
    var wxDesc       = document.getElementById("wxDesc");
    var navBtnEl     = document.getElementById("navBtn");
    var stopBtnEl    = document.getElementById("stopBtn");

    // ── Language helpers ───────────────────────────────────
    function currentLang() { return LANGUAGES[selectedLang]; }
    function syncReplyLanguageToSelection() { lastDetectedLang = currentLang().code; }
    function isCantoneseMode()   { return currentLang().code === "zh-HK"; }
    function isTraditionalMode() { return currentLang().code === "zh-TW"; }
    function isSimplifiedMode()  { return currentLang().code === "zh-CN"; }

    function getPreferredReplyLanguage() {
        var code = currentLang().code;
        if (code === "zh-HK") return "Cantonese";
        if (code === "zh-TW") return "Traditional Chinese";
        if (code === "zh-CN") return "Simplified Chinese";
        var map = { "ms-MY":"Malay","ta-IN":"Tamil","th-TH":"Thai","vi-VN":"Vietnamese","id-ID":"Bahasa Indonesia","ko-KR":"Korean","ja-JP":"Japanese" };
        return map[code] || "English";
    }

    // ── Singapore place name context ───────────────────────
    // FIX: Mixed-language place names (Kaki Bukit, Toa Payoh, etc.)
    var SG_PLACE_CONTEXT = [
        "Singapore place names can be English, Malay, Chinese, or Tamil.",
        "Common SG place names to NEVER translate: Kaki Bukit, Toa Payoh, Ang Mo Kio, Yio Chu Kang,",
        "Bukit Timah, Clementi, Tampines, Pasir Ris, Bedok, Jurong, Woodlands, Yishun,",
        "Sembawang, Punggol, Sengkang, Hougang, Serangoon, Bishan, Buona Vista,",
        "Orchard, Dhoby Ghaut, Farrer Road, Newton, Novena, Boon Lay, Lakeside,",
        "Choa Chu Kang, Bukit Batok, Bukit Gombak, Kranji, Marsiling, Admiralty.",
        "MRT line names: North-South Line, East-West Line, Circle Line, Downtown Line, Thomson-East Coast Line.",
        "If driver mentions a Singapore place name in any language, keep the original place name in the ADDRESS."
    ].join(" ");

    function getSysPrompt() {
        var locInfo = currentStreet
            ? "\nDriver current location: " + currentStreet + (gpsPos ? " (GPS:" + gpsPos.lat.toFixed(5) + "," + gpsPos.lng.toFixed(5) + ")" : "")
            : "";

        var modeInfo = "\nTransport mode: " + transportMode + ". Routing preference: " + routingMode + ".";

        var replyRule;
        if (isCantoneseMode()) {
            replyRule = [
                "IMPORTANT: Reply ONLY in Cantonese.",
                "Use Hong Kong Cantonese wording and grammar.",
                "Use Traditional Chinese characters.",
                "Do NOT reply in Mandarin.",
                "Do NOT reply in simplified Chinese.",
                "Do NOT translate into standard written Chinese."
            ].join(" ");
        } else if (isTraditionalMode()) {
            replyRule = "IMPORTANT: Reply ONLY in Traditional Chinese. Use Traditional Chinese characters only. Do NOT reply in Simplified Chinese.";
        } else if (isSimplifiedMode()) {
            replyRule = "IMPORTANT: Reply ONLY in Simplified Chinese. Use Simplified Chinese characters only. Do NOT reply in Traditional Chinese.";
        } else {
            replyRule = "IMPORTANT: Reply ONLY in " + getPreferredReplyLanguage() + ". Use natural local wording. Do not switch language.";
        }

        return [
            "You are Ninja Co-Pilot, AI assistant for Ninja Van delivery drivers." + locInfo + modeInfo,
            replyRule,
            "If the driver speaks in a specific language variant, reply in exactly that same language variant.",
            "Never switch to another Chinese variant unless the user switches first.",
            "RULES: Under 60 words. Professional. Action first.",
            "",
            SG_PLACE_CONTEXT,
            "",
            "NAVIGATION REQUESTS:",
            "When driver asks to go to ANY place (restaurant, petrol station, toilet, shop, block, building, MRT, bus stop, etc.):",
            "- Find the nearest one based on driver's current location in Singapore",
            "- You MUST include this exact line in your reply:",
            "  ADDRESS: [full Singapore address with street name and postal code]",
            "- Never return only a block number",
            "- Never return only a place name",
            "- Without the ADDRESS: line, navigation cannot start",
            "",
            "PARTIAL ADDRESSES:",
            "If driver says only a block number like '214', 'block 214', or 'blk 214', combine it with current location to infer a full Singapore address with postal code.",
            "",
            "TRANSPORT MODE:",
            "If mode is 'walking', suggest walking route and nearby MRT/bus.",
            "If mode is 'mrt', suggest nearest MRT station first.",
            "If mode is 'driving', suggest driving route."
        ].join("\n");
    }

    function getOcrPrompt() {
        return [
            "Extract delivery info from this package label. Auto-detect language.",
            "Driver is at: " + (currentStreet || "unknown") + " Singapore.",
            "If label only shows block/unit without street, infer full Singapore address from driver location.",
            "Extract unit/floor/block separately.",
            "Extract phone number if visible. Return phone as plain digits if possible.",
            "JSON ONLY:",
            '{"address":"FULL street address","unit":"unit/block or null","postal":"postal code or null","recipient":"name or null","sender":"sender or null","phone":"phone or null","language":"detected language","confidence":"high/medium/low"}'
        ].join("\n");
    }

    function getLiveCamPrompt() {
        var modeCtx = transportMode !== "unknown" ? " Driver is " + transportMode + "." : "";
        return [
            "You are Ninja Co-Pilot analyzing a live camera frame for a Ninja Van delivery driver.",
            "Driver is at: " + (currentStreet || "unknown location") + " Singapore." + modeCtx,
            "Identify: road signs, building names, block numbers, parcel labels, hazards, parking, traffic.",
            "Reply in " + getPreferredReplyLanguage() + ".",
            "MAX 30 words. Action-focused. Start with most important observation.",
            "Examples: 'Block 214 ahead, turn right.' | 'Road blocked, use alternative route.' | 'Parcel label: 10 Admiralty Street 757695.'"
        ].join(" ");
    }

    // ── CHIPS ──────────────────────────────────────────────
    var CHIPS = [
        "Cannot find address",
        "No answer",
        "Traffic jam",
        "Damaged parcel",
        "Nearest petrol station",
        "Nearest toilet",
        "Nearest MRT"
    ];

    // ── UI text helpers ────────────────────────────────────
    function uiText(key) {
        var ai = currentLang().ai;

        var zh = {
            ready: "准备好", pick_language: "选择语言", tap_mic_once: "按一下 🎙️",
            scan_label: "扫描包裹标签", ask_route: "输入目的地或说出附近地点",
            rain_popup_note: "如果目的地下雨，会自动弹出延误通知",
            route_starting: "现在开始导航...", route_not_found: "找不到路线。",
            notify_arrival: "快到了，要通知客户吗？", eta_about: "预计大约 ",
            eta_minutes: " 分钟内到", close: "关闭",
            rain_near_dest: "目的地附近下雨，要通知客户延迟吗？",
            detected_weather: "检测到目的地天气：", about_5_min: "还有大约五分钟到，要通知客户吗？",
            raining_prompt: "目的地附近正在下雨，要通知客户可能会稍微延迟吗？",
            arrived: "已经到达目的地。", route_notif: "前方大约 ", meters: " 米，",
            customer_phone_saved: "客户号码已保存：", invalid_phone: "电话号码无效。",
            weather_unknown: "下雨", processing: "Processing..."
        };

        var yue = {
            ready: "準備好", pick_language: "揀語言", tap_mic_once: "撳一下 🎙️",
            scan_label: "掃描包裹標籤", ask_route: "輸入目的地或者講附近地點",
            rain_popup_note: "如果目的地下雨，會自動彈出延誤通知",
            route_starting: "而家開始導航...", route_not_found: "搵唔到路線。",
            notify_arrival: "就快到，要通知客戶嗎？", eta_about: "預計大約 ",
            eta_minutes: " 分鐘內到", close: "關閉",
            rain_near_dest: "目的地附近落雨，要通知客戶延遲嗎？",
            detected_weather: "檢測到目的地天氣：", about_5_min: "仲有大約五分鐘到，要通知客戶嗎？",
            raining_prompt: "目的地附近正喺落雨，要通知客戶可能會遲少少嗎？",
            arrived: "已經到咗目的地。", route_notif: "前面大約 ", meters: " 米，",
            customer_phone_saved: "客戶電話已保存：", invalid_phone: "電話號碼無效。",
            weather_unknown: "落雨", processing: "Processing..."
        };

        var en = {
            ready: "Ready", pick_language: "Pick language", tap_mic_once: "Tap 🎙️ once",
            scan_label: "Scan parcel label", ask_route: "Ask for a route",
            rain_popup_note: "Rain delay popup appears automatically if destination is raining",
            route_starting: "Getting directions...", route_not_found: "Route not found.",
            notify_arrival: "Near destination. Notify customer?", eta_about: "Estimated arrival in about ",
            eta_minutes: " minutes", close: "Close",
            rain_near_dest: "Rain near destination. Send delay notice to customer?",
            detected_weather: "Detected destination weather: ", about_5_min: "About 5 minutes to arrival. Notify customer?",
            raining_prompt: "It is raining near the destination. Send a delay notice to the customer?",
            arrived: "You have arrived.", route_notif: "In ", meters: " meters, ",
            customer_phone_saved: "Customer phone saved: ", invalid_phone: "Invalid phone number.",
            weather_unknown: "rain", processing: "Processing..."
        };

        var map;
        if (ai === "Chinese Simplified" || ai === "Chinese Traditional") map = zh;
        else if (ai === "Cantonese") map = yue;
        else map = en;

        return map[key] || en[key] || key;
    }

    // ── Transport mode detection ───────────────────────────
    function detectTransportMode(speedMs) {
        if (speedMs === null || speedMs === undefined || speedMs < 0) return "unknown";
        if (speedMs < 1.4)  return "walking"; // < ~5 km/h
        if (speedMs < 9)    return "mrt";     // 5-32 km/h (MRT/bus between stops or slow traffic)
        return "driving";                      // > 32 km/h
    }

    var TRANSPORT_LABELS = {
        driving: "🚗 DRIVE",
        walking: "🚶 WALK",
        mrt:     "🚇 MRT/BUS",
        unknown: "🚗 --"
    };

    var TRANSPORT_CLASSES = {
        driving: "mode-badge mode-driving",
        walking: "mode-badge mode-walking",
        mrt:     "mode-badge mode-mrt",
        unknown: "mode-badge mode-unknown"
    };

    function updateTransportMode(speedMs) {
        var newMode = detectTransportMode(speedMs);
        if (newMode === transportMode) return;
        transportMode = newMode;

        // Auto-set routing mode
        if (transportMode === "walking" || transportMode === "mrt") {
            routingMode = "walking";
        } else if (transportMode === "driving") {
            routingMode = "driving";
        }

        modeBadge.className = TRANSPORT_CLASSES[transportMode] || TRANSPORT_CLASSES.unknown;
        modeBadge.textContent = TRANSPORT_LABELS[transportMode] || TRANSPORT_LABELS.unknown;
    }

    // ── Weather widget ─────────────────────────────────────
    var WEATHER_ICONS = {
        sunny: "☀️", clear: "☀️", cloud: "⛅", overcast: "☁️",
        rain: "🌧️", drizzle: "🌦️", shower: "🌧️", storm: "⛈️",
        thunder: "⛈️", fog: "🌫️", mist: "🌫️", haze: "🌫️"
    };

    function weatherIconFor(desc) {
        var d = String(desc || "").toLowerCase();
        for (var k in WEATHER_ICONS) {
            if (d.indexOf(k) >= 0) return WEATHER_ICONS[k];
        }
        return "🌤";
    }

    function updateWeatherWidget(data) {
        if (!data || data.status === "weather_unavailable") return;
        var desc = data.description || "";
        var temp = data.temp_c != null ? Math.round(data.temp_c) + "°C" : "--°C";
        wxIcon.textContent = weatherIconFor(desc);
        wxTemp.textContent = temp;
        wxDesc.textContent = desc || "--";
        wxBadge.style.display = "flex";
        wxBadge.className = "wx-badge" + (data.is_rain ? " rain" : "");
    }

    function maybeRefreshWeather() {
        if (!gpsPos) return;
        var now = Date.now();
        if (now - lastWeatherRefresh < WEATHER_REFRESH_MS) return;
        lastWeatherRefresh = now;
        apiWeather(gpsPos.lat, gpsPos.lng, function (err, data) {
            if (!err && data) updateWeatherWidget(data);
        });
    }

    // ── Leaflet map ────────────────────────────────────────
    function initLeafletMap() {
        if (leafletMap || !window.L) return;

        leafletMap = L.map("liveMap", {
            zoomControl: false,
            attributionControl: true
        });

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "© OSM"
        }).addTo(leafletMap);

        if (gpsPos) {
            leafletMap.setView([gpsPos.lat, gpsPos.lng], 16);
            addOrMoveDriverMarker(gpsPos.lat, gpsPos.lng);
        }

        mapZoomIn.addEventListener("click",  function () { leafletMap.zoomIn(); });
        mapZoomOut.addEventListener("click", function () { leafletMap.zoomOut(); });
        mapCenter.addEventListener("click",  function () {
            if (gpsPos) leafletMap.setView([gpsPos.lat, gpsPos.lng], 16);
        });
        mapClose.addEventListener("click",   function () { hideMap(); });
    }

    function driverIcon() {
        return L.divIcon({
            html: '<div style="width:14px;height:14px;border-radius:50%;background:#E31837;border:3px solid #fff;box-shadow:0 0 10px rgba(227,24,55,0.9)"></div>',
            iconSize: [14,14], iconAnchor: [7,7], className: ""
        });
    }

    function destIcon() {
        return L.divIcon({
            html: '<div style="font-size:22px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">📦</div>',
            iconSize: [22,22], iconAnchor: [11,22], className: ""
        });
    }

    function addOrMoveDriverMarker(lat, lng) {
        if (!leafletMap || !window.L) return;
        if (mapMarker) {
            mapMarker.setLatLng([lat, lng]);
        } else {
            mapMarker = L.marker([lat, lng], { icon: driverIcon() }).addTo(leafletMap);
        }
    }

    function drawRouteOnMap(route) {
        if (!leafletMap || !window.L) return;
        if (!route || !route.geometry || !route.geometry.coordinates) return;

        if (routeLayer) { leafletMap.removeLayer(routeLayer); routeLayer = null; }
        if (destMarker) { leafletMap.removeLayer(destMarker); destMarker = null; }

        var coords = route.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });

        routeLayer = L.polyline(coords, {
            color: "#E31837",
            weight: 4,
            opacity: 0.85
        }).addTo(leafletMap);

        if (route.dest_lat != null && route.dest_lng != null) {
            destMarker = L.marker([route.dest_lat, route.dest_lng], { icon: destIcon() }).addTo(leafletMap);
        }

        var bounds = routeLayer.getBounds();
        if (bounds.isValid()) {
            leafletMap.fitBounds(bounds, { padding: [30, 30] });
        }
    }

    function clearRouteFromMap() {
        if (!leafletMap) return;
        if (routeLayer)  { leafletMap.removeLayer(routeLayer);  routeLayer = null; }
        if (destMarker)  { leafletMap.removeLayer(destMarker);  destMarker = null; }
    }

    function showMap() {
        if (!mapVisible) {
            mapPanel.classList.remove("hidden");
            mapVisible = true;
            mapBtn.classList.add("on");
            if (!leafletMap && window.L) {
                setTimeout(initLeafletMap, 50);
            } else if (leafletMap) {
                setTimeout(function () { leafletMap.invalidateSize(); }, 100);
            }
        }
    }

    function hideMap() {
        mapPanel.classList.add("hidden");
        mapVisible = false;
        mapBtn.classList.remove("on");
    }

    function setMapModePill(mode) {
        if (!mpDriving || !mpWalking) return;
        if (mode === "walking") {
            mpDriving.classList.remove("active");
            mpWalking.classList.add("active");
        } else {
            mpWalking.classList.remove("active");
            mpDriving.classList.add("active");
        }
    }

    // ── Live Camera ────────────────────────────────────────
    // ── Live Nav-Cam ───────────────────────────────────────
    var pipMap = null; // Leaflet instance for PiP map

    function openLiveCam() {
        if (camActive) return;
        navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
        }).then(function (stream) {
            camStream = stream;
            camVideo.srcObject = stream;
            camOverlay.classList.add("active");
            camActive = true;
            // Force play on iOS/Android (autoplay policy requires explicit call)
            camVideo.play().catch(function () {});

            // Show AI reply area
            if (camAiReply) {
                camAiReply.textContent = "Tap 📸 to analyze what the camera sees...";
                camAiReply.classList.add("show");
            }

            // Init PiP map if GPS is available
            setTimeout(function () { initPipMap(); }, 300);

            // Refresh nav banner immediately
            updateCamNavBanner();

        }).catch(function (err) {
            addBubble("assistant", "📹 Camera access denied: " + err.message);
        });
    }

    function closeLiveCam() {
        camActive = false;
        if (camAutoOn) toggleCamAuto();
        if (camStream) {
            camStream.getTracks().forEach(function (t) { t.stop(); });
            camStream = null;
        }
        camVideo.srcObject = null;
        camOverlay.classList.remove("active");

        // Hide dynamic elements
        if (camNavBanner) camNavBanner.classList.remove("show");
        if (camMapPip)    camMapPip.classList.remove("show");
        if (camAiReply)   camAiReply.classList.remove("show");

        // Destroy PiP map so it reinits cleanly next time
        if (pipMap) { try { pipMap.remove(); } catch(e) {} pipMap = null; }
    }

    function initPipMap() {
        if (!window.L || !gpsPos) return;
        if (pipMap) { try { pipMap.remove(); } catch(e) {} pipMap = null; }

        // Clear the container div
        var pipContainer = document.getElementById("camPipMap");
        if (!pipContainer) return;
        pipContainer.innerHTML = "";

        pipMap = L.map("camPipMap", {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            touchZoom: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
        });

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19
        }).addTo(pipMap);

        pipMap.setView([gpsPos.lat, gpsPos.lng], 17);
        camMapPip.classList.add("show");

        // Add driver marker to PiP
        L.circleMarker([gpsPos.lat, gpsPos.lng], {
            radius: 6, color: "#E31837", fillColor: "#E31837",
            fillOpacity: 1, weight: 2
        }).addTo(pipMap);

        // Draw route on PiP if nav is active
        if (navActive && activeRoute && activeRoute.geometry && activeRoute.geometry.coordinates) {
            var coords = activeRoute.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
            L.polyline(coords, { color: "#E31837", weight: 3, opacity: 0.9 }).addTo(pipMap);
            if (activeRoute.dest_lat && activeRoute.dest_lng) {
                L.circleMarker([activeRoute.dest_lat, activeRoute.dest_lng], {
                    radius: 5, color: "#fff", fillColor: "#E31837",
                    fillOpacity: 1, weight: 2
                }).addTo(pipMap);
            }
        }

        setTimeout(function () { if (pipMap) pipMap.invalidateSize(); }, 100);
    }

    function updatePipMapPosition() {
        if (!pipMap || !gpsPos || !camActive) return;
        pipMap.setView([gpsPos.lat, gpsPos.lng], 17, { animate: true });
    }

    function updateCamNavBanner() {
        if (!camNavBanner || !camNavStep) return;
        if (!navActive || !activeRoute || !activeRoute.steps || activeStepIndex >= activeRoute.steps.length) {
            camNavBanner.classList.remove("show");
            return;
        }
        var step = activeRoute.steps[activeStepIndex];
        if (!step) return;

        camNavBanner.classList.add("show");
        camNavStep.textContent = tuneReplyByLanguage(step.text || "");

        // ETA line
        if (camNavEta) {
            var totalM = Math.round(activeRoute.total_distance || 0);
            var totalMin = Math.max(1, Math.round((activeRoute.total_duration || 0) / 60));
            var remaining = activeRoute.steps.length - activeStepIndex;
            camNavEta.textContent = "~" + totalMin + " min · " + totalM + "m · " + remaining + " steps left";
        }
    }

    function captureCamFrame(cb) {
        if (!camActive || !camVideo) { cb(null); return; }
        var canvas = document.createElement("canvas");
        canvas.width  = camVideo.videoWidth  || 640;
        canvas.height = camVideo.videoHeight || 480;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(camVideo, 0, 0, canvas.width, canvas.height);

        var q = 0.75;
        var b64 = canvas.toDataURL("image/jpeg", q);
        while (b64.length * 0.75 > MAX_BYTES && q > 0.2) {
            q -= 0.1;
            b64 = canvas.toDataURL("image/jpeg", q);
        }
        cb(b64.split(",")[1]);
    }

    function analyzeCamera() {
        if (!camActive) return;
        if (camStatus) camStatus.textContent = "🔍 Analyzing...";
        captureCamFrame(function (base64) {
            if (!base64) { if (camStatus) camStatus.textContent = "Camera not ready"; return; }
            apiScanCam(base64, getLiveCamPrompt(), function (err, reply) {
                if (err) {
                    if (camAiReply) camAiReply.textContent = "⚠️ " + err;
                    if (camStatus)  camStatus.textContent = "Analysis failed";
                    return;
                }

                var text = reply || "(No response)";
                if (camAiReply) {
                    camAiReply.textContent = text;
                    camAiReply.classList.add("show");
                }
                if (camStatus) camStatus.textContent = "📹 LIVE  " + new Date().toLocaleTimeString();

                // Speak the result
                if (reply && !busy) {
                    detectLang(reply);
                    speak(tuneReplyByLanguage(reply));
                }

                // Check if AI found a navigable ADDRESS in camera reply
                var addrMatch = text.match(/ADDRESS:\s*(.+)/i);
                if (addrMatch && addrMatch[1] && addrMatch[1].trim().toUpperCase() !== "UNKNOWN") {
                    var camAddr = addrMatch[1].trim();
                    scannedAddr = camAddr;
                    stopLiveNavigation();
                    addBubble("assistant", "📹 Camera found: " + camAddr);
                    fetchRoute(camAddr, true, function (routeErr, route) {
                        if (!routeErr && route && route.steps && route.steps.length) {
                            showRouteSteps(route);
                            startLiveNavigation(route);
                            // update PiP and nav banner
                            updateCamNavBanner();
                            setTimeout(function () { initPipMap(); }, 400);
                        }
                    });
                }
            });
        });
    }

    function toggleCamAuto() {
        camAutoOn = !camAutoOn;
        if (camAutoOn) {
            camAutoToggle.innerHTML = "🔄 AUTO<br>ON";
            camAutoToggle.classList.add("on");
            analyzeCamera();
            camAutoInterval = setInterval(analyzeCamera, 8000);
        } else {
            camAutoToggle.innerHTML = "🔄 AUTO<br>OFF";
            camAutoToggle.classList.remove("on");
            clearInterval(camAutoInterval);
            camAutoInterval = null;
        }
    }

    function apiScanCam(base64, prompt, cb) {
        fetch("/api/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system: getSysPrompt(),
                image_base64: base64,
                ocr_prompt: prompt
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) { cb(d.error ? String(d.error) : null, d.reply || ""); })
        .catch(function (e) { cb(e.message); });
    }

    // ── Cantonese normalisation ────────────────────────────
    function normalizeCantoneseText(text) {
        var t = String(text || "").trim();
        if (!t) return t;
        var replacements = [
            [/最近的/g,"最近嘅"],[/附近的/g,"附近嘅"],[/你的/g,"你嘅"],[/您的/g,"你嘅"],
            [/当前位置/g,"而家位置"],[/当前的位置/g,"而家位置"],[/现在/g,"而家"],
            [/位于/g,"喺"],[/这里/g,"呢度"],[/那边/g,"嗰邊"],[/在这里/g,"喺呢度"],
            [/在那边/g,"喺嗰邊"],[/在前面/g,"喺前面"],[/在附近/g,"喺附近"],[/在/g,"喺"],
            [/可以前往/g,"可以去"],[/请前往/g,"請去"],[/向前走/g,"向前行"],
            [/直走/g,"直行"],[/左转/g,"左轉"],[/右转/g,"右轉"],[/掉头/g,"調頭"],
            [/到达/g,"到咗"],[/到了/g,"到咗"],[/已到达/g,"已經到咗"],
            [/厕所/g,"洗手間"],[/卫生间/g,"洗手間"],[/没有/g,"冇"],
            [/无法/g,"冇辦法"],[/是否/g,"係咪"],[/正在/g,"而家正喺"]
        ];
        replacements.forEach(function (p) { t = t.replace(p[0], p[1]); });
        return t;
    }

    function tuneReplyByLanguage(text) {
        var t = String(text || "");
        if (isCantoneseMode()) return normalizeCantoneseText(t);
        return t;
    }

    // ── Phone helpers ──────────────────────────────────────
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

    function getCustomerPhoneForSms()      { return customerPhone.replace(/^\+/, ""); }
    function getCustomerPhoneForWhatsApp() { return customerPhone.replace(/^\+/, ""); }

    function getArrivalMessage()  { return "Hello, I will arrive in about 5 minutes. Please be ready to receive the parcel. Thank you."; }
    function getRainDelayMessage(){ return "Hello, due to rain and traffic conditions near your destination, your parcel may be slightly delayed. Thank you for your patience."; }

    function openSms(phone, message) {
        var p = String(phone || "");
        var body = encodeURIComponent(message || "");
        var url = isIOS ? "sms:" + p + "&body=" + body : "sms:" + p + "?body=" + body;
        window.location.href = url;
    }

    function openWhatsApp(phone, message) {
        var p = String(phone || "").replace(/[^\d]/g, "");
        var text = encodeURIComponent(message || "");
        window.open("https://wa.me/" + p + "?text=" + text, "_blank");
    }

    // ── Arrival / rain cards ───────────────────────────────
    // ── Auto-WhatsApp countdown ────────────────────────────
    var autoWaTimer = null;
    var autoWaCountdown = 0;

    function clearAutoWaTimer() {
        if (autoWaTimer) { clearInterval(autoWaTimer); autoWaTimer = null; }
    }

    function fireAutoWhatsApp(phone, msg) {
        var p = String(phone || "").replace(/[^\d]/g, "");
        var text = encodeURIComponent(msg || "");
        window.location.href = "whatsapp://send?phone=" + p + "&text=" + text;
        setTimeout(function () {
            try { window.open("https://wa.me/" + p + "?text=" + text, "_blank"); } catch(e) {}
        }, 1400);
    }

        function removeArrivalCard() { clearAutoWaTimer(); removeEl("arrivalNotifyCard"); }
    function removeRainCard()    { removeEl("rainDelayCard"); }

    function showArrivalNotifyCard() {
        removeArrivalCard();
        clearAutoWaTimer();

        var mins = activeRoute ? Math.max(1, Math.round((activeRoute.total_duration || 0) / 60)) : 5;
        var msg  = getArrivalMessage();
        var hasPhone = !!customerPhone;
        var AUTO_SECS = 5;
        autoWaCountdown = AUTO_SECS;

        var div = document.createElement("div");
        div.id = "arrivalNotifyCard";

        function renderCard(n) {
            var ringHtml = hasPhone
                ? '<div style="text-align:center;margin-bottom:10px;">' +
                      '<div style="display:inline-flex;align-items:center;justify-content:center;' +
                               'width:56px;height:56px;border-radius:50%;border:3px solid #25D366;' +
                               'background:rgba(37,211,102,0.12);font-size:22px;font-weight:900;color:#25D366;">' +
                          '<span id="waCountdownNum">' + n + '</span>' +
                      '</div>' +
                      '<div style="color:#25D366;font-size:10px;font-weight:700;margin-top:3px;letter-spacing:0.5px;">' +
                          '⚡ AUTO-SENDING WhatsApp' +
                      '</div>' +
                  '</div>'
                : "";

            div.innerHTML =
                '<div style="background:rgba(37,211,102,0.08);border:1.5px solid rgba(37,211,102,0.30);' +
                          'border-radius:14px;padding:12px;margin:8px 0;">' +
                    '<div style="color:#fff;font-size:13px;font-weight:700;margin-bottom:4px;">📍 ' +
                        esc(uiText("notify_arrival")) + '</div>' +
                    '<div style="color:rgba(255,255,255,0.55);font-size:11px;margin-bottom:8px;">' +
                        esc(uiText("eta_about") + mins + uiText("eta_minutes")) +
                        (hasPhone
                            ? ' · 📞 <span style="color:#fff;font-weight:700;">' + esc(customerPhone) + '</span>'
                            : ' · <span style="color:#ff6b6b;">No phone — scan label first</span>') +
                    '</div>' +
                    ringHtml +
                    '<div style="color:rgba(255,255,255,0.6);font-size:11px;margin-bottom:5px;">Message (English):</div>' +
                    '<div style="color:#fff;font-size:12px;line-height:1.5;background:rgba(255,255,255,0.05);' +
                              'border-radius:10px;padding:10px;margin-bottom:10px;">' + esc(msg) + '</div>' +
                    '<div style="display:flex;gap:6px;">' +
                        (hasPhone ? '<button id="arrivalWaNow" style="flex:2;padding:10px;border-radius:10px;border:none;' +
                                              'background:#25D366;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">✅ Send Now</button>' : '') +
                        (hasPhone ? '<button id="arrivalSmsBtn" style="flex:1;padding:10px;border-radius:10px;border:none;' +
                                              'background:rgba(255,255,255,0.08);color:#fff;font-size:11px;font-weight:700;cursor:pointer;">SMS</button>' : '') +
                        '<button id="arrivalCancelBtn" style="flex:1;padding:10px;border-radius:10px;border:none;' +
                                   'background:rgba(227,24,55,0.15);color:#ff6b6b;font-size:11px;font-weight:700;cursor:pointer;">✕ Cancel</button>' +
                    '</div>' +
                '</div>';
        }

        renderCard(autoWaCountdown);
        chatEl.appendChild(div);
        scrollDown();

        function bindButtons() {
            var waNow    = document.getElementById("arrivalWaNow");
            var smsBtn   = document.getElementById("arrivalSmsBtn");
            var cancelBtn= document.getElementById("arrivalCancelBtn");

            if (waNow) waNow.addEventListener("click", function () {
                clearAutoWaTimer();
                fireAutoWhatsApp(getCustomerPhoneForWhatsApp(), msg);
                removeArrivalCard();
                addBubble("assistant", "✅ WhatsApp opening for customer.");
            });
            if (smsBtn) smsBtn.addEventListener("click", function () {
                clearAutoWaTimer();
                openSms(getCustomerPhoneForSms(), msg);
                removeArrivalCard();
            });
            if (cancelBtn) cancelBtn.addEventListener("click", function () {
                clearAutoWaTimer();
                removeArrivalCard();
                addBubble("assistant", "WhatsApp cancelled by driver.");
            });
        }

        bindButtons();

        // Countdown auto-fires if driver doesn't cancel
        if (hasPhone) {
            autoWaTimer = setInterval(function () {
                autoWaCountdown--;
                var numEl = document.getElementById("waCountdownNum");
                if (numEl) numEl.textContent = Math.max(0, autoWaCountdown);

                if (autoWaCountdown <= 0) {
                    clearAutoWaTimer();
                    var cardExists = document.getElementById("arrivalNotifyCard");
                    if (cardExists) {
                        removeArrivalCard();
                        fireAutoWhatsApp(getCustomerPhoneForWhatsApp(), msg);
                        addBubble("assistant", "✅ WhatsApp auto-sent to customer.");
                        speak("WhatsApp sent to customer.");
                    }
                }
            }, 1000);
        }
    }

    function showRainDelayCard(weatherInfo) {
        removeRainCard();
        var msg = getRainDelayMessage();
        var title = uiText("rain_near_dest");
        var detail = uiText("detected_weather") + (weatherInfo && weatherInfo.description ? weatherInfo.description : uiText("weather_unknown"));
        var hasPhone = !!customerPhone;

        var div = document.createElement("div");
        div.id = "rainDelayCard";
        div.innerHTML =
            '<div style="background:rgba(30,144,255,0.10);border:1px solid rgba(30,144,255,0.30);border-radius:14px;padding:12px;margin:8px 0;">' +
                '<div style="color:#fff;font-size:13px;font-weight:700;margin-bottom:6px;">' + esc(title) + '</div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:6px;">' + esc(detail) + '</div>' +
                '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-bottom:6px;">Customer Phone: <span style="color:#fff;font-weight:700;">' + esc(customerPhone || "Not detected") + '</span></div>' +
                '<div style="color:#fff;font-size:12px;line-height:1.5;background:rgba(255,255,255,0.05);border-radius:10px;padding:10px;margin-bottom:10px;">' + esc(msg) + '</div>' +
                '<div style="display:flex;gap:8px;">' +
                    (hasPhone ? '<button id="rainSmsBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:#E31837;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">SMS</button>' : '') +
                    (hasPhone ? '<button id="rainWaBtn"  style="flex:1;padding:10px;border-radius:10px;border:none;background:#25D366;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">WhatsApp</button>' : '') +
                    '<button id="rainCloseBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:rgba(255,255,255,0.12);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">' + esc(uiText("close")) + '</button>' +
                '</div>' +
            '</div>';
        chatEl.appendChild(div);
        scrollDown();

        if (hasPhone) {
            document.getElementById("rainSmsBtn").addEventListener("click", function () { openSms(getCustomerPhoneForSms(), msg); });
            document.getElementById("rainWaBtn").addEventListener("click",  function () { openWhatsApp(getCustomerPhoneForWhatsApp(), msg); });
        }
        document.getElementById("rainCloseBtn").addEventListener("click", removeRainCard);
    }

    // ── Speech ─────────────────────────────────────────────
    function unlockSpeech() {
        if (!window.speechSynthesis || speechUnlocked) return;
        try {
            var u = new SpeechSynthesisUtterance(" ");
            u.volume = 0;
            u.onend = u.onerror = function () { speechUnlocked = true; };
            window.speechSynthesis.speak(u);
            window.speechSynthesis.cancel();
            speechUnlocked = true;
        } catch(e) {}
    }

    function pickVoiceByTargets(targets) {
        if (!window.speechSynthesis) return null;
        var voices = window.speechSynthesis.getVoices() || [];
        if (!voices.length) return null;
        return voices.find(function (v) { return targets.some(function (t) { return (v.lang||"").toLowerCase() === t.toLowerCase(); }); })
            || voices.find(function (v) { return targets.some(function (t) { return (v.lang||"").toLowerCase().indexOf(t.toLowerCase()) === 0; }); })
            || null;
    }

    function pickCantoneseVoice() {
        if (!window.speechSynthesis) return null;
        var voices = window.speechSynthesis.getVoices() || [];
        return voices.find(function (v) { return /yue|cantonese|hong kong|zh-hk/.test(((v.name||"")+" "+(v.lang||"")).toLowerCase()); }) || null;
    }

    function stripEmojis(t) {
        return String(t||"").replace(/[\u{1F000}-\u{1FFFF}]/gu,"").replace(/[\u{2600}-\u{27BF}]/gu,"")
            .replace(/[\u{FE00}-\u{FEFF}]/gu,"").replace(/[\u{1F900}-\u{1FAFF}]/gu,"")
            .replace(/[*_#\[\]]/g,"").replace(/\s+/g," ").trim();
    }

    function detectLang(text) {
        var t = String(text || "");
        var code = currentLang().code;
        var codeToLang = { "zh-HK":"zh-HK","zh-TW":"zh-TW","zh-CN":"zh-CN","ms-MY":"ms","ta-IN":"ta","th-TH":"th","vi-VN":"vi","id-ID":"id","ko-KR":"ko","ja-JP":"ja" };
        if (codeToLang[code]) { lastDetectedLang = codeToLang[code]; return; }

        if (/[\u0e00-\u0e7f]/.test(t)) { lastDetectedLang = "th"; return; }
        if (/[\uac00-\ud7af]/.test(t)) { lastDetectedLang = "ko"; return; }
        if (/[\u3040-\u30ff]/.test(t)) { lastDetectedLang = "ja"; return; }
        if (/[佢哋佢而家咗喺咩唔冇啦啲咁樣嗰呢度邊度搵返嚟]/.test(t)) { lastDetectedLang = "zh-HK"; return; }
        if (/[這個那個現在時間還有讓會話點樣處理聯絡顯示導航這裡附近樓層單位]/.test(t)) { lastDetectedLang = "zh-TW"; return; }
        if (/[这个那个现在时间还有让会话怎么处理联系显示导航这里附近楼层单位]/.test(t)) { lastDetectedLang = "zh-CN"; return; }
        if (/[\u4e00-\u9fff]/.test(t)) { lastDetectedLang = "zh-CN"; return; }
        if (/\b(anda|saya|tak|boleh|dengan|untuk|lah|bro)\b/i.test(t)) { lastDetectedLang = "ms"; return; }
        if (/\b(kamu|tidak|bisa|dengan|untuk|ya)\b/i.test(t)) { lastDetectedLang = "id"; return; }
        if (/\b(bạn|tôi|không|được|của|và|cho)\b/i.test(t)) { lastDetectedLang = "vi"; return; }
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
            else u.lang = currentLang().code;

            u.onstart = function () { isSpeaking = true; sbEl.style.display = "flex"; };
            u.onend = u.onerror = function () {
                isSpeaking = false; sbEl.style.display = "none";
                clearInterval(ttsTimer); if (onDone) onDone();
            };

            window.speechSynthesis.speak(u);
            try { window.speechSynthesis.resume(); } catch(e) {}
            ttsTimer = setInterval(function () { try { window.speechSynthesis.resume(); } catch(e) {} }, 2000);
        } catch(e) {
            isSpeaking = false; sbEl.style.display = "none";
            clearInterval(ttsTimer); if (onDone) onDone();
        }
    }

    function stopSpeak() {
        if (window.speechSynthesis) try { window.speechSynthesis.cancel(); } catch(e) {}
        isSpeaking = false; sbEl.style.display = "none"; clearInterval(ttsTimer);
    }

    if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = function () { try { window.speechSynthesis.getVoices(); } catch(e) {} };
    }

    // ── Language bar ───────────────────────────────────────
    function renderLangBar() {
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
                micLabel.textContent = "MIC • " + lang.flag + " " + lang.ai;
                addBubble("assistant", "🌐 " + lang.flag + " " + lang.ai);
            });
            langBar.appendChild(btn);
        });
    }

    // ── Image compression ──────────────────────────────────
    function compressImage(file, cb) {
        var reader = new FileReader();
        reader.onload = function (e) {
            var img = new Image();
            img.onload = function () {
                var w = img.width, h = img.height;
                if (w > MAX_DIM || h > MAX_DIM) {
                    var r = Math.min(MAX_DIM/w, MAX_DIM/h);
                    w = Math.round(w*r); h = Math.round(h*r);
                }
                var c = document.createElement("canvas");
                c.width = w; c.height = h;
                c.getContext("2d").drawImage(img, 0, 0, w, h);
                var q = 0.8, b64 = c.toDataURL("image/jpeg", q);
                while (b64.length*0.75 > MAX_BYTES && q > 0.2) { q -= 0.1; b64 = c.toDataURL("image/jpeg", q); }
                cb(null, { base64: b64.split(",")[1], preview: b64, w: w, h: h, kb: Math.round((b64.length*3)/4/1024) });
            };
            img.onerror = function () { cb("Failed"); };
            img.src = e.target.result;
        };
        reader.onerror = function () { cb("Failed"); };
        reader.readAsDataURL(file);
    }

    // ── API calls ──────────────────────────────────────────
    function apiChat(text, cb) {
        fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ system: getSysPrompt(), messages: [{ role: "user", content: text }] })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) { cb(d.error ? String(d.error) : null, d.reply || ""); })
        .catch(function (e) { cb(e.message); });
    }

    function apiScan(base64, cb) {
        fetch("/api/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ system: getSysPrompt(), image_base64: base64, ocr_prompt: getOcrPrompt() })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) { cb(d.error ? String(d.error) : null, d.reply || ""); })
        .catch(function (e) { cb(e.message); });
    }

    function apiTranscribe(audioBase64, cb) {
        fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio_base64: audioBase64, language: currentLang().code })
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

    // ── Mic / Voice ────────────────────────────────────────
    function toggleMic() {
        unlockSpeech();
        if (micActive) { stopMic(); return; }
        micActive = true;
        syncReplyLanguageToSelection();
        voiceBtn.classList.add("active");
        voiceBtn.querySelector("span:last-child").textContent = "MIC ON";
        micBar.classList.add("on");
        micLabel.textContent = "MIC • " + currentLang().flag + " " + currentLang().ai;
        if (useRecorder) startRecording();
        else startSR();
    }

    function stopMic() {
        micActive = false; isListening = false;
        voiceBtn.classList.remove("active");
        voiceBtn.querySelector("span:last-child").textContent = "TAP TO SPEAK";
        micBar.classList.remove("on");
        clearTimeout(recordTimer);
        if (recognition) try { recognition.stop(); } catch(e) {}
        if (mediaRecorder && mediaRecorder.state !== "inactive") try { mediaRecorder.stop(); } catch(e) {}
    }

    function startSR() {
        if (!micActive || isListening || isSpeaking || busy) return;
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { useRecorder = true; startRecording(); return; }

        recognition = new SR();
        recognition.continuous = true;
        recognition.interimResults = false;
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
        try { recognition.start(); isListening = true; }
        catch(e) { setTimeout(function () { if (micActive) startSR(); }, 500); }
    }

    function stopListeningSR() {
        if (recognition) try { recognition.stop(); } catch(e) {}
        isListening = false;
    }

    function startRecording() {
        if (!micActive || isListening || isSpeaking || busy) return;
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            audioChunks = [];
            var options = { mimeType: "audio/webm" };
            try { mediaRecorder = new MediaRecorder(stream, options); }
            catch(e) { mediaRecorder = new MediaRecorder(stream); }

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
                    isListening = false;
                    showProc();
                    apiTranscribe(base64, function (err, text) {
                        hideProc();
                        if (err || !String(text||"").trim()) {
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
                if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
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
            if (useRecorder) startRecording(); else startSR();
        }, 500);
    }

    // ── GPS ────────────────────────────────────────────────
    // Throttle reverse geocode — only re-geocode if moved >15m or 20s passed
    var lastGeocodeAt = 0, lastGeocodeLat = 0, lastGeocodeLng = 0;

    function initGPS() {
        if (!navigator.geolocation) { locAddr.textContent = "GPS not available"; return; }

        navigator.geolocation.watchPosition(
            function (p) {
                var acc = p.coords.accuracy || 999;
                gpsPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: acc };
                locBar.classList.remove("no-gps");

                // Show accuracy pill immediately on every GPS update
                updateAccuracyDisplay(acc, p.coords.latitude, p.coords.longitude);

                // Only re-geocode if moved >15m or >20s since last geocode
                var now = Date.now();
                var moved = metersBetween(p.coords.latitude, p.coords.longitude, lastGeocodeLat, lastGeocodeLng);
                if (moved > 15 || now - lastGeocodeAt > 20000) {
                    lastGeocodeAt = now;
                    lastGeocodeLat = p.coords.latitude;
                    lastGeocodeLng = p.coords.longitude;
                    reverseGeocode(p.coords.latitude, p.coords.longitude);
                }

                updateLiveNavigation();
                updateTransportMode(p.coords.speed);

                if (leafletMap) addOrMoveDriverMarker(gpsPos.lat, gpsPos.lng);
                maybeRefreshWeather();
            },
            function (err) {
                locBar.classList.add("no-gps");
                locAddr.textContent = "GPS searching...";
            },
            { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
        );
    }

    function updateAccuracyDisplay(acc, lat, lng) {
        var accEl   = document.getElementById("locAcc");
        var pillEl  = document.getElementById("locAccPill");
        var coordEl = document.getElementById("locCoords");

        if (!accEl) return;
        accEl.style.display = "flex";

        var accRound = Math.round(acc);
        if (pillEl) {
            pillEl.textContent = "±" + accRound + "m";
            pillEl.className = "loc-acc-pill";
            if (accRound <= 20)       pillEl.classList.add("acc-good");
            else if (accRound <= 60)  pillEl.classList.add("acc-ok");
            else                       pillEl.classList.add("acc-poor");
        }

        if (coordEl && lat != null && lng != null) {
            coordEl.textContent = lat.toFixed(5) + ", " + lng.toFixed(5);
        }
    }

    function reverseGeocode(lat, lng) {
        fetch("/api/geocode?lat=" + lat + "&lng=" + lng)
        .then(function (r) { return r.json(); })
        .then(function (d) {
            currentStreet = d.address || "";
            locAddr.textContent = currentStreet || lat.toFixed(5) + "," + lng.toFixed(5);

            // Show geocoder source badge
            var srcEl = document.getElementById("locSource");
            if (srcEl) {
                if (d.source === "onemap") {
                    srcEl.textContent = "● ONEMAP SG";
                    srcEl.style.color = "rgba(76,175,80,0.7)";
                } else if (d.source === "nominatim") {
                    srcEl.textContent = "● OSM";
                    srcEl.style.color = "rgba(255,193,7,0.6)";
                } else {
                    srcEl.textContent = "";
                }
            }
        })
        .catch(function () {});
    }

    // ── Routing ────────────────────────────────────────────
    // ── Smart Singapore address cleanup / fallback ─────────
function cleanDeliveryAddress(rawText) {
    if (!rawText) return "";

    var text = String(rawText);

    // remove phone numbers
    text = text.replace(/\b(?:\+?65[-\s]?)?\d{8}\b/g, " ");

    // remove unit patterns like #14, #03-122, #12-345
    text = text.replace(/#\s*\d{1,3}(?:-\d{1,4})?/gi, " ");

    // remove common words that confuse routing
    text = text.replace(/\b(unit|floor|level|lvl|recipient|name|attn|attention)\b/gi, " ");

    // normalize punctuation / spaces
    text = text.replace(/[\n\r,;]+/g, " ");
    text = text.replace(/\s+/g, " ").trim();

    return text;
}

function extractSingaporeAddressParts(rawText) {
    var text = cleanDeliveryAddress(rawText || "");
    var result = {
        postal: "",
        blockStreet: "",
        cleaned: "",
        unit: ""
    };

    // capture postal code
    var postalMatch = text.match(/\b\d{6}\b/);
    if (postalMatch) result.postal = postalMatch[0];

    // capture block + street
    var blockStreetMatch = text.match(
        /\b\d{1,4}\s+[A-Za-z0-9 ]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Crescent|Close|Lane|Lorong|Jalan|East|West|North|South)\b(?:\s*\d{1,3})?/i
    );
    if (blockStreetMatch) {
        result.blockStreet = blockStreetMatch[0].replace(/\s+/g, " ").trim();
    }

    result.cleaned = result.blockStreet;
    if (result.postal) {
        result.cleaned += (result.cleaned ? ", Singapore " : "Singapore ") + result.postal;
    }

    result.cleaned = result.cleaned.trim();
    return result;
}

function scoreAddressCandidate(item, targetPostal, targetBlockStreet) {
    var score = 0;
    var display = String(
        item.display || item.address || item.ROAD_NAME || item.road || ""
    ).toLowerCase();

    var postal = String(
        item.POSTAL || item.postal || ""
    ).trim();

    var blk = String(item.BLK_NO || item.blk_no || "").trim();
    var road = String(item.ROAD_NAME || item.road_name || item.road || "").trim();
    var composed = (blk + " " + road).toLowerCase().trim();

    if (targetPostal && postal === targetPostal) score += 100;
    if (targetBlockStreet && composed.indexOf(targetBlockStreet.toLowerCase()) >= 0) score += 70;
    if (targetBlockStreet && display.indexOf(targetBlockStreet.toLowerCase()) >= 0) score += 50;

    return score;
}

function chooseBestGeocodeCandidate(results, targetPostal, targetBlockStreet) {
    if (!results || !results.length) return null;

    var scored = results.map(function (item) {
        return {
            item: item,
            score: scoreAddressCandidate(item, targetPostal, targetBlockStreet)
        };
    });

    scored.sort(function (a, b) { return b.score - a.score; });
    return scored[0].item;
}

function geocodeAddressCandidates(query, cb) {
    fetch("/api/address-to-latlng?address=" + encodeURIComponent(query))
    .then(function (r) { return r.json(); })
    .then(function (g) {
        cb(null, g);
    })
    .catch(function (e) {
        cb(e.message);
    });
}

function resolveBestDestination(rawAddr, cb) {
    var parsed = extractSingaporeAddressParts(rawAddr || "");
    var tries = [];

    // best priority: postal
    if (parsed.postal) tries.push(parsed.postal);

    // second: cleaned full block + street + postal
    if (parsed.cleaned && tries.indexOf(parsed.cleaned) < 0) tries.push(parsed.cleaned);

    // third: block + street only
    if (parsed.blockStreet && tries.indexOf(parsed.blockStreet) < 0) tries.push(parsed.blockStreet);

    // last: raw cleaned text
    var rawClean = cleanDeliveryAddress(rawAddr || "");
    if (rawClean && tries.indexOf(rawClean) < 0) tries.push(rawClean);

    function nextTry(i) {
        if (i >= tries.length) {
            cb("Address not found");
            return;
        }

        geocodeAddressCandidates(tries[i], function (err, g) {
            if (err || !g) {
                nextTry(i + 1);
                return;
            }

            // single best result returned by backend
            if (g.lat && g.lng) {
                cb(null, {
                    lat: g.lat,
                    lng: g.lng,
                    display: g.display || tries[i],
                    query_used: tries[i],
                    cleaned_input: parsed.cleaned || rawClean
                });
                return;
            }

            // if backend ever returns multiple candidates
            if (g.results && g.results.length) {
                var best = chooseBestGeocodeCandidate(g.results, parsed.postal, parsed.blockStreet);
                if (best) {
                    cb(null, {
                        lat: Number(best.lat || best.LATITUDE),
                        lng: Number(best.lng || best.LONGITUDE),
                        display: best.display || best.ADDRESS || tries[i],
                        query_used: tries[i],
                        cleaned_input: parsed.cleaned || rawClean
                    });
                    return;
                }
            }

            nextTry(i + 1);
        });
    }

    nextTry(0);
}
    function fetchRoute(destAddr, cb) {
    if (!gpsPos) { cb("No GPS"); return; }

    resolveBestDestination(destAddr, function (geoErr, g) {
        if (geoErr || !g || g.lat == null || g.lng == null) {
            cb("Address not found");
            return;
        }

        var mode = routingMode;

        fetch("/api/route?from_lat=" + encodeURIComponent(gpsPos.lat) +
              "&from_lng=" + encodeURIComponent(gpsPos.lng) +
              "&to_lat=" + encodeURIComponent(g.lat) +
              "&to_lng=" + encodeURIComponent(g.lng) +
              "&mode=" + encodeURIComponent(mode))
        .then(function (r) { return r.json(); })
        .then(function (rt) {
            if (rt && !rt.error) {
                rt.dest_lat = g.lat;
                rt.dest_lng = g.lng;
                rt.dest_display = g.display || destAddr;
                rt.cleaned_input = g.cleaned_input || destAddr;
                rt.query_used = g.query_used || destAddr;
            }

            if (rt && rt.steps && rt.steps.length) {
                cb(null, rt);
            } else {
                cb((rt && rt.error) || "Route not found", rt);
            }
        })
        .catch(function (e) { cb(e.message); });
    });
}

    function metersBetween(lat1, lng1, lat2, lng2) {
        var R = 6371000, toRad = function (d) { return d * Math.PI / 180; };
        var dLat = toRad(lat2-lat1), dLng = toRad(lng2-lng1);
        var a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)*Math.sin(dLng/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    // ── Live Navigation ────────────────────────────────────
    function startLiveNavigation(route) {
        if (!route || !route.steps || !route.steps.length) return;
        activeRoute = route; activeStepIndex = 0; lastSpokenStep = -1; navActive = true;
        notifyShownForRoute = false; arrivalPromptSpoken = false;
        rainAlertShownForRoute = false; currentWeatherInfo = null;
        removeArrivalCard(); removeRainCard();
        highlightActiveStep();

var totalM = Math.round(route.total_distance || 0);
var totalMin = Math.max(1, Math.round((route.total_duration || 0) / 60));

if (routingMode === "walking") {
    detectLang("Walking route loaded. About " + totalMin + " minutes.");
    speak("Walking route loaded. About " + totalMin + " minutes, " + totalM + " meters.");
} else {
    detectLang("Driving route loaded. About " + totalMin + " minutes.");
    speak("Driving route loaded. About " + totalMin + " minutes.");
}

setTimeout(function () {
    speakCurrentStepIfNeeded(true);
}, 400);

        // Show map automatically when nav starts
        showMap();
        if (leafletMap) {
            setTimeout(function () {
                drawRouteOnMap(route);
                leafletMap.invalidateSize();
            }, 200);
        }

        if (route.dest_lat != null && route.dest_lng != null) {
            apiWeather(route.dest_lat, route.dest_lng, function (err, weatherData) {
                if (!err && weatherData) currentWeatherInfo = weatherData;
            });
        }
    }

    function highlightActiveStep() {
        if (!activeRoute || !activeRoute.steps) return;
        activeRoute.steps.forEach(function (_, i) {
            var el = document.getElementById("rs" + i);
            if (el) el.style.background = i === activeStepIndex ? "rgba(227,24,55,0.18)" : "transparent";
        });
        var activeEl = document.getElementById("rs" + activeStepIndex);
        if (activeEl) activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function speakCurrentStepIfNeeded(force) {
    if (!navActive || !activeRoute || !activeRoute.steps) return;
    if (activeStepIndex >= activeRoute.steps.length) return;
    if (!force && lastSpokenStep === activeStepIndex) return;

    var step = activeRoute.steps[activeStepIndex];
    if (!step) return;

    var fixedText = formatStepTextForMode(step, routingMode);
    if (!fixedText) return;

    lastSpokenStep = activeStepIndex;
    detectLang(fixedText);
    speak(tuneReplyByLanguage(fixedText));
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

        if (dist <= 80 && lastSpokenStep !== activeStepIndex) {
            var fixedText = formatStepTextForMode(step, routingMode);
            var warnText = uiText("route_notif") + Math.round(dist) + uiText("meters") + tuneReplyByLanguage(fixedText);
            detectLang(warnText); speak(warnText);
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
                var remainSecs = 0, remainMeters = 0;
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
                setTimeout(function () { speakCurrentStepIfNeeded(true); }, 500);
            } else {
                navActive = false;
                clearRouteFromMap();
                detectLang(uiText("arrived"));
                speak(uiText("arrived"));
            }
        }
    }

    function stopLiveNavigation() {
        navActive = false; activeRoute = null; activeStepIndex = 0; lastSpokenStep = -1;
        notifyShownForRoute = false; arrivalPromptSpoken = false;
        rainAlertShownForRoute = false; currentWeatherInfo = null;
        removeArrivalCard(); removeRainCard();
        clearRouteFromMap();
    }

    // ── Route card ─────────────────────────────────────────
    function formatStepTextForMode(step, mode) {
    if (!step) return "";

    var text = String(step.text || "").trim();
    var distance = Math.round(step.distance || 0);

    // Force correct first-step wording for depart instruction
    if (step.type === "depart") {
        if (mode === "walking") {
            return "Start walking for " + distance + "m";
        }
        return "Start driving for " + distance + "m";
    }

    // Safety replacements in case backend sends drive wording during walk mode
    if (mode === "walking") {
        text = text
            .replace(/^Start driving\b/i, "Start walking")
            .replace(/\bdrive\b/gi, "walk")
            .replace(/\bdriving\b/gi, "walking");
    } else {
        text = text
            .replace(/^Start walking\b/i, "Start driving")
            .replace(/\bwalk\b/gi, "drive")
            .replace(/\bwalking\b/gi, "driving");
    }

    return text;
}
    function showRouteSteps(route) {
    removeEl("routeCard");
    if (!route || !route.steps || !route.steps.length) return;

    var modeLabel = routingMode === "walking" ? "🚶 Walk" : "🚗 Drive";

    var div = document.createElement("div");
    div.id = "routeCard";

    var html = '<div style="background:rgba(76,175,80,0.1);border:1px solid rgba(76,175,80,0.2);border-radius:12px;padding:12px;margin:8px 0">';
    var totalM = Math.round(route.total_distance || 0);
    var totalMin = Math.max(1, Math.round((route.total_duration || 0) / 60));

    html += '<div style="color:#4CAF50;font-size:10px;font-weight:600;letter-spacing:1px;margin-bottom:6px">🛣 '
         + esc(route.summary || "")
         + ' ' + modeLabel
         + ' • ' + totalM + 'm'
         + ' • ' + totalMin + ' min'
         + '</div>';

    route.steps.forEach(function (s, i) {
        var fixedText = formatStepTextForMode(s, routingMode);

        html += '<div id="rs' + i + '" style="display:flex;gap:8px;padding:6px;border-radius:8px;margin-bottom:2px;">';
        html += '<span style="font-size:16px;width:22px;text-align:center;flex-shrink:0">' + getIcon(s.type, s.modifier) + '</span>';
        html += '<div style="color:#fff;font-size:12px">' + esc(tuneReplyByLanguage(fixedText)) + '</div></div>';
    });

    html += '<div style="display:flex;gap:6px;margin-top:8px">';
    html += '<button id="rSpk" style="flex:1;padding:10px;border-radius:8px;border:none;background:#E31837;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">🔊 Repeat Step</button>';
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

    // ── Delivery card ──────────────────────────────────────
    function showDeliveryCard(parsed) {
        removeEl("deliveryCard");
        var fullAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
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
        if (parsed.phone)     html += '<div style="color:rgba(255,255,255,0.6);font-size:12px;padding:4px 0">📞 ' + esc(parsed.phone) + '</div>';

        div.innerHTML = html;
        chatEl.appendChild(div);
        scrollDown();
    }

    // ── Helpers ────────────────────────────────────────────
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
        el.textContent = uiText("processing");
        chatEl.appendChild(el); scrollDown();
    }

    function hideProc() { removeEl("proc"); }
    function updateSend() { sendBtn.classList.toggle("on", !!inp.value.trim()); }

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
        if (m && m[1]) return m[1];
        return null;
    }

    // ── Send text ──────────────────────────────────────────
    function sendText(text) {
        if (!text || !text.trim() || busy) return;
        syncReplyLanguageToSelection();
        var rawText = text.trim();

        var phoneMatch = rawText.match(/set customer phone\s+([+\d\s-]+)/i);
        if (phoneMatch && phoneMatch[1]) {
            if (setCustomerPhone(phoneMatch[1])) {
                addBubble("user", rawText);
                addBubble("assistant", uiText("customer_phone_saved") + customerPhone);
            } else {
                addBubble("assistant", uiText("invalid_phone"));
            }
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
                setTimeout(function () { speak("Error. " + err, restartMicAfterReply); }, 150);
                return;
            }

            reply = tuneReplyByLanguage(reply);
            detectLang(reply);
            addBubble("assistant", reply);

            var addrMatch = reply.match(/ADDRESS:\s*(.+)/i);
            if (addrMatch && addrMatch[1]) {
                var navAddr = cleanDeliveryAddress(addrMatch[1].trim());
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

    // ── Scan ───────────────────────────────────────────────
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
                hideProc(); busy = false; fileInput.value = "";
                if (err2) { addBubble("assistant", "Error: " + err2); speak("Scan error.", restartMicAfterReply); return; }

                var parsed = null;
                try { parsed = JSON.parse(reply.replace(/```json|```/g, "").trim()); } catch(e) {}

                if (parsed && parsed.phone) setCustomerPhone(parsed.phone);

                if (parsed && parsed.address) {
                    var navAddr = parsed.address + (parsed.postal ? " " + parsed.postal : "");
                    scannedAddr = navAddr;
                    stopLiveNavigation();
                    showDeliveryCard(parsed);

                    var voice = parsed.unit ? "Unit " + parsed.unit + ". " + parsed.address : parsed.address;
                    voice = tuneReplyByLanguage(voice);
                    detectLang(voice);

                    setTimeout(function () {
                        speak(voice, function () {
                            addBubble("assistant", uiText("route_starting"));
                            fetchRoute(navAddr, function (re, route) {
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
                    reply = tuneReplyByLanguage(reply);
                    detectLang(reply);
                    addBubble("assistant", reply);
                    setTimeout(function () { speak(reply, restartMicAfterReply); }, 150);
                }
            });
        });
    }

    // ── Init ───────────────────────────────────────────────
    renderLangBar();
    syncReplyLanguageToSelection();

    CHIPS.forEach(function (c) {
        var btn = document.createElement("button");
        btn.className = "chip"; btn.textContent = c;
        btn.addEventListener("click", function () { unlockSpeech(); sendText(c); });
        chipsEl.appendChild(btn);
    });

    // Button events
    sendBtn.addEventListener("click",  function () { unlockSpeech(); sendText(inp.value); });
    inp.addEventListener("input", updateSend);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { unlockSpeech(); sendText(inp.value); } });
    voiceBtn.addEventListener("click", function () { unlockSpeech(); toggleMic(); });
    scanBtn.addEventListener("click",  function () { unlockSpeech(); cameraIn.click(); });
    photoBtn.addEventListener("click", function () { unlockSpeech(); photoIn.click(); });
    cameraIn.addEventListener("change", function () { handleScan(cameraIn); });
    photoIn.addEventListener("change",  function () { handleScan(photoIn); });

    // MAP button
    mapBtn.addEventListener("click", function () {
        unlockSpeech();
        if (mapVisible) { hideMap(); }
        else {
            showMap();
            setTimeout(initLeafletMap, 80);
        }
    });

    // Map routing mode pills
    if (mpDriving) {
    mpDriving.addEventListener("click", function () {
        routingMode = "driving";
        setMapModePill("driving");

        if (scannedAddr) {
            stopLiveNavigation();
            addBubble("assistant", "🚗 Switching to driving route...");
            fetchRoute(scannedAddr, function (e, r) {
                if (!e && r && r.steps && r.steps.length) {
                    showRouteSteps(r);
                    startLiveNavigation(r);
                } else {
                    addBubble("assistant", uiText("route_not_found"));
                }
            });
        }
    });
}
    if (mpWalking) {
    mpWalking.addEventListener("click", function () {
        routingMode = "walking";
        setMapModePill("walking");

        if (scannedAddr) {
            stopLiveNavigation();
            addBubble("assistant", "🚶 Switching to walking route...");
            fetchRoute(scannedAddr, function (e, r) {
                if (!e && r && r.steps && r.steps.length) {
                    showRouteSteps(r);
                    startLiveNavigation(r);
                } else {
                    addBubble("assistant", uiText("route_not_found"));
                }
            });
        }
    });
}

    // Live cam button
    liveCamBtn.addEventListener("click", function () {
        unlockSpeech();
        openLiveCam();
    });
    camSnap.addEventListener("click",       analyzeCamera);
    if (camExitBtn) camExitBtn.addEventListener("click", closeLiveCam);
    camAutoToggle.addEventListener("click", toggleCamAuto);

    // Nav button (legacy)
    if (navBtnEl) {
        navBtnEl.addEventListener("click", function () {
            unlockSpeech();
            if (scannedAddr) {
                stopLiveNavigation();
                fetchRoute(scannedAddr, function (e, r) {
                    if (!e && r && r.steps.length) { showRouteSteps(r); startLiveNavigation(r); }
                    else addBubble("assistant", uiText("route_not_found"));
                });
            }
        });
    }

    if (stopBtnEl) stopBtnEl.addEventListener("click", stopSpeak);

    initGPS();

    var mode = useRecorder ? "(recording mode)" : "(voice mode)";
    addBubble("assistant",
        uiText("ready") + " " + mode + ".\n" +
        "1️⃣ " + uiText("pick_language") + "\n" +
        "2️⃣ " + uiText("tap_mic_once") + "\n" +
        "3️⃣ " + uiText("scan_label") + "\n" +
        "4️⃣ " + uiText("ask_route") + "\n" +
        "5️⃣ " + uiText("rain_popup_note") + "\n" +
        "6️⃣ Tap 🗺️ for live map • 📹 for live cam AI"
    );
})();
