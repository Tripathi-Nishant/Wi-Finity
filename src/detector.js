/**
 * Wi-Finity Digital Twin - Signal Processing & State Machine Detector
 * 
 * STRICT HONESTY DIRECTIVE:
 * This module is 100% BLIND to ground truth. It has NO access to the 3D scene,
 * avatar positions, or ground truth coordinates.
 * It ONLY consumes raw subcarrier amplitude arrays streamed via processFrame(linkId, amplitudes, timestamp).
 * 
 * Pipeline per link:
 * 1. Hampel outlier filter + sliding window buffer.
 * 2. Motion Score: Average standard deviation across 56 subcarriers normalized by baseline.
 * 3. Presence Score: Absolute mean amplitude deviation from calibrated empty room baseline.
 * 4. Zone Estimation: Cosine similarity matching against 3x3 fingerprint survey with softmax + temporal smoothing.
 * 5. State Machine: EMPTY -> MOVING -> PRESENT_STILL -> POSSIBLE_FALL pattern with hysteresis.
 */

import { CONFIG } from './config.js';

export class CsiDetector {
  constructor() {
    this.links = ['RX1', 'RX2', 'RX3', 'RX4'];
    
    // Per-link rolling buffers: array of Float32Array(56)
    this.slidingBuffers = {
      RX1: [],
      RX2: [],
      RX3: [],
      RX4: [],
    };

    // Calibrated baseline statistics per link
    this.baseline = {
      RX1: { meanAmps: new Float32Array(56).fill(0.35), meanStd: 0.012 },
      RX2: { meanAmps: new Float32Array(56).fill(0.35), meanStd: 0.012 },
      RX3: { meanAmps: new Float32Array(56).fill(0.35), meanStd: 0.012 },
      RX4: { meanAmps: new Float32Array(56).fill(0.35), meanStd: 0.012 },
    };

    // Live link metrics
    this.linkMetrics = {
      RX1: { motion: 0.1, presence: 0.05, currentAmps: new Float32Array(56) },
      RX2: { motion: 0.1, presence: 0.05, currentAmps: new Float32Array(56) },
      RX3: { motion: 0.1, presence: 0.05, currentAmps: new Float32Array(56) },
      RX4: { motion: 0.1, presence: 0.05, currentAmps: new Float32Array(56) },
    };

    // Global aggregated scores
    this.globalMotion = 0.1;
    this.globalPresence = 0.05;

    // State machine
    this.state = 'EMPTY'; // 'EMPTY' | 'PRESENT_STILL' | 'MOVING' | 'POSSIBLE_FALL'
    this.confidence = 0.95;
    this.stateTimer = 0;
    this.stateEnterTime = performance.now() / 1000.0;

    // Fall pattern detection memory
    this.fallBurstDetected = false;
    this.fallBurstTime = 0;
    this.fallBurstZone = null;
    this.stillnessStartTime = 0;
    this.alertTriggered = false;

    // 3x3 Zone Grid Definitions
    // A: Left (-2m), B: Center (0m), C: Right (+2m)
    // 1: Top (-1.5m), 2: Mid (0m), 3: Bot (+1.5m)
    this.zoneNames = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
    this.zoneProbabilities = new Float32Array(9).fill(1 / 9);
    this.estimatedZone = 'B2';
    this.multipleMoversLikely = false;

    // Stored site survey fingerprints: zoneName -> feature vector [m1, m2, m3, m4, p1, p2, p3, p4]
    this.fingerprints = {};
    this.initDefaultFingerprints();

    // Calibration state
    this.isCalibrating = false;
    this.calibrationSamples = { RX1: [], RX2: [], RX3: [], RX4: [] };
    this.calibrationStartTime = 0;

    // Event listeners
    this.stateListeners = [];
    this.fallAlertListeners = [];
  }

  onStateChange(fn) { this.stateListeners.push(fn); }
  onFallAlert(fn) { this.fallAlertListeners.push(fn); }

  /**
   * Initializes initial zone fingerprint signatures based on geometric distance from links
   */
  initDefaultFingerprints() {
    const zones = [
      { id: 'A1', x: -2.0, z: -1.5 },
      { id: 'A2', x: -2.0, z: 0.0 },
      { id: 'A3', x: -2.0, z: 1.5 },
      { id: 'B1', x: 0.0,  z: -1.5 },
      { id: 'B2', x: 0.0,  z: 0.0 },
      { id: 'B3', x: 0.0,  z: 1.5 },
      { id: 'C1', x: 2.0,  z: -1.5 },
      { id: 'C2', x: 2.0,  z: 0.0 },
      { id: 'C3', x: 2.0,  z: 1.5 },
    ];

    const tx = CONFIG.NODES.TX;
    const rxNodes = [CONFIG.NODES.RX1, CONFIG.NODES.RX2, CONFIG.NODES.RX3, CONFIG.NODES.RX4];

    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      const vec = [];
      
      // Motion & Presence sensitivity in zone z inversely correlates with distance to link
      for (const rx of rxNodes) {
        const dTx = Math.hypot(z.x - tx.x, z.z - tx.z);
        const dRx = Math.hypot(rx.x - z.x, rx.z - z.z);
        const sensitivity = 1.0 / Math.max(dTx * dRx, 0.8);
        vec.push(sensitivity); // motion feature
      }
      for (const rx of rxNodes) {
        const dTx = Math.hypot(z.x - tx.x, z.z - tx.z);
        const dRx = Math.hypot(rx.x - z.x, rx.z - z.z);
        const sensitivity = 1.0 / Math.max(dTx * dRx, 0.8);
        vec.push(sensitivity * 0.8); // presence feature
      }

      // Normalize feature vector
      const mag = Math.hypot(...vec) || 1.0;
      this.fingerprints[z.id] = vec.map(v => v / mag);
    }
  }

  /**
   * Process a single incoming CSI frame from a link
   * @param {string} linkId - 'RX1' | 'RX2' | 'RX3' | 'RX4'
   * @param {Float32Array} rawAmplitudes - 56 subcarrier amplitudes
   * @param {number} timestamp - timestamp in seconds
   */
  processFrame(linkId, rawAmplitudes, timestamp) {
    if (!this.slidingBuffers[linkId]) return;

    // 1. Hampel Outlier Filter
    const filteredAmps = this.applyHampelFilter(rawAmplitudes, linkId);
    this.linkMetrics[linkId].currentAmps.set(filteredAmps);

    // If currently calibrating empty room, store sample
    if (this.isCalibrating) {
      this.calibrationSamples[linkId].push(new Float32Array(filteredAmps));
      if (timestamp - this.calibrationStartTime >= CONFIG.DETECTOR.CALIBRATION_DURATION_SEC) {
        this.finalizeCalibration();
      }
      return;
    }

    // Push into sliding window buffer
    const buf = this.slidingBuffers[linkId];
    buf.push(new Float32Array(filteredAmps));
    if (buf.length > CONFIG.DETECTOR.SLIDING_WINDOW_SIZE) {
      buf.shift();
    }

    // 2. Compute Motion & Presence for this link
    this.updateLinkMetrics(linkId);

    // If frame is from the primary or final link in tick, update global state machine
    if (linkId === 'RX1') {
      this.updateGlobalState(timestamp);
      this.estimateZone();
    }
  }

  /**
   * Hampel filter: Replaces statistical spikes with local median
   */
  applyHampelFilter(raw, linkId) {
    const N = raw.length;
    const clean = new Float32Array(N);
    const buf = this.slidingBuffers[linkId];

    // If not enough history, return copy
    if (buf.length < 5) {
      clean.set(raw);
      return clean;
    }

    for (let k = 0; k < N; k++) {
      const val = raw[k];
      // Collect recent values for subcarrier k
      const vals = [];
      for (let i = Math.max(0, buf.length - CONFIG.DETECTOR.HAMPEL_WINDOW); i < buf.length; i++) {
        vals.push(buf[i][k]);
      }
      vals.push(val);
      vals.sort((a, b) => a - b);

      const median = vals[Math.floor(vals.length / 2)];
      let sumDev = 0;
      for (let i = 0; i < vals.length; i++) {
        sumDev += Math.abs(vals[i] - median);
      }
      const mad = (sumDev / vals.length) || 1e-4;

      if (Math.abs(val - median) > CONFIG.DETECTOR.HAMPEL_THRESHOLD * 1.4826 * mad) {
        clean[k] = median;
      } else {
        clean[k] = val;
      }
    }

    return clean;
  }

  /**
   * Computes motion and presence for a single link
   */
  updateLinkMetrics(linkId) {
    const buf = this.slidingBuffers[linkId];
    if (buf.length < 5) return;

    const N = CONFIG.CSI.SUBCARRIER_COUNT;
    const base = this.baseline[linkId];
    let totalVar = 0.0;
    let totalAmpDev = 0.0;

    for (let k = 0; k < N; k++) {
      // Subcarrier mean and variance over sliding window
      let sum = 0.0;
      for (let i = 0; i < buf.length; i++) {
        sum += buf[i][k];
      }
      const mean = sum / buf.length;

      let sqDiffSum = 0.0;
      for (let i = 0; i < buf.length; i++) {
        const d = buf[i][k] - mean;
        sqDiffSum += d * d;
      }
      const variance = sqDiffSum / buf.length;
      totalVar += Math.sqrt(variance);

      // Presence: deviation from empty-room baseline mean
      totalAmpDev += Math.abs(mean - base.meanAmps[k]);
    }

    const meanStd = totalVar / N;
    const meanDev = totalAmpDev / N;

    // Normalize against calibrated baseline
    const normalizedMotion = meanStd / Math.max(base.meanStd, 1e-4);
    const normalizedPresence = meanDev / Math.max(base.meanStd * 1.2, 1e-4);

    this.linkMetrics[linkId].motion = normalizedMotion;
    this.linkMetrics[linkId].presence = normalizedPresence;
  }

  /**
   * Update overall room motion, presence, and state machine
   */
  updateGlobalState(timestamp) {
    // Weighted max aggregation across active links
    let maxM = 0;
    let maxP = 0;
    const activeLinks = ['RX1', 'RX2', 'RX3'];
    // Include RX4 if it has received data
    if (this.slidingBuffers.RX4.length > 0) activeLinks.push('RX4');

    for (const id of activeLinks) {
      if (this.linkMetrics[id].motion > maxM) maxM = this.linkMetrics[id].motion;
      if (this.linkMetrics[id].presence > maxP) maxP = this.linkMetrics[id].presence;
    }

    // Exponential moving average for stability
    this.globalMotion = this.globalMotion * 0.7 + maxM * 0.3;
    this.globalPresence = this.globalPresence * 0.75 + maxP * 0.25;

    const m = this.globalMotion;
    const p = this.globalPresence;
    const now = timestamp;

    let targetState = 'EMPTY';
    let conf = 0.90;

    // 1. Detect high-energy sudden motion burst (candidate for fall impact)
    if (m >= CONFIG.DETECTOR.FALL_BURST_MIN_MOTION) {
      this.fallBurstDetected = true;
      this.fallBurstTime = now;
      this.fallBurstZone = this.estimatedZone;
      this.stillnessStartTime = 0;
      this.alertTriggered = false;
    }

    // 2. Check for "POSSIBLE_FALL" pattern:
    // Sustained high burst followed by >= 3 seconds of stillness while presence remains elevated in same zone
    if (this.fallBurstDetected) {
      const timeSinceBurst = now - this.fallBurstTime;

      if (timeSinceBurst > 0.4 && timeSinceBurst < 8.0) {
        // Motion has subsided to still
        if (m < CONFIG.DETECTOR.STILL_MAX_MOTION) {
          if (this.stillnessStartTime === 0) {
            this.stillnessStartTime = now;
          }
          const stillnessDuration = now - this.stillnessStartTime;

          // If stillness persisted for >= 3.0 seconds and presence is still high
          if (stillnessDuration >= CONFIG.DETECTOR.FALL_STILLNESS_MIN_SEC && p >= CONFIG.DETECTOR.PRESENCE_THRESHOLD * 0.9) {
            targetState = 'POSSIBLE_FALL';
            conf = Math.min(0.96, CONFIG.DETECTOR.FALL_CONFIDENCE_BASE + (stillnessDuration - 3.0) * 0.03);

            if (!this.alertTriggered) {
              this.alertTriggered = true;
              this.emitFallAlert(this.estimatedZone, conf, timestamp);
            }
          } else {
            targetState = 'PRESENT_STILL';
            conf = 0.85;
          }
        } else {
          // Still moving after burst
          this.stillnessStartTime = 0;
          targetState = 'MOVING';
          conf = Math.min(0.98, 0.7 + m * 0.08);
        }
      } else if (timeSinceBurst >= 8.0) {
        // Burst expired without a sustained fall pattern
        this.fallBurstDetected = false;
      }
    }

    // Normal State Classification if not in possible fall sequence
    if (targetState !== 'POSSIBLE_FALL') {
      if (m >= CONFIG.DETECTOR.MOTION_THRESHOLD) {
        targetState = 'MOVING';
        conf = Math.min(0.98, 0.75 + (m - CONFIG.DETECTOR.MOTION_THRESHOLD) * 0.1);
      } else if (p >= CONFIG.DETECTOR.PRESENCE_THRESHOLD) {
        targetState = 'PRESENT_STILL';
        conf = Math.min(0.95, 0.70 + (p - CONFIG.DETECTOR.PRESENCE_THRESHOLD) * 0.15);
      } else {
        targetState = 'EMPTY';
        conf = Math.max(0.70, 0.98 - m * 0.2 - p * 0.2);
      }
    }

    // State transition with hysteresis
    if (targetState !== this.state) {
      const prevState = this.state;
      this.state = targetState;
      this.confidence = conf;
      this.stateEnterTime = now;
      this.emitStateChange(this.state, prevState);
    } else {
      this.confidence = this.confidence * 0.9 + conf * 0.1;
    }
  }

  /**
   * Estimates zone probability distribution using stored fingerprints and cosine similarity
   */
  estimateZone() {
    if (this.state === 'EMPTY') {
      // Uniform low probability across all zones
      this.zoneProbabilities.fill(1 / 9);
      this.estimatedZone = '--';
      this.multipleMoversLikely = false;
      return;
    }

    // Build live feature vector [m1, m2, m3, m4, p1, p2, p3, p4]
    const liveVec = [
      this.linkMetrics.RX1.motion,
      this.linkMetrics.RX2.motion,
      this.linkMetrics.RX3.motion,
      this.linkMetrics.RX4.motion,
      this.linkMetrics.RX1.presence,
      this.linkMetrics.RX2.presence,
      this.linkMetrics.RX3.presence,
      this.linkMetrics.RX4.presence,
    ];

    const liveMag = Math.hypot(...liveVec) || 1e-4;
    const normLive = liveVec.map(v => v / liveMag);

    const similarities = new Float32Array(9);
    let maxSim = -Infinity;
    let topIdx = 4; // default B2

    for (let i = 0; i < this.zoneNames.length; i++) {
      const zName = this.zoneNames[i];
      const fp = this.fingerprints[zName];
      let dot = 0.0;
      for (let j = 0; j < normLive.length; j++) {
        dot += normLive[j] * (fp[j] || 0.0);
      }
      similarities[i] = dot;
      if (dot > maxSim) {
        maxSim = dot;
        topIdx = i;
      }
    }

    // Softmax with temperature tau = 0.18
    const tau = 0.18;
    let sumExp = 0.0;
    const expSim = new Float32Array(9);
    for (let i = 0; i < 9; i++) {
      expSim[i] = Math.exp((similarities[i] - maxSim) / tau);
      sumExp += expSim[i];
    }

    // Temporal smoothing
    const alpha = CONFIG.DETECTOR.ZONE_SMOOTHING_ALPHA;
    let highProbCount = 0;

    for (let i = 0; i < 9; i++) {
      const instantProb = expSim[i] / sumExp;
      this.zoneProbabilities[i] = this.zoneProbabilities[i] * alpha + instantProb * (1.0 - alpha);
      if (this.zoneProbabilities[i] > CONFIG.DETECTOR.MULTI_MOVER_PROB_THRESHOLD) {
        highProbCount++;
      }
    }

    // Check multiple movers: two or more distinct separated zones have high probability
    this.multipleMoversLikely = highProbCount >= 2;

    // Pick zone with maximum smoothed probability
    let bestProb = -1;
    let bestIdx = 4;
    for (let i = 0; i < 9; i++) {
      if (this.zoneProbabilities[i] > bestProb) {
        bestProb = this.zoneProbabilities[i];
        bestIdx = i;
      }
    }

    this.estimatedZone = this.zoneNames[bestIdx];
  }

  /**
   * Start 6-second empty room calibration
   */
  startCalibration() {
    this.isCalibrating = true;
    this.calibrationStartTime = performance.now() / 1000.0;
    for (const key of this.links) {
      this.calibrationSamples[key] = [];
    }
  }

  finalizeCalibration() {
    this.isCalibrating = false;
    for (const key of this.links) {
      const samples = this.calibrationSamples[key];
      if (samples.length > 5) {
        const N = CONFIG.CSI.SUBCARRIER_COUNT;
        const meanAmps = new Float32Array(N);
        
        for (let k = 0; k < N; k++) {
          let s = 0;
          for (let i = 0; i < samples.length; i++) {
            s += samples[i][k];
          }
          meanAmps[k] = s / samples.length;
        }

        let totalStd = 0;
        for (let k = 0; k < N; k++) {
          let sqDiff = 0;
          for (let i = 0; i < samples.length; i++) {
            const diff = samples[i][k] - meanAmps[k];
            sqDiff += diff * diff;
          }
          totalStd += Math.sqrt(sqDiff / samples.length);
        }

        this.baseline[key].meanAmps.set(meanAmps);
        this.baseline[key].meanStd = Math.max(0.003, totalStd / N);
      }
    }
  }

  emitStateChange(newState, prevState) {
    for (const fn of this.stateListeners) {
      fn(newState, prevState, {
        confidence: this.confidence,
        zone: this.estimatedZone,
        motion: this.globalMotion,
        presence: this.globalPresence
      });
    }
  }

  emitFallAlert(zone, confidence, timestamp) {
    for (const fn of this.fallAlertListeners) {
      fn({
        type: 'possible_fall',
        zone: zone,
        confidence: confidence,
        timestamp: timestamp,
        humanTime: new Date().toLocaleTimeString(),
      });
    }
  }

  reset() {
    this.state = 'EMPTY';
    this.confidence = 0.95;
    this.fallBurstDetected = false;
    this.alertTriggered = false;
    this.zoneProbabilities.fill(1 / 9);
    this.estimatedZone = '--';
    for (const key of this.links) {
      this.slidingBuffers[key] = [];
      this.linkMetrics[key].motion = 0.1;
      this.linkMetrics[key].presence = 0.05;
    }
  }
}
