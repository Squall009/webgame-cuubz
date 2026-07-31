/**
 * Cuubz — session UI, against the shipped modules (PR 31, BUGS.md D-47)
 *
 * ─── WHAT THIS FILE USED TO BE — 155 vacuous assertions ────────────────────
 *
 * 730 lines that imported **nothing from `src/`**. It claimed to test "SessionManager,
 * connection status, session list rendering, player list rendering, host form validation,
 * tab switching" and it did — against reimplementations of all six, inline beside a
 * hand-rolled `MockElement`: two private copies of `SessionManager` (`TestSessionManager`,
 * whose own comment read "Since it's in a closure, we'll recreate it here", and
 * `LifecycleTestManager`), plus copies of `getHealthColor`, `escapeHtml`,
 * `validateSessionName`, `validateWorldSelection`, `switchTab`, `formatSeed` and the
 * connection-status table. **Green that could not go red when the shipped code broke.**
 * `test_relayUrl.js` had the identical shape, its copy drifted into asserting a relay URL
 * scheme the game does not implement, and it stayed green for it — `BUGS.md` **D-45**.
 *
 * ─── WHAT IT IS NOW — 171 assertions, every one through a real module ──────
 *
 *   lifecycle, relay events, rejoin record   src/multiplayer/SessionManager.js
 *   host form validation                     src/multiplayer/SessionHosting.js
 *   connection status                        src/ui/hud/ConnectionHUD.js
 *   in-game roster rendering                 src/ui/hud/PlayerListOverlay.js
 *   session list, tabs, error banner         src/ui/screens/LobbyScreen.js
 *
 * The DOM is the **shipped markup** — `SESSION_HUD_TEMPLATE` and `LOBBY_SCREEN_TEMPLATE`,
 * the strings `mountTemplates()` puts on the page — not a fixture written to match.
 *
 * `getHealthColor` and `escapeHtml` are **not** re-tested here: both are exported by name
 * from `src/multiplayer/PlayerListHUD.js` and already covered at their boundaries by
 * `test/unit/multiplayer/playerListHUD.test.js` (131 assertions), so their two private
 * copies are deleted rather than re-pointed. The health-bar group below drives
 * `PlayerListOverlay`'s own inline threshold through rendered output — different code.
 *
 * ─── WHY `new JSDOM(...)` AND NOT THE `@vitest-environment jsdom` PRAGMA ────
 *
 * `vitest.config.js` note 1: `src/` carries 28 `typeof window` / `typeof document` guards
 * that are false under bare Node. The pragma flips all of them for every module this file
 * transitively imports — `SessionManager` imports `Client.js`, which picks its socket off
 * `typeof WebSocket` / `typeof window` (`Client.js:646-648`) and registers a
 * `visibilitychange` listener under `typeof document` (`Client.js:414`). So this file builds
 * its own `JSDOM` and assigns **only** `document` and `localStorage`, as
 * `test/unit/ui/createEntity.test.js` does, restoring both in `afterAll`. No `window`, no
 * `WebSocket`, no `navigator`; and no `MultiplayerClient` is ever constructed — `init()`
 * would open a real socket, so the tests inject a fake client at the socket boundary and
 * call the real `_wireClientEvents()`.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { SessionManager } from '../../../src/multiplayer/SessionManager.js';
import { UIManager } from '../../../src/ui/UIManager.js';
import { LobbyScreen } from '../../../src/ui/screens/LobbyScreen.js';
import { readLastSession } from '../../../src/util/StorageHelper.js';
import { SESSION_HUD_TEMPLATE } from '../../../src/ui/templates/sessionHud.js';
import { LOBBY_SCREEN_TEMPLATE } from '../../../src/ui/templates/lobbyScreen.js';

// Counting, so `scripts/count-assertions.js` can read this file. Every assertion goes
// through `record`, which increments only AFTER the matcher returns and rethrows on
// failure — a failing assertion is never counted, so the printed line cannot overstate.
let passed = 0, failed = 0;
function record(fn) { try { fn(); passed++; } catch (e) { failed++; throw e; } }
function eq(a, b, why) { record(() => expect(a, why).toBe(b)); }
function is(a, why) { record(() => expect(a, why).toBe(true)); }
function nope(a, why) { record(() => expect(a, why).toBe(false)); }
function has(hay, needle, why) { record(() => expect(hay, why).toContain(needle)); }

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
const priorDocument = globalThis.document, priorStorage = globalThis.localStorage;
const setStorage = (v) => Object.defineProperty(globalThis, 'localStorage',
  { value: v, configurable: true, writable: true });
globalThis.document = dom.window.document;
// `StorageHelper` reads `globalThis.localStorage` by design (see its header), which is what
// lets the rejoin record `saveSessionRecord()` writes be read back here.
setStorage(dom.window.localStorage);
afterAll(() => {
  globalThis.document = priorDocument; setStorage(priorStorage);
  console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);
});

const el = (id) => document.getElementById(id);
const hidden = (id) => el(id).classList.contains('hidden');
const active = (id) => el(id).classList.contains('active');
const rows = (id, sel) => el(id).querySelectorAll(sel);
const text = (node, sel) => node.querySelector(sel).textContent;
const statusText = () => text(document, '#connection-status .status-text');
const hudText = () => text(document, '#connection-hud .status-text');
const banner = () => el('host-error').textContent;

// Stand-ins for the two managers. Neither is under test — `createEntity.test.js` covers the
// real ones — and both are reached through `deps`' live getters, as `main.js` does.
const fakeCharacterManager = () => ({
  characters: [{ id: 'c1', name: 'Steve', color: '#4CAF50' }], selectedId: null,
  getAllCharacters() { return this.characters; }, async selectCharacter(id) { this.selectedId = id; },
  getCharacter(id) { return this.characters.find(c => c.id === id) || null; },
  getSelectedCharacter() { return this.getCharacter(this.selectedId); },
});
const fakeWorldManager = () => ({
  worlds: [{ id: 'w1', name: 'Home', seed: 12345 }], selectedId: null,
  getAllWorlds() { return this.worlds; }, async selectWorld(id) { this.selectedId = id; },
  getWorld(id) { return this.worlds.find(w => w.id === id) || null; },
  getSelectedWorld() { return this.getWorld(this.selectedId); },
});
/** The relay, stubbed at the socket boundary — `MultiplayerClient` is not under test. */
const fakeClient = () => {
  const bound = {};
  return {
    browsed: 0, joined: null, left: false, disposed: false, connected: false,
    on(e, fn) { (bound[e] = bound[e] || []).push(fn); },
    emit(e, d) { (bound[e] || []).forEach(fn => fn(d)); },
    connectMatchmaking() { this.connected = true; }, browseSessions() { this.browsed++; },
    async joinSession(id) { this.joined = id; }, async hostSession(o) { this.hosted = o; },
    leaveSession() { this.left = true; }, dispose() { this.disposed = true; },
  };
};

/** A fresh page and a fresh object graph, wired the way `Bootstrap.js` wires it. */
function harness() {
  document.body.innerHTML = SESSION_HUD_TEMPLATE + LOBBY_SCREEN_TEMPLATE;
  globalThis.localStorage.clear();
  const log = [], started = [];
  let repaints = 0;
  const deps = {
    characterManager: fakeCharacterManager(), worldManager: fakeWorldManager(),
    sessionManager: null, ui: null, log: (m) => log.push(m),
    startGame: (mode) => started.push(mode), updateRejoinPanel: () => { repaints++; },
  };
  const ui = new UIManager(deps), lobby = new LobbyScreen(ui);
  ui.registerScreens({ character: null, world: null, lobby, settings: null });
  deps.ui = ui; deps.sessionManager = new SessionManager(deps);
  return { deps, ui, lobby, manager: deps.sessionManager, log, started, repaints: () => repaints };
}
/** `h.manager` with the fake relay bound through the real `_wireClientEvents()`. */
function connected(h) {
  h.manager.client = fakeClient(); h.manager._wireClientEvents();
  return h.manager.client;
}
/** Fill the shipped host form. The selects are populated by the real `LobbyScreen`
 *  methods, so their options are the ones the game builds. */
function fillHostForm(h, { name = 'My Session', character = 'c1', world = 'w1', mode = 'creative' } = {}) {
  h.lobby.populateHostCharacterSelect(); h.lobby.populateHostWorldSelect();
  el('host-session-name').value = name; el('host-character-select').value = character;
  el('host-world-select').value = world; el('host-mode-select').value = mode;
}

describe('SessionManager (src/multiplayer/SessionManager.js)', () => {
  it('constructs with empty session state', () => {
    const { manager } = harness();
    eq(manager.client, null, 'client'); eq(manager.sessions.length, 0, 'sessions');
    eq(manager.currentSessionId, null, 'currentSessionId'); eq(manager.players.length, 0, 'players');
    eq(manager.hostingSessionId, null, 'hostingSessionId'); eq(manager._gameMode, null, '_gameMode');
    eq(manager._sessionName, null, '_sessionName'); eq(manager._sessionSeed, null, '_sessionSeed');
  });
  it('joinSession records the browsed row, ignores a missing id, drives the HUD (D-43)', async () => {
    const h = harness();
    await h.manager.joinSession('sess-1', { mode: 'creative', name: 'Deep Blue', seed: 7 });
    eq(h.manager.currentSessionId, 'sess-1', 'currentSessionId');
    eq(h.manager._gameMode, 'creative', 'mode comes from the browsed row, not a default');
    eq(h.manager._sessionName, 'Deep Blue', 'name'); eq(h.manager._sessionSeed, 7, 'seed');
    eq(statusText(), 'Connected', 'offline join reports connected');
    await h.manager.joinSession(null); eq(h.manager.currentSessionId, 'sess-1', 'null join is a no-op');
    await h.manager.joinSession(''); eq(h.manager.currentSessionId, 'sess-1', 'empty id is a no-op');
  });
  it('leaveSession clears the session, the roster and both overlays', async () => {
    const h = harness();
    const client = connected(h);
    await h.manager.joinSession('sess-1', { mode: 'creative', name: 'X', seed: 7 });
    h.manager.hostingSessionId = 'host-1';
    client.emit('PLAYER_JOINED', { playerId: 'p1' });
    h.manager.leaveSession();
    is(client.left, 'the relay was told'); eq(h.manager.currentSessionId, null, 'currentSessionId');
    eq(h.manager.hostingSessionId, null, 'hostingSessionId'); eq(h.manager.players.length, 0, 'players');
    eq(h.manager._gameMode, null, '_gameMode'); eq(h.manager._sessionName, null, '_sessionName');
    eq(h.manager._sessionSeed, null, '_sessionSeed'); eq(statusText(), 'Disconnected', 'status');
    is(hidden('player-list-overlay'), 'roster hidden'); is(hidden('connection-hud'), 'indicator hidden');
  });
  it('browseSessions delegates online, renders empty offline, and dispose releases', () => {
    const h = harness();
    h.manager.browseSessions();
    nope(hidden('no-sessions-msg'), 'offline browse shows the empty message');
    const client = connected(h);
    eq(client.browsed, 0, 'wiring alone does not browse');
    h.manager.browseSessions(); eq(client.browsed, 1, 'online browse goes to the relay');
    h.manager.dispose();
    is(client.disposed, 'client disposed'); eq(h.manager.client, null, 'client reference dropped');
  });
});
describe('SessionManager relay events (the real _wireClientEvents)', () => {
  it('HOST_CREATED records the session, writes the rejoin record, repaints the panel', () => {
    const h = harness(), client = connected(h);
    Object.assign(h.manager, { _gameMode: 'creative', _sessionName: 'Quarry', _sessionSeed: 99 });
    client.emit('HOST_CREATED', { sessionId: 'S1', mode: 'survival', name: 'echoed' });
    eq(h.manager.hostingSessionId, 'S1', 'hostingSessionId');
    eq(h.manager._gameMode, 'creative', 'the relay echo must not overwrite what hosting recorded');
    eq(h.manager._sessionName, 'Quarry', 'name unchanged by the echo');
    eq(statusText(), 'Connected', 'status'); eq(h.repaints(), 1, 'rejoin panel repainted once');
    const rec = readLastSession();
    eq(rec.sessionId, 'S1', 'record sessionId'); eq(rec.mode, 'creative', 'record mode (D-43)');
    eq(rec.seed, 99, 'record seed'); is(rec.isHost, 'record isHost');
  });
  it('JOIN_ACCEPTED keeps the mode the browse row supplied (D-43)', async () => {
    const h = harness();
    const client = connected(h);
    await h.manager.joinSession('S2', { mode: 'creative', name: 'Quarry', seed: 5 });
    eq(client.joined, 'S2', 'relay asked to join');
    eq(statusText(), 'Connecting...', 'status while the join is in flight');
    client.emit('JOIN_ACCEPTED', { sessionId: 'S2' });
    eq(h.manager.currentSessionId, 'S2', 'currentSessionId'); eq(statusText(), 'Connected', 'status');
    const rec = readLastSession();
    eq(rec.mode, 'creative', 'JOIN_ACCEPTED carries no mode; the browsed row is the source');
    eq(rec.seed, 5, 'record seed'); nope(rec.isHost, 'record isHost');
  });
  it('JOIN_REJECTED reports the reason in the host error banner', () => {
    const h = harness();
    const client = connected(h);
    client.emit('JOIN_REJECTED', { reason: 'Session full' });
    eq(banner(), 'Join failed: Session full', 'banner text'); nope(hidden('host-error'), 'visible');
    client.emit('JOIN_REJECTED', {});
    eq(banner(), 'Join failed: Unknown error', 'a missing reason has a default');
  });
  it('PLAYER_JOINED / PLAYER_LEFT maintain the roster and repaint the overlay', () => {
    const h = harness();
    const client = connected(h);
    client.emit('PLAYER_JOINED', { playerId: 'p1', character: { name: 'Steve', color: '#FF5733' }, health: 85 });
    client.emit('PLAYER_JOINED', { playerId: 'p2' });
    eq(h.manager.players.length, 2, 'two in the roster');
    eq(h.manager.players[0].name, 'Steve', 'payload name'); eq(h.manager.players[0].health, 85, 'payload health');
    eq(h.manager.players[1].name, 'Player', 'default name'); eq(h.manager.players[1].health, 100, 'default health');
    eq(h.manager.players[1].color, '#888888', 'default colour'); eq(el('player-count').textContent, '2', 'overlay count');
    client.emit('PLAYER_LEFT', { playerId: 'p1' });
    eq(h.manager.players.length, 1, 'one left'); eq(h.manager.players[0].id, 'p2', 'the right one');
    eq(el('player-count').textContent, '1', 'overlay count follows');
  });
  it('stateChange maps every client state onto both connection indicators', () => {
    const h = harness();
    const client = connected(h);
    [['connecting', 'Connecting...'], ['connected', 'Connected'],
      ['reconnecting', 'Reconnecting...'], ['disconnected', 'Disconnected']].forEach(([s, t]) => {
      client.emit('stateChange', { to: s });
      eq(statusText(), t, `lobby text: ${s}`); eq(hudText(), t, `in-game text: ${s}`);
      eq(el('connection-status').className, `connection-status ${s}`, `lobby class: ${s}`);
      eq(el('connection-hud').className, `connection-hud ${s}`, `in-game class: ${s}`);
    });
    client.emit('stateChange', { to: 'no-such-state' });
    eq(statusText(), 'Disconnected', 'an unmapped state falls back to disconnected');
    client.emit('stateChange', { to: 'connected' }); client.emit('disconnect', {});
    eq(statusText(), 'Disconnected', 'a disconnect event drops the indicator');
  });
});
describe('startHosting — host form validation (src/multiplayer/SessionHosting.js)', () => {
  it('refuses an empty, whitespace-only or over-long session name', async () => {
    const h = harness();
    fillHostForm(h, { name: '' }); await h.manager.startHosting();
    eq(banner(), 'Please enter a session name.', 'empty name');
    eq(h.manager.hostingSessionId, null, 'nothing was hosted');
    fillHostForm(h, { name: '   ' }); await h.manager.startHosting();
    eq(banner(), 'Please enter a session name.', 'whitespace-only trims to empty');
    fillHostForm(h, { name: 'a'.repeat(32) }); await h.manager.startHosting();
    nope(banner() === 'Session name must be 32 characters or less.', '32 characters is accepted');
    fillHostForm(h, { name: 'a'.repeat(33) }); await h.manager.startHosting();
    eq(banner(), 'Session name must be 32 characters or less.', '33 characters is refused');
  });
  it('refuses a missing or stale character or world selection', async () => {
    const h = harness();
    h.deps.characterManager.characters = [];
    fillHostForm(h, { character: '' }); await h.manager.startHosting();
    eq(banner(), 'Please select or create a character to play as.', 'no character');
    const h2 = harness();
    h2.deps.worldManager.worlds = [];
    fillHostForm(h2, { world: '' }); await h2.manager.startHosting();
    eq(banner(), 'Please select or create a world to host.', 'no world');
    // The options are still on the page but the managers have forgotten them — a delete
    const h3 = harness();
    fillHostForm(h3); h3.deps.characterManager.characters = []; await h3.manager.startHosting();
    eq(banner(), 'Selected character not found.', 'stale character id');
    const h4 = harness();
    fillHostForm(h4); h4.deps.worldManager.worlds = []; await h4.manager.startHosting();
    eq(banner(), 'Selected world not found.', 'stale world id');
    eq(h4.manager.hostingSessionId, null, 'nothing was hosted');
  });
  it('records mode, name and seed from the form at host time (D-43)', async () => {
    const h = harness();
    fillHostForm(h, { name: '  Quarry  ', mode: 'creative' });
    await h.manager.startHosting();
    is(hidden('host-error'), 'the banner was cleared');
    eq(h.manager._sessionName, 'Quarry', 'name is trimmed');
    eq(h.manager._gameMode, 'creative', 'mode is read from the form, not defaulted');
    eq(h.manager._sessionSeed, 12345, "seed is the selected world's");
    eq(h.deps.characterManager.selectedId, 'c1', 'character selected'); eq(h.deps.worldManager.selectedId, 'w1', 'world selected');
    eq(statusText(), 'Connected', 'offline hosting reports connected');
    eq(h.started.length, 1, 'started once'); eq(h.started[0], 'creative', "in the form's mode");
    h.manager.saveSessionRecord(); // and the record that survives a reload agrees
    const rec = readLastSession();
    eq(rec.mode, 'creative', 'rejoin record mode'); eq(rec.name, 'Quarry', 'rejoin record name');
    eq(rec.seed, 12345, 'rejoin record seed'); is(rec.isHost, 'rejoin record isHost');
  });
});
describe('LobbyScreen (src/ui/screens/LobbyScreen.js)', () => {
  it('switchTab moves the active class and both panels together', () => {
    const h = harness();
    const client = connected(h);
    h.lobby.switchTab('host');
    is(active('tab-host'), 'host tab active'); nope(active('tab-browse'), 'browse tab inactive');
    nope(hidden('host-panel'), 'host panel shown'); is(hidden('browse-panel'), 'browse panel hidden');
    eq(client.browsed, 0, 'the host tab does not refresh the session list');
    h.lobby.switchTab('browse');
    is(active('tab-browse'), 'browse tab active'); nope(active('tab-host'), 'host tab inactive');
    nope(hidden('browse-panel'), 'browse panel shown'); is(hidden('host-panel'), 'host panel hidden');
    eq(client.browsed, 1, 'the browse tab refreshes the session list');
  });
  it('renderSessionList draws a row per session and the empty message for none', () => {
    const h = harness();
    h.lobby.renderSessionList([
      { sessionId: 'a', name: 'Test World', mode: 'survival', seed: 42, players: 2, maxPlayers: 4 },
      { sessionId: 'b', name: 'Sandbox', mode: 'creative', players: 1, maxPlayers: 4 },
      { sessionId: 'c', name: 'Bare' },
    ]);
    const r = rows('session-list', '.session-item');
    eq(r.length, 3, 'one row per session'); is(hidden('no-sessions-msg'), 'empty message hidden');
    eq(text(r[0], '.session-name'), 'Test World', 'name');
    eq(text(r[0], '.session-details').trim(), 'Survival · Seed: 42', 'details'); has(text(r[0], '.session-players'), '2/4', 'count');
    eq(text(r[1], '.session-details').trim(), 'Creative ·', 'no seed, no seed text');
    eq(text(r[2], '.session-details').trim(), 'Survival ·', 'mode defaults to survival'); has(text(r[2], '.session-players'), '0/4', 'defaults 0/4');
    h.lobby.renderSessionList([]);
    eq(rows('session-list', '.session-item').length, 0, 'rows cleared'); nope(hidden('no-sessions-msg'), 'empty shown');
    h.lobby.renderSessionList(null); nope(hidden('no-sessions-msg'), 'a null list is the empty list');
  });
  it('renderSessionList marks a full session unclickable and escapes the name', () => {
    const h = harness();
    h.lobby.renderSessionList([{ sessionId: 'a', name: '<img src=x onerror=alert(1)>', players: 4, maxPlayers: 4 }]);
    const row = el('session-list').querySelector('.session-item');
    has(text(row, '.session-players'), 'Full', 'shows Full');
    eq(row.style.opacity, '0.5', 'dimmed'); eq(row.style.cursor, 'not-allowed', 'not clickable');
    eq(row.querySelectorAll('img').length, 0, 'the name was escaped, not parsed as markup');
    eq(text(row, '.session-name'), '<img src=x onerror=alert(1)>', 'name round-trips');
  });
  it('clicking a joinable row carries the session identity into joinSession (D-43)', async () => {
    const h = harness();
    const client = connected(h);
    h.lobby.populateBrowseCharacterSelect();
    h.lobby.renderSessionList([
      { sessionId: 'S9', name: 'Quarry', mode: 'creative', seed: 4242, players: 1, maxPlayers: 4 },
    ]);
    const row = el('session-list').querySelector('.session-item');
    eq(row.style.opacity, '', 'a joinable row is not dimmed');
    row.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    eq(client.joined, 'S9', 'the relay was asked to join');
    eq(h.manager._gameMode, 'creative', 'row mode'); eq(h.manager._sessionName, 'Quarry', 'row name');
    eq(h.manager._sessionSeed, 4242, 'row seed');
    eq(h.deps.characterManager.selectedId, 'c1', 'browse character selected'); eq(h.deps.worldManager.worlds.length, 2, 'temp world pushed');
    eq(h.deps.worldManager.getSelectedWorld().seed, 4242, "the temp world carries the host's seed");
    eq(h.started[0], 'creative', "the game started in the row's mode");
  });
  it('showHostError / hideHostError drive the banner', () => {
    const h = harness();
    is(hidden('host-error'), 'starts hidden');
    h.lobby.showHostError('Test error message');
    eq(banner(), 'Test error message', 'text set'); nope(hidden('host-error'), 'shown');
    h.lobby.showHostError('Different error'); eq(banner(), 'Different error', 'text replaced');
    h.lobby.hideHostError(); is(hidden('host-error'), 'hidden again');
  });
});
describe('PlayerListOverlay (src/ui/hud/PlayerListOverlay.js)', () => {
  it('draws one row per player, unhides the overlay and updates the count', () => {
    const h = harness();
    is(hidden('player-list-overlay'), 'starts hidden');
    h.ui.playerList.render([
      { id: 'p1', name: 'Steve', color: '#FF5733', health: 85, position: { x: 1.4, y: 20.6, z: -3.5 } },
      { id: 'p2', name: '<b>Alex</b>', color: '#33FF57', health: 100 },
    ]);
    nope(hidden('player-list-overlay'), 'shown by rendering');
    eq(el('player-count').textContent, '2', 'count');
    const r = rows('player-list-items', '.player-list-item');
    eq(r.length, 2, 'one row per player'); eq(text(r[0], '.player-name-text'), 'Steve', 'name');
    eq(text(r[0], '.player-list-item-pos'), '(1, 21, -3)', 'rounded position');
    eq(r[1].querySelectorAll('.player-list-item-pos').length, 0, 'no position, no span'); eq(r[1].querySelectorAll('b').length, 0, 'name escaped');
    eq(text(r[1], '.player-name-text'), '<b>Alex</b>', 'name round-trips');
    h.ui.playerList.render([]);
    eq(el('player-count').textContent, '0', 'empty roster updates the count'); eq(rows('player-list-items', '.player-list-item').length, 0, 'rows cleared');
    h.ui.playerList.hide(); is(hidden('player-list-overlay'), 'hidden on demand');
  });
  it('clamps the health bar and colours it from the clamped value', () => {
    const h = harness();
    const cases = [
      [undefined, '100%', '#4CAF50'], [100, '100%', '#4CAF50'], [61, '61%', '#4CAF50'],
      [60, '60%', '#f1c40f'], [31, '31%', '#f1c40f'], [30, '30%', '#e74c3c'],
      [0, '0%', '#e74c3c'], [-5, '0%', '#e74c3c'], [150, '100%', '#4CAF50']];
    h.ui.playerList.render(cases.map(([health], i) => ({ id: `p${i}`, name: 'P', color: '#fff', health })));
    const fills = rows('player-list-items', '.player-health-fill');
    eq(fills.length, cases.length, 'one bar per player');
    // jsdom's CSS parser normalises `style.background` to `rgb(...)`, so the raw
    // declaration is read back off the attribute rather than off the style object.
    cases.forEach(([health, width, colour], i) => {
      has(fills[i].getAttribute('style'), `width:${width}`, `health ${health} -> width ${width}`);
      has(fills[i].getAttribute('style'), `background:${colour}`, `health ${health} -> ${colour}`);
    });
  });
});
