/**
 * Wi-Finity Digital Twin - Physics Engine (Synthetic Wi-Fi CSI Generator)
 * 
 * Computes Channel State Information (CSI) for 56 OFDM subcarriers across
 * all active TX-RX links using a multi-path ray model (direct path, image-source
 * specular reflections from walls/floor/ceiling, and human dynamic scatterers).
 * 
 * IMPORTANT HONESTY NOTE:
 * This is an explainable multi-path physics simulation, not a full commercial electromagnetic
 * ray-tracer. It captures the real-world phase-interference principles of Wi-Fi CSI
 * (constructive/destructive interference, wavelength sensitivity, multipath ripples).
 */

import { CONFIG } from './config.js';

export class PhysicsEngine {
  constructor() {
    this.noiseLevel = CONFIG.PHYSICS.DEFAULT_NOISE_LEVEL;
    this.wallAttenuationDb = 12.0; // dB
    this.useConcreteWall = false;
    this.useCurtain = true;
    this.interferenceActive = false;
    this.useRx4 = false;

    // Simulation time in seconds
    this.simTime = 0;
    this.tickCount = 0;

    // Pre-calculate subcarrier frequencies
    this.subcarrierFreqs = new Float64Array(CONFIG.CSI.SUBCARRIER_COUNT);
    const f0 = CONFIG.CSI.CARRIER_FREQ;
    const df = CONFIG.CSI.SUBCARRIER_SPACING;
    for (let k = 0; k < CONFIG.CSI.SUBCARRIER_COUNT; k++) {
      // Subcarrier indices centered around DC
      this.subcarrierFreqs[k] = f0 + (k - 27.5) * df;
    }

    // Pre-allocate output buffers for 4 links
    this.linkBuffers = {
      RX1: new Float32Array(CONFIG.CSI.SUBCARRIER_COUNT),
      RX2: new Float32Array(CONFIG.CSI.SUBCARRIER_COUNT),
      RX3: new Float32Array(CONFIG.CSI.SUBCARRIER_COUNT),
      RX4: new Float32Array(CONFIG.CSI.SUBCARRIER_COUNT),
    };

    // Keep an empty-room reference snapshot for comparison & baseline
    this.emptyRoomBaseline = {
      RX1: new Float32Array(CONFIG.CSI.SUBCARRIER_COUNT),
      RX2: new Float32Array(CONFIG.CSI.SUBCARRIER_COUNT),
      RX3: new Float32Array(CONFIG.CSI.SUBCARRIER_COUNT),
      RX4: new Float32Array(CONFIG.CSI.SUBCARRIER_COUNT),
    };

    // Compute initial empty room baseline
    this.computeBaseline();
  }

  /**
   * Computes baseline empty-room CSI (no people present)
   */
  computeBaseline() {
    const rxKeys = ['RX1', 'RX2', 'RX3', 'RX4'];
    for (const rxKey of rxKeys) {
      const rxNode = CONFIG.NODES[rxKey];
      const amps = this.calculateLinkAmplitudes(CONFIG.NODES.TX, rxNode, [], false);
      this.emptyRoomBaseline[rxKey].set(amps);
    }
  }

  /**
   * Advance simulation by one tick (e.g. 1/30 s)
   * @param {Array} people - Array of human avatar descriptors: [{ id, x, y, z, state, radius, speed }]
   * @returns {Object} { RX1: Float32Array(56), RX2, RX3, (RX4) }
   */
  tick(people = []) {
    const dt = 1.0 / CONFIG.CSI.TICK_RATE_HZ;
    this.simTime += dt;
    this.tickCount++;

    const results = {};
    const rxKeys = this.useRx4 ? ['RX1', 'RX2', 'RX3', 'RX4'] : ['RX1', 'RX2', 'RX3'];

    for (const rxKey of rxKeys) {
      const rxNode = CONFIG.NODES[rxKey];
      const buffer = this.linkBuffers[rxKey];
      
      const rawAmps = this.calculateLinkAmplitudes(CONFIG.NODES.TX, rxNode, people, true);
      buffer.set(rawAmps);
      results[rxKey] = buffer;
    }

    return results;
  }

  /**
   * Multi-path CSI calculation for a single TX -> RX link
   */
  calculateLinkAmplitudes(tx, rx, people, applyNoise = true) {
    const N = CONFIG.CSI.SUBCARRIER_COUNT;
    const c = CONFIG.CSI.SPEED_OF_LIGHT;
    const amps = new Float32Array(N);

    // Dynamic packet gain jitter (models Wi-Fi hardware AGC fluctuations)
    const gainJitter = applyNoise ? (1.0 + (Math.random() - 0.5) * CONFIG.PHYSICS.PACKET_GAIN_JITTER) : 1.0;

    // Collect all multi-path components: { dist, amp }
    const paths = [];

    // 1. Direct Line-of-Sight (LOS) Path
    const dDirect = Math.hypot(rx.x - tx.x, rx.y - tx.y, rx.z - tx.z);
    let directAtten = 1.0;

    // Check if direct line crosses curtain partition (located around x = 0.5, z between 0 and 2.25)
    if (this.useCurtain && this.segmentIntersectsCurtain(tx, rx)) {
      directAtten *= CONFIG.PHYSICS.CURTAIN_THROUGH_ATTEN;
    }

    // Direct path amplitude falls off with distance
    paths.push({
      dist: dDirect,
      amp: (1.0 / Math.max(dDirect, 0.5)) * directAtten
    });

    // 2. Static Multipath: First-order wall/ceiling/floor reflections (Image Method)
    const halfL = CONFIG.ROOM.LENGTH / 2; // 3.0
    const halfW = CONFIG.ROOM.WIDTH / 2;  // 2.25
    const H = CONFIG.ROOM.HEIGHT;         // 2.7

    const wallReflectivity = this.useConcreteWall ? CONFIG.PHYSICS.CONCRETE_REFLECTIVITY : CONFIG.PHYSICS.DRYWALL_REFLECTIVITY;
    const floorReflectivity = CONFIG.PHYSICS.FLOOR_REFLECTIVITY;
    const ceilingReflectivity = CONFIG.PHYSICS.CEILING_REFLECTIVITY;

    // Mirror TX coordinates for each boundary
    const imageSources = [
      // Left wall (x = -halfL)
      { x: -2 * halfL - tx.x, y: tx.y, z: tx.z, r: wallReflectivity },
      // Right wall (x = +halfL)
      { x: 2 * halfL - tx.x, y: tx.y, z: tx.z, r: wallReflectivity },
      // Front wall (z = -halfW)
      { x: tx.x, y: tx.y, z: -2 * halfW - tx.z, r: wallReflectivity },
      // Back wall (z = +halfW) - if concrete, higher reflection
      { x: tx.x, y: tx.y, z: 2 * halfW - tx.z, r: this.useConcreteWall ? 0.75 : wallReflectivity },
      // Floor (y = 0)
      { x: tx.x, y: -tx.y, z: tx.z, r: floorReflectivity },
      // Ceiling (y = H)
      { x: tx.x, y: 2 * H - tx.y, z: tx.z, r: ceilingReflectivity },
    ];

    for (const img of imageSources) {
      const dBounce = Math.hypot(rx.x - img.x, rx.y - img.y, rx.z - img.z);
      paths.push({
        dist: dBounce,
        amp: (img.r / Math.max(dBounce, 0.8))
      });
    }

    // 3. Dynamic Human Scatterers (Reflected paths via each person)
    for (const p of people) {
      if (!p || p.active === false) continue;

      // Effective scattering center based on activity
      let scatterY = p.y !== undefined ? p.y + 0.9 : 1.0;
      let personReflectivity = CONFIG.PHYSICS.PERSON_REFLECTIVITY;

      if (p.activity === 'lying' || p.activity === 'fallen') {
        scatterY = 0.28; // closer to floor
        personReflectivity *= 1.15; // wider body orientation
      } else if (p.activity === 'sitting') {
        scatterY = 0.65;
      }

      // Distance from TX to person and from person to RX
      const dTxToPerson = Math.hypot(p.x - tx.x, scatterY - tx.y, p.z - tx.z);
      const dPersonToRx = Math.hypot(rx.x - p.x, rx.y - scatterY, rx.z - p.z);
      const dTotalPerson = dTxToPerson + dPersonToRx;

      // Check curtain attenuation for person paths
      let personAtten = 1.0;
      if (this.useCurtain) {
        if (this.segmentIntersectsCurtain(tx, { x: p.x, y: scatterY, z: p.z })) {
          personAtten *= CONFIG.PHYSICS.CURTAIN_THROUGH_ATTEN;
        }
        if (this.segmentIntersectsCurtain({ x: p.x, y: scatterY, z: p.z }, rx)) {
          personAtten *= CONFIG.PHYSICS.CURTAIN_THROUGH_ATTEN;
        }
      }

      // Dynamic path amplitude
      const pathAmp = (personReflectivity / Math.sqrt(Math.max(dTxToPerson * dPersonToRx, 0.2))) * personAtten;

      paths.push({
        dist: dTotalPerson,
        amp: pathAmp
      });
    }

    // Evaluate sum of phasors for each subcarrier frequency
    // H(f) = sum_p [ (amp_p) * exp(-j * 2 * pi * f * d_p / c) ]
    const twoPiOverC = (2.0 * Math.PI) / c;
    
    // Slow hardware oscillator drift
    const driftPhase = CONFIG.PHYSICS.DRIFT_RATE * Math.sin(this.simTime * 0.2);

    for (let k = 0; k < N; k++) {
      const f = this.subcarrierFreqs[k];
      let realSum = 0.0;
      let imagSum = 0.0;

      for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        const phase = (twoPiOverC * f * p.dist) + driftPhase;
        realSum += p.amp * Math.cos(phase);
        imagSum -= p.amp * Math.sin(phase);
      }

      // Subcarrier amplitude = magnitude of complex channel response
      let magnitude = Math.hypot(realSum, imagSum) * gainJitter;

      // Add Gaussian noise
      if (applyNoise) {
        // Box-Muller transform for Gaussian noise
        const u1 = Math.max(1e-6, Math.random());
        const u2 = Math.random();
        const randG = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        magnitude += randG * this.noiseLevel;

        // Bursty interference spike (sporadic wideband/narrowband noise)
        if (this.interferenceActive && Math.random() < CONFIG.PHYSICS.INTERFERENCE_BURST_PROB) {
          magnitude += (Math.random() - 0.3) * CONFIG.PHYSICS.INTERFERENCE_AMPLITUDE;
        }
      }

      amps[k] = Math.max(0.001, magnitude);
    }

    return amps;
  }

  /**
   * Helper: checks if a 2D line segment between point A and point B intersects the partition curtain
   * Curtain is positioned at x = 0.6, from z = 0.2 to z = 2.1
   */
  segmentIntersectsCurtain(a, b) {
    const xCurt = 0.6;
    const zMin = 0.2;
    const zMax = 2.1;

    // Does segment cross x = xCurt?
    if ((a.x < xCurt && b.x > xCurt) || (a.x > xCurt && b.x < xCurt)) {
      const t = (xCurt - a.x) / (b.x - a.x);
      const zInter = a.z + t * (b.z - a.z);
      if (zInter >= zMin && zInter <= zMax) {
        return true;
      }
    }
    return false;
  }

  // Parameter Setters
  setNoiseLevel(val) {
    this.noiseLevel = Math.max(0.001, Math.min(0.12, parseFloat(val)));
  }

  setConcreteWall(enabled) {
    this.useConcreteWall = !!enabled;
  }

  setCurtain(enabled) {
    this.useCurtain = !!enabled;
  }

  setInterference(enabled) {
    this.interferenceActive = !!enabled;
  }

  setUseRx4(enabled) {
    this.useRx4 = !!enabled;
  }
}
