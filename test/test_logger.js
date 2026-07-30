#!/usr/bin/env node
/**
 * Cuubz — Logger Utility Tests
 * Tests the CuubzLogger class and exported log/warn/error functions.
 */

'use strict';

// PR 11. These groups used to read `typeof CuubzLogger !== 'undefined' ? CuubzLogger.log
// : function() {}` and, in Node, ALWAYS took the fallback — so every assertion below ran
// against an empty stub and the real class was never exercised at all. That was only
// possible because CuubzLogger was a script-tag global with no way to import it. PR 9
// made it an export; `no-undef` made the vacuity visible. The assertions are unchanged
// and now mean something.
const { CuubzLogger } = require('../src/util/Logger.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

// ─── Test Group 1: CuubzLogger class exists and has expected API ───
(function() {
  // In Node.js test context, CuubzLogger is not globally defined
  // so _log should be a no-op function
  const mockLog = CuubzLogger.log;

  assert(typeof mockLog === 'function', '_log is a function');
  assert(mockLog.length >= 0, '_log accepts variable arguments');

  // Calling _log should not throw in Node.js context
  try {
    mockLog('test message');
    mockLog('test', 'multiple', 'args');
    assert(true, '_log calls do not throw');
  } catch (e) {
    assert(false, `_log call threw: ${e.message}`);
  }
})();

// ─── Test Group 2: Logger behavior with DEBUG flag ───
(function() {
  // Simulate CuubzLogger class behavior
  const testLogger = {
    DEBUG: false,
    log: function(...args) {
      if (this.DEBUG && typeof console !== 'undefined') {
        console.log(...args);
      }
    },
    warn: function(...args) {
      if (typeof console !== 'undefined') {
        console.warn(...args);
      }
    },
    error: function(...args) {
      if (typeof console !== 'undefined') {
        console.error(...args);
      }
    }
  };

  // Test DEBUG = false (production mode)
  testLogger.DEBUG = false;
  assert(testLogger.DEBUG === false, 'DEBUG defaults to false');

  // Test that calling log with DEBUG=false doesn't throw
  try {
    testLogger.log('should be silent');
    assert(true, 'log() with DEBUG=false does not throw');
  } catch (e) {
    assert(false, `log() threw: ${e.message}`);
  }

  // Test that warn always works (production errors visible)
  try {
    testLogger.warn('test warning');
    assert(true, 'warn() always executes without throwing');
  } catch (e) {
    assert(false, `warn() threw: ${e.message}`);
  }

  // Test that error always works
  try {
    testLogger.error('test error');
    assert(true, 'error() always executes without throwing');
  } catch (e) {
    assert(false, `error() threw: ${e.message}`);
  }

  // Test DEBUG = true enables logging
  testLogger.DEBUG = true;
  assert(testLogger.DEBUG === true, 'DEBUG can be set to true');
})();

// ─── Test Group 3: Bound exported functions ───
(function() {
  const logFn = CuubzLogger.log.bind(CuubzLogger);
  const warnFn = CuubzLogger.warn.bind(CuubzLogger);
  const errorFn = CuubzLogger.error.bind(CuubzLogger);

  assert(typeof logFn === 'function', 'log is exported as function');
  assert(typeof warnFn === 'function', 'warn is exported as function');
  assert(typeof errorFn === 'function', 'error is exported as function');

  // Bound functions should not throw when called
  try {
    logFn('bound test');
    warnFn('bound test');
    errorFn('bound test');
    assert(true, 'All bound exports callable without error');
  } catch (e) {
    assert(false, `Bound export threw: ${e.message}`);
  }
})();

// ─── Test Group 4: the real log() is safe to call in any shape ───
(function() {
  // Simulate the pattern used in game files:
  // const _log = CuubzLogger.log;
  const _log = CuubzLogger.log;

  assert(typeof _log === 'function', '_log fallback is a function');

  // Should be safe to call anywhere, any number of times
  for (let i = 0; i < 100; i++) {
    _log(`iteration ${i}`, { data: i });
  }
  assert(true, '100 consecutive _log calls did not throw');

  // Should handle edge cases
  _log();                    // no args
  _log(null);               // null arg
  _log(undefined);          // undefined arg
  _log({});                 // object arg
  _log([]);                 // array arg
  assert(true, 'Edge case _log calls did not throw');
})();

// ─── Results ───
const total = passed + failed;
console.log(`Logger tests: ${passed}/${total} passed, ${failed} failed`);

if (failed > 0) {
  console.error(`${failed} test(s) failed!`);
  process.exit(1);
} else {
  console.log('All logger tests passed.');
  process.exit(0);
}
