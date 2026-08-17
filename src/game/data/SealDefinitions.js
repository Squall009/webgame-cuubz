/**
 * Cuubz — the five seals, and the thing behind them (S0)
 *
 * Pure data. No imports, no DOM, no network — `QuestState.js` reads `SEAL_IDS` to build
 * its default `seals` map, `SealSites.js` reads `siteRing` and `biome` to place them, and
 * `SealSystem.js` reads `offering` and `boss` to run them.
 *
 * ─── WHY FIVE KEY ITEMS AND NOT ONE ─────────────────────────────────────────
 *
 * `questStoryline.md` says "1 quest_key" five times, and `quest_key` is `maxStack: 1`
 * (`ItemDefinitions.js:109`). Two seal keys could never be carried at once, so a player
 * who picked up the Ember key while still holding the Verdant one would have lost one of
 * them to a full-stack rejection with no message. Five distinct items, one per seal.
 * `quest_key` stays defined for the creative palette and for back-compat with any world
 * that has one in a chest; it is no longer a quest requirement anywhere.
 *
 * ─── `siteRing` IS A BAND, NOT A POINT ──────────────────────────────────────
 *
 * Site selection (§7.1) hashes `(seed, sealId)` into an angle and a radius inside this
 * band and then walks outward looking for the right biome. The bands are ordered so the
 * acts are roughly ordered by distance from spawn — Verdant is the closest thing to a
 * tutorial dungeon and Deepstone is the furthest — but they overlap deliberately, because
 * a player who walks the wrong way first should still find *something*.
 */

/** The five, in the order the storyline breaks them. Act 7's finale is not one of these. */
export const SEAL_IDS = Object.freeze(['verdant', 'ember', 'frozen', 'sunken', 'deepstone']);

/**
 * Seal lifecycle, in advance order. `QuestState.setSealState` refuses to move backwards
 * along this list — see §4.1's "seal states only advance".
 *
 *   dormant   — generated, not yet found
 *   keyed     — a player is carrying this seal's key
 *   primed    — the offering has been made at the altar; the boss can be summoned
 *   contested — the boss is up and the fight is live
 *   broken    — the boss is dead
 *
 * `contested` → `primed` is the one legal *backwards* move (an encounter reset, §8.4) and
 * `setSealState` special-cases it rather than weakening the rule for everything else.
 */
export const SEAL_STATES = Object.freeze(['dormant', 'keyed', 'primed', 'contested', 'broken']);

export const SEAL_DEFINITIONS = Object.freeze({
  verdant: {
    id: 'verdant',
    name: 'Verdant Seal',
    dungeon: "Forest Warden's Dungeon",
    biome: 'corrupt',
    keyItem: 'seal_key_verdant',
    offering: [{ item: 'corrupt_crystal', count: 5 }],
    boss: 'forest_warden',
    arena: { radius: 24, height: 20 },
    siteRing: { min: 640, max: 1600 },
  },
  ember: {
    id: 'ember',
    name: 'Ember Seal',
    dungeon: "Lava Titan's Lair",
    biome: 'lava',
    keyItem: 'seal_key_ember',
    offering: [{ item: 'obsidian', count: 10 }],
    boss: 'lava_titan',
    arena: { radius: 26, height: 22 },
    siteRing: { min: 900, max: 2000 },
  },
  frozen: {
    id: 'frozen',
    name: 'Frozen Seal',
    dungeon: "Frost Serpent's Glacier",
    biome: 'tundra',
    keyItem: 'seal_key_frozen',
    offering: [],
    boss: 'frost_serpent',
    arena: { radius: 26, height: 20 },
    siteRing: { min: 1100, max: 2200 },
  },
  sunken: {
    id: 'sunken',
    name: 'Sunken Seal',
    dungeon: 'The Buried Hall',
    biome: 'desert',
    keyItem: 'seal_key_sunken',
    offering: [],
    boss: 'dune_colossus',
    arena: { radius: 28, height: 22 },
    siteRing: { min: 1300, max: 2400 },
  },
  deepstone: {
    id: 'deepstone',
    name: 'Deepstone Seal',
    dungeon: 'The Hollow Depths',
    biome: 'mountains',
    keyItem: 'seal_key_deepstone',
    offering: [],
    boss: 'hollow_king',
    // The only seal that is not a surface site. §3.7: it is deep, not hidden.
    depth: { maxY: 30 },
    arena: { radius: 24, height: 18 },
    siteRing: { min: 1500, max: 2600 },
  },
});

/**
 * The finale. Not a seal — it has no key and no offering, only a precondition: all five
 * of the above are `broken`. Physically present from world generation and inert until
 * then, which is the §3.7 ruling about foreshadowing beating a structure that pops into
 * existence.
 */
export const FINALE_DEFINITION = Object.freeze({
  id: 'finale',
  name: 'The Final Seal',
  dungeon: 'The Corruption Spire',
  biome: 'corrupt',
  boss: 'corruption_overlord',
  offering: [{ item: 'diamond', count: 10 }],
  arena: { radius: 30, height: 40 },
  siteRing: { min: 1800, max: 2800 },
  requiresSealsBroken: SEAL_IDS.length,
});

/**
 * Finale lifecycle. Its own vocabulary, because the finale is not a seal: it has no key,
 * its precondition is the other five, and "sealed" means something a seal's `dormant`
 * does not — the spire is standing there, visible, and refusing.
 *
 *   sealed    — generated and inert. Five seals hold it shut (§3.7).
 *   open      — the fifth seal broke. The spire answers to something now.
 *   primed    — the offering has been made at its base.
 *   contested — the Corruption Overlord is up.
 *   defeated  — the world is remade.
 *
 * `primed` sits between `open` and `contested` so the finale takes exactly the same
 * offer-then-summon path a seal does, rather than needing a second flow in the UI for
 * the one encounter that matters most.
 */
export const FINALE_STATES = Object.freeze(['sealed', 'open', 'primed', 'contested', 'defeated']);

/** @param {string} id @returns {object|null} */
export function getSealDefinition(id) {
  if (id === 'finale') return FINALE_DEFINITION;
  return SEAL_DEFINITIONS[id] || null;
}

/** Every seal key item id, for the single-stack tables that have to name them. */
export const SEAL_KEY_ITEMS = Object.freeze(SEAL_IDS.map((id) => SEAL_DEFINITIONS[id].keyItem));
