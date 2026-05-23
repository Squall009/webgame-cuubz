#!/usr/bin/env node
/**
 * Cuubz — Test Framework Validation
 * Simple assertion framework + validation that tests can run.
 */

'use strict';

// ============================================================
// Mini Test Framework
// ============================================================

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
    console.log(`  ❌ ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message}: expected ${expected}, got ${actual}`);
}

function assertApprox(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, `${message}: expected ~${expected}, got ${actual} (diff: ${diff.toFixed(4)})`);
}

function assertTrue(condition, message) {
  assert(condition === true, message);
}

function assertFalse(condition, message) {
  assert(condition === false, message);
}

function assertNotNull(value, message) {
  assert(value !== null && value !== undefined, message);
}

function assertGreaterThan(actual, threshold, message) {
  assert(actual > threshold, `${message}: expected > ${threshold}, got ${actual}`);
}

// ============================================================
// Tests: Framework Validation
// ============================================================

console.log('Test Framework Validation');
console.log('========================\n');

// Test basic assertion works
assert(true, 'Basic true assertion passes');
assert(1 === 1, 'Equality check works');
assert('hello' === 'hello', 'String comparison works');

// Test numeric assertions
assertEquals(42, 42, 'Number equality');
assertEquals('test', 'test', 'String equality');

// Test approximation
assertApprox(0.333333, 1/3, 0.001, 'Floating point approximation');
assertApprox(3.14159, Math.PI, 0.001, 'PI approximation');

// Test boolean assertions
assertTrue(true, 'True assertion passes');
assertFalse(false, 'False assertion passes');

// Test null check
assertNotNull({ key: 'value' }, 'Object is not null');
assertNotNull(42, 'Number is not null');

// Test greater than
assertGreaterThan(10, 5, 'Greater than comparison');

console.log('\n========================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All framework tests passing!');
  process.exit(0);
}
