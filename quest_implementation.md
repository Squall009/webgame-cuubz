# Cuubz — Quest, Seal and Boss Implementation Plan

> **Status: IMPLEMENTED. S0–S8 all landed on `feat/quest-system`, S9+ in §14.**
> Companion to `questStoryline.md`, which is the *narrative* design. This file is the
> *engineering* design: what exists, what does not, what has to be built, in what order,
> and which decisions are still open.
>
> **Read §13 first.** The plan below is preserved as written, because it is the record of
> what was decided and why, and several of its judgements turned out to matter more than
> they looked. §13 is what actually happened: which parts held, which numbers were wrong,
> the five defects the work uncovered (D-117 through D-121), and the answers taken to the
> four open questions §12 left. **§14 is the follow-up session** — the gaps §13 named,
> closed or explicitly declined.

**The headline:** `questStoryline.md` describes a feature that this codebase has almost
none of the machinery for. The quest *data* items exist (`quest_key`, `corrupt_crystal`),
the quest *HUD markup* exists, and one quest *wire message* exists — but the three
disagree about what quest state even is, nothing routes the wire message, mobs are not
networked at all, and the player has no health. This plan is honest about that: roughly
60% of the work below is prerequisites, not quests.

**Decisions taken (2026-08-08).** The Corrupt and Lava biomes are being **built**, not
faked with structures, and they carry environmental damage — the world currently has no
hazardous biome at all and that is the point of adding them (§3, S4). Objectives are
**pooled**: every player's work counts toward one party-wide total (§4.5). The storyline
extends to **28 quests** across seven acts (§3.6). Branch is `feat/quest-system`.

---

## 1. What already exists

Verified against the tree at `ea8b2db`.

| Thing | Where | State |
|---|---|---|
| Quest HUD markup | `src/ui/templates/hud.js:78-84` — `#quest-tracker`, `#quest-name`, `#quest-objective`, `#quest-progress` | Mounted, permanently `hidden`, **zero writers** |
| Quest HUD styling | `src/ui/css/hud/quest-tracker.css`, imported at `src/ui/css/index.css:45` | Complete |
| **Corrupt + Lava fog/sky** | `src/engine/renderer/BiomeEffects.js:54-55` | **Already written for biomes that do not exist.** Free. |
| **Corrupt mobs** | `mobDefinitions.js:201` `corrupt_wolf`, `:366` `corrupt_wisp` | **Already written.** Rehomed to `badlands` by D-68 because `corrupt` was not producible. |
| `quest_key` item | `src/game/data/ItemDefinitions.js:109` (`maxStack: 1`) | Defined, never obtainable |
| `corrupt_crystal` item | `src/game/data/ItemDefinitions.js:106` (`maxStack: 1`) | Defined, never obtainable |
| Quest block ids | `src/engine/world/BlockRegistry.js:466-469` — `TOXIC_SLIME`(188), `CORRUPT_CRYSTAL`(189), `APPLE`, `QUEST_KEY` | Defined, never placed by worldgen |
| Lava-biome blocks | `netherrack`(147), `basalt`(148), `soul_sand`(150), `soul_soil`(151), `magma`(155, emissive), `blackstone`, `crying_obsidian`, `lava`(47), `soul_lantern`(174) | **All present.** No new blocks needed for Lava. |
| **Corrupt-biome textures** | `textures/blocks/` — `sculk`, `sculk_vein`, `sculk_catalyst_*`, `warped_nylium` + `_side`, `crimson_nylium` + `_side`, `warped_wart_block`, `twisting_vines`, `weeping_vines`, `pale_moss_block`, `mycelium_top`/`_side`, `shroomlight` | **All present. Zero new art needed** — §3.4 |
| Single-stack rules | `src/game/systems/InventoryItemTypes.js:57`, `src/multiplayer/InventorySync.js:78` | Correct and consistent |
| Creative palette | `src/core/BlockPalette.js:48-50` | Works |
| `QUEST_UPDATE` wire type | `shared/protocol.js` | Defined |
| Relay forwarding | `server/session.js:260-263` | Works |
| Host-side validator | `src/multiplayer/Host.js:256` `validateQuestUpdate()` | Works, but **wrong semantics** for pooled — §4.5 |
| Host-side handler | `src/multiplayer/Host.js:989` `handleQuestUpdate()` | **Never called** — §2.1 |
| World-scoped quest slot | `WorldManager.js:226, 360-398`; `Persistence.js:176` | Persisted, never written by gameplay |
| Mob framework | `src/game/mobs/*` — definitions, AI, movement, procedural geometry, animation, renderer | Works, single-player only |

The three rows in bold are the pleasant surprise of this audit: someone already wrote the
Corrupt and Lava *presentation* layer and two Corrupt *mobs*, and D-68 disabled the mobs
because the biomes were never built. S4 turns all of it on.

### What was deleted, and why it matters

PR 34 deleted five gameplay modules outright (`src/index.js:48-81`):

| Module | Lines | Consequence for this plan |
|---|---|---|
| `game/systems/QuestSystem.js` | 262 | No quest state machine. Rewrite. |
| `game/entities/QuestMarker.js` | 605 | No world markers/waypoints. Rewrite (smaller). |
| `game/entities/Boss.js` | 1,135 | No boss entity. It had **no renderer at all**. |
| `game/systems/SurvivalSystem.js` | 1,159 | **No player health.** §2.2 |
| `game/systems/DamageSystem.js` | 627 | **No environmental damage.** §2.2, and see the D-64 warning in S4. |

Recoverable from git and the `pre-refactor-baseline` tag. **This plan does not recommend
restoring any of them.** PR 34's reasons hold: `Boss.js` was unkillable
(`phaseTransitionTimer` never initialised, NaN-frozen), `DamageSystem` had pre-renumbering
block ids, `SurvivalSystem` emitted a competing `#survival-hud`. Salvage *shape*, not code.

---

## 2. The blockers

### 2.1 Quest state has three incompatible shapes and no live path

Named in `src/index.js:67` and still true:

```
WorldManager.questProgress      →  { [questId]: { stage, completed, lastUpdated } }   (WorldManager.js:385-396)
Host._worldState.questProgress  →  { [questId]: number }                              (Host.js:1001-1003)
SessionRejoin / AutoRejoin      →  {}                                                 (SessionRejoin.js:89, AutoRejoin.js:88)
```

The wire path is **broken at both ends**:

1. `HostManager._setupGameHandlers()` (`Host.js:618-655`) registers `WELCOME`,
   `PLAYER_JOINED`, `PLAYER_LEFT`, `PLAYER_MOVE`, `BLOCK_BREAK`, `BLOCK_PLACE`,
   `INVENTORY_SYNC` — and **not** `QUEST_UPDATE`. `handleQuestUpdate()` has no caller
   anywhere in `src/`.
2. `MultiplayerClient._setupGameSessionHandlers()` (`Client.js:1016-1021`) omits
   `QUEST_UPDATE` from its forwarded events, so even the host's broadcast is dropped by
   every client including the sender.

`WorldManager.advanceQuest()` hard-codes `completed = nextStage >= 5` under the comment
"simplified — actual quest system will define stages" (`WorldManager.js:390`). Placeholder,
not contract.

### 2.2 The player has no health, and nothing can hurt them

`src/game/entities/Player.js` has `respawn(spawnPoint)` and **no `health`, no
`takeDamage`, no death**. `MobIntegration.init()` installs `onMobAttack` only
`if (survivalSystem)` (`mobIntegration.js:68`), and `initMobs.js:35` passes `null`.

So today: **mobs cannot damage the player, the player cannot die, and no block is
hazardous.** Every "Boss Mechanics" line in `questStoryline.md` describes damage with no
receiver — and so does the entire premise of a dangerous Lava biome.

The five `.meter-fill` bars in `hud.js:39-60` are hard-coded `width: 100%` in
`src/ui/css/hud/meters.css` with no writer.

**Recommendation: a minimal `PlayerVitals` — health only.** Not hunger/thirst/sleep/
stamina, not the 1,159-line `SurvivalSystem`. Health, damage with the armour reduction that
already exists at `mobIntegration.js:74-79`, death, respawn at
`character.spawnPoints[worldId]` (already written by `savePlayerState.js:45-50`), and a
writer for `#health-meter .meter-fill`. The other four bars stay at 100% and stay honest.

This is a hard prerequisite for **both** S4 (hazardous biomes) and S6 (bosses).

### 2.3 Mobs are entirely client-local and non-deterministic

`shared/protocol.js` has **no mob message type of any kind**. Each client runs its own
`MobManager`, seeded per world but driven by `Math.random()` at `mob.js:37, 43, 85, 117,
211, 213`; `mobManager.js:160, 259, 260, 291`; `mobDefinitions.js:485`.

Two players in the same chunk see **completely different mobs**. A shared boss fight
requires a host-authoritative networked entity layer that does not exist. §6 designs it;
it is the largest single item in the plan.

### 2.4 The biome classifier is duplicated verbatim

**This is the constraint that shapes all of S4.** `selectBiome` exists twice:

- `src/engine/world/BiomeSystem.js:126-161` — ESM, exported, used by the main thread
  (`BiomeEffects`, mob spawning, `WorldStep.js:98`).
- `src/engine/world/workerGeneration.js:473-500` — a **classic script** with its own
  `var BIOME` table at `:71-160`, no imports, loaded `?url` into the worker pool and
  assigning `window._voxelgenGenerateChunk` for the main-thread fallback
  (`ChunkGenerator.js:22-30, 51-53`).

The two are byte-equivalent today. **Any biome added to one must be added to the other,
identically**, or the terrain the worker builds will disagree with the biome the main
thread thinks the player is standing in — wrong fog, wrong mob spawns, wrong hazard
checks, and no test failure. Add a test that asserts the two tables agree (see S4).

### 2.5 Missing content the storyline assumes

| Storyline needs | Reality |
|---|---|
| Q06: craft a `bed` | **No `bed` block, no `bed` recipe.** Not in `BlockRegistry.js`, not in `CraftingSystem.RECIPES`. |
| Q19: 3 `bread` | `bread` is a defined item (`ItemDefinitions.js:116`) with **no recipe and no source**. |
| `quest_key` icon | `textures/items/` has `corrupt_crystal.png` and `apple.png` but **no `quest_key.png`**. |
| 5 dungeons × `1 quest_key` | `quest_key` is `maxStack: 1`. Two seal keys cannot be carried. Needs five distinct key items (§4.3). |
| `boss_kill` requirement | No such concept. New objective kind (§4.2). |
| Titles | No title system anywhere (§4.4). |
| Corrupt ground blocks | Lava has every block it needs; Corrupt needs three new **registry entries** — but **no new textures**, see §3.4. |

---

## 3. World design

### 3.1 Decision D-Q1 — build the biomes (RESOLVED: build them)

Corrupt and Lava become **real entries in `BIOME_DEFS`**, not structures. Rationale from
the user: the world has no environmentally dangerous biome at all today, and that is the
gap worth closing — a hazard that only exists inside a boss arena is not a hazard, it is a
cutscene.

**The cost, stated plainly.** `workerGeneration.js` derives terrain from `(cx, cz, seed)`.
Adding biomes changes what *newly generated* chunks look like while already-saved chunks
keep the old terrain (chunks live in IndexedDB keyed `${worldId}:${cx},${cz}` —
`Persistence.js:130-133`). An existing world that has already explored outward will show a
**visible seam** where old chunks meet new.

**Mitigation: `worldgenVersion` on the world config.** New worlds get `2` and the new
biomes; existing worlds stay at `1` and generate exactly as they do today. Threaded to the
worker through `genParams`, which `ChunkGenerator.generateChunk` already passes
(`:44-51`). A v1 world can be opted in from the world screen with a "this will seam your
terrain" confirmation. This keeps every existing save byte-identical and makes the upgrade
the player's choice.

### 3.2 How the two biomes are placed

Corrupt and Lava are **not climate-driven** — there is no temperature/humidity combination
that means "cursed". Bolting them into the `cont`/`eros`/`temp`/`hum` waterfall at
`selectBiome` would displace existing biomes and change terrain everywhere.

Instead: a **separate low-frequency mask noise**, sampled independently, that *overrides*
the climate result where it exceeds a threshold. Rare, patchy, biome-sized blobs dropped on
top of an otherwise unchanged world.

```
selectBiome(cont, eros, temp, hum, blight, scorch)
  if (scorch > 0.62 && cont > 0.02)  return BIOME.LAVA      // not in oceans
  if (blight > 0.60 && cont > 0.02)  return BIOME.CORRUPT
  … existing waterfall, untouched …
```

Two properties this buys:

- **Existing terrain is untouched wherever the masks are below threshold**, which is most
  of the world. A v1→v2 upgrade seams only inside blight/scorch patches.
- **Tunable rarity by one number each.** Target roughly 2–4% of land area per biome.

Both masks are new Perlin channels seeded off the world seed, added to the params object at
`BiomeSystem.js` and `workerGeneration.js:462-463` — **in both copies** (§2.4).

### 3.3 What the two biomes are made of

| | Corrupt | Lava |
|---|---|---|
| Surface | `corrupt_grass` *(new id)* scattered through ordinary grass/dirt | `netherrack`, `basalt` |
| Subsurface | `corrupt_stone` *(new id)*, `deepslate` | `netherrack`, `blackstone` |
| Fluid | `toxic_slime` pools | `lava` lakes (id 47) |
| Decoration | `corrupt_crystal` clusters, `corrupt_vein` *(new id)*, dead trees | `magma` (emissive), `crying_obsidian`, `soul_lantern` |
| Fog / sky | **already defined** — `BiomeEffects.js:55` | **already defined** — `BiomeEffects.js:54` |
| Mobs | **`corrupt_wolf`, `corrupt_wisp` already written** — restore `biomes: ['corrupt']` | new, or reuse hostiles |
| Trees / flowers | none — needs a `BIOME_FEATURES` row (`workerGeneration.js:187-196`) | none — same |
| Hazard | standing on a corrupt block → **very slow** health drain, stops on step-off | `lava` → heavy DoT; `magma` → light DoT on stand |

### 3.4 Textures — nothing new needs drawing

**Checked `textures/blocks/` (898 base diffuse PNGs). Every texture the Corrupt biome needs
is already there**, unreferenced by `BlockRegistry` and therefore currently unused:

| New block | id | Texture (existing PNG) | Notes |
|---|---|---|---|
| `corrupt_grass` | 193 | `side: 'warped_nylium', top: 'warped_nylium_side', bottom: 'dirt'` | Nylium already ships the grass-block-style top/side split |
| `corrupt_stone` | 194 | `all: 'sculk'` | Dark, veined, reads as infected stone |
| `corrupt_vein` | 195 | `all: 'sculk_vein'` | `cutout` overlay decoration, hardness 0 |

Ids **193–195 are free** — the registry currently tops out at 192
(`yellow_poplar_leaves`).

Also available and unused if the biome wants more character later: `sculk_catalyst_*`
(including `_bloom` variants — a natural corrupt-altar block), `sculk_shrieker_*`,
`sculk_sensor_*`, `crimson_nylium`, `warped_wart_block`, `nether_wart_block`,
`twisting_vines`, `weeping_vines`, `warped_roots`, `crimson_roots`, `pale_moss_block`,
`pale_hanging_moss`, `mycelium_top`/`_side`, `shroomlight`, and the whole `dead_*_coral`
family.

**One required step, easy to forget:** `textures/blocks/manifest.json` is *generated* —
`scripts/generate-manifest.js` cross-references the PNGs on disk against `BLOCK_REGISTRY`
and emits only what the registry actually references. `sculk` and `sculk_vein` are on disk
but **not in the manifest today**, precisely because nothing references them. Adding the
three blocks means running `npm run generate-manifest`, and the atlas will not contain the
new textures until that runs. `test/unit/meta/textureCoverage.test.js` is where a miss shows
up.

### 3.5 The hazard model — slow, local, and not everywhere

Three properties, all deliberate:

**1. Corruption is scattered, not total.** The Corrupt biome *raises the probability* that a
given surface block is corrupted; it does not replace the biome wholesale. Target roughly
**25–40% of surface blocks** corrupted, driven by a high-frequency noise channel so the
corruption comes in organic patches rather than salt-and-pepper. Ordinary grass, dirt and
stone still generate throughout. This is what makes the biome traversable: there is always a
route through, and finding it is the gameplay.

**2. The drain is very slow.** Standing on a corrupt block costs on the order of **0.5 HP
every 2 seconds** — call it 1 HP per 4 s, tunable from one constant. Crossing a patch costs
a sliver of health. Standing in the middle of one and mining for a minute is a real problem.
Lava, by contrast, should kill in a couple of seconds; the two hazards are not on the same
scale and should not feel like it.

**3. It does not follow you.** No lingering debuff, no poison timer, no effect that
survives leaving the block. The check is *"is the block I am standing on corrupt, right
now"* — evaluated per tick against the player's supporting block, and the moment the answer
is no, the drain stops. Nothing to cure, nothing to wait out, nothing to carry home.

This makes `HazardSystem` genuinely simple: a per-tick lookup of the block under the player,
a table of `blockId → damage-per-second`, and an accumulator. **No status-effect system, no
timers, no per-player debuff state to serialize or sync.** That is worth protecting — the
moment a hazard lingers, it becomes player state that has to survive death, disconnect and
rejoin, and it stops being a one-table system.

```js
// src/game/systems/HazardSystem.js — the whole idea
const HAZARD_DPS = {
  [BLOCK_TYPES.LAVA]:           8.0,   // lethal in ~2.5 s from full
  [BLOCK_TYPES.MAGMA]:          1.0,   // unpleasant underfoot
  [BLOCK_TYPES.CORRUPT_GRASS]:  0.25,  // ~1 HP per 4 s
  [BLOCK_TYPES.CORRUPT_STONE]:  0.25,
  [BLOCK_TYPES.TOXIC_SLIME]:    1.5,
};
```

**Read the ids from `BLOCK_TYPES`, never as literals.** The deleted `DamageSystem.js`
hard-coded `LAVA_ID = 15` and `TOXIC_SLIME_ID = 17` against a registry where lava is 47 and
toxic slime 188 — and its test asserted the wrong mapping, so it passed (D-64,
`src/index.js:71-73`). That is the single most likely way to reintroduce a shipped bug here.

### 3.6 Decision D-Q6 — 28 quests, seven acts (RESOLVED)

Acts 1–4 keep `questStoryline.md`'s existing 21 quests **unchanged and un-renumbered**.
Seven quests are added or restructured.

| Act | Quests | Seal | Biome | Boss | Source |
|---|---|---|---|---|---|
| 1 Awakening | Q01–Q06 (6) | — | Plains, Forest, Mountains | — | unchanged |
| 2 The First Seal | Q07–Q12 (6) | **Verdant** | **Corrupt** | Forest Warden | unchanged |
| 3 Fire and Ash | Q13–Q17 (5) | **Ember** | **Lava** | Lava Titan | unchanged |
| 4 Frozen Truth | Q18–Q21 (4) | **Frozen** | Tundra | Frost Serpent | unchanged |
| 5 Sea of Sand | Q22–Q24 (3) | **Sunken** | Desert | **Dune Colossus** | **new** |
| 6 The Hollow Depths | Q25–Q26 (2) | **Deepstone** | Mountains (Y < 30) | **Hollow King** | **new** |
| 7 The World Remade | Q27–Q28 (2) | **The Final Seal** | Corrupt (deep) — Corruption Spire | **Corruption Overlord**, 3 phases | merged |

**= 28.** With Corrupt and Lava now real, Acts 2 and 3 land in the biomes the storyline
always wanted them in — no rehoming needed.

The finale merges the old Q24 (Corruption Overlord) and Q25 (Final Seal) into **one
three-phase super boss**, which is what "one super boss once all five have been broken"
asks for. The old Q22 "The Final Corruption" folds into Q27.

**Not yet written: the narrative text for Q22–Q28.** `questStoryline.md` still describes 25
quests in five acts. Extending it is a documentation task that should land with S1, and it
is not done in this plan. Seven quest entries, in the existing format.

### 3.7 The five seals

| # | Seal | Biome | Boss | Key item |
|---|---|---|---|---|
| 1 | Verdant Seal | Corrupt | Forest Warden | `seal_key_verdant` |
| 2 | Ember Seal | Lava | Lava Titan | `seal_key_ember` |
| 3 | Frozen Seal | Tundra | Frost Serpent | `seal_key_frozen` |
| 4 | Sunken Seal | Desert | Dune Colossus | `seal_key_sunken` |
| 5 | Deepstone Seal | Mountains, Y < 30 | Hollow King | `seal_key_deepstone` |
| ★ | The Final Seal | Corrupt (deep) | Corruption Overlord (3 phases) | all five spent |

The Corruption Spire is placed deterministically and is **physically present from world
generation, inert until all five seals are broken** — players can find it, walk to it, and
read a "five seals hold this shut" prompt. Better foreshadowing than a structure that pops
into existence.

---

## 4. The data model

### 4.1 One schema, versioned, world-scoped

Replaces all three shapes in §2.1. Lives on the world object, saved to
`cuubz:worldSlot:{N}:conf`.

```js
// src/game/data/QuestState.js — shape, defaults, migration
{
  v: 1,
  activeQuestId: 'q07',
  quests: {
    // ACTIVE quest — carries the per-contributor high-water marks (§4.5)
    q07: {
      stage: 7,
      completed: false,
      objectives: {
        corrupt_crystal: { n: 14, target: 20, hw: { charA: 9, charB: 5 } },
      },
    },
    // COMPLETED quest — collapsed, `hw` dropped to stay inside the storage budget
    q06: { stage: 6, completed: true, completedAt: 1754640000000 },
  },
  seals: {
    verdant: {
      state: 'dormant',            // dormant | keyed | primed | contested | broken
      site: { x: 812, z: -344 },   // resolved once, then frozen — §7.1
      brokenAt: null,
      brokenBy: [],                // character ids that dealt damage; capped at 4
    },
    // ember, frozen, sunken, deepstone — same shape
  },
  finale: { state: 'sealed', site: { x: -1180, z: 260 }, defeatedAt: null },
  titles: ['survivor', 'seeker'],
}
```

Constraints that shaped this:

- **It lives in `localStorage`**, beside two other world configs and the character array.
  Budget **≤ 8 KB serialized**. That is why `hw` maps exist only on active quests and are
  dropped on completion, and why `brokenBy` is bounded by `MAX_PLAYERS_LIMIT` (4).
- **Monotonic throughout.** Pools only rise; high-water marks only rise; seal states only
  advance. Late joins, reordered packets and rejoin-after-crash all resolve to "take the
  higher value" with no conflict resolution.
- **`site` is written once and never recomputed.** If site selection ever changes, existing
  worlds keep their seals where the players found them.

### 4.2 Quest definitions

`src/game/data/QuestDefinitions.js` — pure data, no imports beyond item/block id tables, in
the style of `MOB_DEFINITIONS`.

```js
{
  id: 'q12',
  title: 'The Forest Warden',
  act: 2, stage: 12,
  type: 'BOSS',                                  // COLLECT | CRAFT | EXPLORE | DELIVER | BOSS
  narrative: '…',
  objectives: [{ kind: 'boss_kill', boss: 'forest_warden', count: 1 }],
  rewards: [{ kind: 'unlock', questId: 'q13' }, { kind: 'title', id: 'warden_slayer' }],
  marker: { seal: 'verdant' },
  requires: ['q11'],
}
```

Five objective kinds:

| kind | Evaluated by | Pooled? |
|---|---|---|
| `contribute_item` | per-contributor high-water delta (§4.5) | **yes** — sum across party |
| `visit` | player position vs. radius | shared — any player arriving satisfies it |
| `deliver` | altar consumes items, host-validated | **yes** — sum of deliveries |
| `boss_kill` | `BOSS_DEFEATED` from the host | shared |
| `seal_state` | seal state machine | shared |

### 4.3 Seal definitions

`src/game/data/SealDefinitions.js`:

```js
{
  id: 'verdant',
  name: 'Verdant Seal',
  biome: 'corrupt',
  keyItem: 'seal_key_verdant',
  offering: [{ item: 'corrupt_crystal', count: 5 }],
  boss: 'forest_warden',
  arena: { radius: 24, height: 20 },
  siteRing: { min: 640, max: 1600 },
}
```

**Five distinct key items** replace the single `quest_key`, because `maxStack: 1` makes
carrying two impossible. `quest_key` stays defined (creative palette, back-compat) but is no
longer a quest requirement. Each new key needs an `ItemDefinitions` entry, an icon under
`textures/items/`, a line in `InventoryItemTypes.getMaxStack` (`:56-57`) and one in
`InventorySync.SINGLE_STACK_BLOCKS` (`:78`).

### 4.4 Titles

`titles: string[]`, a `TITLE_DEFS` table, a line in the quest log. No gameplay effect.
Nine from `questStoryline.md` plus two for the new seals.

### 4.5 Decision D-Q2 — pooled objectives (RESOLVED: pooled)

> *"The objectives are shared and work done by players count for everyone."*

So an objective is a **party-wide total**: `{ kind: 'contribute_item', item: 'obsidian',
count: 20 }` means the party collectively needs 20, and A mining 12 while B mines 8
finishes it.

**The mechanism: credit positive deltas against a per-contributor high-water mark.**

`CraftingSystem` has no completion callback, `Inventory` exposes only `onSelectionChange`
(`InventorySystem.js:121`), and `BlockInteraction` has no break/place callback. Adding three
event channels to feed one consumer is the wrong shape, so **poll** — one
`QuestTracker.evaluate()` every 30 frames (~0.5 s, the existing `state.frameCount % N` idiom
from `NetworkStep.js:29`), one pass over 36 slots twice a second. It is uniform across
mining, crafting, looting and trading, and has no ordering hazards.

Polling alone gives "player currently holds N", which regresses when they drop items, die or
disconnect. So the pool is not a sum of holdings — it is a sum of **high-water marks**:

```
observe(contributorId, item) → count
if count > hw[contributorId]:
    pool.n   += count - hw[contributorId]
    hw[contributorId] = count
# never decrease. Dropping, dying and disconnecting cannot take progress away.
```

Properties:

- **Monotonic**, so it inherits every safety property in §4.1.
- **Work genuinely counts for everyone** — the pool is one number the whole party moves.
- **Leaving does not revoke your contribution.** Your high-water mark stays in `hw` until
  the quest completes and the map is dropped.

**The known, accepted exploit:** A hands B five obsidian; A's high-water mark stays, B's
rises, and the five count twice. This is a co-op game, not a competitive one — do not
engineer against it. Where it actually matters, use `deliver` objectives instead: items are
**consumed at the altar and validated host-side**, which is exploit-proof. Every
seal-critical step (the `DELIVER` quests, Q11 and Q16) is already a delivery in the
storyline.

**Contributor identity must be stable across reconnects.** `playerId` is assigned by the
relay per connection, so a reconnecting player would get a fresh high-water mark of 0 and be
credited twice for items they still hold. Key `hw` on the **character id** instead — it is
device-persistent, and the `character` object already travels on join
(`Host.js:409, 677, 690`). *Verification item for S0: confirm `character.id` is present on
the wire and not stripped.*

**This changes the existing host code, it does not reuse it.** `Host.handleQuestUpdate`
(`Host.js:1001-1003`) currently stores a monotonic **max** of a single number. Pooled
contribution needs **accumulate-a-delta**, and `validateQuestUpdate` (`Host.js:256-274`)
validates `{questId, progress:number}`, not `{questId, objectiveKey, delta, contributorId}`.
Both get reshaped in S0.

---

## 5. Persistence — "saved to each world, shared by everyone in it"

### 5.1 Single-player

Quest state lives on the world object; `PersistenceManager.saveWorld()` already writes a
`questProgress` field (`Persistence.js:176`). Two changes:

1. **Rename to `questState` with a migration.** On load, an object with no `v` is treated as
   the legacy `{}` and replaced with defaults. Old worlds have empty quest progress anyway,
   so the migration is cosmetic — but it must exist, or the first real schema change has no
   precedent to follow.
2. **Add a save trigger.** The world config is written only by `createWorld`, `updateWorld`
   and `selectWorld` (`WorldManager.js:233, 274, 337`) — nothing saves during play, so quest
   progress would be lost on every crash.

   **Recommendation:** piggyback the existing 30-second character save. `savePlayerState`
   (`src/core/savePlayerState.js`) is called from three places — the interval, the Escape
   handler, and `Game.stop()` (`DEPLOY.md` §7). Add a sibling `saveWorldState(state, deps)`
   and call it from the same three sites. Do **not** fold it into `savePlayerState`: that
   function's contract is "the selected character", and quest state is the world's.

   Additionally save **immediately** on the three events that are expensive to lose: quest
   completed, seal state changed, boss defeated. Rare enough to be free.

### 5.2 Multiplayer — the host owns it

`HostManager` is already the authority for blocks and inventory. Its
`_worldState.questProgress` becomes `_worldState.questState` in the §4.1 shape, **seeded
from the host's world config on session start** and **written back** by the same
`saveWorldState` calls.

Consequences, stated plainly:

- **Progress saves on the host's device, in the host's world slot.** A world hosted by A and
  joined by B advances A's copy.
- **Joining clients hold a view, not a copy.** `SessionRejoin.js:83-93` and
  `AutoRejoin.js:82-92` build a *temporary* world object pushed onto `worldManager.worlds`
  without going through `createWorld` — never persisted, never given a slot. That is correct
  and should stay: a guest's device must not accumulate half-finished copies of other
  people's worlds. Their `questState` is whatever the host last sent, discarded on
  disconnect.
- **A guest's contributions live in the host's `hw` map**, keyed by their character id, so
  they persist in the host's world across the guest's disconnect and rejoin. That is what
  makes "work done counts for everyone" hold across a dropped connection.
- **Late joiners need the full state** — the host sends `QUEST_SYNC` (§6.1).

---

## 6. Multiplayer protocol

### 6.1 New message types

Added to `shared/protocol.js` **first**, then used — `test/unit/multiplayer/protocol.test.js`
asserts structurally that `Client.js`, `server/session.js` and `server/matchmaking.js`
contain no bare protocol string literals and that every `MESSAGE_TYPES.X` they name is a
real key.

| Type | Direction | Payload | Rate |
|---|---|---|---|
| `QUEST_SYNC` | host → client | full `questState` | on join, on rejoin |
| `QUEST_UPDATE` | host → all | `{ questId, objectiveKey, n, target }` — authoritative pool | on change *(exists, reshaped)* |
| `QUEST_CONTRIBUTE` | client → host | `{ questId, objectiveKey, delta, contributorId }` | on delta |
| `SEAL_UPDATE` | host → all | `{ sealId, state, brokenBy? }` | on transition |
| `BOSS_SPAWN` | host → all | `{ bossId, type, sealId, position, maxHp, arena }` | once per encounter |
| `BOSS_STATE` | host → all | `{ bossId, x, y, z, yaw, hp, phase, aiState }` | **10 Hz** while contested |
| `BOSS_HIT` | client → host | `{ bossId, damage, origin, direction }` | on attack |
| `BOSS_DEFEATED` | host → all | `{ bossId, sealId, contributors, loot }` | once |
| `BOSS_DESPAWN` | host → all | `{ bossId, reason }` | on wipe/reset |

`server/session.js` relays them (its `switch` at `:250-270` is explicit, so each needs a
case). `Client.js:1016-1021` must add **all of the above plus `QUEST_UPDATE`**, missing
today (§2.1). `Host._setupGameHandlers()` (`Host.js:621-655`) must register
`QUEST_CONTRIBUTE` and `BOSS_HIT`.

### 6.2 Bandwidth

`BOSS_STATE` at 10 Hz is ~120 bytes/tick/client → **~1.2 KB/s per client, ~5 KB/s for a
full 4-player session**, and only while a boss is alive. `PLAYER_MOVE` already runs at
~20 Hz per player (`PlayerStep`). Acceptable. If not, drop to 8 Hz — the client
interpolates either way.

### 6.3 Validation

Both client→host messages are untrusted, and both are validated on the pattern
`validateQuestUpdate` and `RateLimiter` already establish in `Host.js`.

`QUEST_CONTRIBUTE`: sender is connected; `delta > 0`; `delta` bounded by the largest
plausible single-tick gain (a stack, 64); `contributorId` matches the sender's own
character. Reject-and-warn, exactly as `Host.js:996` does.

`BOSS_HIT`: sender connected; sender's last-known position (the host tracks it in
`_handlePlayerMove`) inside the arena radius plus latency slack; `damage` within the ceiling
computed from `NAMED_ITEMS` (**compute it, do not hard-code it**); rate-limited per player to
the fastest legal attack speed using the same `4.0 + def.attackSpeed` formula
`CombatStep.js:42-49` uses, with tolerance.

Never kick. A laggy client is not a cheater.

### 6.4 The host is also a player

`HostManager` runs in the host's browser beside their own `MobManager` and `Inventory`. The
host's own attacks and contributions must go through the **same** `BOSS_HIT` /
`QUEST_CONTRIBUTE` path — via a local transport that calls the handler directly rather than
over the socket. **One code path, or the host and the guests diverge.** This is the single
most important design rule in this document; the repo's history is a list of what happens
when two paths exist for one thing.

### 6.5 Single-player uses the same code

Single-player instantiates the host-side runner with a null transport. The boss simulation,
the validation and the state machines are identical between single-player and hosted
multiplayer. Only the broadcast is a no-op.

---

## 7. Worldgen — seal sites, altars, arenas

### 7.1 Site selection is deterministic and frozen

`src/engine/world/structures/SealSites.js` (new, pure, node-testable):

```
sealSites(worldSeed) → { verdant: {x,z}, ember: {x,z}, …, finale: {x,z} }
```

Hash `(worldSeed, sealId)` into an angle and a radius inside the seal's `siteRing`, then
walk outward in a **bounded** spiral (cap it — 256 candidate columns) sampling
`BiomeSystem.getBiomeAtWorldPos(wx, wz, seed)` until the biome matches. If no match is found
within the cap, **fall back to the unfiltered position and log it** — a seal in the wrong
biome is a cosmetic disappointment; a world that hangs during generation is not.

This matters more now that Corrupt and Lava are rare mask-driven patches (§3.2): the Verdant
and Ember sites *must* find one, so the spiral cap and the fallback are load-bearing, not
defensive padding. Tune the mask thresholds so at least one patch of each is reliably within
the `siteRing` band, and assert it in a seed-sweep test (S5).

Result is written to `questState.seals[id].site` on first world entry and never recomputed.

### 7.2 Structures go inside `workerGeneration.js`

Same constraint as §2.4: that file is a classic script with no imports, `var` style, inline
tables. Altar and arena placement must be written **in it, in its style**, fed through
`genParams.sealSites`. Per-chunk: if a chunk intersects a site footprint, stamp the arena and
altar from a small hand-authored template. Keep it to a handful of block writes per affected
chunk — this is the generation hot path.

### 7.3 What gets placed

| Element | Blocks | Purpose |
|---|---|---|
| Altar | `chiseled_stone_bricks`, `crying_obsidian`, marked centre block | Interaction target; `primed` transition |
| Arena floor | flattened `stone_bricks` / `deepslate_tiles`, radius per `SealDefinitions.arena` | Boss needs walkable ground; `mobMovement` uses `isSolidBlock` |
| Key cache | one per seal | Source of `seal_key_*` |
| Spire | tall `blackstone` / `crying_obsidian` column at the finale site | Foreshadowing; inert until five broken |

Biome-native decoration (`toxic_slime`, `corrupt_crystal`, `magma`, lava lakes) comes from
the biome itself now, not from the structure — that is the payoff of building the biomes.

### 7.4 Multiplayer chunk flow makes this easy

In a session the **host generates and clients receive** — `ChunkManager` runs in
`clientMode` and chunks arrive as `CHUNK_DATA` (`ChunkStreamer.js`, `ChunkResync.js`).
Clients never generate terrain, so structures need to be deterministic only for
single-player and the host, not across peers.

---

## 8. Boss design

### 8.1 Reuse the mob renderer — do not write a new one

`Boss.js` was deleted partly because it had no rendering. **Do not repeat that.** Define
bosses in the existing `MOB_DEFINITIONS` format so `mobModelBuilder`, `mobAnimator` and
`mobRenderer` draw them with zero new rendering code. The builder supports `box`, `sphere`,
`cylinder` and `cone` (`mobModelBuilder.js:83-104`) — enough for a root-and-thorn warden or a
molten titan at 4–8× scale.

Required mob-layer changes:

- Add `MOB_CATEGORIES.BOSS` (`mobDefinitions.js:14-17`).
- Boss defs carry **`biomes: []`**. Both `getMobTypesForBiome` and `selectMobForBiome`
  iterate `def.biomes.includes(biome)` (`:461-489`), so an empty array excludes bosses from
  natural spawning for free — and a *missing* `biomes` would throw. Assert this in a test.
- `MobManager` must exempt bosses from `mobCap`/`hostileCap` (`:28-31`), from the
  `despawnDistance` check (`:120-125`), and from `minHostileSpawnDistance`. A boss that
  despawns because a player kited it 128 blocks is a bug report.
- Spawn via the existing `spawnMobAt(mobType, position)` (`:426`), which bypasses the spawn
  tick.

### 8.2 Phases

Boss definitions get a `phases` array — HP thresholds, per-phase ability sets, per-phase
animation overrides. The Corruption Overlord has three; the five seal bosses have two each
(enrage below 40%).

**Explicitly initialise every phase timer at construction.** The deleted `Boss.js` left
`phaseTransitionTimer` undefined, so a deserialized boss was NaN-frozen and unkillable and no
test caught it (`src/index.js:73-75`). Add a test that constructs each boss, advances it
through every threshold, and asserts it dies.

### 8.3 Abilities

| Ability | Feasible with today's code? |
|---|---|
| Melee (vine lash, tail swipe) | **Yes** — `onMobAttack` + §2.2 |
| Charge / leap | **Yes** — `applyMovement` + `applyKnockback` |
| Summon adds | **Yes** — `spawnMobAt` with existing hostiles |
| AoE ground effect (lava pools, poison spores) | **Yes after S4** — the hazard-block DoT built for the biomes is exactly this mechanic, reused |
| Ranged projectile (magma, corruption beam) | **No** — no projectile system. New. |
| Ice walls / terrain modification | **Yes** but expensive — block writes must go through the host's validated path or clients desync |

Building the hazardous biomes first (S4) means the AoE ground effects come almost free at
S6: a lava pool a boss creates is the same block with the same damage tick as a lava pool
the world generated. **First boss ships with melee + charge + summon + hazard-pool only.**
Projectiles are their own stage; do not let them block the first working seal.

### 8.4 Encounter lifecycle

```
primed  ──[any player interacts with altar]──▶  contested
                                                  │
       ┌──────────────────────────────────────────┤
       │                                          │
  [boss hp ≤ 0]                          [all players leave arena
       │                                   for 60 s, or all die]
       ▼                                          ▼
    broken                                    primed (reset)
```

On reset the boss despawns and HP restores — no partial credit. On defeat: `SEAL_UPDATE`,
loot to **every contributor in `brokenBy`**, not just the killer (consistent with §4.5 —
work counts for everyone), title grant, immediate save, and a check for "all five broken" →
`finale.state = 'open'`.

### 8.5 Loot determinism

`rollDrops` uses bare `Math.random()` (`mobDropTable.js:16-19`). For a shared boss the
**host rolls once** and ships the result in `BOSS_DEFEATED`. Clients apply what they are
told; they do not roll. Same rule as everything else: one authority.

---

## 9. Files — new and changed

### New

| File | Purpose | Rough size |
|---|---|---|
| `src/game/data/QuestDefinitions.js` | 28 quests, pure data | ~650 |
| `src/game/data/SealDefinitions.js` | 5 seals + finale | ~120 |
| `src/game/data/QuestState.js` | Schema, defaults, migration | ~150 |
| `src/game/data/TitleDefinitions.js` | Title table | ~40 |
| `src/game/systems/QuestSystem.js` | State machine — no DOM, no network | ~300 |
| `src/game/systems/QuestTracker.js` | Pooled objective evaluation (§4.5) | ~250 |
| `src/game/systems/SealSystem.js` | Seal state machine + altar interaction | ~250 |
| `src/game/systems/HazardSystem.js` | **Environmental damage** — lava, magma, toxic slime | ~200 |
| `src/game/entities/PlayerVitals.js` | §2.2 minimal health | ~200 |
| `src/game/entities/BossEntity.js` | Boss instance, phases, ability timers | ~350 |
| `src/game/systems/BossEncounter.js` | Host-side runner: spawn, arena, leash, reset, loot | ~350 |
| `src/game/mobs/bossDefinitions.js` | 6 boss defs in `MOB_DEFINITIONS` format | ~700 |
| `src/multiplayer/QuestSync.js` | Mirrors `InventorySync.js` | ~200 |
| `src/multiplayer/BossSync.js` | Mirrors `PlayerSync.js` — host broadcast, client interp | ~280 |
| `src/engine/world/structures/SealSites.js` | Deterministic site selection | ~150 |
| `src/ui/hud/QuestTracker.js` | Writes the existing `#quest-tracker` DOM | ~130 |
| `src/ui/hud/BossBar.js` | New HUD element | ~120 |
| `src/ui/overlays/QuestLog.js` | Full quest list (key `J`) | ~250 |
| `src/ui/css/hud/boss-bar.css` | Boss bar styling | ~60 |
| `src/ui/css/overlays/quest-log.css` | Quest log styling | ~100 |
| `src/core/init/initQuests.js` | `Game.init()` step 15 | ~120 |
| `src/core/saveWorldState.js` | Sibling to `savePlayerState.js` | ~50 |

### Changed

| File | Change |
|---|---|
| **`src/engine/world/BiomeSystem.js:18-97, 126-161`** | **`CORRUPT` + `LAVA` in `BIOME_DEFS`; blight/scorch mask override in `selectBiome`** |
| **`src/engine/world/workerGeneration.js:71-160, 187-197, 462-463, 473-500`** | **The same two biomes, the same override, in the duplicated classic-script copy (§2.4); `BIOME_FEATURES` rows; two new noise channels; terrain/decoration passes; altar + arena stamping** |
| `src/engine/world/BlockRegistry.js` | 3 Corrupt blocks at free ids **193–195**, all pointing at existing textures (§3.4). Lava needs none. |
| `textures/blocks/manifest.json` | **Regenerate** — `npm run generate-manifest`. Nothing is drawn; the new blocks' textures are on disk but unreferenced today, so they are absent from the manifest and the atlas until this runs. |
| `src/engine/renderer/BiomeEffects.js:54-55` | **Nothing** — `lava` and `corrupt` configs already exist |
| `src/game/mobs/mobDefinitions.js:211, 376` | Restore `biomes: ['corrupt']` on `corrupt_wolf` / `corrupt_wisp` (reverts D-68's workaround) |
| `src/game/mobs/mobDefinitions.js:14-17` | `MOB_CATEGORIES.BOSS` |
| `src/game/mobs/mobManager.js:28-31, 120-125` | Boss exemptions from cap and despawn |
| `src/game/mobs/mobIntegration.js:68-83` | Wire `onMobAttack` to `PlayerVitals` |
| `src/core/init/initMobs.js:35` | Pass real vitals instead of `null` |
| `src/game/entities/WorldManager.js` | `worldgenVersion` on new worlds; replace the three ad-hoc quest helpers; delete the `nextStage >= 5` placeholder (`:390`) |
| `src/engine/world/ChunkGenerator.js:44-51` | Thread `worldgenVersion` + `sealSites` through `genParams` |
| `shared/protocol.js` | +8 message types (§6.1) |
| `server/session.js:250-270` | Relay cases for the new types |
| `src/multiplayer/Client.js:1016-1021` | Add `QUEST_UPDATE` (**missing today**) + 8 new types |
| `src/multiplayer/Host.js:451-454, 256-274, 618-655, 989-1035` | `questState`; reshape validator + handler for pooled deltas; register `QUEST_CONTRIBUTE` and `BOSS_HIT`; `QUEST_SYNC` on join |
| `src/engine/world/Persistence.js:176` | `questProgress` → `questState` + migration |
| `src/core/GameState.js` | Declare `questSystem`, `sealSystem`, `bossEncounter`, `bossSync`, `questSync`, `playerVitals`, `hazardSystem`, `bossBar` — *declared, not grown*, per that file's header |
| `src/core/Game.js:194-202` | `initQuests(this)` as step 15; teardown |
| `savePlayerState` call sites (3) | Add `saveWorldState` alongside |
| `src/engine/loop/SystemRunner.js` | Quest/hazard/boss step (or extend `WorldStep`) |
| `src/engine/loop/steps/CombatStep.js:56` | Boss hits → `BOSS_HIT`, not local `takeDamage` |
| `src/game/data/ItemDefinitions.js` | 5 `seal_key_*` items |
| `src/game/systems/InventoryItemTypes.js:56-57`, `src/multiplayer/InventorySync.js:78` | Single-stack for the new keys |
| `src/ui/templates/hud.js:78-84` | Un-hide `#quest-tracker`; add boss bar markup |
| `src/ui/css/index.css:45` | Two `@import`s — **order is load-bearing (D-52)** |
| `textures/items/` | 5 `seal_key_*` icons; `quest_key` (**missing today** — the block uses an `iron_bars` placeholder, but the *item* has no icon). **`textures/blocks/` needs nothing new.** |
| `questStoryline.md` | **Done** — Q22–Q28 written, act table, seal summary, title progression and hazard section updated |

---

## 10. Stages

Each stage is a shippable PR that leaves the tree green. Every defect found gets a `BUGS.md`
row with an owner **at the time it is found** — that is the repo's rule and it is not
optional.

| Stage | Scope | Depends on | Clears |
|---|---|---|---|
| **S0** | **Unify quest state.** One schema, migration, `saveWorldState`, fix the two broken wire routes, reshape the host validator/handler for pooled deltas. No gameplay, no UI. | — | §2.1 |
| **S1** | **Quests, single-player.** Definitions (Act 1, 6 quests), `QuestSystem`, `QuestTracker` polling, HUD tracker, quest log. `COLLECT`/`CRAFT`/`EXPLORE`. Narrative for Q22–Q28 into `questStoryline.md`. | S0 | — |
| **S2** | **Quest sync.** `QUEST_SYNC` on join, `QUEST_CONTRIBUTE`, pooled totals across 4 players, rejoin, guest-view semantics. | S0, S1 | §2.1 |
| **S3** | **Player health.** `PlayerVitals`, damage, armour, death, respawn, `#health-meter` writer, `onMobAttack` wired. | — *(parallel with S1/S2)* | §2.2 |
| **S4** | **Corrupt + Lava biomes, and environmental danger.** Both `selectBiome` copies, blight/scorch masks, `worldgenVersion` gating, terrain/decoration passes, `BIOME_FEATURES` rows, 3 Corrupt blocks at ids 193–195 + manifest regen, scattered-corruption density pass (§3.5), restore the two corrupt mobs, `HazardSystem` (§3.5 — no lingering effects). | S3 | §2.4, §2.5, and the "no dangerous biome" gap |
| **S5** | **Seal sites + altars.** `SealSites` with the biome-reachability sweep, worldgen structures, `SealSystem` to `primed`, 5 key items + icons, world markers. | S1, S4 | — |
| **S6** | **First boss, end to end.** `BossEntity`, `BossEncounter`, `BossSync`, boss bar, host authority. Forest Warden: melee + charge + summon + hazard pool. Single-player and 4-player both. | S2, S3, S5 | §2.3 |
| **S7** | **Four more seal bosses.** Lava Titan, Frost Serpent, Dune Colossus, Hollow King. Projectiles if S6 proved the shape. | S6 | — |
| **S8** | **Super boss + completion.** Spire unseal on five broken, 3-phase Corruption Overlord, titles, end state. | S7 | — |

S3 has no dependency on S0–S2 and can run concurrently. **S4 is newly on the critical path**
— S5 cannot place the Verdant and Ember seals until their biomes exist. S6 remains the long
pole; keep it to one boss.

**Nothing starts until the outstanding multiplayer bug is fixed.**

---

## 11. Testing

Conventions: `vitest`, `test/**/*.test.js`, `environment: 'node'` by default with jsdom
opt-in per file via `// @vitest-environment jsdom` (`vitest.config.js:15-63`).
**Browser e2e cannot run in this environment** — verify UI with node/jsdom stubs, not
screenshots.

| Stage | Unit | Integration |
|---|---|---|
| S0 | Schema defaults; migration from `{}`, `undefined`, a v0 blob; pooled accumulate; high-water credit never decreases; `character.id` present on the wire | Save → reload → survives; host↔client shape agreement |
| S1 | Objective evaluators, all five kinds; prerequisite gating; reward application | Full Act 1 run against a mock inventory |
| S2 | `QUEST_SYNC` serialization; `QUEST_CONTRIBUTE` rejects `delta ≤ 0`, oversized deltas, spoofed contributor ids | **4 clients each contribute a share of one objective; pool reaches target exactly once; a client disconnects mid-objective and its contribution is retained; it rejoins and is not double-credited** |
| S3 | Damage/armour arithmetic; death at 0; respawn from `spawnPoints` | Mob attack → health drops → death → respawn |
| S4 | **`BiomeSystem.selectBiome` and `workerGeneration.selectBiome` return the same biome for a swept grid of `(cont, eros, temp, hum, blight, scorch)` — the §2.4 duplication guard**; `BIOME_IDS` contains `corrupt` and `lava`; `mobBiomes.test.js` passes with the mobs restored; **hazard ids read from `BLOCK_TYPES`, never literals (the exact D-64 defect that shipped in the deleted `DamageSystem`)**; **corrupted surface fraction in a Corrupt chunk lands in 25–40%, i.e. neither 0% nor 100%**; `textureCoverage.test.js` passes after manifest regen; a v1 world generates byte-identical chunks to today | Enter lava → health drops → death. **Stand on corrupt → slow drain; step off → drain stops in the same tick and no damage is dealt thereafter** (the no-lingering guarantee, asserted directly). Walk a straight line across a Corrupt chunk and survive it. |
| S5 | `sealSites` determinism (same seed → same sites); **seed sweep: every seal finds its biome inside `siteRing` for ≥95% of seeds, and the fallback fires cleanly for the rest**; spiral cap terminates; site frozen across recompute | Generate a world, assert five altars exist at the recorded sites |
| S6 | **Every boss constructs with all timers initialised and dies when damaged past every phase threshold** (the deleted `Boss.js`'s exact defect); `BOSS_HIT` rejects out-of-arena, over-damage, over-rate | 4-client encounter: all four deal damage, HP agrees within one tick, **all four receive loot**, `brokenBy` has four entries |
| S7 | Per-boss phase tables | Each seal reachable and completable |
| S8 | Five-broken detection; finale gating | Full run |

Two assertions worth naming, because they guard failures this codebase has already had:

- **`test/unit/multiplayer/protocol.test.js`** must keep passing — every new message type is
  a `MESSAGE_TYPES` key before it is a string anywhere.
- **`test/unit/ui/pageLoad.test.js`** asserts the *assembled* DOM. The boss bar markup and
  the un-hidden quest tracker show up there.

---

## 12. Open questions

Q1 (biomes), Q2 (pooled objectives), Q6 (28 quests) and Q7 (hazard model) are **resolved** —
see §3.1, §4.5, §3.6 and §3.5. What remains:

**Q3 — Should a guest keep anything?**
The plan assumes **no**: a guest's view of the host's quest state is discarded on disconnect
(§5.2). Their *contributions* persist in the host's world, but they carry nothing home.
Titles could reasonably be character-scoped and permanent instead — a small addition to
`CharacterManager`, and a guest who helps kill the Forest Warden keeps "Warden Slayer".

**Q4 — Are seal arenas protected?**
Can a player mine the altar, wall the boss in, or dig out the arena floor? A protected volume
is a new concept for `BlockInteraction` and the host's block validator. Cheapest answer:
unprotected, and the encounter resets if the boss leaves the arena.

**Q5 — Difficulty, and what a wipe costs.**
The plan assumes a wipe resets the boss to full and costs nothing but time. Boss HP scaling
by player count (2× for four players?) is unspecified. Not answerable until S3 lands.

**Q8 — Should existing worlds be offered the biome upgrade?**
§3.1 gates the new biomes behind `worldgenVersion`, so existing saves are untouched. Offering
an opt-in upgrade means a "this will seam your terrain" confirmation in the world screen.
The alternative — new worlds only, no upgrade path — is simpler and needs no UI.


---

## 13. What actually happened

Nine stages, nine commits, `feat/quest-system`. **75 test files, 531 tests, lint clean.**

### The stages, and what each one cost

| Stage | Landed | Notes |
|---|---|---|
| **S0** | one schema, migration, `saveWorldState`, both broken wire routes | Found **D-117** |
| **S1** | 28 quests, `QuestSystem`, polling tracker, HUD writer, quest log | Found **D-118**, **D-119** |
| **S2** | `QuestSync`, pooled objectives across four players, real-relay test | Found **D-120** |
| **S3** | `PlayerVitals`, armour, death, respawn, the health meter's first writer | — |
| **S4** | Corrupt + Lava as real biomes, `worldgenVersion`, `HazardSystem` | The §2.4 guard now exists |
| **S5** | `SealSites`, altars, arenas, the spire, `SealSystem` | Found **D-121**; spiral was 38.8% |
| **S6** | `BossEntity`, `BossEncounter`, `BossSync`, boss bar, all six boss defs | Two bugs caught by their own tests |
| **S7** | every seal reachable and completable, end to end | Projectiles deliberately skipped |
| **S8** | the finale's own state machine, the spire gate, the full 28-quest run | — |

### The plan's own judgements, scored

**Right, and load-bearing:**

- *"Roughly 60% of the work below is prerequisites, not quests."* Accurate. S0, S3 and S4
  are all prerequisite and are three of the four hardest stages.
- *§2.4, "the constraint that shapes all of S4".* The duplicated `selectBiome` was exactly
  as dangerous as described, and the sweep that now guards it also found **D-121** in the
  neighbouring hand-maintained table.
- *§8.1, "reuse the mob renderer — do not write a new one".* This is why S6 is a state
  machine and not a rendering project, and why six bosses cost roughly what one would
  have.
- *§8.2, initialise every phase timer.* The rule and the test it demanded are both here.
- *"Building the hazardous biomes first means the AoE ground effects come almost free at
  S6."* Free, in fact — a boss's lava pool is the same block with the same damage tick,
  and `BossEncounter` contains no damage code for it at all.
- *§4.5's verification item* — "confirm `character.id` is present on the wire and not
  stripped". It was stripped. That is D-117.

**Wrong, or incomplete:**

- **§2.5's content audit missed two.** It listed `bed` and `bread`. Writing the quest
  definitions found `obsidian` (D-118 — an alias for an unbreakable block, wanted by
  three Act 3 quests) and `sandstone` (D-119 — no registry entry at all). All four are
  closed, and a test now checks every objective in all 28 quests against the registry.
- **§7.1's spiral parameters were far too small.** The plan asks for ≥95% and the first
  implementation of its described algorithm scored **38.8%**. The problem was reach, not
  density. 1200 probes at 150 blocks apart on a golden-angle sunflower: 98.8%, at a mean
  of 156 probes.
- **Q13 wants 5 obsidian, not 20.** A test written against the plan's own act table had
  to be retargeted at Q14. Minor, but it is the kind of thing that only shows up when
  something drives the definitions.

### The four open questions, answered

- **Q3 — should a guest keep anything?** *No*, as the plan assumed. A guest holds a view,
  discarded on disconnect; their contributions persist in the host's world keyed on their
  character id. Titles are world-scoped, not character-scoped. Revisit if anyone asks.
- **Q4 — are seal arenas protected?** *No.* §7.3's cheapest answer, taken. The altar is a
  **place**, not a block, so a player who mines it has made a hole rather than destroyed
  their run, and the encounter resets if the arena empties for 60 s.
- **Q5 — difficulty, and what a wipe costs.** A wipe costs time and nothing else: full HP,
  no partial credit. HP scales ×1.2 per extra player (×1.6 at four), not the ×2 the plan
  floated — a four-player fight should be longer, not a health-bar marathon. One formula,
  one place, cheap to retune once anyone has played it.
- **Q8 — should existing worlds be offered the biome upgrade?** Both. New worlds are
  `worldgenVersion: 2`; existing ones stay at 1 and generate byte-identically.
  `WorldManager.upgradeWorldgen(id)` exists for the opt-in — **the world-screen
  confirmation UI is not built**, so today the upgrade has a mechanism and no button.
  *(Built in S9. See §14.)*

### What is deliberately not built

- **Projectiles.** §8.3 lists them as the one ability the engine cannot do, and S7's scope
  makes them conditional. There is no projectile rendering path in this codebase, and a
  projectile with no renderer repeats precisely the mistake §8.1 spends a section on. The
  storyline's two ranged attacks are hazard fields instead: the Lava Titan's molten debris
  is a magma pool that becomes lava below 40%, and the Frost Serpent's freezing breath is
  a field of ice to be fought around. Same trade §8.3 made for the AoE effects.
- ~~**The v1→v2 world-screen upgrade button.** Mechanism yes, UI no. See Q8.~~
  **Built in S9 — §14.** It was the largest of these: without it no world made before S4
  can reach the Verdant or Ember seal, and so cannot reach the finale at all.
- **Boss loot for offline contributors.** Loot goes to every contributor who is present at
  the kill. A player who fought and disconnected before it died keeps their `brokenBy`
  entry and gets nothing, because there is nowhere to put it.

### Verification

Browser e2e cannot run in this environment (§11), so every UI claim is a jsdom assertion
against the real templates and the real writers — 23 of them across the quest tracker, the
quest log and the health meter. The multiplayer claims run against the **shipped relay**
over real WebSockets with a real `HostManager`. The two worldgen files are driven by
evaluating the actual worker source in a `vm` context, because an import would be testing
a different program than the one the worker loads.

---

## 14. The follow-up session (S9+)

§13 closed with four named gaps and a bug ledger. This section is the record of the
session that worked on them, in the same spirit: what landed, what was judged not worth
building, and what each judgement cost. It does not rewrite §13 — that is the record of
S0–S8 as it stood.

### S9 — the upgrade has a button

§13's *"the upgrade has a mechanism and no button"* was the largest real gap, and not
cosmetically: a world made before S4 stays at `worldgenVersion: 1` forever, generates no
Corrupt and no Lava, and therefore can never reach the Verdant or the Ember seal. Two of
the five the finale gate requires (§3.7) are unreachable, so the endgame is unreachable,
in every save that predates this branch. That is the whole of the argument for building
it now rather than deferring it again.

**Where the control lives, and why it is not in `.world-slot-actions`.** The obvious place
is beside the delete button. That row is `opacity: 0` until the slot is hovered
(`src/ui/css/screens/slots.css`), which is exactly right for a destructive action nobody
should find by accident and exactly wrong for an offer the player has to *discover* — a
player who never hovers a world slot would never learn the offer exists, and the symptom
would read as "the Corrupt biome doesn't spawn" rather than as an unaccepted opt-in. So
the badge (`.world-upgrade-badge`) is its own always-visible element in the slot's other
corner, slow-pulsing, and `test/unit/ui/worldUpgrade.test.js` asserts it stays outside
that row so a later tidy cannot quietly bury it.

**What the confirmation says.** §3.1 asks for "this will seam your terrain" and the word
*seam* is the contract, so it is in the copy verbatim and asserted. The modal also states
what is gained (the two biomes, and the two seals that live nowhere else) before what it
costs, because the cost paragraph is meaningless without it, and that the change cannot
be undone. A player who cancels has changed nothing.

**Which world the modal is about travels on `dataset.worldId`**, the way the shared delete
modal's does, rather than in a closure captured at open time. The closure works and breaks
the moment two opens interleave; there is an assertion for the dataset specifically.

**Wiring lives in `WorldScreen`, not `UIManager`.** `UIManager` owns the delete modal's
handler for one reason only — the element is shared between two screens and neither can
own it without reaching into the other. Nothing shares this one.

**D-122, found by writing the failure case.** `upgradeWorldgen` set the version and *then*
saved, so a storage throw returned `{success:false}` over a cache that already said 2 —
and the cache is what `genParams` reads. The session would have written v2 chunks into a
world that reloads as v1: the mixed terrain the version gate exists to prevent, without
the confirmation, and permanent once the chunks are on disk. The failure path had no
caller at all before this commit, which is why S4 could add the method and not see it.
Fixed by rolling the cache back, restoring an absent key as absent.

**Verification** is jsdom against the real templates and the real `WorldManager` over an
in-memory store, per §11 — 12 assertions, one of them confirmed red against the pre-fix
`upgradeWorldgen`.
