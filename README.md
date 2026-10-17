# Wi-Finity Digital Twin
> **Presentation-Grade Interactive 3D Simulation of Wi-Fi CSI Motion Sensing**  
> *Camera-Free • Wearable-Free • Privacy-Safe Occupancy & Fall Pattern Detection*

---

## 1. Project Overview

**Wi-Finity Digital Twin** is an interactive, browser-based 3D digital twin demonstrating how ambient Wi-Fi radio waves can sense human occupancy, movement, and possible fall patterns inside a room **without cameras, infrared sensors, or wearable devices**.

For college fairs, competitions (such as Innotech Fest), and technical showcases where specialized Wi-Fi CSI hardware is unavailable on stage, this application provides an **honest, mathematically grounded physics simulation** combined with a **ground-truth-blind signal detector** and a command-center telemetry dashboard.

```
       [ 3D Scene (Three.js) ]
         │ (Human avatars move)
         ▼
[ Multi-path Ray Physics Engine ]
         │ (Generates 56-subcarrier H(f) stream @ 30 Hz)
         ▼
 [ Data Source Interface (SimSource) ]
         │ (Float32Array[56] per link)
         ▼
[ Blind CsiDetector (Hampel + Std + Cosine Survey) ]
         │ (NO access to 3D scene / ground truth)
         ▼
[ Command Center Dashboard + Alert Engine ]
  • Top-down 3×3 Radar Heatmap
  • Real-time Waterfall Spectrograms (RX1–RX4)
  • Live Subcarrier Spectrum vs Baseline
  • Motion & Presence Scrolling Timeline
  • Ground Truth vs. Estimate Rolling Accuracy
  • Fall Alert Banner + Simulated Mobile Push Notification
```

---

## 2. Non-Negotiable Honesty Rules

To maintain scientific integrity in front of judges:

1. **Permanent Simulation Badge**: The badge `"SIMULATION - synthetic Wi-Fi signal"` is visible in the top header at all times.
2. **Strict Detector Blindness**: The detector and dashboard consume **only** raw synthetic CSI streams (`Float32Array(56)` per link). The detector **never** reads avatars' true coordinates or activities.
3. **Ground Truth Comparison**: Actual scene coordinates and activities are displayed alongside the detector's estimate in the *"Ground Truth vs. Estimate"* panel, complete with a rolling 60-second accuracy score that **drops visibly** when concrete walls or interference are enabled.
4. **No Medical Claims**: Uses the terminology `"possible fall pattern"`, never `"fall detected"`.
5. **No False Claims**: Does not claim breathing detection, heartbeat monitoring, or exact multi-person counts. It only flags `"Multiple movers likely"` when distinct zones diverge.

---

## 3. How to Run (100% Offline Capable)

This project requires **no build step, no bundlers, no npm installs, and no internet connection** during execution. All dependencies (Three.js r160, OrbitControls, EffectComposer, UnrealBloomPass) are vendored locally in `/vendor`.

### Option A: VS Code Live Server (Recommended)
1. Open this repository in VS Code.
2. Right-click `index.html` and select **"Open with Live Server"**.
3. The app will launch in your browser at `http://127.0.0.1:5500/index.html`.

### Option B: Python Local Server
Run in PowerShell or terminal:
```bash
python -m http.server 8080
```
Then navigate to:
```
http://localhost:8080/index.html
```

---

## 4. How the Physics Engine Works

The physics engine (`src/physics.js`) simulates Channel State Information (CSI) across **56 OFDM subcarriers** at carrier frequency $f_0 = 2.437\text{ GHz}$ (Wi-Fi Channel 6) with $312.5\text{ kHz}$ subcarrier spacing ($\lambda \approx 12.3\text{ cm}$).

For each receiver link ($\text{TX} \to \text{RX}_k$) every tick ($30\text{ Hz}$):
$$H(f_m) = \sum_{p \in \text{paths}} \frac{a_p}{d_p} \exp\left( -j \frac{2\pi f_m d_p}{c} \right)$$

### Modeled Multi-path Components:
1. **Direct Path (LOS)**: Direct line-of-sight from TX to RX.
2. **First-Order Specular Reflections (Image Method)**: Reflections from 4 walls, ceiling, and floor calculated by mirroring transmitter coordinates across boundary planes.
3. **Dynamic Human Scatterers**: Each person acts as an effective radio scatterer with reflection coefficient $a_{\text{person}} \approx 0.38$. As an avatar moves, the path length $d_{\text{total}} = d_{\text{tx}\to\text{person}} + d_{\text{person}\to\text{rx}}$ changes continuously, naturally inducing Doppler phase shifts and constructive/destructive interference fringes.
4. **Physical Occlusion & Attenuation**:
   - Fabric partition curtain adds $\approx 5\text{ dB}$ attenuation.
   - Thick concrete back wall toggle adds $\approx 18\text{ dB}$ loss and high reflectivity.
5. **Hardware Realism**: Gaussian thermal noise, slow local oscillator phase drift, random packet AGC gain jitter, and toggleable bursty interference.

---

## 5. How the Signal Processing & Detector Work

The detector (`src/detector.js`) is completely blind to ground truth:

1. **Hampel Outlier Filter**: Uses a sliding window with Median Absolute Deviation (MAD) to filter out sporadic impulse noise spikes:
   $$|x - \text{median}| > 3.0 \times 1.4826 \times \text{MAD}$$
2. **Motion Score ($M$)**: Computes standard deviation of each subcarrier over a 30-sample ($\approx 1.0\text{s}$) sliding window, averaged across all 56 subcarriers and normalized by the calibrated empty-room baseline:
   $$M = \frac{1}{56} \sum_{k=1}^{56} \frac{\sigma_k}{\sigma_{\text{calibrated}}}$$
3. **Presence Score ($P$)**: Measures the deviation of sliding window mean amplitude from the calibrated empty-room baseline mean (detects a stationary person standing or sitting):
   $$P = \frac{1}{56} \sum_{k=1}^{56} \frac{|\mu_k - \mu_{\text{baseline}, k}|}{\sigma_{\text{baseline}}}$$
4. **3×3 Zone Estimation (Fingerprint Matching)**:
   - Divides the room into 9 zones ($A1 \dots C3$).
   - A fingerprint dictionary stores per-link motion and presence sensitivity vectors for each zone.
   - Computes cosine similarity between live link metrics and stored fingerprints, then applies temperature-controlled softmax ($P(z)$) and temporal IIR smoothing ($\alpha = 0.78$).
5. **State Machine with Hysteresis**:
   - `EMPTY`: Low motion, low presence.
   - `PRESENT_STILL`: High presence, low motion.
   - `MOVING`: Motion score exceeds threshold ($> 1.85$).
   - `POSSIBLE_FALL`: High-energy motion burst ($> 3.2\times$ baseline) followed by $\ge 3.0\text{ seconds}$ of stillness in the same zone while presence remains elevated.

---

## 6. Three-Minute Presentation Script for Judges

| Time | What to Do in the App | What to Say to the Judges |
| :--- | :--- | :--- |
| **0:00 – 0:30** | Show default screen, point out permanent **"SIMULATION"** badge and header. Press `2` for Isometric view. | *"Good morning judges. Wi-Finity demonstrates camera-free indoor motion sensing using Wi-Fi radio wave disturbances. In private areas like hospital wards or elder care bedrooms, cameras violate privacy. Wi-Fi signals reflect off walls and humans. When someone moves, multipath radio patterns change."* |
| **0:30 – 1:15** | Click and drag the avatar across the room. Point to the **Waterfall** and **Radar Heatmap**. | *"Here is our 3D digital twin. As I drag this person, observe the live CSI waterfall on the right. Notice how the subcarrier amplitudes ripple as the path length changes by centimeters. The detector on the right is completely blind to 3D coordinates—it only sees these 56 subcarrier numbers, yet it correctly maps the movement to Zone B2."* |
| **1:15 – 1:55** | Click **"Sit"**, then select **"Possible Fall"** action button. | *"When the person sits, motion stops, but presence remains detected. Now watch our 'Possible Fall' scenario: the avatar drops rapidly, followed by complete stillness. Notice our state machine: it sees the impact burst, measures 3 seconds of stillness, and immediately flags 'POSSIBLE FALL PATTERN' on the simulated mobile alert card."* |
| **1:55 – 2:30** | Toggle **"Concrete Wall"** or **"Heavy Interference"** and point to the Ground Truth panel. | *"Crucially, we do not claim 100% magic accuracy. Notice our Ground Truth vs. Estimate panel. When I toggle a concrete wall or heavy 2.4 GHz interference, the rolling accuracy drops from 95% down to 60%. We show judges exactly where RF sensing excels and where physical barriers challenge it."* |
| **2:30 – 3:00** | Click **"Enable 4th Receiver (RX4)"**, explain hardware extensibility. | *"Adding a 4th receiver puck immediately refines zone resolution. Furthermore, our architecture abstracts data sources: this digital twin can accept live ESP32 CSI packets via a single WebSocket stream without modifying the detector."* |

---

## 7. Judge FAQs: "Is this real?"

### Q1: "Is this actual measured Wi-Fi data or a simulation?"
> **Answer**: *"This demo is a physics-based digital twin simulation. We do not have physical ESP32 boards mounted in this exhibition hall today, so our physics engine computes the multi-path channel frequency response $H(f)$ for 56 subcarriers at 30 Hz. However, the detector is 100% genuine signal processing: it has zero access to the 3D scene and only analyzes the raw subcarrier stream."*

### Q2: "Can Windows laptops give you research-grade CSI?"
> **Answer**: *"No. Standard Windows Wi-Fi drivers only expose coarse RSSI (Received Signal Strength Indicator) once per second via `netsh`. Research-grade CSI requires microsecond-level subcarrier amplitude and phase from specialized hardware like ESP32 microcontrollers (using ESP-CSI) or Intel 5300 / Atheros NICs running modified Linux kernels. That is why this software includes a WebSocket interface ready to ingest real ESP32 CSI packets."*

### Q3: "Is fall detection reliable enough for medical use?"
> **Answer**: *"No, and we make no clinical claims. We explicitly label this 'possible fall pattern'. It detects sudden high-energy RF variance followed by sustained stationary presence. It is a smart screening indicator to prompt a human check, not a certified medical diagnostic device."*

### Q4: "Can Wi-Fi see through walls?"
> **Answer**: *"2.4 GHz Wi-Fi can penetrate standard drywall with 3–5 dB attenuation. However, thick reinforced concrete causes 15–20 dB loss and strong specular reflection. We demonstrate this exact physics limitation live: toggling the concrete wall causes the zone estimation accuracy to drop visibly."*

---

## 8. Plugging in Real Hardware (ESP32 CSI Stream)

To connect real ESP32 boards:
1. Flash 2–3 ESP32-S3 boards with the open-source `espressif/esp-csi` firmware (`csi_recv`).
2. Run a local WebSocket forwarder (e.g., Python script reading serial ports and serving `ws://localhost:8765/csi`).
3. In `src/sources.js`, replace `SimSource` with `WebSocketSource`.

### Expected JSON Packet Specification:
```json
{
  "link": "RX1",
  "timestamp": 1729170000.123,
  "subcarriers": 56,
  "amplitudes": [0.35, 0.38, 0.42, 0.45, 0.39, 0.32, "... 56 floats ..."]
}
```

---

## 9. Keyboard Shortcuts & Controls

| Key | Action |
| :--- | :--- |
| **`1`** | Camera Preset 1: Top-Down Orthographic View |
| **`2`** | Camera Preset 2: Isometric Presentation View |
| **`3`** | Camera Preset 3: Free Orbit Controls |
| **`SPACE`** | Pause / Resume simulation |
| **`G`** | Start / Stop 90-second Guided Tour |
| **`R`** | Reset detector baseline and statistics |
| **`F`** | Toggle Fullscreen |
| **`P`** | Toggle **Presenter Mode** (enlarged typography for 1080p projectors) |

---

## 10. File Tree & Architecture

```
inootech/
├── index.html                # App entrypoint with semantic HTML layout & import map
├── style.css                 # Cybernetic dark command center design system
├── config.js                 # Root configuration re-export
├── README.md                 # Complete guide, demo script, and physics documentation
├── vendor/                   # 100% Offline Three.js r160 & Postprocessing addons
│   ├── three.module.js
│   └── addons/
│       ├── controls/OrbitControls.js
│       ├── postprocessing/EffectComposer.js, UnrealBloomPass.js, etc.
│       └── shaders/
└── src/
    ├── config.js             # Room geometry, RF nodes, subcarrier & detector parameters
    ├── main.js               # Application coordinator, keyboard shortcuts & loop
    ├── scene.js              # Three.js 3D room, avatars, drag raycaster, camera presets
    ├── physics.js            # Synthetic CSI multi-path generator (56 subcarriers)
    ├── detector.js           # Blind signal processor, Hampel filter, state machine
    ├── dashboard.js          # All 9 command center visualizers & telemetry canvases
    ├── scenarios.js          # 8 scripted scenarios, 90s guided tour, record/replay
    ├── sources.js            # Data source abstraction (SimSource, WebSocketSource, ReplaySource)
    └── audio.js              # Web Audio API alert synthesizer (soft chime)
```

---

*Wi-Finity Digital Twin — Engineered for presentation excellence, mathematical honesty, and seamless offline demonstration.*
