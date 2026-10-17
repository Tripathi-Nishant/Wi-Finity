/**
 * Wi-Finity Digital Twin - Main Application Bootstrap
 * 
 * Coordinates:
 * - 3D Scene (Three.js)
 * - Physics Engine (Synthetic CSI)
 * - Blind Detector & Signal Processing Pipeline
 * - Real-time Dashboard & Telemetry Visualizers
 * - Scenarios & 90-second Guided Tour
 * - Presenter Mode & Keyboard Shortcuts
 */

import { CONFIG } from './config.js';
import { SceneManager } from './scene.js';
import { PhysicsEngine } from './physics.js';
import { CsiDetector } from './detector.js';
import { SimSource } from './sources.js';
import { DashboardManager } from './dashboard.js';
import { ScenarioManager } from './scenarios.js';
import { AudioManager } from './audio.js';

class WiFinityApp {
  constructor() {
    this.isPaused = false;
    this.isPresenterMode = false;

    // 1. Audio Manager
    this.audio = new AudioManager();

    // 2. 3D Scene
    const container = document.getElementById('canvas-container');
    this.scene = new SceneManager(container);

    // 3. Physics Engine (Synthetic CSI Generator)
    this.physics = new PhysicsEngine();

    // 4. Blind Detector
    this.detector = new CsiDetector();

    // 5. Data Source (SimSource hooks physics tick into detector)
    this.source = new SimSource(this.physics, this.scene);

    // Connect Source stream to Detector and Scenario recorder
    this.source.onFrame((linkId, amplitudes, timestamp) => {
      this.detector.processFrame(linkId, amplitudes, timestamp);
      if (this.scenarios) {
        this.scenarios.capturePacketForRecording(linkId, amplitudes, timestamp);
      }
    });

    // 6. Command Center Dashboard
    this.dashboard = new DashboardManager({
      detector: this.detector,
      physics: this.physics,
      scene: this.scene,
      audio: this.audio,
    });

    // 7. Scenarios & Guided Tour Manager
    this.scenarios = new ScenarioManager({
      scene: this.scene,
      physics: this.physics,
      detector: this.detector,
      dashboard: this.dashboard,
      audio: this.audio,
    });

    // 8. Bind Header & Overlay Controls
    this.setupUIControls();
    this.setupKeyboardShortcuts();

    // Start simulation stream
    this.source.start();

    // Start 60fps render loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);

    console.log('%c[Wi-Finity Digital Twin] Initialized successfully. SIMULATION MODE active.', 'color: #00f0ff; font-weight: bold;');
  }

  animate(time) {
    requestAnimationFrame(this.animate);
    if (this.isPaused) return;

    const timestamp = time / 1000.0;

    // Render 3D Scene
    this.scene.render();

    // Update Dashboard Canvases & Telemetry
    this.dashboard.update(timestamp);
  }

  setupUIControls() {
    // Audio Mute Toggle
    const btnMute = document.getElementById('btn-toggle-mute');
    if (btnMute) {
      btnMute.addEventListener('click', () => {
        const isMuted = this.audio.toggleMute();
        btnMute.textContent = isMuted ? '🔇 Audio Off' : '🔊 Audio On';
        btnMute.classList.toggle('active', !isMuted);
      });
    }

    // Presenter Mode Toggle
    const btnPresenter = document.getElementById('btn-presenter-mode');
    if (btnPresenter) {
      btnPresenter.addEventListener('click', () => this.togglePresenterMode());
    }

    // Fullscreen Toggle
    const btnFullscreen = document.getElementById('btn-fullscreen');
    if (btnFullscreen) {
      btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
    }

    // Theme Toggle (Care Room vs Office)
    const btnThemeCare = document.getElementById('btn-theme-care');
    const btnThemeOffice = document.getElementById('btn-theme-office');
    if (btnThemeCare && btnThemeOffice) {
      btnThemeCare.addEventListener('click', () => {
        btnThemeCare.classList.add('active');
        btnThemeOffice.classList.remove('active');
        this.scene.setTheme('care');
        this.dashboard.logEvent('Environment switched to: CARE ROOM (Hospital Ward)');
      });
      btnThemeOffice.addEventListener('click', () => {
        btnThemeOffice.classList.add('active');
        btnThemeCare.classList.remove('active');
        this.scene.setTheme('office');
        this.dashboard.logEvent('Environment switched to: MODERN OFFICE');
      });
    }

    // Wall Material Toggle (Drywall vs Concrete)
    const toggleConcrete = document.getElementById('toggle-wall-concrete');
    if (toggleConcrete) {
      toggleConcrete.addEventListener('change', (e) => {
        const checked = e.target.checked;
        this.physics.setConcreteWall(checked);
        this.scene.setConcreteWall(checked);
        this.dashboard.logEvent(`Back Wall changed to: ${checked ? 'THICK CONCRETE (+18dB atten)' : 'STANDARD DRYWALL'}`);
      });
    }

    // Partition Curtain Toggle
    const toggleCurtain = document.getElementById('toggle-curtain');
    if (toggleCurtain) {
      toggleCurtain.addEventListener('change', (e) => {
        const checked = e.target.checked;
        this.physics.setCurtain(checked);
        this.scene.setCurtain(checked);
        this.dashboard.logEvent(`Partition Curtain ${checked ? 'DRAWN' : 'REMOVED'}`);
      });
    }

    // Camera Preset Buttons
    const btnCam1 = document.getElementById('cam-preset-1');
    const btnCam2 = document.getElementById('cam-preset-2');
    const btnCam3 = document.getElementById('cam-preset-3');
    if (btnCam1) btnCam1.addEventListener('click', () => this.scene.setCameraPreset(1));
    if (btnCam2) btnCam2.addEventListener('click', () => this.scene.setCameraPreset(2));
    if (btnCam3) btnCam3.addEventListener('click', () => this.scene.setCameraPreset(3));

    // Person Management Buttons
    const btnAddPerson = document.getElementById('btn-add-person');
    const btnRemovePerson = document.getElementById('btn-remove-person');
    if (btnAddPerson) {
      btnAddPerson.addEventListener('click', () => {
        const count = this.scene.avatars.length;
        if (count < 4) {
          const colors = [0x00f0ff, 0xec4899, 0xf59e0b, 0x10b981];
          const newAv = this.scene.addAvatar({ color: colors[count] });
          if (newAv) {
            this.dashboard.logEvent(`Added ${newAv.name} into room.`);
          }
        }
      });
    }
    if (btnRemovePerson) {
      btnRemovePerson.addEventListener('click', () => {
        if (this.scene.avatars.length > 0) {
          this.scene.removeAvatar();
          this.dashboard.logEvent('Removed avatar from room.');
        }
      });
    }

    // Selected Person Action Buttons
    const actionButtons = {
      'action-stand': 'stand',
      'action-sit': 'sit',
      'action-walk': 'walk',
      'action-lie': 'lie',
      'action-fall': 'fall',
    };
    for (const id in actionButtons) {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', () => {
          const action = actionButtons[id];
          this.scene.setPersonAction(action);
          this.dashboard.logEvent(`Selected avatar action: ${action.toUpperCase()}`);
        });
      }
    }

    // Visual Effect Toggles
    const toggleFresnel = document.getElementById('toggle-fresnel');
    if (toggleFresnel) {
      toggleFresnel.addEventListener('change', (e) => {
        this.scene.setFresnelVisible(e.target.checked);
      });
    }

    // Modal: About This Model / Honesty Specs
    const btnAbout = document.getElementById('btn-about-model');
    const modalAbout = document.getElementById('modal-about-model');
    const btnCloseAbout = document.getElementById('btn-close-about');
    if (btnAbout && modalAbout) {
      btnAbout.addEventListener('click', () => modalAbout.classList.add('visible'));
    }
    if (btnCloseAbout && modalAbout) {
      btnCloseAbout.addEventListener('click', () => modalAbout.classList.remove('visible'));
    }
    if (modalAbout) {
      modalAbout.addEventListener('click', (e) => {
        if (e.target === modalAbout) modalAbout.classList.remove('visible');
      });
    }
  }

  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Don't intercept when user is typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      switch (e.key.toUpperCase()) {
        case '1':
          this.scene.setCameraPreset(1);
          break;
        case '2':
          this.scene.setCameraPreset(2);
          break;
        case '3':
          this.scene.setCameraPreset(3);
          break;
        case ' ': // Space: Pause / Resume
          e.preventDefault();
          this.isPaused = !this.isPaused;
          this.dashboard.logEvent(`Simulation ${this.isPaused ? 'PAUSED' : 'RESUMED'}`);
          break;
        case 'G': // Guided Tour
          if (this.scenarios) {
            if (this.scenarios.isTourRunning) this.scenarios.stopGuidedTour();
            else this.scenarios.startGuidedTour();
          }
          break;
        case 'R': // Reset
          this.detector.reset();
          this.dashboard.logEvent('Reset baseline & statistics.');
          break;
        case 'F': // Fullscreen
          this.toggleFullscreen();
          break;
        case 'P': // Presenter Mode
          this.togglePresenterMode();
          break;
      }
    });
  }

  togglePresenterMode() {
    this.isPresenterMode = !this.isPresenterMode;
    document.body.classList.toggle('presenter-mode', this.isPresenterMode);
    const btnPresenter = document.getElementById('btn-presenter-mode');
    if (btnPresenter) {
      btnPresenter.classList.toggle('active', this.isPresenterMode);
    }
    this.scene.onResize();
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn('Fullscreen request failed:', err);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }
}

// Bootstrap on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  window.app = new WiFinityApp();
});
