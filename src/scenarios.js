/**
 * Wi-Finity Digital Twin - Scenarios & Guided Tour Manager
 * 
 * Implements:
 * - 8 Interactive Scenarios (Empty, Walk, Sit, Fall, Multi-mover, Curtain, Concrete, Interference)
 * - 90-second Cinematic Guided Tour with synchronized camera & on-screen captions
 * - Session Record & Replay with JSON export
 */

export class ScenarioManager {
  constructor(options = {}) {
    this.scene = options.scene;
    this.physics = options.physics;
    this.detector = options.detector;
    this.dashboard = options.dashboard;
    this.audio = options.audio;

    // Tour state
    this.isTourRunning = false;
    this.tourStepTimeout = null;
    this.elTourOverlay = document.getElementById('tour-caption-overlay');
    this.elTourText = document.getElementById('tour-caption-text');
    this.elTourProgress = document.getElementById('tour-progress-bar');

    // Recording state
    this.isRecording = false;
    this.recordedPackets = [];
    this.recordStartTime = 0;
    this.isReplaying = false;

    // Replay banner
    this.elReplayBanner = document.getElementById('replay-status-banner');

    this.setupUI();
  }

  setupUI() {
    // Scenario Dropdown
    const selScenario = document.getElementById('select-scenario');
    if (selScenario) {
      selScenario.addEventListener('change', (e) => {
        this.runScenario(e.target.value);
      });
    }

    // Guided Tour Button
    const btnTour = document.getElementById('btn-guided-tour');
    if (btnTour) {
      btnTour.addEventListener('click', () => {
        if (this.isTourRunning) this.stopGuidedTour();
        else this.startGuidedTour();
      });
    }

    // Record / Replay Buttons
    const btnRecord = document.getElementById('btn-record');
    const btnReplay = document.getElementById('btn-replay');
    const btnExport = document.getElementById('btn-export-recording');

    if (btnRecord) {
      btnRecord.addEventListener('click', () => this.toggleRecording());
    }
    if (btnReplay) {
      btnReplay.addEventListener('click', () => this.startReplay());
    }
    if (btnExport) {
      btnExport.addEventListener('click', () => this.exportRecordingJSON());
    }
  }

  /**
   * Run one of the 8 predefined scenarios
   */
  runScenario(scenarioKey) {
    if (this.isTourRunning) this.stopGuidedTour();
    if (this.audio) this.audio.playClick();

    // Reset environment flags to standard
    this.physics.setConcreteWall(false);
    this.physics.setCurtain(true);
    this.physics.setInterference(false);
    this.scene.setConcreteWall(false);
    this.scene.setCurtain(true);

    const checkConcrete = document.getElementById('toggle-wall-concrete');
    if (checkConcrete) checkConcrete.checked = false;
    const checkCurtain = document.getElementById('toggle-curtain');
    if (checkCurtain) checkCurtain.checked = true;
    const checkInterference = document.getElementById('toggle-interference');
    if (checkInterference) checkInterference.checked = false;

    switch (scenarioKey) {
      case 'empty':
        this.scene.avatars = [];
        this.scene.avatarsGroup.clear();
        this.dashboard.logEvent('Scenario: EMPTY ROOM — All avatars removed.');
        break;

      case 'walk':
        this.setupSinglePerson(0, 0, 'walk');
        this.dashboard.logEvent('Scenario: PERSON WALKS ACROSS — Continuous loop walking.');
        break;

      case 'sit':
        this.setupSinglePerson(1.5, 0.4, 'sit');
        this.dashboard.logEvent('Scenario: PERSON SITS STILL — Demonstrates PRESENT_STILL state.');
        break;

      case 'fall':
        this.setupSinglePerson(0.0, 0.0, 'walk');
        this.dashboard.logEvent('Scenario: POSSIBLE FALL — Walking to center, then dropping onto floor...');
        setTimeout(() => {
          this.scene.setPersonAction('fall');
        }, 1500);
        break;

      case 'two_people':
        this.scene.avatars = [];
        this.scene.avatarsGroup.clear();
        const p1 = this.scene.addAvatar({ x: -1.6, z: -0.6, name: 'Person 1', color: 0x00f0ff });
        const p2 = this.scene.addAvatar({ x: 1.6, z: 0.8, name: 'Person 2', color: 0xec4899 });
        if (p1) p1.activity = 'walk';
        if (p2) p2.activity = 'walk';
        this.dashboard.logEvent('Scenario: TWO PEOPLE MOVING — Disturbs multiple zones simultaneously.');
        break;

      case 'behind_curtain':
        this.setupSinglePerson(1.4, 1.2, 'walk');
        this.dashboard.logEvent('Scenario: PERSON BEHIND CURTAIN — RF passes through fabric partition.');
        break;

      case 'concrete_wall':
        this.setupSinglePerson(0.0, 1.4, 'walk');
        this.physics.setConcreteWall(true);
        this.scene.setConcreteWall(true);
        if (checkConcrete) checkConcrete.checked = true;
        this.dashboard.logEvent('Scenario: CONCRETE WALL (+18dB atten) — Accuracy drops realistically.');
        break;

      case 'heavy_interference':
        this.setupSinglePerson(0.0, 0.0, 'walk');
        this.physics.setInterference(true);
        if (checkInterference) checkInterference.checked = true;
        this.dashboard.logEvent('Scenario: HEAVY 2.4GHz INTERFERENCE — Bursty noise degrades SNR.');
        break;
    }
  }

  setupSinglePerson(x, z, activity = 'walk') {
    this.scene.avatars = [];
    this.scene.avatarsGroup.clear();
    const p = this.scene.addAvatar({ x, z, name: 'Person 1', color: 0x00f0ff });
    if (p) {
      this.scene.selectAvatar(0);
      this.scene.setPersonAction(activity);
    }
  }

  /**
   * 90-Second Guided Tour with synchronized multi-stage narration
   */
  startGuidedTour() {
    this.isTourRunning = true;
    if (this.elTourOverlay) this.elTourOverlay.classList.add('visible');
    const btnTour = document.getElementById('btn-guided-tour');
    if (btnTour) btnTour.textContent = '⏹ Stop Tour';

    const steps = [
      {
        duration: 13,
        text: 'Step 1/7: Welcome to Wi-Finity Digital Twin! This 6.0m × 4.5m room contains 1 Wi-Fi router (TX) and 3 receiver pucks (RX1–RX3). No optical cameras or wearables are used.',
        action: () => {
          this.scene.setCameraPreset(2); // Isometric
          this.runScenario('empty');
        }
      },
      {
        duration: 14,
        text: 'Step 2/7: Empty Room Baseline — With nobody in the room, Wi-Fi radio waves bounce off walls in static multipath. Subcarriers are steady and the detector state is EMPTY.',
        action: () => {
          this.scene.setCameraPreset(1); // Top-down
        }
      },
      {
        duration: 17,
        text: 'Step 3/7: Dynamic Movement — A person enters and walks. Because 2.4 GHz wavelength is ~12.3 cm, moving human bodies shift path phases and trigger constructive/destructive ripples. State shifts to MOVING.',
        action: () => {
          this.scene.setCameraPreset(2);
          this.runScenario('walk');
        }
      },
      {
        duration: 15,
        text: 'Step 4/7: Still Presence — The person sits still. Motion score drops to near-zero, but static subcarrier DC displacement verifies that someone is still PRESENT_STILL.',
        action: () => {
          this.runScenario('sit');
        }
      },
      {
        duration: 18,
        text: 'Step 5/7: Fall Pattern Alert — Simulating an emergency. A rapid, high-energy impact burst occurs, immediately followed by >3 seconds of motionless presence. System flags "POSSIBLE FALL PATTERN"!',
        action: () => {
          this.runScenario('fall');
        }
      },
      {
        duration: 11,
        text: 'Step 6/7: Multi-Node Spatial Resolution — Activating the 4th receiver (RX4) sharpens zone estimation and disambiguates wall reflections.',
        action: () => {
          const checkRx4 = document.getElementById('toggle-rx4');
          if (checkRx4) {
            checkRx4.checked = true;
            checkRx4.dispatchEvent(new Event('change'));
          }
          this.runScenario('walk');
        }
      },
      {
        duration: 10,
        text: 'Step 7/7: Tour Complete! Now it\'s your turn: click & drag any avatar on the floor, toggle concrete walls, or switch between Care Room and Office themes!',
        action: () => {
          this.scene.setCameraPreset(3); // Free orbit
        }
      }
    ];

    let currentStepIdx = 0;

    const executeNextStep = () => {
      if (!this.isTourRunning || currentStepIdx >= steps.length) {
        this.stopGuidedTour();
        return;
      }

      const step = steps[currentStepIdx++];
      if (this.elTourText) this.elTourText.textContent = step.text;

      // Animate progress bar
      if (this.elTourProgress) {
        this.elTourProgress.style.transition = 'none';
        this.elTourProgress.style.width = '0%';
        setTimeout(() => {
          if (this.elTourProgress) {
            this.elTourProgress.style.transition = `width ${step.duration}s linear`;
            this.elTourProgress.style.width = '100%';
          }
        }, 50);
      }

      step.action();
      this.tourStepTimeout = setTimeout(executeNextStep, step.duration * 1000);
    };

    executeNextStep();
  }

  stopGuidedTour() {
    this.isTourRunning = false;
    if (this.tourStepTimeout) {
      clearTimeout(this.tourStepTimeout);
      this.tourStepTimeout = null;
    }
    if (this.elTourOverlay) this.elTourOverlay.classList.remove('visible');
    const btnTour = document.getElementById('btn-guided-tour');
    if (btnTour) btnTour.textContent = '▶ 90s Guided Tour';
  }

  /**
   * Session Record & Replay
   */
  toggleRecording() {
    const btnRecord = document.getElementById('btn-record');
    if (!this.isRecording) {
      this.isRecording = true;
      this.recordedPackets = [];
      this.recordStartTime = performance.now();
      if (btnRecord) {
        btnRecord.textContent = '■ Stop Rec';
        btnRecord.classList.add('recording-active');
      }
      this.dashboard.logEvent('Session recording STARTED.');
    } else {
      this.isRecording = false;
      if (btnRecord) {
        btnRecord.textContent = '● Record';
        btnRecord.classList.remove('recording-active');
      }
      this.dashboard.logEvent(`Session recording STOPPED (${this.recordedPackets.length} packets captured).`);
    }
  }

  capturePacketForRecording(linkId, amplitudes, timestamp) {
    if (!this.isRecording) return;
    this.recordedPackets.push({
      time: timestamp - this.recordStartTime / 1000.0,
      link: linkId,
      amplitudes: Array.from(amplitudes)
    });
  }

  startReplay() {
    if (this.recordedPackets.length === 0) {
      alert('No recorded packets available. Click "Record" first or test a scenario.');
      return;
    }

    this.isReplaying = true;
    if (this.elReplayBanner) this.elReplayBanner.classList.add('visible');
    this.dashboard.logEvent('Session playback STARTED (Mode: REPLAY).');

    let pktIdx = 0;
    const interval = setInterval(() => {
      if (!this.isReplaying || pktIdx >= this.recordedPackets.length) {
        this.stopReplay();
        clearInterval(interval);
        return;
      }
      const pkt = this.recordedPackets[pktIdx++];
      const amps = new Float32Array(pkt.amplitudes);
      this.detector.processFrame(pkt.link, amps, performance.now() / 1000.0);
    }, 33);
  }

  stopReplay() {
    this.isReplaying = false;
    if (this.elReplayBanner) this.elReplayBanner.classList.remove('visible');
    this.dashboard.logEvent('Session playback FINISHED.');
  }

  exportRecordingJSON() {
    if (this.recordedPackets.length === 0) {
      alert('No recorded session to export.');
      return;
    }
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.recordedPackets, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `wifinity_csi_session_${Date.now()}.json`);
    dlAnchor.click();
    this.dashboard.logEvent('Exported recorded session to JSON file.');
  }
}
