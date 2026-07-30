/**
 * Cuubz — dropped items (PR 17)
 *
 * `refactor.md` §4.1 has this file as `js/systems/droppedItems.js`'s destination. There
 * is no such file: the whole thing was an **object literal declared inside `startGame()`**
 * — 90 lines of gravity, bob animation, pickup radius and lifetime decay, with a `scene`
 * captured from the renderer. This is that object, with `createDroppedItems(scene)` as
 * the only change, so nothing about the update maths moved.
 *
 * It is not a `System` subclass yet — `PR 20` introduces the base class and converts the
 * systems one at a time. Its `update(delta, playerPos, inventory)` signature is what the
 * render loop already calls.
 */

import * as THREE from 'three';
import { getBlockColor } from '../data/BlockColors.js';

/**
 * @param {THREE.Scene} scene
 * @param {(msg: string) => void} log
 */
export function createDroppedItems(scene, log) {
  return {
    drops: [],
    scene,

    addDrop(typeId, worldPos) {
      const color = getBlockColor(typeId);
      const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
      const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.85 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(worldPos.x + 0.5, worldPos.y + 0.5, worldPos.z + 0.5);
      this.scene.add(mesh);

      this.drops.push({
        mesh,
        typeId,
        velocity: {
          x: (Math.random() - 0.5) * 2,
          y: 3 + Math.random() * 2,
          z: (Math.random() - 0.5) * 2,
        },
        bobPhase: Math.random() * Math.PI * 2,
        landed: false,
        landedY: worldPos.y + 0.5,
        lifetime: 120, // seconds before disappearing
      });
    },

    update(delta, playerPos, inventory) {
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const drop = this.drops[i];

        // Gravity when not landed
        if (!drop.landed) {
          drop.velocity.y -= 15 * delta;
          drop.mesh.position.x += drop.velocity.x * delta;
          drop.mesh.position.y += drop.velocity.y * delta;
          drop.mesh.position.z += drop.velocity.z * delta;
          drop.mesh.rotation.y += delta * 3;

          // Check if landed
          if (drop.mesh.position.y <= drop.landedY) {
            drop.mesh.position.y = drop.landedY;
            drop.landed = true;
            drop.velocity.x = 0;
            drop.velocity.y = 0;
            drop.velocity.z = 0;
          }
        } else {
          // Bob animation when landed
          drop.bobPhase += delta * 3;
          drop.mesh.position.y = drop.landedY + Math.sin(drop.bobPhase) * 0.1;
          drop.mesh.rotation.y += delta * 1.5;
        }

        // Pickup check — player within 3 blocks
        const dx = drop.mesh.position.x - playerPos.x;
        const dy = drop.mesh.position.y - playerPos.y;
        const dz = drop.mesh.position.z - playerPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < 3) {
          // Pickup!
          const result = inventory.addItem(drop.typeId, 1);
          if (result.added > 0) {
            this.scene.remove(drop.mesh);
            drop.mesh.geometry.dispose();
            drop.mesh.material.dispose();
            this.drops.splice(i, 1);
            log('[Cuubz] Picked up item: ' + drop.typeId);
          }
          continue;
        }

        // Lifetime decay
        drop.lifetime -= delta;
        if (drop.lifetime <= 0) {
          this.scene.remove(drop.mesh);
          drop.mesh.geometry.dispose();
          drop.mesh.material.dispose();
          this.drops.splice(i, 1);
        }
      }
    },

    clear() {
      for (const drop of this.drops) {
        this.scene.remove(drop.mesh);
        drop.mesh.geometry.dispose();
        drop.mesh.material.dispose();
      }
      this.drops = [];
    },
  };
}
