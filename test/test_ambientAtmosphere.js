#!/usr/bin/env node
/**
 * Cuubz — Atmospheric Sound Transitions Tests
 * Tests for biome-specific atmospheric sound layers (crackle, whisper, birds, wind, bubbles)
 * All tests run in Node.js without AudioContext.
 */

const ambient = require('../js/audio/ambient');
let PASS = 0;
let FAIL = 0;
let TOTAL = 0;

function assert(condition, message) {
  TOTAL++;
  if (condition) {
    PASS++;
  } else {
    FAIL++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

// ============================================================
// Group 1: BIOME_SOUND_LAYERS Constants
// ============================================================
console.log('Group 1: BIOME_SOUND_LAYERS constants');
{
  const layers = ambient.BIOME_SOUND_LAYERS;

  assert(typeof layers === 'object', 'BIOME_SOUND_LAYERS is an object');
  assert(Object.keys(layers).length === 8, 'Has 8 biome entries');

  // Check each biome has expected layers
  assert(Array.isArray(layers.plains), 'plains has array of layers');
  assert(layers.plains.length === 2, 'plains has 2 layers (birds + wind)');

  assert(Array.isArray(layers.forest), 'forest has array of layers');
  assert(layers.forest.length === 2, 'forest has 2 layers (birds + wind)');

  assert(Array.isArray(layers.desert), 'desert has array of layers');
  assert(layers.desert.length === 1, 'desert has 1 layer (wind)');

  assert(Array.isArray(layers.tundra), 'tundra has array of layers');
  assert(layers.tundra.length === 1, 'tundra has 1 layer (wind)');

  assert(Array.isArray(layers.mountains), 'mountains has array of layers');
  assert(layers.mountains.length === 1, 'mountains has 1 layer (wind)');

  assert(Array.isArray(layers.ocean), 'ocean has array of layers');
  assert(layers.ocean.length === 1, 'ocean has 1 layer (wind)');

  assert(Array.isArray(layers.lava), 'lava has array of layers');
  assert(layers.lava.length === 2, 'lava has 2 layers (crackle + bubbles)');

  assert(Array.isArray(layers.corrupt), 'corrupt has array of layers');
  assert(layers.corrupt.length === 2, 'corrupt has 2 layers (whisper + bubbles)');
}

// Group 2: Layer type assignments per biome
console.log('Group 2: Layer type assignments');
{
  const layers = ambient.BIOME_SOUND_LAYERS;

  // Healthy biomes have birds
  assert(layers.plains[0].type === 'birds', 'plains has birds layer');
  assert(layers.forest[0].type === 'birds', 'forest has birds layer');

  // Desert/tundra/mountains/ocean have wind only
  assert(layers.desert[0].type === 'wind', 'desert has wind layer');
  assert(layers.tundra[0].type === 'wind', 'tundra has wind layer');
  assert(layers.mountains[0].type === 'wind', 'mountains has wind layer');
  assert(layers.ocean[0].type === 'wind', 'ocean has wind layer');

  // Lava has crackle + bubbles
  assert(layers.lava[0].type === 'crackle', 'lava has crackle layer');
  assert(layers.lava[1].type === 'bubbles', 'lava has bubbles layer');

  // Corrupt has whisper + bubbles
  assert(layers.corrupt[0].type === 'whisper', 'corrupt has whisper layer');
  assert(layers.corrupt[1].type === 'bubbles', 'corrupt has bubbles layer');

  // Plains also has wind
  assert(layers.plains[1].type === 'wind', 'plains has wind layer');
  assert(layers.forest[1].type === 'wind', 'forest has wind layer');
}

// Group 3: Layer parameter validation
console.log('Group 3: Layer parameter ranges');
{
  const layers = ambient.BIOME_SOUND_LAYERS;

  // Birds pitch range check
  assert(layers.plains[0].pitchRange[0] < layers.plains[0].pitchRange[1], 'plains birds pitchRange min < max');
  assert(layers.forest[0].pitchRange[0] < layers.forest[0].pitchRange[1], 'forest birds pitchRange min < max');

  // Wind filterFreq positive
  assert(layers.desert[0].filterFreq > 0, 'desert wind filterFreq > 0');
  assert(layers.tundra[0].filterFreq > 0, 'tundra wind filterFreq > 0');

  // Lava crackle params
  assert(layers.lava[0].burstDuration > 0, 'lava crackle burstDuration > 0');
  assert(layers.lava[0].rate > 0, 'lava crackle rate > 0');
  assert(layers.lava[0].noiseRatio >= 0 && layers.lava[0].noiseRatio <= 1, 'lava crackle noiseRatio in [0,1]');

  // Lava bubbles params
  assert(layers.lava[1].freqBase > 0, 'lava bubbles freqBase > 0');
  assert(layers.lava[1].pulseWidth > 0, 'lava bubbles pulseWidth > 0');

  // Corrupt whisper params
  assert(layers.corrupt[0].baseFreq > 0, 'corrupt whisper baseFreq > 0');
  assert(layers.corrupt[0].modRate > 0, 'corrupt whisper modRate > 0');
  assert(layers.corrupt[0].detuneCents > 0, 'corrupt whisper detuneCents > 0');

  // Corrupt bubbles params
  assert(layers.corrupt[1].freqBase > 0, 'corrupt bubbles freqBase > 0');
  assert(layers.corrupt[1].pulseWidth > 0, 'corrupt bubbles pulseWidth > 0');

  // Volume ranges (all between 0 and 1)
  for (const [biome, biomeLayers] of Object.entries(layers)) {
    for (const layer of biomeLayers) {
      assert(layer.volume >= 0 && layer.volume <= 1, `${biome} ${layer.type} volume in [0,1]: ${layer.volume}`);
    }
  }
}

// Group 4: LAYER_DEFAULTS Constants
console.log('Group 4: LAYER_DEFAULTS constants');
{
  const defaults = ambient.LAYER_DEFAULTS;

  assert(typeof defaults === 'object', 'LAYER_DEFAULTS is an object');
  assert(Object.keys(defaults).length === 5, 'Has 5 layer type defaults');

  assert(defaults.crackle !== undefined, 'crackle defaults exist');
  assert(defaults.whisper !== undefined, 'whisper defaults exist');
  assert(defaults.birds !== undefined, 'birds defaults exist');
  assert(defaults.wind !== undefined, 'wind defaults exist');
  assert(defaults.bubbles !== undefined, 'bubbles defaults exist');

  // Check default volumes are reasonable
  assert(defaults.crackle.volume >= 0 && defaults.crackle.volume <= 1, 'crackle default volume in range');
  assert(defaults.whisper.volume >= 0 && defaults.whisper.volume <= 1, 'whisper default volume in range');
  assert(defaults.birds.volume >= 0 && defaults.birds.volume <= 1, 'birds default volume in range');
  assert(defaults.wind.volume >= 0 && defaults.wind.volume <= 1, 'wind default volume in range');
  assert(defaults.bubbles.volume >= 0 && defaults.bubbles.volume <= 1, 'bubbles default volume in range');

  // Check specific defaults
  assert(defaults.crackle.noiseRatio === 0.9, 'crackle default noiseRatio = 0.9');
  assert(defaults.crackle.burstDuration === 0.1, 'crackle default burstDuration = 0.1');
  assert(defaults.whisper.baseFreq === 60, 'whisper default baseFreq = 60');
  assert(defaults.birds.chirpCount === 2, 'birds default chirpCount = 2');
  assert(Array.isArray(defaults.birds.pitchRange), 'birds default pitchRange is array');
  assert(defaults.wind.filterFreq === 400, 'wind default filterFreq = 400');
  assert(defaults.bubbles.freqBase === 100, 'bubbles default freqBase = 100');
}

// Group 5: VALID_LAYER_TYPES
console.log('Group 5: VALID_LAYER_TYPES');
{
  const types = ambient.VALID_LAYER_TYPES;

  assert(Array.isArray(types), 'VALID_LAYER_TYPES is an array');
  assert(types.length === 5, 'Has 5 valid types');
  assert(types.includes('crackle'), 'Includes crackle');
  assert(types.includes('whisper'), 'Includes whisper');
  assert(types.includes('birds'), 'Includes birds');
  assert(types.includes('wind'), 'Includes wind');
  assert(types.includes('bubbles'), 'Includes bubbles');
}

// ============================================================
// Group 6: getBiomeSoundLayers()
// ============================================================
console.log('Group 6: getBiomeSoundLayers()');
{
  assert(ambient.getBiomeSoundLayers('plains').length === 2, 'plains returns 2 layers');
  assert(ambient.getBiomeSoundLayers('lava').length === 2, 'lava returns 2 layers');
  assert(ambient.getBiomeSoundLayers('corrupt').length === 2, 'corrupt returns 2 layers');
  assert(ambient.getBiomeSoundLayers('desert').length === 1, 'desert returns 1 layer');
  assert(ambient.getBiomeSoundLayers('unknown_biome').length === 0, 'unknown biome returns empty array');
  assert(ambient.getBiomeSoundLayers('').length === 0, 'empty string returns empty array');
  assert(Array.isArray(ambient.getBiomeSoundLayers('plains')), 'returns array');
}

// ============================================================
// Group 7: validateSoundLayer() — Valid layers
// ============================================================
console.log('Group 7: validateSoundLayer() — valid layers');
{
  const v = ambient.validateSoundLayer;

  // Valid crackle
  let r = v({ type: 'crackle', volume: 0.05, burstDuration: 0.1, rate: 1.0, noiseRatio: 0.9 });
  assert(r.valid === true, 'valid crackle passes');

  // Valid whisper
  r = v({ type: 'whisper', volume: 0.04, baseFreq: 80, modRate: 0.3, detuneCents: 15 });
  assert(r.valid === true, 'valid whisper passes');

  // Valid birds
  r = v({ type: 'birds', volume: 0.03, rate: 2.0, chirpCount: 2, pitchRange: [800, 1500] });
  assert(r.valid === true, 'valid birds passes');

  // Valid wind
  r = v({ type: 'wind', volume: 0.03, filterFreq: 400, windStrength: 0.5 });
  assert(r.valid === true, 'valid wind passes');

  // Valid bubbles
  r = v({ type: 'bubbles', volume: 0.03, freqBase: 100, freqRange: 30, rate: 1.0, pulseWidth: 0.2 });
  assert(r.valid === true, 'valid bubbles passes');

  // Minimal valid — uses defaults for missing fields
  r = v({ type: 'wind', volume: 0.5, filterFreq: 200 });
  assert(r.valid === true, 'minimal wind with required fields passes');
}

// Group 8: validateSoundLayer() — Invalid layers
console.log('Group 8: validateSoundLayer() — invalid layers');
{
  const v = ambient.validateSoundLayer;

  // Missing type
  let r = v({});
  assert(r.valid === false, 'empty object fails validation');
  assert(typeof r.error === 'string', 'error message is string');

  // Invalid type
  r = v({ type: 'invalid' });
  assert(r.valid === false, 'invalid type fails');
  assert(r.error.includes('Invalid layer type'), 'error mentions invalid type');

  // Missing required field — whisper without baseFreq
  r = v({ type: 'whisper', volume: 0.04 });
  assert(r.valid === false, 'whisper without baseFreq fails');

  // Birds with invalid pitchRange
  r = v({ type: 'birds', volume: 0.03, pitchRange: [1500, 800] });
  assert(r.valid === false, 'birds with reversed pitchRange fails');

  r = v({ type: 'birds', volume: 0.03, pitchRange: [800] });
  assert(r.valid === false, 'birds with single-element pitchRange fails');

  // Wind with zero filterFreq
  r = v({ type: 'wind', volume: 0.03, filterFreq: 0 });
  assert(r.valid === false, 'wind with zero filterFreq fails');

  // Bubbles with negative freqBase
  r = v({ type: 'bubbles', volume: 0.03, freqBase: -10 });
  assert(r.valid === false, 'bubbles with negative freqBase fails');

  // Volume out of range
  r = v({ type: 'wind', volume: 1.5, filterFreq: 400 });
  assert(r.valid === false, 'volume > 1 fails');

  r = v({ type: 'wind', volume: -0.1, filterFreq: 400 });
  assert(r.valid === false, 'negative volume fails');
}

// ============================================================
// Group 9: resolveSoundLayer() — Default merging
// ============================================================
console.log('Group 9: resolveSoundLayer() — default merging');
{
  const r = ambient.resolveSoundLayer;

  // Crackle with partial config gets defaults filled
  let resolved = r({ type: 'crackle', volume: 0.1 });
  assert(resolved.volume === 0.1, 'custom volume preserved');
  assert(resolved.burstDuration === 0.1, 'default burstDuration applied');
  assert(resolved.rate === 1.0, 'default rate applied');
  assert(resolved.noiseRatio === 0.9, 'default noiseRatio applied');

  // Birds pitchRange clamped to valid range
  resolved = r({ type: 'birds', volume: 0.05, pitchRange: [5, 20000] });
  assert(resolved.pitchRange[0] === 20, 'pitchRange min clamped to 20');
  assert(resolved.pitchRange[1] === 8000, 'pitchRange max clamped to 8000');

  // Whisper gets defaults
  resolved = r({ type: 'whisper', volume: 0.06 });
  assert(resolved.baseFreq === 60, 'default baseFreq applied');
  assert(resolved.modRate === 0.2, 'default modRate applied');
}

// ============================================================
// Group 10: calculateCrackleSchedule() — Deterministic scheduling
// ============================================================
console.log('Group 10: calculateCrackleSchedule()');
{
  const calc = ambient.calculateCrackleSchedule;

  // Basic schedule generation
  let events = calc(1.0, 0.1, 5.0, 42);
  assert(Array.isArray(events), 'returns array of events');
  assert(events.length > 0, 'generates events for 5-second window');
  assert(events.length < 50, 'reasonable number of crackle events');

  // Event structure
  if (events.length > 0) {
    assert(typeof events[0].time === 'number', 'event has time property');
    assert(typeof events[0].duration === 'number', 'event has duration property');
    assert(typeof events[0].volume === 'number', 'event has volume property');
    assert(events[0].time >= 0, 'first event at or after time 0');
    assert(events[0].duration > 0 && events[0].duration <= 0.1, 'duration within burstDuration range');
    assert(events[0].volume >= 0.7 && events[0].volume <= 1.0, 'volume in [0.7, 1.0]');
  }

  // Deterministic with same seed
  let events2 = calc(1.0, 0.1, 5.0, 42);
  assert(events.length === events2.length, 'same seed produces same count');
  for (let i = 0; i < events.length; i++) {
    assert(Math.abs(events[i].time - events2[i].time) < 0.001, `event ${i} time matches with same seed`);
  }

  // Different seed produces different schedule
  let events3 = calc(1.0, 0.1, 5.0, 99);
  assert(events.length !== events3.length || events[0].time !== events3[0].time, 'different seed changes schedule');

  // Shorter window → fewer events
  let shortEvents = calc(1.0, 0.1, 1.0, 42);
  assert(shortEvents.length <= events.length, 'shorter window has fewer or equal events');

  // Higher rate (more frequent) → more events
  let fastEvents = calc(0.3, 0.1, 5.0, 42);
  assert(fastEvents.length >= events.length, 'higher rate produces more events');

  // Empty window
  let emptyEvents = calc(1.0, 0.1, 0.0, 42);
  assert(emptyEvents.length === 0, 'zero window returns empty array');
}

// ============================================================
// Group 11: calculateBirdSchedule() — Chirp patterns
// ============================================================
console.log('Group 11: calculateBirdSchedule()');
{
  const calc = ambient.calculateBirdSchedule;

  // Basic schedule
  let events = calc(3.0, 2, [800, 1600], 10.0, 123);
  assert(Array.isArray(events), 'returns array of chirp events');
  assert(events.length > 0, 'generates chirp events');

  // Event structure
  if (events.length > 0) {
    assert(typeof events[0].time === 'number', 'event has time');
    assert(typeof events[0].frequency === 'number', 'event has frequency');
    assert(typeof events[0].duration === 'number', 'event has duration');
    assert(events[0].frequency >= 800 && events[0].frequency <= 1600, 'frequency in pitchRange');
    assert(events[0].duration >= 0.05 && events[0].duration <= 0.1, 'chirp duration 50-100ms');
  }

  // Chirps come in bursts of chirpCount
  let burstEvents = calc(5.0, 3, [700, 1800], 3.0, 42);
  assert(burstEvents.length >= 3, 'at least one burst of 3 chirps');

  // Deterministic with same seed
  let events2 = calc(3.0, 2, [800, 1600], 10.0, 123);
  assert(events.length === events2.length, 'same seed produces same count');
  for (let i = 0; i < Math.min(events.length, events2.length); i++) {
    assert(Math.abs(events[i].frequency - events2[i].frequency) < 1, `chirp ${i} frequency matches`);
  }

  // Higher chirpCount → more events per burst
  let fewChirps = calc(3.0, 1, [800, 1500], 5.0, 42);
  let manyChirps = calc(3.0, 4, [800, 1500], 5.0, 42);
  assert(manyChirps.length >= fewChirps.length, 'more chirpCount → more events');
}

// ============================================================
// Group 12: calculateBubbleSchedule() — Pulse patterns
// ============================================================
console.log('Group 12: calculateBubbleSchedule()');
{
  const calc = ambient.calculateBubbleSchedule;

  // Basic schedule
  let events = calc(120, 40, 1.2, 0.15, 5.0, 777);
  assert(Array.isArray(events), 'returns array of bubble events');
  assert(events.length > 0, 'generates bubble events');

  // Event structure
  if (events.length > 0) {
    assert(typeof events[0].time === 'number', 'event has time');
    assert(typeof events[0].frequency === 'number', 'event has frequency');
    assert(typeof events[0].duration === 'number', 'event has duration');

    // Frequency within range of base ± range
    const minFreq = 120 - 40;
    const maxFreq = 120 + 40;
    assert(events[0].frequency >= minFreq - 5 && events[0].frequency <= maxFreq + 5, 'frequency near base ± range');

    assert(events[0].duration > 0, 'duration positive');
    assert(events[0].duration <= 0.15, 'duration within pulseWidth');
  }

  // Deterministic with same seed
  let events2 = calc(120, 40, 1.2, 0.15, 5.0, 777);
  assert(events.length === events2.length, 'same seed produces same count');

  // Corrupt bubbles (lower freq base)
  let corruptEvents = calc(60, 20, 2.0, 0.3, 5.0, 777);
  if (corruptEvents.length > 0) {
    assert(corruptEvents[0].frequency >= 40 && corruptEvents[0].frequency <= 80, 'corrupt bubbles freq near 60±20');
  }

  // Higher rate → more events
  let slow = calc(100, 30, 2.0, 0.2, 5.0, 42);
  let fast = calc(100, 30, 0.5, 0.2, 5.0, 42);
  assert(fast.length >= slow.length, 'higher rate (lower interval) → more events');
}

// ============================================================
// Group 13: calculateAtmosphericVolume() — Day/night variations
// ============================================================
console.log('Group 13: calculateAtmosphericVolume()');
{
  const calc = ambient.calculateAtmosphericVolume;

  // Noon (full day volume)
  let vol = calc(0.05, 0.5, 1.0);
  assert(vol === 0.05 * 1.0 * 1.0 * 0.6, 'noon: base * day * master * atmosphereMult');
  assert(Math.abs(vol - 0.03) < 0.001, 'noon volume = 0.03 for base=0.05');

  // Midnight (night volume)
  vol = calc(0.05, 0.0, 1.0);
  assert(vol === 0.05 * 0.6 * 1.0 * 0.6, 'midnight: base * night * master * atmosphereMult');

  // Dawn transition (should be between night and day)
  let dawnVol = calc(0.05, 0.25, 1.0);
  assert(dawnVol > 0.05 * 0.6 * 0.6 && dawnVol < 0.05 * 1.0 * 0.6, 'dawn volume between night and day');

  // Dusk transition
  let duskVol = calc(0.05, 0.75, 1.0);
  assert(duskVol > 0.05 * 0.6 * 0.6 && duskVol < 0.05 * 1.0 * 0.6, 'dusk volume between day and night');

  // Master volume = 0 → silence
  vol = calc(0.05, 0.5, 0);
  assert(vol === 0, 'master volume 0 → silence');

  // Clamped to [0, 1]
  vol = calc(10.0, 0.5, 10.0);
  assert(vol <= 1, 'volume clamped to max 1');

  // Atmospheric multiplier (0.6) always applied
  let dayVol = calc(0.1, 0.5, 1.0);
  assert(dayVol === 0.1 * 0.6, 'day atmospheric volume has 0.6 multiplier');
}

// ============================================================
// Group 14: getAllUsedLayerTypes()
// ============================================================
console.log('Group 14: getAllUsedLayerTypes()');
{
  const types = ambient.getAllUsedLayerTypes();
  assert(Array.isArray(types), 'returns array');
  assert(types.includes('birds'), 'includes birds');
  assert(types.includes('wind'), 'includes wind');
  assert(types.includes('crackle'), 'includes crackle');
  assert(types.includes('bubbles'), 'includes bubbles');
  assert(types.includes('whisper'), 'includes whisper');
  assert(types.length === 5, 'all 5 types used across biomes');
}

// ============================================================
// Group 15: getBiomesUsingLayerType()
// ============================================================
console.log('Group 15: getBiomesUsingLayerType()');
{
  const get = ambient.getBiomesUsingLayerType;

  let birds = get('birds');
  assert(Array.isArray(birds), 'returns array');
  assert(birds.includes('plains'), 'plains uses birds');
  assert(birds.includes('forest'), 'forest uses birds');
  assert(!birds.includes('lava'), 'lava does not use birds');

  let wind = get('wind');
  assert(wind.length >= 5, 'at least 5 biomes use wind');
  assert(wind.includes('desert'), 'desert uses wind');
  assert(wind.includes('tundra'), 'tundra uses wind');

  let crackle = get('crackle');
  assert(crackle.length === 1, 'only lava uses crackle');
  assert(crackle[0] === 'lava', 'crackle used by lava');

  let whisper = get('whisper');
  assert(whisper.length === 1, 'only corrupt uses whisper');
  assert(whisper[0] === 'corrupt', 'whisper used by corrupt');

  let bubbles = get('bubbles');
  assert(bubbles.length === 2, 'lava and corrupt use bubbles');
  assert(bubbles.includes('lava'), 'lava uses bubbles');
  assert(bubbles.includes('corrupt'), 'corrupt uses bubbles');

  // Unknown type returns empty
  assert(get('unknown').length === 0, 'unknown type returns empty array');
}

// ============================================================
// Group 16: validateAllSoundLayers()
// ============================================================
console.log('Group 16: validateAllSoundLayers()');
{
  const result = ambient.validateAllSoundLayers();
  assert(result.valid === true, 'all biome sound layers are valid');
  assert(Array.isArray(result.errors), 'errors is array');
  assert(result.errors.length === 0, 'no validation errors');
}

// ============================================================
// Group 17: Integration — All layer types have matching defaults
// ============================================================
console.log('Group 17: Integration — layer type consistency');
{
  // Every layer in BIOME_SOUND_LAYERS should validate
  for (const [biome, layers] of Object.entries(ambient.BIOME_SOUND_LAYERS)) {
    for (const layer of layers) {
      const v = ambient.validateSoundLayer(layer);
      assert(v.valid, `${biome} ${layer.type} validates`);

      // Should resolve without errors
      const resolved = ambient.resolveSoundLayer(layer);
      assert(resolved.type === layer.type, `resolved type matches original for ${biome} ${layer.type}`);
    }
  }

  // Every VALID_LAYER_TYPE should have LAYER_DEFAULTS
  for (const type of ambient.VALID_LAYER_TYPES) {
    assert(ambient.LAYER_DEFAULTS[type] !== undefined, `defaults exist for ${type}`);
  }
}

// ============================================================
// Group 18: AmbientManager constructor has atmospheric properties
// ============================================================
console.log('Group 18: AmbientManager atmospheric properties');
{
  const mgr = new ambient.AmbientManager();
  assert(mgr.atmosphericGain === null, 'atmosphericGain is null before init');
  assert(Array.isArray(mgr._atmosphericLayers), '_atmosphericLayers is array');
  assert(Array.isArray(mgr._atmosphericIntervals), '_atmosphericIntervals is array');
  assert(mgr._atmosphericLayers.length === 0, 'no atmospheric layers before init');
  assert(mgr._atmosphericIntervals.length === 0, 'no intervals before init');
}

// Group 19: getStateSummary includes atmospheric info
console.log('Group 19: getStateSummary atmospheric fields');
{
  const mgr = new ambient.AmbientManager();
  const summary = mgr.getStateSummary();

  assert(summary.atmosphericLayers !== undefined, 'summary has atmosphericLayers');
  assert(summary.atmosphericLayerCount !== undefined, 'summary has atmosphericLayerCount');
  assert(Array.isArray(summary.atmosphericLayers), 'atmosphericLayers is array');
  assert(typeof summary.atmosphericLayerCount === 'number', 'atmosphericLayerCount is number');

  // Plains default should have 2 layers (birds + wind)
  assert(summary.atmosphericLayerCount === 2, 'plains has 2 atmospheric layers');
  assert(summary.atmosphericLayers.includes('birds'), 'includes birds type');
  assert(summary.atmosphericLayers.includes('wind'), 'includes wind type');

  // After biome change (simulated via constructor)
  const mgrLava = new ambient.AmbientManager();
  mgrLava.currentBiome = 'lava';
  mgrLava._currentConfig = ambient.getBiomeAmbientConfig('lava');
  const lavaSummary = mgrLava.getStateSummary();
  assert(lavaSummary.atmosphericLayerCount === 2, 'lava has 2 atmospheric layers');
  assert(lavaSummary.atmosphericLayers.includes('crackle'), 'lava includes crackle');
  assert(lavaSummary.atmosphericLayers.includes('bubbles'), 'lava includes bubbles');
}

// ============================================================
// Group 20: Edge cases and boundary conditions
// ============================================================
console.log('Group 20: Edge cases');
{
  // validateSoundLayer with null/undefined
  let r = ambient.validateSoundLayer(null);
  assert(r.valid === false, 'null layer fails validation');

  r = ambient.validateSoundLayer(undefined);
  assert(r.valid === false, 'undefined layer fails validation');

  r = ambient.validateSoundLayer({ type: '' });
  assert(r.valid === false, 'empty string type fails');

  // resolveSoundLayer with unknown type returns original
  let unknown = { type: 'unknown', volume: 0.5 };
  let resolved = ambient.resolveSoundLayer(unknown);
  assert(resolved.type === 'unknown', 'unknown type passed through');

  // calculateAtmosphericVolume at exact boundaries
  let volDawnEnd = ambient.calculateAtmosphericVolume(0.1, 0.30, 1.0);
  let volMidday = ambient.calculateAtmosphericVolume(0.1, 0.50, 1.0);
  assert(volDawnEnd === volMidday, 'dawn end == midday volume');

  let volDuskStart = ambient.calculateAtmosphericVolume(0.1, 0.70, 1.0);
  assert(volDuskStart === volMidday, 'dusk start == midday volume');

  // Extreme time values clamped
  let volNeg = ambient.calculateAtmosphericVolume(0.1, -0.5, 1.0);
  let volOver = ambient.calculateAtmosphericVolume(0.1, 1.5, 1.0);
  assert(volNeg >= 0 && volNeg <= 1, 'negative time clamped');
  assert(volOver >= 0 && volOver <= 1, 'time > 1 clamped');

  // Bird schedule with zero window
  let zeroBirds = ambient.calculateBirdSchedule(2.0, 3, [800, 1500], 0, 42);
  assert(zeroBirds.length === 0, 'zero window bird schedule returns empty');

  // Bubble schedule with very low rate (very infrequent)
  let rareBubbles = ambient.calculateBubbleSchedule(100, 30, 10.0, 0.2, 5.0, 42);
  assert(rareBubbles.length <= 2, 'very slow rate produces few events');
}

// ============================================================
// Results
// ============================================================
console.log('');
console.log(`===================================`);
console.log(`  Results: ${PASS}/${TOTAL} passed, ${FAIL} failed`);
console.log(`===================================`);

if (FAIL > 0) {
  console.error('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('🎉 All atmospheric sound transition tests passing!');
  process.exit(0);
}
