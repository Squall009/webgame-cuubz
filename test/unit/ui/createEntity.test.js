/**
 * Cuubz — createEntity form tests (PR 26, BUGS.md D-41)
 *
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * Before PR 26 there was **zero** automated coverage of any of the five
 * character/world creation paths, and `test/e2e/saveLoad.js` cannot supply it:
 *
 *   - The harness never reaches three characters. It creates one, creates a second
 *     named `Doomed` (`saveLoad.js:1419-1422`) and deletes it (`:1428-1431`). A
 *     `disabled` attribute applied at the **wrong threshold** would pass green.
 *   - It never clicks `#btn-host` or `#btn-join` (**D-48**), so the lobby's three
 *     inline forms have no coverage of any kind.
 *
 * So the boundary is asserted here, against the **real** `CharacterManager` and
 * `WorldManager` over an in-memory store — not a stub with a hand-written
 * `canCreateMore`, which would just be asserting the stub. `MAX_CHARACTERS` and
 * `MAX_WORLDS` come from the modules under test.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { TEST_DIR as __dirname } from '../../helpers/paths.js';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { initBrowseCreateChar, initHostForm } from '../../../src/ui/screens/LobbyForms.js';
import { canOpen, hideBanner, parseSeed, randomHexColor, randomSeed, SEED_ERROR, setBanner, submitCreate, syncCreateButton } from '../../../src/ui/forms/createEntity.js';
import { CharacterManager, DEFAULT_COLOR, MAX_CHARACTERS } from '../../../src/game/entities/CharacterManager.js';
import { WorldManager, MAX_WORLDS } from '../../../src/game/entities/WorldManager.js';

it('createEntity', () => legacy(async () => {
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.log(`  ❌ ${message}`); }
}
function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

/** The in-memory backend `test_characterManager.js` uses, trimmed to what is needed. */
function makeStore() {
  const characters = [];
  const worlds = [];
  return {
    async saveCharacter(d) { characters.push({ ...d }); },
    async loadCharacters() { return [...characters]; },
    async deleteCharacter(id) { characters.splice(characters.findIndex(c => c.id === id), 1); },
    async saveWorld(d) { worlds.push({ ...d }); },
    async loadWorlds() { return [...worlds]; },
    async deleteWorld(id) { worlds.splice(worlds.findIndex(w => w.id === id), 1); },
  };
}

/** A real `CharacterManager` holding exactly `n` characters. */
async function managerWith(n) {
  const cm = new CharacterManager(makeStore());
  await cm.init();
  for (let i = 0; i < n; i++) {
    const r = await cm.createCharacter(`Char${i}`, '#112233');
    if (!r.success) throw new Error(`fixture broke at ${i}: ${r.error}`);
  }
  return cm;
}

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const document = dom.window.document;

function makeBanner() {
  const el = document.createElement('div');
  el.className = 'hidden';
  return el;
}
function makeButton() {
  return document.createElement('button');
}

const LABELS = { idle: 'Create Character', full: 'Slots Full' };

await (async function run() {
  // ── canOpen across the whole range, plus the null-manager ruling ──────────
  console.log('\nGroup 1: canOpen(manager) at 0..MAX and with no manager');

  assertEquals(MAX_CHARACTERS, 3, 'MAX_CHARACTERS is 3 — the boundary these tests pin');
  for (let n = 0; n < MAX_CHARACTERS; n++) {
    assertEquals(canOpen(await managerWith(n)), true, `canOpen is true at ${n}/${MAX_CHARACTERS} characters`);
  }
  assertEquals(canOpen(await managerWith(MAX_CHARACTERS)), false,
    `canOpen is false at ${MAX_CHARACTERS}/${MAX_CHARACTERS} characters — the limit, not one before it`);

  // Decision 55's sub-ruling: WorldScreen's polarity won. CharacterScreen used to read
  // `if (cm && !cm.canCreateMore()) return;`, which OPENED the modal on a null manager.
  assertEquals(canOpen(null), false, 'canOpen(null) is false — a missing manager does not open the form');
  assertEquals(canOpen(undefined), false, 'canOpen(undefined) is false');

  const wm = new WorldManager(makeStore());
  await wm.init();
  assertEquals(canOpen(wm), true, 'canOpen is true for a fresh WorldManager');
  for (let i = 0; i < MAX_WORLDS; i++) await wm.createWorld(`World${i}`, i);
  assertEquals(canOpen(wm), false, `canOpen is false at ${MAX_WORLDS}/${MAX_WORLDS} worlds`);

  // ── syncCreateButton at the boundary ─────────────────────────────────────
  console.log('\nGroup 2: syncCreateButton at the boundary');

  const nearFull = makeButton();
  syncCreateButton(nearFull, await managerWith(MAX_CHARACTERS - 1), LABELS);
  assertEquals(nearFull.disabled, false, `Button is ENABLED at ${MAX_CHARACTERS - 1}/${MAX_CHARACTERS} — one slot left`);
  assertEquals(nearFull.textContent, 'Create Character', 'Near-full button keeps its idle label');
  assertEquals(nearFull.style.opacity, '1', 'Near-full button is fully opaque');

  const full = makeButton();
  syncCreateButton(full, await managerWith(MAX_CHARACTERS), LABELS);
  assertEquals(full.disabled, true, `Button is DISABLED at ${MAX_CHARACTERS}/${MAX_CHARACTERS}`);
  assertEquals(full.textContent, 'Slots Full', 'Full button says "Slots Full"');
  assertEquals(full.style.opacity, '0.5', 'Full button is dimmed');

  const noManager = makeButton();
  syncCreateButton(noManager, null, LABELS);
  assertEquals(noManager.disabled, true, 'Button is disabled when there is no manager at all');
  assertEquals(noManager.textContent, 'Create Character',
    'A null manager keeps the idle label — "Slots Full" would be a lie about a manager that has not loaded');

  // Re-syncing after a deletion must re-enable: the button is derived, not latched.
  const cmFull = await managerWith(MAX_CHARACTERS);
  const reused = makeButton();
  syncCreateButton(reused, cmFull, LABELS);
  await cmFull.deleteCharacter(cmFull.getAllCharacters()[0].id);
  syncCreateButton(reused, cmFull, LABELS);
  assertEquals(reused.disabled, false, 'Button re-enables after a delete drops the count below the limit');

  syncCreateButton(null, cmFull, LABELS); // must not throw
  assert(true, 'syncCreateButton(null, ...) is a no-op rather than a TypeError');

  // ── submitCreate: validation, success and the banner ─────────────────────
  console.log('\nGroup 3: submitCreate — empty name');

  const emptyBanner = makeBanner();
  let called = false;
  let result = await submitCreate({
    manager: await managerWith(0), noun: 'character', name: '', errorEl: emptyBanner,
    onSuccess: () => { called = true; },
  });
  assertEquals(result, null, 'An empty name never reaches the manager');
  assertEquals(called, false, 'onSuccess is not called for an empty name');
  assertEquals(emptyBanner.textContent, 'Please enter a character name.',
    'Empty-name message keeps its trailing period (WorldScreen was the one of five that dropped it)');
  assertEquals(emptyBanner.classList.contains('hidden'), false, 'The banner is revealed');

  const worldBanner = makeBanner();
  await submitCreate({ manager: wm, noun: 'world', name: '', errorEl: worldBanner });
  assertEquals(worldBanner.textContent, 'Please enter a world name.',
    'The world path uses the same message shape with its own noun');

  await submitCreate({ manager: null, noun: 'character', name: 'Nope', errorEl: emptyBanner });
  assert(emptyBanner.textContent.includes('No character storage'),
    'A null manager is reported rather than thrown through');

  console.log('\nGroup 4: submitCreate — seed parsing');

  assertEquals(parseSeed('').seed, undefined, 'A blank seed means "random" — undefined, not 0');
  assertEquals(parseSeed('   ').ok, true, 'Whitespace is blank');
  assertEquals(parseSeed('12345').seed, 12345, 'A numeric seed parses');
  assertEquals(parseSeed('-7').seed, -7, 'A negative seed parses');
  assertEquals(parseSeed('abc').ok, false, 'A non-numeric seed is REJECTED, not silently randomised');
  assertEquals(parseSeed('abc').error, SEED_ERROR, 'One rejection message for both world paths');

  const seedBanner = makeBanner();
  const wm2 = new WorldManager(makeStore());
  await wm2.init();
  result = await submitCreate({
    manager: wm2, noun: 'world', name: 'Bad Seed', extra: 'not-a-number', errorEl: seedBanner,
  });
  assertEquals(result, null, 'A bad seed stops before createWorld');
  assertEquals(seedBanner.textContent, SEED_ERROR, 'The seed message reaches the banner');
  assertEquals(wm2.getAllWorlds().length, 0, 'No world was created from a bad seed');

  result = await submitCreate({ manager: wm2, noun: 'world', name: 'Good Seed', extra: ' 4242 ', errorEl: seedBanner });
  assertEquals(result.success, true, 'A padded numeric seed is accepted');
  assertEquals(result.world.seed, 4242, 'The parsed integer, not the string, reaches createWorld');
  assertEquals(seedBanner.classList.contains('hidden'), true, 'Success hides the banner again');

  console.log('\nGroup 5: submitCreate — the manager-level limit still surfaces');

  // Decision 55 makes the greyed-out button the primary surface, but
  // CharacterManager.js:147 stays a manager-level invariant and must still be rendered.
  const limitBanner = makeBanner();
  const cmAtLimit = await managerWith(MAX_CHARACTERS);
  result = await submitCreate({
    manager: cmAtLimit, noun: 'character', name: 'Fourth', extra: '#ff0000', errorEl: limitBanner,
  });
  assertEquals(result.success, false, 'The manager still refuses a fourth character');
  assertEquals(limitBanner.textContent, `Maximum ${MAX_CHARACTERS} characters reached`,
    'The fallback banner still carries the manager\'s own message');
  assertEquals(cmAtLimit.getAllCharacters().length, MAX_CHARACTERS, 'No fourth character was stored');

  console.log('\nGroup 6: submitCreate — success, colour default and the submit override');

  const okBanner = makeBanner();
  const cm0 = await managerWith(0);
  let got = null;
  result = await submitCreate({
    manager: cm0, noun: 'character', name: 'Hero', extra: '#abcdef', errorEl: okBanner,
    onSuccess: (r) => { got = r; },
  });
  assertEquals(result.success, true, 'A valid character is created');
  assertEquals(got && got.character.name, 'Hero', 'onSuccess receives the manager result');
  // `CharacterManager.validateColor` normalises to upper case, so compare case-insensitively.
  assertEquals(cm0.getAllCharacters()[0].color.toLowerCase(), '#abcdef', 'The supplied colour is used');

  // `submitCreate` carries NO colour default of its own any more. The `extra ||
  // DEFAULT_COLOR` it used to hold was dead code — `CharacterManager.createCharacter`
  // reads `color || DEFAULT_COLOR` before it validates, so deleting the UI-side copy left
  // this behaviour byte-identical while removing a second source that could drift. What
  // is pinned here is the guarantee that survives, end to end through `submitCreate`.
  const cm1 = await managerWith(0);
  const plain = await submitCreate({
    manager: cm1, noun: 'character', name: 'Plain', extra: '', errorEl: okBanner,
  });
  const plainStored = cm1.getAllCharacters()[0];
  assertEquals(plain.success, true,
    'A blank colour field is accepted — it is not passed through as an invalid colour');
  assertEquals(plainStored && plainStored.color, DEFAULT_COLOR,
    'and the character gets DEFAULT_COLOR, applied by CharacterManager — its one owner');

  // `submit` is how CharacterScreen's edit mode reuses this function's validation.
  const editBanner = makeBanner();
  const cmEdit = await managerWith(1);
  const target = cmEdit.getAllCharacters()[0];
  let overrideRan = false;
  result = await submitCreate({
    manager: cmEdit, noun: 'character', name: 'Renamed', errorEl: editBanner,
    submit: () => { overrideRan = true; return cmEdit.updateCharacter(target.id, { name: 'Renamed' }); },
  });
  assertEquals(overrideRan, true, 'The submit override replaces the create call');
  assertEquals(result.success, true, 'Edit mode shares the same success path');
  assertEquals(cmEdit.getAllCharacters()[0].name, 'Renamed', 'The rename landed');

  console.log('\nGroup 7: banner helpers are null-guarded');

  setBanner(null, 'x');
  hideBanner(null);
  assert(true, 'setBanner(null)/hideBanner(null) do not throw — the two screens\' showError did');

  const b = makeBanner();
  setBanner(b, 'boom');
  assertEquals(b.classList.contains('hidden'), false, 'setBanner reveals');
  hideBanner(b);
  assertEquals(b.classList.contains('hidden'), true, 'hideBanner hides');

  console.log('\nGroup 8: the random prefills');

  // The loop used to `break` and then `assert(true, …)`, which printed green for an
  // assertion it had not made. It banks the counter-example instead now.
  let badColor = null;
  for (let i = 0; i < 200; i++) {
    const c = randomHexColor();
    if (!/^#[0-9a-f]{6}$/.test(c)) { badColor = c; break; }
  }
  assertEquals(badColor, null, 'randomHexColor is #rrggbb across 200 draws — nothing short escaped');

  // …and the deterministic half, because 200 random draws are not a proof. Zero is the
  // one input that exposes the padding `toString(16)` drops.
  const realRandom = Math.random;
  Math.random = () => 0;
  const zeroColor = randomHexColor();
  Math.random = realRandom;
  assertEquals(zeroColor, '#000000', 'Math.random() === 0 gives #000000, not #0 — padStart(6, "0")');

  assert(/^\d+$/.test(randomSeed()), 'randomSeed is a bare digit string, ready for a text input');

  // ── The lobby `+ New` toggle — DECISION 59 ───────────────────────────────
  //
  // The three lobby toggles are deliberately NOT `syncCreateButton`ed. A `disabled`
  // <button> dispatches no `click`, so disabling one at the limit deletes its own close
  // branch: a form left open when the last slot filled became undismissable except by
  // Escape inside the name field. Decision 55's greyed-out button is for the two *modal*
  // create buttons, which have no open state. Driven through the real `initBrowseCreateChar`
  // / `initHostForm` against the real element ids, not a re-implementation of the handler.
  console.log('\nGroup 10: the lobby + New toggle stays enabled and reports the limit');

  global.document = document; // LobbyForms resolves its ids through the global

  function mountBrowsePanel() {
    document.body.innerHTML = [
      '<button id="btn-browse-create-char">+ New</button>',
      '<div id="browse-create-char-form" class="hidden">',
      '<input id="browse-char-name"><input id="browse-char-color">',
      '<button id="btn-browse-save-char">Save</button>',
      '<div id="browse-char-error" class="hidden"></div></div>',
      '<select id="browse-character-select"></select>',
    ].join('');
  }
  const lobbyStub = (cm, wmgr) => ({
    deps: { characterManager: cm, worldManager: wmgr || null, log() {} },
    populateBrowseCharacterSelect() {},
    populateHostCharacterSelect() {},
    populateHostWorldSelect() {},
  });

  mountBrowsePanel();
  const cmToggle = await managerWith(MAX_CHARACTERS);
  initBrowseCreateChar(lobbyStub(cmToggle));
  const toggle = document.getElementById('btn-browse-create-char');
  const inlineForm = document.getElementById('browse-create-char-form');
  const inlineError = document.getElementById('browse-char-error');

  assertEquals(toggle.disabled, false,
    'The + New toggle is NEVER disabled, even at the limit — a disabled button fires no click');
  assertEquals(toggle.textContent, '+ New',
    'and it is not relabelled "Slots Full" — nothing syncs it from the manager');

  toggle.click();
  assertEquals(inlineForm.classList.contains('hidden'), true,
    'At the limit a CLOSED form does not open');
  assertEquals(inlineError.classList.contains('hidden'), false,
    'and the refused click reveals a banner rather than doing nothing at all');
  assertEquals(inlineError.textContent, `Maximum ${MAX_CHARACTERS} characters reached`,
    'which is the "Maximum N characters reached" message the save path shows');

  // One source, proved: the string the toggle rendered is the string the manager returns.
  const charRefusal = await cmToggle.createCharacter('Fourth', '#ff0000');
  assertEquals(inlineError.textContent, charRefusal.error,
    'The banner IS CharacterManager\'s own refusal string, not a second literal in the UI');
  assertEquals(cmToggle.getAllCharacters().length, MAX_CHARACTERS, 'and reading it created nothing');
  assertEquals(toggle.disabled, false, 'The toggle is still clickable after a refused open');

  // THE REGRESSION. `syncCreateButton` disabled this button at the limit, and a disabled
  // <button> dispatches no click — so this close was unreachable exactly when it mattered.
  inlineForm.classList.remove('hidden');
  toggle.click();
  assertEquals(inlineForm.classList.contains('hidden'), true,
    'An OPEN form still CLOSES at the limit — closing is never capacity-gated');

  // Below the limit nothing changed: the toggle opens and prefills as it always did.
  mountBrowsePanel();
  initBrowseCreateChar(lobbyStub(await managerWith(MAX_CHARACTERS - 1)));
  document.getElementById('btn-browse-create-char').click();
  assertEquals(document.getElementById('browse-create-char-form').classList.contains('hidden'), false,
    'One slot short of the limit the toggle still opens the form');
  assert(/^#[0-9a-f]{6}$/.test(document.getElementById('browse-char-color').value),
    'and still prefills the colour field');

  // The world half of the same ruling, for `WORLD_LIMIT_MESSAGE`.
  document.body.innerHTML = [
    '<button id="btn-host-create-world">+ New</button>',
    '<div id="host-create-world-form" class="hidden">',
    '<input id="host-world-name"><input id="host-world-seed">',
    '<button id="btn-host-save-world">Save</button>',
    '<div id="host-world-error" class="hidden"></div></div>',
    '<select id="host-world-select"></select>',
  ].join('');
  const wmFull = new WorldManager(makeStore());
  await wmFull.init();
  for (let i = 0; i < MAX_WORLDS; i++) await wmFull.createWorld(`Full${i}`, i);
  initHostForm(lobbyStub(null, wmFull));
  const worldToggle = document.getElementById('btn-host-create-world');
  const worldError = document.getElementById('host-world-error');

  assertEquals(worldToggle.disabled, false, 'The host world toggle is never disabled either');
  worldToggle.click();
  assertEquals(document.getElementById('host-create-world-form').classList.contains('hidden'), true,
    `The host world toggle refuses to open at ${MAX_WORLDS}/${MAX_WORLDS} worlds`);
  const worldRefusal = await wmFull.createWorld('Fourth');
  assertEquals(worldError.textContent, worldRefusal.error,
    'and shows WorldManager\'s own refusal string — one source, same as the character path');
  assertEquals(wmFull.getAllWorlds().length, MAX_WORLDS, 'no fourth world was created');

  // ── The structural half ──────────────────────────────────────────────────
  //
  // The behavioural tests above prove `createEntity.js` is right; they cannot prove the
  // five call sites still use it. This is the `test_globalCollisions.js` shape for the
  // same class of defect: a re-divergence would be silent otherwise.
  console.log('\nGroup 9: all five call sites still route through createEntity.js');

  const SITES = [
    ['src/ui/screens/CharacterScreen.js', 'CharacterScreen modal'],
    ['src/ui/screens/WorldScreen.js', 'WorldScreen modal'],
    ['src/ui/screens/LobbyForms.js', "the lobby's three inline forms"],
  ];
  /** Drop comment lines — these files *document* what they used to do, in prose. */
  const codeOnly = (src) => src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

  for (const [rel, label] of SITES) {
    const raw = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    const src = codeOnly(raw);
    assert(/from '\.\.\/forms\/createEntity\.js'/.test(src), `${rel} imports createEntity.js (${label})`);
    assert(!/canCreateMore\(\)/.test(src),
      `${rel} does not call canCreateMore() directly — canOpen()/syncCreateButton() own that check`);
    assert(!/textContent\s*=\s*'Slots Full'/.test(src),
      `${rel} no longer carries its own copy of the 'Slots Full' block`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n===================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('===================================');
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('Unexpected failure:', err);
  process.exit(1);
});
}));
