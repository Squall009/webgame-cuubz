/**
 * Cuubz — titles (S1)
 *
 * Thirteen, one per row of `questStoryline.md`'s title-progression table. Pure data,
 * granted by quest rewards, stored as an array of ids on the quest state.
 *
 * **No gameplay effect, deliberately.** A title that granted a stat would need
 * balancing, would need to be visible to the damage system, and would make "did the
 * guest keep it" (open question Q3) a question about power rather than about a name.
 * They are a record of what the party has done, and the quest log is where they are read.
 */

export const TITLE_DEFINITIONS = Object.freeze({
  survivor:         { id: 'survivor',         name: 'Survivor',         quest: 'q06', significance: 'Established a foothold' },
  seeker:           { id: 'seeker',           name: 'Seeker',           quest: 'q08', significance: 'Found rare materials' },
  warden_slayer:    { id: 'warden_slayer',    name: 'Warden Slayer',    quest: 'q12', significance: 'First seal broken' },
  firewalker:       { id: 'firewalker',       name: 'Firewalker',       quest: 'q14', significance: 'Survived the Lava biome' },
  titan_bane:       { id: 'titan_bane',       name: 'Titan Bane',       quest: 'q17', significance: 'Second seal broken' },
  icebound:         { id: 'icebound',         name: 'Icebound',         quest: 'q19', significance: 'Survived the tundra' },
  serpent_slayer:   { id: 'serpent_slayer',   name: 'Serpent Slayer',   quest: 'q21', significance: 'Third seal broken' },
  sandborn:         { id: 'sandborn',         name: 'Sandborn',         quest: 'q23', significance: 'Found what the desert buried' },
  colossus_breaker: { id: 'colossus_breaker', name: 'Colossus Breaker', quest: 'q24', significance: 'Fourth seal broken' },
  deepwalker:       { id: 'deepwalker',       name: 'Deepwalker',       quest: 'q25', significance: 'Reached the oldest stone' },
  kingsbane:        { id: 'kingsbane',        name: 'Kingsbane',        quest: 'q26', significance: 'Fifth seal broken' },
  seal_master:      { id: 'seal_master',      name: 'Seal Master',      quest: 'q27', significance: 'Prepared for the source' },
  world_saver:      { id: 'world_saver',      name: 'World Saver',      quest: 'q28', significance: 'Game complete' },
});

/** In the order they are earned. */
export const TITLE_ORDER = Object.freeze(
  Object.values(TITLE_DEFINITIONS)
    .sort((a, b) => a.quest.localeCompare(b.quest))
    .map((t) => t.id)
);

/** @param {string} id @returns {object|null} */
export function getTitle(id) {
  return TITLE_DEFINITIONS[id] || null;
}

/** The most recently earned title a player holds, for a one-line HUD display. */
export function highestTitle(titleIds) {
  if (!Array.isArray(titleIds) || titleIds.length === 0) return null;
  let best = null;
  for (const id of titleIds) {
    const def = TITLE_DEFINITIONS[id];
    if (!def) continue;
    if (!best || def.quest > best.quest) best = def;
  }
  return best;
}
