/**
 * Wi-Finity Digital Twin - Configuration & Parameters
 * All physical, simulation, detection, and UI parameters are defined here.
 * Designed to be easily tunable by students and presenters.
 */

export const CONFIG = {
  // Room Geometry (meters)
  ROOM: {
    LENGTH: 6.0,  // X axis: -3.0 to +3.0
    WIDTH: 4.5,   // Z axis: -2.25 to +2.25
    HEIGHT: 2.7,  // Y axis: 0.0 to 2.7
    GRID_COLS: 3, // Zones A, B, C (X axis)
    GRID_ROWS: 3, // Zones 1, 2, 3 (Z axis)
  },

  // Wi-Fi RF Hardware Nodes (positions in meters)
  NODES: {
    // Transmitter (Wi-Fi Router) mounted on wall/shelf
    TX: { id: 'TX', name: 'Wi-Fi AP (Router)', x: -2.6, y: 1.6, z: -1.8, color: '#38bdf8' },
    
    // Default 3 Receivers
    RX1: { id: 'RX1', name: 'Sensor Puck 1', x: 2.6, y: 1.1, z: -1.7, color: '#34d399' },
    RX2: { id: 'RX2', name: 'Sensor Puck 2', x: 2.6, y: 1.0, z: 1.7, color: '#a78bfa' },
    RX3: { id: 'RX3', name: 'Sensor Puck 3', x: -2.6, y: 1.0, z: 1.7, color: '#f472b6' },

    // Optional 4th Receiver (center far wall)
    RX4: { id: 'RX4', name: 'Sensor Puck 4 (Optional)', x: 0.0, y: 1.4, z: 2.05, color: '#fbbf24' },
  },

  // Wi-Fi Channel & CSI Physical Specifications
  CSI: {
    CARRIER_FREQ: 2.437e9,        // 2.437 GHz (Wi-Fi Channel 6)
    SPEED_OF_LIGHT: 299792458,    // m/s
    WAVELENGTH: 299792458 / 2.437e9, // ~0.123 m (12.3 cm)
    SUBCARRIER_COUNT: 56,         // 56 subcarriers (standard 802.11n/ac 20MHz CSI)
    SUBCARRIER_SPACING: 312.5e3,  // 312.5 kHz spacing
    TICK_RATE_HZ: 30,             // 30 Hz simulation & streaming rate
    TICK_INTERVAL_MS: 1000 / 30,  // ~33.3 ms
  },

  // Physics Model Parameters
  PHYSICS: {
    DEFAULT_NOISE_LEVEL: 0.015,     // Thermal / quantization noise std dev
    PACKET_GAIN_JITTER: 0.018,      // Hardware AGC packet-to-packet jitter
    DRIFT_RATE: 0.003,              // Slow oscillator drift rate
    
    // Surface Reflectivities (amplitude reflection coefficients)
    DRYWALL_REFLECTIVITY: 0.35,     // Standard drywall reflection
    CONCRETE_REFLECTIVITY: 0.70,    // Dense concrete wall reflection
    CEILING_REFLECTIVITY: 0.22,
    FLOOR_REFLECTIVITY: 0.25,

    // Attenuations (linear amplitude scale factor multiplier <= 1.0)
    DRYWALL_THROUGH_ATTEN: 0.75,    // Drywall through-path
    CONCRETE_THROUGH_ATTEN: 0.18,   // Concrete wall through-path (~15-18 dB loss)
    CURTAIN_THROUGH_ATTEN: 0.55,    // Translucent curtain through-path (~5 dB loss)

    // Human Reflector properties
    PERSON_REFLECTIVITY: 0.38,      // Effective human body reflection coefficient
    PERSON_RADII: {
      STANDING: 0.28,
      SITTING: 0.35,
      LYING: 0.65,                  // Lying down presents a wider, lower reflective target
    },
    
    // Bursty interference parameters
    INTERFERENCE_BURST_PROB: 0.08,  // Probability of interference spike when toggled
    INTERFERENCE_AMPLITUDE: 0.12,
  },

  // Detector & Signal Processing Parameters (Blind to ground truth)
  DETECTOR: {
    HAMPEL_WINDOW: 7,               // Outlier filter sliding window size
    HAMPEL_THRESHOLD: 3.0,          // MAD multiplier for outlier rejection
    SLIDING_WINDOW_SIZE: 30,        // ~1.0 second of data at 30 Hz for motion std dev
    CALIBRATION_DURATION_SEC: 6.0,  // Empty room calibration duration

    // Multipliers over calibrated baseline
    MOTION_THRESHOLD: 1.85,         // Normalized motion std score to trigger MOVING
    PRESENCE_THRESHOLD: 1.25,       // Amplitude drift from empty room to trigger PRESENT_STILL
    STILL_MAX_MOTION: 1.30,         // Upper limit of motion to be considered "still"

    // Possible Fall State Machine criteria
    FALL_BURST_MIN_MOTION: 3.2,     // High-energy impact burst motion spike
    FALL_BURST_WINDOW_MS: 1200,     // Window within which burst must have occurred
    FALL_STILLNESS_MIN_SEC: 3.0,    // Required post-burst stillness duration (seconds)
    FALL_CONFIDENCE_BASE: 0.82,     // Base confidence for detected pattern

    // Zone Fingerprint Matching
    ZONE_SMOOTHING_ALPHA: 0.78,     // Temporal IIR smoothing for zone probability
    MULTI_MOVER_PROB_THRESHOLD: 0.32,// If 2 distinct zones have prob > this, flag multi-mover
  },

  // Optional Cloud Alerting
  ALERT: {
    WEBHOOK_URL: '',                // Set in UI or here (e.g. AWS API Gateway / Lambda Function URL)
    API_KEY: '',                    // Optional x-api-key header
    DEBOUNCE_SEC: 10,               // Minimum seconds between repeated webhook calls
  },

  // Color Palette & Themes
  THEME: {
    DARK_BG: '#070b14',
    PANEL_BG: 'rgba(15, 23, 42, 0.75)',
    ACCENT_CYAN: '#00f0ff',
    ACCENT_MAGENTA: '#ec4899',
    ACCENT_AMBER: '#f59e0b',
    ALERT_RED: '#ef4444',
    SUCCESS_GREEN: '#10b981',
  }
};
