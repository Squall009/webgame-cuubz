/**
 * Cuubz — Day/Night Cycle Tests
 * Tests for js/renderer/skybox.js (pure functions + Skybox class)
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import * as SkyRenderer from '../../../src/engine/renderer/SkyRenderer.js';

it('skybox', () => legacy(async () => {
let passCount = 0, failCount = 0;
const failures = [];
function assert(c, m) { if(c){passCount++;console.log(`  ✅ ${m}`)}else{failCount++;failures.push(m);console.log(`  ❌ ${m}`)} }
function assertEquals(a,e,m){assert(a===e,`${m}: expected ${e}, got ${a}`)}
function assertApprox(a,e,t,m){const d=Math.abs(a-e);assert(d<=t,`${m}: expected ~${e}, got ${a} (diff: ${d.toFixed(4)})`)}
function assertTrue(c,m){assert(c===true,m)}
function assertFalse(c,m){assert(c===false,m)}
function assertNotNull(v,m){assert(v!==null&&v!==undefined,m)}
function assertGreaterThan(a,t,m){assert(a>t,`${m}: expected > ${t}, got ${a}`)}
function assertLessThan(a,t,m){assert(a<t,`${m}: expected < ${t}, got ${a}`)}

// PR 9: skybox.js used `module.exports = Skybox` and then hung every helper off the
// class as a property. They are ordinary named module exports now.

const Skybox = SkyRenderer.Skybox;
const {smoothstep, lerp, lerpColor, hexToRGB, hoursToFraction, fractionToHours,
  getSkyColorForTime, isDaytime, getSkyPhase, getFogDensityForTime, getAmbientIntensityForTime,
  getSunAngleForTime, getMoonAngleForTime, getSunElevation, getMoonElevation,
  getSunColorForTime, getSunIntensity, getMoonIntensity, getTimeOfDayLabel, formatGameTime,
  DEFAULT_CYCLE_DURATION, FOG_DENSITY_DAY, FOG_DENSITY_NIGHT, AMBIENT_LIGHT, SKY_COLORS} = SkyRenderer;

console.log('Skybox & Day/Night Cycle Tests');
console.log('================================\n');

// Group 1: Constants
console.log('--- Group 1: Constants ---');
assertEquals(DEFAULT_CYCLE_DURATION, 300, 'Default cycle is 300s');
assertEquals(FOG_DENSITY_DAY, 0.001, 'Day fog density = 0.001');
assertEquals(FOG_DENSITY_NIGHT, 0.003, 'Night fog density = 0.003');
assertGreaterThan(FOG_DENSITY_NIGHT, FOG_DENSITY_DAY, 'Night fog > day fog');
assertEquals(AMBIENT_LIGHT.dayIntensity, 0.45, 'Day ambient = 0.45');
assertEquals(AMBIENT_LIGHT.nightIntensity, 0.25, 'Night ambient = 0.25');
assertTrue(SKY_COLORS.midnight === 0x0a0a2e, 'Midnight sky color defined');
assertTrue(SKY_COLORS.day === 0x87CEEB, 'Day sky color defined');

// Group 2: smoothstep()
console.log('\n--- Group 2: smoothstep() ---');
assertEquals(smoothstep(0), 0, 'smoothstep(0)=0');
assertEquals(smoothstep(1), 1, 'smoothstep(1)=1');
assertApprox(smoothstep(0.5), 0.5, 0.001, 'smoothstep(0.5)≈0.5');
assertEquals(smoothstep(-1), 0, 'Clamps negative to 0');
assertEquals(smoothstep(2), 1, 'Clamps >1 to 1');

// Group 3: lerp()
console.log('\n--- Group 3: lerp() ---');
assertEquals(lerp(0, 10, 0), 0, 't=0 returns start');
assertEquals(lerp(0, 10, 1), 10, 't=1 returns end');
assertEquals(lerp(0, 10, 0.5), 5, 't=0.5 returns midpoint');
assertEquals(lerp(-5, 5, 0.5), 0, 'Negative start works');

// Group 4: hexToRGB()
console.log('\n--- Group 4: hexToRGB() ---');
const white = hexToRGB(0xffffff); assertApprox(white.r,1,0.001,'White R=1');
const red = hexToRGB(0xff0000); assertEquals(red.g,0,'Red G=0');
const black = hexToRGB(0x000000); assertEquals(black.r,0,'Black R=0');

// Group 5: lerpColor()
console.log('\n--- Group 5: lerpColor() ---');
assertEquals(lerpColor(0xff0000, 0xff0000, 0.5), 0xff0000, 'Same colors return same');
assertEquals(lerpColor(0x000000, 0xffffff, 0), 0x000000, 'Black at t=0');
assertEquals(lerpColor(0x000000, 0xffffff, 1), 0xffffff, 'White at t=1');

// Group 6: Time Conversion
console.log('\n--- Group 6: Time Conversion ---');
assertApprox(hoursToFraction(0), 0, 0.001, 'Hour 0→fraction 0');
assertApprox(hoursToFraction(12), 0.5, 0.001, 'Hour 12→fraction 0.5');
assertApprox(hoursToFraction(24), 0, 0.001, 'Hour 24 wraps to 0');
assertApprox(fractionToHours(0.5), 12, 0.001, 'Fraction 0.5→hour 12');

// Group 7: Sky Colors
console.log('\n--- Group 7: Sky Colors ---');
assertEquals(getSkyColorForTime(12), SKY_COLORS.day, 'Noon = day color');
assertEquals(getSkyColorForTime(0), SKY_COLORS.night, 'Midnight = night color');
assertEquals(getSkyColorForTime(8), SKY_COLORS.day, '8AM = day color');
const sunriseColor = getSkyColorForTime(6.5);
assert(sunriseColor !== SKY_COLORS.night && sunriseColor !== SKY_COLORS.day, 'Sunrise is transitional');
assertEquals(getSkyColorForTime(24), SKY_COLORS.night, 'Hour 24 wraps to midnight');

// Group 8: isDaytime()
console.log('\n--- Group 8: isDaytime() ---');
assertTrue(isDaytime(7), 'Hour 7 is daytime');
assertTrue(isDaytime(12), 'Hour 12 is daytime');
assertFalse(isDaytime(6), 'Hour 6 is not daytime');
assertFalse(isDaytime(0), 'Hour 0 is not daytime');
assertFalse(isDaytime(20), 'Hour 20 is not daytime');

// Group 9: Sky Phases
console.log('\n--- Group 9: Sky Phases ---');
assertEquals(getSkyPhase(0), 'night', 'Hour 0 = night');
assertEquals(getSkyPhase(5), 'dawn', 'Hour 5 = dawn');
assertEquals(getSkyPhase(7), 'day', 'Hour 7 = day');
assertEquals(getSkyPhase(12), 'day', 'Hour 12 = day');
assertEquals(getSkyPhase(17), 'sunset', 'Hour 17 = sunset');
assertEquals(getSkyPhase(19), 'dusk', 'Hour 19 = dusk');

// Group 10: Fog Density
console.log('\n--- Group 10: Fog Density ---');
assertEquals(getFogDensityForTime(12), FOG_DENSITY_DAY, 'Noon fog = day density');
assertEquals(getFogDensityForTime(0), FOG_DENSITY_NIGHT, 'Midnight fog = night density');
const dawnFog = getFogDensityForTime(6);
assertGreaterThan(dawnFog, FOG_DENSITY_DAY, 'Dawn fog > day fog');
assertLessThan(dawnFog, FOG_DENSITY_NIGHT, 'Dawn fog < night fog');

// Group 11: Ambient Intensity
console.log('\n--- Group 11: Ambient Intensity ---');
assertEquals(getAmbientIntensityForTime(12), AMBIENT_LIGHT.dayIntensity, 'Noon ambient = day');
assertEquals(getAmbientIntensityForTime(0), AMBIENT_LIGHT.nightIntensity, 'Midnight ambient = night');

// Group 12: Sun Position
console.log('\n--- Group 12: Sun Position ---');
assertApprox(getSunElevation(12), 1, 0.01, 'Noon sun at peak (1)');
assertLessThan(getSunElevation(0), 0, 'Midnight sun below horizon');
assertApprox(getSunElevation(6), 0, 0.1, 'Sunrise elevation near 0');

// Group 13: Moon Position
console.log('\n--- Group 13: Moon Position ---');
assertLessThan(getMoonElevation(12), 0, 'Moon below horizon at noon');
assertGreaterThan(getMoonElevation(0), 0, 'Moon above horizon at midnight');

// Group 14: Sun Intensity
console.log('\n--- Group 14: Sun Intensity ---');
assertGreaterThan(getSunIntensity(12), 1.0, 'Noon sun intensity > 1.0');
assertEquals(getSunIntensity(0), 0, 'Midnight sun = 0');
assertEquals(getSunIntensity(3), 0, '3AM sun = 0');

// Group 15: Moon Intensity
console.log('\n--- Group 15: Moon Intensity ---');
assertGreaterThan(getMoonIntensity(3), 0, 'Night moon > 0');
assertEquals(getMoonIntensity(12), 0, 'Daytime moon = 0 (sun interference)');
// Moon peaks around midnight when sun is farthest below horizon
assertGreaterThan(getMoonIntensity(3), getMoonIntensity(6), 'Moon stronger at 3AM than 6AM');

// Group 16: Sun Color
console.log('\n--- Group 16: Sun Color ---');
assertEquals(getSunColorForTime(12), 0xfff5e0, 'Noon sun = warm white');
assert(getSunColorForTime(6.1) !== 0xfff5e0, 'Sunrise sun differs from noon');

// Group 17: Time Labels & Formatting
console.log('\n--- Group 17: Time Labels ---');
assertEquals(getTimeOfDayLabel(0), 'Night', 'Hour 0 = Night');
assertEquals(getTimeOfDayLabel(6), 'Dawn', 'Hour 6 = Dawn');
assertEquals(getTimeOfDayLabel(8), 'Morning', 'Hour 8 = Morning');
assertEquals(getTimeOfDayLabel(12), 'Noon', 'Hour 12 = Noon');
assertEquals(getTimeOfDayLabel(15), 'Afternoon', 'Hour 15 = Afternoon');
assertEquals(getTimeOfDayLabel(18), 'Sunset', 'Hour 18 = Sunset');
assertEquals(formatGameTime(0), '00:00', 'Midnight = 00:00');
assertEquals(formatGameTime(7.5), '07:30', '7.5 = 07:30');

// Group 18: Skybox Constructor
console.log('\n--- Group 18: Skybox Constructor ---');
const sb1 = new Skybox(null);
assertEquals(sb1.timeOfDay, 12, 'Default start at noon');
assertEquals(sb1.cycleDuration, 300, 'Default cycle 300s');

const sb2 = new Skybox(null, { startTime: 6, cycleDuration: 600 });
assertEquals(sb2.timeOfDay, 6, 'Custom start time accepted');
assertEquals(sb2.cycleDuration, 600, 'Custom cycle duration accepted');

// Bug fix: startTime=0 should work (not treated as falsy)
const sbZero = new Skybox(null, { startTime: 0 });
assertEquals(sbZero.timeOfDay, 0, 'startTime=0 works (not treated as falsy)');

// Group 19: Skybox Time Methods
console.log('\n--- Group 19: Time Methods ---');
const sb3 = new Skybox(null, { startTime: 0 });
assertEquals(sb3.getTime(), 0, 'getTime returns current timeOfDay');

sb3.setTime(12);
assertEquals(sb3.getTime(), 12, 'setTime updates timeOfDay');

sb3.setTime(25);
assertApprox(sb3.getTime(), 1, 0.01, 'setTime(25) wraps to 1');

// Group 20: Skybox Phase/Day Methods
console.log('\n--- Group 20: Phase/Day Methods ---');
const sb4 = new Skybox(null, { startTime: 12 });
assertEquals(sb4.getPhase(), 'day', 'Noon phase = day');
assertTrue(sb4.isDay(), 'Noon is daytime');

sb4.setTime(3);
assertEquals(sb4.getPhase(), 'night', '3AM phase = night');
assertFalse(sb4.isDay(), '3AM not daytime');

// Group 21: Cycle Duration Management
console.log('\n--- Group 21: Cycle Duration ---');
const sb5 = new Skybox(null);
sb5.setCycleDuration(600);
assertEquals(sb5.getCycleDuration(), 600, 'setCycleDuration updates value');
sb5.setCycleDuration(10);
assertEquals(sb5.getCycleDuration(), 60, 'Minimum 60s enforced');

// Group 22: Update Simulation
console.log('\n--- Group 22: Update Simulation ---');
const sb6 = new Skybox(null, { startTime: 0, cycleDuration: 300 });
sb6.update(60);
assertApprox(sb6.getTime(), 4.8, 0.1, 'After 60s → ~4.8 hours');

// Group 23: State Summary
console.log('\n--- Group 23: State Summary ---');
const sb7 = new Skybox(null, { startTime: 12 });
const summary = sb7.getStateSummary();
assertNotNull(summary.timeOfDay, 'Summary has timeOfDay');
assertEquals(summary.phase, 'day', 'Summary phase = day');
assertTrue(summary.isDay, 'Summary isDay = true');
assertGreaterThan(summary.sunIntensity, 1.0, 'Noon sun > 1');

// Group 24: init() Safety
console.log('\n--- Group 24: init() Safety ---');
const sb8 = new Skybox(null);
sb8.init(); assertEquals(sb8.sunLight, null, 'init safe with null renderer');

const sb9 = new Skybox({});
sb9.init(); assertEquals(sb9.sunLight, null, 'init safe without scene');

// Group 25: dispose() Safety
console.log('\n--- Group 25: dispose() Safety ---');
new Skybox(null).dispose(); assert(true, 'dispose handles null safely');

// Group 26: Full Cycle Simulation
console.log('\n--- Group 26: Full Cycle ---');
const sbFull = new Skybox(null, { startTime: 0, cycleDuration: 300 });
const stepSize = 300 / 24;
const phases = [];
for (let i = 0; i < 24; i++) { sbFull.update(stepSize); phases.push(sbFull.getPhase()); }
const phaseCounts = {};
phases.forEach(p => phaseCounts[p] = (phaseCounts[p]||0)+1);
assertTrue(phaseCounts.night > 0, 'Cycle includes night');
assertTrue(phaseCounts.dawn > 0, 'Cycle includes dawn');
assertTrue(phaseCounts.day > 0, 'Cycle includes day');

// Group 27: Instance Getters
console.log('\n--- Group 27: Instance Getters ---');
const sbG = new Skybox(null, { startTime: 12 });
assertEquals(sbG.getFogDensity(), FOG_DENSITY_DAY, 'Noon fog = day value');
assertEquals(sbG.getAmbientIntensity(), AMBIENT_LIGHT.dayIntensity, 'Noon ambient = day value');
sbG.setTime(0);
assertEquals(sbG.getFogDensity(), FOG_DENSITY_NIGHT, 'Midnight fog = night value');

// Group 28: setTime doesn't crash with null renderer (Bug #9 fix)
console.log('\n--- Group 28: setTime Null Safety ---');
const sbNull = new Skybox(null);
sbNull.setTime(6); assert(true, 'setTime does not crash with null renderer');
sbNull.setTime(18); assertEquals(sbNull.getTime(), 18, 'setTime still works correctly');

// ============================================================
// Group 29: D-67 — dawn/dusk are defined ONCE and all three consumers agree
// ============================================================
//
// This file used to be able to pass while `getSkyPhase`, `getFogDensityForTime`/
// `getAmbientIntensityForTime` and `getSkyColorForTime` each ran a different schedule:
// integer hours 5/7/17/19, fractions 0.20/0.30/0.70/0.80 (= 4:48 / 7:12 / 16:48 / 19:12),
// and a third set of hour-based smoothsteps. Decision 46 ruled that the sky-colour
// schedule wins — dawn 5 h → 7 h, dusk 17 h → 19 h — and the fraction constants moved to
// match. These assertions are what stops them drifting apart again.
console.log('\n--- Group 29: D-67 One Schedule ---');
const {DAWN_START, DAWN_END, DUSK_START, DUSK_END,
  DAWN_START_HOUR, DAWN_END_HOUR, DUSK_START_HOUR, DUSK_END_HOUR, DUSK_LABEL_END_HOUR} = SkyRenderer;

// The fraction constants are the boundary hours, exactly — not a rounded copy of them.
assertEquals(DAWN_START, hoursToFraction(DAWN_START_HOUR), 'DAWN_START is exactly hour 5 as a fraction');
assertEquals(DAWN_END, hoursToFraction(DAWN_END_HOUR), 'DAWN_END is exactly hour 7 as a fraction');
assertEquals(DUSK_START, hoursToFraction(DUSK_START_HOUR), 'DUSK_START is exactly hour 17 as a fraction');
assertEquals(DUSK_END, hoursToFraction(DUSK_END_HOUR), 'DUSK_END is exactly hour 19 as a fraction');
assertEquals(DAWN_START_HOUR, 5, 'Dawn starts at hour 5');
assertEquals(DAWN_END_HOUR, 7, 'Dawn ends at hour 7');
assertEquals(DUSK_START_HOUR, 17, 'Dusk starts at hour 17');
assertEquals(DUSK_END_HOUR, 19, 'Dusk ends at hour 19');
assertEquals(DUSK_LABEL_END_HOUR, 20, "The 'dusk' LABEL runs one further hour, into the night");

// The four boundaries: the phase label flips at the same instant the curves do.
assertEquals(getSkyPhase(DAWN_START_HOUR), 'dawn', 'Hour 5 is dawn');
assertEquals(getFogDensityForTime(DAWN_START_HOUR), FOG_DENSITY_NIGHT, 'Fog is still full night AT hour 5 (the transition starts here)');
assertEquals(getAmbientIntensityForTime(DAWN_START_HOUR), AMBIENT_LIGHT.nightIntensity, 'Ambient is still full night AT hour 5');
assertEquals(getSkyPhase(DAWN_END_HOUR), 'day', 'Hour 7 is day');
assertEquals(getFogDensityForTime(DAWN_END_HOUR), FOG_DENSITY_DAY, 'Fog has reached its day value AT hour 7');
assertEquals(getAmbientIntensityForTime(DAWN_END_HOUR), AMBIENT_LIGHT.dayIntensity, 'Ambient has reached its day value AT hour 7');
assertEquals(getSkyPhase(DUSK_START_HOUR), 'sunset', 'Hour 17 is sunset');
assertEquals(getFogDensityForTime(DUSK_START_HOUR), FOG_DENSITY_DAY, 'Fog is still full day AT hour 17 (the transition starts here)');
assertEquals(getAmbientIntensityForTime(DUSK_START_HOUR), AMBIENT_LIGHT.dayIntensity, 'Ambient is still full day AT hour 17');
assertEquals(getSkyPhase(DUSK_END_HOUR), 'dusk', 'Hour 19 is the dusk label, and the night curves');
assertEquals(getFogDensityForTime(DUSK_END_HOUR), FOG_DENSITY_NIGHT, 'Fog has reached its night value AT hour 19');
assertEquals(getAmbientIntensityForTime(DUSK_END_HOUR), AMBIENT_LIGHT.nightIntensity, 'Ambient has reached its night value AT hour 19');

// The four measured symptoms from the D-67 row, at the hours it names.
assertEquals(getSkyPhase(4.9), 'night', "Hour 4.9 still reads 'night'");
assertEquals(getFogDensityForTime(4.9), FOG_DENSITY_NIGHT, 'Hour 4.9 fog has NOT started thinning yet (was 0.0029899)');
assertEquals(getAmbientIntensityForTime(4.9), AMBIENT_LIGHT.nightIntensity, 'Hour 4.9 ambient is still full night');
assertEquals(getSkyPhase(7.1), 'day', "Hour 7.1 reads 'day'");
assertEquals(getFogDensityForTime(7.1), FOG_DENSITY_DAY, 'Hour 7.1 fog is fully at its day value (was 0.0010010)');
assertEquals(getAmbientIntensityForTime(7.1), AMBIENT_LIGHT.dayIntensity, 'Hour 7.1 ambient is fully at its day value (was 0.4489868)');
assertEquals(getSkyPhase(16.9), 'day', "Hour 16.9 still reads 'day'");
assertEquals(getFogDensityForTime(16.9), FOG_DENSITY_DAY, 'Hour 16.9 fog has NOT started thickening yet (was 0.0010101)');
assertEquals(getAmbientIntensityForTime(16.9), AMBIENT_LIGHT.dayIntensity, 'Hour 16.9 ambient is still full day (was 0.4489873)');
assertEquals(getSkyPhase(19.1), 'dusk', "Hour 19.1 reads the 'dusk' label");
assertEquals(getFogDensityForTime(19.1), FOG_DENSITY_NIGHT, 'Hour 19.1 fog is fully at its night value (was 0.0029899)');
assertEquals(getAmbientIntensityForTime(19.1), AMBIENT_LIGHT.nightIntensity, 'Hour 19.1 ambient is fully at its night value (was 0.2510132)');

// The transitions really do run inside their bands — without this the assertions above
// would also pass if dawn and dusk had simply been deleted.
assertLessThan(getFogDensityForTime(5.5), FOG_DENSITY_NIGHT, 'Fog is thinning inside the dawn band');
assertGreaterThan(getFogDensityForTime(5.5), FOG_DENSITY_DAY, 'Fog has not finished thinning at 5.5');
assertGreaterThan(getFogDensityForTime(18), FOG_DENSITY_DAY, 'Fog is thickening inside the dusk band');
assertLessThan(getFogDensityForTime(18), FOG_DENSITY_NIGHT, 'Fog has not finished thickening at 18:00');

// Structural sweep: across the whole cycle, every hour the phase calls 'day' has day fog
// and day ambient, and every hour it calls 'night' or 'dusk' has the night values. This is
// the assertion that fails for ANY disagreement between the label and the curves, not just
// the four boundaries.
{
  const dayMismatches = [];
  const nightMismatches = [];
  for (let i = 0; i < 240; i++) {
    const hour = i / 10;
    const phase = getSkyPhase(hour);
    const fog = getFogDensityForTime(hour);
    const amb = getAmbientIntensityForTime(hour);
    if (phase === 'day' && (fog !== FOG_DENSITY_DAY || amb !== AMBIENT_LIGHT.dayIntensity)) {
      dayMismatches.push(hour);
    }
    if ((phase === 'night' || phase === 'dusk') && (fog !== FOG_DENSITY_NIGHT || amb !== AMBIENT_LIGHT.nightIntensity)) {
      nightMismatches.push(hour);
    }
  }
  assertEquals(dayMismatches.length, 0,
    `Every 'day' hour has day fog and day ambient (mismatches: ${dayMismatches.join(', ') || 'none'})`);
  assertEquals(nightMismatches.length, 0,
    `Every 'night'/'dusk' hour has night fog and night ambient (mismatches: ${nightMismatches.join(', ') || 'none'})`);
}

// ============================================================
console.log('\n================================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  console.log('\nFailures:'); failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All skybox tests passing!');
  process.exit(0);
}
}));
