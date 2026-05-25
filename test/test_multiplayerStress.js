#!/usr/bin/env node
/**
 * Cuubz — Multiplayer Stress Test (4 Concurrent Players)
 * Phase 4 Pre-Deployment: Tests full server relay with 4 simultaneous connections.
 */

'use strict';

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const Matchmaking = require('../server/matchmaking');
const SessionManager = require('../server/session');

let PASS = 0, FAIL = 0, TOTAL = 0;

function assert(cond, msg) {
  TOTAL++;
  if (cond) PASS++;
  else { FAIL++; console.error(`  FAIL: ${msg}`); }
}

// ─── Test Client with proper message buffering ──────────────

class TestClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this._queue = [];        // Buffered messages
    this._waiting = null;    // Single waiting resolver
    this._connected = false;

    // Set up all listeners before connection completes
    this.ws.on('open', () => { this._connected = true; });
    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (this._waiting) {
          const r = this._waiting;
          this._waiting = null;
          r(msg);
        } else {
          this._queue.push(msg);
        }
      } catch(e) {}
    });
  }

  connect() {
    return new Promise((res, rej) => {
      if (this._connected) return res();
      this.ws.once('open', res);
      this.ws.once('error', rej);
    });
  }

  send(data) { this.ws.send(JSON.stringify(data)); }
  close() { try { this.ws.close(); } catch(e) {} }

  /** Receive next message. Checks buffer first, then waits. */
  receive(timeout = 3000) {
    if (this._queue.length > 0) return Promise.resolve(this._queue.shift());
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._waiting = null;
        resolve(null);
      }, timeout);
      this._waiting = (msg) => { clearTimeout(timer); resolve(msg); };
    });
  }

  /** Receive next message of a specific type, discarding non-matching buffered messages. */
  receiveType(expectedType, timeout = 3000) {
    // Check buffer first for matching type
    for (let i = this._queue.length - 1; i >= 0; i--) {
      if (this._queue[i].type === expectedType) {
        return Promise.resolve(this._queue.splice(i, 1)[0]);
      }
    }
    // Not in buffer — wait for new messages, discarding non-matching ones
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._waiting = null;
        resolve(null);
      }, timeout);
      this._waiting = (msg) => {
        if (msg.type === expectedType) {
          clearTimeout(timer);
          this._waiting = null;
          resolve(msg);
        }
        // else discard non-matching message and keep waiting
      };
    });
  }

  /** Drain all buffered messages */
  drain() { const m = [...this._queue]; this._queue = []; return m; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Test Suite ─────────────────────────────────────────────

async function runTests() {
  console.log('Setting up test server...\n');

  const matchHttp = http.createServer();
  await new Promise(r => matchHttp.listen(0, r));
  const matchPort = matchHttp.address().port;
  const matchWSS = new WebSocketServer({ server: matchHttp });

  let activeSessionId = null, gameSessionPort = null;
  const sessions = [], sServers = [];

  new Matchmaking({
    wss: matchWSS,
    onHostRequest: (pid, name, seed, mode) => {
      activeSessionId = 's_' + Date.now();
      const sh = http.createServer();
      sh.listen(0); gameSessionPort = sh.address().port;
      sServers.push(sh);
      const sw = new WebSocketServer({ server: sh });
      sessions.push(new SessionManager({ wss: sw, sessionId: activeSessionId, hostId: pid, maxPlayers: 4 }));
      return { sessionId: activeSessionId, sessionPort: gameSessionPort };
    },
    onJoinRequest: (pid, sid) => sid === activeSessionId ? { sessionPort: gameSessionPort } : { error: 'no' },
    listSessions: () => activeSessionId ? [{ sessionId: activeSessionId, name: 'T', players: 1, maxPlayers: 4, mode: 's' }] : [],
    onSessionLeave: () => {},
  });

  try {
    // === Group 1: Connect all 4 players ===
    console.log('Group 1: 4 concurrent player connections');

    const mClients = [], gClients = [], pIds = [];

    // P1 hosts
    const m1 = new TestClient(`ws://localhost:${matchPort}`);
    await m1.connect();
    const w1 = await m1.receive(2000);
    assert(w1 && w1.type === 'WELCOME', 'P1 matchmaking WELCOME');
    const hostId = w1.playerId; pIds.push(hostId);

    m1.send({ type: 'HOST', name: 'TestWorld', worldSeed: 42, mode: 'survival' });
    const hr = await m1.receive(2000);
    assert(hr && hr.type === 'HOST_CREATED', 'HOST_CREATED');
    await sleep(50);

    const g1 = new TestClient(`ws://localhost:${gameSessionPort}`);
    await g1.connect();
    g1.send({ type: 'JOIN', playerId: hostId, character: { name: 'Host', color: '#F00' } });
    const gw1 = await g1.receive(2000);
    assert(gw1 && gw1.type === 'WELCOME', 'P1 game WELCOME');

    mClients.push(m1); gClients.push(g1);

    // P2-P4 join
    for (let i = 2; i <= 4; i++) {
      const mi = new TestClient(`ws://localhost:${matchPort}`);
      await mi.connect();
      const wi = await mi.receive(2000);
      assert(wi && wi.type === 'WELCOME', `P${i} match WELCOME`);

      mi.send({ type: 'JOIN', sessionId: activeSessionId });
      const ji = await mi.receive(2000);
      assert(ji && ji.type === 'JOIN_ACCEPTED', `P${i} JOIN_ACCEPTED`);

      const gi = new TestClient(`ws://localhost:${gameSessionPort}`);
      await gi.connect();
      const pid = `p${i}`; pIds.push(pid);

      gi.send({ type: 'JOIN', playerId: pid, character: { name: `P${i}`, color: '#0F0' } });
      const gwi = await gi.receive(2000);
      assert(gwi && gwi.type === 'WELCOME', `P${i} game WELCOME`);

      mClients.push(mi); gClients.push(gi);
    }

    // Flush any PLAYER_JOINED broadcasts
    for (const gc of gClients) gc.drain();
    await sleep(100);

    const session = sessions[0];
    assert(session.players.size === 4, `Session has 4 players (got ${session.players.size})`);

    // === Group 2: Block change broadcasting ===
    console.log('Group 2: Block change broadcasting');
    {
      // P1 at position ~0,20,0 — break block within reach distance (6 blocks)
      gClients[0].send({ type: 'BREAK_BLOCK', x: 3, y: 20, z: 3 }); // dist ~5.2 < 6
      await sleep(100); // Allow broadcast to arrive at all clients

      let breakCount = 0;
      for (let i = 0; i < 4; i++) {
        const msg = await gClients[i].receiveType('BLOCK_BREAK', 2000);
        if (msg && msg.type === 'BLOCK_BREAK') {
          breakCount++;
          assert(msg.x === 3, `P${i+1} BREAK_BLOCK coords correct`);
        }
      }
      assert(breakCount === 4, `BREAK_BLOCK broadcast to ${breakCount}/4 players`);

      // Flush + test block place from P2 (within reach of ~0,20,0)
      for (const gc of gClients) gc.drain();
      await sleep(50);

      gClients[1].send({ type: 'PLACE_BLOCK', x: 2, y: 20, z: 2, blockType: 3 }); // dist ~3.5 < 6
      let placeCount = 0;
      for (let i = 0; i < 4; i++) {
        const msg = await gClients[i].receiveType('BLOCK_PLACE', 2000);
        if (msg && msg.type === 'BLOCK_PLACE') {
          placeCount++;
          assert(msg.blockType === 3, `P${i+1} PLACE_BLOCK type correct`);
        }
      }
      assert(placeCount === 4, `PLACE_BLOCK broadcast to ${placeCount}/4 players`);

      // Verify server block change log
      assert(session.worldState.blockChanges.length >= 1, `Server logged block changes (got ${session.worldState.blockChanges.length})`);
    }

    // === Group 3: Disconnect/reconnect ===
    console.log('Group 3: Disconnect/reconnect handling');
    {
      for (const gc of gClients) gc.drain();
      await sleep(50);

      // P3 disconnects
      gClients[2].close();
      await sleep(300);

      let leftCount = 0;
      for (let i = 0; i < 4; i++) {
        if (i === 2) continue; // P3 is gone
        const msgs = gClients[i].drain();
        for (const m of msgs) if (m.type === 'PLAYER_LEFT') leftCount++;
      }
      assert(leftCount >= 2, `PLAYER_LEFT to ${leftCount}/3 remaining`);
      assert(session.players.size === 3, `3 players after disconnect (got ${session.players.size})`);

      // P3 reconnects
      const g3new = new TestClient(`ws://localhost:${gameSessionPort}`);
      await g3new.connect();
      g3new.send({ type: 'JOIN', playerId: pIds[2], character: { name: 'P3', color: '#00F' } });
      const gw3 = await g3new.receive(2000);
      assert(gw3 && gw3.type === 'WELCOME', 'Reconnected P3 WELCOME');
      gClients[2] = g3new;
      assert(session.players.size === 4, `4 players after reconnect (got ${session.players.size})`);
    }

    // === Group 4: Inventory sync ===
    console.log('Group 4: Inventory synchronization');
    {
      const inv = [{ typeId: 'dirt', count: 64 }, { typeId: 'stone', count: 32 }];
      gClients[0].send({ type: 'INVENTORY_UPDATE', inventory: inv });
      await sleep(100);

      let syncCount = 0;
      for (let i = 0; i < 4; i++) {
        const msg = await gClients[i].receiveType('INVENTORY_SYNC', 2000);
        if (msg && msg.type === 'INVENTORY_SYNC' && msg.playerId === hostId) {
          syncCount++;
          assert(msg.inventory[0].typeId === 'dirt', `P${i+1} inv typeId correct`);
        }
      }
      assert(syncCount === 4, `INVENTORY_SYNC to ${syncCount}/4 players`);

      // P2 inventory
      for (const gc of gClients) gc.drain();
      await sleep(50);

      gClients[1].send({ type: 'INVENTORY_UPDATE', inventory: [{ typeId: 'wood_log', count: 16 }] });
      await sleep(100);
      let sync2Count = 0;
      for (let i = 0; i < 4; i++) {
        const msg = await gClients[i].receiveType('INVENTORY_SYNC', 2000);
        if (msg && msg.type === 'INVENTORY_SYNC' && msg.playerId === 'p2') sync2Count++;
      }
      assert(sync2Count === 4, `P2 INVENTORY_SYNC to ${sync2Count}/4 players`);
    }

    // === Group 5: Movement sync ===
    console.log('Group 5: Movement synchronization');
    {
      for (const gc of gClients) gc.drain();
      await sleep(50);

      gClients[0].send({ type: 'MOVE', position: { x: 5, y: 20, z: 5 }, rotation: { yaw: 1.0 } });

      let moveCount = 0;
      for (let i = 1; i < 4; i++) { // P1 excluded by _broadcast
        const msg = await gClients[i].receive(2000);
        if (msg && msg.type === 'PLAYER_MOVE') {
          moveCount++;
          assert(msg.position.x === 5, `P${i+1} MOVE position correct`);
        }
      }
      assert(moveCount >= 2, `PLAYER_MOVE to ${moveCount}/3 others`);

      const p1 = session.players.get(hostId);
      assert(p1 && p1.position.x === 5, 'Server updated host position');
    }

    // === Group 6: Heartbeat ===
    console.log('Group 6: Heartbeat keepalive');
    {
      for (const gc of gClients) gc.send({ type: 'HEARTBEAT' });
      await sleep(50);

      const now = Date.now();
      let allOk = true;
      for (const p of session.players.values()) {
        if ((now - p.lastHeartbeat) > 1000) allOk = false;
      }
      assert(allOk, 'All players have recent heartbeats');
    }

    // === Group 7: Invalid messages ===
    console.log('Group 7: Invalid message handling');
    {
      for (const gc of gClients) gc.drain();
      await sleep(50);

      gClients[0].send({ type: 'BREAK_BLOCK', x: 1000, y: 20, z: 1000 });
      const e1 = await gClients[0].receive(2000);
      assert(e1 && e1.type === 'ERROR', 'Out-of-range break → ERROR');

      gClients[0].send({ type: 'PLACE_BLOCK', x: 5, y: -50, z: 5, blockType: 1 });
      const e2 = await gClients[0].receive(2000);
      assert(e2 && e2.type === 'ERROR', 'Out-of-bounds Y → ERROR');

      gClients[0].send({ type: 'BREAK_BLOCK', x: 1.5, y: 20, z: 1.5 });
      const e3 = await gClients[0].receive(2000);
      assert(e3 && e3.type === 'ERROR', 'Non-integer coords → ERROR');

      gClients[1].send({ type: 'PLACE_BLOCK', x: 5, y: 20, z: 5, blockType: -1 });
      const e4 = await gClients[1].receive(2000);
      assert(e4 && e4.type === 'ERROR', 'Negative blockType → ERROR');
    }

  } catch (err) {
    console.error(`Test error: ${err.message}`);
    console.error(err.stack);
  } finally {
    console.log('\nCleaning up...');
    for (const s of sessions) try { s.dispose(); } catch(e) {}
    for (const ss of sServers) try { ss.close(); } catch(e) {}
    try { matchWSS.close(); } catch(e) {}
    try { matchHttp.close(); } catch(e) {}
    await sleep(100);
  }

  console.log('');
  console.log('===================================');
  console.log(`  Results: ${PASS}/${TOTAL} passed, ${FAIL} failed`);
  console.log('===================================');

  if (FAIL > 0) { console.error('Some tests failed!'); process.exit(1); }
  else { console.log('All multiplayer stress tests passing!'); process.exit(0); }
}

runTests();
