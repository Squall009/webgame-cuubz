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
import { dissolveDeath } from '../../../src/game/mobs/rendering/animTypes/deathAnim.js';

// Counting, so `scripts/count-assertions.js` can read this file. `record` increments only
// AFTER the matcher returns and rethrows on failure, so a failing assertion is never
// counted and the printed line cannot overstate. Same helper as `sessionUI.test.js`.
let passed = 0, failed = 0;
function record(fn) { try { fn(); passed++; } catch (e) { failed++; throw e; } }
function eq(a, b, why) { record(() => expect(a, why).toBe(b)); }
function is(a, why) { record(() => expect(a, why).toBe(true)); }
function nope(a, why) { record(() => expect(a, why).toBe(false)); }
function gt(a, b, why) { record(() => expect(a, why).toBeGreaterThan(b)); }
function near(a, b, digits, why) { record(() => expect(a, why).toBeCloseTo(b, digits)); }
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

  it('one-shot animations run from state entry, not from spawn (BUGS.md D-88)', () => {
    // `_animateAttack` and `_animateHurt` derived `progress` from `animationTime`, the
    // animator's MONOTONIC LIFETIME, which nothing reset when the state was entered. A mob
    // alive for longer than its own attack/hurt duration — 0.3 s and 0.25 s here, and every
    // mob is older than that within a third of a second of spawning — therefore saw
    // `progress === 1` on the first frame of ATTACK and on every frame after it.
    //
    // Both assertions below are chosen because progress-1 is INDISTINGUISHABLE FROM REST:
    // `lungeAttack`'s recovery lerp returns the body to `baseZ + 0` at progress 1, and
    // `hurtReaction`'s `progress >= 1` branch restores the original emissive. That is why
    // the bug was invisible — the animations did not look wrong, they did not happen.
    // Reinstate `this.animationTime` in either dispatch and both of these go red.
    const manager = new MobManager({});
    const renderer = new MobRenderer(stubScene(), manager);
    manager.setRenderer(renderer);
    const mob = manager.spawnMobAt('corrupt_wolf', { x: 0, y: 64, z: 0 });
    const { group, animator } = renderer.renderObjects.get(mob.id);
    const restZ = group.userData.initialTransforms.body.position.z;

    // Age the mob well past both durations while it idles.
    for (let i = 0; i < 60; i++) renderer.update(0.016);
    gt(animator.animationTime, 0.3 / 2.0, 'the mob is older than its attack duration');
    near(group.userData.parts.body.position.z, restZ, 6, 'idling leaves the body at rest');

    // ── ATTACK ──
    mob.aiState = AI_STATES.ATTACK;
    renderer.update(0.016);
    renderer.update(0.016);
    const lungeZ = group.userData.parts.body.position.z;
    nope(lungeZ === restZ, 'two frames into ATTACK the body has left its rest pose');
    gt(restZ - lungeZ, 1e-4, 'and it moved BACKWARD, which is lungeAttack\'s wind-up');

    // ── HURT ──
    // Two frames, because the stamp is taken on the entry frame and `hurtReaction`'s pulse
    // is `sin(progress * 8π)`, which is legitimately 0 at progress 0. Under the bug the
    // progress is 1 on both frames, `sin(8π)` is 0 too, and the `progress >= 1` branch then
    // restores the banked emissive — so the flash never rendered at all.
    mob.aiState = AI_STATES.HURT;
    renderer.update(0.016);
    renderer.update(0.016);
    const body = group.userData.parts.body;
    eq(body.material.emissive.getHex(), 0xff0000, 'two frames into HURT the body flashes red');
    eq(body.material.emissiveIntensity, 0.5, 'at the flash intensity hurtReaction sets');

    // ── And the stamp is re-taken, so a SECOND attack plays too ──
    // A one-time `if (this._x === undefined)` guard — the shape `_animateDeath` can afford
    // because DEAD is terminal — would pass everything above and fail here.
    mob.aiState = AI_STATES.CHASE;
    for (let i = 0; i < 40; i++) renderer.update(0.016);
    mob.aiState = AI_STATES.ATTACK;
    renderer.update(0.016);
    renderer.update(0.016);
    gt(restZ - group.userData.parts.body.position.z, 1e-4,
      'the second ATTACK winds up as well — the clock restarts on every state entry');
  });

  it('dissolveDeath\'s deltaTime fallback is a rate, not a distance (D-88)', () => {
    // `group.position.y += 0.3 * group.userData.deltaTime || 0.016;` parses as
    // `(0.3 * dt) || 0.016`, because `*` binds tighter than `||`. With no deltaTime the
    // mob rose a flat 0.016 UNITS in that frame instead of 0.3 units/second × a frame —
    // 21x too fast, and the 0.3 rate did not apply to the fallback at all.
    const noDt = { position: { y: 0 }, rotation: { y: 0 }, scale: { set() {} }, userData: {}, traverse() {} };
    dissolveDeath(noDt, 0.5);
    near(noDt.position.y, 0.3 * 0.016, 8, 'fallback frame rises 0.3 units/s × 16 ms');
    nope(noDt.position.y === 0.016, 'not a flat 0.016 units, which is what the bug did');

    // The supplied-deltaTime path is unchanged by the fix and is asserted so a future
    // "simplification" cannot quietly drop the multiplication instead of the fallback.
    const withDt = { position: { y: 0 }, rotation: { y: 0 }, scale: { set() {} }, userData: { deltaTime: 0.05 }, traverse() {} };
    dissolveDeath(withDt, 0.5);
    near(withDt.position.y, 0.3 * 0.05, 8, 'a real deltaTime is still a rate × that time');
  });

  it('a capsule part is skipped, not a crash (D-88 — _buildCapsule deleted)', () => {
    // `_buildCapsule` ended in `merged.mergeBufferGeometries(...)`, which is not a method
    // of THREE.BufferGeometry in any version — it lives on BufferGeometryUtils. No entry in
    // MOB_DEFINITIONS uses `type: 'capsule'`, so the branch had never executed; it was armed
    // for whichever definition reached for it first. Restore the branch and this throws.
    let group = null;
    record(() => expect(() => {
      group = MobModelBuilder.build({
        name: 'Y',
        geometry: { parts: [
          { type: 'box', id: 'body', size: [1, 1, 1], position: [0, 0, 0] },
          { type: 'capsule', id: 'cap', radius: 0.2, length: 0.5, position: [0, 1, 0] },
        ] },
      });
    }, 'building a capsule part').not.toThrow());
    eq(group.children.length, 1, 'the capsule part was skipped like any unknown primitive');
    eq(group.userData.parts.cap, undefined, 'and is absent from the animator lookup');
    eq(MobModelBuilder._buildCapsule, undefined, '_buildCapsule is gone, not merely unreferenced');
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

// ═══════════════════════════════════════════════════════════════════════════════
// Leaving HURT undoes the flash (BUGS.md D-88)
// ═══════════════════════════════════════════════════════════════════════════════
//
// THE GAP THIS SUITE EXISTS TO CLOSE: every other test in this file assigns `mob.aiState`
// by hand. Nothing drove a mob *out* of a state through the real `mob.update()` timer, so
// nothing saw what happens when HURT ends — which is where the whole cleanup problem lives.
//
// `hurtReaction` is the only animation that writes to `material` rather than to parts, and
// its undo used to sit in an `if (progress >= 1)` branch. That branch only ever ran because
// the animator was feeding a permanently-1 progress: the D-88 defect itself. Giving it a
// correct clock removed the only caller of the cleanup, because `progress` cannot reach 1
// while the state is still HURT —
//
//   mob.takeDamage()      arms `hurtTimer` to the hurt animation's own duration (mob.js:136)
//   mob.update()          clears HURT the instant `hurtTimer <= 0`               (mob.js:103)
//   mobManager.update()   runs every mob.update() BEFORE renderer.update()  (mobManager:104,118)
//
// so on the frame the timer expires the animator already sees a different state. `stone_golem`
// is not marginal: `hurt: { speed: 0.5, duration: 0.4 }` means the animator clock only
// reaches progress ≈ 0.5 before the timer runs out, at ANY frame rate, and at dt = 1/60 it
// exits on a positive lobe of `sin(progress·8π)` — left glowing red forever after one hit.
// `corrupt_wisp` would lose its designed 0x8b00ff emissive on its first hit.
//
// The cleanup now runs from `MobAnimator._onStateExit()`. These assertions drive the real
// loop and compare against the PRE-HIT snapshot, at three frame rates, so a frame-rate-
// dependent leak cannot hide in the one dt a test happened to pick.
describe('leaving HURT restores the materials it changed (D-88)', () => {
  /** manager + renderer + one spawned mob, wired the way the game wires them. */
  function rig(type) {
    const scene = stubScene();
    const manager = new MobManager({});
    const renderer = new MobRenderer(scene, manager);
    manager.setRenderer(renderer);
    const mob = manager.spawnMobAt(type, { x: 0, y: 64, z: 0 });
    return { scene, manager, renderer, mob, group: renderer.renderObjects.get(mob.id).group };
  }

  // One tick of the real game loop. `blockAccess` and `playerPosition` are null, which is
  // what `_spawnTick` and `updateAI` are already written to tolerate; the hurt path does not
  // consult either.
  const tick = (manager, dt) => manager.update(dt, null, null, 4, undefined);

  /**
   * The comparison key. Records PROPERTY PRESENCE as well as value, because the leak this
   * suite is about includes `hurtReaction` adding `emissive` to a MeshBasicMaterial (the eye
   * meshes) that never had one — restoring a black Color there would look like a pass while
   * still leaving the material permanently changed.
   */
  const emissiveState = (group) => {
    const out = [];
    group.traverse(c => {
      if (!c.isMesh || !c.material) return;
      const m = c.material;
      out.push([
        c.name,
        'emissive' in m ? m.emissive.getHex() : 'ABSENT',
        'emissiveIntensity' in m ? m.emissiveIntensity : 'ABSENT',
      ].join(':'));
    });
    return out.join('|');
  };

  /**
   * Is the flash ON this frame?
   *
   * Deliberately NOT "is any mesh red". `hurtReaction` sets the emissive HUE and leaves it
   * latched — it only rewrites `emissiveIntensity` each frame, to `sin(progress * 8π) > 0
   * ? 0.5 : 0`. So a mesh stays red-hued through the dark half of every pulse, and through a
   * clock that has run past its ceiling. A hue-only probe reports "still flashing" for a
   * frozen animation, which is exactly the failure this suite is about: an earlier draft
   * used one and stayed green with the restart branch deleted. The intensity is the only
   * per-frame signal, and 0.5 is not a value any MOB_DEFINITIONS part is authored with
   * (the designed ones are 1.0, 0.8, 0.6, 0.4 and 0.3).
   */
  const flashIsOn = (group) => {
    let on = false;
    group.traverse(c => {
      if (!c.isMesh || !c.material || !c.material.emissive) return;
      const hex = c.material.emissive.getHex();
      if (c.material.emissiveIntensity === 0.5 && (hex === 0xff0000 || hex === 0xff2200)) on = true;
    });
    return on;
  };

  /** Run ticks until the mob is no longer HURT. The tick that ends it also runs the
   *  renderer, so the exit hook has fired by the time this returns. */
  function runOutTheHurt(manager, mob, dt) {
    let frames = 0, flashed = false;
    while (mob.aiState === AI_STATES.HURT && frames < 2000) {
      tick(manager, dt);
      frames++;
      if (flashIsOn(mob._grp)) flashed = true;
    }
    return { frames, flashed };
  }

  it('every mob type, at three frame rates, is byte-identical after one hit', () => {
    for (const type of MOB_TYPES) {
      for (const [dt, label] of [[1 / 60, '1/60'], [1 / 30, '1/30'], [1 / 144, '1/144']]) {
        const { manager, mob, group } = rig(type);
        mob._grp = group;
        const before = emissiveState(group);

        mob.takeDamage(1, 'test'); // non-lethal: min health in MOB_DEFINITIONS is 8
        is(mob.aiState === AI_STATES.HURT, `${type} @${label}: takeDamage enters HURT`);

        const { frames, flashed } = runOutTheHurt(manager, mob, dt);

        // Non-vacuity guard INSIDE the test: a "restore" that passes because the flash never
        // happened proves nothing. This is what fails if D-88's clock fix is reverted.
        is(flashed, `${type} @${label}: the flash actually rendered during the hurt window`);
        gt(frames, 1, `${type} @${label}: the hurt lasted more than one frame`);
        is(mob.aiState !== AI_STATES.HURT, `${type} @${label}: the timer took the mob out of HURT`);
        eq(emissiveState(group), before, `${type} @${label}: emissive state is exactly pre-hit`);
      }
    }
  });

  it('corrupt_wisp keeps the emissive colours its definition designs in', () => {
    // The wisp is the mob that proves the restore reads the BANKED value rather than
    // assuming black: its core is 0x8b00ff at intensity 1.0, its aura 0xbb33ff at 0.4.
    // `hurtReaction` overwrites emissive parts with 0xff2200, so a missing restore does not
    // merely fail to un-flash it — it permanently replaces the mob's designed glow.
    const { manager, mob, group } = rig('corrupt_wisp');
    mob._grp = group;
    const core = group.userData.parts.core;
    const aura = group.userData.parts.aura;
    eq(core.material.emissive.getHex(), 0x8b00ff, 'core starts at its designed 0x8b00ff');
    eq(core.material.emissiveIntensity, 1.0, 'at its designed intensity');
    eq(aura.material.emissive.getHex(), 0xbb33ff, 'aura starts at its designed 0xbb33ff');

    mob.takeDamage(1, 'test');
    tick(manager, 1 / 60);
    eq(core.material.emissive.getHex(), 0xff2200, 'mid-hurt the emissive parts take the red mix');

    runOutTheHurt(manager, mob, 1 / 60);
    eq(core.material.emissive.getHex(), 0x8b00ff, 'and the core is back to 0x8b00ff afterwards');
    eq(core.material.emissiveIntensity, 1.0, 'at its original intensity, not 0');
    eq(aura.material.emissive.getHex(), 0xbb33ff, 'and the aura is back to 0xbb33ff');
    eq(aura.material.emissiveIntensity, 0.4, 'at its original intensity');
  });

  it('a SECOND hit still takes the brief-red-flash path, not the emissive-parts path', () => {
    // The second-order consequence of the leak. `hurtAnim.js:24` branches on
    // `material.emissive.getHex() !== 0`, which is meant to ask "is this part designed to
    // glow?". A body left red by an unreconciled first hit answers yes, so from hit two
    // onward every plain mesh would render through the 0xff2200 "emissive part" branch
    // instead of the 0xff0000 "brief flash" branch — the flash D-88 just enabled would come
    // out through the wrong path and never blink off.
    const { manager, mob, group } = rig('corrupt_wolf');
    mob._grp = group;
    const body = group.userData.parts.body;

    mob.takeDamage(1, 'test');
    runOutTheHurt(manager, mob, 1 / 60);
    eq(body.material.emissive.getHex(), 0x000000, 'after hit one the body is black again');
    nope('_origEmissive' in body.material, 'and the bank was consumed, not left behind');

    mob.takeDamage(1, 'test');
    // Frame 1 is progress 0, where `sin(0)` is 0 and the pulse is legitimately off; frame 2
    // is the first frame that renders any flash at all.
    tick(manager, 1 / 60);
    tick(manager, 1 / 60);
    eq(body.material.emissive.getHex(), 0xff0000,
      'the first FLASHING frame of hit two takes the brief-flash path — with the leak the ' +
      'body is already non-black on entry, so every frame of hit two is 0xff2200 and this ' +
      'hue is never reached again for the life of the mob');

    // Recorded, NOT asserted as desirable: within a single hurt window the branch is
    // self-latching. Frame 1 sets 0xff0000, so from frame 2 on `emissive.getHex() !== 0` is
    // true and every remaining frame of the SAME window renders 0xff2200. The pulse still
    // blinks (`emissiveIntensity` toggles 0 / 0.5), only the hue settles. That is
    // pre-existing `hurtAnim.js` behaviour, unchanged by D-88 and identical on hit one — it
    // is the reason this test checks the first frame rather than "never 0xff2200".
    let sawMix = false;
    for (let i = 0; i < 5 && mob.aiState === AI_STATES.HURT; i++) {
      tick(manager, 1 / 60);
      if (body.material.emissive.getHex() === 0xff2200) sawMix = true;
    }
    is(sawMix, 'later frames of the same window latch to 0xff2200 — pre-existing, documented');
  });

  it('a hit landing while still in HURT restarts the flash', () => {
    // `_stateStartTime` is only re-stamped when the STATE changes, and a second hit does
    // not change the state. Left alone, the clock keeps running from the FIRST hit while
    // `takeDamage` extends the window by a full duration — so `progress` reaches its
    // `Math.min(1, …)` ceiling partway through and stays there, and `sin(1 * 8π)` is 0.
    // The back half of the extended window renders no flash at all.
    //
    // Counting flashing frames across the WHOLE extended window is what discriminates.
    // A restarted 0.25 s window at 1/60 is 15 frames across four positive lobes of
    // `sin(progress * 8π)` — 7 or 8 of them flash. Without the restart only the frames
    // before the ceiling can flash, and at this re-hit point that is one. Asserting "the
    // flash happened at least once" would pass either way: an earlier draft of this test
    // did exactly that, and removing the restart branch left it green.
    const { manager, mob, group } = rig('corrupt_wolf'); // hurt: duration 0.25, speed 1.0
    mob._grp = group;
    const dt = 1 / 60;
    const animator = manager.renderer.renderObjects.get(mob.id).animator;

    mob.takeDamage(1, 'test');
    for (let i = 0; i < 13; i++) tick(manager, dt); // 0.2167 s in — progress ≈ 0.87, still HURT
    is(mob.aiState === AI_STATES.HURT, 'still in HURT, near the end of the first window');
    const stampBefore = animator._stateStartTime;

    mob.takeDamage(1, 'test'); // re-arms hurtTimer to the full 0.25
    tick(manager, dt);
    // Read the stamp HERE, not after the loop: the tick that finally ends the window is a
    // state change and re-stamps too, so a post-loop read passes either way.
    const stampAfterRehit = animator._stateStartTime;

    let flashFrames = flashIsOn(group) ? 1 : 0, windowFrames = 1;
    while (mob.aiState === AI_STATES.HURT && windowFrames < 200) {
      tick(manager, dt);
      windowFrames++;
      if (flashIsOn(group)) flashFrames++;
    }

    gt(windowFrames, 12, 'the second hit extended the window by roughly a full duration');
    // The behavioural one, asserted before the white-box stamp so a regression reports the
    // symptom rather than the mechanism. Measured: 7 flashing frames of 16 with the restart,
    // 1 of 16 without it.
    gt(flashFrames, 3,
      'the flash pulses through a fresh window — without the restart the clock is past its ' +
      'ceiling for most of these frames and only one of them can flash');
    gt(stampAfterRehit, stampBefore, 'the one-shot clock was re-stamped by the second hit');

    // And the extended window still terminates cleanly.
    is(mob.aiState !== AI_STATES.HURT, 'the extended hurt window still ends');
    nope('_origEmissive' in group.userData.parts.body.material, 'and the bank is consumed at the end of it');
    eq(group.userData.parts.body.material.emissive.getHex(), 0x000000, 'body restored to black');
  });

  it('a mob that dies mid-flash is cleaned up by the same exit hook', () => {
    // HURT → DEAD is a state change like any other, so the hook fires. It matters because
    // the death animations fade `material.opacity`, and a stuck red `emissive` would fade
    // with the corpse instead of disappearing with the flash.
    const { manager, mob, group } = rig('rabbit');
    mob._grp = group;
    const before = emissiveState(group);

    mob.takeDamage(1, 'test');
    tick(manager, 1 / 60);
    tick(manager, 1 / 60);
    is(flashIsOn(group), 'the mob is mid-flash');

    mob.takeDamage(999, 'test'); // lethal — die() sets DEAD in the same call
    is(mob.isDead, 'the mob is dead');
    tick(manager, 1 / 60);
    eq(mob.aiState, AI_STATES.DEAD, 'and the animator now sees DEAD');
    eq(emissiveState(group), before, 'the flash was taken off on the way into DEAD');
  });

  it('removing a mob mid-flash disposes cleanly and cannot be resurrected', () => {
    // `removeMob` disposes materials and drops the render object, so the animator that owns
    // them is never updated again — the restore is never reached with a disposed material.
    // Asserted rather than assumed, because the cleanup is what would have to write to them.
    const { scene, manager, renderer, mob, group } = rig('deer');
    mob._grp = group;
    mob.takeDamage(1, 'test');
    tick(manager, 1 / 60);
    tick(manager, 1 / 60);
    is(flashIsOn(group), 'the mob is mid-flash');

    let disposals = 0, meshes = 0;
    group.traverse(c => { if (c.isMesh) { meshes++; c.material.addEventListener('dispose', () => { disposals++; }); } });

    record(() => expect(() => renderer.removeMob(mob.id), 'removeMob mid-flash').not.toThrow());
    eq(disposals, meshes, 'every material was disposed');
    eq(renderer.count, 0, 'the render object is gone');
    eq(scene.removed.length, 1, 'and the group left the scene');
    record(() => expect(() => tick(manager, 1 / 60), 'ticking on after the removal').not.toThrow());
    eq(renderer.count, 0, 'nothing was resurrected');
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // D-104: the flash must not give a material an `emissive` its shader has no uniform for
  // ═══════════════════════════════════════════════════════════════════════════════
  //
  // THE GAP THIS CLOSES: every assertion in the suite above compares the emissive state
  // BEFORE a hit to the state AFTER it, and `emissiveState` was even written to record
  // `'ABSENT'` so that adding a property and restoring a black Color could not pass. All of
  // that was green while `hurtReaction` crashed the renderer on contact — because the
  // damage is done DURING the window, on frames nobody looked at, and because the scene here
  // is a stub, so no material ever reaches a uniform refresh.
  //
  // `hurtReaction` added `emissive` to any material lacking one, which is every
  // `MeshBasicMaterial` — the eye meshes `mobModelBuilder` gives every mob. Three r134's
  // `refreshUniformsCommon` (three.module.js:24534) branches on the MATERIAL and then
  // dereferences the UNIFORM:
  //
  //     if ( material.emissive ) uniforms.emissive.value.copy( material.emissive )...
  //
  // `ShaderLib.basic` has no `emissive` uniform. So the first draw call after the first hit
  // on any mob threw `Cannot read properties of undefined (reading 'value')` out of
  // `renderBufferDirect` and took the render loop down with it.
  describe('the hurt flash never adds `emissive` to a basic material (D-104)', () => {
    // The r134 material.type → ShaderLib key table (WebGLPrograms `shaderIDs`), restricted to
    // the material types `mobModelBuilder` actually builds.
    const SHADER_ID = { MeshBasicMaterial: 'basic', MeshLambertMaterial: 'lambert', MeshStandardMaterial: 'physical' };

    /**
     * Run the exact expression that threw, against the real `ShaderLib` uniform set for the
     * material's own shader. This is the crash, reproduced without a GL context: nothing here
     * is a stand-in for the renderer's behaviour, it IS the renderer's line.
     */
    const refreshUniformsCommon = (mat) => {
      const id = SHADER_ID[mat.type];
      if (!id) throw new Error(`unmapped material type ${mat.type} — extend SHADER_ID`);
      const uniforms = THREE.UniformsUtils.clone(THREE.ShaderLib[id].uniforms);
      if (mat.emissive) uniforms.emissive.value.copy(mat.emissive).multiplyScalar(mat.emissiveIntensity);
    };

    it('every mob type survives a full hurt window fed through the real uniform refresh', () => {
      for (const type of MOB_TYPES) {
        const { manager, mob, group } = rig(type);
        mob._grp = group;

        mob.takeDamage(1, 'test');
        let frames = 0, flashed = false, basics = 0;
        while (mob.aiState === AI_STATES.HURT && frames < 2000) {
          tick(manager, 1 / 60);
          frames++;
          if (flashIsOn(group)) flashed = true;
          group.traverse(c => {
            if (!c.isMesh || !c.material) return;
            if (c.material.isMeshBasicMaterial) basics++;
            record(() => expect(() => refreshUniformsCommon(c.material),
              `${type} frame ${frames}: ${c.name} (${c.material.type}) through refreshUniformsCommon`).not.toThrow());
          });
        }

        // Non-vacuity, both halves: the flash has to have run, and the mob has to actually
        // own a basic material — otherwise this passes for the wrong reason.
        is(flashed, `${type}: the flash rendered during the window under test`);
        gt(basics, 0, `${type}: has at least one MeshBasicMaterial to put at risk`);
      }
    });

    it('the eye meshes are the ones at risk, and they stay untouched', () => {
      // Named directly rather than left implicit in the sweep above, because `eye_0` is the
      // concrete thing `mobModelBuilder` builds with a `MeshBasicMaterial` and the concrete
      // thing that broke. If eyes ever stop being basic materials this goes red and says so.
      const { manager, mob, group } = rig('corrupt_wolf');
      mob._grp = group;
      const eye = group.userData.parts.eye_0;
      is(eye.material.isMeshBasicMaterial === true, 'eye_0 is a MeshBasicMaterial');
      nope('emissive' in eye.material, 'and has no emissive before the hit');

      mob.takeDamage(1, 'test');
      let sawFlashFrame = false;
      for (let i = 0; i < 40 && mob.aiState === AI_STATES.HURT; i++) {
        tick(manager, 1 / 60);
        if (flashIsOn(group)) sawFlashFrame = true;
        // Checked on EVERY frame, including the dark half of each pulse: the old code took
        // the `flashIntensity > 0` branch to assign the Color, so a probe that only sampled
        // one frame could easily sample a dark one and miss it.
        nope('emissive' in eye.material, `frame ${i + 1}: eye_0 still has no emissive`);
      }
      is(sawFlashFrame, 'the body did flash while the eye was being watched');
      nope('emissiveIntensity' in eye.material, 'and no emissiveIntensity was left on it either');
    });
  });
});
