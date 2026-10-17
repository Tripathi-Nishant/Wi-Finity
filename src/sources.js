/**
 * Wi-Finity Digital Twin - Data Source Abstraction
 * 
 * Defines a unified interface for streaming Wi-Fi CSI data:
 * - SimSource: Consumes live frames from the 3D physics engine (default).
 * - WebSocketSource: Ready to stream live packets from physical ESP32 or Linux CSI tool.
 * - ReplaySource: Plays back recorded CSI sessions from JSON files.
 * 
 * Strict Honesty Rule:
 * The detector and dashboard receive the exact same frame format regardless of source:
 * onFrame(linkId, amplitudeArray, timestamp)
 */

import { CONFIG } from './config.js';

export class BaseSource {
  constructor() {
    this.frameCallbacks = [];
    this.sourceType = 'BASE';
  }

  onFrame(callback) {
    this.frameCallbacks.push(callback);
  }

  emitFrame(linkId, amplitudeArray, timestamp) {
    for (let i = 0; i < this.frameCallbacks.length; i++) {
      this.frameCallbacks[i](linkId, amplitudeArray, timestamp);
    }
  }

  start() {}
  stop() {}
}

/**
 * SimSource: Generates synthetic CSI frames from PhysicsEngine
 */
export class SimSource extends BaseSource {
  constructor(physicsEngine, scene) {
    super();
    this.physics = physicsEngine;
    this.scene = scene; // Only accessed to get avatar positions for physical calculation
    this.sourceType = 'SIMULATION';
    this.timer = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Simulation loop at 30 Hz
    this.timer = setInterval(() => {
      this.tick();
    }, CONFIG.CSI.TICK_INTERVAL_MS);
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  tick() {
    if (!this.isRunning) return;

    // Extract person physical descriptors from 3D scene
    const people = this.scene ? this.scene.getPeoplePhysicalDescriptors() : [];

    // Calculate synthetic CSI amplitudes via PhysicsEngine
    const csiResults = this.physics.tick(people);
    const now = performance.now() / 1000.0;

    // Emit frame for each active receiver link
    for (const linkId in csiResults) {
      this.emitFrame(linkId, csiResults[linkId], now);
    }
  }
}

/**
 * ReplaySource: Plays back pre-recorded CSI packets from JSON log
 */
export class ReplaySource extends BaseSource {
  constructor() {
    super();
    this.sourceType = 'REPLAY';
    this.packets = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.timer = null;
    this.speed = 1.0;
  }

  loadData(jsonData) {
    try {
      this.packets = Array.isArray(jsonData) ? jsonData : jsonData.packets || [];
      this.currentIndex = 0;
      return true;
    } catch (e) {
      console.error('Failed to parse replay data', e);
      return false;
    }
  }

  start() {
    if (this.packets.length === 0 || this.isPlaying) return;
    this.isPlaying = true;

    this.timer = setInterval(() => {
      if (!this.isPlaying || this.currentIndex >= this.packets.length) {
        this.currentIndex = 0; // loop replay
      }
      const pkt = this.packets[this.currentIndex++];
      if (pkt) {
        const amps = new Float32Array(pkt.amplitudes);
        this.emitFrame(pkt.linkId || pkt.link || 'RX1', amps, performance.now() / 1000.0);
      }
    }, CONFIG.CSI.TICK_INTERVAL_MS / this.speed);
  }

  stop() {
    this.isPlaying = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/**
 * WebSocketSource: Stub for physical ESP32 or Linux 802.11n CSI tool stream
 * Connects to ws://localhost:8765/csi
 * Expected JSON packet format:
 * {
 *   "link": "RX1",
 *   "timestamp": 1729170000.123,
 *   "subcarriers": 56,
 *   "amplitudes": [0.42, 0.45, ...]
 * }
 */
export class WebSocketSource extends BaseSource {
  constructor(url = 'ws://localhost:8765/csi') {
    super();
    this.url = url;
    this.sourceType = 'LIVE_HARDWARE';
    this.ws = null;
    this.isConnected = false;
  }

  start() {
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.isConnected = true;
        console.log(`[WebSocketSource] Connected to ${this.url}`);
      };
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.amplitudes) {
            const amps = new Float32Array(data.amplitudes);
            this.emitFrame(data.link || 'RX1', amps, data.timestamp || (performance.now() / 1000.0));
          }
        } catch (err) {
          console.warn('[WebSocketSource] Malformed packet', err);
        }
      };
      this.ws.onerror = (e) => {
        console.warn('[WebSocketSource] WebSocket error or offline:', e);
      };
      this.ws.onclose = () => {
        this.isConnected = false;
      };
    } catch (e) {
      console.warn('[WebSocketSource] Could not connect to hardware websocket:', e);
    }
  }

  stop() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}
