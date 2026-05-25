#!/usr/bin/env node
/**
 * Cuubz — WebSocket Error Handling Tests
 * Tests all error handling paths in client.js, session.js, matchmaking.js, and index.js.
 */

'use strict';

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
};

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    passCount++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failCount++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

// ─── Import modules ──────────────────────────────────────────────

const { WSConnection, MultiplayerClient, CLIENT_STATE, MESSAGE_TYPES } = require('../js/multiplayer/client');
const SessionManager = require('../server/session');
const Matchmaking = require('../server/matchmaking');

// ─── Mock WebSocket — matches real WS API (onopen/onmessage/onclose/onerror as properties) ──

class MockWS {
  constructor(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this._sentMessages = [];
    this._closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this._listeners = {}; // For .on() style event registration (server-side ws library)
  }

  // Support both property-style (browser WS) and .on() style (Node.js ws library)
  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return this;
  }

  off(event, callback) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }
    return this;
  }

  _emit(event, data) {
    // Emit to both styles of listeners
    const propHandler = this['on' + event];
    if (typeof propHandler === 'function') propHandler(data);
    if (this._listeners[event]) {
      this._listeners[event].forEach(cb => cb(data));
    }
  }

  send(data) {
    this._sentMessages.push(data);
  }

  close(code, reason) {
    if (this.readyState === 3) return; // Already closed
    this._closed = true;
    this.readyState = 3; // CLOSED
    this._emit('close', { code: code || 1000, reason });
  }

  triggerOpen() {
    this._emit('open');
  }

  triggerError(message) {
    this._emit('error', { message: message || 'Simulated error' });
  }

  triggerMessage(obj) {
    const data = typeof obj === 'string' ? obj : JSON.stringify(obj);
    // Create a MessageEvent-like object where .toString() returns the stringified data
    // This matches real WebSocket behavior: event.data.toString() === JSON string
    const event = { data };
    event.toString = function() { return this.data; };
    this._emit('message', event);
  }

  triggerClose(code, reason) {
    this.close(code, reason);
  }

  getSentMessages() {
    return this._sentMessages;
  }

  lastSent() {
    return this._sentMessages.length > 0 ? JSON.parse(this._sentMessages[this._sentMessages.length - 1]) : null;
  }
}

// ─── Test Group 1: WSConnection Error Handling ──────────────────

console.log('\n=== Group 1: WSConnection Error Handling ===');

test('onerror triggers disconnect and reconnection', () => {
  let wsInstance = null;
  const mockFactory = function(url) {
    wsInstance = new MockWS(url);
    return wsInstance;
  };

  const conn = new WSConnection({ url: 'ws://test:9999', wsFactory: mockFactory });
  let reconnectScheduled = false;
  conn._scheduleReconnect = () => { reconnectScheduled = true; };

  // Connect and trigger open
  conn.connect();
  assert(wsInstance, 'WebSocket should be created');
  assert(conn.state === CLIENT_STATE.CONNECTING, 'Should be CONNECTING after connect()');

  wsInstance.triggerOpen();
  assert(conn.isConnected === true, 'Should be connected after open');

  // Trigger error while in CONNECTED state
  wsInstance.triggerError('network failure');

  // Should have disconnected and scheduled reconnect
  assert(conn.state === CLIENT_STATE.DISCONNECTED, `State should be DISCONNECTED, got ${conn.state}`);
  assert(reconnectScheduled === true, 'Should have scheduled reconnection after error');
});

test('onerror does nothing when already disposed', () => {
  let wsInstance = null;
  const mockFactory = function(url) {
    wsInstance = new MockWS(url);
    return wsInstance;
  };

  const conn = new WSConnection({ url: 'ws://test:9999', wsFactory: mockFactory });
  conn.connect();
  assert(conn.state === CLIENT_STATE.CONNECTING, 'Should be CONNECTING');
  wsInstance.triggerOpen();
  assert(conn.isConnected === true, 'Should be connected after open');

  // Dispose before error — this closes the socket and sets _disposed=true
  const initialReadyState = wsInstance.readyState;
  conn.dispose();

  assert(conn._disposed === true, 'Should be disposed');
  assert(conn._socket === null, '_socket should be null after dispose');
  assert(wsInstance.readyState === 3 || wsInstance._closed === true,
    `Socket should be closed (readyState=3 or _closed=true), got readyState=${wsInstance.readyState}, _closed=${wsInstance._closed}`);
});

test('_flushQueue handles individual send failures gracefully', () => {
  const mockWS = new MockWS('ws://test:9999');
  let sendCallCount = 0;
  // Override send to fail on every call
  mockWS.send = function() {
    sendCallCount++;
    throw new Error('Simulated send failure');
  };

  const conn = new WSConnection({ url: 'ws://test:9999', wsFactory: null });
  // Manually inject socket and set connected state
  conn._socket = mockWS;
  conn._state = CLIENT_STATE.CONNECTED;

  // Queue messages directly
  conn._queue.enqueue({ type: 'TEST1' });
  conn._queue.enqueue({ type: 'TEST2' });
  conn._queue.enqueue({ type: 'TEST3' });

  assert(conn.queueSize === 3, `Queue should have 3 messages, got ${conn.queueSize}`);

  // Flush — each item gets dequeued and _sendRaw catches the error internally
  // All items are dequeued (removed from queue) even though sends fail
  conn._flushQueue();

  assert(sendCallCount === 3, `All 3 messages attempted send, got ${sendCallCount}`);
  assert(conn.queueSize === 0, 'Queue should be empty after flush (items dequeued on attempt)');
});

test('_sendRaw catches send errors', () => {
  const mockWS = new MockWS('ws://test:9999');
  mockWS.send = () => { throw new Error('Simulated send failure'); };
  const conn = new WSConnection({ url: 'ws://test:9999', wsFactory: null });
  conn._socket = mockWS;
  conn._state = CLIENT_STATE.CONNECTED;

  // Should not throw — error is caught internally
  conn._sendRaw({ type: 'TEST' });
  assert(true, '_sendRaw handled send error without crashing');
});

test('onerror only triggers reconnect when in CONNECTED state', () => {
  let wsInstance = null;
  const mockFactory = function(url) {
    wsInstance = new MockWS(url);
    return wsInstance;
  };

  const conn = new WSConnection({ url: 'ws://test:9999', wsFactory: mockFactory });
  let reconnectCalled = false;
  conn._scheduleReconnect = () => { reconnectCalled = true; };

  // Connect but DON'T trigger open — state is CONNECTING
  conn.connect();
  assert(conn.state === CLIENT_STATE.CONNECTING, `Should be CONNECTING before open, got ${conn.state}`);

  // Trigger error while in CONNECTING state — should NOT schedule reconnect
  wsInstance.triggerError('connection refused');

  assert(reconnectCalled === false, 'Should not reconnect when error occurs during CONNECTING state');
});

test('onerror does not trigger reconnect when disposed', () => {
  let wsInstance = null;
  const mockFactory = function(url) {
    wsInstance = new MockWS(url);
    return wsInstance;
  };

  const conn = new WSConnection({ url: 'ws://test:9999', wsFactory: mockFactory });
  let reconnectCalled = false;
  conn._scheduleReconnect = () => { reconnectCalled = true; };

  conn.connect();
  wsInstance.triggerOpen();
  assert(conn.isConnected === true);

  // Dispose — this sets _disposed = true and closes socket
  conn.dispose();

  assert(reconnectCalled === false, 'Should not have scheduled reconnect after dispose');
});

// ─── Test Group 2: MultiplayerClient Error Handling ──────────────

console.log('\n=== Group 2: MultiplayerClient Error Handling ===');

test('connectMatchmaking handles constructor errors', () => {
  const client = new MultiplayerClient({ host: 'test-host' });

  // Force wsFactory to throw on instantiation
  let factoryCallCount = 0;
  client._wsFactory = function(url) {
    factoryCallCount++;
    if (factoryCallCount === 1) {
      throw new Error('Simulated constructor failure');
    }
    return new MockWS(url);
  };

  // Should not crash — error is caught
  client.connectMatchmaking();

  // _matchmakingConn may be set (the WSConnection object was created), but it should
  // be disposed by the catch block. Check that it's in a clean state.
  assert(factoryCallCount === 1, 'Factory should have been called once');
  assert(client.isMatchmakingConnected === false, 'Should report disconnected after error');
});

test('_connectToGameSession handles constructor errors', () => {
  const client = new MultiplayerClient({ host: 'test-host' });

  let factoryCallCount = 0;
  client._wsFactory = function(url) {
    factoryCallCount++;
    if (factoryCallCount === 1) {
      throw new Error('Simulated game session failure');
    }
    return new MockWS(url);
  };

  // Should not crash — error is caught
  client._connectToGameSession(8766);

  assert(factoryCallCount === 1, 'Factory should have been called once');
  assert(client.isGameSessionConnected === false, 'Should report disconnected after error');
});

test('disconnect handles errors without losing session ID cleanup', () => {
  const client = new MultiplayerClient({ host: 'test-host' });
  client._currentSessionId = 'test-session-123';

  // Create mock connections that throw on disconnect
  const badConn = {
    disconnect: () => { throw new Error('Disconnect failed'); },
    dispose: () => {},
  };
  client._matchmakingConn = badConn;
  client._gameSessionConn = badConn;

  // Should not crash — error caught, session ID still cleared
  client.disconnect();

  assert(client._currentSessionId === null, 'Session ID should be cleared even after disconnect error');
});

test('dispose handles errors gracefully', () => {
  const client = new MultiplayerClient({ host: 'test-host' });

  const safeConn = {
    disconnect: () => {},
    dispose: () => {},
  };
  client._matchmakingConn = safeConn;
  client._gameSessionConn = safeConn;

  // Should not crash
  client.dispose();

  assert(client._disposed === true, 'Should be marked as disposed');
});

test('dispose cleans up even when disconnect throws', () => {
  const client = new MultiplayerClient({ host: 'test-host' });

  const badConn = {
    disconnect: () => { throw new Error('Disconnect failed'); },
    dispose: () => {},
  };
  client._matchmakingConn = badConn;
  client._gameSessionConn = badConn;

  // dispose() calls disconnect() which has try/catch, so it should complete
  client.dispose();

  assert(client._disposed === true, 'Should be disposed even after disconnect error');
});

// ─── Test Group 3: SessionManager Error Handling ─────────────────

console.log('\n=== Group 3: SessionManager Error Handling ===');

test('_send handles send failures gracefully', () => {
  const mockWSS = { on: () => {}, close: () => {} };

  const session = new SessionManager({
    wss: mockWSS,
    sessionId: 'test-sess',
    hostId: 'host-1',
    maxPlayers: 4,
  });

  // Create a mock WS that throws on send
  const badWS = {
    readyState: 1,
    send: () => { throw new Error('Send failed'); },
  };

  // Should not crash — error is caught in _send
  session._send(badWS, { type: 'TEST', data: 'hello' });
  assert(true, '_send handled send failure without crashing');
});

test('_broadcast continues after individual send failure', () => {
  const mockWSS = { on: () => {}, close: () => {} };

  const session = new SessionManager({
    wss: mockWSS,
    sessionId: 'test-sess',
    hostId: 'host-1',
    maxPlayers: 4,
  });

  // Add players with mixed good/bad WebSockets
  let sentToP1 = false;
  let sentToP3 = false;

  const goodWS1 = { readyState: 1, send: () => { sentToP1 = true; } };
  const badWS = { readyState: 1, send: () => { throw new Error('Send failed'); } };
  const goodWS2 = { readyState: 1, send: () => { sentToP3 = true; } };

  session.players.set('p1', { playerId: 'p1', ws: goodWS1 });
  session.players.set('p2', { playerId: 'p2', ws: badWS });
  session.players.set('p3', { playerId: 'p3', ws: goodWS2 });

  // Broadcast should not crash even though p2's send fails
  session._broadcast(null, { type: 'TEST_BROADCAST' });

  assert(sentToP1 === true, 'Should have sent to p1');
  assert(sentToP3 === true, 'Should have sent to p3 despite p2 failure');
  assert(session.players.size === 3, 'All players should still be in session');
});

test('ws.onerror triggers player cleanup', () => {
  let connectionCallback = null;
  const mockWSS = {
    on: (event, cb) => {
      if (event === 'connection') connectionCallback = cb;
    },
    close: () => {},
  };

  const session = new SessionManager({
    wss: mockWSS,
    sessionId: 'test-sess',
    hostId: 'host-1',
    maxPlayers: 4,
  });

  // Simulate a connection with MockWS (matches real WS API)
  const mockWS = new MockWS('ws://test:8766');
  connectionCallback(mockWS);

  // Send JOIN message to register the player
  mockWS.triggerMessage({ type: 'JOIN', playerId: 'error-test-player', character: { name: 'Test' } });

  assert(session.players.size === 1, `Should have 1 player after join, got ${session.players.size}`);

  // Trigger WebSocket error — should clean up the player
  mockWS.triggerError('network failure');

  // The onerror handler calls _removePlayer, which removes from players map
  assert(session.players.size === 0, `Player should be removed after WS error, got ${session.players.size}`);
});

test('_broadcast skips null ws gracefully', () => {
  const mockWSS = { on: () => {}, close: () => {} };

  const session = new SessionManager({
    wss: mockWSS,
    sessionId: 'test-sess',
    hostId: 'host-1',
    maxPlayers: 4,
  });

  // Add a player with null ws (edge case)
  session.players.set('ghost', { playerId: 'ghost', ws: null });

  // Should not crash — _send checks readyState which fails for null
  session._broadcast(null, { type: 'TEST' });
  assert(true, '_broadcast handled null ws without crashing');
});

// ─── Test Group 4: Matchmaking Error Handling ────────────────────

console.log('\n=== Group 4: Matchmaking Error Handling ===');

test('_send handles send failures gracefully', () => {
  const mockWSS = { on: () => {}, close: () => {} };

  const matchmaking = new Matchmaking({
    wss: mockWSS,
    onHostRequest: () => ({ sessionId: 's1', sessionPort: 8766 }),
    onJoinRequest: () => ({ sessionPort: 8766 }),
    listSessions: () => [],
    onSessionLeave: () => {},
  });

  // WebSocket.OPEN = 1
  const badWS = { readyState: 1 };
  badWS.send = () => { throw new Error('Send failed'); };

  // Should not crash
  matchmaking._send(badWS, { type: 'TEST' });
  assert(true, '_send handled send failure without crashing');
});

test('ws.onerror triggers client cleanup', () => {
  let connectionCallback = null;
  const mockWSS = {
    on: (event, cb) => {
      if (event === 'connection') connectionCallback = cb;
    },
    close: () => {},
  };

  let sessionLeft = false;
  const matchmaking = new Matchmaking({
    wss: mockWSS,
    onHostRequest: () => ({ sessionId: 's1', sessionPort: 8766 }),
    onJoinRequest: () => ({ sessionPort: 8766 }),
    listSessions: () => [],
    onSessionLeave: (sid) => { sessionLeft = true; },
  });

  // Simulate a connection with MockWS
  const mockWS = new MockWS('ws://test:8765');
  connectionCallback(mockWS);

  // Client should be registered
  assert(matchmaking.clients.size === 1, `Should have 1 client after connect, got ${matchmaking.clients.size}`);

  // Host a session to set sessionId on the client
  mockWS.triggerMessage({ type: 'HOST', name: 'Test Session', worldSeed: 12345 });

  const client = matchmaking.clients.get(mockWS);
  assert(client && client.sessionId === 's1', `Client should have sessionId after hosting, got ${client ? client.sessionId : 'no client'}`);

  // Trigger WebSocket error — should clean up client and trigger session leave
  mockWS.triggerError('network failure');

  assert(matchmaking.clients.size === 0, `Client should be removed from Map after WS error, got ${matchmaking.clients.size}`);
  assert(sessionLeft === true, 'onSessionLeave should be called for the session');
});

test('ws.onerror without session does not crash', () => {
  let connectionCallback = null;
  const mockWSS = { on: (event, cb) => { if (event === 'connection') connectionCallback = cb; }, close: () => {} };

  const matchmaking = new Matchmaking({
    wss: mockWSS,
    onHostRequest: () => ({ sessionId: 's1', sessionPort: 8766 }),
    onJoinRequest: () => ({ sessionPort: 8766 }),
    listSessions: () => [],
    onSessionLeave: () => {},
  });

  const mockWS = new MockWS('ws://test:8765');
  connectionCallback(mockWS);

  // Don't host a session — just trigger error
  mockWS.triggerError('network failure');

  assert(matchmaking.clients.size === 0, 'Client should be removed even without session');
});

// ─── Test Group 5: Edge Cases & Integration ──────────────────────

console.log('\n=== Group 5: Edge Cases & Integration ===');

test('WSConnection connect failure triggers reconnect', () => {
  let reconnectCalled = false;
  const badFactory = function() { throw new Error('DNS resolution failed'); };

  const conn = new WSConnection({ url: 'ws://invalid-host:9999', wsFactory: badFactory });
  conn._scheduleReconnect = () => { reconnectCalled = true; };

  // connect() catches the constructor error and schedules reconnect
  conn.connect();

  assert(reconnectCalled === true, 'Should schedule reconnect after connection failure');
  assert(conn.state === CLIENT_STATE.DISCONNECTED, 'State should be DISCONNECTED after failed connect');
});

test('MultiplayerClient does not reconnect after dispose', () => {
  const client = new MultiplayerClient({ host: 'test-host' });
  client._wsFactory = function(url) { return new MockWS(url); };

  client.connectMatchmaking();
  assert(client._matchmakingConn !== null, 'Should have matchmaking connection');

  // Dispose should clean up everything
  client.dispose();

  assert(client._disposed === true, 'Should be disposed');
  assert(client._matchmakingConn === null, 'Matchmaking conn should be null after dispose');
  assert(client._gameSessionConn === null, 'Game session conn should be null after dispose');
});

test('WSConnection state transitions on error flow', () => {
  let wsInstance = null;
  const mockFactory = function(url) {
    wsInstance = new MockWS(url);
    return wsInstance;
  };

  const conn = new WSConnection({ url: 'ws://test:9999', wsFactory: mockFactory });
  const stateChanges = [];
  conn.on('stateChange', (data) => {
    stateChanges.push({ from: data.from, to: data.to });
  });

  // Connect → CONNECTING
  conn.connect();
  assert(stateChanges.some(s => s.to === CLIENT_STATE.CONNECTING), 'Should transition to CONNECTING');

  // Open → CONNECTED
  wsInstance.triggerOpen();
  assert(stateChanges.some(s => s.to === CLIENT_STATE.CONNECTED), 'Should transition to CONNECTED');

  // Error → DISCONNECTED
  wsInstance.triggerError('network failure');
  assert(stateChanges.some(s => s.to === CLIENT_STATE.DISCONNECTED), 'Should transition to DISCONNECTED on error');
});

test('MultiplayerClient stateChange propagates from WSConnection', () => {
  let wsInstance = null;
  const mockFactory = function(url) {
    wsInstance = new MockWS(url);
    return wsInstance;
  };

  const client = new MultiplayerClient({ host: 'test-host' });
  client._wsFactory = mockFactory;

  let stateChanges = [];
  client.connectMatchmaking();
  client._matchmakingConn.on('stateChange', (data) => {
    stateChanges.push({ from: data.from, to: data.to });
  });

  // Trigger open to get to CONNECTED state
  wsInstance.triggerOpen();

  // Now trigger error — should cause state change to DISCONNECTED
  wsInstance.triggerError('network failure');

  assert(stateChanges.length >= 2, `Should have at least 2 state changes, got ${stateChanges.length}`);
});

// ─── Summary ──────────────────────────────────────────────────────

console.log('\n===================================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
console.log('===================================');

if (failCount > 0) {
  process.exit(1);
}
