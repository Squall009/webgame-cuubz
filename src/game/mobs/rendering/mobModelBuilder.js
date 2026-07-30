/**
 * Cuubz — Procedural 3D Mob Model Builder
 * Constructs a THREE.Group from a mob definition's geometry parts array.
 * Supports: box, sphere, cylinder, cone, capsule primitives.
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
    if (typeof THREE === 'undefined') {
      console.warn('[MobModelBuilder] THREE not available — returning empty group');
      return new THREE.Group();
    }

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

      case 'capsule':
        geometry = MobModelBuilder._buildCapsule(
          partDef.radius || 0.1,
          partDef.length || 0.3,
          8, 6
        );
        break;

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

  /**
   * Build a capsule geometry (cylinder + 2 half-spheres at ends).
   * @param {number} radius
   * @param {number} length - Length of the cylindrical section
   * @param {number} radialSegs
   * @param {number} heightSegs
   * @returns {THREE.BufferGeometry}
   */
  static _buildCapsule(radius, length, radialSegs, heightSegs) {
    const group = new THREE.Group();

    // Middle cylinder
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, radialSegs)
    );
    cyl.position.y = 0;
    group.add(cyl);

    // Top hemisphere
    const topCap = new THREE.Mesh(
      new THREE.SphereGeometry(radius, radialSegs, heightSegs, 0, Math.PI * 2, 0, Math.PI / 2)
    );
    topCap.position.y = length / 2;
    group.add(topCap);

    // Bottom hemisphere
    const botCap = new THREE.Mesh(
      new THREE.SphereGeometry(radius, radialSegs, heightSegs, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)
    );
    botCap.position.y = -length / 2;
    group.add(botCap);

    // Merge into single geometry
    const merged = new THREE.BufferGeometry();
    const geometries = [];
    group.children.forEach(child => {
      if (child.geometry) {
        child.updateMatrix();
        geometries.push(child.geometry.clone().applyMatrix4(child.matrix));
      }
    });
    merged.mergeBufferGeometries(geometries);

    // Clean up
    group.children.forEach(child => {
      child.geometry.dispose();
    });

    return merged;
  }
}
