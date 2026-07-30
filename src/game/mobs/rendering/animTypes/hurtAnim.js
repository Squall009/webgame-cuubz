/**
 * Cuubz — Hurt Animation
 * Shared hurt reaction: red flash, recoil push back.
 */

import * as THREE from 'three';

/**
 * Apply hurt reaction to a mob's render group.
 * @param {THREE.Group} group
 * @param {number} progress - 0 to 1 animation progress
 */
export function hurtReaction(group, progress) {
  // Red emissive flash (4 rapid pulses)
  const flashIntensity = Math.sin(progress * Math.PI * 8) > 0 ? 0.5 : 0;

  group.traverse(child => {
    if (child.isMesh && child.material) {
      if (!child.material._origEmissive) {
        child.material._origEmissive = child.material.emissive ? child.material.emissive.clone() : new THREE.Color(0x000000);
        child.material._origEmissiveIntensity = child.material.emissiveIntensity || 0;
      }
      // Check for emissive parts - they get boosted red
      if (child.material.emissive && child.material.emissive.getHex() !== 0) {
        // Emissive parts: mix red into their glow
        child.material.emissive.setHex(0xff2200);
      } else if (flashIntensity > 0) {
        // Non-emissive parts: brief red flash
        child.material.emissive = new THREE.Color(0xff0000);
      }
      child.material.emissiveIntensity = flashIntensity;
    }
  });

  // Recoil push back (first 40% of animation)
  if (progress < 0.4) {
    const push = -(progress / 0.4) * 0.1;
    group.position.z += push;
  }

  // Reset after completion
  if (progress >= 1) {
    group.traverse(child => {
      if (child.isMesh && child.material) {
        if (child.material._origEmissive) {
          child.material.emissive = child.material._origEmissive;
          child.material.emissiveIntensity = child.material._origEmissiveIntensity;
        } else {
          child.material.emissive = new THREE.Color(0x000000);
          child.material.emissiveIntensity = 0;
        }
      }
    });
  }
}
