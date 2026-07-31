/**
 * Cuubz — mob rendering, the subsystem D-77 had switched off (PR 33)
 *
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * Nothing in `test/` imported `mobIntegration.js` or anything under
 * `src/game/mobs/rendering/` before this file. That is how **D-77** survived 17 PRs of
 * green lint and green tests: `mobIntegration.js:72` gated the `MobRenderer` construction
 * on `typeof THREE !== 'undefined'`, and `THREE` is not a binding in that module and
 * there is no `window.THREE` — so the test was a constant `false`, `setRenderer()` was
 * never called, and `mobRenderer.js:38` carried the mirror image (`if (typeof THREE ===
 * 'undefined') return;` as `addMob`'s first statement, also with no import), so the
 * renderer would have done nothing even if it had been built. `no-undef` cannot see
 * either one: `typeof` is the single operand ESLint exempts from the undefined-variable
 * check. **No mob has been drawn since PR 9.**
 *
 * ─── WHY THE ASSERTIONS ARE BEHAVIOURAL, NOT TEXTUAL ────────────────────────
 *
 * A grep for `typeof THREE` in the two files would be the obvious regression guard and it
 * would be the wrong one — it cannot tell a live guard from the sentence describing a
 * dead one, and this file's own header would trip it. The guards are pinned by their
 * effects instead: `init()` with a scene must leave `getRenderer()` non-null AND
 * `getManager().renderer` pointing at the same object (that is `setRenderer()` having been
 * reached), and `addMob()` must put a populated `THREE.Group` into the scene. Restore
 * either guard and both of those go red — that is the proof recorded in the PR.
 *
 * ─── NO WEBGL ───────────────────────────────────────────────────────────────
 *
 * `environment` is `'node'` (`vitest.config.js` note 1) and stays that way. The scene is
 * a two-method stub of the shape `MobRenderer` actually uses — `add`, `remove`, and an
 * optional `fog` — and the camera stub is the `{ position: {x,y,z} }` that the fog
 * distance maths reads. `three` itself imports fine in Node; only `WebGLRenderer` needs a
 * context, and nothing here constructs one. Geometry and material disposal is observed
 * through THREE's own `'dispose'` event rather than a flag, because that event is the
 * only externally visible consequence of `dispose()`.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as THREE from 'three';
import { MobIntegration } from '../../../src/game/mobs/mobIntegration.js';
import { MobRenderer } from '../../../src/game/mobs/rendering/mobRenderer.js';
import { MobModelBuilder } from '../../../src/game/mobs/rendering/mobModelBuilder.js';
import { MobManager } from '../../../src/game/mobs/mobManager.js';
import { Mob } from '../../../src/game/mobs/mob.js';
import { MOB_DEFINITIONS, AI_STATES } from '../../../src/game/mobs/mobDefinitions.js';

// Counting, so `scripts/count-assertions.js` can read this file. `record` increments only
// AFTER the matcher returns and rethrows on failure, so a failing assertion is never
// counted and the printed line cannot overstate. Same helper as `sessionUI.test.js`.
let passed = 0, failed = 0;
function record(fn) { try { fn(); passed++; } catch (e) { failed++; throw e; } }
function eq(a, b, why) { record(() => expect(a, why).toBe(b)); }
function is(a, why) { record(() => expect(a, why).toBe(true)); }
function nope(a, why) { record(() => expect(a, why).toBe(false)); }
function gt(a, b, why) { record(() => expect(a, why).toBeGreaterThan(b)); }
afterAll(() => {
  console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);
});

/** The scene stub — `add` / `remove` are the whole surface `MobRenderer` touches. */
function stubScene(fog) {
  return {
    added: [], removed: [], fog: fog || null,
    add(o) { this.added.push(o); },
    remove(o) { this.removed.push(o); },
  };
}
const stubCamera = (x, y, z) => ({ position: { x, y, z } });
const MOB_TYPES = Object.keys(MOB_DEFINITIONS);

describe('MobIntegration wires a renderer (BUGS.md D-77)', () => {
  it('builds a MobRenderer and hands it to the manager when given a scene', () => {
    const scene = stubScene();
    const camera = stubCamera(0, 5, 0);
    const integration = new MobIntegration();
    const manager = integration.init({ scene, camera, worldSeed: 42 });

    const renderer = integration.getRenderer();
    is(renderer instanceof MobRenderer, 'init() constructed a MobRenderer');
    eq(renderer.scene, scene, 'the renderer holds the scene it was given');
    eq(renderer.camera, camera, 'deps.camera reached setCamera()');
    // The load-bearing one: `setRenderer()` is only reached from inside the branch the
    // dead `typeof THREE` guard used to suppress.
    eq(manager.renderer, renderer, 'mobManager.setRenderer() was called with that renderer');
    eq(renderer.mobManager, manager, 'the renderer holds the manager');
    eq(renderer.count, 0, 'nothing rendered yet');
  });

  it('still treats `scene` as the precondition — no scene, no renderer', () => {
    const integration = new MobIntegration();
    const manager = integration.init({ worldSeed: 1 });
    eq(integration.getRenderer(), null, 'no scene, no renderer');
    eq(manager.renderer, null, 'and the manager was never given one');
  });

  it('omitting deps.camera leaves the camera unset rather than throwing', () => {
    const integration = new MobIntegration();
    integration.init({ scene: stubScene(), worldSeed: 1 });
    eq(integration.getRenderer().camera, null, 'camera stays null');
  });

  it('destroy() clears the scene through the manager and drops both references', () => {
    const scene = stubScene();
    const integration = new MobIntegration();
    const manager = integration.init({ scene, camera: stubCamera(0, 0, 0), worldSeed: 1 });
    manager.spawnMobAt('deer', { x: 0, y: 64, z: 0 });
    eq(scene.added.length, 1, 'spawning through the manager reached the renderer');
    integration.destroy();
    eq(scene.removed.length, 1, 'destroy() removed the group from the scene');
    eq(integration.getRenderer(), null, 'renderer reference dropped');
    eq(integration.getManager(), null, 'manager reference dropped');
  });
});

describe('MobRenderer.addMob puts a real model in the scene (D-77)', () => {
  it('adds one populated THREE.Group per mob, at the mob position and yaw', () => {
    const scene = stubScene();
    const manager = new MobManager({});
    const renderer = new MobRenderer(scene, manager);
    const mob = new Mob('deer', { x: 1.5, y: 64.25, z: -3.75 }, 7);
    mob.yaw = 1.25;

    renderer.addMob(mob);
    eq(scene.added.length, 1, 'exactly one object was added to the scene');
    eq(renderer.count, 1, 'and the renderer tracks it');

    const group = scene.added[0];
    is(group instanceof THREE.Group, 'what was added is a THREE.Group');
    eq(renderer.renderObjects.get(mob.id).group, group, 'the tracked group is the added one');
    gt(group.children.length, 0, 'the group is not empty');
    let meshes = 0;
    group.traverse(c => { if (c.isMesh) meshes++; });
    gt(meshes, 0, 'it contains meshes');
    gt(Object.keys(group.userData.parts).length, 0, 'the animator lookup table is populated');
    eq(group.position.x, 1.5, 'group x'); eq(group.position.y, 64.25, 'group y');
    eq(group.position.z, -3.75, 'group z'); eq(group.rotation.y, 1.25, 'group yaw');
    eq(group.userData.mobType, 'Deer', 'the group is labelled with its definition');
  });

  it('is idempotent for a mob it already holds', () => {
    const scene = stubScene();
    const renderer = new MobRenderer(scene, new MobManager({}));
    const mob = new Mob('rabbit', { x: 0, y: 64, z: 0 }, 1);
    renderer.addMob(mob);
    renderer.addMob(mob);
    eq(scene.added.length, 1, 'the second add was a no-op');
    eq(renderer.count, 1, 'still one render object');
  });

  it('builds a non-empty model for every entry in MOB_DEFINITIONS', () => {
    // A definition missing a field the builder reads would be a throw on that mob's first
    // spawn — invisible until now, because `addMob` never got past its first statement.
    for (const type of MOB_TYPES) {
      const scene = stubScene();
      const renderer = new MobRenderer(scene, new MobManager({}));
      renderer.addMob(new Mob(type, { x: 0, y: 64, z: 0 }, 1));
      eq(scene.added.length, 1, `${type}: added to the scene`);
      let meshes = 0;
      scene.added[0].traverse(c => { if (c.isMesh) meshes++; });
      const parts = MOB_DEFINITIONS[type].geometry.parts.length;
      const eyes = MOB_DEFINITIONS[type].geometry.eyes.positions.length;
      eq(meshes, parts + eyes, `${type}: one mesh per part plus one per eye`);
    }
  });

  it('MobModelBuilder skips an unknown primitive rather than throwing', () => {
    const group = MobModelBuilder.build({
      name: 'X',
      geometry: { parts: [
        { type: 'box', id: 'body', size: [1, 1, 1], position: [0, 0, 0] },
        { type: 'no_such_primitive', id: 'ghost' },
      ] },
    });
    eq(group.children.length, 1, 'only the recognised part was built');
    eq(group.userData.parts.ghost, undefined, 'the unknown part is absent from the lookup');
  });
});

describe('MobRenderer lifecycle: update, removal, disposal', () => {
  it('update() syncs position and yaw from the data model and runs the animator', () => {
    const scene = stubScene();
    const manager = new MobManager({});
    const renderer = new MobRenderer(scene, manager);
    const mob = manager.spawnMobAt('deer', { x: 0, y: 64, z: 0 });
    manager.setRenderer(renderer);
    renderer.addMob(mob);

    const group = renderer.renderObjects.get(mob.id).group;
    mob.position.x = 12; mob.position.y = 70; mob.position.z = -4; mob.yaw = 0.5;
    renderer.update(0.016);
    eq(group.position.x, 12, 'x followed the mob'); eq(group.position.y, 70, 'y followed');
    eq(group.position.z, -4, 'z followed'); eq(group.rotation.y, 0.5, 'yaw followed');
    gt(renderer.renderObjects.get(mob.id).animator.animationTime, 0, 'the animator advanced');
  });

  it('update() survives every AI state for every mob type', () => {
    // The animator dispatches on `mob.aiState`; a state with no handler, or a handler
    // reading a part a definition does not have, would throw on the first frame it hit.
    const manager = new MobManager({});
    const renderer = new MobRenderer(stubScene(), manager);
    manager.setRenderer(renderer);
    for (const type of MOB_TYPES) {
      const mob = manager.spawnMobAt(type, { x: 0, y: 64, z: 0 });
      renderer.addMob(mob);
      for (const state of Object.values(AI_STATES)) {
        mob.aiState = state;
        record(() => expect(() => { renderer.update(0.016); renderer.update(0.016); },
          `${type} in state ${state}`).not.toThrow());
      }
    }
    eq(renderer.count, MOB_TYPES.length, 'every mob is still rendered afterwards');
  });

  it('update() blends mesh colour toward the scene fog and restores it up close', () => {
    const scene = stubScene({ isFogExp2: true, density: 0.01, color: new THREE.Color(0xffffff) });
    const manager = new MobManager({});
    const renderer = new MobRenderer(scene, manager);
    renderer.setCamera(stubCamera(0, 64, 0));
    manager.setRenderer(renderer);
    const mob = manager.spawnMobAt('deer', { x: 0, y: 64, z: 0 });
    renderer.addMob(mob);

    let mesh = null;
    renderer.renderObjects.get(mob.id).group.traverse(c => { if (c.isMesh && !mesh) mesh = c; });
    const original = mesh.material.color.getHex();

    mob.position.z = 200; // well past the fog horizon at density 0.01
    renderer.update(0.016);
    eq(mesh.material._origColor.getHex(), original, 'the original colour was banked');
    nope(mesh.material.color.getHex() === original, 'far away, the colour moved toward the fog');
    gt(mesh.material.color.getHex(), original, 'and it moved toward white, not away');

    mob.position.z = 0; // back at the camera
    renderer.update(0.016);
    eq(mesh.material.color.getHex(), original, 'up close, the original colour is restored');
  });

  it('removeMob takes the group out of the scene and disposes its GPU resources', () => {
    const scene = stubScene();
    const renderer = new MobRenderer(scene, new MobManager({}));
    const mob = new Mob('rabbit', { x: 0, y: 64, z: 0 }, 1);
    renderer.addMob(mob);
    const group = scene.added[0];

    // THREE dispatches a 'dispose' event; that is the only observable effect of dispose().
    let geometries = 0, materials = 0, meshes = 0;
    group.traverse(c => {
      if (!c.isMesh) return;
      meshes++;
      c.geometry.addEventListener('dispose', () => { geometries++; });
      c.material.addEventListener('dispose', () => { materials++; });
    });

    renderer.removeMob(mob.id);
    eq(scene.removed.length, 1, 'removed from the scene');
    eq(scene.removed[0], group, 'and it was the right group');
    eq(renderer.count, 0, 'no render objects left');
    eq(geometries, meshes, 'every geometry disposed');
    eq(materials, meshes, 'every material disposed');
    record(() => expect(() => renderer.removeMob(mob.id), 'double remove').not.toThrow());
    record(() => expect(() => renderer.removeMob('never-existed'), 'unknown id').not.toThrow());
    eq(scene.removed.length, 1, 'neither call touched the scene again');
  });

  it('clear() empties the scene, and update() reaps a group whose mob is gone', () => {
    const scene = stubScene();
    const manager = new MobManager({});
    const renderer = new MobRenderer(scene, manager);
    manager.setRenderer(renderer);
    manager.spawnMobAt('deer', { x: 0, y: 64, z: 0 });
    manager.spawnMobAt('rabbit', { x: 4, y: 64, z: 4 });
    eq(renderer.count, 2, 'two rendered');
    renderer.clear();
    eq(renderer.count, 0, 'clear() emptied the map');
    eq(scene.removed.length, 2, 'and removed both groups from the scene');

    const orphan = manager.spawnMobAt('deer', { x: 0, y: 64, z: 0 });
    eq(renderer.count, 1, 'one rendered again');
    manager.mobs.delete(orphan.id); // gone from the data model, still in the scene
    renderer.update(0.016);
    eq(renderer.count, 0, 'update() reaped the orphaned group');
    eq(scene.removed.length, 3, 'and took it out of the scene');
  });
});
