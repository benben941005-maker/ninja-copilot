// =========================================================
// ai-driver-copilot.js — PATCH FILE
// Copy each block below and replace the matching function
// in your actual ai-driver-copilot.js
// =========================================================


// =========================================================
// PATCH 1 — Replace getSysPrompt()
// FIND:    function getSysPrompt() {
// REPLACE WITH this entire block:
// =========================================================

    function getSysPrompt() {
        var locInfo = currentStreet ? ("\nDriver current location: " + currentStreet + (gpsPos ? " (GPS:" + gpsPos.lat.toFixed(5) + "," + gpsPos.lng.toFixed(5) + ")" : "")) : "";
        var modeInfo = "\nTransport mode: " + transportMode + ". Routing preference: " + routingMode + ".";
        return [
            "You are Ninja Co-Pilot, AI assistant for Ninja Van drivers in Singapore." + locInfo + modeInfo,
            "STRICT RULES: Max 15 words. GPS navigation style only. Action first.",
            "NEVER ask which location. NEVER list options. NEVER give paragraphs. NEVER ask questions.",
            "For any nearby place (restaurant, hotel, mall, MRT, toilet, petrol station): auto-pick the single nearest one using driver GPS coordinates. Navigate immediately.",
            "For navigation replies include on separate lines:",
            "ADDRESS: full Singapore address with postal code",
            "PLACE: short place name"
        ].join("\n");
    }


// =========================================================
// PATCH 2 — Replace getOcrPrompt()
// FIND:    function getOcrPrompt() {
// REPLACE WITH this entire block:
// =========================================================

    function getOcrPrompt() {
        return [
            "Extract Singapore delivery info from this image.",
            "CRITICAL: Image may contain handwritten text at any angle, tilt, or partial rotation. Read ALL text including messy handwriting.",
            "Try all reading orientations including upside-down and mirrored. Phone numbers are exactly 8 digits. Postal codes are exactly 6 digits. Singapore blocks follow pattern 'Blk NNN Street Name'.",
            "If you see 'PH' it means Phone. Extract the number after it.",
            "Return JSON ONLY. No markdown. No backticks.",
            '{"address":"full address or best guess","unit":"unit/block or null","postal":"6-digit postal code or null","recipient":"name or null","sender":"sender or null","phone":"8-digit Singapore number only, digits only, no spaces","place":"place name or null","confidence":"high/medium/low"}'
        ].join("\n");
    }


// =========================================================
// PATCH 3 — Replace getLiveCamPrompt()
// FIND:    function getLiveCamPrompt() {
// REPLACE WITH this entire block:
// =========================================================

    function getLiveCamPrompt() {
        return [
            "Analyze this Singapore live street or parcel image.",
            "CRITICAL: Text may be handwritten, at any angle, or partially visible. Try all orientations.",
            "Return exactly:",
            "ADDRESS: full Singapore address with street and postal code if visible",
            "PLACE: short place name",
            "NOTE: short action guidance",
            "If uncertain, return ADDRESS: UNKNOWN"
        ].join("\n");
    }
