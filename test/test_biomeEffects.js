#!/usr/bin/env node
/**
 * Cuubz — Biome Effects Tests
 *
 * Covers the current BiomeEffects surface: biome fog/sky configuration and
 * transitions, day/night blending, the particle pool used for lava and toxic
 * bubbles, distance culling, the active-particle cap, and disposal.
 *
 * This file previously tested a different design (a `ParticleEffect` class, plus
 * LAVA_ANIMATION / TOXIC_SLIME_ANIMATION / CORRUPT_FOG constants and UV-offset
 * state like `time` / `lavaOffset` / `inCorruptZone`). None of that exists any
 * more — biomeEffects.js exports only { BiomeEffects } — so the assertions were
 * rewritten against the real API rather than inventing constants to satisfy the
 * old ones.
 */

'use strict';

// PR 9: BiomeEffects.js now does its own `import * as THREE from 'three'`, so it no
// longer needs a global. These assertions still do (`instanceof THREE.Color`), and the
// vendored js/three.min.js this used to read is gone — so the global comes from the
// pinned npm package, which is the same r134 (test_threePin.js asserts that).
global.THREE = require('three');

const { BiomeEffects } = require('../src/engine/renderer/BiomeEffects.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

/** Minimal stand-in for the parts of a THREE.Scene that BiomeEffects touches. */
function makeScene(withFog = true) {
  return {
    background: null,
    fog: withFog ? { color: new THREE.Color(0xffffff), density: 0.001 } : null,
    children: [],
    add(obj) { this.children.push(obj); obj.parent = this; },
    remove(obj) {
      const i = this.children.indexOf(obj);
      if (i >= 0) this.children.splice(i, 1);
      obj.parent = null;
    },
  };
}

/** A BiomeEffects wired to a scene + renderer, so update() actually runs. */
function makeEffects(withFog = true) {
  const effects = new BiomeEffects();
  const scene = makeScene(withFog);
  effects.init(scene, { /* renderer stub — only presence is checked */ });
  return { effects, scene };
}

console.log('Testing Biome Effects System...\n');

// ============================================================
// Group 1: Constructor defaults
// ============================================================
console.log('Group 1: Constructor defaults');

const fresh = new BiomeEffects();
assertEqual(fresh.currentBiome, 'plains', 'Starts in the plains biome');
assertEqual(fresh.particles.length, 0, 'No active particles initially');
assertEqual(fresh.particlePool.length, 0, 'Particle pool starts empty');
assertEqual(fresh.scene, null, 'No scene before init()');
assertEqual(fresh.renderer, null, 'No renderer before init()');
assert(fresh.lerpSpeed > 0, 'lerpSpeed is positive');
assert(fresh.targetFogNear < fresh.targetFogFar, 'Fog near is closer than fog far');
assert(fresh.currentFogColor instanceof THREE.Color, 'currentFogColor is a THREE.Color');
assert(fresh.currentSkyColor instanceof THREE.Color, 'currentSkyColor is a THREE.Color');

// ============================================================
// Group 2: Biome configuration table
// ============================================================
console.log('\nGroup 2: Biome configuration table');

const configs = fresh.biomeConfigs;
for (const required of ['plains', 'ocean', 'desert', 'lava', 'corrupt', 'frozen_peaks']) {
  assert(configs[required] !== undefined, `biomeConfigs has an entry for ${required}`);
}
for (const [id, cfg] of Object.entries(configs)) {
  assert(typeof cfg.fogColor === 'number', `${id} fogColor is a hex number`);
  assert(typeof cfg.skyColor === 'number', `${id} skyColor is a hex number`);
  assert(cfg.fogNear > 0, `${id} fogNear is positive`);
  assert(cfg.fogFar > cfg.fogNear, `${id} fogFar is beyond fogNear`);
}

// Enclosed/hazard biomes should be foggier (shorter draw) than open ones
assert(configs.lava.fogFar < configs.desert.fogFar, 'Lava biome fog is thicker than desert');
assert(configs.corrupt.fogFar < configs.plains.fogFar, 'Corrupt biome fog is thicker than plains');
assert(configs.deep_ocean.fogFar < configs.ocean.fogFar, 'Deep ocean fog is thicker than ocean');

// ============================================================
// Group 3: setBiome
// ============================================================
console.log('\nGroup 3: setBiome');

const sb = new BiomeEffects();
sb.setBiome('desert');
assertEqual(sb.currentBiome, 'desert', 'Biome switches to desert');
assertEqual(sb.targetFogNear, configs.desert.fogNear, 'targetFogNear follows the desert config');
assertEqual(sb.targetFogFar, configs.desert.fogFar, 'targetFogFar follows the desert config');
assertEqual(sb.targetFogColor.getHex(), configs.desert.fogColor, 'targetFogColor follows the desert config');
assertEqual(sb.targetSkyColor.getHex(), configs.desert.skyColor, 'targetSkyColor follows the desert config');

// Unknown biome is ignored, leaving the previous biome in place
sb.setBiome('atlantis');
assertEqual(sb.currentBiome, 'desert', 'Unknown biome does not change currentBiome');
assertEqual(sb.targetFogFar, configs.desert.fogFar, 'Unknown biome leaves targets untouched');

// Re-setting the same biome is a no-op
sb.setBiome('desert');
assertEqual(sb.currentBiome, 'desert', 'Re-setting the same biome keeps it');

// ============================================================
// Group 4: Position tracking
// ============================================================
console.log('\nGroup 4: Position tracking');

const pt = new BiomeEffects();
pt.setPlayerPosition(10, 64, -20);
assertEqual(pt.playerPos.x, 10, 'Player X tracked');
assertEqual(pt.playerPos.y, 64, 'Player Y tracked');
assertEqual(pt.playerPos.z, -20, 'Player Z tracked');

pt.setCameraPosition({ x: 1, y: 2, z: 3 });
assertEqual(pt.cameraPos.x, 1, 'Camera X tracked from object');
assertEqual(pt.cameraPos.y, 2, 'Camera Y tracked from object');
assertEqual(pt.cameraPos.z, 3, 'Camera Z tracked from object');

// Numeric fallback sets x only, leaving y/z alone
pt.setCameraPosition(7);
assertEqual(pt.cameraPos.x, 7, 'Numeric camera arg sets X');
assertEqual(pt.cameraPos.y, 2, 'Numeric camera arg leaves Y');

// Null is ignored rather than throwing
pt.setCameraPosition(null);
assertEqual(pt.cameraPos.x, 7, 'Null camera position is ignored');

// ============================================================
// Group 5: init()
// ============================================================
console.log('\nGroup 5: init');

const initScene = makeScene();
const initEffects = new BiomeEffects();
initEffects.init(initScene, { stub: true });
assert(initEffects.scene === initScene, 'init stores the scene');
assert(initEffects.renderer !== null, 'init stores the renderer');
assert(initScene.background instanceof THREE.Color, 'init gives the scene a background color');

// An existing background is left alone — the Skybox owns it
const preset = makeScene();
preset.background = new THREE.Color(0x123456);
new BiomeEffects().init(preset, {});
assertEqual(preset.background.getHex(), 0x123456, 'init does not overwrite an existing background');

// ============================================================
// Group 6: update() requires scene and renderer
// ============================================================
console.log('\nGroup 6: update guards');

const noScene = new BiomeEffects();
noScene.update(0.016, new THREE.Color(0xffffff), 0.001); // must not throw
assertEqual(noScene.particles.length, 0, 'update without a scene is a safe no-op');

// ============================================================
// Group 7: Day/night blending
// ============================================================
console.log('\nGroup 7: Day/night blending');

{
  const { effects, scene } = makeEffects();
  effects.setBiome('lava');

  // Bright daylight base → blended background is set
  effects.update(0.016, new THREE.Color(1, 1, 1), 0.001);
  assert(scene.background instanceof THREE.Color, 'update writes a blended background');
  assert(effects.getFinalSkyColor() !== null, 'getFinalSkyColor returns a color once a background exists');

  // Night base is dark, so the blended result must stay dark even with a biome tint
  const night = new BiomeEffects();
  const nightScene = makeScene();
  night.init(nightScene, {});
  night.setBiome('lava');
  night.update(0.016, new THREE.Color(0.02, 0.02, 0.04), 0.001);
  assert(nightScene.background.r < 0.2 && nightScene.background.g < 0.2,
    'Night stays dark despite the lava biome tint');

  // Fog density is driven from the base value
  assert(scene.fog.density > 0, 'Fog density is positive after update');

  // Without a base sky color, the background is left to the Skybox
  const passive = new BiomeEffects();
  const passiveScene = makeScene();
  passive.init(passiveScene, {});
  const before = passiveScene.background.getHex();
  passive.update(0.016);
  assertEqual(passiveScene.background.getHex(), before, 'update without a base color leaves the background alone');
}

// getFinalSkyColor with no scene
assertEqual(new BiomeEffects().getFinalSkyColor(), null, 'getFinalSkyColor is null without a scene');

// ============================================================
// Group 8: Fog transitions lerp toward the biome target
// ============================================================
console.log('\nGroup 8: Fog transitions');

{
  const { effects } = makeEffects();
  effects.setBiome('deep_ocean'); // fogFar 150, well below the plains default of 300
  const startFar = effects.currentFogFar;
  for (let i = 0; i < 20; i++) effects.update(0.05, new THREE.Color(1, 1, 1), 0.001);
  assert(effects.currentFogFar < startFar, 'currentFogFar moves toward the deep-ocean target');
  assert(effects.currentFogFar >= effects.targetFogFar - 1, 'currentFogFar does not overshoot the target');

  // Colors converge on the target as well. The lerp is asymptotic (each frame
  // closes lerpSpeed*dt of the gap), so check that the gap shrinks and then
  // effectively closes given enough frames.
  const colorGap = () =>
    Math.abs(effects.currentFogColor.r - effects.targetFogColor.r)
    + Math.abs(effects.currentFogColor.g - effects.targetFogColor.g)
    + Math.abs(effects.currentFogColor.b - effects.targetFogColor.b);

  const gapAfter20 = colorGap();
  for (let i = 0; i < 200; i++) effects.update(0.05, new THREE.Color(1, 1, 1), 0.001);
  const gapAfter220 = colorGap();
  assert(gapAfter220 < gapAfter20, 'currentFogColor keeps closing on targetFogColor');
  assert(gapAfter220 < 0.01, 'currentFogColor converges on targetFogColor');
}

// A scene with no fog object must not break update()
{
  const { effects } = makeEffects(false);
  effects.update(0.016, new THREE.Color(1, 1, 1), 0.001);
  assert(true, 'update tolerates a scene with no fog');
}

// ============================================================
// Group 9: Particle spawning
// ============================================================
console.log('\nGroup 9: Particle spawning');

{
  const { effects, scene } = makeEffects();

  effects.spawnLavaBubbles(0, 64, 0);
  assertEqual(effects.particles.length, 1, 'Lava bubble is tracked as active');
  assertEqual(scene.children.length, 1, 'Lava bubble is added to the scene');

  const lava = effects.particles[0];
  assertEqual(lava.userData.type, 'lava_bubble', 'Lava particle is tagged lava_bubble');
  assertEqual(lava.userData.life, 1.0, 'Lava bubble lives 1 second');
  assertEqual(lava.userData.maxLife, 1.0, 'Lava bubble maxLife matches its life');
  assert(lava.userData.velocity.y > 0, 'Lava bubble rises');
  assert(Math.abs(lava.position.x) <= 1, 'Lava bubble spawns within 1 block in x');

  effects.spawnToxicBubbles(0, 64, 0);
  assertEqual(effects.particles.length, 2, 'Toxic bubble is tracked too');
  const toxic = effects.particles[1];
  assertEqual(toxic.userData.type, 'toxic_bubble', 'Toxic particle is tagged toxic_bubble');
  assertEqual(toxic.userData.life, 2.0, 'Toxic bubble lives 2 seconds — longer than lava');
  assert(toxic.userData.life > lava.userData.maxLife, 'Toxic bubbles outlive lava bubbles');
  assert(Math.abs(toxic.position.x) <= 1.5, 'Toxic bubble spawns within 1.5 blocks in x');
}

// Spawning without a scene is a no-op rather than a crash
{
  const orphan = new BiomeEffects();
  orphan.spawnLavaBubbles(0, 0, 0);
  orphan.spawnToxicBubbles(0, 0, 0);
  assertEqual(orphan.particles.length, 0, 'Spawning without a scene adds nothing');
}

// ============================================================
// Group 10: Particle lifecycle, fading and pooling
// ============================================================
console.log('\nGroup 10: Particle lifecycle');

{
  const { effects, scene } = makeEffects();
  effects.setPlayerPosition(0, 64, 0);
  effects.spawnLavaBubbles(0, 64, 0);

  const p = effects.particles[0];
  const startY = p.position.y;

  effects.update(0.5, new THREE.Color(1, 1, 1), 0.001);
  assert(p.position.y > startY, 'Particle rises during update');
  assert(p.userData.life < 1.0, 'Particle life decreases');
  assert(p.material.opacity <= 0.8, 'Particle opacity is capped at 0.8');
  assertEqual(effects.particles.length, 1, 'Particle still active at half life');

  // Run past the end of its life
  effects.update(0.6, new THREE.Color(1, 1, 1), 0.001);
  assertEqual(effects.particles.length, 0, 'Expired particle leaves the active list');
  assertEqual(scene.children.length, 0, 'Expired particle is removed from the scene');
  assertEqual(effects.particlePool.length, 1, 'Expired particle returns to the pool');

  // The pooled object is reused rather than reallocated
  effects.spawnLavaBubbles(0, 64, 0);
  assertEqual(effects.particlePool.length, 0, 'Pool is drained on the next spawn');
  assert(effects.particles[0] === p, 'The pooled particle object is reused');
}

// Distance culling
{
  const { effects } = makeEffects();
  effects.setPlayerPosition(0, 64, 0);
  effects.spawnLavaBubbles(0, 64, 0);
  effects.particles[0].position.set(500, 64, 0); // >100 blocks away
  effects.update(0.016, new THREE.Color(1, 1, 1), 0.001);
  assertEqual(effects.particles.length, 0, 'Particles beyond 100 blocks are culled');
  assertEqual(effects.particlePool.length, 1, 'Culled particle is pooled for reuse');
}

// Active-particle cap
{
  const { effects } = makeEffects();
  effects.setPlayerPosition(0, 64, 0);
  for (let i = 0; i < 260; i++) effects.spawnToxicBubbles(0, 64, 0);
  assertEqual(effects.particles.length, 260, 'All spawns are tracked before the update');
  effects.update(0.016, new THREE.Color(1, 1, 1), 0.001);
  assert(effects.particles.length <= 200, `Active particles capped at 200 (got ${effects.particles.length})`);
  assert(effects.particlePool.length > 0, 'Particles trimmed by the cap are pooled');
}

// ============================================================
// Group 11: Per-type particle colour
// ============================================================
console.log('\nGroup 11: Particle colour by type');

{
  const { effects } = makeEffects();
  effects.setPlayerPosition(0, 64, 0);
  effects.spawnLavaBubbles(0, 64, 0);
  effects.update(0.1, new THREE.Color(1, 1, 1), 0.001);
  const lavaColor = effects.particles[0].material.color;
  assert(lavaColor.r > lavaColor.b, 'Lava bubbles are red-dominant');

  const toxicRun = makeEffects();
  toxicRun.effects.setPlayerPosition(0, 64, 0);
  toxicRun.effects.spawnToxicBubbles(0, 64, 0);
  toxicRun.effects.update(0.1, new THREE.Color(1, 1, 1), 0.001);
  const toxicColor = toxicRun.effects.particles[0].material.color;
  assert(toxicColor.b > toxicColor.r, 'Toxic bubbles are blue/purple-dominant');
}

// ============================================================
// Group 12: dispose()
// ============================================================
console.log('\nGroup 12: dispose');

{
  const { effects, scene } = makeEffects();
  effects.setPlayerPosition(0, 64, 0);
  effects.spawnLavaBubbles(0, 64, 0);
  effects.spawnToxicBubbles(0, 64, 0);
  // Retire one into the pool so dispose has to clear both lists
  effects.particles[0].userData.life = 0;
  effects.update(0.016, new THREE.Color(1, 1, 1), 0.001);
  assert(effects.particlePool.length >= 1, 'One particle is pooled before dispose');

  effects.dispose();
  assertEqual(effects.particles.length, 0, 'dispose clears active particles');
  assertEqual(effects.particlePool.length, 0, 'dispose clears the particle pool');
  assertEqual(scene.children.length, 0, 'dispose detaches particles from the scene');

  // dispose is idempotent
  effects.dispose();
  assertEqual(effects.particles.length, 0, 'dispose is safe to call twice');
}

// ============================================================
// Group 13: Edge cases
// ============================================================
console.log('\nGroup 13: Edge cases');

{
  const { effects } = makeEffects();
  effects.setPlayerPosition(0, 64, 0);
  effects.spawnLavaBubbles(0, 64, 0);

  // Zero delta neither advances nor expires anything
  const lifeBefore = effects.particles[0].userData.life;
  effects.update(0, new THREE.Color(1, 1, 1), 0.001);
  assertEqual(effects.particles[0].userData.life, lifeBefore, 'Zero delta leaves particle life unchanged');

  // A very large delta expires everything at once instead of going negative
  effects.update(100, new THREE.Color(1, 1, 1), 0.001);
  assertEqual(effects.particles.length, 0, 'A huge delta expires all particles');

  // Missing fog density is tolerated
  effects.spawnLavaBubbles(0, 64, 0);
  effects.update(0.016, new THREE.Color(1, 1, 1));
  assert(true, 'update without a fog density does not throw');
}

// ============================================================
// Summary
// ============================================================
console.log(`\n===================================`);
console.log(`Biome Effects Tests: ${passed} passed, ${failed} failed`);
console.log(`===================================`);
process.exit(failed > 0 ? 1 : 0);
