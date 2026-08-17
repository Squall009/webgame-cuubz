# Cuubz — 28-Quest Storyline Design Document

> **Theme:** The world of Cuubz was once protected by five ancient elemental seals. The seals are failing, and corruption is spreading from a dark source deep beneath the world. As the last Seal Bearer, you must break the corruption's hold on all five seals and then confront the source itself.

> **Engineering companion: `quest_implementation.md`.** That document owns the *how* — state schema, multiplayer authority, worldgen, staging, and the nine build stages. This one owns the *what*. Where the two disagree, the implementation plan is newer.

## World Lore Summary

Long ago, the Five Seals were placed at key points in the world to keep an ancient corruption sealed beneath the surface. Each seal was guarded by a powerful elemental spirit. Over millennia, the seals weakened as their guardians fell one by one to the spreading corruption. Now the last Seal Bearer has awakened, and only you can restore the seals before the entire world is consumed.

## Act Structure

| Act | Quests | Theme | Seal | Boss | Biomes Explored |
|-----|--------|-------|------|------|-----------------|
| **Act 1: Awakening** | Q01–Q06 | Survival & Preparation | — | — | Plains, Forest, Mountains |
| **Act 2: The First Seal** | Q07–Q12 | Discovery & Corruption | Verdant | Forest Warden | Corrupt, Mountains |
| **Act 3: Fire and Ash** | Q13–Q17 | Descent into Danger | Ember | Lava Titan | Lava |
| **Act 4: Frozen Truth** | Q18–Q21 | Revelation & Resolve | Frozen | Frost Serpent | Tundra |
| **Act 5: Sea of Sand** | Q22–Q24 | Endurance & Patience | Sunken | Dune Colossus | Desert |
| **Act 6: The Hollow Depths** | Q25–Q26 | Isolation & Descent | Deepstone | Hollow King | Mountains (below Y 30) |
| **Act 7: The World Remade** | Q27–Q28 | Confrontation & Resolution | The Final Seal | Corruption Overlord *(3 phases)* | Corrupt (deep) |

**Five seals, five guardians, one source.** Acts 5 and 6 are newer than Acts 1–4 and were added when the seal count was fixed at five; Act 7 merges what were previously two separate finale fights into one three-phase confrontation, so that "all five broken" has exactly one thing waiting behind it.

---

## Act 1: Awakening (Quests 1–6)

> *You awaken in a strange world with no memory of how you arrived. The land around you is beautiful but unfamiliar. You must survive, learn the basics, and prepare for what lies ahead.*

### Quest 01: "First Steps"
- **Type:** COLLECT | **Stage:** 1
- **Requirements:** 5 wood_log, 10 dirt
- **Reward:** Unlock Q02
- **Narrative:** Your first moments in this world. A mysterious voice echoes: *"Gather what the land provides. You will need strength for what comes."* Trees grow tall in the plains and forests nearby. Break their trunks and dig into the earth beneath.
- **Marker Location:** Plains biome, offset from spawn

### Quest 02: "Crafting Basics"
- **Type:** CRAFT | **Stage:** 2
- **Requirements:** 10 planks (crafted from wood)
- **Reward:** Unlock Q03
- **Narrative:** Raw materials are only the beginning. The voice returns: *"Shape what you gather. From logs come planks, and from planks come tools for the journey ahead."* Learn to craft basic building blocks.
- **Marker Location:** Plains biome

### Quest 03: "A Warm Meal"
- **Type:** COLLECT | **Stage:** 3
- **Requirements:** 3 apples
- **Reward:** ITEM (5 berry) + Unlock Q04
- **Narrative:** Hunger gnaws at you. You notice red fruit hanging from trees in the forest — apples, sweet and sustaining. *"The land provides for those who look carefully."* The berries found nearby will serve as backup rations.
- **Marker Location:** Forest biome

### Quest 04: "Mining the Depths"
- **Type:** COLLECT | **Stage:** 4
- **Requirements:** 10 coal
- **Reward:** Unlock Q05
- **Narrative:** The voice grows urgent: *"The corruption spreads from below. You must learn what lies beneath the surface."* Venture into caves and mine the black veins of coal — fuel for warmth and light in the darkness ahead.
- **Marker Location:** Mountains biome

### Quest 05: "Iron Will"
- **Type:** COLLECT | **Stage:** 5
- **Requirements:** 8 iron_ore
- **Reward:** Unlock Q06
- **Narrative:** Deeper still, you find veins of silver-white ore embedded in stone. *"Iron is the backbone of civilization. Forge it into strength."* The mountains hide secrets that will prove essential against the corruption.
- **Marker Location:** Mountains biome

### Quest 06: "A Safe Place to Rest"
- **Type:** CRAFT | **Stage:** 6
- **Requirements:** 1 bed (crafted)
- **Reward:** Unlock Q07 + TITLE ("Survivor")
- **Narrative:** Exhaustion takes its toll. The voice softens: *"Even heroes need rest. Build a place to call home, and set your spawn where the night cannot find you."* With a bed placed, you establish your first foothold in this world — ready for what comes next.
- **Marker Location:** Plains biome near spawn

---

## Act 2: The First Seal — Forest Warden (Quests 7–12)

> *Strange purple crystals pulse with dark energy in the distance. The corruption has a physical form — and it's spreading from an ancient dungeon where the first seal guardian once stood.*

### Quest 07: "Whispers in the Dark"
- **Type:** EXPLORE | **Stage:** 7
- **Requirements:** 1 corrupt_crystal
- **Reward:** Unlock Q08
- **Narrative:** You discover a patch of land twisted by dark energy. The ground is purple, pools of toxic slime bubble ominously. Among the corruption, you find a crystallized fragment — a corrupt crystal, humming with malevolent power. *"The First Seal has fallen. Its guardian, the Forest Warden, was consumed by this darkness."*
- **Marker Location:** Corrupt biome (edge)

### Quest 08: "Gathering Defenses"
- **Type:** COLLECT | **Stage:** 8
- **Requirements:** 5 gold_ore, 3 diamond
- **Reward:** Unlock Q09 + TITLE ("Seeker")
- **Narrative:** To confront the corruption, you need materials of extraordinary strength. Gold and diamond — rare treasures found only in the deepest veins of the mountains. *"The strongest metals come from the deepest places."* Prepare for a battle unlike any other.
- **Marker Location:** Mountains biome (deep caves)

### Quest 09: "The First Key"
- **Type:** COLLECT | **Stage:** 9
- **Requirements:** 1 quest_key
- **Reward:** Unlock Q10
- **Narrative:** Deep in the corrupt zone, a golden key rests on an ancient altar. It's warm to the touch and pulses with light — a counter to the darkness around it. *"This key opens the path to the dungeon where the Forest Warden lies trapped."*
- **Marker Location:** Corrupt biome (inner)

### Quest 10: "Into the Dungeon"
- **Type:** COLLECT | **Stage:** 10
- **Requirements:** 5 corrupt_crystal
- **Reward:** Unlock Q11
- **Narrative:** Armed with the key, you venture deeper into the corruption. The dungeon entrance is marked by twisted trees and pools of toxic slime. Collect corrupt crystals from the dungeon — each one weakens the barrier protecting the Forest Warden's prison. *"Gather five fragments. They will be needed to summon the guardian."*
- **Marker Location:** Corrupt biome (dungeon entrance)

### Quest 11: "Offering of Light"
- **Type:** DELIVER | **Stage:** 11
- **Requirements:** 1 quest_key, 5 corrupt_crystal
- **Reward:** Unlock Q12
- **Narrative:** Return to the dungeon altar. Place the key and crystals together. The altar blazes with light as the corruption recoils. *"The offering is complete. The Forest Warden stirs from its dark slumber. Prepare for battle."*
- **Marker Location:** Corrupt biome (altar)

### Quest 12: "The Forest Warden" ⚔️ BOSS
- **Type:** BOSS | **Stage:** 12 | **Boss:** forest_warden
- **Requirements:** 1 boss_kill
- **Reward:** Unlock Q13 + TITLE ("Warden Slayer")
- **Narrative:** The Forest Warden awakens — a massive creature of corrupted roots and thorns, once the guardian of the First Seal. It attacks with sweeping vine lashes and spores of poison. Defeat it to cleanse the first seal. *"The corruption retreats from this land. But four more seals await."*
- **Boss Mechanics:** Vine lash (melee), poison spores (AoE DoT), root entangle (stun)
- **Marker Location:** Corrupt biome (dungeon center)

---

## Act 3: Fire and Ash — Lava Titan (Quests 13–17)

> *With the first seal restored, you learn of a second guardian consumed by volcanic fire. The corruption has found a new host in the world's most dangerous biome.*

### Quest 13: "Ashes of the Past"
- **Type:** EXPLORE | **Stage:** 13
- **Requirements:** 5 obsidian
- **Reward:** Unlock Q14
- **Narrative:** A volcanic wasteland stretches before you — rivers of lava, columns of obsidian, heat that burns with every breath. *"The Second Seal lies in the heart of fire. Gather obsidian — stone forged by the world's fury."* This material will protect you from the heat to come.
- **Marker Location:** Lava biome

### Quest 14: "Fireproof Preparation"
- **Type:** COLLECT | **Stage:** 14
- **Requirements:** 15 obsidian, 20 blackstone
- **Reward:** Unlock Q15 + TITLE ("Firewalker")
- **Narrative:** The deeper you go into the volcanic zone, the more materials you find. Blackstone — dense, heat-resistant stone formed by lava cooling rapidly. *"Arm yourself with the world's own defenses. Fire will be your enemy and your ally."*
- **Marker Location:** Lava biome (deep)

### Quest 15: "The Second Key"
- **Type:** COLLECT | **Stage:** 15
- **Requirements:** 1 quest_key
- **Reward:** Unlock Q16
- **Narrative:** Hidden in a lava-flowed cavern, the second key glows with an inner heat. Unlike the first, this one is forged from volcanic glass — obsidian shaped into a key by ancient hands. *"The Lava Titan waits beneath the surface. This key will open its prison."*
- **Marker Location:** Lava biome (cavern)

### Quest 16: "Heart of Fire"
- **Type:** DELIVER | **Stage:** 16
- **Requirements:** 1 quest_key, 10 obsidian
- **Reward:** Unlock Q17
- **Narrative:** Place the key and obsidian at the volcanic altar. The ground trembles as lava rises around you. *"The second guardian stirs. The Lava Titan — a creature of molten rock and ancient rage. Stand firm."*
- **Marker Location:** Lava biome (altar)

### Quest 17: "The Lava Titan" ⚔️ BOSS
- **Type:** BOSS | **Stage:** 17 | **Boss:** lava_titan
- **Requirements:** 1 boss_kill
- **Reward:** Unlock Q18 + TITLE ("Titan Bane")
- **Narrative:** The ground cracks open and the Lava Titan erupts — a towering being of molten rock. It smashes the terrain, creates lava pools that spread fire across the battlefield, and fires streams of molten debris. *"The second seal is broken. Three remain."*
- **Boss Mechanics:** Ground slam (AoE), lava pool creation (environmental damage), magma projectile (ranged)
- **Marker Location:** Lava biome (dungeon center)

---

## Act 4: Frozen Truth — Frost Serpent (Quests 18–21)

> *The third seal lies in a frozen wasteland where an ancient serpent coils around the last remaining pillar of ice. But the corruption has reached here too.*

### Quest 18: "Frozen Wastes"
- **Type:** EXPLORE | **Stage:** 18
- **Requirements:** 10 ice
- **Reward:** Unlock Q19
- **Narrative:** A blizzard howls as you enter the tundra. Everything is frozen solid — ground, trees, even the air seems to crystallize. *"The Third Seal is guarded by the Frost Serpent. An ancient being of ice and patience."* Gather ice from the frozen landscape to survive the cold.
- **Marker Location:** Tundra biome

### Quest 19: "Winter Supplies"
- **Type:** COLLECT | **Stage:** 19
- **Requirements:** 5 cooked_meat, 3 bread, 15 ice
- **Reward:** Unlock Q20 + TITLE ("Icebound")
- **Narrative:** The cold demands preparation. Find food caches left by ancient travelers — preserved meat and bread sealed in ice. *"The serpent's domain is merciless. Stock your provisions well."* The extra ice will serve as insulation against the coming battle.
- **Marker Location:** Tundra biome (deep)

### Quest 20: "The Third Key"
- **Type:** COLLECT | **Stage:** 20
- **Requirements:** 1 quest_key
- **Reward:** Unlock Q21
- **Narrative:** The third key is encased in a glacier — frozen in time for millennia. Break through the ice to retrieve it. *"The Frost Serpent awaits. This key will free the seal from its icy prison."*
- **Marker Location:** Tundra biome (glacier)

### Quest 21: "The Frost Serpent" ⚔️ BOSS
- **Type:** BOSS | **Stage:** 21 | **Boss:** frost_serpent
- **Requirements:** 1 boss_kill
- **Reward:** Unlock Q22 + TITLE ("Serpent Slayer")
- **Narrative:** The glacier cracks as the Frost Serpent uncoils — a massive serpent of living ice, its scales sharp as blades. It breathes freezing mist that slows movement, strikes with its body like a whip, and creates ice walls to block your path. *"Three broken. Two remain — and the voice has begun to sound eager."*
- **Boss Mechanics:** Ice breath (slows movement), tail swipe (melee), ice wall creation (blocks line of sight)
- **Marker Location:** Tundra biome (dungeon center)

---

## Act 5: Sea of Sand — Dune Colossus (Quests 22–24)

> *Three seals broken. The voice grows fainter, and for the first time it sounds uncertain. The fourth seal was never guarded by a spirit at all — it was buried, deliberately, under an ocean of sand, by people who hoped it would simply be forgotten.*

### Quest 22: "Sea of Sand"
- **Type:** EXPLORE | **Stage:** 22
- **Requirements:** 15 sandstone
- **Reward:** Unlock Q23
- **Narrative:** The desert does not announce itself. One morning the grass thins, the trees stop, and by afternoon there is nothing in any direction but heat and dunes. Somewhere beneath them is the Sunken Seal. *"They did not set a guardian here. They set a grave, and hoped the sand would keep it."* Cut into the sandstone shelves that break the dunes — the ruins of whoever did the burying are still down there.
- **Marker Location:** Desert biome

### Quest 23: "The Sunken Key"
- **Type:** COLLECT | **Stage:** 23
- **Requirements:** 1 seal_key_sunken
- **Reward:** Unlock Q24 + TITLE ("Sandborn")
- **Narrative:** The buried hall is intact — sandstone pillars, a floor swept clean by nothing, and at the far end a key of pale stone resting where someone left it in a hurry. It is warm, and the warmth has nothing to do with the desert. *"The ones who buried this seal did not lock it. They could not. They only hid it, and hoped."*
- **Marker Location:** Desert biome (buried hall)

### Quest 24: "The Dune Colossus" ⚔️ BOSS
- **Type:** BOSS | **Stage:** 24 | **Boss:** dune_colossus
- **Requirements:** 1 boss_kill
- **Reward:** Unlock Q25 + TITLE ("Colossus Breaker")
- **Narrative:** The floor of the hall is not a floor. It stands, and the ceiling goes with it — a figure of compacted sandstone and swallowed ruin, wearing the buried hall like armour. This one was never a guardian corrupted. It is what the corruption made *out of* the grave they dug. It fights patiently, the way a desert does. *"Four seals broken. One left, and then the thing that broke them."*
- **Boss Mechanics:** Stone fist slam (heavy melee), sand shroud (obscures vision, slows), burrow and surface (repositions underground, unavoidable AoE on emergence)
- **Marker Location:** Desert biome (buried hall, centre)

---

## Act 6: The Hollow Depths — Hollow King (Quests 25–26)

> *Four broken. The fifth seal is not hidden and not buried — it is simply deep, in the oldest stone in the world, and everything that ever went down to guard it is still there.*

### Quest 25: "The Hollow Depths"
- **Type:** COLLECT | **Stage:** 25
- **Requirements:** 20 deepslate, 1 seal_key_deepstone
- **Reward:** Unlock Q26 + TITLE ("Deepwalker")
- **Narrative:** Below thirty, the stone changes. It goes dark and dense and old, and the caves stop feeling like caves and start feeling like rooms. The Deepstone Seal is down here, and so is its key, and so is everything that has been walking these halls since long before you woke up. *"The guardians of the fifth seal did not fall to the corruption. They stayed, and they hollowed, and they kept walking."* Bring back deepslate — you will need to shore up what you break through.
- **Marker Location:** Mountains biome, below Y 30

### Quest 26: "The Hollow King" ⚔️ BOSS
- **Type:** BOSS | **Stage:** 26 | **Boss:** hollow_king
- **Requirements:** 1 boss_kill
- **Reward:** Unlock Q27 + TITLE ("Kingsbane")
- **Narrative:** The deepest hall opens and the Hollow King is already standing, and has been for a very long time. It is a stone golem the way a mountain is a rock. It does not roar. It calls, once, and every golem in the depths turns toward the sound and starts walking. *"The fifth seal is broken. The Final Seal has nothing left holding it shut."*
- **Boss Mechanics:** Echo call (summons stone golems from the surrounding depths), tremor (radial ground AoE, telegraphed by dust), collapsing reach (long-range grab and slam)
- **Marker Location:** Mountains biome, deepest hall

---

## Act 7: The World Remade — Corruption Overlord (Quests 27–28)

> *All five seals are broken and the world has not been saved by it. Every seal you opened let a little more of the thing beneath through, and now the spire in the deep corruption — the one that has been standing there since the day you woke up, that you have walked past five times — is open.*

### Quest 27: "Keys of Power"
- **Type:** COLLECT | **Stage:** 27
- **Requirements:** 10 corrupt_crystal, 10 diamond
- **Reward:** Unlock Q28 + TITLE ("Seal Master")
- **Narrative:** The deepest corruption is a nightmare of twisted ground and toxic pools, and at the centre of it the spire finally answers to something. Crystals to pierce its shield; diamond because nothing softer survives contact with what is inside. *"You were never restoring the seals. You were opening them. It needed all five, and it needed someone who would not stop."* The voice does not apologise. It has not been the same voice for some time.
- **Marker Location:** Corrupt biome (deep zone, spire base)

### Quest 28: "The World Remade" ⚔️ FINAL BOSS
- **Type:** BOSS | **Stage:** 28 | **Boss:** corruption_overlord
- **Requirements:** 1 boss_kill
- **Reward:** TITLE ("World Saver") + GAME COMPLETE
- **Narrative:** The Corruption Overlord is what is left when five guardians are broken and their power goes somewhere. It comes apart and reassembles three times before it is finished. Defeat it and the seals close on nothing, because there is nothing left to seal. *"The seals are quiet. The world is yours again. You are the Seal Bearer who remade Cuubz."*
- **Phase 1 — Guardian:** Wears the broken guardians. Vine lash, ice breath and magma bursts in sequence, each an echo of a boss you have already beaten.
- **Phase 2 — Darkness:** Sheds the borrowed shapes. Summons corrupt minions continuously, seeds spreading corruption pools across the arena floor, raises a crystal shield that must be broken to resume damage.
- **Phase 3 — True Form:** Everything at once, faster, with no shield and no pause. The arena is mostly corruption by now, which is the point.
- **Marker Location:** Corrupt biome (spire summit)

---

## Seal and Dungeon Summary

| # | Seal | Dungeon | Biome | Key Quest | Boss Quest | Boss | Offering |
|---|------|---------|-------|-----------|------------|------|----------|
| 1 | Verdant | Forest Warden's Dungeon | Corrupt | Q09 | Q12 | Forest Warden | seal_key_verdant, 5 corrupt_crystal |
| 2 | Ember | Lava Titan's Lair | Lava | Q15 | Q17 | Lava Titan | seal_key_ember, 10 obsidian |
| 3 | Frozen | Frost Serpent's Glacier | Tundra | Q20 | Q21 | Frost Serpent | seal_key_frozen |
| 4 | Sunken | The Buried Hall | Desert | Q23 | Q24 | Dune Colossus | seal_key_sunken |
| 5 | Deepstone | The Hollow Depths | Mountains (below Y 30) | Q25 | Q26 | Hollow King | seal_key_deepstone |
| ★ | The Final Seal | Corruption Spire | Corrupt (deep) | Q27 | Q28 | Corruption Overlord *(3 phases)* | all five seals broken, 10 diamond |

**Each seal has its own key item.** `quest_key` is a single-stack item, so one shared key across five dungeons could never be carried — the five `seal_key_*` items exist for that reason. See `quest_implementation.md` §4.3.

## Biomes and Environmental Hazard

Two biomes are added for this storyline: **Corrupt** and **Lava**. They are the world's first environmentally dangerous places, and that is as much the point of adding them as the seals are.

- **Corrupt** — corrupted ground is *scattered*, not total. The biome raises the chance of a corrupted block; it does not replace everything. Standing on corrupted ground drains health very slowly, and **the drain stops the moment you step off**. There is no lingering effect and nothing follows you out of the biome. It is a place you pick your way across, not a place you flee.
- **Lava** — lava kills, quickly and obviously. Magma is a mild hazard underfoot. Nothing subtle.

The Corrupt biome is where `corrupt_crystal` comes from, and it is home to the `corrupt_wolf` and `corrupt_wisp`, which have existed in the mob registry since before the biome did.

## Item Placement in World Generation

Quest items are placed at deterministic locations during world generation:

- **seal_key_\*:** One per seal, in that seal's dungeon, on or near the altar
- **corrupt_crystal:** Scattered in Corrupt biome chunks, denser near the seal sites
- **coal_ore / iron_ore / gold_ore / diamond_ore:** Depth-based ore veins (standard world gen)
- **obsidian / blackstone / magma:** Lava biome surface and caves
- **sandstone:** Desert biome shelves and the buried hall
- **deepslate:** Below Y 40 everywhere; the Hollow Depths are built from it
- **ice:** Tundra biome surface
- **apple:** On trees in plains/forest biomes

## Title Progression

| Quest | Title Earned | Significance |
|-------|-------------|--------------|
| Q06 | "Survivor" | Established a foothold |
| Q08 | "Seeker" | Found rare materials |
| Q12 | "Warden Slayer" | First seal broken |
| Q14 | "Firewalker" | Survived the Lava biome |
| Q17 | "Titan Bane" | Second seal broken |
| Q19 | "Icebound" | Survived the tundra |
| Q21 | "Serpent Slayer" | Third seal broken |
| Q23 | "Sandborn" | Found what the desert buried |
| Q24 | "Colossus Breaker" | Fourth seal broken |
| Q25 | "Deepwalker" | Reached the oldest stone |
| Q26 | "Kingsbane" | Fifth seal broken |
| Q27 | "Seal Master" | Prepared for the source |
| Q28 | "World Saver" | Game complete |

## Known Gaps Against the Current Build — closed

This section used to list two quests that asked for content the game did not have. There
were **four**, and all four are now built rather than re-specified:

- **Q06** wanted a crafted `bed`. There was no `bed` block and no recipe. There is now:
  block 198, wool over planks, crafting-table recipe. (No bed texture ships and drawing
  one was not worth it; a bed in a voxel world is wool over planks.)
- **Q19** wanted 3 `bread`. `bread` was a defined item with a texture, no recipe and no
  source anywhere in the world. It has a hand recipe from hay now.
- **Q13, Q14, Q16** wanted `obsidian`. `BLOCK_TYPES.OBSIDIAN` was an alias for
  `crying_obsidian` — hardness -1, unbreakable, drops nothing. Three of Act 3's five
  quests asked the player to collect a block the game refused to let them break, and did
  so silently. `obsidian` is a real, mineable block now (`BUGS.md` **D-118**).
- **Q22** wanted `sandstone`, which had no registry entry at all despite its three
  textures shipping since forever (**D-119**).

`test/unit/game/questSystem.test.js` now checks **every** `contribute_item` objective in
all 28 quests against the block registry: the item must be a real `NAMED_ITEMS` entry, or
a block that is breakable and drops something. The next quest to ask for the impossible
fails a test rather than a playthrough.

## Implementation Status

**Built.** S0–S8 all landed on `feat/quest-system`; `quest_implementation.md` §13 is the
record of what held, what did not, and the five defects the work uncovered. Two notes for
anyone reading the narrative above and expecting to see it move:

- The **ranged attacks** described for the Lava Titan ("streams of molten debris") and the
  Frost Serpent ("breathes freezing mist") are built as hazard *fields* rather than
  projectiles — a pool of magma or lava, and a field of ice to be fought around. There is
  no projectile renderer in this engine and a projectile nobody can see is worse than a
  hazard they can. Everything else in the Boss Mechanics lines is as written.
- The **Corrupt biome's fog and sky** and the **corrupt_wolf** and **corrupt_wisp** were
  written years before the biome existed. They all work now, unchanged.

### After the first pass — what changed in the world the storyline describes

`quest_implementation.md` §14 is the engineering record. Four things in it change what a
player actually experiences of the narrative above:

- **Food is food now.** Q03's five berries, Q06's whole "prepare to survive" premise and
  Q19's three loaves of bread all referred to items that did nothing at all: `foodRestore`
  was a hunger number and hunger was deleted before any of this was written (`BUGS.md`
  **D-123**). Right-click eats, one bite per 1.2 s. The Winter Supplies quest is now
  supplies.
- **The bosses can reach you.** Five of the six were slower than a walking player, so
  every fight in the storyline could be won by holding the back key and clicking
  (**D-124**). They are faster than a walk and slower than a sprint now — the Colossus and
  the Serpent are no longer told apart by speed, but by how often and how hard they swing.
- **The Lava biome is inhabited.** It had no mob of its own, which made the one place in
  the game that can kill you also the emptiest, across four quests. The **ash crawler** is
  a low, slow thing of cooled crust and molten seams — the Lava Titan's own look, small.
  The shoreline got a **sand crab**, and hares now range into the desert, the badlands and
  the frozen peaks.
- **A world made before the Corrupt and Lava biomes existed can be opted in**, from a
  badge on its slot in the world screen. Without it that save can never reach the Verdant
  or Ember seal, and so can never reach the ending described above.

Still true: the ranged attacks are hazard fields rather than projectiles, and no mob lives
in the ocean — mobs cannot swim (**D-70**), and a fish that walks along the seabed is
worse than no fish.
