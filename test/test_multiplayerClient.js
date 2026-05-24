#!/usr/bin/env node
/**
 * Cuubz — Multiplayer Client Tests
 * Tests for WSConnection, MessageQueue, MultiplayerClient, and message protocol.
 */

'use strict';

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passCount++;
    console.log(`  ✅ ${message}`);
  } else {
    failCount++;
    failures.push(message);
    console.log(`  ❌ FAIL — ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

// ─── Load Module ──────────────────────────────────────────────────

const {
  CLIENT_STATE,
  DEFAULT_CONFIG,
  MESSAGE_TYPES,
  MessageQueue,
  WSConnection,
  MultiplayerClient,
} = require('../js/multiplayer/client');

// ─── Mock WebSocket Factory ───────────────────────────────────────

/**
 * Creates a mock WebSocket that simulates connection lifecycle.
 * Returns { socket, server } where server can push messages to the client.
 */
function createMockWS(url) {
  const state = { readyState: 0 /* CONNECTING */, listeners: {} };

  const socket = {
    readyState: 0,
    _url: url,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (data) => {
      state.sentData = data;
    },
    close: () => {
      state.readyState = 3 /* CLOSED */;
    },
  };

  // Simulate connection opening
  setTimeout(() => {
    socket.readyState = 1 /* OPEN */;
    if (socket.onopen) socket.onopen();
  }, 0);

  return socket;
}

// ─── Group 1: Constants ──────────────────────────────────────────

console.log('Group 1: Constants');

assert(CLIENT_STATE.DISCONNECTED === 'disconnected', 'DISCONNECTED state constant');
assert(CLIENT_STATE.CONNECTING === 'connecting', 'CONNECTING state constant');
assert(CLIENT_STATE.CONNECTED === 'connected', 'CONNECTED state constant');
assert(CLIENT_STATE.RECONNECTING === 'reconnecting', 'RECONNECTING state constant');

assert(MESSAGE_TYPES.JOIN === 'JOIN', 'JOIN message type');
assert(MESSAGE_TYPES.LEAVE === 'LEAVE', 'LEAVE message type');
assert(MESSAGE_TYPES.MOVE === 'MOVE', 'MOVE message type');
assert(MESSAGE_TYPES.BREAK_BLOCK === 'BREAK_BLOCK', 'BREAK_BLOCK message type');
assert(MESSAGE_TYPES.PLACE_BLOCK === 'PLACE_BLOCK', 'PLACE_BLOCK message type');
assert(MESSAGE_TYPES.HEARTBEAT === 'HEARTBEAT', 'HEARTBEAT message type');
assert(MESSAGE_TYPES.WELCOME === 'WELCOME', 'WELCOME message type');
assert(MESSAGE_TYPES.ERROR === 'ERROR', 'ERROR message type');
assert(MESSAGE_TYPES.HOST === 'HOST', 'HOST message type');
assert(MESSAGE_TYPES.BROWSE === 'BROWSE', 'BROWSE message type');
assert(MESSAGE_TYPES.SESSION_LIST === 'SESSION_LIST', 'SESSION_LIST message type');
assert(MESSAGE_TYPES.CHUNK_DATA === 'CHUNK_DATA', 'CHUNK_DATA message type');

assert(DEFAULT_CONFIG.heartbeatInterval === 15000, 'Default heartbeat interval 15s');
assert(DEFAULT_CONFIG.maxReconnectAttempts === 10, 'Default max reconnect attempts 10');
assert(DEFAULT_CONFIG.reconnectBaseDelay === 1000, 'Default reconnect base delay 1s');
assert(DEFAULT_CONFIG.reconnectMaxDelay === 30000, 'Default reconnect max delay 30s');
assert(DEFAULT_CONFIG.messageQueueSize === 500, 'Default message queue size 500');

// ─── Group 2: MessageQueue ──────────────────────────────────────

console.log('\nGroup 2: MessageQueue');

const queue = new MessageQueue(10);
assert(queue.size === 0, 'New queue is empty');
assert(queue.isEmpty === true, 'isEmpty is true for empty queue');

// Enqueue and dequeue
queue.enqueue({ type: 'MSG1', data: 'first' });
assert(queue.size === 1, 'Queue size is 1 after enqueue');
assert(queue.isEmpty === false, 'isEmpty is false after enqueue');

queue.enqueue({ type: 'MSG2', data: 'second' });
assert(queue.size === 2, 'Queue size is 2 after second enqueue');

// Peek without removing
const peeked = queue.peek();
assert(peeked !== null, 'Peek returns non-null for non-empty queue');
assertEqual(peeked.data.type, 'MSG1', 'Peek returns first message type');
assert(queue.size === 2, 'Peek does not change queue size');

// Dequeue in order
const dequeued = queue.dequeue();
assert(dequeued !== null, 'Dequeue returns non-null');
assertEqual(dequeued.data.type, 'MSG1', 'Dequeue returns first message (FIFO)');
assert(queue.size === 1, 'Queue size decreased after dequeue');

// Dequeue second
const dequeued2 = queue.dequeue();
assertEqual(dequeued2.data.type, 'MSG2', 'Second dequeue returns MSG2');
assert(queue.isEmpty === true, 'Queue is empty after all dequeued');

// Dequeue from empty
const emptyDequeue = queue.dequeue();
assert(emptyDequeue === null, 'Dequeue from empty returns null');

// Peek at empty
const emptyPeek = queue.peek();
assert(emptyPeek === null, 'Peek at empty returns null');

// Queue bounded size — drops oldest when full
const smallQueue = new MessageQueue(3);
smallQueue.enqueue({ type: 'A' });
smallQueue.enqueue({ type: 'B' });
smallQueue.enqueue({ type: 'C' });
assert(smallQueue.size === 3, 'Queue at capacity');

// Adding one more should drop oldest (A)
smallQueue.enqueue({ type: 'D' });
assert(smallQueue.size === 3, 'Queue size stays at max');
const firstAfterOverflow = smallQueue.dequeue();
assertEqual(firstAfterOverflow.data.type, 'B', 'Oldest message dropped when queue overflows');

// Timestamp tracking
const tsQueue = new MessageQueue();
tsQueue.enqueue({ type: 'TS' });
const item = tsQueue.peek();
assert(item.timestamp > 0, 'Enqueued items have timestamp');
assert(item.retryCount === 0, 'New items start with retryCount 0');

// Clear queue — use fresh queue for this test
const clearQueue = new MessageQueue();
clearQueue.enqueue({ type: 'X' });
clearQueue.enqueue({ type: 'Y' });
assert(clearQueue.size === 2, 'Queue has 2 items before clear');
clearQueue.clear();
assert(clearQueue.size === 0, 'Queue is empty after clear');
assert(clearQueue.isEmpty === true, 'isEmpty true after clear');

// ─── Group 3: WSConnection — Construction & State ──────────────

console.log('\nGroup 3: WSConnection construction and state');

// Test mode (no WebSocket factory)
const conn = new WSConnection({
  url: 'ws://localhost:8765',
  wsFactory: null,
});

assert(conn.url === 'ws://localhost:8765', 'URL stored correctly');
assertEqual(conn.state, CLIENT_STATE.DISCONNECTED, 'Initial state is DISCONNECTED');
assert(conn.isConnected === false, 'isConnected false initially');
assert(conn.queueSize === 0, 'Queue size is 0 initially');
assert(conn.reconnectAttempts === 0, 'Reconnect attempts start at 0');

// ─── Group 4: WSConnection — Event System ──────────────────────

console.log('\nGroup 4: WSConnection event system');

const eventConn = new WSConnection({ url: 'ws://test', wsFactory: null });
let eventReceived = null;

eventConn.on('TEST_EVENT', (data) => {
  eventReceived = data;
});

// Emit manually via internal method
eventConn._emit('TEST_EVENT', { value: 42 });
assertEqual(eventReceived.value, 42, 'Event handler receives correct data');

// Multiple handlers for same event
let handler1Called = false, handler2Called = false;
eventConn.on('MULTI', () => { handler1Called = true; });
eventConn.on('MULTI', () => { handler2Called = true; });
eventConn._emit('MULTI', {});
assert(handler1Called === true, 'First handler called');
assert(handler2Called === true, 'Second handler called');

// Off removes specific handler
let offCount = 0;
const cb1 = () => { offCount++; };
const cb2 = () => { offCount++; };
eventConn.on('OFF_TEST', cb1);
eventConn.on('OFF_TEST', cb2);
eventConn.off('OFF_TEST', cb1);
eventConn._emit('OFF_TEST', {});
assertEqual(offCount, 1, 'Only remaining handler called after off()');

// Remove all listeners
let removeAllCount = 0;
eventConn.on('REMOVE_ALL', () => { removeAllCount++; });
eventConn.removeAllListeners('REMOVE_ALL');
eventConn._emit('REMOVE_ALL', {});
assertEqual(removeAllCount, 0, 'No handlers after removeAllListeners');

// Error in handler doesn't crash other handlers
let errorHandled = false;
eventConn.on('ERROR_HANDLER', () => { throw new Error('handler error'); });
eventConn.on('ERROR_HANDLER', () => { errorHandled = true; });
eventConn._emit('ERROR_HANDLER', {});
assert(errorHandled === true, 'Second handler still called after first throws');

// ─── Group 5: WSConnection — Message Sending & Queueing ────────

console.log('\nGroup 5: WSConnection message sending and queuing');

const sendConn = new WSConnection({ url: 'ws://test', wsFactory: null });

// Send while disconnected → queued
sendConn.send({ type: 'QUEUED_MSG', data: 'test' });
assert(sendConn.queueSize === 1, 'Message queued when disconnected');

// Send multiple messages
sendConn.send({ type: 'MSG_A' });
sendConn.send({ type: 'MSG_B' });
assert(sendConn.queueSize === 3, 'Multiple messages queued');

// Send without type → ignored
const prevSize = sendConn.queueSize;
sendConn.send({ data: 'no type' });
sendConn.send(null);
sendConn.send(undefined);
assert(sendConn.queueSize === prevSize, 'Messages without type are not queued');

// ─── Group 6: WSConnection — Convenience Methods ──────────────

console.log('\nGroup 6: WSConnection convenience methods');

// sendJoin
{
  const c = new WSConnection({ url: 'ws://test', wsFactory: null });
  c.sendJoin('player1', { name: 'Test', color: '#ff0000' }, { x: 10, y: 20, z: 30 }, { yaw: 1, pitch: 0.5 });
  assert(c.queueSize === 1, 'sendJoin queues JOIN message');
  const m = c._queue.peek().data;
  assertEqual(m.type, 'JOIN', 'JOIN message type');
  assertEqual(m.playerId, 'player1', 'JOIN has playerId');
  assertEqual(m.character.name, 'Test', 'JOIN has character name');
}

// sendMove
{
  const c = new WSConnection({ url: 'ws://test', wsFactory: null });
  c.sendMove({ x: 5, y: 10, z: 15 }, { yaw: 0.5, pitch: 0 });
  const m = c._queue.peek().data;
  assertEqual(m.type, 'MOVE', 'sendMove creates MOVE message');
}

// sendBreakBlock — floors coordinates
{
  const c = new WSConnection({ url: 'ws://test', wsFactory: null });
  c.sendBreakBlock(10.7, 20.3, 30.9);
  const m = c._queue.peek().data;
  assertEqual(m.x, 10, 'Break block X floored');
  assertEqual(m.y, 20, 'Break block Y floored');
  assertEqual(m.z, 30, 'Break block Z floored');
}

// sendPlaceBlock
{
  const c = new WSConnection({ url: 'ws://test', wsFactory: null });
  c.sendPlaceBlock(5.9, 10.1, 15.5, 3);
  const m = c._queue.peek().data;
  assertEqual(m.type, 'PLACE_BLOCK', 'sendPlaceBlock creates PLACE_BLOCK message');
  assertEqual(m.blockType, 3, 'Block type included');
}

// sendInventoryUpdate
{
  const c = new WSConnection({ url: 'ws://test', wsFactory: null });
  c.sendInventoryUpdate({ slots: [] });
  const m = c._queue.peek().data;
  assertEqual(m.type, 'INVENTORY_UPDATE', 'sendInventoryUpdate creates INVENTORY_UPDATE message');
}

// sendHost (matchmaking)
{
  const c = new WSConnection({ url: 'ws://test', wsFactory: null });
  c.sendHost('MyWorld', 12345, 'survival');
  const m = c._queue.peek().data;
  assertEqual(m.type, 'HOST', 'sendHost creates HOST message');
  assertEqual(m.name, 'MyWorld', 'HOST has session name');
  assertEqual(m.worldSeed, 12345, 'HOST has world seed');
}

// sendBrowse (matchmaking)
{
  const c = new WSConnection({ url: 'ws://test', wsFactory: null });
  c.sendBrowse();
  const m = c._queue.peek().data;
  assertEqual(m.type, 'BROWSE', 'sendBrowse creates BROWSE message');
}

// sendJoinSession (matchmaking)
{
  const c = new WSConnection({ url: 'ws://test', wsFactory: null });
  c.sendJoinSession('session_abc');
  const m = c._queue.peek().data;
  assertEqual(m.sessionId, 'session_abc', 'sendJoinSession has sessionId');
}

// ─── Group 7: WSConnection — Mock WebSocket Connection ─────────

console.log('\nGroup 7: WSConnection with mock WebSocket');

let mockOpenCalled = false;
const mockSocket = {
  readyState: 1, // OPEN
  send: (data) => { mockSentData = JSON.parse(data); },
  close: () => { mockSocket.readyState = 3; },
};

let mockSentData = null;

const mockConn = new WSConnection({
  url: 'ws://mock:8765',
  wsFactory: () => mockSocket,
  options: { heartbeatInterval: 999999 }, // Disable heartbeat for tests
});

// Simulate connection open
mockConn._socket = mockSocket;
mockConn._setState(CLIENT_STATE.CONNECTED);
assert(mockConn.isConnected === true, 'Connection is connected after setup');

// Send while connected → goes directly to socket
mockSentData = null;
mockConn.send({ type: 'DIRECT_SEND', value: 123 });
assert(mockSentData !== null, 'Message sent directly when connected');
assertEqual(mockSentData.type, 'DIRECT_SEND', 'Correct message type sent');
assertEqual(mockSentData.value, 123, 'Correct message value sent');
assert(mockConn.queueSize === 0, 'No queuing when connected');

// ─── Group 8: WSConnection — Message Handling ──────────────────

console.log('\nGroup 8: WSConnection message handling');

const handleConn = new WSConnection({ url: 'ws://test', wsFactory: null });
let welcomeData = null;
let errorData = null;

handleConn.on('WELCOME', (data) => { welcomeData = data; });
handleConn.on('ERROR', (data) => { errorData = data; });

// Simulate receiving messages
handleConn._handleMessage({ type: 'WELCOME', sessionId: 'test123', players: [] });
assert(welcomeData !== null, 'WELCOME handler called');
assertEqual(welcomeData.sessionId, 'test123', 'WELCOME data passed through');

handleConn._handleMessage({ type: 'ERROR', message: 'Test error' });
assert(errorData !== null, 'ERROR handler called');
assertEqual(errorData.message, 'Test error', 'ERROR data passed through');

// Invalid messages ignored
let invalidHandled = false;
handleConn.on('NONEXISTENT', () => { invalidHandled = true; });
handleConn._handleMessage({ type: 'UNKNOWN_TYPE' });
assert(invalidHandled === false, 'Unknown message type does not trigger handlers');

// Messages without type ignored
handleConn._handleMessage({ data: 'no type' });
handleConn._handleMessage(null);
assert(true, 'Messages without type handled gracefully');

// Heartbeat ACK clears timeout (doesn't emit to handlers)
let heartbeatAckEmitted = false;
handleConn.on('HEARTBEAT_ACK', () => { heartbeatAckEmitted = true; });
handleConn._handleMessage({ type: 'HEARTBEAT_ACK' });
assert(heartbeatAckEmitted === false, 'HEARTBEAT_ACK does not emit to handlers');

// ─── Group 9: WSConnection — State Transitions ────────────────

console.log('\nGroup 9: WSConnection state transitions');

const stateConn = new WSConnection({ url: 'ws://test', wsFactory: null });
let stateChanges = [];

stateConn.on('stateChange', (data) => {
  stateChanges.push({ from: data.from, to: data.to });
});

// DISCONNECTED → CONNECTING
stateConn._setState(CLIENT_STATE.CONNECTING);
assertEqual(stateConn.state, CLIENT_STATE.CONNECTING, 'State changed to CONNECTING');
assert(stateChanges.length === 1, 'One state change emitted');
assertEqual(stateChanges[0].from, CLIENT_STATE.DISCONNECTED, 'From DISCONNECTED');
assertEqual(stateChanges[0].to, CLIENT_STATE.CONNECTING, 'To CONNECTING');

// CONNECTING → CONNECTED
stateConn._setState(CLIENT_STATE.CONNECTED);
assertEqual(stateConn.state, CLIENT_STATE.CONNECTED, 'State changed to CONNECTED');
assert(stateChanges.length === 2, 'Two state changes total');

// Same state transition doesn't emit
const prevLen = stateChanges.length;
stateConn._setState(CLIENT_STATE.CONNECTED);
assert(stateChanges.length === prevLen, 'Same state does not emit change event');

// CONNECTED → RECONNECTING
stateConn._setState(CLIENT_STATE.RECONNECTING);
assertEqual(stateConn.state, CLIENT_STATE.RECONNECTING, 'State changed to RECONNECTING');

// RECONNECTING → DISCONNECTED
stateConn._setState(CLIENT_STATE.DISCONNECTED);
assertEqual(stateConn.state, CLIENT_STATE.DISCONNECTED, 'State changed to DISCONNECTED');

// ─── Group 10: WSConnection — Reconnect Delay Calculation ─────

console.log('\nGroup 10: Reconnect delay calculation');

const delayConn = new WSConnection({ url: 'ws://test', wsFactory: null });

// First attempt: ~1s base
delayConn._reconnectAttempts = 0;
let delay = delayConn._calculateReconnectDelay();
assert(delay >= 500 && delay <= 2000, `First reconnect delay reasonable (${delay}ms)`);

// Second attempt: ~2s
delayConn._reconnectAttempts = 1;
delay = delayConn._calculateReconnectDelay();
assert(delay >= 750 && delay <= 4000, `Second reconnect delay reasonable (${delay}ms)`);

// Many attempts: capped at max (30s)
delayConn._reconnectAttempts = 20;
delay = delayConn._calculateReconnectDelay();
assert(delay <= 30000 * 1.25, `Max reconnect delay capped (${delay}ms)`);

// ─── Group 11: WSConnection — Dispose ──────────────────────────

console.log('\nGroup 11: WSConnection dispose');

const disposeConn = new WSConnection({ url: 'ws://test', wsFactory: null });
disposeConn.send({ type: 'PRE_DISPOSE' });
assert(disposeConn.queueSize === 1, 'Message queued before dispose');

disposeConn.dispose();
assert(disposeConn.queueSize === 0, 'Queue cleared after dispose');

// Send after dispose is no-op
disposeConn.send({ type: 'POST_DISPOSE' });
assert(disposeConn.queueSize === 0, 'Send after dispose is no-op');

// ─── Group 12: MultiplayerClient — Construction ────────────────

console.log('\nGroup 12: MultiplayerClient construction');

const mpClient = new MultiplayerClient({
  host: '10.0.30.157',
  matchmakingPort: 8765,
});

assertEqual(mpClient.host, '10.0.30.157', 'Host stored correctly');
assertEqual(mpClient.matchmakingPort, 8765, 'Matchmaking port stored correctly');
assert(mpClient.isMatchmakingConnected === false, 'Not connected initially');
assert(mpClient.isGameSessionConnected === false, 'No game session initially');
assert(mpClient.currentSessionId === null, 'No current session');
assert(mpClient.playerId === null, 'No player ID yet');

// ─── Group 13: MultiplayerClient — Event Registration ──────────

console.log('\nGroup 13: MultiplayerClient event registration');

const mpClient2 = new MultiplayerClient({ host: 'localhost' });

// Matchmaking handlers
let browseResult = null;
mpClient2.onMatchmaking('SESSION_LIST', (data) => { browseResult = data; });

// Simulate internal emit
mpClient2._emitMatchmaking('SESSION_LIST', { sessions: [{ id: 's1' }] });
assert(browseResult !== null, 'Matchmaking handler called');
assertEqual(browseResult.sessions.length, 1, 'Correct session data passed');

// Game handlers
let playerMoveData = null;
mpClient2.onGame('PLAYER_MOVE', (data) => { playerMoveData = data; });
mpClient2._emitGame('PLAYER_MOVE', { playerId: 'p1', position: { x: 1, y: 2, z: 3 } });
assert(playerMoveData !== null, 'Game handler called');
assertEqual(playerMoveData.playerId, 'p1', 'Correct player move data');

// Off matchmaking handler
let offMPCalled = false;
const mpCb = () => { offMPCalled = true; };
mpClient2.onMatchmaking('OFF_TEST', mpCb);
mpClient2.offMatchmaking('OFF_TEST', mpCb);
mpClient2._emitMatchmaking('OFF_TEST', {});
assert(offMPCalled === false, 'Handler removed via offMatchmaking');

// Off game handler
let offGameCalled = false;
const gameCb = () => { offGameCalled = true; };
mpClient2.onGame('OFF_GAME', gameCb);
mpClient2.offGame('OFF_GAME', gameCb);
mpClient2._emitGame('OFF_GAME', {});
assert(offGameCalled === false, 'Handler removed via offGame');

// ─── Group 14: MultiplayerClient — Actions (no connection) ─────

console.log('\nGroup 14: MultiplayerClient actions without connection');

const mpClient3 = new MultiplayerClient({ host: 'localhost' });

// These should be no-ops when not connected (no crash)
mpClient3.browseSessions();
assert(true, 'browseSessions() does not crash without connection');

mpClient3.hostSession('Test', 12345, 'survival');
assert(true, 'hostSession() does not crash without connection');

mpClient3.joinSession('session_abc');
assertEqual(mpClient3.currentSessionId, 'session_abc', 'joinSession sets currentSessionId even without connection');

mpClient3.sendMove({ x: 1, y: 2, z: 3 }, { yaw: 0, pitch: 0 });
assert(true, 'sendMove() does not crash without game session');

mpClient3.breakBlock(10, 20, 30);
assert(true, 'breakBlock() does not crash without game session');

mpClient3.placeBlock(10, 20, 30, 3);
assert(true, 'placeBlock() does not crash without game session');

mpClient3.sendInventory({ slots: [] });
assert(true, 'sendInventory() does not crash without game session');

// ─── Group 15: MultiplayerClient — Disconnect / Dispose ────────

console.log('\nGroup 15: MultiplayerClient disconnect and dispose');

const mpClient4 = new MultiplayerClient({ host: 'localhost' });
mpClient4.onMatchmaking('TEST', () => {});
mpClient4.onGame('TEST', () => {});

mpClient4.disconnect();
assert(true, 'disconnect() does not crash with no connections');

mpClient4.dispose();
assert(mpClient4._disposed === true, 'Disposed flag set');

// Actions after dispose should be no-ops
mpClient4.browseSessions();
mpClient4.hostSession('X', 1, 'survival');
assert(true, 'Actions after dispose are no-ops');

// ─── Group 16: Protocol Consistency ────────────────────────────

console.log('\nGroup 16: Protocol consistency with server');

// Verify client message types match server expectations (from session.js)
const serverSessionTypes = ['JOIN', 'LEAVE', 'MOVE', 'BREAK_BLOCK', 'PLACE_BLOCK', 'INVENTORY_UPDATE', 'QUEST_UPDATE', 'HEARTBEAT'];
for (const t of serverSessionTypes) {
  assert(MESSAGE_TYPES[t] === t, `Client MESSAGE_TYPES.${t} matches server`);
}

// Verify matchmaking message types match server expectations (from matchmaking.js)
const serverMMTypes = ['HOST', 'BROWSE', 'JOIN', 'LEAVE'];
for (const t of serverMMTypes) {
  assert(MESSAGE_TYPES[t] === t, `Client MESSAGE_TYPES.${t} matches matchmaking server`);
}

// Verify server response types are defined on client
const serverResponseTypes = ['WELCOME', 'PLAYER_JOINED', 'PLAYER_LEFT', 'PLAYER_MOVE', 'BLOCK_BREAK', 'BLOCK_PLACE', 'INVENTORY_SYNC', 'CHUNK_DATA', 'ERROR'];
for (const t of serverResponseTypes) {
  assert(MESSAGE_TYPES[t] === t, `Client has MESSAGE_TYPES.${t} for server responses`);
}

// ─── Group 17: Edge Cases ──────────────────────────────────────

console.log('\nGroup 17: Edge cases');

// MessageQueue with size 0 — should handle gracefully
const zeroQueue = new MessageQueue(0);
zeroQueue.enqueue({ type: 'X' });
assert(zeroQueue.size <= 1, 'Zero-size queue handles enqueue without crash');

// WSConnection connect() called twice
const doubleConn = new WSConnection({ url: 'ws://test', wsFactory: null });
doubleConn.connect();
doubleConn.connect(); // Should be no-op
assertEqual(doubleConn.state, CLIENT_STATE.DISCONNECTED, 'Double connect handled gracefully');

// Convenience methods with default values
const defaultConn = new WSConnection({ url: 'ws://test', wsFactory: null });
defaultConn.sendJoin();
const defaultJoin = defaultConn._queue.peek().data;
assertEqual(defaultJoin.type, 'JOIN', 'sendJoin works without arguments');
assertEqual(defaultJoin.character.name, 'Player', 'Default character name');

defaultConn.sendMove();
const defaultMove = defaultConn._queue.peek().data;
assertEqual(defaultMove.position.x, 0, 'Default position is zero');

// Handler error doesn't break event system
const errConn = new WSConnection({ url: 'ws://test', wsFactory: null });
let afterErrorCalled = false;
errConn.on('ERR_TEST', () => { throw new Error('boom'); });
errConn.on('ERR_TEST', () => { afterErrorCalled = true; });
errConn._emit('ERR_TEST', {});
assert(afterErrorCalled === true, 'Handler errors do not prevent subsequent handlers from running');

// ─── Group 18: MultiplayerClient — Protocol Helper Methods ─────

console.log('\nGroup 18: MultiplayerClient protocol helpers');

const mpHelper = new MultiplayerClient({ host: 'localhost' });

// joinGame with all parameters
mpHelper._playerId = 'test_player';
// Without game session connection, this is a no-op (no crash)
mpHelper.joinGame({ name: 'Hero', color: '#00ff00' }, { x: 0, y: 20, z: 0 }, { yaw: 0, pitch: 0 });
assert(true, 'joinGame() does not crash without game session connection');

// ─── Group 19: Message Queue Ordering Guarantee ────────────────

console.log('\nGroup 19: Message queue ordering guarantee');

const orderQueue = new MessageQueue(100);
const messages = [];
for (let i = 0; i < 50; i++) {
  messages.push({ type: `MSG_${i}`, index: i });
  orderQueue.enqueue(messages[i]);
}
assert(orderQueue.size === 50, 'All 50 messages enqueued');

// Dequeue and verify FIFO order
let allInOrder = true;
for (let i = 0; i < 50; i++) {
  const item = orderQueue.dequeue();
  if (item.data.index !== i) {
    allInOrder = false;
    break;
  }
}
assert(allInOrder, 'Messages dequeued in FIFO order');
assert(orderQueue.isEmpty === true, 'Queue empty after full dequeue');

// ─── Group 20: Client State Object ─────────────────────────────

console.log('\nGroup 20: MultiplayerClient state object');

const mpState = new MultiplayerClient({ host: 'localhost' });
assert(mpState.state.matchmaking === CLIENT_STATE.DISCONNECTED, 'Matchmaking state initialized');
assert(mpState.state.gameSession === CLIENT_STATE.DISCONNECTED, 'Game session state initialized');

// ─── Summary ────────────────────────────────────────────────────

console.log('\n===================================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
console.log('===================================');

if (failCount > 0) {
  console.error('\n❌ Failures:');
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
} else {
  console.log('\n🎉 All multiplayer client tests passing!');
  process.exit(0);
}
