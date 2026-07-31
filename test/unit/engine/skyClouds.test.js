/**
 * Cuubz — the cloud pool allocates ONE geometry and ONE material (PR 23)
 *
 * `SkyGeometry._updateClouds` used to run
 *     const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
 *     const cubeMat = new THREE.MeshBasicMaterial({...});
 * on EVERY call, unconditionally, before the `while` loop that usually spawns nothing —
 * and the cloud-removal path deliberately skipped disposal under a comment reading
 * "material is shared, don't dispose". It was not shared: `_createClouds` built its own
 * separate pair, so every cloud spawned after init held a geometry and a material that
 * were never freed. A per-frame THREE leak in the render loop.
 *
 * The pair is built once now, owned as `this._cloudGeo` / `this._cloudMat`, used by both
 * `_createClouds` and `_updateClouds`, and disposed in `dispose()` — which is what makes
 * that "material is shared" comment true instead of false.
 *
 * Separate from `test_skybox.js` only to keep both files under the 400-line ceiling;
 * everything else about the Skybox class is still tested there.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import * as THREE from 'three';
import { SkyGeometryMethods } from '../../../src/engine/renderer/SkyGeometry.js';

it('skyClouds', () => legacy(async () => {
let passCount = 0, failCount = 0;
const failures = [];
function assert(c, m) { if(c){passCount++;console.log(`  ✅ ${m}`)}else{failCount++;failures.push(m);console.log(`  ❌ ${m}`)} }
function assertEquals(a,e,m){assert(a===e,`${m}: expected ${e}, got ${a}`)}
function assertTrue(c,m){assert(c===true,m)}
function assertNotNull(v,m){assert(v!==null&&v!==undefined,m)}

console.log('Skybox Cloud Pool Tests');
console.log('=======================');
// ============================================================
// Group N: the cloud pool allocates ONE geometry + ONE material (PR 23)
// ============================================================
//
// `SkyGeometry._updateClouds` used to run
//     const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
//     const cubeMat = new THREE.MeshBasicMaterial({...});
// on EVERY call, unconditionally, before the `while` loop that usually spawns nothing —
// and the cloud-removal path deliberately skipped disposal under a comment reading
// "material is shared, don't dispose". It was not shared: `_createClouds` built its own
// separate pair, so every cloud spawned after init held a geometry and a material that
// were never freed. A per-frame THREE leak in the render loop.
//
// The pair is now built once, owned as `this._cloudGeo` / `this._cloudMat`, used by both
// `_createClouds` and `_updateClouds`, and disposed in `dispose()`.
//
// `init()` cannot run in Node (`_createSunMoonSprites` needs a real 2D canvas), so the
// mixin's methods are driven directly over a hand-built `this` — which is exactly what
// SkyGeometry.js's own header says they are: a prototype mixin over named fields.
console.log('\n--- Group N: cloud geometry/material are allocated once ---');
{
  const makeSky = () => ({
    renderer: { scene: new THREE.Scene() },
    cloudMinAltitude: 160,
    cloudMaxAltitude: 220,
    cloudSpreadRadius: 250,
    cloudWrapDistance: 1,   // tiny, so every cloud wraps and respawns on the first update
    cloudCount: 0,
    cloudTargetCount: 4,
    cloudLayer: null,
    _cloudGeo: null,
    _cloudMat: null,
    sunLight: null, moonLight: null, ambientLight: null, sunSprite: null, moonSprite: null,
    _createSunMoonSprites() {},  // needs a DOM canvas; not what this group is about
    _createClouds: SkyGeometryMethods._createClouds,
    _createCloudCluster: SkyGeometryMethods._createCloudCluster,
    _spawnCloud: SkyGeometryMethods._spawnCloud,
    _updateClouds: SkyGeometryMethods._updateClouds,
    dispose: SkyGeometryMethods.dispose,
  });

  /** Every distinct geometry / material object reachable from the cloud layer. */
  const distinctResources = (sky) => {
    const geos = new Set();
    const mats = new Set();
    sky.cloudLayer.traverse((child) => {
      if (child.isMesh) { geos.add(child.geometry); mats.add(child.material); }
    });
    return { geos, mats };
  };

  const sky = makeSky();
  sky._createClouds();

  assertNotNull(sky._cloudGeo, '_createClouds owns the cloud geometry on the instance');
  assertNotNull(sky._cloudMat, '_createClouds owns the cloud material on the instance');

  const geo0 = sky._cloudGeo;
  const mat0 = sky._cloudMat;

  // 200 frames of drift, with a wrap distance small enough that clouds respawn constantly.
  for (let i = 0; i < 200; i++) sky._updateClouds(0.5);

  assertTrue(sky._cloudGeo === geo0, 'after 200 update frames the geometry is the SAME object');
  assertTrue(sky._cloudMat === mat0, 'after 200 update frames the material is the SAME object');

  const { geos, mats } = distinctResources(sky);
  assertEquals(geos.size, 1, 'every cloud cube in the scene shares exactly ONE geometry');
  assertEquals(mats.size, 1, 'every cloud cube in the scene shares exactly ONE material');
  assertTrue(geos.has(geo0), 'and it is the one _createClouds built');
  assertEquals(sky.cloudCount, sky.cloudTargetCount, 'the pool still holds its target cloud count');

  // dispose() frees them. THREE dispatches a 'dispose' event, so this observes the real call.
  let geoDisposed = false;
  let matDisposed = false;
  geo0.addEventListener('dispose', () => { geoDisposed = true; });
  mat0.addEventListener('dispose', () => { matDisposed = true; });
  sky.dispose();
  assertTrue(geoDisposed, 'dispose() disposes the cloud geometry');
  assertTrue(matDisposed, 'dispose() disposes the cloud material');
  assertTrue(sky._cloudGeo === null, 'dispose() clears _cloudGeo');
  assertTrue(sky._cloudMat === null, 'dispose() clears _cloudMat');

  // dispose() is still safe on an instance that never created clouds — test_skybox already
  // relies on `new Skybox(null).dispose()` not throwing.
  {
    const bare = makeSky();
    let threw = null;
    try { bare.dispose(); } catch (e) { threw = e.message; }
    assertEquals(threw, null, 'dispose() on an instance with no clouds does not throw');
  }

  // NON-VACUITY: the same measurement, run against the OLD shape (a fresh pair allocated
  // per update), must report more than one distinct geometry. If `distinctResources` ever
  // stopped looking, this line goes red with it.
  {
    const leaky = makeSky();
    leaky._createClouds();
    // Reproduce the old `_updateClouds` spawn half: one cloud wraps, a FRESH pair is
    // allocated, and the replacement is built from it — so the pool ends up holding a
    // different geometry per generation, which is precisely the leak.
    for (let i = 0; i < 5; i++) {
      leaky.cloudLayer.remove(leaky.cloudLayer.children[0]); // one cloud drifts out
      leaky.cloudCount--;
      const g = new THREE.BoxGeometry(1, 1, 1);
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff });
      while (leaky.cloudCount < leaky.cloudTargetCount) {
        leaky._spawnCloud(g, m, leaky.cloudLayer, false);
        leaky.cloudCount++;
      }
    }
    const leakyRes = distinctResources(leaky);
    assertTrue(leakyRes.geos.size > 1, 'NON-VACUITY: per-call allocation IS detected as >1 distinct geometry');
    assertTrue(leakyRes.mats.size > 1, 'NON-VACUITY: per-call allocation IS detected as >1 distinct material');
  }
}

console.log('\n================================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  console.log('\nFailures:'); failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('All cloud pool tests passing!');
  process.exit(0);
}
}));
