#!/usr/bin/env node
/**
 * Cuubz — Day/Night Cycle Tests
 * Tests for js/renderer/skybox.js (pure functions + Skybox class)
 */

'use strict';

// ============================================================
// Test Framework
// ============================================================

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) { passCount++; console.log(`  ✅ ${message}`); }
  else { failCount++; failures.push(message); console.log(`  ❌ ${message}`); }
}
function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message}: expected ${expected}, got ${actual}`);
}
function assertApprox(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, `${message}: expected ~${expected}, got ${actual} (diff: ${diff.toFixed(4)})`);
}
function assertTrue(condition, message) { assert(condition === true, message); }
function assertFalse(condition, message) { assert(condition === false, message); }
function assertNotNull(value, message) { assert(value !== null && value !== undefined, message); }
function assertGreaterThan(actual, threshold, message) {
  assert(actual > threshold, `${message}: expected > ${threshold}, got ${actual}`);
}
function assertLessThan(actual, threshold, message) {
  assert(actual < threshold, `${message}: expected < ${threshold}, got ${actual}`);
}

// ============================================================
// Load Module
// ============================================================

const Skybox = require('../js/renderer/skybox.js');
const {
  smoothstep, lerp, lerpColor, hexToRGB,
  hoursToFraction, fractionToHours,
  getSkyColorForTime, isDaytime, getSkyPhase,
  getFogDensityForTime, getAmbientIntensityForTime,
  getSunAngleForTime, getMoonAngleForTime,
  getSunElevation, getMoonElevation,
  getSunColorForTime, getSunIntensity, getMoonIntensity,
  getTimeOfDayLabel, formatGameTime,
  DEFAULT_CYCLE_DURATION, FOG_DENSITY_DAY, FOG_DENSITY_NIGHT,
  AMBIENT_LIGHT, SKY_COLORS,
} = Skybox;

console.log('Skybox & Day/Night Cycle Tests');
console.log('================================\n');

// ============================================================
// Group 1: Constants
// ============================================================

console.log('--- Group 1: Constants ---');

assertEquals(DEFAULT_CYCLE_DURATION, 300, 'Default cycle is 300s (5 min)');
assertEquals(FOG_DENSITY_DAY, 0.008, 'Day fog density = 0.008');
assertEquals(FOG_DENSITY_NIGHT, 0.025, 'Night fog density = 0.025');
assertGreaterThan(FOG_DENSITY_NIGHT, FOG_DENSITY_DAY, 'Night fog > day fog');

assertEquals(AMBIENT_LIGHT.dayIntensity, 0.45, 'Day ambient intensity = 0.45');
assertEquals(AMBIENT_LIGHT.nightIntensity, 0.08, 'Night ambient intensity = 0.08');
assertGreaterThan(AMBIENT_LIGHT.dayIntensity, AMBIENT_LIGHT.nightIntensity, 'Day ambient > night ambient');

assertTrue(SKY_COLORS.midnight === 0x0a0a2e, 'Midnight sky color defined');
assertTrue(SKY_COLORS.day === 0x87CEEB, 'Day sky color defined');
assertTrue(SKY_COLORS.sunrise === 0xff6b35, 'Sunrise sky color defined');

// ============================================================
// Group 2: smoothstep()
// ============================================================

console.log('\n--- Group 2: smoothstep() ---');

assertEquals(smoothstep(0), 0, 'smoothstep(0) = 0');
assertEquals(smoothstep(1), 1, 'smoothstep(1) = 1');
assertApprox(smoothstep(0.5), 0.5, 0.001, 'smoothstep(0.5) ≈ 0.5');
assertApprox(smoothstep(0.25), 0.15625, 0.001, 'smoothstep(0.25) ≈ 0.156');
assertEquals(smoothstep(-1), 0, 'smoothstep clamps negative to 0');
assertEquals(smoothstep(2), 1, 'smoothstep clamps >1 to 1');

// ============================================================
// Group 3: lerp()
// ============================================================

console.log('\n--- Group 3: lerp() ---');

assertEquals(lerp(0, 10, 0), 0, 'lerp at t=0 returns start');
assertEquals(lerp(0, 10, 1), 10, 'lerp at t=1 returns end');
assertEquals(lerp(0, 10, 0.5), 5, 'lerp at t=0.5 returns midpoint');
assertEquals(lerp(-5, 5, 0.5), 0, 'lerp with negative start');
assertEquals(lerp(0, 10, -0.5), 0, 'lerp clamps t<0 to 0');
assertEquals(lerp(0, 10, 1.5), 10, 'lerp clamps t>1 to 1');

// ============================================================
// Group 4: hexToRGB()
// ============================================================

console.log('\n--- Group 4: hexToRGB() ---');

const white = hexToRGB(0xffffff);
assertApprox(white.r, 1, 0.001, 'White R=1');
assertApprox(white.g, 1, 0.001, 'White G=1');
assertApprox(white.b, 1, 0.001, 'White B=1');

const red = hexToRGB(0xff0000);
assertApprox(red.r, 1, 0.001, 'Red R=1');
assertEquals(red.g, 0, 'Red G=0');
assertEquals(red.b, 0, 'Red B=0');

const black = hexToRGB(0x000000);
assertEquals(black.r, 0, 'Black R=0');
assertEquals(black.g, 0, 'Black G=0');
assertEquals(black.b, 0, 'Black B=0');

// ============================================================
// Group 5: lerpColor()
// ============================================================

console.log('\n--- Group 5: lerpColor() ---');

assertEquals(lerpColor(0xff0000, 0xff0000, 0.5), 0xff0000, 'Same colors return same');
assertEquals(lerpColor(0x000000, 0xffffff, 0), 0x000000, 'Black at t=0');
assertEquals(lerpColor(0x000000, 0xffffff, 1), 0xffffff, 'White at t=1');

// Red to green midpoint
const rgMid = lerpColor(0xff0000, 0x00ff00, 0.5);
assertApprox((rgMid >> 16) & 0xff, 128, 2, 'Red→Green: R≈128');
assertApprox((rgMid >> 8) & 0xff, 128, 2, 'Red→Green: G≈128');
assertEquals(rgMid & 0xff, 0, 'Red→Green: B=0');

// ============================================================
// Group 6: hoursToFraction / fractionToHours
// ============================================================

console.log('\n--- Group 6: Time Conversion ---');

assertApprox(hoursToFraction(0), 0, 0.001, 'Hour 0 → fraction 0');
assertApprox(hoursToFraction(12), 0.5, 0.001, 'Hour 12 → fraction 0.5');
assertApprox(hoursToFraction(24), 0, 0.001, 'Hour 24 → fraction 0 (wrap)');
assertApprox(hoursToFraction(-6), 0.75, 0.001, 'Hour -6 → fraction 0.75 (wrap)');

assertApprox(fractionToHours(0), 0, 0.001, 'Fraction 0 → hour 0');
assertApprox(fractionToHours(0.5), 12, 0.001, 'Fraction 0.5 → hour 12');
assertApprox(fractionToHours(1), 0, 0.001, 'Fraction 1 → hour 0 (wrap)');

// Round-trip
const rt = fractionToHours(hoursToFraction(15));
assertApprox(rt, 15, 0.01, 'Round-trip: hour 15 → fraction → hour 15');

// ============================================================
// Group 7: getSkyColorForTime()
// ============================================================

console.log('\n--- Group 7: Sky Colors ---');

assertEquals(getSkyColorForTime(12), SKY_COLORS.day, 'Noon = day sky color');
assertEquals(getSkyColorForTime(0), SKY_COLORS.night, 'Midnight = night sky color');
assertEquals(getSkyColorForTime(3), SKY_COLORS.night, '3AM = night sky color');

// Daytime is stable blue
assertEquals(getSkyColorForTime(8), SKY_COLORS.day, '8AM = day color');
assertEquals(getSkyColorForTime(10), SKY_COLORS.day, '10AM = day color');
assertEquals(getSkyColorForTime(16), SKY_COLORS.day, '4PM = day color');

// Transitions produce different colors
const sunriseColor = getSkyColorForTime(6.5);
assert(sunriseColor !== SKY_COLORS.night && sunriseColor !== SKY_COLORS.day, 'Sunrise is transitional color');

const duskColor = getSkyColorForTime(19.5);
assert(duskColor !== SKY_COLORS.day && duskColor !== SKY_COLORS.night, 'Dusk is transitional color');

// Hour wrapping
assertEquals(getSkyColorForTime(24), SKY_COLORS.night, 'Hour 24 wraps to midnight');
assertEquals(getSkyColorForTime(-12), SKY_COLORS.day, 'Hour -12 wraps to noon');

// ============================================================
// Group 8: isDaytime()
// ============================================================

console.log('\n--- Group 8: isDaytime() ---');

assertTrue(isDaytime(7), 'Hour 7 is daytime');
assertTrue(isDaytime(12), 'Hour 12 is daytime');
assertTrue(isDaytime(18), 'Hour 18 is daytime');
assertFalse(isDaytime(6), 'Hour 6 is not daytime (pre-dawn)');
assertFalse(isDaytime(0), 'Hour 0 is not daytime');
assertFalse(isDaytime(3), 'Hour 3 is not daytime');
assertFalse(isDaytime(20), 'Hour 20 is not daytime');
assertFalse(isDaytime(23), 'Hour 23 is not daytime');

// ============================================================
// Group 9: getSkyPhase()
// ============================================================

console.log('\n--- Group 9: Sky Phases ---');

assertEquals(getSkyPhase(0), 'night', 'Hour 0 = night');
assertEquals(getSkyPhase(3), 'night', 'Hour 3 = night');
assertEquals(getSkyPhase(5), 'dawn', 'Hour 5 = dawn');
assertEquals(getSkyPhase(6), 'dawn', 'Hour 6 = dawn');
assertEquals(getSkyPhase(7), 'day', 'Hour 7 = day');
assertEquals(getSkyPhase(12), 'day', 'Hour 12 = day');
assertEquals(getSkyPhase(16), 'day', 'Hour 16 = day');
assertEquals(getSkyPhase(17), 'sunset', 'Hour 17 = sunset');
assertEquals(getSkyPhase(18), 'sunset', 'Hour 18 = sunset');
assertEquals(getSkyPhase(19), 'dusk', 'Hour 19 = dusk');
assertEquals(getSkyPhase(20), 'night', 'Hour 20 = night');

// ============================================================
// Group 10: Fog Density
// ============================================================

console.log('\n--- Group 10: Fog Density ---');

assertEquals(getFogDensityForTime(12), FOG_DENSITY_DAY, 'Noon fog = day density');
assertEquals(getFogDensityForTime(0), FOG_DENSITY_NIGHT, 'Midnight fog = night density');

// Dawn transition produces intermediate value
const dawnFog = getFogDensityForTime(6);
assertGreaterThan(dawnFog, FOG_DENSITY_DAY, 'Dawn fog > day fog');
assertLessThan(dawnFog, FOG_DENSITY_NIGHT, 'Dawn fog < night fog');

// Dusk transition produces intermediate value
const duskFog = getFogDensityForTime(17);
assertGreaterThan(duskFog, FOG_DENSITY_DAY, 'Dusk fog > day fog');
assertLessThan(duskFog, FOG_DENSITY_NIGHT, 'Dusk fog < night fog');

// ============================================================
// Group 11: Ambient Light Intensity
// ============================================================

console.log('\n--- Group 11: Ambient Intensity ---');

assertEquals(getAmbientIntensityForTime(12), AMBIENT_LIGHT.dayIntensity, 'Noon ambient = day intensity');
assertEquals(getAmbientIntensityForTime(0), AMBIENT_LIGHT.nightIntensity, 'Midnight ambient = night intensity');

// Dawn transition
const dawnAmbient = getAmbientIntensityForTime(6);
assertGreaterThan(dawnAmbient, AMBIENT_LIGHT.nightIntensity, 'Dawn ambient > night');
assertLessThan(dawnAmbient, AMBIENT_LIGHT.dayIntensity, 'Dawn ambient < day');

// ============================================================
// Group 12: Sun Angle & Elevation
// ============================================================

console.log('\n--- Group 12: Sun Position ---');

// At noon (hour 12), sun should be at peak
const noonElev = getSunElevation(12);
assertApprox(noonElev, 1, 0.01, 'Noon sun elevation ≈ 1 (peak)');

// At midnight (hour 0), sun below horizon
const midElev = getSunElevation(0);
assertLessThan(midElev, 0, 'Midnight sun below horizon');
assertApprox(midElev, -1, 0.01, 'Midnight sun elevation ≈ -1');

// Sunrise at hour 6: sun angle should give ~0 elevation
const riseElev = getSunElevation(6);
assertApprox(riseElev, 0, 0.1, 'Sunrise elevation near 0');

// ============================================================
// Group 13: Moon Position
// ============================================================

console.log('\n--- Group 13: Moon Position ---');

// Moon opposite sun
const moonNoon = getMoonElevation(12);
assertLessThan(moonNoon, 0, 'Moon below horizon at noon');

const moonMidnight = getMoonElevation(0);
assertGreaterThan(moonMidnight, 0, 'Moon above horizon at midnight');

// Moon angle = sun angle + PI
const sunAngle6 = getSunAngleForTime(6);
const moonAngle6 = getMoonAngleForTime(6);
assertApprox(moonAngle6 - sunAngle6, Math.PI, 0.01, 'Moon angle = sun angle + PI');

// ============================================================
// Group 14: Sun Intensity
// ============================================================

console.log('\n--- Group 14: Sun Intensity ---');

const noonSunIntensity = getSunIntensity(12);
assertGreaterThan(noonSunIntensity, 1.0, 'Noon sun intensity > 1.0');

const midnightSunIntensity = getSunIntensity(0);
assertEquals(midnightSunIntensity, 0, 'Midnight sun intensity = 0');

// Sun intensity is 0 when below horizon
for (let h = 0; h < 6; h += 2) {
  assertEquals(getSunIntensity(h), 0, `Hour ${h}: sun below horizon → intensity 0`);
}

// ============================================================
// Group 15: Moon Intensity
// ============================================================

console.log('\n--- Group 15: Moon Intensity ---');

const nightMoon = getMoonIntensity(3);
assertGreaterThan(nightMoon, 0, 'Night moon intensity > 0');

const dayMoon = getMoonIntensity(12);
assertEquals(dayMoon, 0, 'Daytime moon intensity = 0 (sun interference)');

// Moon only visible when above horizon AND sun isn't washing it out
assertLessThan(getMoonIntensity(3), 0.41, 'Moon intensity bounded ≤ 0.4');

// ============================================================
// Group 16: Sun Color
// ============================================================

console.log('\n--- Group 16: Sun Color ---');

const noonColor = getSunColorForTime(12);
assertEquals(noonColor, 0xfff5e0, 'Noon sun color is warm white');

// Near horizon = warmer color
const sunsetColor = getSunColorForTime(6.1);
assert(sunsetColor !== 0xfff5e0, 'Sunrise sun color differs from noon');

// ============================================================
// Group 17: Time Labels & Formatting
// ============================================================

console.log('\n--- Group 17: Time Labels ---');

assertEquals(getTimeOfDayLabel(0), 'Night', 'Hour 0 = Night');
assertEquals(getTimeOfDayLabel(3), 'Night', 'Hour 3 = Night');
assertEquals(getTimeOfDayLabel(6), 'Dawn', 'Hour 6 = Dawn');
assertEquals(getTimeOfDayLabel(8), 'Morning', 'Hour 8 = Morning');
assertEquals(getTimeOfDayLabel(12), 'Noon', 'Hour 12 = Noon');
assertEquals(getTimeOfDayLabel(15), 'Afternoon', 'Hour 15 = Afternoon');
assertEquals(getTimeOfDayLabel(18), 'Sunset', 'Hour 18 = Sunset');
assertEquals(getTimeOfDayLabel(19.5), 'Dusk', 'Hour 19.5 = Dusk');

// Time formatting
assertEquals(formatGameTime(0), '00:00', 'Midnight formatted as 00:00');
assertEquals(formatGameTime(12), '12:00', 'Noon formatted as 12:00');
assertEquals(formatGameTime(7.5), '07:30', '7.5 formatted as 07:30');
assertEquals(formatGameTime(6.25), '06:15', '6.25 formatted as 06:15');
assertEquals(formatGameTime(-1), '23:00', '-1 wraps to 23:00');

// ============================================================
// Group 18: Skybox Class — Constructor & Config
// ============================================================

console.log('\n--- Group 18: Skybox Constructor ---');

const sb1 = new Skybox(null);
assertEquals(sb1.timeOfDay, 12, 'Default start at noon');
assertEquals(sb1.cycleDuration, 300, 'Default cycle duration 300s');
assertApprox(sb1.speed, 24/300, 0.001, 'Speed = 24/cycleDuration');

const sb2 = new Skybox(null, { startTime: 6, cycleDuration: 600 });
assertEquals(sb2.timeOfDay, 6, 'Custom start time accepted');
assertEquals(sb2.cycleDuration, 600, 'Custom cycle duration accepted');
assertApprox(sb2.speed, 24/600, 0.001, 'Speed recalculated for custom duration');

// ============================================================
// Group 19: Skybox Class — Time Methods
// ============================================================

console.log('\n--- Group 19: Skybox Time Methods ---');

const sb3 = new Skybox(null, { startTime: 0 });
assertEquals(sb3.getTime(), 0, 'getTime returns current timeOfDay');

sb3.setTime(12);
assertEquals(sb3.getTime(), 12, 'setTime updates timeOfDay');

// Hour wrapping in setTime
sb3.setTime(25);
assertApprox(sb3.getTime(), 1, 0.01, 'setTime(25) wraps to 1');

sb3.setTime(-6);
assertEquals(sb3.getTime(), 18, 'setTime(-6) wraps to 18');

// ============================================================
// Group 20: Skybox Class — Phase Detection
// ============================================================

console.log('\n--- Group 20: Skybox Phase/Day Methods ---');

const sb4 = new Skybox(null, { startTime: 12 });
assertEquals(sb4.getPhase(), 'day', 'Noon phase = day');
assertTrue(sb4.isDay(), 'Noon is daytime');
assertEquals(sb4.getTimeLabel(), 'Noon', 'Noon time label');
assertEquals(sb4.getFormattedTime(), '12:00', 'Noon formatted time');

sb4.setTime(3);
assertEquals(sb4.getPhase(), 'night', '3AM phase = night');
assertFalse(sb4.isDay(), '3AM is not daytime');
assertEquals(sb4.getTimeLabel(), 'Night', '3AM time label');

sb4.setTime(6);
assertEquals(sb4.getPhase(), 'dawn', '6AM phase = dawn');
assertFalse(sb4.isDay(), '6AM (dawn) is not daytime per isDaytime()');

// ============================================================
// Group 21: Skybox Class — Cycle Duration Management
// ============================================================

console.log('\n--- Group 21: Cycle Duration ---');

const sb5 = new Skybox(null);
assertEquals(sb5.getCycleDuration(), 300, 'Initial cycle duration 300');

sb5.setCycleDuration(600);
assertEquals(sb5.getCycleDuration(), 600, 'setCycleDuration updates value');
assertApprox(sb5.speed, 24/600, 0.001, 'Speed recalculated');

// Minimum 60s enforced
sb5.setCycleDuration(10);
assertEquals(sb5.getCycleDuration(), 60, 'Minimum cycle duration = 60s');

// ============================================================
// Group 22: Skybox Class — update() Simulation
// ============================================================

console.log('\n--- Group 22: Update Simulation ---');

const sb6 = new Skybox(null, { startTime: 0, cycleDuration: 300 });

// 60s of real time at 300s cycle = 4.8 game hours
sb6.update(60);
assertApprox(sb6.getTime(), 4.8, 0.1, 'After 60s → ~4.8 hours');

// Another 240s (total 300s = full cycle)
sb6.update(240);
assertApprox(sb6.getTime(), 0, 0.1, 'Full cycle wraps to 0');

// ============================================================
// Group 23: Skybox Class — getStateSummary()
// ============================================================

console.log('\n--- Group 23: State Summary ---');

const sb7 = new Skybox(null, { startTime: 12 });
const summary = sb7.getStateSummary();

assertNotNull(summary.timeOfDay, 'Summary has timeOfDay');
assertEquals(summary.phase, 'day', 'Summary phase = day');
assertTrue(summary.isDay, 'Summary isDay = true');
assertEquals(summary.cycleDuration, 300, 'Summary cycleDuration correct');
assertGreaterThan(summary.sunIntensity, 1.0, 'Noon sun intensity > 1');
assertEquals(summary.moonIntensity, 0, 'Noon moon intensity = 0');

// ============================================================
// Group 24: Skybox Class — init() Safety (No Browser)
// ============================================================

console.log('\n--- Group 24: init() Safety ---');

const sb8 = new Skybox(null);
sb8.init(); // Should not throw with null renderer
assertEquals(sb8.sunLight, null, 'init returns early without renderer');

const sb9 = new Skybox({});
sb9.init(); // Should not throw without scene
assertEquals(sb9.sunLight, null, 'init returns early without scene');

// ============================================================
// Group 25: Skybox Class — dispose() Safety
// ============================================================

console.log('\n--- Group 25: dispose() Safety ---');

const sb10 = new Skybox(null);
sb10.dispose(); // Should not throw with null renderer
assert(sb10.sunLight === null, 'dispose handles null safely');

// ============================================================
// Group 26: Full Day/Night Cycle Simulation
// ============================================================

console.log('\n--- Group 26: Full Cycle Simulation ---');

const sbFull = new Skybox(null, { startTime: 0, cycleDuration: 300 });
const stepSize = 300 / 24; // 12.5s per game hour
const phases = [];

for (let i = 0; i < 24; i++) {
  sbFull.update(stepSize);
  const summary = sbFull.getStateSummary();
  phases.push(summary.phase);
}

// Verify all phases appear
const phaseCounts = {};
phases.forEach(p => phaseCounts[p] = (phaseCounts[p] || 0) + 1);
assertTrue(phaseCounts.night > 0, 'Cycle includes night');
assertTrue(phaseCounts.dawn > 0, 'Cycle includes dawn');
assertTrue(phaseCounts.day > 0, 'Cycle includes day');
assertTrue(phaseCounts.sunset > 0, 'Cycle includes sunset');
assertTrue(phaseCounts.dusk > 0, 'Cycle includes dusk');

// Sun peaks at noon
assertGreaterThan(getSunIntensity(12), getSunIntensity(6), 'Noon sun > sunrise sun');
assertGreaterThan(getSunIntensity(12), getSunIntensity(0), 'Noon sun > midnight sun (zero)');

// Ambient follows day/night pattern
assertGreaterThan(getAmbientIntensityForTime(12), getAmbientIntensityForTime(0), 'Day ambient > night ambient');

// Fog is thicker at night
assertGreaterThan(getFogDensityForTime(0), getFogDensityForTime(12), 'Night fog > day fog');

// ============================================================
// Group 27: getTimeFraction() for Audio Integration
// ============================================================

console.log('\n--- Group 27: Time Fraction ---');

const sbFrac = new Skybox(null, { startTime: 0 });
assertApprox(sbFrac.getTimeFraction(), 0, 0.001, 'Midnight fraction ≈ 0');

sbFrac.setTime(12);
assertApprox(sbFrac.getTimeFraction(), 0.5, 0.001, 'Noon fraction = 0.5');

sbFrac.setTime(6);
assertApprox(sbFrac.getTimeFraction(), 0.25, 0.001, '6AM fraction = 0.25');

// ============================================================
// Group 28: getFogDensity() and getAmbientIntensity() on class
// ============================================================

console.log('\n--- Group 28: Instance Getters ---');

const sbGet = new Skybox(null, { startTime: 12 });
assertEquals(sbGet.getFogDensity(), FOG_DENSITY_DAY, 'Noon fog density = day value');
assertEquals(sbGet.getAmbientIntensity(), AMBIENT_LIGHT.dayIntensity, 'Noon ambient = day value');

sbGet.setTime(0);
assertEquals(sbGet.getFogDensity(), FOG_DENSITY_NIGHT, 'Midnight fog density = night value');
assertEquals(sbGet.getAmbientIntensity(), AMBIENT_LIGHT.nightIntensity, 'Midnight ambient = night value');

// ============================================================
// Results
// ============================================================

console.log('\n================================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All skybox tests passing!');
  process.exit(0);
}
