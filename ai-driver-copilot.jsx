import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ───
const NINJA_RED = "#E31837";
const NINJA_DARK = "#1A1A2E";
const NINJA_GRAY = "#F4F4F8";
const MAX_IMG_SIZE = 1200; // max dimension for AI processing

// ─── Image Resizer ───
function resizeImage(file, maxDim = MAX_IMG_SIZE) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const base64 = canvas.toDataURL("image/jpeg", 0.85);
        const sizeKB = Math.round((base64.length * 3) / 4 / 1024);
        resolve({
          base64Data: base64.split(",")[1],
          previewUrl: base64,
          width,
          height,
          sizeKB,
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ─── Voice Nav Engine ───
function useVoiceNav() {
  const synth = useRef(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    synth.current = window.speechSynthesis;
  }, []);

  const speak = useCallback((text) => {
    if (!synth.current) return;
    synth.current.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.95;
    utt.pitch = 1;
    utt.lang = "en-US";
    utt.onstart = () => setSpeaking(true);
    utt.onend = () => setSpeaking(false);
    synth.current.speak(utt);
  }, []);

  const stop = useCallback(() => {
    synth.current?.cancel();
    setSpeaking(false);
  }, []);

  return { speak, stop, speaking };
}

// ─── GPS Hook ───
function useGPS() {
  const [pos, setPos] = useState(null);
  const [error, setError] = useState(null);
  const watchId = useRef(null);

  const startWatch = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported");
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
  }, []);

  const stopWatch = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
    }
  }, []);

  useEffect(() => {
    startWatch();
    return stopWatch;
  }, [startWatch, stopWatch]);

  return { pos, error };
}

// ─── Simulated Navigation Steps ───
function generateNavSteps(fromLabel, toAddress) {
  // In production this would come from a routing API
  // We simulate realistic directions based on address
  const steps = [
    { instruction: `Starting navigation to ${toAddress}`, icon: "🚀", distance: "" },
    { instruction: "Head north on the current road for 200 meters", icon: "⬆️", distance: "200m" },
    { instruction: "Turn right at the next junction", icon: "➡️", distance: "150m" },
    { instruction: "Continue straight for 500 meters", icon: "⬆️", distance: "500m" },
    { instruction: "Turn left onto the main road", icon: "⬅️", distance: "300m" },
    { instruction: "Keep right at the fork", icon: "↗️", distance: "200m" },
    { instruction: "Turn right into the delivery area", icon: "➡️", distance: "100m" },
    { instruction: `You have arrived at ${toAddress}. Deliver the package!`, icon: "📦", distance: "0m" },
  ];
  return steps;
}

// ─── Map Component (using iframe for simplicity) ───
function MapView({ address, gpsPos }) {
  const [mapUrl, setMapUrl] = useState(null);

  useEffect(() => {
    if (address) {
      const encoded = encodeURIComponent(address);
      // Use OpenStreetMap embed
      setMapUrl(
        `https://www.openstreetmap.org/export/embed.html?bbox=103.6,1.2,104.0,1.5&layer=mapnik&marker=1.35,103.8`
      );
    }
  }, [address]);

  // Geocode address to rough coordinates for Singapore context
  const getMapSrc = () => {
    if (!address) return null;
    const encoded = encodeURIComponent(address);
    return `https://maps.google.com/maps?q=${encoded}&t=&z=16&ie=UTF8&iwloc=&output=embed`;
  };

  return (
    <div style={{ width: "100%", height: "300px", borderRadius: "16px", overflow: "hidden", border: `2px solid ${NINJA_RED}` }}>
      {address ? (
        <iframe
          src={getMapSrc()}
          width="100%"
          height="100%"
          style={{ border: 0 }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title="Delivery Map"
        />
      ) : (
        <div style={{
          height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "#f0f0f0", color: "#888", fontSize: "14px"
        }}>
          📍 Map will appear after scanning address
        </div>
      )}
    </div>
  );
}

// ─── Navigation Panel ───
function NavPanel({ steps, currentStep, onNext, onPrev, onSpeak, speaking }) {
  if (!steps.length) return null;
  const step = steps[currentStep];

  return (
    <div style={{
      background: NINJA_DARK, borderRadius: "16px", padding: "20px",
      color: "white", marginTop: "16px"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "12px", opacity: 0.7, fontFamily: "'DM Sans', sans-serif" }}>
          STEP {currentStep + 1} OF {steps.length}
        </span>
        <div style={{
          background: NINJA_RED, borderRadius: "20px", padding: "4px 12px",
          fontSize: "11px", fontWeight: 600
        }}>
          {step.distance || "—"}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
        <span style={{ fontSize: "36px" }}>{step.icon}</span>
        <p style={{ fontSize: "16px", lineHeight: 1.4, fontFamily: "'DM Sans', sans-serif", margin: 0 }}>
          {step.instruction}
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ height: "4px", background: "rgba(255,255,255,0.15)", borderRadius: "2px", marginBottom: "16px" }}>
        <div style={{
          height: "100%", background: NINJA_RED, borderRadius: "2px",
          width: `${((currentStep + 1) / steps.length) * 100}%`,
          transition: "width 0.3s ease"
        }} />
      </div>

      <div style={{ display: "flex", gap: "10px" }}>
        <button
          onClick={onPrev}
          disabled={currentStep === 0}
          style={{
            flex: 1, padding: "12px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.2)",
            background: "transparent", color: "white", fontWeight: 600, cursor: "pointer",
            opacity: currentStep === 0 ? 0.4 : 1, fontFamily: "'DM Sans', sans-serif"
          }}
        >
          ← Back
        </button>
        <button
          onClick={onSpeak}
          style={{
            flex: 1, padding: "12px", borderRadius: "10px", border: "none",
            background: speaking ? "#ff6b6b" : NINJA_RED, color: "white",
            fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
            transition: "background 0.2s"
          }}
        >
          {speaking ? "🔊 Speaking..." : "🔊 Speak"}
        </button>
        <button
          onClick={onNext}
          disabled={currentStep === steps.length - 1}
          style={{
            flex: 1, padding: "12px", borderRadius: "10px", border: "none",
            background: "white", color: NINJA_DARK, fontWeight: 600, cursor: "pointer",
            opacity: currentStep === steps.length - 1 ? 0.4 : 1, fontFamily: "'DM Sans', sans-serif"
          }}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ─── Main App ───
export default function AIDriverCoPilot() {
  const [image, setImage] = useState(null);
  const [imageInfo, setImageInfo] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [ocrResult, setOcrResult] = useState(null);
  const [error, setError] = useState(null);
  const [navSteps, setNavSteps] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [activeTab, setActiveTab] = useState("scan"); // scan | nav
  const fileRef = useRef(null);
  const { speak, stop, speaking } = useVoiceNav();
  const { pos, error: gpsError } = useGPS();

  // Handle image upload + auto-resize
  const handleImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setOcrResult(null);
    setNavSteps([]);

    try {
      const resized = await resizeImage(file, MAX_IMG_SIZE);
      setImage(resized.previewUrl);
      setImageInfo({ w: resized.width, h: resized.height, size: resized.sizeKB, base64: resized.base64Data });
    } catch (err) {
      setError("Failed to resize image: " + err.message);
    }
  };

  // Send to Claude for OCR
  const processWithAI = async () => {
    if (!imageInfo) return;
    setProcessing(true);
    setError(null);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/jpeg",
                    data: imageInfo.base64,
                  },
                },
                {
                  type: "text",
                  text: `You are an OCR assistant for a delivery driver app. Analyze this package label image and extract the delivery address information.

IMPORTANT RULES:
1. AUTO-DETECT the language on the label (English, Chinese, Malay, Tamil, Thai, Vietnamese, Bahasa, etc.) - do NOT require language settings
2. Extract the FULL delivery address including street name, building number, postal code, and any unit/floor info
3. Also extract sender address if visible

Respond ONLY in this exact JSON format with no other text:
{
  "detected_language": "the language detected on the label",
  "sender_address": "full sender address or null",
  "delivery_address": "full delivery address to navigate to",
  "recipient_name": "name if visible or null",
  "postal_code": "postal code if found or null",
  "confidence": "high/medium/low",
  "notes": "any special delivery instructions visible"
}`
                },
              ],
            },
          ],
        }),
      });

      const data = await response.json();
      const text = data.content?.map((i) => i.text || "").join("\n") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setOcrResult(parsed);

      // Generate nav steps
      if (parsed.delivery_address) {
        const steps = generateNavSteps(pos, parsed.delivery_address);
        setNavSteps(steps);
        setCurrentStep(0);
        // Auto-speak first instruction
        speak(`Address detected: ${parsed.delivery_address}. Starting navigation.`);
      }
    } catch (err) {
      setError("AI processing failed: " + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleNavSpeak = () => {
    if (speaking) { stop(); return; }
    if (navSteps[currentStep]) {
      speak(navSteps[currentStep].instruction);
    }
  };

  const speakAllDirections = () => {
    const allText = navSteps.map((s, i) => `Step ${i + 1}. ${s.instruction}`).join(". ");
    speak(allText);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(180deg, ${NINJA_DARK} 0%, #16213E 100%)`,
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid rgba(255,255,255,0.08)`
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "40px", height: "40px", borderRadius: "12px",
            background: NINJA_RED, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: "20px"
          }}>
            🥷
          </div>
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: "16px", fontFamily: "'Space Mono', monospace" }}>
              DRIVER CO-PILOT
            </div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px" }}>
              AI-Powered Navigation
            </div>
          </div>
        </div>
        {/* GPS Status */}
        <div style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "6px 12px", borderRadius: "20px",
          background: pos ? "rgba(76,175,80,0.15)" : "rgba(255,87,34,0.15)",
          border: `1px solid ${pos ? "rgba(76,175,80,0.3)" : "rgba(255,87,34,0.3)"}`,
        }}>
          <div style={{
            width: "8px", height: "8px", borderRadius: "50%",
            background: pos ? "#4CAF50" : "#FF5722",
            boxShadow: pos ? "0 0 6px #4CAF50" : "0 0 6px #FF5722",
            animation: "pulse 2s infinite"
          }} />
          <span style={{ color: pos ? "#4CAF50" : "#FF5722", fontSize: "11px", fontWeight: 600 }}>
            {pos ? `GPS ✓ (±${Math.round(pos.acc)}m)` : gpsError || "GPS..."}
          </span>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display: "flex", padding: "12px 20px", gap: "8px" }}>
        {[
          { id: "scan", label: "📷 Scan Label", count: null },
          { id: "nav", label: "🗺️ Navigate", count: navSteps.length || null },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, padding: "10px", borderRadius: "10px", border: "none",
              background: activeTab === tab.id ? NINJA_RED : "rgba(255,255,255,0.08)",
              color: "white", fontWeight: 600, cursor: "pointer",
              fontSize: "13px", fontFamily: "'DM Sans', sans-serif",
              transition: "all 0.2s"
            }}
          >
            {tab.label} {tab.count ? `(${tab.count})` : ""}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "0 20px 100px" }}>

        {/* ─── SCAN TAB ─── */}
        {activeTab === "scan" && (
          <div>
            {/* Upload Area */}
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                border: "2px dashed rgba(255,255,255,0.2)",
                borderRadius: "16px", padding: "24px", textAlign: "center",
                cursor: "pointer", marginBottom: "16px",
                background: image ? "transparent" : "rgba(255,255,255,0.03)",
                transition: "border-color 0.2s"
              }}
              onMouseOver={(e) => e.currentTarget.style.borderColor = NINJA_RED}
              onMouseOut={(e) => e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleImage}
                style={{ display: "none" }}
              />
              {image ? (
                <div>
                  <img src={image} alt="Label" style={{
                    maxWidth: "100%", maxHeight: "200px", borderRadius: "12px",
                    objectFit: "contain"
                  }} />
                  {imageInfo && (
                    <div style={{
                      marginTop: "10px", color: "rgba(255,255,255,0.6)", fontSize: "12px",
                      display: "flex", justifyContent: "center", gap: "16px"
                    }}>
                      <span>📐 {imageInfo.w}×{imageInfo.h}px</span>
                      <span>💾 {imageInfo.size}KB</span>
                      <span style={{ color: "#4CAF50" }}>✓ Auto-resized</span>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: "48px", marginBottom: "8px" }}>📦</div>
                  <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "14px", fontWeight: 600 }}>
                    Tap to capture or upload package label
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px", marginTop: "4px" }}>
                    Auto-resizes to {MAX_IMG_SIZE}px max • Auto-detects language
                  </div>
                </div>
              )}
            </div>

            {/* Process Button */}
            {image && !ocrResult && (
              <button
                onClick={processWithAI}
                disabled={processing}
                style={{
                  width: "100%", padding: "16px", borderRadius: "12px", border: "none",
                  background: processing
                    ? "linear-gradient(90deg, #666, #888, #666)"
                    : `linear-gradient(135deg, ${NINJA_RED}, #ff4444)`,
                  color: "white", fontSize: "16px", fontWeight: 700, cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif", marginBottom: "16px",
                  backgroundSize: processing ? "200% 100%" : "100% 100%",
                  animation: processing ? "shimmer 1.5s infinite" : "none"
                }}
              >
                {processing ? "🔍 AI Reading Label..." : "🥷 Extract Address with AI"}
              </button>
            )}

            {/* Error */}
            {error && (
              <div style={{
                background: "rgba(255,87,34,0.15)", border: "1px solid rgba(255,87,34,0.3)",
                borderRadius: "12px", padding: "14px", marginBottom: "16px",
                color: "#FF5722", fontSize: "13px"
              }}>
                ⚠️ {error}
              </div>
            )}

            {/* OCR Results */}
            {ocrResult && (
              <div style={{
                background: "rgba(255,255,255,0.06)", borderRadius: "16px",
                padding: "20px", marginBottom: "16px",
                border: "1px solid rgba(255,255,255,0.1)"
              }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  marginBottom: "16px"
                }}>
                  <span style={{ color: "white", fontWeight: 700, fontSize: "15px" }}>
                    📋 Extracted Info
                  </span>
                  <span style={{
                    background: ocrResult.confidence === "high" ? "rgba(76,175,80,0.2)" : "rgba(255,193,7,0.2)",
                    color: ocrResult.confidence === "high" ? "#4CAF50" : "#FFC107",
                    padding: "4px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 600
                  }}>
                    {ocrResult.confidence?.toUpperCase()} CONFIDENCE
                  </span>
                </div>

                {/* Language Badge */}
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: "6px",
                  background: "rgba(156,39,176,0.15)", border: "1px solid rgba(156,39,176,0.3)",
                  borderRadius: "8px", padding: "6px 12px", marginBottom: "14px"
                }}>
                  <span style={{ fontSize: "14px" }}>🌐</span>
                  <span style={{ color: "#CE93D8", fontSize: "12px", fontWeight: 600 }}>
                    Auto-detected: {ocrResult.detected_language}
                  </span>
                </div>

                {/* Address Fields */}
                {[
                  { label: "📍 Delivery Address", value: ocrResult.delivery_address, highlight: true },
                  { label: "📮 Postal Code", value: ocrResult.postal_code },
                  { label: "👤 Recipient", value: ocrResult.recipient_name },
                  { label: "📦 Sender", value: ocrResult.sender_address },
                  { label: "📝 Notes", value: ocrResult.notes },
                ].filter(f => f.value && f.value !== "null").map((field, i) => (
                  <div key={i} style={{
                    padding: "12px", borderRadius: "10px", marginBottom: "8px",
                    background: field.highlight ? "rgba(227,24,55,0.1)" : "rgba(255,255,255,0.04)",
                    border: field.highlight ? `1px solid ${NINJA_RED}40` : "1px solid rgba(255,255,255,0.06)"
                  }}>
                    <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px", marginBottom: "4px" }}>
                      {field.label}
                    </div>
                    <div style={{
                      color: "white", fontSize: field.highlight ? "16px" : "14px",
                      fontWeight: field.highlight ? 700 : 500
                    }}>
                      {field.value}
                    </div>
                  </div>
                ))}

                {/* Navigate Button */}
                <button
                  onClick={() => {
                    setActiveTab("nav");
                    speak(`Navigating to ${ocrResult.delivery_address}`);
                  }}
                  style={{
                    width: "100%", padding: "16px", borderRadius: "12px", border: "none",
                    background: `linear-gradient(135deg, #4CAF50, #2E7D32)`,
                    color: "white", fontSize: "16px", fontWeight: 700, cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif", marginTop: "8px"
                  }}
                >
                  🗺️ Navigate to This Address
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─── NAV TAB ─── */}
        {activeTab === "nav" && (
          <div>
            {ocrResult?.delivery_address ? (
              <>
                {/* Destination Card */}
                <div style={{
                  background: `linear-gradient(135deg, ${NINJA_RED}, #c41230)`,
                  borderRadius: "16px", padding: "18px", marginBottom: "16px", color: "white"
                }}>
                  <div style={{ fontSize: "11px", opacity: 0.8, marginBottom: "6px", fontWeight: 600, letterSpacing: "1px" }}>
                    DELIVERING TO
                  </div>
                  <div style={{ fontSize: "18px", fontWeight: 700, lineHeight: 1.3 }}>
                    {ocrResult.delivery_address}
                  </div>
                  {ocrResult.postal_code && (
                    <div style={{ marginTop: "6px", opacity: 0.8, fontSize: "13px" }}>
                      Postal: {ocrResult.postal_code}
                    </div>
                  )}
                </div>

                {/* Map */}
                <MapView address={ocrResult.delivery_address} gpsPos={pos} />

                {/* Voice All Button */}
                <button
                  onClick={speakAllDirections}
                  style={{
                    width: "100%", padding: "14px", borderRadius: "12px", border: `2px solid ${NINJA_RED}`,
                    background: "transparent", color: NINJA_RED, fontSize: "14px",
                    fontWeight: 700, cursor: "pointer", marginTop: "16px",
                    fontFamily: "'DM Sans', sans-serif"
                  }}
                >
                  🔊 Read All Directions Aloud
                </button>

                {/* Step-by-step Nav */}
                <NavPanel
                  steps={navSteps}
                  currentStep={currentStep}
                  onNext={() => {
                    const next = Math.min(currentStep + 1, navSteps.length - 1);
                    setCurrentStep(next);
                    speak(navSteps[next].instruction);
                  }}
                  onPrev={() => {
                    const prev = Math.max(currentStep - 1, 0);
                    setCurrentStep(prev);
                    speak(navSteps[prev].instruction);
                  }}
                  onSpeak={handleNavSpeak}
                  speaking={speaking}
                />

                {/* All Steps List */}
                <div style={{ marginTop: "16px" }}>
                  <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px", fontWeight: 600, marginBottom: "10px", letterSpacing: "1px" }}>
                    ALL DIRECTIONS
                  </div>
                  {navSteps.map((step, i) => (
                    <div
                      key={i}
                      onClick={() => {
                        setCurrentStep(i);
                        speak(step.instruction);
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: "12px",
                        padding: "12px", borderRadius: "10px", marginBottom: "6px",
                        cursor: "pointer",
                        background: i === currentStep ? "rgba(227,24,55,0.15)" : "rgba(255,255,255,0.03)",
                        border: i === currentStep ? `1px solid ${NINJA_RED}50` : "1px solid rgba(255,255,255,0.05)",
                        transition: "all 0.2s"
                      }}
                    >
                      <span style={{ fontSize: "22px", width: "32px", textAlign: "center" }}>{step.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{
                          color: i === currentStep ? "white" : "rgba(255,255,255,0.7)",
                          fontSize: "13px", fontWeight: i === currentStep ? 600 : 400
                        }}>
                          {step.instruction}
                        </div>
                      </div>
                      {step.distance && (
                        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px" }}>
                          {step.distance}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{
                textAlign: "center", padding: "60px 20px", color: "rgba(255,255,255,0.5)"
              }}>
                <div style={{ fontSize: "64px", marginBottom: "16px" }}>📷</div>
                <div style={{ fontSize: "16px", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>
                  No address scanned yet
                </div>
                <div style={{ fontSize: "13px", marginTop: "6px" }}>
                  Go to Scan Label tab to capture a package label first
                </div>
                <button
                  onClick={() => setActiveTab("scan")}
                  style={{
                    marginTop: "20px", padding: "12px 24px", borderRadius: "10px",
                    border: "none", background: NINJA_RED, color: "white",
                    fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif"
                  }}
                >
                  Go to Scanner
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        * { box-sizing: border-box; margin: 0; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: ${NINJA_RED}; border-radius: 2px; }
      `}</style>
    </div>
  );
}
