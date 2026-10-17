/**
 * Wi-Finity Digital Twin - Command Center Dashboard
 * 
 * Manages all 9 telemetry panels:
 * 1. Status Hero Card (State, confidence, zone, multi-mover badge, synthetic CSI label)
 * 2. Top-down Radar Map (3x3 zone heatmap, nodes, dynamic links)
 * 3. Per-Link Waterfall Spectrogram (56 subcarriers x time)
 * 4. Live Subcarrier Amplitude Spectrum (Current vs Empty-room baseline)
 * 5. Motion & Presence Scrolling Timeline (with threshold lines and shaded events)
 * 6. Ground Truth vs Estimate (Honest comparison with rolling accuracy %)
 * 7. Alerts Panel (Banner, simulated mobile push notification card, webhook dispatcher)
 * 8. Event Log (Timestamped telemetry events)
 * 9. Controls (Calibrate, Survey, Noise, Attenuation, Interference, Node count)
 */

import { CONFIG } from './config.js';

export class DashboardManager {
  constructor(options = {}) {
    this.detector = options.detector;
    this.physics = options.physics;
    this.scene = options.scene;
    this.audio = options.audio;

    // Active waterfall link tab
    this.activeWaterfallLink = 'RX1';

    // Rolling timeline history (last 160 frames @ 30fps = ~5.3 seconds)
    this.timelineHistory = [];
    this.maxTimelineSamples = 160;

    // Waterfall history buffer: array of Float32Array(56)
    this.waterfallBuffers = {
      RX1: [],
      RX2: [],
      RX3: [],
      RX4: [],
    };
    this.maxWaterfallRows = 65;

    // Rolling ground-truth accuracy tracker (last 80 frames)
    this.accuracyWindow = [];
    this.maxAccuracySamples = 80;
    this.rollingAccuracyPct = 100;

    // Webhook configuration
    this.webhookUrl = CONFIG.ALERT.WEBHOOK_URL || '';
    this.apiKey = CONFIG.ALERT.API_KEY || '';
    this.lastWebhookTime = 0;

    // Bind DOM Elements
    this.initElements();
    this.setupEventListeners();

    // Register detector callbacks
    this.detector.onStateChange((newState, prevState, data) => {
      this.onDetectorStateChange(newState, prevState, data);
    });

    this.detector.onFallAlert((alertData) => {
      this.onFallAlertTriggered(alertData);
    });

    // Initial event log
    this.logEvent('Wi-Finity system initialized. Synthetic CSI pipeline streaming at 30 Hz.');
  }

  initElements() {
    // 1. Status Hero Card
    this.elStateBadge = document.getElementById('hero-state-badge');
    this.elStateLabel = document.getElementById('hero-state-label');
    this.elStateConfidence = document.getElementById('hero-confidence');
    this.elStateZone = document.getElementById('hero-zone');
    this.elMultiMoverBadge = document.getElementById('hero-multimover-badge');

    // 2. Radar Map Canvas
    this.canvasRadar = document.getElementById('canvas-radar');
    this.ctxRadar = this.canvasRadar ? this.canvasRadar.getContext('2d') : null;

    // 3. Waterfall Canvas
    this.canvasWaterfall = document.getElementById('canvas-waterfall');
    this.ctxWaterfall = this.canvasWaterfall ? this.canvasWaterfall.getContext('2d') : null;

    // 4. Subcarrier Amplitude Spectrum Canvas
    this.canvasSpectrum = document.getElementById('canvas-spectrum');
    this.ctxSpectrum = this.canvasSpectrum ? this.canvasSpectrum.getContext('2d') : null;

    // 5. Motion/Presence Timeline Canvas
    this.canvasTimeline = document.getElementById('canvas-timeline');
    this.ctxTimeline = this.canvasTimeline ? this.canvasTimeline.getContext('2d') : null;

    // 6. Ground Truth vs Estimate
    this.elGtPeople = document.getElementById('gt-people-count');
    this.elGtZone = document.getElementById('gt-zone');
    this.elGtActivity = document.getElementById('gt-activity');
    this.elEstZone = document.getElementById('est-zone');
    this.elEstState = document.getElementById('est-state');
    this.elAccuracyValue = document.getElementById('accuracy-value');
    this.elMatchStatus = document.getElementById('match-status-badge');

    // 7. Alerts Card & Simulated Phone
    this.elAlertBanner = document.getElementById('fall-alert-banner');
    this.elPhoneCard = document.getElementById('simulated-phone-card');
    this.elPhoneZone = document.getElementById('phone-alert-zone');
    this.elPhoneTime = document.getElementById('phone-alert-time');
    this.elWebhookStatus = document.getElementById('webhook-status-badge');

    // 8. Event Log
    this.elEventList = document.getElementById('event-log-list');

    // 9. Controls
    this.sliderNoise = document.getElementById('slider-noise');
    this.labelNoise = document.getElementById('val-noise');
    this.sliderAtten = document.getElementById('slider-atten');
    this.labelAtten = document.getElementById('val-atten');
    this.toggleInterference = document.getElementById('toggle-interference');
    this.toggleRx4 = document.getElementById('toggle-rx4');
    this.btnCalibrate = document.getElementById('btn-calibrate');
    this.btnSurvey = document.getElementById('btn-survey');
    this.btnReset = document.getElementById('btn-reset');
  }

  setupEventListeners() {
    // Waterfall tab selector
    const tabs = document.querySelectorAll('.waterfall-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeWaterfallLink = tab.dataset.link || 'RX1';
      });
    });

    // Dashboard View Filter Tabs
    const viewTabs = document.querySelectorAll('.dash-view-tab');
    viewTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        viewTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const view = tab.dataset.view;
        this.filterDashboardCards(view);
      });
    });

    // Noise Slider
    if (this.sliderNoise) {
      this.sliderNoise.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (this.labelNoise) this.labelNoise.textContent = `${(val * 100).toFixed(0)}%`;
        this.physics.setNoiseLevel(val);
      });
    }

    // Attenuation Slider
    if (this.sliderAtten) {
      this.sliderAtten.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (this.labelAtten) this.labelAtten.textContent = `${val} dB`;
        this.physics.wallAttenuationDb = val;
      });
    }

    // Interference Toggle
    if (this.toggleInterference) {
      this.toggleInterference.addEventListener('change', (e) => {
        const checked = e.target.checked;
        this.physics.setInterference(checked);
        this.logEvent(`Bursty 2.4GHz RF interference ${checked ? 'ENABLED' : 'DISABLED'}`);
      });
    }

    // 4th Receiver Toggle (RX4)
    if (this.toggleRx4) {
      this.toggleRx4.addEventListener('change', (e) => {
        const checked = e.target.checked;
        this.physics.setUseRx4(checked);
        this.scene.setRx4Visible(checked);
        const tabRx4 = document.querySelector('.waterfall-tab[data-link="RX4"]');
        if (tabRx4) tabRx4.style.display = checked ? 'inline-block' : 'none';
        this.logEvent(`4th Receiver Puck (RX4 center wall) ${checked ? 'ACTIVATED' : 'DEACTIVATED'}`);
      });
    }

    // Calibrate Empty Room Button
    if (this.btnCalibrate) {
      this.btnCalibrate.addEventListener('click', () => {
        this.triggerCalibration();
      });
    }

    // Site Survey Button
    if (this.btnSurvey) {
      this.btnSurvey.addEventListener('click', () => {
        this.triggerSiteSurvey();
      });
    }

    // Reset Button
    if (this.btnReset) {
      this.btnReset.addEventListener('click', () => {
        this.detector.reset();
        this.timelineHistory = [];
        this.accuracyWindow = [];
        this.dismissAlert();
        this.logEvent('Baseline & detector statistics reset.');
      });
    }

    // Dismiss Alert button
    const btnDismissAlert = document.getElementById('btn-dismiss-alert');
    if (btnDismissAlert) {
      btnDismissAlert.addEventListener('click', () => this.dismissAlert());
    }
  }

  filterDashboardCards(view) {
    const cards = document.querySelectorAll('.dashboard-card');
    cards.forEach(card => {
      const cardType = card.dataset.category;
      if (view === 'all') {
        card.style.display = 'flex';
      } else if (view === 'overview') {
        if (cardType === 'overview' || cardType === 'radar' || cardType === 'gt' || cardType === 'alerts') {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      } else if (view === 'signals') {
        if (cardType === 'waterfall' || cardType === 'spectrum' || cardType === 'timeline' || cardType === 'controls') {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      }
    });
  }

  update(timestamp) {
    this.updateStatusHero();
    this.recordTimelineData(timestamp);
    this.recordWaterfallData();

    this.renderRadar();
    this.renderWaterfall();
    this.renderSpectrum();
    this.renderTimeline();

    this.updateGroundTruthComparison();

    // Link beams dynamic pulsation
    const links = ['RX1', 'RX2', 'RX3', 'RX4'];
    for (const key of links) {
      const metric = this.detector.linkMetrics[key];
      if (metric) {
        this.scene.setLinkDisturbance(key, metric.motion);
      }
    }

    // 3D Floor Heatmap update
    this.scene.updateFloorHeat(this.detector.zoneProbabilities);
  }

  updateStatusHero() {
    const state = this.detector.state;
    const conf = Math.round(this.detector.confidence * 100);
    const zone = this.detector.estimatedZone;

    if (this.elStateLabel) {
      this.elStateLabel.textContent = state.replace('_', ' ');
    }
    if (this.elStateConfidence) {
      this.elStateConfidence.textContent = `${conf}%`;
    }
    if (this.elStateZone) {
      this.elStateZone.textContent = zone === '--' ? 'Zone: --' : `Zone ${zone}`;
    }

    if (this.elMultiMoverBadge) {
      this.elMultiMoverBadge.style.display = this.detector.multipleMoversLikely ? 'inline-flex' : 'none';
    }

    const heroCard = document.getElementById('panel-hero-status');
    if (heroCard) {
      heroCard.className = `dashboard-card hero-card state-${state.toLowerCase()}`;
    }
  }

  recordTimelineData(timestamp) {
    this.timelineHistory.push({
      time: timestamp,
      motion: this.detector.globalMotion,
      presence: this.detector.globalPresence,
      state: this.detector.state,
    });
    if (this.timelineHistory.length > this.maxTimelineSamples) {
      this.timelineHistory.shift();
    }
  }

  recordWaterfallData() {
    const links = ['RX1', 'RX2', 'RX3', 'RX4'];
    for (const k of links) {
      const amps = this.detector.linkMetrics[k].currentAmps;
      const buf = this.waterfallBuffers[k];
      buf.push(new Float32Array(amps));
      if (buf.length > this.maxWaterfallRows) {
        buf.shift();
      }
    }
  }

  /**
   * Top-Down Radar Map (3x3 Room Grid, Nodes, Links, Heatmap)
   */
  renderRadar() {
    if (!this.ctxRadar) return;
    const ctx = this.ctxRadar;
    const w = this.canvasRadar.width;
    const h = this.canvasRadar.height;

    ctx.clearRect(0, 0, w, h);

    // High-tech dark background with subtle grid
    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, w, h);

    const padX = 28;
    const padY = 24;
    const roomW = w - padX * 2;
    const roomH = h - padY * 2;

    const toCanvasX = (rx) => padX + ((rx + 3.0) / 6.0) * roomW;
    const toCanvasY = (rz) => padY + ((rz + 2.25) / 4.5) * roomH;

    // 3x3 Zones
    const colW = roomW / 3;
    const rowH = roomH / 3;
    const zoneNames = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
    let zIdx = 0;

    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        const zName = zoneNames[zIdx];
        const prob = this.detector.zoneProbabilities[zIdx++] || 0;
        const x = padX + c * colW;
        const y = padY + r * rowH;

        // Dynamic zone heat fill
        if (prob > 0.35) {
          ctx.fillStyle = `rgba(236, 72, 153, ${Math.min(0.75, 0.2 + prob * 0.7)})`;
        } else {
          ctx.fillStyle = `rgba(0, 240, 255, ${Math.max(0.04, prob * 0.45)})`;
        }
        ctx.fillRect(x + 1.5, y + 1.5, colW - 3, rowH - 3);

        // Zone borders
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, colW, rowH);

        // Zone Name
        ctx.fillStyle = prob > 0.35 ? '#ffffff' : '#94a3b8';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(zName, x + 8, y + 18);

        // Probability percentage
        if (this.detector.state !== 'EMPTY') {
          ctx.font = 'bold 11px monospace';
          ctx.fillStyle = prob > 0.35 ? '#ffffff' : '#38bdf8';
          ctx.textAlign = 'right';
          ctx.fillText(`${(prob * 100).toFixed(0)}%`, x + colW - 8, y + rowH - 8);
        }
      }
    }

    // Outer Room Border
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 2;
    ctx.strokeRect(padX, padY, roomW, roomH);

    // TX coordinates
    const tx = CONFIG.NODES.TX;
    const txX = toCanvasX(tx.x);
    const txY = toCanvasY(tx.z);

    // Links
    const rxList = this.physics.useRx4 ? ['RX1', 'RX2', 'RX3', 'RX4'] : ['RX1', 'RX2', 'RX3'];
    for (const rxKey of rxList) {
      const rx = CONFIG.NODES[rxKey];
      const rxX = toCanvasX(rx.x);
      const rxY = toCanvasY(rx.z);

      const metric = this.detector.linkMetrics[rxKey];
      const isDisturbed = metric && metric.motion > 1.8;

      ctx.beginPath();
      ctx.moveTo(txX, txY);
      ctx.lineTo(rxX, rxY);
      ctx.strokeStyle = isDisturbed ? 'rgba(236, 72, 153, 0.95)' : (rxKey === 'RX4' ? 'rgba(251, 191, 36, 0.8)' : 'rgba(0, 240, 255, 0.6)');
      ctx.lineWidth = isDisturbed ? 3.0 : 1.5;
      ctx.stroke();
    }

    // Draw TX Router Node
    ctx.beginPath();
    ctx.arc(txX, txY, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#00f0ff';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TX AP', txX, txY - 12);

    // Draw RX Sensor Pucks
    for (const rxKey of rxList) {
      const rx = CONFIG.NODES[rxKey];
      const rxX = toCanvasX(rx.x);
      const rxY = toCanvasY(rx.z);

      ctx.beginPath();
      ctx.arc(rxX, rxY, 7.5, 0, Math.PI * 2);
      ctx.fillStyle = rxKey === 'RX4' ? '#fbbf24' : '#10b981';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(rxKey, rxX, rxY + 18);
    }

    // Estimated Zone Target Reticle
    if (this.detector.state !== 'EMPTY' && this.detector.estimatedZone !== '--') {
      const colLetter = this.detector.estimatedZone[0];
      const rowNum = parseInt(this.detector.estimatedZone[1], 10);
      const c = colLetter === 'A' ? 0 : colLetter === 'B' ? 1 : 2;
      const r = rowNum - 1;
      const targetCenterX = padX + c * colW + colW / 2;
      const targetCenterY = padY + r * rowH + rowH / 2;

      ctx.beginPath();
      ctx.arc(targetCenterX, targetCenterY, 22, 0, Math.PI * 2);
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(targetCenterX - 28, targetCenterY);
      ctx.lineTo(targetCenterX + 28, targetCenterY);
      ctx.moveTo(targetCenterX, targetCenterY - 28);
      ctx.lineTo(targetCenterX, targetCenterY + 28);
      ctx.strokeStyle = 'rgba(236, 72, 153, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#ec4899';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ESTIMATED TARGET', targetCenterX, targetCenterY - 26);
    }
  }

  /**
   * Per-Link Waterfall Spectrogram (Time x 56 Subcarriers)
   */
  renderWaterfall() {
    if (!this.ctxWaterfall) return;
    const ctx = this.ctxWaterfall;
    const w = this.canvasWaterfall.width;
    const h = this.canvasWaterfall.height;

    ctx.clearRect(0, 0, w, h);

    const buf = this.waterfallBuffers[this.activeWaterfallLink] || [];
    if (buf.length === 0) {
      ctx.fillStyle = '#060a14';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Waiting for ${this.activeWaterfallLink} CSI subcarrier stream...`, w / 2, h / 2);
      return;
    }

    const rows = buf.length;
    const cols = CONFIG.CSI.SUBCARRIER_COUNT; // 56
    const cellW = w / cols;
    const cellH = h / this.maxWaterfallRows;

    for (let r = 0; r < rows; r++) {
      const rowAmps = buf[r];
      const y = h - (rows - r) * cellH;

      for (let c = 0; c < cols; c++) {
        const val = rowAmps[c];
        const norm = Math.max(0, Math.min(1.0, (val - 0.1) / 0.55));
        ctx.fillStyle = this.getTurboHeatmapColor(norm);
        ctx.fillRect(c * cellW, y, cellW + 0.6, cellH + 0.6);
      }
    }

    // Top header axis
    ctx.fillStyle = 'rgba(10, 16, 29, 0.85)';
    ctx.fillRect(0, 0, w, 20);
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('◄ Sc 1 (2.420 GHz)', 8, 14);
    ctx.textAlign = 'right';
    ctx.fillText('Sc 56 (2.454 GHz) ►', w - 8, 14);
  }

  /**
   * High-contrast vibrant Turbo Colormap
   */
  getTurboHeatmapColor(t) {
    if (t < 0.25) {
      const k = t / 0.25;
      return `rgb(6, ${Math.round(25 + 110 * k)}, ${Math.round(80 + 160 * k)})`;
    } else if (t < 0.55) {
      const k = (t - 0.25) / 0.30;
      return `rgb(${Math.round(0 + 120 * k)}, ${Math.round(210 + 45 * k)}, ${Math.round(240 - 150 * k)})`;
    } else if (t < 0.80) {
      const k = (t - 0.55) / 0.25;
      return `rgb(${Math.round(180 + 75 * k)}, ${Math.round(240 - 100 * k)}, 30)`;
    } else {
      const k = (t - 0.80) / 0.20;
      return `rgb(245, ${Math.round(110 - 70 * k)}, ${Math.round(40 + 70 * k)})`;
    }
  }

  /**
   * Live Subcarrier Amplitude Spectrum Chart
   */
  renderSpectrum() {
    if (!this.ctxSpectrum) return;
    const ctx = this.ctxSpectrum;
    const w = this.canvasSpectrum.width;
    const h = this.canvasSpectrum.height;

    ctx.clearRect(0, 0, w, h);

    // Deep dark background
    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, w, h);

    const padLeft = 38;
    const padRight = 14;
    const padBottom = 26;
    const padTop = 22;
    const chartW = w - padLeft - padRight;
    const chartH = h - padTop - padBottom;

    // Grid lines
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = padTop + (chartH / 4) * g;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      const ampVal = (0.8 - g * 0.2).toFixed(1);
      ctx.fillText(ampVal, padLeft - 6, y + 3);
    }

    const currentAmps = this.detector.linkMetrics[this.activeWaterfallLink].currentAmps;
    const baseAmps = this.detector.baseline[this.activeWaterfallLink].meanAmps;
    const N = CONFIG.CSI.SUBCARRIER_COUNT;

    // 1. Draw Baseline Curve (Dashed Silver)
    ctx.beginPath();
    ctx.strokeStyle = '#94a3b8';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.8;
    for (let k = 0; k < N; k++) {
      const x = padLeft + (k / (N - 1)) * chartW;
      const y = padTop + chartH - (baseAmps[k] / 0.8) * chartH;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Draw Live CSI Curve (Solid Neon Cyan or Magenta if disturbed)
    const isDisturbed = this.detector.linkMetrics[this.activeWaterfallLink].motion > 1.8;
    ctx.beginPath();
    ctx.strokeStyle = isDisturbed ? '#ec4899' : '#00f0ff';
    ctx.lineWidth = 2.4;
    for (let k = 0; k < N; k++) {
      const x = padLeft + (k / (N - 1)) * chartW;
      const y = padTop + chartH - (currentAmps[k] / 0.8) * chartH;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill under curve
    ctx.lineTo(padLeft + chartW, padTop + chartH);
    ctx.lineTo(padLeft, padTop + chartH);
    ctx.closePath();
    ctx.fillStyle = isDisturbed ? 'rgba(236, 72, 153, 0.25)' : 'rgba(0, 240, 255, 0.2)';
    ctx.fill();

    // Chart Legend
    ctx.textAlign = 'left';
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('-- Baseline (Empty)', padLeft + 8, padTop - 7);
    ctx.fillStyle = isDisturbed ? '#ec4899' : '#00f0ff';
    ctx.fillText('— Live CSI Response', padLeft + 150, padTop - 7);

    // X axis label
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('56 Subcarriers (20 MHz Channel)', padLeft + chartW / 2, h - 6);
  }

  /**
   * Motion and Presence Scrolling Timeline
   */
  renderTimeline() {
    if (!this.ctxTimeline) return;
    const ctx = this.ctxTimeline;
    const w = this.canvasTimeline.width;
    const h = this.canvasTimeline.height;

    ctx.clearRect(0, 0, w, h);

    // Deep dark background
    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, w, h);

    const padLeft = 38;
    const padRight = 14;
    const padTop = 22;
    const padBottom = 22;
    const chartW = w - padLeft - padRight;
    const chartH = h - padTop - padBottom;

    if (this.timelineHistory.length < 2) return;

    // Threshold lines
    const maxScore = 5.0;
    const mThreshY = padTop + chartH - (CONFIG.DETECTOR.MOTION_THRESHOLD / maxScore) * chartH;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.7)';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.2;
    ctx.moveTo(padLeft, mThreshY);
    ctx.lineTo(w - padRight, mThreshY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('MOTION THRESH (1.85)', w - padRight - 6, mThreshY - 4);

    const count = this.timelineHistory.length;

    // Motion Line (Amber/Coral)
    ctx.beginPath();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.2;
    for (let i = 0; i < count; i++) {
      const d = this.timelineHistory[i];
      const x = padLeft + (i / (this.maxTimelineSamples - 1)) * chartW;
      const y = padTop + chartH - Math.min(1.0, d.motion / maxScore) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Presence Line (Cyan)
    ctx.beginPath();
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.8;
    for (let i = 0; i < count; i++) {
      const d = this.timelineHistory[i];
      const x = padLeft + (i / (this.maxTimelineSamples - 1)) * chartW;
      const y = padTop + chartH - Math.min(1.0, d.presence / maxScore) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Legend
    ctx.textAlign = 'left';
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('— Motion Variance', padLeft + 6, padTop - 7);
    ctx.fillStyle = '#00f0ff';
    ctx.fillText('— DC Presence Shift', padLeft + 140, padTop - 7);
  }

  updateGroundTruthComparison() {
    const gt = this.scene.getGroundTruth();
    const estZone = this.detector.estimatedZone;
    const estState = this.detector.state;

    if (this.elGtPeople) this.elGtPeople.textContent = gt.peopleCount;
    if (this.elGtZone) this.elGtZone.textContent = gt.primaryZone;
    if (this.elGtActivity) this.elGtActivity.textContent = gt.primaryActivity.toUpperCase();
    if (this.elEstZone) this.elEstZone.textContent = estZone;
    if (this.elEstState) this.elEstState.textContent = estState.replace('_', ' ');

    let isMatch = false;
    if (gt.peopleCount === 0 && estState === 'EMPTY') {
      isMatch = true;
    } else if (gt.peopleCount > 0 && gt.primaryZone === estZone) {
      isMatch = true;
    }

    this.accuracyWindow.push(isMatch ? 1 : 0);
    if (this.accuracyWindow.length > this.maxAccuracySamples) {
      this.accuracyWindow.shift();
    }

    const matches = this.accuracyWindow.reduce((a, b) => a + b, 0);
    this.rollingAccuracyPct = Math.round((matches / this.accuracyWindow.length) * 100);

    if (this.elAccuracyValue) {
      this.elAccuracyValue.textContent = `${this.rollingAccuracyPct}%`;
      if (this.rollingAccuracyPct >= 80) {
        this.elAccuracyValue.style.color = '#10b981';
      } else if (this.rollingAccuracyPct >= 50) {
        this.elAccuracyValue.style.color = '#f59e0b';
      } else {
        this.elAccuracyValue.style.color = '#ef4444';
      }
    }

    if (this.elMatchStatus) {
      if (isMatch) {
        this.elMatchStatus.textContent = 'MATCH';
        this.elMatchStatus.className = 'status-tag tag-match';
      } else {
        this.elMatchStatus.textContent = this.detector.state === 'EMPTY' ? 'SEARCHING' : 'MISMATCH';
        this.elMatchStatus.className = 'status-tag tag-mismatch';
      }
    }
  }

  onDetectorStateChange(newState, prevState, data) {
    this.logEvent(`State changed: ${prevState} -> ${newState} (Zone: ${data.zone || '--'}, Conf: ${Math.round(data.confidence * 100)}%)`);
  }

  onFallAlertTriggered(alertData) {
    this.logEvent(`⚠️ POSSIBLE FALL PATTERN in Zone ${alertData.zone} (Confidence: ${Math.round(alertData.confidence * 100)}%)`);

    if (this.audio) {
      this.audio.playFallAlert();
    }

    if (this.elAlertBanner) {
      this.elAlertBanner.classList.add('visible');
    }
    if (this.elPhoneCard) {
      this.elPhoneCard.classList.add('visible');
    }
    if (this.elPhoneZone) {
      this.elPhoneZone.textContent = alertData.zone;
    }
    if (this.elPhoneTime) {
      this.elPhoneTime.textContent = alertData.humanTime || new Date().toLocaleTimeString();
    }

    this.dispatchWebhookAlert(alertData);
  }

  dismissAlert() {
    if (this.elAlertBanner) this.elAlertBanner.classList.remove('visible');
    if (this.elPhoneCard) this.elPhoneCard.classList.remove('visible');
  }

  async dispatchWebhookAlert(alertData) {
    const url = this.webhookUrl || CONFIG.ALERT.WEBHOOK_URL;
    if (!url) {
      if (this.elWebhookStatus) {
        this.elWebhookStatus.textContent = 'Alert Mode: Local Simulated (No Webhook Set)';
        this.elWebhookStatus.className = 'webhook-tag tag-local';
      }
      return;
    }

    const now = Date.now();
    if (now - this.lastWebhookTime < CONFIG.ALERT.DEBOUNCE_SEC * 1000) {
      return;
    }
    this.lastWebhookTime = now;

    try {
      const payload = {
        device: 'wifinity-room-3',
        type: 'possible_fall',
        zone: alertData.zone,
        confidence: alertData.confidence,
        timestamp: Math.floor(now / 1000),
        disclaimer: 'SIMULATION - synthetic Wi-Fi signal. No medical claim.'
      };

      const headers = { 'Content-Type': 'application/json' };
      if (this.apiKey) {
        headers['x-api-key'] = this.apiKey;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        this.logEvent(`Cloud alert successfully dispatched to AWS Lambda (${res.status} OK)`);
        if (this.elWebhookStatus) {
          this.elWebhookStatus.textContent = 'Cloud Webhook: 200 OK Dispatched';
          this.elWebhookStatus.className = 'webhook-tag tag-success';
        }
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn('Webhook dispatch failed, falling back to local alert:', err);
      if (this.elWebhookStatus) {
        this.elWebhookStatus.textContent = 'Cloud Webhook: Offline / Local Only';
        this.elWebhookStatus.className = 'webhook-tag tag-local';
      }
    }
  }

  triggerCalibration() {
    if (this.btnCalibrate) {
      this.btnCalibrate.disabled = true;
      this.btnCalibrate.textContent = 'Calibrating (Keep room still)...';
    }
    this.logEvent('Initiating empty room baseline calibration (6.0s)...');
    this.detector.startCalibration();

    setTimeout(() => {
      if (this.btnCalibrate) {
        this.btnCalibrate.disabled = false;
        this.btnCalibrate.textContent = 'Calibrate Empty Room';
      }
      this.logEvent('Empty room baseline calibration COMPLETE.');
    }, CONFIG.DETECTOR.CALIBRATION_DURATION_SEC * 1000 + 200);
  }

  triggerSiteSurvey() {
    if (this.btnSurvey) {
      this.btnSurvey.disabled = true;
      this.btnSurvey.textContent = 'Surveying 3x3 Zones...';
    }
    this.logEvent('Running RF multipath site survey across all 9 zones...');

    setTimeout(() => {
      this.detector.initDefaultFingerprints();
      if (this.btnSurvey) {
        this.btnSurvey.disabled = false;
        this.btnSurvey.textContent = 'Run Site Survey';
      }
      this.logEvent('Site survey complete: 9 zone fingerprints updated.');
    }, 1200);
  }

  logEvent(msg) {
    if (!this.elEventList) return;
    const timeStr = new Date().toLocaleTimeString();
    const li = document.createElement('li');
    li.innerHTML = `<span class="log-time">[${timeStr}]</span> <span class="log-msg">${msg}</span>`;
    this.elEventList.insertBefore(li, this.elEventList.firstChild);

    while (this.elEventList.children.length > 40) {
      this.elEventList.removeChild(this.elEventList.lastChild);
    }
  }
}
