/**
 * Cuubz — Mesh lifecycle: geometry, materials, the scene graph and disposal (PR 23)
 *
 * Split out of ChunkManager.js. A PROTOTYPE MIXIN: every method below is the byte-identical
 * body it had as a class member and `this` is still the ChunkManager instance, so no call
 * site — internal or external — changed.
 *
 * FIELDS CROSSING THIS BOUNDARY: 7 — `_disposed`, `loadedMeshes`, `_rebuilding`,
 * `renderer`, `textureAtlas`, `memoryCache` (`rebuildAllMeshes` only) and `stats`.
 * This is the sub-cut of the 456-line mesh
 * pipeline; ChunkMeshCoordinator.js holds the other half and calls `this._onMeshBuilt`
 * across the boundary exactly as it always did.
 *
 * This is the only file in the split that owns GPU resources. `_unloadMesh` and
 * `_disposeOldMeshes` are byte-for-byte the same thirteen lines under two names — see
 * the note in ChunkManager.js; they are NOT merged here, because a mechanical extraction
 * is the wrong PR to change behaviour in, and the duplication is now visible in one file
 * instead of spread through a 2,000-line monolith.
 */

import * as THREE from 'three';
import { CHUNK_W, CHUNK_D } from './ChunkConstants.js';

export const ChunkMeshLifecycleMethods = {
  /** Handle completed mesh build result. */
  _onMeshBuilt(key, cx, cz, geoResult) {
    if (this._disposed) return;
    this._rebuilding.delete(key);

    // Dispose old meshes for this chunk
    this._disposeOldMeshes(key);

    if (!geoResult) {
      this.loadedMeshes.set(key, null);
      return;
    }

    const texMap = this.textureAtlas ? this.textureAtlas.getTexture() : null;
    const pbrFactory = this.renderer ? this.renderer.getPBRFactory() : null;

    let solidMesh = null;
    let cutoutMesh = null;
    let transMesh = null;

    // ── Solid mesh ──────────────────────────────────────────────────
    let solidGeo = null;
    if (geoResult.solid) {
      solidGeo = this._wrapBuffers(geoResult.solid);
    } else if (geoResult.solidGeometry) {
      solidGeo = geoResult.solidGeometry;
    }
    if (solidGeo) {
      const material = pbrFactory
        ? pbrFactory.createSolid(0.0)
        : new THREE.MeshLambertMaterial({ map: texMap, color: 0xffffff, fog: true });
      solidMesh = new THREE.Mesh(solidGeo, material);
      solidMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
      solidMesh.receiveShadow = true;
      solidMesh.castShadow = true;
    }

    // ── Cutout mesh ─────────────────────────────────────────────────
    let cutoutGeo = null;
    if (geoResult.cutout) {
      cutoutGeo = this._wrapBuffers(geoResult.cutout);
    } else if (geoResult.cutoutGeometry) {
      cutoutGeo = geoResult.cutoutGeometry;
    }
    if (cutoutGeo) {
      const material = pbrFactory
        ? pbrFactory.createCutout(0.0, 0.5)
        : new THREE.MeshLambertMaterial({
            map: texMap, color: 0xffffff, transparent: true, alphaToCoverage: true,
            depthWrite: true, fog: true, side: THREE.DoubleSide
          });
      cutoutMesh = new THREE.Mesh(cutoutGeo, material);
      cutoutMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
      cutoutMesh.receiveShadow = true;
      cutoutMesh.castShadow = true;
    }

    // ── Transparent mesh ────────────────────────────────────────────
    let transGeo = null;
    if (geoResult.trans) {
      transGeo = this._wrapBuffers(geoResult.trans);
    } else if (geoResult.transparentGeometry) {
      transGeo = geoResult.transparentGeometry;
    }
    if (transGeo) {
      const material = pbrFactory
        ? pbrFactory.createTransparent(0.0, 0.6)
        : new THREE.MeshLambertMaterial({
            map: texMap, color: 0xffffff, transparent: true, opacity: 0.6,
            depthWrite: false, fog: true, side: THREE.DoubleSide
          });
      transMesh = new THREE.Mesh(transGeo, material);
      transMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
      transMesh.receiveShadow = true;
    }

    // Add to scene graph
    if (this.renderer && this.renderer.chunkGroup) {
      if (solidMesh) this.renderer.chunkGroup.add(solidMesh);
      if (cutoutMesh) this.renderer.chunkGroup.add(cutoutMesh);
      if (transMesh) this.renderer.chunkGroup.add(transMesh);
    }

    this.loadedMeshes.set(key, { solid: solidMesh, cutout: cutoutMesh, trans: transMesh });
    this.stats.meshesBuilt++;
  },

  /** Wrap raw buffer data into THREE.BufferGeometry. */
  _wrapBuffers(data) {
    if (!data || !data.pos) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(data.norm), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(data.uv), 2));
    // Vertex color attribute for humidity-based tinting — always present (defaults to white)
    if (data.color && data.color.byteLength > 0) {
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(data.color), 3));
    } else {
      // Fallback: all-white vertex colors so the shader always has the attribute
      const posCount = new Float32Array(data.pos).length / 3;
      const whiteColors = new Float32Array(posCount * 3);
      whiteColors.fill(1.0);
      geo.setAttribute('color', new THREE.BufferAttribute(whiteColors, 3));
    }
    if (data.idx && data.idx.byteLength > 0) {
      const idx = new Uint16Array(data.idx);
      if (idx.length > 0) geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    // Required for Three.js raycaster to compute hit point/faceNormal
    geo.computeBoundingSphere();
    return geo;
  },

  // ============================================================
  // MESH UNLOADING / DISPOSAL
  // ============================================================

  /** Unload a chunk's mesh from the scene. */
  _unloadMesh(key) {
    const entry = this.loadedMeshes.get(key);
    if (!entry) return;

    for (const mesh of [entry.solid, entry.cutout, entry.trans]) {
      if (!mesh) continue;
      if (this.renderer && this.renderer.chunkGroup) this.renderer.chunkGroup.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    }

    this.loadedMeshes.delete(key);
  },

  /** Dispose old meshes for a chunk before replacing with new build. */
  _disposeOldMeshes(key) {
    const existing = this.loadedMeshes.get(key);
    if (!existing) return;

    for (const mesh of [existing.solid, existing.cutout, existing.trans]) {
      if (!mesh) continue;
      if (this.renderer && this.renderer.chunkGroup) this.renderer.chunkGroup.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    }

    this.loadedMeshes.delete(key);
  },

  /**
   * Rebuild all loaded chunk meshes with new materials.
   * Called when texture resolution or advanced shading changes.
   * Marks all chunks as changed so they get rebuilt in the next render tick.
   */
  rebuildAllMeshes() {
    console.log(`[ChunkManager] Rebuilding all meshes (${this.loadedMeshes.size} loaded)`);
    for (const [key] of this.loadedMeshes) {
      const chunk = this.memoryCache.get(key);
      if (chunk) {
        chunk.changed = true;
      }
    }
  },
};
