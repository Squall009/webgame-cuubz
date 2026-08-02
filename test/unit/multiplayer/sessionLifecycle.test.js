/**
 * Cuubz — when a relay session ends, and who is allowed to see it (D-103)
 *
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * `server/session.js` had exactly one way to end: `_removePlayer` observing the
 * ≥1 → 0 player transition. Every other route into the relay's session map — and `HOST`
 * is one, it registers the session *before* anyone opens `/session/:id` — had no exit at
 * all. A session nobody ever joined was permanent, and `listSessions()` asked only
 * "is it in the map", so it was permanently advertised to every guest as a row that
 * accepts a click and then does nothing. The live relay was still advertising a session
 * abandoned during D-102's verification ten minutes later.
 *
 * The three assertions that matter here are the three ways a session must now end —
 * never-claimed, host-gone-with-others-present, and a deliberate host `LEAVE` — plus the
 * two predicates that decide what a browsing guest is shown. The existing relay suites
 * (`test/integration/sessionDiscovery.test.js`, `multiplayerSync.test.js`) drive real
 * sockets and cover message forwarding; these are timer transitions, so they are unit
 * tests against fake timers rather than a suite that has to wait a real minute.
 *
 * The `wss` and `ws` doubles are deliberately minimal — `SessionManager` touches four
 * things on a socket (`readyState`, `send`, `close`, `on`) and one on the server (`on`,
 * `close`), and a fuller fake would only be a second implementation to keep in step.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SessionManager from '../../../server/session.js';
import { MESSAGE_TYPES } from '../../../shared/protocol.js';

/** A `WebSocketServer` double: captures the one `connection` handler the session wires. */
function fakeWss() {
  return {
    handlers: {},
    on(evt, fn) { this.handlers[evt] = fn; },
    close() { this.closed = true; },
    connect(ws) { this.handlers.connection(ws); return ws; },
  };
}

/** A `ws` double that records what the relay sent it. */
function fakeWs() {
  return {
    readyState: 1,
    sent: [],
    handlers: {},
    send(raw) { this.sent.push(JSON.parse(raw)); },
    close() { this.readyState = 3; },
    on(evt, fn) { this.handlers[evt] = fn; },
    recv(msg) { this.handlers.message(Buffer.from(JSON.stringify(msg))); },
    drop() { this.readyState = 3; this.handlers.close(); },
    types() { return this.sent.map(m => m.type); },
  };
}

const HOST_ID = 'player_host';

function makeSession(overrides = {}) {
  const wss = fakeWss();
  const destroyed = [];
  const session = new SessionManager({
    wss,
    sessionId: 'session_1',
    sessionName: 'Test Session',
    worldSeed: 4242,
    gameMode: 'creative',
    hostId: HOST_ID,
    maxPlayers: 4,
    heartbeatInterval: 120000,
    onSessionEmpty: (id) => destroyed.push(id),
    ...overrides,
  });
  return { session, wss, destroyed };
}

/** Open a socket and send `JOIN` as `playerId`. Returns the socket. */
function join(wss, playerId) {
  const ws = wss.connect(fakeWs());
  ws.recv({ type: MESSAGE_TYPES.JOIN, playerId, character: { name: playerId, color: '#fff' } });
  return ws;
}

describe('relay session lifetime (server/session.js, BUGS.md D-103)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('collects a session whose host never opens its game socket', () => {
    const { session, destroyed } = makeSession({ claimTimeout: 60000 });

    expect(session._hostEverConnected).toBe(false);
    vi.advanceTimersByTime(59000);
    expect(destroyed).toEqual([]);
    vi.advanceTimersByTime(2000);
    expect(destroyed).toEqual(['session_1']);

    session.dispose();
  });

  it('is not advertised, and not joinable, before the host has ever joined', () => {
    const { session } = makeSession();

    // This is the row the live relay was serving: in the map, zero players, no host.
    expect(session.isListable()).toBe(false);
    expect(session.isJoinable()).toBe(false);
    // …while `canPlayerJoin()` — the check `onJoinRequest` used to make on its own —
    // still says yes, because capacity was never the question.
    expect(session.canPlayerJoin()).toBe(true);

    session.dispose();
  });

  it('cancels the never-claimed reaper once the host arrives, and is then listable', () => {
    const { session, wss, destroyed } = makeSession({ claimTimeout: 60000 });

    join(wss, HOST_ID);
    expect(session._hostEverConnected).toBe(true);
    expect(session.hasHost()).toBe(true);
    expect(session.isListable()).toBe(true);
    expect(session.isJoinable()).toBe(true);
    expect(session.getSessionInfo().hasHost).toBe(true);

    vi.advanceTimersByTime(120000);
    expect(destroyed).toEqual([]);

    session.dispose();
  });

  it('a full session stays listed but is not joinable', () => {
    const { session, wss } = makeSession({ maxPlayers: 2 });
    join(wss, HOST_ID);
    join(wss, 'player_2');

    expect(session.isListable()).toBe(true);
    expect(session.isJoinable()).toBe(false);

    session.dispose();
  });

  it('destroys the session at once when the host says LEAVE and nobody is left', () => {
    const { session, wss, destroyed } = makeSession();
    const hostWs = join(wss, HOST_ID);

    hostWs.recv({ type: MESSAGE_TYPES.LEAVE });

    // No 30 s grace: the host did not blink, it left. Holding the session for half a
    // minute is what put a dead row in front of the next guest to open the lobby.
    expect(destroyed).toEqual(['session_1']);
    expect(session.isListable()).toBe(false);

    session.dispose();
  });

  it('still grants the 30 s grace when the host socket merely drops', () => {
    const { session, wss, destroyed } = makeSession();
    const hostWs = join(wss, HOST_ID);

    hostWs.drop();
    expect(destroyed).toEqual([]);
    // Listable through the grace — this is the window a host's page refresh reclaims in.
    expect(session.isListable()).toBe(true);
    expect(session.hasHost()).toBe(false);

    vi.advanceTimersByTime(31000);
    expect(destroyed).toEqual(['session_1']);

    session.dispose();
  });

  it('a reclaiming host inside the grace window keeps the session alive', () => {
    const { session, wss, destroyed } = makeSession();
    join(wss, HOST_ID).drop();

    vi.advanceTimersByTime(10000);
    join(wss, HOST_ID); // same playerId — this is what `setPlayerId()` buys the client
    vi.advanceTimersByTime(60000);

    expect(destroyed).toEqual([]);
    expect(session.hasHost()).toBe(true);
    expect(session.isJoinable()).toBe(true);

    session.dispose();
  });

  it('counts down a hostless session even while guests are still connected', () => {
    const { session, wss, destroyed } = makeSession({ hostGrace: 30000 });
    const hostWs = join(wss, HOST_ID);
    join(wss, 'player_2');

    hostWs.drop();
    // One guest remains, so the empty-session path never fires. Before D-103 that was
    // the end of it and the session lived for as long as the guest held its socket —
    // relaying nothing, because a relay with no host has no world to stream.
    expect(session.players.size).toBe(1);
    expect(session.hasHost()).toBe(false);
    expect(session.isListable()).toBe(true);
    expect(session.getSessionInfo().hasHost).toBe(false);

    vi.advanceTimersByTime(31000);
    expect(destroyed).toEqual(['session_1']);

    session.dispose();
  });

  it('a guest leaving is not a host leaving', () => {
    const { session, wss, destroyed } = makeSession();
    join(wss, HOST_ID);
    const guestWs = join(wss, 'player_2');

    guestWs.recv({ type: MESSAGE_TYPES.LEAVE });
    vi.advanceTimersByTime(120000);

    expect(destroyed).toEqual([]);
    expect(session.hasHost()).toBe(true);

    session.dispose();
  });

  it('dispose() cancels every reaper, so a collected session cannot fire one late', () => {
    const { session, destroyed } = makeSession({ claimTimeout: 60000 });

    session.dispose();
    vi.advanceTimersByTime(600000);

    expect(destroyed).toEqual([]);
    expect(session._claimTimer).toBe(null);
    expect(session._hostGraceTimer).toBe(null);
  });
});
