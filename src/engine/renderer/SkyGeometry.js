/**
 * Cuubz — the sky's scene graph (PR 23)
 *
 * Split out of `SkyRenderer.js`. A PROTOTYPE MIXIN: every method below is the body it had
 * as a member of `Skybox`, `this` is still the `Skybox` instance, and no call site changed
 * (decision 44) — `initSkybox.js` still calls `skybox.init()` and `test/test_skybox.js`
 * still calls `new Skybox(null).dispose()`.
 *
 * This file owns every `THREE` object the skybox ever puts in the scene, across its whole
 * life: created (`init`, `_createClouds`, `_createSunMoonSprites`, `_createCloudCluster`,
 * `_spawnCloud`), maintained per frame (`_updateClouds` — drift, wrap, respawn), and torn
 * down (`dispose`, which removes exactly the six objects `init` added). `SkyRenderer.js`
 * keeps the per-frame *state* — where the sun points, what colour the sky is, what the HUD
 * says — and never constructs or destroys anything.
 *
 * FIELDS CROSSING THIS BOUNDARY: 13 — `renderer`, `sunLight`, `moonLight`, `ambientLight`,
 * `cloudLayer`, `cloudCount`, `cloudTargetCount`, `cloudMinAltitude`, `cloudMaxAltitude`,
 * `cloudSpreadRadius`, `cloudWrapDistance`, `sunSprite`, `moonSprite`. That is the highest
 * count in this split and it is unavoidable: eleven of the thirteen are the cloud system's
 * own configuration and handle, read by nothing outside these methods. The seam is real
 * because of the direction of the traffic, not its volume — nothing here reads
 * `timeOfDay`, and nothing outside constructs a `THREE` object.
 *
 * `_updateClouds` was carved out of `update`, which used to advance the clock, drive the
 * lighting and then run fifty lines of cloud pool management inline. `_createClouds`'s own
 * doc comment has always said the clouds are "Managed by _updateClouds() for wrapping and
 * distance culling" — a method that did not exist until this split. The comment is now
 * true.
 *
 * `dispose` moved with them for the same reason: it is the exact inverse of `init`, and the
 * only way to be sure the teardown list still matches the build list is for the two to be
 * in front of each other. Keeping it in `SkyRenderer.js` would also have left that file at
 * ~430 lines, over the ceiling.
 *
 * The `typeof THREE === 'undefined'` guards in `init`, `_createClouds` and
 * `_createSunMoonSprites` were provably dead — `THREE` is a module import, so it is
 * either bound or the module fails to load — and **PR 33 / D-27 removed all three**.
 * `init`'s `!this.renderer || !this.renderer.scene` half is PR 9's null-dereference fix
 * and is untouched.
 */

import * as THREE from 'three';
import { AMBIENT_LIGHT } from '../../game/data/DayNightCurves.js';

export const SkyGeometryMethods = {
  /**
   * Initialize Three.js sky elements
   */
  init() {
    // PR 9 / D-27: `typeof THREE === 'undefined'` used to short-circuit this whole
    // expression in Node, so `this.renderer.scene` was never evaluated there. THREE is
    // an import now, the guard is a constant `false`, and a null `renderer` reaches the
    // dereference. In the browser nothing changes — THREE was always defined there, so
    // the second half already ran — but the null check was always missing.
    //
    // PR 33 deleted the dead `typeof` half. **The null guard below is PR 9's actual
    // D-27 fix and must not be removed with it** — it is the only thing standing
    // between a null `renderer` and a TypeError.
    if (!this.renderer || !this.renderer.scene) return;

    const scene = this.renderer.scene;

    // Sun — directional light
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(this.sunLight);

    // Moon — dimmer blue-ish directional light (visible at night)
    this.moonLight = new THREE.DirectionalLight(0x8888cc, 0.5);
    scene.add(this.moonLight);

    // Ambient light — fills in shadows, varies with time of day
    this.ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_LIGHT.dayIntensity);
    scene.add(this.ambientLight);

    // Cloud layer — billboard approximation
    this._createClouds();

    // Initial sky state
    this._updateSkyState();
  },

  /**
   * Create cloud layer from white fluffy cubes.
   * Each cloud is a cluster of cubes arranged in a natural-looking puffy shape.
   * Clouds are placed at high altitude (150+) and drift slowly.
   * Managed by _updateClouds() for wrapping and distance culling.
   */
  _createClouds() {
    // D-27: `if (typeof THREE === 'undefined') return;` removed — constant-false.
    const cloudGroup = new THREE.Group();
    cloudGroup.userData.cloudSpeed = 0.4 + Math.random() * 0.3; // blocks/sec drift

    // ONE geometry and ONE material for every cloud cube this instance will ever build,
    // owned on the instance so `_updateClouds` uses the same pair and `dispose` can free
    // them. They used to be locals here AND be rebuilt, unconditionally, on every single
    // `_updateClouds` call — before the `while` loop that usually spawns nothing — under a
    // removal path commented "material is shared, don't dispose". They were not shared:
    // this method built its own separate pair, so every cloud spawned after init held a
    // geometry and a material that were never freed. The comment is true now.
    const cubeGeo = this._cloudGeo = new THREE.BoxGeometry(1, 1, 1);
    const cubeMat = this._cloudMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });

    // Sun and moon sprites (visible celestial bodies in the sky)
    this._createSunMoonSprites();

    // Generate cloud clusters spread across the sky
    for (let i = 0; i < this.cloudTargetCount; i++) {
      this._spawnCloud(cubeGeo, cubeMat, cloudGroup, true);
    }
    this.cloudCount = this.cloudTargetCount;

    if (this.renderer.scene) {
      this.renderer.scene.add(cloudGroup);
    }

    this.cloudLayer = cloudGroup;
  },

  /**
   * Spawn a single cloud cluster at a random position.
   * @param {THREE.Group} cloudGroup - Parent group
   * @param {boolean} initial - If true, spread evenly; if false, spawn at edge for wrapping
   */
  _spawnCloud(cubeGeo, cubeMat, cloudGroup, initial = false) {
    const cluster = this._createCloudCluster(cubeGeo, cubeMat);

    if (initial) {
      // Spread clouds evenly around origin for initial placement
      const angle = Math.random() * Math.PI * 2;
      const radius = 30 + Math.random() * this.cloudSpreadRadius;
      cluster.position.set(
        Math.cos(angle) * radius,
        this.cloudMinAltitude + Math.random() * (this.cloudMaxAltitude - this.cloudMinAltitude),
        Math.sin(angle) * radius
      );
    } else {
      // Spawn at the trailing edge (negative X relative to layer) for wrapping
      const zOffset = (Math.random() - 0.5) * this.cloudSpreadRadius * 1.5;
      cluster.position.set(
        -this.cloudWrapDistance,
        this.cloudMinAltitude + Math.random() * (this.cloudMaxAltitude - this.cloudMinAltitude),
        zOffset
      );
    }

    cluster.rotation.y = Math.random() * Math.PI;
    cluster.userData.driftSpeed = 0.3 + Math.random() * 0.4;
    cloudGroup.add(cluster);
  },

  /**
   * Create sprite-based sun and moon that orbit in the sky.
   * Sprites always face the camera, are cheap to render, and can carry
   * a soft glow halo via the generated canvas texture.
   */
  _createSunMoonSprites() {
    // D-27: `if (typeof THREE === 'undefined') return;` removed — constant-false. This
    // method still needs a real 2D canvas, which is why skyClouds.test.js stubs it out
    // rather than relying on the guard to make it a no-op in Node.
    // Generate a radial glow texture on a canvas (no external assets needed)
    const makeGlowTexture = (coreColor, glowColor, radius) => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const center = size / 2;

      // Outer glow
      const glow = ctx.createRadialGradient(center, center, 0, center, center, center);
      glow.addColorStop(0, coreColor);
      glow.addColorStop(0.15, coreColor);
      glow.addColorStop(0.4, glowColor);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);

      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    };

    // Sun sprite — warm yellow core with orange glow
    const sunTexture = makeGlowTexture('rgba(255,255,220,1)', 'rgba(255,200,50,0.6)', 128);
    const sunMat = new THREE.SpriteMaterial({
      map: sunTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sunSprite = new THREE.Sprite(sunMat);
    this.sunSprite.scale.set(40, 40, 1);
    this.renderer.scene.add(this.sunSprite);

    // Moon sprite — pale white core with soft blue glow
    const moonTexture = makeGlowTexture('rgba(220,220,240,1)', 'rgba(150,160,220,0.5)', 128);
    const moonMat = new THREE.SpriteMaterial({
      map: moonTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.moonSprite = new THREE.Sprite(moonMat);
    this.moonSprite.scale.set(30, 30, 1);
    this.renderer.scene.add(this.moonSprite);
  },

  /**
   * Create a single fluffy cloud cluster from multiple cubes.
   * Uses a layered approach: wider base, narrower top for natural look.
   */
  _createCloudCluster(cubeGeo, cubeMat) {
    const cluster = new THREE.Group();

    // Cloud parameters — significantly larger clouds
    const length = 8 + Math.floor(Math.random() * 8); // 8-15 cubes long (was 4-8)
    const baseWidth = 4 + Math.floor(Math.random() * 3); // 4-6 cubes wide (was 2-3)

    // Layer 1: Bottom layer — widest, forms the base
    for (let x = 0; x < length; x++) {
      const w = baseWidth + (Math.random() > 0.4 ? 1 : 0);
      for (let z = -Math.floor(w / 2); z <= Math.floor(w / 2); z++) {
        const cube = new THREE.Mesh(cubeGeo, cubeMat);
        const scale = 3.0 + Math.random() * 2.0; // 3.0-5.0 (was 1.5-2.5)
        cube.scale.set(scale, scale * 0.8, scale);
        cube.position.set(
          (x - length / 2 + 0.5) * 2.5,
          0,
          z * 2.5
        );
        cluster.add(cube);
      }
    }

    // Layer 2: Middle layer — slightly narrower, taller
    for (let x = 1; x < length - 1; x++) {
      const w = Math.max(2, baseWidth - 1 + (Math.random() > 0.5 ? 1 : 0));
      for (let z = -Math.floor(w / 2); z <= Math.floor(w / 2); z++) {
        const cube = new THREE.Mesh(cubeGeo, cubeMat);
        const scale = 2.5 + Math.random() * 1.8; // 2.5-4.3 (was 1.3-2.1)
        cube.scale.set(scale, scale * 0.9, scale);
        cube.position.set(
          (x - length / 2 + 0.5) * 2.5,
          2.2,
          z * 2.5
        );
        cluster.add(cube);
      }
    }

    // Layer 3: Top puffs — sparse, creates the fluffy peaks
    const topCount = 4 + Math.floor(Math.random() * 4); // 4-7 (was 2-4)
    for (let i = 0; i < topCount; i++) {
      const cube = new THREE.Mesh(cubeGeo, cubeMat);
      const scale = 2.0 + Math.random() * 2.2; // 2.0-4.2 (was 1.0-2.2)
      cube.scale.set(scale, scale * 1.1, scale);
      cube.position.set(
        (Math.random() - 0.5) * (length - 2) * 2.5,
        4.0 + Math.random() * 1.5,
        (Math.random() - 0.5) * baseWidth * 2.5
      );
      cluster.add(cube);
    }

    return cluster;
  },

  /**
   * Drift the cloud pool, wrap the ones that have gone too far, and follow the player.
   * Carved out of `update()` verbatim — this is the second half of that method.
   * @param {number} deltaTime — Seconds since last frame
   * @param {THREE.Vector3} [playerPos] — Optional player position for following clouds/sky
   */
  _updateClouds(deltaTime, playerPos) {
    // Drift clouds and manage wrapping/culling
    if (this.cloudLayer) {
      const baseSpeed = this.cloudLayer.userData.cloudSpeed || 0.4;
      let needsRespawn = [];

      for (let i = 0; i < this.cloudLayer.children.length; i++) {
        const cluster = this.cloudLayer.children[i];
        const speed = cluster.userData.driftSpeed || baseSpeed;
        cluster.position.x += speed * deltaTime;

        // Mark clouds that have drifted too far for removal
        if (cluster.position.x > this.cloudWrapDistance) {
          needsRespawn.push(i);
        }
      }

      // Remove old clouds (iterate backwards to avoid index issues)
      for (let i = needsRespawn.length - 1; i >= 0; i--) {
        const cluster = this.cloudLayer.children[needsRespawn[i]];
        this.cloudLayer.remove(cluster);
        // The geometry and material genuinely ARE shared (this._cloudGeo / this._cloudMat,
        // built once in _createClouds and freed in dispose), so there is nothing to
        // dispose per cluster. What used to stand here was a full `cluster.traverse` with
        // an empty body — a subtree walk over every cube of every wrapped cloud, doing
        // nothing.
        this.cloudCount--;
      }

      // Spawn new clouds to maintain target count, reusing the one geometry/material pair.
      // These two were allocated here on EVERY call, before this loop, whether or not any
      // cloud was actually spawned — a per-frame THREE leak.
      while (this.cloudCount < this.cloudTargetCount) {
        this._spawnCloud(this._cloudGeo, this._cloudMat, this.cloudLayer, false);
        this.cloudCount++;
      }
    }

    // Move clouds to follow player (infinite sky illusion)
    if (playerPos && this.cloudLayer) {
      this.cloudLayer.position.x = playerPos.x;
      this.cloudLayer.position.z = playerPos.z;
      // Keep cloud layer Y at 0 so cloud altitudes are absolute world Y
      this.cloudLayer.position.y = 0;
    }
  },

  /**
   * Dispose of Three.js resources.
   */
  dispose() {
    if (this.sunLight && this.renderer.scene) {
      this.renderer.scene.remove(this.sunLight);
    }
    if (this.moonLight && this.renderer.scene) {
      this.renderer.scene.remove(this.moonLight);
    }
    if (this.ambientLight && this.renderer.scene) {
      this.renderer.scene.remove(this.ambientLight);
    }
    if (this.cloudLayer && this.renderer.scene) {
      this.renderer.scene.remove(this.cloudLayer);
    }
    // The one geometry/material pair every cloud cube shares. Removing the group from the
    // scene does not free GPU resources; these two calls are what do.
    if (this._cloudGeo) {
      this._cloudGeo.dispose();
      this._cloudGeo = null;
    }
    if (this._cloudMat) {
      this._cloudMat.dispose();
      this._cloudMat = null;
    }
    if (this.sunSprite && this.renderer.scene) {
      this.renderer.scene.remove(this.sunSprite);
      if (this.sunSprite.material.map) this.sunSprite.material.map.dispose();
      this.sunSprite.material.dispose();
    }
    if (this.moonSprite && this.renderer.scene) {
      this.renderer.scene.remove(this.moonSprite);
      if (this.moonSprite.material.map) this.moonSprite.material.map.dispose();
      this.moonSprite.material.dispose();
    }
    this.sunLight = null;
    this.moonLight = null;
    this.ambientLight = null;
    this.cloudLayer = null;
    this.sunSprite = null;
    this.moonSprite = null;
  },
};
