/**
 * Cuubz — Procedural 3D Mob Model Builder
 * Constructs a THREE.Group from a mob definition's geometry parts array.
 * Supports: box, sphere, cylinder, cone primitives. (`capsule` was a fifth, and was
 * removed as D-88 — see the note at the bottom of this file.)
 * Each part becomes a named child mesh for animation look-up.
 */

import * as THREE from 'three';

export class MobModelBuilder {
  /**
   * Build a complete 3D mob model from its definition.
   * @param {object} mobDefinition - Entry from MOB_DEFINITIONS
   * @returns {THREE.Group} Assembled model group
   */
  static build(mobDefinition) {
    // D-27: this used to open with
    //   `if (typeof THREE === 'undefined') { console.warn(…); return new THREE.Group(); }`
    // which was dead twice over — `THREE` is a module import here, so the branch never
    // ran, and its body dereferenced the very binding it claimed was missing.
    const group = new THREE.Group();
    const geo = mobDefinition.geometry;
    if (!geo || !geo.parts) return group;

    const parts = {}; // id → THREE.Mesh
    const initialTransforms = {};

    // ── 1. Create all geometry parts ──
    for (const partDef of geo.parts) {
      const mesh = MobModelBuilder._createPart(partDef);
      if (mesh) {
        mesh.name = partDef.id;
        group.add(mesh);
        parts[partDef.id] = mesh;

        // Store initial transforms for animation reference
        initialTransforms[partDef.id] = {
          position: mesh.position.clone(),
          rotation: mesh.rotation.clone(),
          scale: mesh.scale.clone(),
        };
      }
    }

    // ── 2. Add eye highlights ──
    if (geo.eyes && geo.eyes.positions) {
      for (let i = 0; i < geo.eyes.positions.length; i++) {
        const pos = geo.eyes.positions[i];
        const eye = new THREE.Mesh(
          new THREE.SphereGeometry(geo.eyes.size || 0.05, 8, 8),
          new THREE.MeshBasicMaterial({ color: geo.eyes.color || 0x000000, fog: true })
        );
        eye.position.set(pos[0], pos[1], pos[2]);
        eye.name = `eye_${i}`;
        group.add(eye);
        parts[`eye_${i}`] = eye;
        initialTransforms[`eye_${i}`] = {
          position: eye.position.clone(),
          rotation: eye.rotation.clone(),
          scale: eye.scale.clone(),
        };
      }
    }

    // Store for animation access
    group.userData.parts = parts;
    group.userData.initialTransforms = initialTransforms;
    group.userData.mobType = mobDefinition.name;

    return group;
  }

  /**
   * Create a single mesh part from its definition.
   * @param {object} partDef - Part definition from geometry.parts array
   * @returns {THREE.Mesh|null}
   */
  static _createPart(partDef) {
    let geometry;

    switch (partDef.type) {
      case 'box':
        geometry = new THREE.BoxGeometry(partDef.size[0], partDef.size[1], partDef.size[2]);
        break;

      case 'sphere':
        geometry = new THREE.SphereGeometry(partDef.radius, 10, 8);
        break;

      case 'cylinder':
        geometry = new THREE.CylinderGeometry(
          partDef.radiusTop || partDef.radius || 0.1,
          partDef.radiusBottom || partDef.radius || 0.1,
          partDef.height || 0.5,
          8
        );
        break;

      case 'cone':
        geometry = new THREE.ConeGeometry(partDef.radius || 0.1, partDef.height || 0.3, 8);
        break;

      // D-88: there was a `case 'capsule'` here, delegating to a `_buildCapsule` static
      // that ended in `merged.mergeBufferGeometries(geometries)`. That is not a method of
      // `THREE.BufferGeometry` in ANY three version — it lives on
      // `BufferGeometryUtils` — so the branch was a guaranteed TypeError, and it returned
      // an empty `new THREE.BufferGeometry()` in the impossible case that it did not throw.
      // Both are gone. See the note under `_createPart`.
      default:
        console.warn(`[MobModelBuilder] Unknown part type: ${partDef.type}`);
        return null;
    }

    // Convert position/rotation arrays to Vector3/Euler
    const pos = partDef.position || [0, 0, 0];
    const rot = partDef.rotation || [0, 0, 0];

    // Create material
    const material = new THREE.MeshStandardMaterial({
      color: partDef.color !== undefined ? partDef.color : 0x888888,
      roughness: partDef.roughness !== undefined ? partDef.roughness : 0.7,
      metalness: partDef.metalness !== undefined ? partDef.metalness : 0.0,
      flatShading: true,
      fog: true,
    });

    // Handle transparent parts (e.g., wisp aura)
    if (partDef.transparent) {
      material.transparent = true;
      material.opacity = partDef.opacity !== undefined ? partDef.opacity : 0.5;
      material.depthWrite = false;
    }

    // Handle emissive parts (e.g., golem core)
    if (partDef.emissive !== undefined) {
      material.emissive = new THREE.Color(partDef.emissive);
      material.emissiveIntensity = partDef.emissiveIntensity !== undefined ? partDef.emissiveIntensity : 0.5;
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);

    // Shadow casting
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Store pivot data for animation (rotational joint center)
    if (partDef.pivot) {
      mesh.userData.pivot = new THREE.Vector3(partDef.pivot[0], partDef.pivot[1], partDef.pivot[2]);
    }

    return mesh;
  }

  // ─── D-88: `_buildCapsule` WAS HERE, AND IS DELETED RATHER THAN FIXED ───────
  //
  // It built a cylinder plus two hemispheres into a THREE.Group, cloned their geometries
  // with `applyMatrix4`, and then called `merged.mergeBufferGeometries(geometries)` on a
  // freshly-constructed `THREE.BufferGeometry`. `mergeBufferGeometries` is not a method of
  // `BufferGeometry` in any three version; in the pinned 0.134 it is a free function in
  // `three/examples/jsm/utils/BufferGeometryUtils.js`. The branch was a TypeError on its
  // first execution, and it had never executed: no entry in `MOB_DEFINITIONS` uses
  // `type: 'capsule'`, which is why 17 PRs of green tests never touched it.
  //
  // WHY DELETED AND NOT FIXED. Fixing it correctly means importing `BufferGeometryUtils`,
  // which would be this repo's first and only import out of three's `examples/jsm` tree —
  // a new dependency edge, on an unpinned-by-`test/unit/meta/threePin.test.js` subpath,
  // added to serve zero call sites. That is precisely the trade PR 34's ruling on the five
  // deferred gameplay modules settles the other way: unexecuted code is deleted, not wired,
  // and a feature restores it *with a design*. A future mob definition that wants a capsule
  // adds a working builder and a test in the same change; today the only thing the branch
  // could do is turn a new definition's first spawn into a crash.
  //
  // The four surviving primitives (`box`, `sphere`, `cylinder`, `cone`) all construct their
  // geometry inline in `_createPart` and are each exercised by
  // `test/unit/game/mobRendering.test.js`'s "non-empty model for every entry in
  // MOB_DEFINITIONS" case.
}
