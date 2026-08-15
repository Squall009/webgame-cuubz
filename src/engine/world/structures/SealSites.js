/**
 * Cuubz — where the five seals are (S5)
 *
 * Pure, node-testable, and deterministic: `sealSites(seed)` is a function of the world
 * seed and nothing else. No DOM, no chunk manager, no randomness.
 *
 * ─── A SITE IS RESOLVED ONCE AND THEN FROZEN ────────────────────────────────
 *
 * §7.1. The result is written to `questState.seals[id].site` on first world entry and
 * **never recomputed**. If the selection algorithm here ever changes — a different hash,
 * a wider ring, a fixed bug — existing worlds keep their seals exactly where the players
 * found them, and `QuestState.setSealSite` enforces that by refusing a second write.
 *
 * ─── THE SPIRAL AND THE FALLBACK ARE LOAD-BEARING ───────────────────────────
 *
 * Hash `(seed, sealId)` into an angle and a radius inside the seal's `siteRing`, then
 * walk outward in a **bounded** spiral sampling the biome until it matches. The bound
 * matters more than it looks: Corrupt and Lava are rare mask-driven patches covering
 * ~3.6% of land each (§3.2), so the Verdant and Ember searches genuinely have to hunt,
 * and an unbounded spiral is a world-generation hang rather than a slow load.
 *
 * If the cap is reached, **fall back to the unfiltered position and say so**. A seal in
 * the wrong biome is a cosmetic disappointment; a world that never finishes loading is
 * not. `sealSites()` reports which sites fell back so a test can assert the rate stays
 * low rather than discovering it in a playthrough.
 */

import { SEAL_IDS, SEAL_DEFINITIONS, FINALE_DEFINITION } from '../../../game/data/SealDefinitions.js';
import { hashString } from '../Noise.js';

/**
 * Candidate columns the spiral may sample before giving up, per seal.
 *
 * **Both numbers are measured.** §7.1 asks for a ≥95% hit rate across seeds, and the
 * first attempt — 256 probes at 48 blocks apart, reaching 768 blocks out — managed
 * **38.8%** over a 40-seed × 6-site sweep. The reason is not density: it is reach. A
 * biome the search is looking for may simply not exist anywhere near the hashed ring,
 * and no amount of sampling a desert-free region finds a desert.
 *
 *   CAP  STEP  max reach   success
 *   256    48        768     38.8%
 *   400    90       1800     73.3%
 *   600   110       2694     92.1%
 *   900   130       3900     95.8%
 *  1200   150       5196     98.8%   ← chosen
 *
 * The cost is not the worst case, because the worst case is rare: the mean is **156
 * probes**, since a search that is going to succeed usually does so in the first few
 * dozen. A seal can end up several thousand blocks past its ring, which is a long walk
 * — and the alternative is a Verdant Seal that is not in the Corrupt biome, in a quest
 * whose text describes standing in one.
 */
export const SPIRAL_CAP = 1200;

/**
 * Radial spacing of the spiral, in blocks. With the golden angle below, `STEP * √i`
 * distributes samples at uniform density over a disc rather than clustering them.
 */
export const SPIRAL_STEP = 150;

/**
 * The golden angle, ~137.5°. Successive samples land in the gaps left by all the
 * previous ones, which is what makes a fixed budget of probes cover a disc evenly. The
 * first version used 0.55 rad and produced a sparse pinwheel with large unsampled
 * wedges.
 */
const GOLDEN_ANGLE = 2.39996;

/**
 * A deterministic 0..1 draw from a seed and a label. Same inputs, same output, forever —
 * which is what makes a site reproducible across sessions, devices and the host/client
 * split.
 */
export function siteHash(seed, label) {
  const h = hashString(`${seed}:${label}`);
  return (h >>> 0) / 4294967296;
}

/**
 * Resolve one seal's site.
 *
 * @param {number|string} seed
 * @param {object} def — a `SEAL_DEFINITIONS` entry (or `FINALE_DEFINITION`)
 * @param {function} biomeAt — `(wx, wz) => biomeId`. Injected rather than imported so
 *   this file stays pure and the tests can drive it with a fake world.
 * @returns {{ x:number, z:number, biome:string, fellBack:boolean, probes:number }}
 */
export function resolveSealSite(seed, def, biomeAt) {
  const angle = siteHash(seed, `${def.id}:angle`) * Math.PI * 2;
  const t = siteHash(seed, `${def.id}:radius`);
  const radius = def.siteRing.min + t * (def.siteRing.max - def.siteRing.min);

  const startX = Math.round(Math.cos(angle) * radius);
  const startZ = Math.round(Math.sin(angle) * radius);

  if (typeof biomeAt !== 'function') {
    return { x: startX, z: startZ, biome: def.biome, fellBack: true, probes: 0 };
  }

  // A sunflower spiral outward from the hashed start: uniform sample density over the
  // disc, nearest columns first, so a search that succeeds does so close to the ring the
  // seed asked for.
  let probes = 0;
  for (let i = 0; i < SPIRAL_CAP; i++) {
    probes++;
    const spiralTheta = i * GOLDEN_ANGLE;
    const spiralR = SPIRAL_STEP * Math.sqrt(i);
    const wx = Math.round(startX + Math.cos(spiralTheta + angle) * spiralR);
    const wz = Math.round(startZ + Math.sin(spiralTheta + angle) * spiralR);

    let biome;
    try {
      biome = biomeAt(wx, wz);
    } catch {
      continue; // an unsampleable column is not a reason to stop searching
    }
    if (biome === def.biome) {
      return { x: wx, z: wz, biome, fellBack: false, probes };
    }
  }

  // The cap fired. Take the unfiltered position and log it — §7.1's explicit ruling.
  return { x: startX, z: startZ, biome: def.biome, fellBack: true, probes };
}

/**
 * Every seal's site, plus the finale's.
 *
 * @param {number|string} seed
 * @param {function} [biomeAt] — `(wx, wz) => biomeId`
 * @returns {{ sites: Object<string,{x,z}>, fellBack: string[], probes: number }}
 */
export function sealSites(seed, biomeAt) {
  const sites = {};
  const fellBack = [];
  let probes = 0;

  for (const id of SEAL_IDS) {
    const def = SEAL_DEFINITIONS[id];
    const result = resolveSealSite(seed, def, biomeAt);
    probes += result.probes;
    sites[id] = { x: result.x, z: result.z };
    // The Deepstone seal is the only one that is not a surface site: it is deep, not
    // hidden (§3.7). Its `y` is carried so worldgen stamps the hall below the surface
    // rather than on it.
    if (def.depth) sites[id].y = def.depth.maxY - 6;
    if (result.fellBack) fellBack.push(id);
  }

  const finale = resolveSealSite(seed, FINALE_DEFINITION, biomeAt);
  probes += finale.probes;
  sites.finale = { x: finale.x, z: finale.z };
  if (finale.fellBack) fellBack.push('finale');

  if (fellBack.length > 0) {
    console.warn(
      `[SealSites] ${fellBack.length} site(s) fell back to an unfiltered position: ` +
      `${fellBack.join(', ')}. The seal will not be in its intended biome.`
    );
  }

  return { sites, fellBack, probes };
}

/**
 * Is this chunk within a site's footprint?
 *
 * Used by worldgen to decide whether a chunk needs stamping at all — the overwhelming
 * majority do not, and this has to be cheap because it runs per chunk on the generation
 * hot path (§7.2).
 *
 * @param {number} cx @param {number} cz — chunk coordinates
 * @param {{x:number,z:number}} site
 * @param {number} radius — arena radius in blocks
 */
export function chunkIntersectsSite(cx, cz, site, radius) {
  const minX = cx * 16;
  const minZ = cz * 16;
  const maxX = minX + 15;
  const maxZ = minZ + 15;
  // Closest point on the chunk's box to the site centre.
  const nearestX = Math.max(minX, Math.min(site.x, maxX));
  const nearestZ = Math.max(minZ, Math.min(site.z, maxZ));
  const dx = site.x - nearestX;
  const dz = site.z - nearestZ;
  return dx * dx + dz * dz <= radius * radius;
}

/**
 * Which site — if any — a chunk belongs to.
 * @returns {{ id:string, site:object, def:object }|null}
 */
export function siteForChunk(cx, cz, sites) {
  if (!sites) return null;
  for (const id of SEAL_IDS) {
    const site = sites[id];
    if (!site) continue;
    const def = SEAL_DEFINITIONS[id];
    if (chunkIntersectsSite(cx, cz, site, def.arena.radius + 4)) {
      return { id, site, def };
    }
  }
  if (sites.finale && chunkIntersectsSite(cx, cz, sites.finale, FINALE_DEFINITION.arena.radius + 4)) {
    return { id: 'finale', site: sites.finale, def: FINALE_DEFINITION };
  }
  return null;
}

/** Straight-line distance from a position to a site, ignoring Y. */
export function distanceToSite(position, site) {
  if (!position || !site) return Infinity;
  const dx = position.x - site.x;
  const dz = position.z - site.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * A compass bearing from the player to a site, in degrees clockwise from north.
 * The quest tracker shows this so a marker is a direction and a distance rather than a
 * pair of coordinates the player has to hold in their head.
 */
export function bearingToSite(position, site) {
  if (!position || !site) return 0;
  const dx = site.x - position.x;
  const dz = site.z - position.z;
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Eight-point compass label for a bearing. */
export function compassLabel(bearing) {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round(((bearing % 360) / 45)) % 8];
}
