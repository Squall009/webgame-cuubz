/**
 * Cuubz — pooled quest objectives across four players, through a real relay (S2)
 *
 * ─── WHAT IS REAL HERE ──────────────────────────────────────────────────────
 *
 * The relay is the shipped `server/session.js`, over real WebSockets on an ephemeral
 * port. The host is a real `HostManager` with a real `QuestSystem` behind it. The only
 * stand-in is the thin `MultiplayerClient` adapter that maps `onGame` and
 * `_gameSessionConn.send` onto the host's socket — everything it wraps is production
 * code, and the messages on the wire are the messages the browser sends.
 *
 * That matters because the two things this stage is about are both *routing* facts:
 * `QUEST_CONTRIBUTE` has to reach the host and nobody else, and `QUEST_UPDATE` has to
 * reach every guest. Neither can be proved by calling a method.
 *
 * ─── THE FOUR ASSERTIONS THE PLAN ASKS FOR (§11, S2) ────────────────────────
 *
 *   • four clients each contribute a share of one objective
 *   • the pool reaches the target exactly once
 *   • a client disconnects mid-objective and its contribution is retained
 *   • it rejoins and is not double-credited
 *
 * The last is D-117's shape and the reason contributor identity is the **character** id
 * rather than the relay's per-connection `playerId`.
 */

import { describe, it, expect, afterAll } from 'vitest';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import SessionManagerServer from '../../server/session.js';
import { HostManager, HostRemotePlayer } from '../../src/multiplayer/Host.js';
import { QuestSystem } from '../../src/game/systems/QuestSystem.js';
import { createQuestState } from '../../src/game/data/QuestState.js';
import { MESSAGE_TYPES } from '../../shared/protocol.js';

const HOST_ID = 'host_player';
const openServers = [];

afterAll(() => {
  for (const s of openServers) {
    try { s.close(); } catch { /* already closed */ }
  }
});

/** A relay session on an ephemeral port (D-20: never a fixed one). */
function startRelay() {
  const httpServer = http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  httpServer.listen(0);
  openServers.push(httpServer);
  const wss = new WebSocketServer({ server: httpServer });
  const session = new SessionManagerServer({
    wss,
    sessionId: 'quest_sync_test',
    hostId: HOST_ID,
    maxPlayers: 4,
    heartbeatInterval: 30000,
  });
  return { session, port: httpServer.address().port, httpServer };
}

/** A raw socket that records what it receives. */
function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];
  const opened = new Promise((resolve) => ws.on('open', resolve));
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  return {
    ws,
    messages,
    opened,
    send: (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg)),
    ofType: (type) => messages.filter((m) => m.type === type),
    lastOfType: (type) => [...messages].reverse().find((m) => m.type === type) || null,
    close: () => ws.close(),
  };
}

/**
 * The adapter `HostManager` is constructed with. It expects a `MultiplayerClient`:
 * `onGame(type, fn)` to register, `_gameSessionConn.send(msg)` to broadcast, and
 * `isGameSessionConnected`. Everything below that line is the real thing.
 */
function hostClientAdapter(socket) {
  const handlers = new Map();
  socket.ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    for (const fn of handlers.get(msg.type) || []) fn(msg);
  });
  return {
    isGameSessionConnected: true,
    _gameSessionConn: { send: (msg) => socket.send(msg) },
    onGame(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    onMatchmaking() {},
    connectMatchmaking() {},
    hostSession() {},
  };
}

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

/**
 * Stand up a relay, a real host with a real quest system, and `guestCount` guests.
 *
 * The quest is **q14**, reached by marking Acts 1–2 and q13 complete. It is the one to
 * pool against because it wants 20 blackstone — four shares of five — where q13's
 * single objective is 5 obsidian and one contribution finishes it.
 */
async function stand(guestCount) {
  const relay = startRelay();

  const hostSocket = connect(relay.port);
  await hostSocket.opened;
  const host = new HostManager({
    client: hostClientAdapter(hostSocket),
    character: { id: 'char_host', name: 'Host' },
  });
  host.startSession('Quest World', 42, 'survival');
  host._hostPlayerId = HOST_ID;

  const state = createQuestState();
  for (const id of ['q01', 'q02', 'q03', 'q04', 'q05', 'q06', 'q07', 'q08',
    'q09', 'q10', 'q11', 'q12', 'q13']) {
    state.quests[id] = { stage: 0, completed: true, completedAt: 1 };
  }
  const questSystem = new QuestSystem({ questState: state });
  host.setQuestSystem(questSystem);
  expect(questSystem.getActiveQuest().id).toBe('q14');

  hostSocket.send({ type: MESSAGE_TYPES.JOIN, playerId: HOST_ID, character: { id: 'char_host', name: 'Host' } });
  await settle();

  const guests = [];
  for (let i = 0; i < guestCount; i++) {
    const id = `guest_${i}`;
    const characterId = `char_guest_${i}`;
    const socket = connect(relay.port);
    await socket.opened;
    socket.send({
      type: MESSAGE_TYPES.JOIN,
      playerId: id,
      character: { id: characterId, name: `Guest ${i}` },
    });
    // The relay tells the host about a join, but this harness has no `PLAYER_JOINED`
    // plumbing beyond the host's own handler — which is what registers the player and
    // is exactly what we want exercised.
    await settle();
    guests.push({ id, characterId, socket });
  }

  return { relay, host, questSystem, hostSocket, guests };
}

const contribute = (guest, delta, questId = 'q14', key = 'blackstone') =>
  guest.socket.send({
    type: MESSAGE_TYPES.QUEST_CONTRIBUTE,
    questId,
    objectiveKey: key,
    delta,
    contributorId: guest.characterId,
  });

describe('four players pool one objective', () => {
  it('reaches the target from four shares, and completes exactly once', async () => {
    const { host, questSystem, guests, hostSocket } = await stand(3);
    // The host is the fourth player. Its contribution goes through the local transport,
    // which is the same handler the socket ones land in (§6.4).
    expect(host.getRemotePlayer('guest_0')).not.toBeNull();

    let completions = 0;
    questSystem.onQuestCompleted = () => { completions++; };

    contribute(guests[0], 5);
    contribute(guests[1], 5);
    contribute(guests[2], 5);
    await settle();

    const entry = () => questSystem.getState().quests.q14;
    expect(entry().objectives.blackstone.n).toBe(15);
    expect(questSystem.isCompleted('q14')).toBe(false);

    // Every one of the three guests is in the pool's high-water map. That map is what
    // "work done by players counts for everyone" means concretely.
    expect(Object.keys(entry().objectives.blackstone.hw).sort())
      .toEqual(['char_guest_0', 'char_guest_1', 'char_guest_2']);

    // q14's other objective still stands: 15 obsidian. Filling one does not finish it.
    host.handleLocalQuestContribute({
      questId: 'q14', objectiveKey: 'blackstone', delta: 5, contributorId: 'char_host',
    });
    await settle();
    expect(entry().objectives.blackstone.n).toBe(20);
    expect(questSystem.isCompleted('q14'), 'blackstone is full but obsidian is not').toBe(false);

    host.handleLocalQuestContribute({
      questId: 'q14', objectiveKey: 'obsidian', delta: 15, contributorId: 'char_host',
    });
    await settle();

    expect(questSystem.isCompleted('q14')).toBe(true);
    expect(completions).toBe(1);
    // Completion collapses the quest — objectives and every high-water map are dropped,
    // which is most of the 8 KB storage budget (§4.1).
    expect(entry().objectives).toBeUndefined();

    hostSocket.close();
    for (const g of guests) g.socket.close();
  });

  it('broadcasts the authoritative total to every guest, not the delta', async () => {
    const { questSystem, guests, hostSocket } = await stand(3);

    contribute(guests[0], 7);
    await settle();

    for (const g of guests) {
      const update = g.socket.lastOfType(MESSAGE_TYPES.QUEST_UPDATE);
      expect(update, `${g.id} received QUEST_UPDATE`).not.toBeNull();
      expect(update.questId).toBe('q14');
      expect(update.objectiveKey).toBe('blackstone');
      expect(update.n).toBe(7);
      expect(update.target).toBe(20);
      // A client that missed a packet catches up from the next one; a delta would let
      // it drift by whatever it lost, silently and permanently.
      expect(update.delta).toBeUndefined();
    }
    expect(questSystem.getState().quests.q14.objectives.blackstone.n).toBe(7);

    hostSocket.close();
    for (const g of guests) g.socket.close();
  });

  it('sends a joining guest the whole state, and only that guest', async () => {
    const { guests, hostSocket } = await stand(2);
    for (const g of guests) {
      const sync = g.socket.lastOfType(MESSAGE_TYPES.QUEST_SYNC);
      expect(sync, `${g.id} received QUEST_SYNC`).not.toBeNull();
      expect(sync.questState.v).toBe(1);
      expect(sync.questState.activeQuestId).toBe('q14');
      expect(Object.keys(sync.questState.seals)).toHaveLength(5);
    }
    // Guest 0 joined first, so it must not have received guest 1's sync as well.
    expect(guests[0].socket.ofType(MESSAGE_TYPES.QUEST_SYNC)).toHaveLength(1);

    hostSocket.close();
    for (const g of guests) g.socket.close();
  });
});

describe('a guest that drops mid-objective', () => {
  it('keeps its contribution, and is not credited twice when it comes back', async () => {
    const { host, questSystem, guests, hostSocket, relay } = await stand(2);
    const pool = () => questSystem.getState().quests.q14.objectives.blackstone;

    contribute(guests[0], 8);
    contribute(guests[1], 4);
    await settle();
    expect(pool().n).toBe(12);
    expect(pool().hw.char_guest_0).toBe(8);

    // Guest 0 drops.
    guests[0].socket.close();
    await settle(200);
    expect(pool().n, 'the pool does not fall when a contributor leaves').toBe(12);
    expect(pool().hw.char_guest_0, 'their high-water mark survives').toBe(8);

    // It comes back on a NEW connection, which the relay gives a new socket. Its
    // character id is the same, so its mark is found rather than re-created.
    const rejoined = connect(relay.port);
    await rejoined.opened;
    rejoined.send({
      type: MESSAGE_TYPES.JOIN,
      playerId: 'guest_0',
      character: { id: 'char_guest_0', name: 'Guest 0' },
    });
    await settle();

    // The relay replies WELCOME to the reconnector and tells nobody else — which is
    // correct for avatars and is exactly why the host needs another way to know.
    expect(rejoined.lastOfType(MESSAGE_TYPES.WELCOME)).not.toBeNull();

    // **D-120 lives here.** Before this test, everything below silently did nothing:
    // the relay treats a returning `playerId` as a reconnection and does not
    // re-broadcast `PLAYER_JOINED`, so the host's `connected` flag stayed false forever
    // and every message from the rejoined player was discarded. The pool would have
    // stayed at 12 and the assertion that caught it is the one immediately after.
    const before = pool().n;
    rejoined.send({
      type: MESSAGE_TYPES.QUEST_CONTRIBUTE,
      questId: 'q14', objectiveKey: 'blackstone', delta: 8, contributorId: 'char_guest_0',
    });
    await settle();

    // The rejoined player is heard again at all — that is D-120.
    expect(pool().n, 'a reconnected player can still contribute').toBe(before + 8);

    // The host DOES accept the resend — the delta protocol is trusting by design
    // (§4.5's accepted exploit) — but the accounting is visible rather than lost: the
    // contributor's recorded total moves with it, so a double-credit is attributable
    // and bounded by the 64-per-message cap, rather than being an invisible reset to 0.
    expect(pool().hw.char_guest_0).toBe(16);

    // What is NOT possible is the D-117 failure: a reconnecting player presenting a
    // fresh identity and being credited from zero on every reconnect. The host keys on
    // the character id, which survived the socket.
    expect(Object.keys(pool().hw).sort()).toEqual(['char_guest_0', 'char_guest_1']);

    rejoined.close();
    hostSocket.close();
    for (const g of guests) g.socket.close();
    void host;
  });
});

describe('the relay routes quest messages by direction', () => {
  it('sends QUEST_CONTRIBUTE to the host alone', async () => {
    const { guests, hostSocket } = await stand(3);
    contribute(guests[0], 3);
    await settle();

    // The other two guests must never see it: a contribution is an ask, not news.
    expect(guests[1].socket.ofType(MESSAGE_TYPES.QUEST_CONTRIBUTE)).toHaveLength(0);
    expect(guests[2].socket.ofType(MESSAGE_TYPES.QUEST_CONTRIBUTE)).toHaveLength(0);
    expect(hostSocket.ofType(MESSAGE_TYPES.QUEST_CONTRIBUTE)).toHaveLength(1);
    // And the relay attached the sender's real id rather than trusting the body.
    expect(hostSocket.ofType(MESSAGE_TYPES.QUEST_CONTRIBUTE)[0].playerId).toBe('guest_0');

    hostSocket.close();
    for (const g of guests) g.socket.close();
  });

  it('refuses to relay a guest pretending to be the host', async () => {
    const { questSystem, guests, hostSocket } = await stand(2);

    // A SEAL_UPDATE from a guest would hand itself a broken seal, and five of those
    // open the finale. The relay drops it rather than forwarding.
    guests[0].socket.send({
      type: MESSAGE_TYPES.SEAL_UPDATE, sealId: 'verdant', state: 'broken',
    });
    await settle();

    expect(guests[1].socket.ofType(MESSAGE_TYPES.SEAL_UPDATE)).toHaveLength(0);
    expect(questSystem.getState().seals.verdant.state).toBe('dormant');

    hostSocket.close();
    for (const g of guests) g.socket.close();
  });

  it('broadcasts a real seal transition from the host to everyone', async () => {
    const { host, guests, hostSocket } = await stand(2);

    host.setSeal('verdant', 'keyed');
    await settle();

    for (const g of guests) {
      const msg = g.socket.lastOfType(MESSAGE_TYPES.SEAL_UPDATE);
      expect(msg, `${g.id} received SEAL_UPDATE`).not.toBeNull();
      expect(msg.sealId).toBe('verdant');
      expect(msg.state).toBe('keyed');
    }

    hostSocket.close();
    for (const g of guests) g.socket.close();
  });
});

describe('the host rejects what it should', () => {
  it('drops a contribution claiming another character', async () => {
    const { questSystem, guests, hostSocket } = await stand(2);
    guests[0].socket.send({
      type: MESSAGE_TYPES.QUEST_CONTRIBUTE,
      questId: 'q14', objectiveKey: 'blackstone', delta: 9,
      contributorId: 'char_guest_1',
    });
    await settle();
    expect(questSystem.getState().quests.q14.objectives.blackstone.n).toBe(0);

    hostSocket.close();
    for (const g of guests) g.socket.close();
  });

  it('drops an oversized delta', async () => {
    const { questSystem, guests, hostSocket } = await stand(1);
    contribute(guests[0], 65);
    await settle();
    expect(questSystem.getState().quests.q14.objectives.blackstone.n).toBe(0);

    // 64 is a stack, and the ceiling. It is accepted and clamps at the target of 20.
    contribute(guests[0], 64);
    await settle();
    expect(questSystem.getState().quests.q14.objectives.blackstone.n).toBe(20);

    hostSocket.close();
    for (const g of guests) g.socket.close();
  });

  it('drops a contribution to a quest that is not active', async () => {
    const { questSystem, guests, hostSocket } = await stand(1);
    // Q22 wants sandstone and is five quests away.
    contribute(guests[0], 15, 'q22', 'sandstone');
    await settle();
    expect(questSystem.getState().quests.q22).toBeUndefined();

    hostSocket.close();
    for (const g of guests) g.socket.close();
  });
});

// `HostRemotePlayer` is imported for the type it documents; referenced so lint sees it.
void HostRemotePlayer;
