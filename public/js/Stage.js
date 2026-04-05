// ============================================================
// H4KKEN - Stage (Arena, Lighting, Environment)
// Bright tournament arena with proper fighting-game aesthetics
// ============================================================

import * as THREE from 'three';

export class Stage {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    this.time = 0;
    this.build();
  }

  build() {
    // Main arena platform (raised slightly)
    const arenaRadius = 14;
    const platformGeo = new THREE.CylinderGeometry(arenaRadius, arenaRadius + 0.3, 0.6, 64);
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0xc8b89a,
      metalness: 0.15,
      roughness: 0.55,
    });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = -0.3;
    platform.receiveShadow = true;
    platform.castShadow = true;
    this.scene.add(platform);
    this.objects.push(platform);

    // Inner fighting area — darker polished stone
    const fightAreaGeo = new THREE.CylinderGeometry(10, 10, 0.08, 64);
    const fightAreaMat = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      metalness: 0.3,
      roughness: 0.35,
    });
    const fightArea = new THREE.Mesh(fightAreaGeo, fightAreaMat);
    fightArea.position.y = 0.01;
    fightArea.receiveShadow = true;
    this.scene.add(fightArea);
    this.objects.push(fightArea);

    // Center line
    const centerGeo = new THREE.PlaneGeometry(0.06, 6);
    const centerMat = new THREE.MeshBasicMaterial({
      color: 0xffd700, transparent: true, opacity: 0.5,
    });
    const centerLine = new THREE.Mesh(centerGeo, centerMat);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.y = 0.06;
    this.scene.add(centerLine);

    // Fighting ring boundary — golden accent ring
    const ringGeo = new THREE.TorusGeometry(10, 0.08, 8, 64);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffd700, metalness: 0.8, roughness: 0.2,
      emissive: 0xaa8800, emissiveIntensity: 0.3,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    this.scene.add(ring);
    this.objects.push(ring);

    // Outer edge ring
    const outerRingGeo = new THREE.TorusGeometry(arenaRadius, 0.12, 8, 64);
    const outerRingMat = new THREE.MeshStandardMaterial({
      color: 0x997744, metalness: 0.5, roughness: 0.4,
    });
    const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRing.rotation.x = Math.PI / 2;
    outerRing.position.y = 0.02;
    this.scene.add(outerRing);
    this.objects.push(outerRing);

    // Ground plane beyond arena
    const groundGeo = new THREE.PlaneGeometry(200, 200);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x6b8f5e, metalness: 0.0, roughness: 0.9,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.6;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Decorative pillars with brazier lights
    const pillarAngles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    const pillarDist = arenaRadius + 1.5;

    pillarAngles.forEach((angle, i) => {
      const px = Math.cos(angle) * pillarDist;
      const pz = Math.sin(angle) * pillarDist;

      // Stone pillar base
      const baseGeo = new THREE.CylinderGeometry(0.45, 0.55, 0.8, 8);
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x887766, roughness: 0.7 });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.set(px, 0.1, pz);
      base.castShadow = true;
      this.scene.add(base);

      // Main column
      const colGeo = new THREE.CylinderGeometry(0.3, 0.35, 5, 8);
      const colMat = new THREE.MeshStandardMaterial({ color: 0x998877, metalness: 0.1, roughness: 0.6 });
      const col = new THREE.Mesh(colGeo, colMat);
      col.position.set(px, 3, pz);
      col.castShadow = true;
      this.scene.add(col);

      // Top cap
      const capGeo = new THREE.CylinderGeometry(0.5, 0.35, 0.4, 8);
      const capMat = new THREE.MeshStandardMaterial({ color: 0xaa9977, metalness: 0.2, roughness: 0.5 });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(px, 5.7, pz);
      cap.castShadow = true;
      this.scene.add(cap);

      // Brazier flame
      const flame = new THREE.PointLight(i % 2 === 0 ? 0xff6622 : 0xff8844, 1.2, 18, 1.5);
      flame.position.set(px, 6.3, pz);
      flame.castShadow = false;
      this.scene.add(flame);
      this.objects.push(flame);
    });

    // Backdrop: mountains and trees
    this.createBackdrop();

    // Lighting
    this.setupLighting();

    // Sky dome — bright gradient
    const skyGeo = new THREE.SphereGeometry(90, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor:    { value: new THREE.Color(0x3388cc) },
        horizColor:  { value: new THREE.Color(0x99ccee) },
        bottomColor: { value: new THREE.Color(0x88aa77) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPosition = wp.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          vec3 color;
          if (h > 0.0) {
            color = mix(horizColor, topColor, pow(h, 0.5));
          } else {
            color = mix(horizColor, bottomColor, pow(-h, 0.4));
          }
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);

    // Subtle distant fog (doesn't darken fighters)
    this.scene.fog = new THREE.Fog(0x99ccee, 40, 90);
  }

  setupLighting() {
    // Strong ambient — characters always clearly visible
    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(ambient);

    // Hemisphere — natural sky+ground lighting
    const hemi = new THREE.HemisphereLight(0x88bbff, 0x445522, 0.6);
    hemi.position.set(0, 20, 0);
    this.scene.add(hemi);

    // Sun key light from above-right
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.6);
    sun.position.set(8, 18, 10);
    sun.castShadow = true;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 50;
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.bias = -0.001;
    this.scene.add(sun);

    // Fill from opposite side
    const fill = new THREE.DirectionalLight(0xaaccff, 0.5);
    fill.position.set(-10, 10, -5);
    this.scene.add(fill);

    // Front fill — prevent dark camera-facing sides
    const frontFill = new THREE.DirectionalLight(0xffeedd, 0.35);
    frontFill.position.set(0, 5, 15);
    this.scene.add(frontFill);
  }

  createBackdrop() {
    // Distant mountains
    const mountainDefs = [
      { x: -45, z: -55, h: 22, r: 14, c: 0x667766 },
      { x: -25, z: -60, h: 30, r: 18, c: 0x5a6b5a },
      { x:   5, z: -65, h: 35, r: 20, c: 0x556655 },
      { x:  30, z: -58, h: 25, r: 15, c: 0x607060 },
      { x:  50, z: -55, h: 20, r: 12, c: 0x6b7b6b },
      { x: -55, z: -50, h: 18, r: 11, c: 0x708070 },
      { x:  55, z: -60, h: 24, r: 16, c: 0x5e6e5e },
    ];

    mountainDefs.forEach(m => {
      const geo = new THREE.ConeGeometry(m.r, m.h, 6);
      const mat = new THREE.MeshStandardMaterial({
        color: m.c, roughness: 0.9, flatShading: true
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(m.x, m.h / 2 - 2, m.z);
      mesh.rotation.y = Math.random() * Math.PI;
      this.scene.add(mesh);
    });

    // Snow caps on taller mountains
    mountainDefs.filter(m => m.h > 25).forEach(m => {
      const capGeo = new THREE.ConeGeometry(m.r * 0.35, m.h * 0.2, 6);
      const capMat = new THREE.MeshStandardMaterial({
        color: 0xdde8dd, roughness: 0.7, flatShading: true
      });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(m.x, m.h - 2, m.z);
      cap.rotation.y = Math.random() * Math.PI;
      this.scene.add(cap);
    });

    // Trees around the arena
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const dist = 20 + Math.random() * 12;
      const tx = Math.cos(angle) * dist;
      const tz = Math.sin(angle) * dist;
      const s = 0.7 + Math.random() * 0.8;

      // Trunk
      const trunkGeo = new THREE.CylinderGeometry(0.15 * s, 0.25 * s, 3 * s, 6);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x664422, roughness: 0.9 });
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(tx, 1.5 * s - 0.6, tz);
      trunk.castShadow = true;
      this.scene.add(trunk);

      // Foliage layers
      for (let j = 0; j < 3; j++) {
        const r = (2.2 - j * 0.5) * s;
        const h = (2.0 - j * 0.3) * s;
        const y = (2.5 + j * 1.4) * s - 0.6;
        const leafGeo = new THREE.ConeGeometry(r, h, 7);
        const green = 0x2e6b1e + (j * 0x0a1a08);
        const leafMat = new THREE.MeshStandardMaterial({
          color: green, roughness: 0.8, flatShading: true
        });
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.position.set(tx, y, tz);
        leaf.rotation.y = Math.random() * Math.PI;
        leaf.castShadow = true;
        this.scene.add(leaf);
      }
    }
  }

  update(deltaTime) {
    this.time += deltaTime;

    // Flicker brazier lights
    for (const obj of this.objects) {
      if (obj.isPointLight) {
        obj.intensity = 1.0 + Math.sin(this.time * 6 + obj.position.x) * 0.3
                            + Math.sin(this.time * 9.7 + obj.position.z) * 0.15;
      }
    }
  }
}
