/**
 * Wi-Finity Digital Twin - 3D Scene (Three.js)
 * 
 * Features:
 * - 6.0m x 4.5m x 2.7m Architectural Modern Care Ward / Office Digital Twin
 * - High-visibility studio lighting: clear walls, crisp floor tiles, detailed furniture
 * - Hardware models: 1 TX Wi-Fi 6 Router with expanding wave rings, 3-4 RX sensor pucks
 * - Dynamic pulsing link beams with real-time disturbance scores
 * - Highly visible, stylized humanoid avatars with smooth walk/sit/fall animations
 * - 3x3 floor zone probability heatmap overlay
 * - Cinematic camera presets with smooth damping
 * - Post-processing: UnrealBloomPass glow
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from './config.js';

export class SceneManager {
  constructor(containerElement) {
    this.container = containerElement;
    this.width = containerElement.clientWidth || 800;
    this.height = containerElement.clientHeight || 600;

    // Core Three.js components
    this.scene = new THREE.Scene();
    // High-tech modern dark studio background (clear slate-navy, NOT pitch black)
    this.scene.background = new THREE.Color(0x0a101d);

    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04; // Don't go below floor
    this.controls.minDistance = 2.0;
    this.controls.maxDistance = 22.0;

    // Post-processing Composer
    this.initPostProcessing();

    // Lighting (Bright, balanced studio lighting)
    this.initLighting();

    // Scene Groups
    this.roomGroup = new THREE.Group();
    this.careFurnitureGroup = new THREE.Group();
    this.officeFurnitureGroup = new THREE.Group();
    this.hardwareGroup = new THREE.Group();
    this.linkLinesGroup = new THREE.Group();
    this.fresnelGroup = new THREE.Group();
    this.avatarsGroup = new THREE.Group();
    this.floorHeatGroup = new THREE.Group();
    this.wifiRingsGroup = new THREE.Group();

    this.scene.add(this.roomGroup);
    this.scene.add(this.careFurnitureGroup);
    this.scene.add(this.officeFurnitureGroup);
    this.scene.add(this.hardwareGroup);
    this.scene.add(this.linkLinesGroup);
    this.scene.add(this.fresnelGroup);
    this.scene.add(this.avatarsGroup);
    this.scene.add(this.floorHeatGroup);
    this.scene.add(this.wifiRingsGroup);

    // State & Settings
    this.currentTheme = 'care'; // 'care' | 'office'
    this.concreteWallEnabled = false;
    this.curtainEnabled = true;
    this.rx4Enabled = false;
    this.fresnelVisible = false;

    // Avatars collection
    this.avatars = [];
    this.selectedAvatarIndex = 0;

    // Drag interaction state
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.isDragging = false;
    this.draggedAvatar = null;
    this.dragPlaneIntersect = new THREE.Vector3();

    // Camera animation state
    this.cameraTargetPos = new THREE.Vector3();
    this.cameraTargetLook = new THREE.Vector3();
    this.isCameraTweening = false;

    // Build Scene Elements
    this.buildRoom();
    this.buildCareFurniture();
    this.buildOfficeFurniture();
    this.officeFurnitureGroup.visible = false;
    this.buildHardwareNodes();
    this.buildLinkLines();
    this.buildFloorHeatGrid();
    this.buildFresnelEllipses();
    this.fresnelGroup.visible = false;
    this.initParticles();

    // Add initial avatar (Person 1) in clear visible position
    this.addAvatar({ x: 0.0, z: 0.0, color: 0x00f0ff, name: 'Person 1' });

    // Initial Camera position: Presentation Isometric (Preset 2)
    this.setCameraPreset(2, false);

    // Setup Event Listeners
    this.setupInteractions();
    window.addEventListener('resize', () => this.onResize());

    // Clock
    this.clock = new THREE.Clock();
  }

  initPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Subtle, tasteful bloom (not blinding or pitch black)
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      0.45,  // bloom strength
      0.25,  // radius
      0.88   // threshold
    );
    this.composer.addPass(this.bloomPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  initLighting() {
    // 1. Clean ambient fill (ensures all objects, furniture, and room borders are visible)
    const ambientLight = new THREE.AmbientLight(0x94a3b8, 1.4);
    this.scene.add(ambientLight);

    // 2. Main ceiling directional spotlight for crisp definition & soft shadows
    const mainSun = new THREE.DirectionalLight(0xffffff, 2.0);
    mainSun.position.set(4, 9, 5);
    mainSun.castShadow = true;
    mainSun.shadow.mapSize.width = 1024;
    mainSun.shadow.mapSize.height = 1024;
    mainSun.shadow.bias = -0.0005;
    mainSun.shadow.camera.near = 1;
    mainSun.shadow.camera.far = 25;
    mainSun.shadow.camera.left = -4;
    mainSun.shadow.camera.right = 4;
    mainSun.shadow.camera.top = 4;
    mainSun.shadow.camera.bottom = -4;
    this.scene.add(mainSun);

    // 3. Counter fill light (cool cyan-tinted)
    const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.0);
    fillLight.position.set(-5, 6, -4);
    this.scene.add(fillLight);

    // 4. Warm interior room center point light
    const roomPoint = new THREE.PointLight(0xe2e8f0, 1.6, 12, 1.1);
    roomPoint.position.set(0, 2.5, 0);
    this.scene.add(roomPoint);

    // 5. Router local accent glow
    const routerLight = new THREE.PointLight(0x00f0ff, 1.8, 4.5);
    routerLight.position.set(-2.6, 1.8, -1.8);
    this.scene.add(routerLight);
  }

  buildRoom() {
    const L = CONFIG.ROOM.LENGTH; // 6.0m
    const W = CONFIG.ROOM.WIDTH;  // 4.5m
    const H = CONFIG.ROOM.HEIGHT; // 2.7m

    // 1. Floor: High-end architectural studio floor
    const floorGeo = new THREE.PlaneGeometry(L, W);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.45,
      metalness: 0.3,
    });
    this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.receiveShadow = true;
    this.roomGroup.add(this.floorMesh);

    // Architectural tile grid
    const grid = new THREE.GridHelper(L, 12, 0x00f0ff, 0x1e293b);
    grid.position.y = 0.006;
    this.roomGroup.add(grid);

    // Outer Room Border Baseboard (Glows softly)
    const borderPoints = [
      new THREE.Vector3(-L/2, 0.02, -W/2),
      new THREE.Vector3(L/2, 0.02, -W/2),
      new THREE.Vector3(L/2, 0.02, W/2),
      new THREE.Vector3(-L/2, 0.02, W/2),
      new THREE.Vector3(-L/2, 0.02, -W/2)
    ];
    const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPoints);
    const borderMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 });
    const borderLine = new THREE.Line(borderGeo, borderMat);
    this.roomGroup.add(borderLine);

    // Ceiling outline
    const ceilingPoints = [
      new THREE.Vector3(-L/2, H, -W/2),
      new THREE.Vector3(L/2, H, -W/2),
      new THREE.Vector3(L/2, H, W/2),
      new THREE.Vector3(-L/2, H, W/2),
      new THREE.Vector3(-L/2, H, -W/2)
    ];
    const ceilingGeo = new THREE.BufferGeometry().setFromPoints(ceilingPoints);
    const ceilingMat = new THREE.LineBasicMaterial({ color: 0x334155, linewidth: 1 });
    const ceilingLine = new THREE.Line(ceilingGeo, ceilingMat);
    this.roomGroup.add(ceilingLine);

    // 4 Corner Architectural Pillars
    const cornerPillarGeo = new THREE.BoxGeometry(0.08, H, 0.08);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.3 });
    const corners = [
      [-L/2, H/2, -W/2],
      [L/2, H/2, -W/2],
      [L/2, H/2, W/2],
      [-L/2, H/2, W/2]
    ];
    corners.forEach(([cx, cy, cz]) => {
      const pillar = new THREE.Mesh(cornerPillarGeo, pillarMat);
      pillar.position.set(cx, cy, cz);
      this.roomGroup.add(pillar);
    });

    // Semi-Transparent Architectural Glass Walls (Clean & visible, not dark void)
    this.glassWallMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      transparent: true,
      opacity: 0.22,
      roughness: 0.2,
      metalness: 0.1,
      side: THREE.DoubleSide
    });

    // Concrete Wall Material (Realistic brutalist grey concrete)
    this.concreteWallMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.DoubleSide
    });

    // 1. Back Wall (z = +W/2) - Toggleable to Concrete
    const backWallGeo = new THREE.PlaneGeometry(L, H);
    this.backWallMesh = new THREE.Mesh(backWallGeo, this.glassWallMat);
    this.backWallMesh.position.set(0, H / 2, W / 2);
    this.backWallMesh.rotation.y = Math.PI;
    this.roomGroup.add(this.backWallMesh);

    // 2. Front Wall (z = -W/2)
    const frontWallMesh = new THREE.Mesh(backWallGeo, this.glassWallMat);
    frontWallMesh.position.set(0, H / 2, -W / 2);
    this.roomGroup.add(frontWallMesh);

    // 3. Left Wall (x = -L/2)
    const sideWallGeo = new THREE.PlaneGeometry(W, H);
    const leftWallMesh = new THREE.Mesh(sideWallGeo, this.glassWallMat);
    leftWallMesh.position.set(-L / 2, H / 2, 0);
    leftWallMesh.rotation.y = Math.PI / 2;
    this.roomGroup.add(leftWallMesh);

    // 4. Right Wall (x = +L/2)
    const rightWallMesh = new THREE.Mesh(sideWallGeo, this.glassWallMat);
    rightWallMesh.position.set(L / 2, H / 2, 0);
    rightWallMesh.rotation.y = -Math.PI / 2;
    this.roomGroup.add(rightWallMesh);

    // Doorway frame on left wall (Clearly recognizable door)
    const doorFrameGeo = new THREE.BoxGeometry(0.06, 2.1, 0.95);
    const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.4 });
    const doorFrame = new THREE.Mesh(doorFrameGeo, doorFrameMat);
    doorFrame.position.set(-L / 2 + 0.03, 1.05, 1.0);
    this.roomGroup.add(doorFrame);

    // Window on right wall with gentle soft exterior light
    const winGeo = new THREE.PlaneGeometry(1.6, 1.2);
    const winMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 });
    const winMesh = new THREE.Mesh(winGeo, winMat);
    winMesh.position.set(L / 2 - 0.02, 1.6, -0.6);
    winMesh.rotation.y = -Math.PI / 2;
    this.roomGroup.add(winMesh);

    // Partition Curtain (Translucent medical curtain)
    this.curtainGroup = new THREE.Group();
    const curtainGeo = new THREE.PlaneGeometry(1.8, 2.2);
    const curtainMat = new THREE.MeshStandardMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.48,
      roughness: 0.6,
      side: THREE.DoubleSide
    });
    const curtainMesh = new THREE.Mesh(curtainGeo, curtainMat);
    curtainMesh.position.set(0.6, 1.2, 1.1);
    curtainMesh.rotation.y = Math.PI / 2;
    this.curtainGroup.add(curtainMesh);

    // Curtain ceiling rail
    const railGeo = new THREE.CylinderGeometry(0.018, 0.018, 1.9);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(0.6, 2.3, 1.1);
    rail.rotation.x = Math.PI / 2;
    this.curtainGroup.add(rail);

    this.roomGroup.add(this.curtainGroup);
  }

  buildCareFurniture() {
    // Care Room: Modern Hospital / Clinic Bed
    const bedGroup = new THREE.Group();
    bedGroup.position.set(1.85, 0, 1.05);

    // Metallic bed chassis
    const frameGeo = new THREE.BoxGeometry(1.2, 0.28, 2.15);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.3, metalness: 0.6 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.y = 0.22;
    frame.castShadow = true;
    bedGroup.add(frame);

    // White medical mattress
    const matGeo = new THREE.BoxGeometry(1.15, 0.22, 2.1);
    const matMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.7 });
    const mat = new THREE.Mesh(matGeo, matMat);
    mat.position.y = 0.46;
    mat.castShadow = true;
    bedGroup.add(mat);

    // Cyan accent blanket
    const blanketGeo = new THREE.BoxGeometry(1.16, 0.05, 1.3);
    const blanketMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.5 });
    const blanket = new THREE.Mesh(blanketGeo, blanketMat);
    blanket.position.set(0, 0.58, -0.38);
    bedGroup.add(blanket);

    // Soft pillow
    const pilGeo = new THREE.BoxGeometry(0.75, 0.12, 0.45);
    const pilMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const pil = new THREE.Mesh(pilGeo, pilMat);
    pil.position.set(0, 0.62, 0.76);
    bedGroup.add(pil);

    // Headboard & Footboard
    const headboardGeo = new THREE.BoxGeometry(1.22, 0.7, 0.06);
    const headboardMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.5 });
    const headboard = new THREE.Mesh(headboardGeo, headboardMat);
    headboard.position.set(0, 0.55, 1.08);
    bedGroup.add(headboard);

    // Bedside Table
    const tableGeo = new THREE.BoxGeometry(0.5, 0.65, 0.5);
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.position.set(-0.95, 0.32, 0.8);
    bedGroup.add(table);

    // Medical Vital Signs Monitor Stand
    const standGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.4);
    const standMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 });
    const stand = new THREE.Mesh(standGeo, standMat);
    stand.position.set(-0.95, 0.7, 0.1);
    bedGroup.add(stand);

    // Monitor screen with vital signs canvas texture
    const screenGeo = new THREE.BoxGeometry(0.42, 0.3, 0.05);
    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = 256;
    screenCanvas.height = 180;
    const sCtx = screenCanvas.getContext('2d');
    sCtx.fillStyle = '#0f172a';
    sCtx.fillRect(0, 0, 256, 180);
    sCtx.fillStyle = '#10b981';
    sCtx.font = 'bold 24px monospace';
    sCtx.fillText('HR: 72 bpm', 16, 40);
    sCtx.strokeStyle = '#10b981';
    sCtx.lineWidth = 3;
    sCtx.beginPath();
    sCtx.moveTo(16, 90);
    sCtx.lineTo(60, 90);
    sCtx.lineTo(80, 50);
    sCtx.lineTo(100, 130);
    sCtx.lineTo(120, 90);
    sCtx.lineTo(240, 90);
    sCtx.stroke();
    sCtx.fillStyle = '#38bdf8';
    sCtx.font = '18px monospace';
    sCtx.fillText('SpO2: 98%', 16, 155);

    const screenTex = new THREE.CanvasTexture(screenCanvas);
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTex });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.set(-0.95, 1.35, 0.1);
    screenMesh.rotation.y = Math.PI / 4;
    bedGroup.add(screenMesh);

    this.careFurnitureGroup.add(bedGroup);
  }

  buildOfficeFurniture() {
    // Office Theme: Modern Executive Desk & Ergonomic Chair
    const deskGroup = new THREE.Group();
    deskGroup.position.set(1.7, 0, 0.8);

    // Modern Wood Desk Top
    const topGeo = new THREE.BoxGeometry(1.6, 0.06, 0.9);
    const topMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.3, metalness: 0.3 });
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 0.72;
    top.castShadow = true;
    deskGroup.add(top);

    // Metallic Desk Frame Legs
    const legGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.72);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
    const legPositions = [
      [-0.72, 0.36, -0.38],
      [0.72, 0.36, -0.38],
      [-0.72, 0.36, 0.38],
      [0.72, 0.36, 0.38],
    ];
    for (const [lx, ly, lz] of legPositions) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, ly, lz);
      deskGroup.add(leg);
    }

    // Curved Modern Monitor on desk
    const monGeo = new THREE.BoxGeometry(0.7, 0.38, 0.04);
    const monMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2 });
    const mon = new THREE.Mesh(monGeo, monMat);
    mon.position.set(0, 1.0, 0.1);
    deskGroup.add(mon);

    const monStandGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.25);
    const monStand = new THREE.Mesh(monStandGeo, legMat);
    monStand.position.set(0, 0.84, 0.1);
    deskGroup.add(monStand);

    // Office Chair
    const chairSeatGeo = new THREE.BoxGeometry(0.5, 0.08, 0.5);
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.6 });
    const chairSeat = new THREE.Mesh(chairSeatGeo, chairMat);
    chairSeat.position.set(0, 0.46, -0.65);
    deskGroup.add(chairSeat);

    const chairBackGeo = new THREE.BoxGeometry(0.48, 0.55, 0.06);
    const chairBack = new THREE.Mesh(chairBackGeo, chairMat);
    chairBack.position.set(0, 0.76, -0.88);
    deskGroup.add(chairBack);

    this.officeFurnitureGroup.add(deskGroup);
  }

  buildHardwareNodes() {
    // 1. Transmitter (TX - Wi-Fi AP / Router)
    const txPos = CONFIG.NODES.TX;
    const routerGroup = new THREE.Group();
    routerGroup.position.set(txPos.x, txPos.y, txPos.z);

    // Wall mount bracket
    const bracketGeo = new THREE.BoxGeometry(0.08, 0.25, 0.25);
    const bracketMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 });
    const bracket = new THREE.Mesh(bracketGeo, bracketMat);
    bracket.position.set(-0.16, 0, 0);
    routerGroup.add(bracket);

    // Sleek Wi-Fi 6 Router body (White & Cyan illuminated)
    const bodyGeo = new THREE.BoxGeometry(0.32, 0.07, 0.24);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2, metalness: 0.4 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    routerGroup.add(body);

    // Dual Antennas
    const antGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.32);
    const antMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 });
    const ant1 = new THREE.Mesh(antGeo, antMat);
    ant1.position.set(-0.1, 0.16, -0.09);
    ant1.rotation.z = -0.2;
    routerGroup.add(ant1);

    const ant2 = new THREE.Mesh(antGeo, antMat);
    ant2.position.set(0.1, 0.16, -0.09);
    ant2.rotation.z = 0.2;
    routerGroup.add(ant2);

    // Glowing Wi-Fi status LED Ring
    const ledGeo = new THREE.TorusGeometry(0.04, 0.01, 16, 32);
    this.txLedMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const led = new THREE.Mesh(ledGeo, this.txLedMat);
    led.rotation.x = Math.PI / 2;
    led.position.set(0, 0.04, 0.04);
    routerGroup.add(led);

    // Floating High-Visibility 3D Tag
    this.addNodeLabel(routerGroup, 'TX (Wi-Fi 6 AP)', '#00f0ff');
    this.hardwareGroup.add(routerGroup);

    // Expanding Wi-Fi Wave Rings on the floor plane
    this.wifiRings = [];
    for (let r = 0; r < 3; r++) {
      const ringGeo = new THREE.RingGeometry(0.15, 0.20, 48);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(txPos.x, 0.02, txPos.z);
      ring.rotation.x = -Math.PI / 2;
      this.wifiRingsGroup.add(ring);
      this.wifiRings.push({ mesh: ring, scale: 0.2 + r * 0.5, speed: 0.75 });
    }

    // 2. Receivers (RX1, RX2, RX3, RX4)
    this.rxNodes = {};
    const rxKeys = ['RX1', 'RX2', 'RX3', 'RX4'];

    for (const key of rxKeys) {
      const nodeConf = CONFIG.NODES[key];
      const rxGroup = new THREE.Group();
      rxGroup.position.set(nodeConf.x, nodeConf.y, nodeConf.z);

      // Sleek metallic puck body
      const puckGeo = new THREE.CylinderGeometry(0.10, 0.12, 0.06, 32);
      const puckMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.8 });
      const puck = new THREE.Mesh(puckGeo, puckMat);
      puck.castShadow = true;
      rxGroup.add(puck);

      // Small antenna
      const rxAnt = new THREE.Mesh(antGeo, antMat);
      rxAnt.position.set(0, 0.16, 0);
      rxAnt.scale.set(0.7, 0.7, 0.7);
      rxGroup.add(rxAnt);

      // LED Ring
      const rxLedMat = new THREE.MeshBasicMaterial({ color: key === 'RX4' ? 0xfbbf24 : 0x10b981 });
      const rxLed = new THREE.Mesh(ledGeo, rxLedMat);
      rxLed.rotation.x = Math.PI / 2;
      rxLed.position.set(0, 0.035, 0);
      rxLed.scale.set(0.7, 0.7, 0.7);
      rxGroup.add(rxLed);

      this.addNodeLabel(rxGroup, `${key} Sensor`, key === 'RX4' ? '#fbbf24' : '#10b981');

      if (key === 'RX4') {
        rxGroup.visible = false;
      }

      this.hardwareGroup.add(rxGroup);
      this.rxNodes[key] = { group: rxGroup, ledMat: rxLedMat };
    }
  }

  addNodeLabel(parentGroup, text, colorHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.roundRect(8, 8, 240, 48, 8);
    ctx.fill();
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(0, 0.48, 0);
    sprite.scale.set(0.85, 0.22, 1);
    parentGroup.add(sprite);
  }

  buildLinkLines() {
    this.linkLines = {};
    const txPos = new THREE.Vector3(CONFIG.NODES.TX.x, CONFIG.NODES.TX.y, CONFIG.NODES.TX.z);

    const links = ['RX1', 'RX2', 'RX3', 'RX4'];
    for (const key of links) {
      const rxConf = CONFIG.NODES[key];
      const rxPos = new THREE.Vector3(rxConf.x, rxConf.y, rxConf.z);

      const points = [txPos, rxPos];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);

      const lineMat = new THREE.LineBasicMaterial({
        color: key === 'RX4' ? 0xfbbf24 : 0x00f0ff,
        transparent: true,
        opacity: 0.45,
        linewidth: 2
      });

      const line = new THREE.Line(lineGeo, lineMat);
      if (key === 'RX4') line.visible = false;

      this.linkLinesGroup.add(line);
      this.linkLines[key] = { line, mat: lineMat };
    }
  }

  buildFloorHeatGrid() {
    this.floorTiles = [];
    const cellW = CONFIG.ROOM.LENGTH / CONFIG.ROOM.GRID_COLS; // 2.0m
    const cellH = CONFIG.ROOM.WIDTH / CONFIG.ROOM.GRID_ROWS;  // 1.5m
    const xOffsets = [-cellW, 0, cellW];                     // -2, 0, +2
    const zOffsets = [-cellH, 0, cellH];                     // -1.5, 0, +1.5

    const zoneNames = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
    let idx = 0;

    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        const x = xOffsets[c];
        const z = zOffsets[r];
        const name = zoneNames[idx++];

        // High visibility zone tile
        const tileGeo = new THREE.PlaneGeometry(cellW - 0.12, cellH - 0.12);
        const tileMat = new THREE.MeshBasicMaterial({
          color: 0x00f0ff,
          transparent: true,
          opacity: 0.06,
          side: THREE.DoubleSide
        });
        const tileMesh = new THREE.Mesh(tileGeo, tileMat);
        tileMesh.rotation.x = -Math.PI / 2;
        tileMesh.position.set(x, 0.015, z);
        this.floorHeatGroup.add(tileMesh);

        // Zone label on floor
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.font = 'bold 36px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, 64, 64);
        const tex = new THREE.CanvasTexture(canvas);
        const labelMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.75 });
        const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), labelMat);
        labelMesh.rotation.x = -Math.PI / 2;
        labelMesh.position.set(x, 0.018, z);
        this.floorHeatGroup.add(labelMesh);

        this.floorTiles.push({ name, mesh: tileMesh, mat: tileMat });
      }
    }
  }

  buildFresnelEllipses() {
    const links = ['RX1', 'RX2', 'RX3'];
    const tx = CONFIG.NODES.TX;
    const wavelength = CONFIG.CSI.WAVELENGTH;

    for (const key of links) {
      const rx = CONFIG.NODES[key];
      const d = Math.hypot(rx.x - tx.x, rx.y - tx.y, rx.z - tx.z);
      const rFresnel = 0.5 * Math.sqrt(wavelength * d);

      const geo = new THREE.SphereGeometry(1, 16, 12);
      geo.scale(rFresnel, rFresnel, d / 2);

      const mat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        wireframe: true,
        transparent: true,
        opacity: 0.18
      });
      const mesh = new THREE.Mesh(geo, mat);

      const midX = (tx.x + rx.x) / 2;
      const midY = (tx.y + rx.y) / 2;
      const midZ = (tx.z + rx.z) / 2;
      mesh.position.set(midX, midY, midZ);
      mesh.lookAt(rx.x, rx.y, rx.z);

      this.fresnelGroup.add(mesh);
    }
  }

  initParticles() {
    const count = 100;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * CONFIG.ROOM.LENGTH;
      positions[i * 3 + 1] = Math.random() * CONFIG.ROOM.HEIGHT;
      positions[i * 3 + 2] = (Math.random() - 0.5) * CONFIG.ROOM.WIDTH;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.04,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending
    });
    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
  }

  /**
   * Adds an articulate, clearly visible stylized humanoid avatar
   */
  addAvatar(options = {}) {
    if (this.avatars.length >= 4) return null;

    const id = this.avatars.length + 1;
    const colorHex = options.color || (id === 1 ? 0x00f0ff : id === 2 ? 0xec4899 : id === 3 ? 0xf59e0b : 0x10b981);
    const name = options.name || `Person ${id}`;
    const x = options.x !== undefined ? options.x : (id === 1 ? 0 : id === 2 ? -1.5 : 1.5);
    const z = options.z !== undefined ? options.z : (id === 1 ? 0 : id === 2 ? -0.8 : -0.8);

    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // Torso Capsule (Brightly illuminated modern digital twin silhouette)
    const torsoGeo = new THREE.CapsuleGeometry(0.24, 0.72, 12, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 0.45,
      roughness: 0.25,
      metalness: 0.3,
    });
    const torso = new THREE.Mesh(torsoGeo, bodyMat);
    torso.position.y = 0.95;
    torso.castShadow = true;
    group.add(torso);

    // Head Sphere with illuminated visor
    const headGeo = new THREE.SphereGeometry(0.18, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: colorHex,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.4,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.62;
    head.castShadow = true;
    group.add(head);

    // Visor bar on head
    const visorGeo = new THREE.BoxGeometry(0.22, 0.06, 0.12);
    const visorMat = new THREE.MeshBasicMaterial({ color: colorHex });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 1.62, 0.12);
    group.add(visor);

    // Floor Pedestal Ring (Marks position clearly)
    const ringGeo = new THREE.RingGeometry(0.38, 0.45, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide
    });
    const selRing = new THREE.Mesh(ringGeo, ringMat);
    selRing.rotation.x = -Math.PI / 2;
    selRing.position.y = 0.025;
    group.add(selRing);

    // Name tag banner
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.roundRect(4, 4, 184, 40, 8);
    ctx.fill();
    ctx.strokeStyle = `#${colorHex.toString(16).padStart(6, '0')}`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 96, 24);

    const tex = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const nameSprite = new THREE.Sprite(spriteMat);
    nameSprite.position.y = 2.05;
    nameSprite.scale.set(0.7, 0.19, 1);
    group.add(nameSprite);

    this.avatarsGroup.add(group);

    const avatar = {
      id,
      name,
      colorHex,
      group,
      torso,
      head,
      visor,
      selRing,
      activity: 'stand',
      animTime: 0,
      walkPathAngle: Math.random() * Math.PI * 2,
      walkRadius: 1.35,
      walkCenter: { x: 0, z: 0 },
      isFalling: false,
      fallStartTime: 0,
      active: true,
      currentZone: 'B2',
    };

    this.avatars.push(avatar);
    this.updateAvatarSelectionVisuals();
    return avatar;
  }

  removeAvatar(index = null) {
    if (this.avatars.length <= 0) return;
    const idx = index !== null ? index : this.avatars.length - 1;
    const removed = this.avatars.splice(idx, 1)[0];
    if (removed) {
      this.avatarsGroup.remove(removed.group);
    }
    if (this.selectedAvatarIndex >= this.avatars.length) {
      this.selectedAvatarIndex = Math.max(0, this.avatars.length - 1);
    }
    this.updateAvatarSelectionVisuals();
  }

  selectAvatar(idx) {
    if (idx >= 0 && idx < this.avatars.length) {
      this.selectedAvatarIndex = idx;
      this.updateAvatarSelectionVisuals();
    }
  }

  updateAvatarSelectionVisuals() {
    for (let i = 0; i < this.avatars.length; i++) {
      const a = this.avatars[i];
      a.selRing.visible = (i === this.selectedAvatarIndex);
    }
  }

  getSelectedAvatar() {
    return this.avatars[this.selectedAvatarIndex] || null;
  }

  setPersonAction(action) {
    const avatar = this.getSelectedAvatar();
    if (!avatar) return;

    avatar.activity = action;
    avatar.animTime = 0;

    if (action === 'stand') {
      avatar.isFalling = false;
      avatar.group.rotation.set(0, 0, 0);
      avatar.torso.position.y = 0.95;
      avatar.head.position.y = 1.62;
    } else if (action === 'sit') {
      avatar.isFalling = false;
      avatar.group.rotation.set(0, 0, 0);
      avatar.torso.position.y = 0.65;
      avatar.head.position.y = 1.25;
    } else if (action === 'walk') {
      avatar.isFalling = false;
      avatar.group.rotation.set(0, 0, 0);
      avatar.torso.position.y = 0.95;
      avatar.head.position.y = 1.62;
      avatar.walkCenter = { x: avatar.group.position.x, z: avatar.group.position.z };
      avatar.walkCenter.x = THREE.MathUtils.clamp(avatar.walkCenter.x, -1.5, 1.5);
      avatar.walkCenter.z = THREE.MathUtils.clamp(avatar.walkCenter.z, -1.0, 1.0);
    } else if (action === 'lie') {
      avatar.isFalling = false;
      avatar.group.position.set(1.85, 0, 1.05);
      avatar.group.rotation.x = Math.PI / 2;
      avatar.torso.position.y = 0.72;
      avatar.head.position.y = 1.35;
    } else if (action === 'fall') {
      avatar.isFalling = true;
      avatar.fallStartTime = performance.now() / 1000.0;
    }
  }

  updateAvatars(dt) {
    const now = performance.now() / 1000.0;

    for (let i = 0; i < this.avatars.length; i++) {
      const a = this.avatars[i];
      a.animTime += dt;

      if (a.isFalling) {
        const elapsed = now - a.fallStartTime;
        if (elapsed < 0.65) {
          const t = elapsed / 0.65;
          const easeIn = t * t;
          a.group.rotation.z = easeIn * (Math.PI / 2);
          a.torso.position.y = 0.95 * (1.0 - easeIn) + 0.28 * easeIn;
          a.head.position.y = 1.62 * (1.0 - easeIn) + 0.35 * easeIn;
        } else {
          a.group.rotation.z = Math.PI / 2;
          a.torso.position.y = 0.28;
          a.head.position.y = 0.35;
          a.activity = 'fallen';
        }
      } else if (a.activity === 'walk' && !this.isDragging) {
        a.walkPathAngle += dt * 0.85;
        const targetX = a.walkCenter.x + Math.sin(a.walkPathAngle) * a.walkRadius;
        const targetZ = a.walkCenter.z + Math.cos(a.walkPathAngle) * (a.walkRadius * 0.75);

        const dx = targetX - a.group.position.x;
        const dz = targetZ - a.group.position.z;
        if (Math.hypot(dx, dz) > 0.01) {
          a.group.rotation.y = Math.atan2(dx, dz);
        }

        a.group.position.x = THREE.MathUtils.clamp(targetX, -2.6, 2.6);
        a.group.position.z = THREE.MathUtils.clamp(targetZ, -1.9, 1.9);

        // Natural walking bob
        a.torso.position.y = 0.95 + Math.sin(a.animTime * 8) * 0.03;
        a.head.position.y = 1.62 + Math.sin(a.animTime * 8) * 0.03;
      } else if (a.activity === 'stand') {
        a.torso.position.y = 0.95 + Math.sin(a.animTime * 2) * 0.01;
        a.head.position.y = 1.62 + Math.sin(a.animTime * 2) * 0.01;
      }

      a.currentZone = this.calculateZoneFromCoords(a.group.position.x, a.group.position.z);
    }
  }

  calculateZoneFromCoords(x, z) {
    let col = 'B';
    if (x < -1.0) col = 'A';
    else if (x > 1.0) col = 'C';

    let row = '2';
    if (z < -0.75) row = '1';
    else if (z > 0.75) row = '3';

    return `${col}${row}`;
  }

  getPeoplePhysicalDescriptors() {
    const list = [];
    for (const a of this.avatars) {
      if (!a.active) continue;
      list.push({
        id: a.id,
        x: a.group.position.x,
        y: a.torso.position.y,
        z: a.group.position.z,
        activity: a.activity,
        radius: a.activity === 'fallen' || a.activity === 'lie' ? 0.65 : 0.35,
        speed: a.activity === 'walk' ? 1.0 : (a.isFalling ? 2.5 : 0.0)
      });
    }
    return list;
  }

  getGroundTruth() {
    return {
      peopleCount: this.avatars.length,
      primaryZone: this.avatars[0] ? this.avatars[0].currentZone : '--',
      primaryActivity: this.avatars[0] ? this.avatars[0].activity : 'empty',
      people: this.avatars.map(a => ({
        id: a.id,
        name: a.name,
        zone: a.currentZone,
        activity: a.activity,
        x: a.group.position.x.toFixed(2),
        z: a.group.position.z.toFixed(2)
      }))
    };
  }

  setLinkDisturbance(linkKey, disturbanceScore) {
    const link = this.linkLines[linkKey];
    if (!link) return;

    const norm = Math.min(1.0, Math.max(0.0, (disturbanceScore - 1.0) / 2.5));
    link.mat.opacity = 0.35 + norm * 0.65;
    if (norm > 0.4) {
      link.mat.color.setHex(0xec4899); // Magenta when disturbed
    } else {
      link.mat.color.setHex(linkKey === 'RX4' ? 0xfbbf24 : 0x00f0ff);
    }
  }

  updateFloorHeat(probabilities) {
    if (!probabilities || probabilities.length < 9) return;
    for (let i = 0; i < 9; i++) {
      const tile = this.floorTiles[i];
      const p = probabilities[i];
      tile.mat.opacity = 0.06 + p * 0.65;
      if (p > 0.35) {
        tile.mat.color.setHex(0xec4899);
      } else {
        tile.mat.color.setHex(0x00f0ff);
      }
    }
  }

  setCameraPreset(presetIndex, smooth = true) {
    let targetP = new THREE.Vector3();
    let targetL = new THREE.Vector3(0, 0.7, 0);

    if (presetIndex === 1) {
      // Top-Down
      targetP.set(0, 8.8, 0.01);
    } else if (presetIndex === 2) {
      // Presentation Isometric (Optimal room visibility)
      targetP.set(6.4, 5.8, 6.4);
    } else {
      // Free Orbit
      targetP.set(4.5, 3.8, 5.2);
    }

    if (!smooth) {
      this.camera.position.copy(targetP);
      this.controls.target.copy(targetL);
      this.controls.update();
    } else {
      this.cameraTargetPos.copy(targetP);
      this.cameraTargetLook.copy(targetL);
      this.isCameraTweening = true;
    }
  }

  setupInteractions() {
    const dom = this.renderer.domElement;

    dom.addEventListener('pointerdown', (e) => {
      const rect = dom.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      
      const hitObjects = [];
      for (let i = 0; i < this.avatars.length; i++) {
        const a = this.avatars[i];
        hitObjects.push({ obj: a.torso, avatarIndex: i });
        hitObjects.push({ obj: a.head, avatarIndex: i });
      }

      const intersects = this.raycaster.intersectObjects(hitObjects.map(h => h.obj));
      if (intersects.length > 0) {
        const hit = hitObjects.find(h => h.obj === intersects[0].object);
        if (hit) {
          this.selectAvatar(hit.avatarIndex);
          this.isDragging = true;
          this.draggedAvatar = this.avatars[hit.avatarIndex];
          this.controls.enabled = false;
        }
      }
    });

    dom.addEventListener('pointermove', (e) => {
      if (!this.isDragging || !this.draggedAvatar) return;

      const rect = dom.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      if (this.raycaster.ray.intersectPlane(this.floorPlane, this.dragPlaneIntersect)) {
        const clampedX = THREE.MathUtils.clamp(this.dragPlaneIntersect.x, -2.7, 2.7);
        const clampedZ = THREE.MathUtils.clamp(this.dragPlaneIntersect.z, -1.9, 1.9);
        this.draggedAvatar.group.position.x = clampedX;
        this.draggedAvatar.group.position.z = clampedZ;
        
        if (this.draggedAvatar.activity !== 'fallen' && this.draggedAvatar.activity !== 'lie') {
          this.draggedAvatar.activity = 'walk';
          this.draggedAvatar.walkCenter = { x: clampedX, z: clampedZ };
        }
      }
    });

    const endDrag = () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.draggedAvatar = null;
        this.controls.enabled = true;
      }
    };

    dom.addEventListener('pointerup', endDrag);
    dom.addEventListener('pointerleave', endDrag);
  }

  setTheme(theme) {
    this.currentTheme = theme;
    if (theme === 'office') {
      this.careFurnitureGroup.visible = false;
      this.officeFurnitureGroup.visible = true;
    } else {
      this.careFurnitureGroup.visible = true;
      this.officeFurnitureGroup.visible = false;
    }
  }

  setConcreteWall(enabled) {
    this.concreteWallEnabled = !!enabled;
    this.backWallMesh.material = this.concreteWallEnabled ? this.concreteWallMat : this.glassWallMat;
  }

  setCurtain(enabled) {
    this.curtainEnabled = !!enabled;
    this.curtainGroup.visible = this.curtainEnabled;
  }

  setRx4Visible(enabled) {
    this.rx4Enabled = !!enabled;
    if (this.rxNodes.RX4) {
      this.rxNodes.RX4.group.visible = this.rx4Enabled;
    }
    if (this.linkLines.RX4) {
      this.linkLines.RX4.line.visible = this.rx4Enabled;
    }
  }

  setFresnelVisible(enabled) {
    this.fresnelVisible = !!enabled;
    this.fresnelGroup.visible = this.fresnelVisible;
  }

  onResize() {
    this.width = this.container.clientWidth || 800;
    this.height = this.container.clientHeight || 600;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
    this.composer.setSize(this.width, this.height);
  }

  render() {
    const dt = this.clock.getDelta();

    // Smooth camera transition
    if (this.isCameraTweening) {
      this.camera.position.lerp(this.cameraTargetPos, 0.08);
      this.controls.target.lerp(this.cameraTargetLook, 0.08);
      if (this.camera.position.distanceTo(this.cameraTargetPos) < 0.04) {
        this.isCameraTweening = false;
      }
    }

    this.controls.update();

    // Animate avatars
    this.updateAvatars(dt);

    // Expanding Wi-Fi Wave Rings
    for (const r of this.wifiRings) {
      r.scale += dt * r.speed;
      if (r.scale > 3.8) r.scale = 0.2;
      r.mesh.scale.set(r.scale, r.scale, 1);
      r.mesh.material.opacity = Math.max(0, 0.6 * (1.0 - r.scale / 3.8));
    }

    // Subtle particle drift
    if (this.particles) {
      this.particles.rotation.y += dt * 0.02;
    }

    // Post-processed render
    this.composer.render();
  }
}
