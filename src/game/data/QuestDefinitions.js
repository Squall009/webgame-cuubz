/**
 * Cuubz — the 28 quests, as pure data (S1)
 *
 * The engineering half of `questStoryline.md`. Every quest there has exactly one entry
 * here, un-renumbered, and the narrative strings are that document's, verbatim — one
 * source of truth for the words, in the file that ships them.
 *
 * ─── THE SHAPE ──────────────────────────────────────────────────────────────
 *
 *   {
 *     id, title, act, stage, type, narrative,
 *     objectives: [{ kind, key, ... }],
 *     rewards:    [{ kind, ... }],
 *     marker:     { biome } | { seal },
 *     requires:   ['q11'],
 *   }
 *
 * `type` is the storyline's label — COLLECT | CRAFT | EXPLORE | DELIVER | BOSS — and is
 * **presentational**. What the quest system actually evaluates is `objectives[].kind`,
 * of which there are five (§4.2):
 *
 *   contribute_item — pooled across the party via per-contributor high-water marks
 *   visit           — any player reaching the position satisfies it, for everyone
 *   deliver         — items consumed at an altar, host-validated (exploit-proof)
 *   boss_kill       — a `BOSS_DEFEATED` from the host
 *   seal_state      — the seal state machine reached a state
 *
 * A COLLECT and a CRAFT quest are both `contribute_item`: the tracker polls what the
 * party holds and cannot tell how it got there, which is the point — mining, crafting,
 * looting and trading all count identically, with no ordering hazards and no event
 * plumbing (§4.5).
 *
 * ─── `objectives[].key` IS THE STORAGE KEY, AND IT IS NOT THE ITEM ──────────
 *
 * Pools live at `questState.quests[id].objectives[key]`, so `key` has to be stable
 * across a definition change in a way an item id is not. It is also what makes two
 * objectives on one quest distinguishable when they happen to want the same item.
 *
 * ─── `items` IS A LIST, ALWAYS ──────────────────────────────────────────────
 *
 * "5 wood_log" means any log. There are eleven log types and thirteen plank types, and
 * a quest that accepted only oak would be a bug report from anyone who spawned in a
 * spruce forest. Counting sums every listed type.
 */

import { BLOCK_TYPES } from '../../engine/world/BlockRegistry.js';

/** Every log type. Q01 wants "wood", not oak specifically. */
export const ANY_LOG = Object.freeze([
  BLOCK_TYPES.OAK_LOG, BLOCK_TYPES.SPRUCE_LOG, BLOCK_TYPES.BIRCH_LOG,
  BLOCK_TYPES.JUNGLE_LOG, BLOCK_TYPES.ACACIA_LOG, BLOCK_TYPES.DARK_OAK_LOG,
  BLOCK_TYPES.CHERRY_LOG, BLOCK_TYPES.MANGROVE_LOG, BLOCK_TYPES.PALE_OAK_LOG,
  BLOCK_TYPES.POPLAR_LOG,
]);

/** Every plank type — the output of the four `planks_*` recipes and nine more. */
export const ANY_PLANKS = Object.freeze([
  BLOCK_TYPES.OAK_PLANKS, BLOCK_TYPES.SPRUCE_PLANKS, BLOCK_TYPES.BIRCH_PLANKS,
  BLOCK_TYPES.JUNGLE_PLANKS, BLOCK_TYPES.ACACIA_PLANKS, BLOCK_TYPES.DARK_OAK_PLANKS,
  BLOCK_TYPES.CHERRY_PLANKS, BLOCK_TYPES.MANGROVE_PLANKS, BLOCK_TYPES.PALE_OAK_PLANKS,
  BLOCK_TYPES.POPLAR_PLANKS, BLOCK_TYPES.BAMBOO_PLANKS, BLOCK_TYPES.CRIMSON_PLANKS,
  BLOCK_TYPES.WARPED_PLANKS,
]);

/** The five objective kinds, as a frozen table so a typo is a lookup failure. */
export const OBJECTIVE_KINDS = Object.freeze({
  CONTRIBUTE_ITEM: 'contribute_item',
  VISIT: 'visit',
  DELIVER: 'deliver',
  BOSS_KILL: 'boss_kill',
  SEAL_STATE: 'seal_state',
});

/** The storyline's own quest-type labels. Display only. */
export const QUEST_TYPES = Object.freeze({
  COLLECT: 'COLLECT', CRAFT: 'CRAFT', EXPLORE: 'EXPLORE',
  DELIVER: 'DELIVER', BOSS: 'BOSS',
});

const K = OBJECTIVE_KINDS;
const T = QUEST_TYPES;

/** `contribute_item` shorthand. */
const item = (key, items, count, label) => ({
  kind: K.CONTRIBUTE_ITEM,
  key,
  items: Array.isArray(items) ? items : [items],
  count,
  label,
});

export const QUEST_DEFINITIONS = Object.freeze({
  // ════════════════════════════════════════════════════════════════════════
  // Act 1: Awakening — survival and preparation. No seal, no boss.
  // ════════════════════════════════════════════════════════════════════════

  q01: {
    id: 'q01', title: 'First Steps', act: 1, stage: 1, type: T.COLLECT,
    narrative:
      'Your first moments in this world. A mysterious voice echoes: "Gather what the ' +
      'land provides. You will need strength for what comes." Trees grow tall in the ' +
      'plains and forests nearby. Break their trunks and dig into the earth beneath.',
    objectives: [
      item('wood_log', ANY_LOG, 5, 'Wood Logs'),
      item('dirt', BLOCK_TYPES.DIRT, 10, 'Dirt'),
    ],
    rewards: [{ kind: 'unlock', questId: 'q02' }],
    marker: { biome: 'plains' },
    requires: [],
  },

  q02: {
    id: 'q02', title: 'Crafting Basics', act: 1, stage: 2, type: T.CRAFT,
    narrative:
      'Raw materials are only the beginning. The voice returns: "Shape what you gather. ' +
      'From logs come planks, and from planks come tools for the journey ahead." Learn ' +
      'to craft basic building blocks.',
    objectives: [item('planks', ANY_PLANKS, 10, 'Planks')],
    rewards: [{ kind: 'unlock', questId: 'q03' }],
    marker: { biome: 'plains' },
    requires: ['q01'],
  },

  q03: {
    id: 'q03', title: 'A Warm Meal', act: 1, stage: 3, type: T.COLLECT,
    narrative:
      'Hunger gnaws at you. You notice red fruit hanging from trees in the forest — ' +
      'apples, sweet and sustaining. "The land provides for those who look carefully." ' +
      'The berries found nearby will serve as backup rations.',
    objectives: [item('apple', 'apple', 3, 'Apples')],
    rewards: [
      { kind: 'item', item: 'berry', count: 5 },
      { kind: 'unlock', questId: 'q04' },
    ],
    marker: { biome: 'forest' },
    requires: ['q02'],
  },

  q04: {
    id: 'q04', title: 'Mining the Depths', act: 1, stage: 4, type: T.COLLECT,
    narrative:
      'The voice grows urgent: "The corruption spreads from below. You must learn what ' +
      'lies beneath the surface." Venture into caves and mine the black veins of coal — ' +
      'fuel for warmth and light in the darkness ahead.',
    objectives: [item('coal', 'coal', 10, 'Coal')],
    rewards: [{ kind: 'unlock', questId: 'q05' }],
    marker: { biome: 'mountains' },
    requires: ['q03'],
  },

  q05: {
    id: 'q05', title: 'Iron Will', act: 1, stage: 5, type: T.COLLECT,
    narrative:
      'Deeper still, you find veins of silver-white ore embedded in stone. "Iron is the ' +
      'backbone of civilization. Forge it into strength." The mountains hide secrets ' +
      'that will prove essential against the corruption.',
    objectives: [item('iron_ore', 'iron_ore', 8, 'Iron Ore')],
    rewards: [{ kind: 'unlock', questId: 'q06' }],
    marker: { biome: 'mountains' },
    requires: ['q04'],
  },

  q06: {
    id: 'q06', title: 'A Safe Place to Rest', act: 1, stage: 6, type: T.CRAFT,
    narrative:
      'Exhaustion takes its toll. The voice softens: "Even heroes need rest. Build a ' +
      'place to call home, and set your spawn where the night cannot find you." With a ' +
      'bed placed, you establish your first foothold in this world — ready for what ' +
      'comes next.',
    // §2.5's first gap. There was no `bed` block and no `bed` recipe, so this quest was
    // unfinishable by construction. Both exist now — `BlockRegistry` id 198 and a
    // crafting-table recipe of 3 wool over 3 planks.
    objectives: [item('bed', BLOCK_TYPES.BED, 1, 'Bed')],
    rewards: [
      { kind: 'unlock', questId: 'q07' },
      { kind: 'title', id: 'survivor' },
    ],
    marker: { biome: 'plains' },
    requires: ['q05'],
  },

  // ════════════════════════════════════════════════════════════════════════
  // Act 2: The First Seal — Verdant, in the Corrupt biome. Forest Warden.
  // ════════════════════════════════════════════════════════════════════════

  q07: {
    id: 'q07', title: 'Whispers in the Dark', act: 2, stage: 7, type: T.EXPLORE,
    narrative:
      'You discover a patch of land twisted by dark energy. The ground is purple, pools ' +
      'of toxic slime bubble ominously. Among the corruption, you find a crystallized ' +
      'fragment — a corrupt crystal, humming with malevolent power. "The First Seal has ' +
      'fallen. Its guardian, the Forest Warden, was consumed by this darkness."',
    objectives: [item('corrupt_crystal', 'corrupt_crystal', 1, 'Corrupt Crystal')],
    rewards: [{ kind: 'unlock', questId: 'q08' }],
    marker: { biome: 'corrupt' },
    requires: ['q06'],
  },

  q08: {
    id: 'q08', title: 'Gathering Defenses', act: 2, stage: 8, type: T.COLLECT,
    narrative:
      'To confront the corruption, you need materials of extraordinary strength. Gold ' +
      'and diamond — rare treasures found only in the deepest veins of the mountains. ' +
      '"The strongest metals come from the deepest places." Prepare for a battle unlike ' +
      'any other.',
    objectives: [
      item('gold_ore', 'gold_ore', 5, 'Gold Ore'),
      item('diamond', 'diamond', 3, 'Diamonds'),
    ],
    rewards: [
      { kind: 'unlock', questId: 'q09' },
      { kind: 'title', id: 'seeker' },
    ],
    marker: { biome: 'mountains' },
    requires: ['q07'],
  },

  q09: {
    id: 'q09', title: 'The First Key', act: 2, stage: 9, type: T.COLLECT,
    narrative:
      'Deep in the corrupt zone, a golden key rests on an ancient altar. It is warm to ' +
      'the touch and pulses with light — a counter to the darkness around it. "This key ' +
      'opens the path to the dungeon where the Forest Warden lies trapped."',
    // The storyline says `quest_key`. §4.3: that item is `maxStack: 1`, so one shared
    // key across five dungeons could never be carried — five distinct key items instead.
    objectives: [item('seal_key', 'seal_key_verdant', 1, 'Verdant Seal Key')],
    rewards: [{ kind: 'unlock', questId: 'q10' }],
    marker: { seal: 'verdant' },
    requires: ['q08'],
  },

  q10: {
    id: 'q10', title: 'Into the Dungeon', act: 2, stage: 10, type: T.COLLECT,
    narrative:
      'Armed with the key, you venture deeper into the corruption. The dungeon entrance ' +
      'is marked by twisted trees and pools of toxic slime. Collect corrupt crystals ' +
      'from the dungeon — each one weakens the barrier protecting the Forest Warden\'s ' +
      'prison. "Gather five fragments. They will be needed to summon the guardian."',
    objectives: [item('corrupt_crystal', 'corrupt_crystal', 5, 'Corrupt Crystals')],
    rewards: [{ kind: 'unlock', questId: 'q11' }],
    marker: { seal: 'verdant' },
    requires: ['q09'],
  },

  q11: {
    id: 'q11', title: 'Offering of Light', act: 2, stage: 11, type: T.DELIVER,
    narrative:
      'Return to the dungeon altar. Place the key and crystals together. The altar ' +
      'blazes with light as the corruption recoils. "The offering is complete. The ' +
      'Forest Warden stirs from its dark slumber. Prepare for battle."',
    // A `deliver`, not a `contribute_item`: items are consumed at the altar and
    // validated host-side, which is what makes every seal-critical step exploit-proof
    // while the gathering steps stay deliberately generous (§4.5).
    objectives: [{ kind: K.DELIVER, key: 'offering', seal: 'verdant', label: 'Make the offering' }],
    rewards: [{ kind: 'unlock', questId: 'q12' }],
    marker: { seal: 'verdant' },
    requires: ['q10'],
  },

  q12: {
    id: 'q12', title: 'The Forest Warden', act: 2, stage: 12, type: T.BOSS,
    narrative:
      'The Forest Warden awakens — a massive creature of corrupted roots and thorns, ' +
      'once the guardian of the First Seal. It attacks with sweeping vine lashes and ' +
      'spores of poison. Defeat it to cleanse the first seal. "The corruption retreats ' +
      'from this land. But four more seals await."',
    objectives: [{ kind: K.BOSS_KILL, key: 'forest_warden', boss: 'forest_warden', count: 1, label: 'Defeat the Forest Warden' }],
    rewards: [
      { kind: 'unlock', questId: 'q13' },
      { kind: 'title', id: 'warden_slayer' },
    ],
    marker: { seal: 'verdant' },
    requires: ['q11'],
  },

  // ════════════════════════════════════════════════════════════════════════
  // Act 3: Fire and Ash — Ember, in the Lava biome. Lava Titan.
  // ════════════════════════════════════════════════════════════════════════

  q13: {
    id: 'q13', title: 'Ashes of the Past', act: 3, stage: 13, type: T.EXPLORE,
    narrative:
      'A volcanic wasteland stretches before you — rivers of lava, columns of obsidian, ' +
      'heat that burns with every breath. "The Second Seal lies in the heart of fire. ' +
      'Gather obsidian — stone forged by the world\'s fury." This material will protect ' +
      'you from the heat to come.',
    // Obsidian is a real, mineable block as of S1. It was an alias for `crying_obsidian`
    // — hardness -1, drops nothing — so this quest and the two below it asked the player
    // to collect something the game refused to let them break.
    objectives: [item('obsidian', BLOCK_TYPES.OBSIDIAN, 5, 'Obsidian')],
    rewards: [{ kind: 'unlock', questId: 'q14' }],
    marker: { biome: 'lava' },
    requires: ['q12'],
  },

  q14: {
    id: 'q14', title: 'Fireproof Preparation', act: 3, stage: 14, type: T.COLLECT,
    narrative:
      'The deeper you go into the volcanic zone, the more materials you find. ' +
      'Blackstone — dense, heat-resistant stone formed by lava cooling rapidly. "Arm ' +
      'yourself with the world\'s own defenses. Fire will be your enemy and your ally."',
    objectives: [
      item('obsidian', BLOCK_TYPES.OBSIDIAN, 15, 'Obsidian'),
      item('blackstone', BLOCK_TYPES.BLACKSTONE, 20, 'Blackstone'),
    ],
    rewards: [
      { kind: 'unlock', questId: 'q15' },
      { kind: 'title', id: 'firewalker' },
    ],
    marker: { biome: 'lava' },
    requires: ['q13'],
  },

  q15: {
    id: 'q15', title: 'The Second Key', act: 3, stage: 15, type: T.COLLECT,
    narrative:
      'Hidden in a lava-flowed cavern, the second key glows with an inner heat. Unlike ' +
      'the first, this one is forged from volcanic glass — obsidian shaped into a key by ' +
      'ancient hands. "The Lava Titan waits beneath the surface. This key will open its ' +
      'prison."',
    objectives: [item('seal_key', 'seal_key_ember', 1, 'Ember Seal Key')],
    rewards: [{ kind: 'unlock', questId: 'q16' }],
    marker: { seal: 'ember' },
    requires: ['q14'],
  },

  q16: {
    id: 'q16', title: 'Heart of Fire', act: 3, stage: 16, type: T.DELIVER,
    narrative:
      'Place the key and obsidian at the volcanic altar. The ground trembles as lava ' +
      'rises around you. "The second guardian stirs. The Lava Titan — a creature of ' +
      'molten rock and ancient rage. Stand firm."',
    objectives: [{ kind: K.DELIVER, key: 'offering', seal: 'ember', label: 'Make the offering' }],
    rewards: [{ kind: 'unlock', questId: 'q17' }],
    marker: { seal: 'ember' },
    requires: ['q15'],
  },

  q17: {
    id: 'q17', title: 'The Lava Titan', act: 3, stage: 17, type: T.BOSS,
    narrative:
      'The ground cracks open and the Lava Titan erupts — a towering being of molten ' +
      'rock. It smashes the terrain, creates lava pools that spread fire across the ' +
      'battlefield, and fires streams of molten debris. "The second seal is broken. ' +
      'Three remain."',
    objectives: [{ kind: K.BOSS_KILL, key: 'lava_titan', boss: 'lava_titan', count: 1, label: 'Defeat the Lava Titan' }],
    rewards: [
      { kind: 'unlock', questId: 'q18' },
      { kind: 'title', id: 'titan_bane' },
    ],
    marker: { seal: 'ember' },
    requires: ['q16'],
  },

  // ════════════════════════════════════════════════════════════════════════
  // Act 4: Frozen Truth — Frozen, in the Tundra. Frost Serpent.
  // ════════════════════════════════════════════════════════════════════════

  q18: {
    id: 'q18', title: 'Frozen Wastes', act: 4, stage: 18, type: T.EXPLORE,
    narrative:
      'A blizzard howls as you enter the tundra. Everything is frozen solid — ground, ' +
      'trees, even the air seems to crystallize. "The Third Seal is guarded by the Frost ' +
      'Serpent. An ancient being of ice and patience." Gather ice from the frozen ' +
      'landscape to survive the cold.',
    objectives: [item('ice', BLOCK_TYPES.ICE, 10, 'Ice')],
    rewards: [{ kind: 'unlock', questId: 'q19' }],
    marker: { biome: 'tundra' },
    requires: ['q17'],
  },

  q19: {
    id: 'q19', title: 'Winter Supplies', act: 4, stage: 19, type: T.COLLECT,
    narrative:
      'The cold demands preparation. Find food caches left by ancient travelers — ' +
      'preserved meat and bread sealed in ice. "The serpent\'s domain is merciless. ' +
      'Stock your provisions well." The extra ice will serve as insulation against the ' +
      'coming battle.',
    // §2.5's second gap: `bread` was a defined item with no recipe and no source in the
    // world, so this quest could not be completed either. It has a recipe now.
    objectives: [
      item('cooked_meat', 'cooked_meat', 5, 'Cooked Meat'),
      item('bread', 'bread', 3, 'Bread'),
      item('ice', BLOCK_TYPES.ICE, 15, 'Ice'),
    ],
    rewards: [
      { kind: 'unlock', questId: 'q20' },
      { kind: 'title', id: 'icebound' },
    ],
    marker: { biome: 'tundra' },
    requires: ['q18'],
  },

  q20: {
    id: 'q20', title: 'The Third Key', act: 4, stage: 20, type: T.COLLECT,
    narrative:
      'The third key is encased in a glacier — frozen in time for millennia. Break ' +
      'through the ice to retrieve it. "The Frost Serpent awaits. This key will free the ' +
      'seal from its icy prison."',
    objectives: [item('seal_key', 'seal_key_frozen', 1, 'Frozen Seal Key')],
    rewards: [{ kind: 'unlock', questId: 'q21' }],
    marker: { seal: 'frozen' },
    requires: ['q19'],
  },

  q21: {
    id: 'q21', title: 'The Frost Serpent', act: 4, stage: 21, type: T.BOSS,
    narrative:
      'The glacier cracks as the Frost Serpent uncoils — a massive serpent of living ' +
      'ice, its scales sharp as blades. It breathes freezing mist that slows movement, ' +
      'strikes with its body like a whip, and creates ice walls to block your path. ' +
      '"Three broken. Two remain — and the voice has begun to sound eager."',
    objectives: [{ kind: K.BOSS_KILL, key: 'frost_serpent', boss: 'frost_serpent', count: 1, label: 'Defeat the Frost Serpent' }],
    rewards: [
      { kind: 'unlock', questId: 'q22' },
      { kind: 'title', id: 'serpent_slayer' },
    ],
    marker: { seal: 'frozen' },
    requires: ['q20'],
  },

  // ════════════════════════════════════════════════════════════════════════
  // Act 5: Sea of Sand — Sunken, in the Desert. Dune Colossus.
  // ════════════════════════════════════════════════════════════════════════

  q22: {
    id: 'q22', title: 'Sea of Sand', act: 5, stage: 22, type: T.EXPLORE,
    narrative:
      'The desert does not announce itself. One morning the grass thins, the trees stop, ' +
      'and by afternoon there is nothing in any direction but heat and dunes. Somewhere ' +
      'beneath them is the Sunken Seal. "They did not set a guardian here. They set a ' +
      'grave, and hoped the sand would keep it." Cut into the sandstone shelves that ' +
      'break the dunes — the ruins of whoever did the burying are still down there.',
    // Sandstone had no registry entry at all before S1, though its textures always
    // shipped. §7.3 also builds the Buried Hall out of it.
    objectives: [item('sandstone', BLOCK_TYPES.SANDSTONE, 15, 'Sandstone')],
    rewards: [{ kind: 'unlock', questId: 'q23' }],
    marker: { biome: 'desert' },
    requires: ['q21'],
  },

  q23: {
    id: 'q23', title: 'The Sunken Key', act: 5, stage: 23, type: T.COLLECT,
    narrative:
      'The buried hall is intact — sandstone pillars, a floor swept clean by nothing, ' +
      'and at the far end a key of pale stone resting where someone left it in a hurry. ' +
      'It is warm, and the warmth has nothing to do with the desert. "The ones who ' +
      'buried this seal did not lock it. They could not. They only hid it, and hoped."',
    objectives: [item('seal_key', 'seal_key_sunken', 1, 'Sunken Seal Key')],
    rewards: [
      { kind: 'unlock', questId: 'q24' },
      { kind: 'title', id: 'sandborn' },
    ],
    marker: { seal: 'sunken' },
    requires: ['q22'],
  },

  q24: {
    id: 'q24', title: 'The Dune Colossus', act: 5, stage: 24, type: T.BOSS,
    narrative:
      'The floor of the hall is not a floor. It stands, and the ceiling goes with it — a ' +
      'figure of compacted sandstone and swallowed ruin, wearing the buried hall like ' +
      'armour. This one was never a guardian corrupted. It is what the corruption made ' +
      '*out of* the grave they dug. It fights patiently, the way a desert does. "Four ' +
      'seals broken. One left, and then the thing that broke them."',
    objectives: [{ kind: K.BOSS_KILL, key: 'dune_colossus', boss: 'dune_colossus', count: 1, label: 'Defeat the Dune Colossus' }],
    rewards: [
      { kind: 'unlock', questId: 'q25' },
      { kind: 'title', id: 'colossus_breaker' },
    ],
    marker: { seal: 'sunken' },
    requires: ['q23'],
  },

  // ════════════════════════════════════════════════════════════════════════
  // Act 6: The Hollow Depths — Deepstone, below Y 30. Hollow King.
  // ════════════════════════════════════════════════════════════════════════

  q25: {
    id: 'q25', title: 'The Hollow Depths', act: 6, stage: 25, type: T.COLLECT,
    narrative:
      'Below thirty, the stone changes. It goes dark and dense and old, and the caves ' +
      'stop feeling like caves and start feeling like rooms. The Deepstone Seal is down ' +
      'here, and so is its key, and so is everything that has been walking these halls ' +
      'since long before you woke up. "The guardians of the fifth seal did not fall to ' +
      'the corruption. They stayed, and they hollowed, and they kept walking." Bring ' +
      'back deepslate — you will need to shore up what you break through.',
    objectives: [
      item('deepslate', BLOCK_TYPES.DEEPSLATE, 20, 'Deepslate'),
      item('seal_key', 'seal_key_deepstone', 1, 'Deepstone Seal Key'),
    ],
    rewards: [
      { kind: 'unlock', questId: 'q26' },
      { kind: 'title', id: 'deepwalker' },
    ],
    marker: { seal: 'deepstone' },
    requires: ['q24'],
  },

  q26: {
    id: 'q26', title: 'The Hollow King', act: 6, stage: 26, type: T.BOSS,
    narrative:
      'The deepest hall opens and the Hollow King is already standing, and has been for ' +
      'a very long time. It is a stone golem the way a mountain is a rock. It does not ' +
      'roar. It calls, once, and every golem in the depths turns toward the sound and ' +
      'starts walking. "The fifth seal is broken. The Final Seal has nothing left ' +
      'holding it shut."',
    objectives: [{ kind: K.BOSS_KILL, key: 'hollow_king', boss: 'hollow_king', count: 1, label: 'Defeat the Hollow King' }],
    rewards: [
      { kind: 'unlock', questId: 'q27' },
      { kind: 'title', id: 'kingsbane' },
    ],
    marker: { seal: 'deepstone' },
    requires: ['q25'],
  },

  // ════════════════════════════════════════════════════════════════════════
  // Act 7: The World Remade — the Final Seal. Corruption Overlord, three phases.
  // ════════════════════════════════════════════════════════════════════════

  q27: {
    id: 'q27', title: 'Keys of Power', act: 7, stage: 27, type: T.COLLECT,
    narrative:
      'The deepest corruption is a nightmare of twisted ground and toxic pools, and at ' +
      'the centre of it the spire finally answers to something. Crystals to pierce its ' +
      'shield; diamond because nothing softer survives contact with what is inside. "You ' +
      'were never restoring the seals. You were opening them. It needed all five, and it ' +
      'needed someone who would not stop." The voice does not apologise. It has not been ' +
      'the same voice for some time.',
    objectives: [
      item('corrupt_crystal', 'corrupt_crystal', 10, 'Corrupt Crystals'),
      item('diamond', 'diamond', 10, 'Diamonds'),
    ],
    rewards: [
      { kind: 'unlock', questId: 'q28' },
      { kind: 'title', id: 'seal_master' },
    ],
    marker: { seal: 'finale' },
    requires: ['q26'],
  },

  q28: {
    id: 'q28', title: 'The World Remade', act: 7, stage: 28, type: T.BOSS,
    narrative:
      'The Corruption Overlord is what is left when five guardians are broken and their ' +
      'power goes somewhere. It comes apart and reassembles three times before it is ' +
      'finished. Defeat it and the seals close on nothing, because there is nothing left ' +
      'to seal. "The seals are quiet. The world is yours again. You are the Seal Bearer ' +
      'who remade Cuubz."',
    objectives: [{ kind: K.BOSS_KILL, key: 'corruption_overlord', boss: 'corruption_overlord', count: 1, label: 'Defeat the Corruption Overlord' }],
    rewards: [
      { kind: 'title', id: 'world_saver' },
      { kind: 'complete' },
    ],
    marker: { seal: 'finale' },
    requires: ['q27'],
  },
});

/** Quest ids in stage order — the order the storyline breaks them. */
export const QUEST_ORDER = Object.freeze(
  Object.values(QUEST_DEFINITIONS)
    .sort((a, b) => a.stage - b.stage)
    .map((q) => q.id)
);

/** @param {string} id @returns {object|null} */
export function getQuest(id) {
  return QUEST_DEFINITIONS[id] || null;
}

/** Every quest in one act, in stage order. */
export function questsInAct(act) {
  return QUEST_ORDER.map((id) => QUEST_DEFINITIONS[id]).filter((q) => q.act === act);
}

/** The seven acts, with the storyline's own titles. */
export const ACTS = Object.freeze([
  { act: 1, title: 'Awakening', theme: 'Survival & Preparation', seal: null },
  { act: 2, title: 'The First Seal', theme: 'Discovery & Corruption', seal: 'verdant' },
  { act: 3, title: 'Fire and Ash', theme: 'Descent into Danger', seal: 'ember' },
  { act: 4, title: 'Frozen Truth', theme: 'Revelation & Resolve', seal: 'frozen' },
  { act: 5, title: 'Sea of Sand', theme: 'Endurance & Patience', seal: 'sunken' },
  { act: 6, title: 'The Hollow Depths', theme: 'Isolation & Descent', seal: 'deepstone' },
  { act: 7, title: 'The World Remade', theme: 'Confrontation & Resolution', seal: 'finale' },
]);
