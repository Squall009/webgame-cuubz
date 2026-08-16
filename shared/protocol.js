/**
 * Cuubz — the wire protocol, in one place (PR 33)
 *
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * `MESSAGE_TYPES` was declared **three** times, and the three did not agree:
 *
 *   1. `src/multiplayer/Client.js:42`  — 24 keys.
 *   2. `server/session.js:30`          — 10 keys.
 *   3. `server/matchmaking.js`         — **no symbol at all**, 14 bare string
 *      literals scattered through one `switch` and eight `_send` calls.
 *
 * They disagreed on *membership*, never on values, so nothing was broken by the
 * mismatch alone — but copy 3 is the one that could not be diffed against anything,
 * and it is the one that drifted. `HOST_REJECTED` (matchmaking.js:141) existed on the
 * wire and in **neither** table, was in no routing list on the client and had no
 * handler, so a refused host request produced no feedback whatsoever. That is
 * `BUGS.md` D-78, and a third copy made of string literals is exactly how it happened.
 *
 * ─── THE ARITHMETIC ─────────────────────────────────────────────────────────
 *
 * The union is **27** keys, not the 24 or the 10:
 *
 *      9  in both former tables (JOIN, LEAVE, MOVE, BREAK_BLOCK, PLACE_BLOCK,
 *         INVENTORY_UPDATE, QUEST_UPDATE, HEARTBEAT, CHUNK_DATA)
 *   + 15  client-only (the matchmaking half plus every server→client game event:
 *         HOST, BROWSE, WELCOME, PLAYER_JOINED, PLAYER_LEFT, PLAYER_MOVE,
 *         BLOCK_BREAK, BLOCK_PLACE, INVENTORY_SYNC, HOST_CREATED, SESSION_LIST,
 *         JOIN_ACCEPTED, JOIN_REJECTED, LEFT_LOBBY, ERROR)
 *   +  1  server-only: HEARTBEAT_ACK. The client never had a symbol for it and
 *         compared `data.type === 'HEARTBEAT_ACK'` by literal (Client.js:374) —
 *         the whole keepalive hung off a string neither table listed.
 *   = 25  which is the number the two symbol tables could ever have reached.
 *   +  2  which they could not: **TIME_SYNC** (sent by `NetworkStep`, relayed by
 *         `session.js:204`, routed by `Client.js:891` — a live message type that was
 *         a bare literal in all five of its call sites) and **HOST_REJECTED**, D-78.
 *   = 27
 *
 * Since then: **+1** CHUNK_REQUEST (D-116, the client→host re-send ask) = 28, and
 * **+8** for the quest, seal and boss systems (S0/S2/S6) = **36**. The eight are grouped
 * and commented in place below; `test/unit/multiplayer/protocol.test.js` asserts the
 * count, so this arithmetic and that number cannot drift apart silently.
 *
 * ─── THIS IS AN ES MODULE, AND `server/package.json` SAYS `"type": "module"` ──
 *
 * One source of truth has to be importable from both sides, and the two sides are a
 * browser bundle (`src/`, ES modules since PR 9) and Node (`server/`, CommonJS until
 * this PR). The ruling is ESM, scoped to `server/` by a `"type": "module"` in
 * `server/package.json` — **not** at the repo root, where it would also reclassify
 * `scripts/` and `test/e2e/`, which are genuinely CommonJS (`eslint.config.mjs:7-11`).
 * The cost was nine lines of `require`/`module.exports` inside `server/`.
 *
 * The alternative — shipping this twice, once CJS and once ESM — reintroduces the
 * duplication the file exists to delete, so it was not taken.
 *
 * `shared/package.json` exists for the same reason and says only `"type": "module"`.
 * This directory is OUTSIDE `server/`, so without it Node falls back to the **root**
 * package.json, finds no type, and prints MODULE_TYPELESS_PACKAGE_JSON on every relay
 * boot — the exact warning `eslint.config.mjs` was renamed `.mjs` to avoid. It is a
 * two-line file so that the root package.json still does not need a `"type"`.
 *
 * `src/multiplayer/Client.js` reaches this by a plain relative import,
 * `../../shared/protocol.js`. Vite follows it because it is inside the project root;
 * `vite.config.js` needs no alias and did not change.
 *
 * ─── HOW TO CHANGE IT ───────────────────────────────────────────────────────
 *
 * Add the key here first, then use it. `test/unit/multiplayer/protocol.test.js`
 * asserts, structurally, that `Client.js`, `server/session.js` and
 * `server/matchmaking.js` contain **no bare protocol string literal** and that every
 * `MESSAGE_TYPES.X` any of them names is a key of this object — a typo'd member
 * access is `undefined` in JavaScript, not an error, so that assertion is the only
 * thing standing between a rename and a silently dead message handler.
 */

/**
 * Every message type on the wire, in both directions, on both sockets.
 *
 * Key === value throughout: the symbol is the string that goes into `msg.type`.
 * Frozen, because three mutable copies is how this got here.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const MESSAGE_TYPES = Object.freeze({
  // ── Game session, client → server ─────────────────────────────────────────
  JOIN: 'JOIN',
  LEAVE: 'LEAVE',
  MOVE: 'MOVE',
  BREAK_BLOCK: 'BREAK_BLOCK',
  PLACE_BLOCK: 'PLACE_BLOCK',
  INVENTORY_UPDATE: 'INVENTORY_UPDATE',
  QUEST_UPDATE: 'QUEST_UPDATE',
  HEARTBEAT: 'HEARTBEAT',

  // ── Game session, server → client ─────────────────────────────────────────
  WELCOME: 'WELCOME',
  PLAYER_JOINED: 'PLAYER_JOINED',
  PLAYER_LEFT: 'PLAYER_LEFT',
  PLAYER_MOVE: 'PLAYER_MOVE',
  BLOCK_BREAK: 'BLOCK_BREAK',
  BLOCK_PLACE: 'BLOCK_PLACE',
  INVENTORY_SYNC: 'INVENTORY_SYNC',
  // Server-only until this file: the client matched it as a literal (Client.js:374).
  HEARTBEAT_ACK: 'HEARTBEAT_ACK',

  // ── Game session, host → everyone (relayed unchanged) ─────────────────────
  CHUNK_DATA: 'CHUNK_DATA',
  // Client → host, relayed with the asking `playerId` attached. The client asks for the
  // chunks it is missing; without it a `CHUNK_DATA` that never arrived was never re-sent,
  // because the host records a chunk as delivered the moment it queues one (D-116).
  CHUNK_REQUEST: 'CHUNK_REQUEST',
  // Was a bare literal in all five of its call sites and in neither symbol table.
  TIME_SYNC: 'TIME_SYNC',

  // ── Quests and seals (S0/S2) ──────────────────────────────────────────────
  //
  // `QUEST_UPDATE` above predates all of these and was **dead on both ends**: the host
  // never registered a handler for it and the client never forwarded it, so the one
  // quest message that existed could not travel in either direction (§2.1). It is now
  // the host's authoritative broadcast of one objective pool, and the four below are the
  // rest of the shape it needed to be useful.
  //
  // Full state on join; a client's positive delta on the way up; a seal transition on
  // the way down.
  QUEST_SYNC: 'QUEST_SYNC',
  QUEST_CONTRIBUTE: 'QUEST_CONTRIBUTE',
  SEAL_UPDATE: 'SEAL_UPDATE',

  // ── Boss encounters (S6) ──────────────────────────────────────────────────
  //
  // Mobs are client-local and `Math.random()`-driven (§2.3), so two players in one chunk
  // see different mobs and always have. A boss cannot work that way — these five are the
  // host-authoritative entity layer, scoped to bosses and to nothing else.
  //
  // `BOSS_STATE` is the only high-rate one: 10 Hz, ~120 bytes, and only while a boss is
  // alive. `PLAYER_MOVE` already runs at ~20 Hz per player.
  BOSS_SPAWN: 'BOSS_SPAWN',
  BOSS_STATE: 'BOSS_STATE',
  BOSS_HIT: 'BOSS_HIT',
  BOSS_DEFEATED: 'BOSS_DEFEATED',
  BOSS_DESPAWN: 'BOSS_DESPAWN',
  // S12 — loot for a contributor who was not connected when the boss died. Host → one
  // player, on their next join, out of `questState.pendingLoot`. It is separate from
  // `BOSS_DEFEATED` because that message is scoped to a live boss the receiver can see,
  // and this one arrives when there is no boss and possibly a different session.
  BOSS_LOOT: 'BOSS_LOOT',

  // ── Matchmaking, client → server ──────────────────────────────────────────
  HOST: 'HOST',
  BROWSE: 'BROWSE',

  // ── Matchmaking, server → client ──────────────────────────────────────────
  HOST_CREATED: 'HOST_CREATED',
  // D-78. On the wire since the relay was written, in no table and in no routing
  // list, so a refused host request was silent. Its sibling below always worked.
  HOST_REJECTED: 'HOST_REJECTED',
  SESSION_LIST: 'SESSION_LIST',
  JOIN_ACCEPTED: 'JOIN_ACCEPTED',
  JOIN_REJECTED: 'JOIN_REJECTED',
  LEFT_LOBBY: 'LEFT_LOBBY',

  // ── Either socket, either direction ───────────────────────────────────────
  ERROR: 'ERROR',
});

/**
 * Hard ceiling on the players in one session, and the default when a host asks for
 * nothing usable.
 *
 * D-84: the host form's Max Players value was read from `#host-max-players`, passed
 * to `client.hostSession(...)`, and then dropped on the floor by a destructure that
 * did not name it — so `server/index.js` hard-coded 4 and a host who asked for 2 got
 * 4. The field now travels end to end, and the relay clamps it, because a client is
 * not a trusted source for a session cap. `src/ui/templates/lobbyScreen.js:117`
 * ships the slider as `min="2" max="4"`; these two constants are that range, server
 * side, where it is enforceable.
 */
export const MAX_PLAYERS_LIMIT = 4;

/** Floor for a session cap. A one-player "multiplayer" session is not one. */
export const MIN_PLAYERS_LIMIT = 2;

/**
 * Coerce whatever a client sent into a legal session cap.
 *
 * A non-integer is FLOORED, not rejected — `3.7` becomes `3`. Anything missing,
 * non-numeric or NaN falls back to the maximum, which
 * is the behaviour every client built before D-84 already got — so an old client that
 * sends no `maxPlayers` at all keeps working exactly as it did.
 *
 * @param {*} requested — `msg.maxPlayers`, straight off the wire and untrusted.
 * @returns {number} an integer in [MIN_PLAYERS_LIMIT, MAX_PLAYERS_LIMIT].
 */
export function clampMaxPlayers(requested) {
  if (requested === null || requested === undefined || requested === '') {
    return MAX_PLAYERS_LIMIT;
  }
  const n = typeof requested === 'number' ? requested : Number(requested);
  if (!Number.isFinite(n)) return MAX_PLAYERS_LIMIT;
  const floored = Math.floor(n);
  if (floored < MIN_PLAYERS_LIMIT) return MIN_PLAYERS_LIMIT;
  if (floored > MAX_PLAYERS_LIMIT) return MAX_PLAYERS_LIMIT;
  return floored;
}
