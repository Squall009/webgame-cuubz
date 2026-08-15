/**
 * Cuubz — the quest wire path, both ends (S0)
 *
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * `QUEST_UPDATE` was in `shared/protocol.js` and relayed by `server/session.js` from the
 * day both were written, and it could not travel in either direction:
 *
 *   • `HostManager._setupGameHandlers()` registered seven types and not that one, so
 *     `handleQuestUpdate()` — which existed and was correct enough to call — had **no
 *     caller anywhere in `src/`**.
 *   • `MultiplayerClient._setupGameSessionHandlers()` omitted it from its forwarded
 *     events, so even the host's own broadcast was dropped by every client including
 *     the sender.
 *
 * Neither is a crash. A handler registered for a type nobody forwards is silent, and a
 * message forwarded to a handler that was never registered is silent. That is why this
 * test asserts the **registration** and the **forwarding**, not just the behaviour of
 * the functions behind them: the functions were always fine.
 *
 * The transport is a stub rather than a real relay — the four-client integration case
 * lives in `test/integration/questSync.test.js`. What is proved here is routing.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../helpers/paths.js';
import { MESSAGE_TYPES } from '../../../shared/protocol.js';
import { HostManager, HostRemotePlayer } from '../../../src/multiplayer/Host.js';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/**
 * A stand-in for `MultiplayerClient` that records handler registrations and broadcasts.
 * `HostManager` reaches the socket through `_client._gameSessionConn.send`, so that is
 * what this fakes.
 */
function makeFakeClient() {
  const handlers = new Map();
  const sent = [];
  return {
    isGameSessionConnected: true,
    _gameSessionConn: { send: (msg) => sent.push(msg) },
    onGame(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    // `startSession` registers two matchmaking listeners and then asks to host. None of
    // that is what this file is about, so they are accepted and dropped.
    onMatchmaking() {},
    connectMatchmaking() {},
    hostSession() {},
    /** Deliver a message as though the relay had forwarded it. */
    deliver(type, data) {
      for (const fn of handlers.get(type) || []) fn(data);
    },
    registeredTypes: () => [...handlers.keys()],
    sent,
    connect() {},
    disconnect() {},
  };
}

function makeHostWithPlayer(characterId = 'char_guest') {
  const client = makeFakeClient();
  const host = new HostManager({ client, character: { id: 'char_host', name: 'Host' } });
  host.startSession('Test World', 42, 'survival');
  const player = new HostRemotePlayer(
    'guest_1',
    { id: characterId, name: 'Guest', color: '#00ff00' },
    { x: 0, y: 20, z: 0 }
  );
  host._players.set('guest_1', player);
  return { host, client, player };
}

describe('the host registers a handler for QUEST_CONTRIBUTE', () => {
  it('registers it — the omission that made the whole quest path dead', () => {
    const { client } = makeHostWithPlayer();
    expect(client.registeredTypes()).toContain(MESSAGE_TYPES.QUEST_CONTRIBUTE);
  });

  it('registers BOSS_HIT too, so S6 is a handler body and not a re-plumbing job', () => {
    const { client } = makeHostWithPlayer();
    expect(client.registeredTypes()).toContain(MESSAGE_TYPES.BOSS_HIT);
  });

  it('a delivered QUEST_CONTRIBUTE actually reaches the pool', () => {
    const { host, client } = makeHostWithPlayer();
    host.getQuestState().quests.q01 = {
      stage: 1, completed: false,
      objectives: { wood_log: { n: 0, target: 20, hw: {} } },
    };

    client.deliver(MESSAGE_TYPES.QUEST_CONTRIBUTE, {
      playerId: 'guest_1',
      questId: 'q01',
      objectiveKey: 'wood_log',
      delta: 7,
      contributorId: 'char_guest',
    });

    expect(host.getQuestState().quests.q01.objectives.wood_log.n).toBe(7);
  });

  it('broadcasts the authoritative total, not the delta', () => {
    const { host, client } = makeHostWithPlayer();
    host.getQuestState().quests.q01 = {
      stage: 1, completed: false,
      objectives: { wood_log: { n: 13, target: 20, hw: {} } },
    };

    client.sent.length = 0;
    client.deliver(MESSAGE_TYPES.QUEST_CONTRIBUTE, {
      playerId: 'guest_1', questId: 'q01', objectiveKey: 'wood_log',
      delta: 7, contributorId: 'char_guest',
    });

    const update = client.sent.find((m) => m.type === MESSAGE_TYPES.QUEST_UPDATE);
    expect(update).toBeDefined();
    // A client that missed a packet has to be able to catch up from any single message,
    // so what goes out is the state (`n`/`target`), never the change.
    expect(update.n).toBe(20);
    expect(update.target).toBe(20);
    expect(update.complete).toBe(true);
    expect(update.delta).toBeUndefined();
  });

  it('rejects a contribution that claims another character', () => {
    const { host, client } = makeHostWithPlayer('char_guest');
    host.getQuestState().quests.q01 = {
      stage: 1, completed: false,
      objectives: { wood_log: { n: 0, target: 20, hw: {} } },
    };

    client.deliver(MESSAGE_TYPES.QUEST_CONTRIBUTE, {
      playerId: 'guest_1', questId: 'q01', objectiveKey: 'wood_log',
      delta: 7, contributorId: 'char_somebody_else',
    });

    expect(host.getQuestState().quests.q01.objectives.wood_log.n).toBe(0);
  });
});

describe('the host sends QUEST_SYNC to a joining player', () => {
  it('sends the full state, addressed to the joiner alone', () => {
    const client = makeFakeClient();
    const host = new HostManager({ client, character: { id: 'char_host', name: 'Host' } });
    host.startSession('Test World', 42, 'survival');
    host._hostPlayerId = 'host_1';

    client.sent.length = 0;
    client.deliver(MESSAGE_TYPES.PLAYER_JOINED, {
      playerId: 'guest_1',
      character: { id: 'char_guest', name: 'Guest' },
      position: { x: 0, y: 20, z: 0 },
    });

    const sync = client.sent.find((m) => m.type === MESSAGE_TYPES.QUEST_SYNC);
    expect(sync).toBeDefined();
    expect(sync.targetPlayers).toEqual(['guest_1']);
    expect(sync.questState.v).toBe(1);
    expect(Object.keys(sync.questState.seals)).toHaveLength(5);
  });
});

describe('seal transitions broadcast, and only advance', () => {
  it('broadcasts SEAL_UPDATE on a real transition', () => {
    const { host, client } = makeHostWithPlayer();
    client.sent.length = 0;

    expect(host.setSeal('verdant', 'keyed')).toBe(true);
    const msg = client.sent.find((m) => m.type === MESSAGE_TYPES.SEAL_UPDATE);
    expect(msg.sealId).toBe('verdant');
    expect(msg.state).toBe('keyed');
  });

  it('does not broadcast a transition it refused', () => {
    const { host, client } = makeHostWithPlayer();
    host.setSeal('verdant', 'broken');
    client.sent.length = 0;

    expect(host.setSeal('verdant', 'primed')).toBe(false);
    expect(client.sent.filter((m) => m.type === MESSAGE_TYPES.SEAL_UPDATE)).toHaveLength(0);
  });

  it('stamps brokenAt and records contributors when a seal breaks', () => {
    const { host } = makeHostWithPlayer();
    host.setSeal('verdant', 'primed');
    host.setSeal('verdant', 'contested');
    host.setSeal('verdant', 'broken', ['char_a', 'char_b']);

    const seal = host.getQuestState().seals.verdant;
    expect(seal.brokenBy).toEqual(['char_a', 'char_b']);
    expect(typeof seal.brokenAt).toBe('number');
  });
});

describe('the client forwards every quest, seal and boss type', () => {
  // Structural, over source text, for the same reason `protocol.test.js` is: the
  // forwarding list is a whitelist, and a type missing from it fails silently on every
  // client including the sender. There is no runtime signal to assert instead.
  const src = read('src/multiplayer/Client.js');
  const forwarded = src.slice(
    src.indexOf('const gameEvents = ['),
    src.indexOf(']', src.indexOf('const gameEvents = ['))
  );

  const REQUIRED = [
    'QUEST_UPDATE', 'QUEST_SYNC', 'QUEST_CONTRIBUTE', 'SEAL_UPDATE',
    'BOSS_SPAWN', 'BOSS_STATE', 'BOSS_HIT', 'BOSS_DEFEATED', 'BOSS_DESPAWN',
  ];

  for (const type of REQUIRED) {
    it(`forwards ${type}`, () => {
      expect(forwarded).toContain(`MESSAGE_TYPES.${type}`);
    });
  }
});

describe('the relay has a case for every new type', () => {
  const src = read('server/session.js');
  const REQUIRED = [
    'QUEST_UPDATE', 'QUEST_SYNC', 'QUEST_CONTRIBUTE', 'SEAL_UPDATE',
    'BOSS_SPAWN', 'BOSS_STATE', 'BOSS_HIT', 'BOSS_DEFEATED', 'BOSS_DESPAWN',
  ];

  for (const type of REQUIRED) {
    it(`relays ${type}`, () => {
      // The relay's switch is explicit — an unlisted type hits `default` and is logged
      // as unknown, which is a message that arrives nowhere.
      expect(src).toContain(`case MESSAGE_TYPES.${type}:`);
    });
  }
});

describe('character.id travels on the wire (§4.5 verification item)', () => {
  it('initPlayer sends the character id with the join', () => {
    // This was S0's one stated verification item and it came back **negative**:
    // `joinGame` was called with `{ name, color }` and nothing else. Pooled high-water
    // marks key on the character id because `playerId` is per-connection, so without
    // this a reconnecting player is credited a second time for everything still in
    // their inventory — a silent double-count, not a crash.
    const src = read('src/core/init/initPlayer.js');
    expect(src).toMatch(/id:\s*charData\.id/);
  });
});
