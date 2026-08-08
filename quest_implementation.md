# Cuubz — Quest, Seal and Boss Implementation Plan

> **Status: PLAN ONLY. Nothing here is implemented.**
> Companion to `questStoryline.md`, which is the *narrative* design. This file is the
> *engineering* design: what exists, what does not, what has to be built, in what order,
> and which decisions are still open.

**The headline:** `questStoryline.md` describes a feature that this codebase has almost
none of the machinery for. The quest *data* items exist (`quest_key`, `corrupt_crystal`),
the quest *HUD markup* exists, and one quest *wire message* exists — but the three
disagree about what quest state even is, nothing routes the wire message, mobs are not
networked at all, and the player has no health. This plan is honest about that: roughly
60% of the work below is prerequisites, not quests.

---

## 1. What already exists

Verified against the tree at `ea8b2db` (branch `fix/item-texture-audit`).

| Thing | Where | State |
|---|---|---|
| Quest HUD markup | `src/ui/templates/hud.js:78-84` — `#quest-tracker`, `#quest-name`, `#quest-objective`, `#quest-progress` | Mounted, permanently `hidden`, **zero writers** |
| Quest HUD styling | `src/ui/css/hud/quest-tracker.css`, imported at `src/ui/css/index.css:45` | Complete |
| `quest_key` item | `src/game/data/ItemDefinitions.js:109` (`maxStack: 1`) | Defined, never obtainable |
| `corrupt_crystal` item | `src/game/data/ItemDefinitions.js:106` (`maxStack: 1`) | Defined, never obtainable |
| Quest block ids | `src/engine/world/BlockRegistry.js:466-469` — `TOXIC_SLIME`, `CORRUPT_CRYSTAL`, `APPLE`, `QUEST_KEY` | Defined, never placed by worldgen |
| Single-stack rules | `src/game/systems/InventoryItemTypes.js:57`, `src/multiplayer/InventorySync.js:78` | Correct and consistent |
| Creative palette | `src/core/BlockPalette.js:48-50` — quest items force-added | Works |
| `QUEST_UPDATE` wire type | `shared/protocol.js` | Defined |
| Relay forwarding | `server/session.js:260-263` | Works |
| Host-side validator | `src/multiplayer/Host.js:256` `validateQuestUpdate()` | Works |
| Host-side handler | `src/multiplayer/Host.js:989` `handleQuestUpdate()` | **Never called** — see §2.1 |
| World-scoped quest slot | `src/game/entities/WorldManager.js:226`, `:360-398`; `src/engine/world/Persistence.js:176` | Persisted, never written by gameplay |
| Mob framework | `src/game/mobs/*` — definitions, AI, movement, procedural geometry, animation, renderer | Works, single-player only |

### What was deleted, and why it matters

PR 34 deleted five gameplay modules outright (`src/index.js:48-81`):

| Module | Lines | Consequence for this plan |
|---|---|---|
| `game/systems/QuestSystem.js` | 262 | No quest state machine. Rewrite. |
| `game/entities/QuestMarker.js` | 605 | No world markers/waypoints. Rewrite (smaller). |
| `game/entities/Boss.js` | 1,135 | No boss entity. It had **no renderer at all** — no `THREE` import, no mesh. |
| `game/systems/SurvivalSystem.js` | 1,159 | **No player health.** See §2.2. |
| `game/systems/DamageSystem.js` | 627 | No environmental damage. |

They are recoverable from git and the pushed `pre-refactor-baseline` tag. **This plan does
not recommend restoring any of them.** PR 34's reasons still hold: `Boss.js` was unkillable
(`phaseTransitionTimer` never initialised, NaN-frozen), `DamageSystem` had pre-renumbering
block ids, and `SurvivalSystem` emitted a competing `#survival-hud` overlay. What is worth
salvaging is *shape*, read as reference, not code.

---

## 2. The five blockers

These are not "nice to have first". Each one makes some part of the storyline literally
unrunnable, and each is sized here because the schedule in §8 depends on them.

### 2.1 Quest state has three incompatible shapes and no live path

Named in `src/index.js:67` and still true:

```
WorldManager.questProgress   →  { [questId]: { stage, completed, lastUpdated } }   (WorldManager.js:385-396)
Host._worldState.questProgress →  { [questId]: number }                             (Host.js:1001-1003)
SessionRejoin / AutoRejoin    →  {}                                                 (SessionRejoin.js:89, AutoRejoin.js:88)
Persistence.saveWorld         →  passes through whatever it is given                (Persistence.js:176)
```

And the wire path is **broken in two places**:

1. `HostManager._setupGameHandlers()` (`Host.js:618-660`) registers handlers for `WELCOME`,
   `PLAYER_JOINED`, `PLAYER_LEFT`, `PLAYER_MOVE`, `BLOCK_BREAK`, `BLOCK_PLACE`,
   `INVENTORY_SYNC` — and **not** `QUEST_UPDATE`. `handleQuestUpdate()` has no caller
   anywhere in `src/`.
2. `MultiplayerClient._setupGameSessionHandlers()` (`Client.js:1016-1021`) lists the game
   events it forwards to game handlers. `QUEST_UPDATE` is **not** in that list, so even the
   host's broadcast is dropped by every client including the sender.

`WorldManager.advanceQuest()` also hard-codes `completed = nextStage >= 5` with the comment
"simplified — actual quest system will define stages" (`WorldManager.js:390`). That is a
placeholder, not a contract.

**Fix:** one schema (§4), one owner (the host), one persistence path (§5). This is Stage 0
and it should land before any quest content is written, because three shapes is exactly how
this got shelved the first time.

### 2.2 The player has no health

`src/game/entities/Player.js` has `respawn(spawnPoint)` and **no `health`, no
`takeDamage`, no death**. `MobIntegration.init()` only installs the `onMobAttack` callback
`if (survivalSystem)` (`mobIntegration.js:68`), and `initMobs.js:35` passes
`survivalSystem: null`.

So today: **mobs cannot damage the player, and the player cannot die.** A boss is a punching
bag. Every "Boss Mechanics" line in `questStoryline.md` — poison spores, lava pools, ice
breath, dark nova — describes damage that has no receiver.

The five `.meter-fill` bars in `hud.js:39-60` are hard-coded to `width: 100%` in
`src/ui/css/hud/meters.css` and nothing writes them.

**Recommendation: build a minimal `PlayerVitals` — health only.** Not hunger/thirst/sleep/
stamina, not the 1,159-line `SurvivalSystem`. Health, damage with an armour reduction (the
formula already exists at `mobIntegration.js:74-79`), death, respawn at
`character.spawnPoints[worldId]` (already written by `savePlayerState.js:45-50`), and a
writer for `#health-meter .meter-fill`. The other four bars stay at 100% and stay honest.
Full survival mechanics are a separate product decision, out of scope here.

### 2.3 Mobs are entirely client-local and non-deterministic

`shared/protocol.js` has **no mob message type of any kind**. Each client runs its own
`MobManager`, seeded per world but driven by `Math.random()` at:

- `mob.js:37` (initial yaw), `:43` (idle timer), `:85` (mob id), `:117` (wander timer),
  `:211`/`:213` (drop rolls)
- `mobManager.js:160` (spawn shuffle), `:259`/`:260` (spawn x/z), `:291` (hover height)
- `mobDefinitions.js:485` (`selectMobForBiome` weighted roll)

Two players standing in the same chunk see **completely different mobs**. There is no
shared entity concept to build on.

**This is the largest single piece of work in the plan.** A shared boss fight requires a
host-authoritative networked entity layer that does not exist. §6 designs it.

### 2.4 The storyline's two key biomes do not exist

`BIOME_DEFS` (`src/engine/world/BiomeSystem.js:18-97`) defines exactly ten biomes:
Deep Ocean, Ocean, Beach, Plains, Forest, Badlands, Tundra, Desert, Mountains, Frozen Peaks.
`workerGeneration.js:187-196` carries the matching feature table.

There is **no Corrupt biome and no Lava biome**. `questStoryline.md` puts three of its four
dungeons in them.

The *blocks* exist (`lava`, `blackstone`, `crying_obsidian` aliased as `OBSIDIAN` at
`BlockRegistry.js:474`, `toxic_slime`, `corrupt_crystal`, all the ice variants). Only the
biomes are missing. §3 resolves this.

### 2.5 Missing content the storyline assumes

| Storyline needs | Reality |
|---|---|
| Q06: craft a `bed` | **No `bed` block, no `bed` recipe.** Not in `BlockRegistry.js`, not in `CraftingSystem.RECIPES`. |
| Q19: 3 `bread` | `bread` is a defined item (`ItemDefinitions.js:116`) with **no recipe** and no source. |
| `quest_key` icon | `textures/items/` has `corrupt_crystal.png` and `apple.png` but **no `quest_key.png`.** Needs an asset or a `scripts/generate-item-textures.js` entry. |
| 5 dungeons × `1 quest_key` | `quest_key` is `maxStack: 1`. Carrying two seal keys at once is impossible. Needs five distinct key items (§4.3). |
| "boss_kill" requirement type | No such concept. New objective type (§4.2). |
| Titles | No title system anywhere. Small addition (§4.4). |

---

## 3. Reconciling the storyline with the world — five seals, five biomes

**The ask:** a boss at each of five seals, plus one super boss once all five are broken.
`questStoryline.md` has four seal bosses (Forest Warden, Lava Titan, Frost Serpent,
Corruption Overlord) and treats the Final Seal itself as the fifth fight. That is four seals
and two finale fights, not five and one.

### Decision D-Q1 — the seal-to-biome mapping

**Recommendation: map five seals onto five biomes that already generate, and promote the
Corruption Overlord + Final Seal into one three-phase super boss.** No new biomes.

| # | Seal | Biome (exists today) | Boss | Origin |
|---|---|---|---|---|
| 1 | **Verdant Seal** | Forest | Forest Warden | storyline, unchanged |
| 2 | **Ember Seal** | Badlands (deep cave / lava layer) | Lava Titan | storyline, rehomed |
| 3 | **Frozen Seal** | Frozen Peaks | Frost Serpent | storyline, unchanged |
| 4 | **Sunken Seal** | Desert | Dune Colossus | **new** |
| 5 | **Deepstone Seal** | Mountains (Y < 30, deepslate layer) | Hollow King | **new** |
| ★ | **The Final Seal** | Corruption Spire — a placed structure, not a biome | Corruption Overlord *(3 phases)* | storyline, merged |

Rationale for not adding biomes: `workerGeneration.js` derives terrain from
`(cx, cz, seed)`. Adding two biomes changes what *newly generated* chunks look like while
already-saved chunks keep the old terrain, producing visible seams in every existing world
and no clean migration (chunks live in IndexedDB keyed `${worldId}:${cx},${cz}` —
`Persistence.js:130-133`). Corruption becomes a *structure* — a localised, hand-authored
zone of `toxic_slime` / `corrupt_crystal` / dead trees placed around each seal site — which
is additive, cheap, and does not perturb terrain.

**Alternative if the user prefers biome fidelity:** add `CORRUPT` and `LAVA` to `BIOME_DEFS`
and the feature table, accept the seams, and gate them behind a world-config
`worldgenVersion` so only new worlds get them. Costs roughly one extra stage. This is
question Q1 in §10.

### The corruption spire

The super boss arena is placed deterministically at a mid-range distance from world origin
(see §7) and is **inert until all five seals are broken**. Physically present from world
generation — players can find it, walk up to it, and read a "five seals hold this shut"
prompt — which is better foreshadowing than a structure that pops into existence.

### Quest count

`questStoryline.md`'s 25 quests cover four acts. A fifth seal needs a short act. Proposal:
**28 quests**, five acts of seal content plus the finale, rather than re-numbering. Exact
quest text is a follow-up to this plan; the *system* does not care how many there are.

---

## 4. The data model

### 4.1 One schema, versioned, world-scoped

Replaces all three shapes in §2.1. Lives on the world object, saved to
`cuubz:worldSlot:{N}:conf`.

```js
// src/game/data/QuestState.js — shape, defaults, migration
{
  v: 1,                              // schema version; anything else is migrated or reset
  activeQuestId: 'q07',              // what the HUD tracker shows
  quests: {
    q07: {
      stage: 7,
      completed: false,
      objectives: { corrupt_crystal: 3 },   // objectiveKey → count observed
      completedAt: null,                    // epoch ms
      completedBy: null,                    // playerId of whoever closed it
    },
  },
  seals: {
    verdant: {
      state: 'dormant',              // dormant | keyed | primed | contested | broken
      site: { x: 812, z: -344 },     // resolved once, then frozen — see §7
      brokenAt: null,
      brokenBy: [],                  // every playerId that dealt damage to the boss
    },
    // ember, frozen, sunken, deepstone — same shape
  },
  finale: {
    state: 'sealed',                 // sealed | open | contested | defeated
    site: { x: -1180, z: 260 },
    defeatedAt: null,
  },
  titles: ['survivor', 'seeker'],    // earned, world-scoped
}
```

Constraints that shaped this:

- **It lives in `localStorage`**, alongside two other world configs plus the character
  array. Budget it at **≤ 8 KB serialized**. That rules out per-player progress ledgers,
  event logs, and anything unbounded. `brokenBy` is capped at `MAX_PLAYERS_LIMIT` (4) by
  construction.
- **Monotonic where possible.** `Host.handleQuestUpdate` already refuses to move progress
  backwards (`Host.js:1001-1003`). Keeping that property makes late joins, packet
  reordering and rejoin-after-crash all resolve to "take the higher value" instead of
  needing conflict resolution.
- **`site` is written once and never recomputed.** If the site-selection algorithm ever
  changes, existing worlds keep their seals where the players found them.

### 4.2 Quest definitions

`src/game/data/QuestDefinitions.js` — pure data, no imports beyond item/block id tables,
in the style of `MOB_DEFINITIONS`.

```js
{
  id: 'q12',
  title: 'The Forest Warden',
  act: 2,
  stage: 12,
  type: 'BOSS',                    // COLLECT | CRAFT | EXPLORE | DELIVER | BOSS
  narrative: '…',
  objectives: [
    { kind: 'boss_kill', boss: 'forest_warden', count: 1 },
  ],
  rewards: [
    { kind: 'unlock', questId: 'q13' },
    { kind: 'title',  id: 'warden_slayer' },
  ],
  marker: { seal: 'verdant', offset: [0, 0, 0] },
  requires: ['q11'],               // prerequisite quest ids
}
```

Five objective kinds, each with a defined evaluator:

| kind | Evaluated by | Notes |
|---|---|---|
| `have_item` | polling `Inventory.countItem` | covers COLLECT and CRAFT identically — see §4.5 |
| `visit` | player position vs. a radius | covers EXPLORE |
| `deliver` | altar interaction consumes items | covers DELIVER; host-validated in MP |
| `boss_kill` | `BOSS_DEFEATED` from the host | never client-asserted |
| `seal_state` | seal state machine | e.g. "all five broken" for the finale |

### 4.3 Seal definitions

`src/game/data/SealDefinitions.js`:

```js
{
  id: 'verdant',
  name: 'Verdant Seal',
  biome: 'forest',
  keyItem: 'seal_key_verdant',        // NEW item, maxStack 1, one per seal
  offering: [{ item: 'corrupt_crystal', count: 5 }],
  boss: 'forest_warden',
  arena: { radius: 24, height: 20 },  // leash + build volume
  siteRing: { min: 640, max: 1600 },  // distance band from origin
}
```

**Five distinct key items** replaces the single `quest_key`, because `maxStack: 1` makes
carrying two impossible. `quest_key` stays defined (creative palette, back-compat) but is no
longer a quest requirement. Each new key needs: an `ItemDefinitions` entry, an icon under
`textures/items/`, an entry in `InventoryItemTypes.getMaxStack` (`:56-57`) and in
`InventorySync.SINGLE_STACK_BLOCKS` (`:78`).

### 4.4 Titles

`titles: string[]` on the quest state, a `TITLE_DEFS` table, and a line in the quest log.
No gameplay effect. Nine titles from `questStoryline.md` + two for the new seals.

### 4.5 Progress tracking: poll, don't hook

`CraftingSystem` has no completion callback. `Inventory` exposes only `onSelectionChange`
(`InventorySystem.js:121`). `BlockInteraction` has no break/place callback. Adding three new
event channels to feed one consumer is the wrong shape.

**Recommendation: poll the inventory.** One `QuestTracker.evaluate(state)` call every
30 frames (~0.5 s, using the existing `state.frameCount % N` idiom from `NetworkStep.js:29`)
recomputes every active `have_item` objective from the live inventory. It is uniform across
mining, crafting, looting and trading; it has no ordering hazards; and it costs one pass
over 36 slots twice a second.

The one thing polling cannot see is a *transient* — "you crafted 10 planks then used them".
Objectives are therefore **latched**: once an objective's count is met it stays met, stored
in `quests[id].objectives`. That matches player expectation and matches the monotonic rule.

---

## 5. Persistence — "saved to each world, shared by everyone in it"

### 5.1 Single-player

Quest state lives on the world object; `PersistenceManager.saveWorld()` already writes a
`questProgress` field (`Persistence.js:176`). Two changes:

1. Rename to `questState` **with a migration**: on load, an object with no `v` is treated as
   the legacy `{}` and replaced with defaults. Old worlds have empty quest progress anyway
   (nothing ever wrote it), so the migration is cosmetic — but it must exist, or the first
   real schema change has no precedent to follow.
2. **Add a save trigger.** Today the world config is written only by `createWorld`,
   `updateWorld` and `selectWorld` (`WorldManager.js:233, 274, 337`) — nothing saves during
   play. Quest progress would be lost on every crash.

   **Recommendation:** piggyback on the existing 30-second character save. `savePlayerState`
   (`src/core/savePlayerState.js`) is called from three places — the interval, the Escape
   handler, and `Game.stop()` (`DEPLOY.md` §7). Add a sibling `saveWorldState(state, deps)`
   in a new file and call it from the same three sites. Do **not** fold it into
   `savePlayerState`: that function's contract is "the selected character", and quest state
   is the world's.

   Additionally save **immediately** on the three events that are expensive to lose: quest
   completed, seal state changed, boss defeated. These are rare enough to be free.

### 5.2 Multiplayer — the host owns it

`HostManager` is the authority (it already is for blocks and inventory). Its
`_worldState.questProgress` becomes `_worldState.questState` in the §4.1 shape and is
**seeded from the host's own world config on session start** and **written back to it** by
the same `saveWorldState` calls.

Consequences, stated plainly:

- **Progress is saved on the host's device, in the host's world slot.** A world hosted by
  player A and joined by B advances A's copy. If B later hosts their own world, it has its
  own seals at its own sites.
- **Joining clients hold a view, not a copy.** `SessionRejoin.js:83-93` and
  `AutoRejoin.js:82-92` construct a *temporary* world object pushed onto
  `worldManager.worlds` without going through `createWorld` — it is never persisted and
  never gets a slot. That is correct and should stay: a guest's device must not accumulate
  half-finished copies of other people's worlds. Their `questState` is whatever the host
  last sent, and it is discarded on disconnect.
- **Late joiners need the full state.** The host must send it. See §6.1.

This satisfies "quests live and are saved to each world, shared among anyone currently
playing in that world" exactly. Question Q3 in §10 asks whether a guest should get to keep
anything.

---

## 6. Multiplayer protocol

### 6.1 New message types

Added to `shared/protocol.js` **first**, then used — `test/unit/multiplayer/protocol.test.js`
asserts structurally that `Client.js`, `server/session.js` and `server/matchmaking.js`
contain no bare protocol string literals and that every `MESSAGE_TYPES.X` they name is a
real key.

| Type | Direction | Payload | Rate |
|---|---|---|---|
| `QUEST_SYNC` | host → client | full `questState` object | on join, on rejoin |
| `QUEST_UPDATE` | client → host → all | `{ questId, objectiveKey, progress }` | on change (already exists) |
| `SEAL_UPDATE` | host → all | `{ sealId, state, brokenBy? }` | on transition |
| `BOSS_SPAWN` | host → all | `{ bossId, type, sealId, position, maxHp, arena }` | once per encounter |
| `BOSS_STATE` | host → all | `{ bossId, x, y, z, yaw, hp, phase, aiState }` | **10 Hz** while contested |
| `BOSS_HIT` | client → host | `{ bossId, damage, origin, direction }` | on player attack |
| `BOSS_DEFEATED` | host → all | `{ bossId, sealId, contributors, loot }` | once |
| `BOSS_DESPAWN` | host → all | `{ bossId, reason }` | on wipe/reset |

`server/session.js` relays them (its `switch` at `:250-270` is explicit, so each needs a
case). `Client.js:1016-1021` must add **all of the above plus `QUEST_UPDATE`**, which is
missing today (§2.1).

`Host._setupGameHandlers()` (`Host.js:621-655`) must register `QUEST_UPDATE` → the existing
`handleQuestUpdate()`, and `BOSS_HIT` → a new `handleBossHit()`.

### 6.2 Bandwidth

`BOSS_STATE` at 10 Hz is ~120 bytes/tick/client → **~1.2 KB/s per client, ~5 KB/s for a
full 4-player session**, and only while a boss is alive. For comparison, `PLAYER_MOVE`
already runs at ~20 Hz per player (`PlayerStep`). Acceptable. If it is not, drop to 8 Hz —
the client interpolates either way.

### 6.3 Damage validation

`BOSS_HIT` is untrusted input. The host validates, mirroring the pattern
`validateQuestUpdate` and `RateLimiter` already establish in `Host.js`:

1. Sender is a connected player in this session.
2. Sender's last-known position (the host tracks it — `_handlePlayerMove`) is inside the
   arena radius, plus slack for latency.
3. `damage` is within the maximum any item in `NAMED_ITEMS` can produce (currently
   `netherite_spear`-class; compute the ceiling from the table, do not hard-code it).
4. Rate-limited per player to the fastest legal attack speed (`4.0 + def.attackSpeed`, the
   same formula `CombatStep.js:42-49` uses) with a tolerance factor.

Reject-and-warn on failure, exactly like `handleQuestUpdate` does at `Host.js:996`. Never
kick — a laggy client is not a cheater.

### 6.4 The host is also a player

`HostManager` runs in the host's browser alongside their own `MobManager` and `Inventory`.
The host's own attacks must go through the **same** `BOSS_HIT` path — via a local transport
that calls `handleBossHit` directly rather than over the socket. One code path, or the host
and the guests diverge. This is the single most important design rule in this document; the
repo's history is a list of what happens when two paths exist for one thing.

### 6.5 Single-player uses the same code

Single-player instantiates the host-side encounter runner with a null transport. The boss
simulation, the damage validation and the state machine are byte-identical between
single-player and hosted multiplayer. Only the broadcast is a no-op.

---

## 7. Worldgen — seal sites, altars, arenas

### 7.1 Site selection is deterministic and frozen

`src/engine/world/structures/SealSites.js` (new, pure, testable in node):

```
sealSites(worldSeed) → { verdant: {x,z}, ember: {x,z}, … , finale: {x,z} }
```

Algorithm: for each seal, hash `(worldSeed, sealId)` into an angle and a radius inside the
seal's `siteRing`, then walk outward in a bounded spiral (cap it — 256 candidate columns)
sampling `BiomeSystem.getBiomeAtWorldPos(wx, wz, seed)` until the biome matches. If no match
is found within the cap, **fall back to the unfiltered position and log it** — a seal in the
wrong biome is a cosmetic disappointment; a world that hangs during generation is not.

The result is written into `questState.seals[id].site` on first world entry and **never
recomputed** (§4.1).

### 7.2 Structures go inside `workerGeneration.js`

**Constraint that shapes this whole section:** `src/engine/world/workerGeneration.js` is a
1,100-line **classic script**, loaded `?url` into the worker pool and assigning
`window._voxelgenGenerateChunk` for the main-thread fallback (`ChunkGenerator.js:22-30`,
`:51-53`). It has **no imports** and cannot have any. Its style is `var`, IIFE-scoped
helpers, and inline tables (`BIOME_FEATURES` at `:186-197`, `SHALLOW_ORES` at `:201-208`).

Altar and arena placement must therefore be written **in that file, in that style**, and fed
its inputs through `genParams` (which `ChunkGenerator.generateChunk` already threads through
to the worker at `:44-51`). Pass the resolved seal sites in `genParams.sealSites`.

Per-chunk work: if a chunk intersects a seal site's footprint, carve/stamp the arena and
altar from a small hand-authored template. Keep it to a handful of block writes per affected
chunk — this runs on the generation hot path.

### 7.3 What gets placed

| Element | Blocks | Purpose |
|---|---|---|
| Altar | `chiseled_stone_bricks`, `crying_obsidian`, a `quest_key`-marked centre block | Interaction target; `primed` transition |
| Arena floor | flattened `stone_bricks` / `deepslate_tiles`, radius per `SealDefinitions.arena` | Boss needs walkable ground; `mobMovement` uses `isSolidBlock` |
| Corruption zone | `toxic_slime` pools, `corrupt_crystal` clusters, dead trees | Replaces the missing Corrupt biome (§3); source of `corrupt_crystal` |
| Key cache | `quest_key` block variant placed once per seal | Source of `seal_key_*` |
| Spire | tall `blackstone` / `crying_obsidian` column at the finale site | Foreshadowing; inert until 5 broken |

### 7.4 Multiplayer chunk flow makes this easy

In a session, the **host generates and the clients receive** — `ChunkManager` runs in
`clientMode` and chunks arrive as `CHUNK_DATA` (`src/multiplayer/ChunkStreamer.js`,
`ChunkResync.js`). Clients never generate terrain, so structures need to be
deterministic only for *single-player and the host*, not across peers.

Block edits inside an arena stay host-validated by the existing `BLOCK_BREAK`/`BLOCK_PLACE`
path. Whether players may mine the altar is question Q4 in §10.

---

## 8. Boss entity design

### 8.1 Reuse the mob renderer — do not write a new one

`Boss.js` was deleted partly because it had no rendering. **Do not repeat that.** Define
bosses in the existing `MOB_DEFINITIONS` format so `mobModelBuilder`, `mobAnimator` and
`mobRenderer` draw them with zero new rendering code. The builder supports `box`, `sphere`,
`cylinder` and `cone` (`mobModelBuilder.js:83-104`) — enough for a root-and-thorn warden or
a molten titan at 4–8× scale.

Required changes to the mob layer:

- Add `MOB_CATEGORIES.BOSS` (`mobDefinitions.js:14-17`).
- Boss defs carry **`biomes: []`**. Both `getMobTypesForBiome` and `selectMobForBiome`
  iterate `def.biomes.includes(biome)` (`:461-489`), so an empty array excludes bosses from
  natural spawning for free — and a *missing* `biomes` would throw. This must be asserted in
  a test.
- `MobManager` must exempt bosses from `mobCap` / `hostileCap` (`mobManager.js:28-31`), from
  the `despawnDistance` check (`:120-125`) and from the `minHostileSpawnDistance` rule. A
  boss that despawns because a player kited it 128 blocks is a bug report.
- Spawn via the existing `spawnMobAt(mobType, position)` (`mobManager.js:426`), which already
  bypasses the spawn tick.

### 8.2 Phases

Boss definitions get a `phases` array — HP thresholds, per-phase ability sets, per-phase
animation overrides. The Corruption Overlord has three (`questStoryline.md` Q25); the five
seal bosses have two each (enrage below 40%).

**Explicitly initialise every phase timer at construction.** The deleted `Boss.js` left
`phaseTransitionTimer` undefined, so a deserialized boss was NaN-frozen and unkillable and
no test caught it (`src/index.js:73-75`). Add a test that constructs each boss, advances it
through every phase threshold, and asserts it dies.

### 8.3 Abilities

Start with what the existing systems can already express, and stage the rest:

| Ability | Feasible with today's code? |
|---|---|
| Melee (vine lash, tail swipe) | **Yes** — `onMobAttack` + §2.2 player health |
| Charge / leap | **Yes** — `applyMovement` + `applyKnockback` |
| Summon adds | **Yes** — `spawnMobAt` with existing hostile types |
| Ranged projectile (magma, corruption beam) | **No** — no projectile system. New. |
| AoE ground effect (lava pools, poison spores) | **Partly** — block writes are cheap, damage-over-time needs §2.2 |
| Ice walls / terrain modification | **Yes** but expensive — block writes must go through the host's validated path or clients desync |

**Recommendation:** first boss ships with melee + charge + summon only. Projectiles and DoT
zones are their own stage. Do not let a projectile system block the first working seal.

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
loot to every contributor in `brokenBy` (not just the killer), title grant, immediate save,
and a check for "all five broken" → `finale.state = 'open'`.

### 8.5 Loot determinism

`rollDrops` uses bare `Math.random()` (`mobDropTable.js:16-19`). For a shared boss, **the
host rolls once** and ships the result in `BOSS_DEFEATED`. Clients apply what they are told;
they do not roll. Same rule as `BOSS_HIT`: one authority.

---

## 9. Files — new and changed

### New

| File | Purpose | Rough size |
|---|---|---|
| `src/game/data/QuestDefinitions.js` | 28 quests, pure data | ~600 |
| `src/game/data/SealDefinitions.js` | 5 seals + finale | ~120 |
| `src/game/data/QuestState.js` | Schema, defaults, migration | ~120 |
| `src/game/data/TitleDefinitions.js` | Title table | ~40 |
| `src/game/systems/QuestSystem.js` | State machine — no DOM, no network | ~300 |
| `src/game/systems/QuestTracker.js` | Objective evaluation (§4.5 polling) | ~200 |
| `src/game/systems/SealSystem.js` | Seal state machine + altar interaction | ~250 |
| `src/game/entities/BossEntity.js` | Boss instance, phases, ability timers | ~350 |
| `src/game/systems/BossEncounter.js` | Host-side runner: spawn, arena, leash, reset, loot | ~350 |
| `src/game/mobs/bossDefinitions.js` | 6 boss defs in `MOB_DEFINITIONS` format | ~700 |
| `src/multiplayer/QuestSync.js` | Mirrors `InventorySync.js` | ~180 |
| `src/multiplayer/BossSync.js` | Mirrors `PlayerSync.js` — host broadcast, client interp | ~280 |
| `src/engine/world/structures/SealSites.js` | Deterministic site selection | ~150 |
| `src/ui/hud/QuestTracker.js` | Writes the existing `#quest-tracker` DOM | ~120 |
| `src/ui/hud/BossBar.js` | New HUD element | ~120 |
| `src/ui/overlays/QuestLog.js` | Full quest list (key `J`) | ~250 |
| `src/ui/css/hud/boss-bar.css` | Boss bar styling | ~60 |
| `src/ui/css/overlays/quest-log.css` | Quest log styling | ~100 |
| `src/core/init/initQuests.js` | `Game.init()` step 15 | ~120 |
| `src/core/saveWorldState.js` | Sibling to `savePlayerState.js` | ~50 |
| `src/game/entities/PlayerVitals.js` | §2.2 minimal health | ~200 |

### Changed

| File | Change |
|---|---|
| `shared/protocol.js` | +8 message types (§6.1) |
| `server/session.js` | Relay cases for the new types |
| `src/multiplayer/Client.js:1016-1021` | Add `QUEST_UPDATE` (**missing today**) + 7 new types to `gameEvents` |
| `src/multiplayer/Host.js:618-655` | Register `QUEST_UPDATE` → `handleQuestUpdate`; add `handleBossHit` |
| `src/multiplayer/Host.js:451-454, 989-1035` | `_worldState.questProgress` → `questState` (§4.1); seed from world config; send `QUEST_SYNC` on join |
| `src/game/entities/WorldManager.js:226, 360-398` | Replace the three ad-hoc helpers; delete the `nextStage >= 5` placeholder |
| `src/engine/world/Persistence.js:176` | `questProgress` → `questState` + migration |
| `src/core/GameState.js` | Declare `questSystem`, `sealSystem`, `bossEncounter`, `bossSync`, `questSync`, `playerVitals`, `bossBar` — *declared, not grown*, per that file's header |
| `src/core/Game.js:194-202` | `initQuests(this)` as step 15; teardown |
| `src/core/savePlayerState.js` call sites | Add `saveWorldState` alongside (3 sites) |
| `src/engine/loop/SystemRunner.js` | Quest/boss step (or extend `WorldStep`) |
| `src/engine/loop/steps/CombatStep.js:56` | Boss hits → `BOSS_HIT`, not local `takeDamage` |
| `src/game/mobs/mobDefinitions.js:14-17` | `MOB_CATEGORIES.BOSS` |
| `src/game/mobs/mobManager.js:28-31, 120-125` | Boss exemptions from cap and despawn |
| `src/game/mobs/mobIntegration.js:68-83` | Wire `onMobAttack` to `PlayerVitals` |
| `src/core/init/initMobs.js:35` | Pass real vitals instead of `null` |
| `src/engine/world/workerGeneration.js` | Altar/arena/corruption placement, **in-file, classic-script style** (§7.2) |
| `src/ui/templates/hud.js:78-84` | Un-hide `#quest-tracker`; add boss bar markup |
| `src/ui/css/index.css:45` | Two `@import`s — **order is load-bearing (D-52)** |
| `src/game/data/ItemDefinitions.js` | 5 `seal_key_*` items |
| `src/game/systems/InventoryItemTypes.js:56-57` | Single-stack for the new keys |
| `src/multiplayer/InventorySync.js:78` | Same |
| `textures/items/` | Icons for 5 keys + `quest_key` (**missing today**) |

---

## 10. Stages

Each stage is a shippable PR that leaves the tree green. Every defect found along the way
gets a `BUGS.md` row with an owner at the time it is found — that is the repo's rule and it
is not optional.

| Stage | Scope | Depends on | Blockers cleared |
|---|---|---|---|
| **S0** | **Unify quest state.** One schema, migration, persistence hook, `saveWorldState`, fix the two broken wire routes. No gameplay, no UI. | — | §2.1 |
| **S1** | **Quests, single-player.** `QuestDefinitions` (Act 1 only, 6 quests), `QuestSystem`, `QuestTracker` polling, HUD tracker, quest log. `COLLECT`/`CRAFT`/`EXPLORE`. | S0 | — |
| **S2** | **Quest sync.** `QUEST_SYNC` on join, host authority, guest-view semantics, rejoin. | S0, S1 | §2.1 |
| **S3** | **Player health.** `PlayerVitals`, damage, armour, death, respawn, `#health-meter` writer, `onMobAttack` wired. | — *(parallel with S1/S2)* | §2.2 |
| **S4** | **Seal sites + altars.** `SealSites`, worldgen structures, corruption zones, `SealSystem` up to `primed`, 5 key items + icons, world markers. | S1 | §2.4, §2.5 |
| **S5** | **First boss, end to end.** `BossEntity`, `BossEncounter`, `BossSync`, boss bar, host authority, `Forest Warden` with melee + charge + summon. Single-player and 4-player both. | S2, S3, S4 | §2.3 |
| **S6** | **Four more seal bosses.** Lava Titan, Frost Serpent, Dune Colossus, Hollow King. Projectiles and DoT zones if S5 proved the shape. | S5 | — |
| **S7** | **Super boss + completion.** Spire unseal on 5 broken, 3-phase Corruption Overlord, titles, end state. | S6 | — |

S3 has no dependency on S0–S2 and can run concurrently. S5 is the long pole and is where the
schedule risk lives; keep it to one boss.

---

## 11. Testing

Conventions: `vitest`, `test/**/*.test.js`, `environment: 'node'` by default with jsdom
opt-in per file via `// @vitest-environment jsdom` (`vitest.config.js:15-63`).
**Browser e2e cannot run in this environment** — verify UI with node/jsdom stubs, not
screenshots.

| Stage | Unit | Integration |
|---|---|---|
| S0 | Schema defaults; migration from `{}`, from `undefined`, from a v0 blob; monotonic merge | Save → reload → state survives; host↔client shape agreement |
| S1 | Objective evaluators for all five kinds; prerequisite gating; latching; reward application | Full Act 1 run against a mock inventory |
| S2 | `QUEST_SYNC` serialization; `QUEST_UPDATE` validation rejects garbage | 2-client session: A completes, B sees it; B joins late and gets full state; B rejoins after disconnect |
| S3 | Damage/armour arithmetic; death at 0; respawn position from `spawnPoints` | Mob attack → health drops → death → respawn |
| S4 | `sealSites` determinism (same seed → same sites) and biome matching; spiral cap terminates; site frozen across recompute | Generate a world, assert 5 altars exist at the recorded sites |
| S5 | **Every boss constructs with all timers initialised and dies when damaged past every phase threshold** (the deleted `Boss.js`'s exact defect); `BOSS_HIT` validation rejects out-of-arena, over-damage, over-rate | 4-client encounter: all four deal damage, HP agrees within one tick, all four get loot, `brokenBy` has four entries |
| S6 | Per-boss phase tables | Each seal reachable and completable |
| S7 | 5-broken detection; finale gating | Full run |

Two assertions worth naming specifically, because they guard the failures this codebase has
already had:

- **`test/unit/multiplayer/protocol.test.js`** must keep passing — every new message type is
  a `MESSAGE_TYPES` key before it is a string anywhere.
- **`test/unit/ui/pageLoad.test.js`** asserts the *assembled* DOM. The boss bar markup and
  the un-hidden quest tracker show up there.

---

## 12. Open questions

Answers to Q1–Q3 change the shape of the work, not just its details.

**Q1 — Corrupt and Lava biomes: structures or real biomes?**
The plan assumes **structures** (§3): five seals mapped onto biomes that already generate,
with localised corruption zones stamped around each altar. Real biomes are more faithful to
`questStoryline.md` but change terrain generation, seam existing worlds, and add a stage.

**Q2 — Shared objectives: does one player's work count for everyone?**
The plan assumes **"any player completing an objective completes it for the party"** —
monotonic, matches the existing host validator, no conflict resolution. The alternative is
**pooled contributions** ("the party collectively needs 20 obsidian"), which is a better
co-op feel but needs a per-player ledger in a state budget of 8 KB and regresses when someone
drops items or leaves.

**Q3 — Should a guest keep anything?**
The plan assumes **no**: a guest's view of the host's quest state is discarded on disconnect
(§5.2). Titles could reasonably be character-scoped and permanent instead — that would be a
small addition to `CharacterManager` and would mean a guest who helps kill the Forest Warden
keeps "Warden Slayer" forever.

**Q4 — Are seal arenas protected?**
Can a player mine the altar, or wall the boss in, or dig out the arena floor? A protected
volume is a new concept for `BlockInteraction` and the host's block validator. Cheapest
answer is "unprotected, and the encounter resets if the boss falls out of the arena".

**Q5 — Difficulty, and what a wipe costs.**
The plan assumes a wipe resets the boss to full and costs nothing but time. Boss HP scaling
by player count (2× for 4 players?) is unspecified. Neither is answerable without §2.2
landing first, so this can wait until S3.

**Q6 — The 28th quest.**
Five seals need a fifth act. Does the storyline get extended (three new quests for the Sunken
and Deepstone seals), or do the two new seals get folded into the existing 25 as optional
side content?
