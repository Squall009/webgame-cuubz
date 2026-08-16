// @vitest-environment jsdom
/**
 * Cuubz — the v1→v2 worldgen opt-in, against the assembled DOM (S9)
 *
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * `quest_implementation.md` §3.1 gates the Corrupt and Lava biomes behind
 * `worldgenVersion` so that existing saves generate byte-identically, and open question
 * **Q8** answers "both" — new worlds get 2, existing ones get an opt-in.
 * `WorldManager.upgradeWorldgen(id)` has been the mechanism since S4 and §13 recorded the
 * gap in as many words: *"the world-screen confirmation UI is not built, so today the
 * upgrade has a mechanism and no button."* Without it a v1 world can never reach the
 * Corrupt or Lava biome, and therefore can never complete the Verdant or Ember seal —
 * two of the five the finale requires.
 *
 * ─── WHY jsdom AND NOT A SCREENSHOT ─────────────────────────────────────────
 *
 * Browser e2e cannot run in this environment (§11), so this does what
 * `test/unit/ui/questHud.test.js` does: mount the real templates into a jsdom document
 * and drive the real screen object against them, with a real `WorldManager` over an
 * in-memory store behind it. Every claim below is a DOM fact or a persisted-state fact,
 * which is what actually breaks here — a badge that never renders, a confirm button
 * wired to nothing, a version that does not survive the save.
 *
 * The `UIManager` is the real one, constructed but not navigated, because
 * `modals.upgradeWorldgenModal` resolving at all is one of the things under test.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mountTemplates } from '../../../src/ui/templates/index.js';
import { UIManager } from '../../../src/ui/UIManager.js';
import { WorldScreen } from '../../../src/ui/screens/WorldScreen.js';
import {
  WorldManager, CURRENT_WORLDGEN_VERSION, WORLDGEN_VERSION_LEGACY,
} from '../../../src/game/entities/WorldManager.js';

/** The in-memory backend the other world tests use, trimmed to what this one needs. */
function makeStore(seedWorlds = []) {
  const worlds = seedWorlds.map(w => ({ ...w }));
  return {
    saved: worlds,
    async saveWorld(d) {
      const i = worlds.findIndex(w => w.id === d.id);
      if (i >= 0) worlds[i] = { ...d }; else worlds.push({ ...d });
    },
    async loadWorlds() { return worlds.map(w => ({ ...w })); },
    async deleteWorld(id) { worlds.splice(worlds.findIndex(w => w.id === id), 1); },
  };
}

/** A world in the shape `PersistenceManager` hands back, at whichever version. */
function worldRow(id, name, version) {
  const row = {
    id, name, seed: 42,
    biomeMap: WorldManager.generateBiomeMap(42),
    chunkReferences: [], createdAt: 1, lastPlayed: null,
  };
  // A pre-S4 world has NO `worldgenVersion` field at all — that absence is the thing
  // `getWorldgenVersion` defaults to 1, so the fixture reproduces it rather than
  // writing `worldgenVersion: 1`, which no real save contains.
  if (version !== undefined) row.worldgenVersion = version;
  return row;
}

let wm, ui, screen, store;

async function setup(rows) {
  document.body.innerHTML = '<div id="app"></div>';
  mountTemplates(document.getElementById('app'));
  store = makeStore(rows);
  wm = new WorldManager(store);
  await wm.init();
  ui = new UIManager({ worldManager: wm, log: () => {} });
  screen = new WorldScreen(ui);
  ui.registerScreens({ character: null, world: screen, lobby: null, settings: null });
  screen.init();
  screen.render();
}

beforeEach(async () => {
  await setup([
    worldRow('w-old', 'Old World', undefined),
    worldRow('w-new', 'New World', CURRENT_WORLDGEN_VERSION),
  ]);
});

const slotFor = (id) => document.querySelector(`.world-slot[data-world-id="${id}"]`);

describe('the upgrade badge on a world slot', () => {
  it('appears on a world that predates the new biomes and not on one that has them', () => {
    expect(slotFor('w-old').querySelector('[data-action="upgrade"]')).not.toBeNull();
    expect(slotFor('w-new').querySelector('[data-action="upgrade"]')).toBeNull();
  });

  it('is not inside .world-slot-actions, which is invisible until hover', () => {
    // `screens/slots.css` gives `.world-slot-actions` `opacity: 0` and only reveals it on
    // `.world-slot:hover`. That is right for a destructive button nobody should find by
    // accident and wrong for the one control that makes half the endgame reachable — so
    // the badge is its own always-visible element. This assertion is the only thing that
    // stops someone tidying it into the actions row.
    const badge = slotFor('w-old').querySelector('[data-action="upgrade"]');
    expect(badge.closest('.world-slot-actions')).toBeNull();
  });

  it('does not enter the world when clicked', () => {
    // The slot's own click handler calls `selectWorld` and shows the mode screen. Every
    // control inside it therefore has to stop propagation, which the delete button does
    // and which a new one is very easy to forget.
    let shown = null;
    ui.show = (name) => { shown = name; };
    slotFor('w-old').querySelector('[data-action="upgrade"]').click();
    expect(shown).toBeNull();
    expect(wm.selectedId).toBeNull();
  });
});

describe('the confirmation', () => {
  it('opens a modal naming the world and warning about the seam', () => {
    const modal = document.getElementById('upgrade-worldgen-modal');
    expect(modal.classList.contains('hidden')).toBe(true);

    slotFor('w-old').querySelector('[data-action="upgrade"]').click();

    expect(modal.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('upgrade-worldgen-name').textContent).toContain('Old World');
    // §3.1 asks for "this will seam your terrain" in as many words. The word is the
    // contract: a player has to be told that already-explored land keeps its old shape.
    expect(modal.textContent.toLowerCase()).toContain('seam');
    expect(modal.textContent.toLowerCase()).toContain('cannot be undone');
  });

  it('cancelling changes nothing', async () => {
    slotFor('w-old').querySelector('[data-action="upgrade"]').click();
    document.getElementById('btn-cancel-upgrade-worldgen').click();

    expect(document.getElementById('upgrade-worldgen-modal').classList.contains('hidden')).toBe(true);
    expect(wm.getWorldgenVersion('w-old')).toBe(WORLDGEN_VERSION_LEGACY);
    expect(store.saved.find(w => w.id === 'w-old').worldgenVersion).toBeUndefined();
  });

  it('confirming upgrades the world, persists it, and closes', async () => {
    slotFor('w-old').querySelector('[data-action="upgrade"]').click();
    await screen.confirmUpgrade();

    expect(document.getElementById('upgrade-worldgen-modal').classList.contains('hidden')).toBe(true);
    expect(wm.getWorldgenVersion('w-old')).toBe(CURRENT_WORLDGEN_VERSION);
    // Persisted, not merely mutated in the cache — the whole point is that the next
    // session generates different terrain.
    expect(store.saved.find(w => w.id === 'w-old').worldgenVersion).toBe(CURRENT_WORLDGEN_VERSION);
  });

  it('re-renders, so the badge is gone without a screen change', async () => {
    slotFor('w-old').querySelector('[data-action="upgrade"]').click();
    await screen.confirmUpgrade();
    expect(slotFor('w-old').querySelector('[data-action="upgrade"]')).toBeNull();
  });

  it('the confirm button is wired to the modal, not to a captured world', async () => {
    // The dataset carries which world the modal is for, the way the shared delete modal
    // does. A closure captured at open time would work here and break the moment two
    // opens interleave, so the wiring is asserted through the button rather than through
    // `confirmUpgrade(id)`.
    slotFor('w-old').querySelector('[data-action="upgrade"]').click();
    expect(document.getElementById('upgrade-worldgen-modal').dataset.worldId).toBe('w-old');

    document.getElementById('btn-confirm-upgrade-worldgen').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(wm.getWorldgenVersion('w-old')).toBe(CURRENT_WORLDGEN_VERSION);
  });

  it('surfaces a save failure instead of claiming success', async () => {
    await setup([worldRow('w-old', 'Old World', undefined)]);
    store.saveWorld = async () => { throw new Error('quota exceeded'); };

    slotFor('w-old').querySelector('[data-action="upgrade"]').click();
    await screen.confirmUpgrade();

    const err = document.getElementById('upgrade-worldgen-error');
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toContain('quota exceeded');
    // Still open, so the player can see what happened and try again.
    expect(document.getElementById('upgrade-worldgen-modal').classList.contains('hidden')).toBe(false);
  });

  it('D-122 — a failed save leaves the world on v1 in the cache too, not just on disk', async () => {
    // `upgradeWorldgen` used to set `world.worldgenVersion = 2` and *then* try to save,
    // returning `{success:false}` on a throw with the cache already mutated. Disk said 1,
    // memory said 2, and the live session would have generated v2 chunks into a world
    // that reloads as v1 — the exact mixed terrain §3.1's versioning exists to prevent,
    // arrived at without the confirmation this modal is for. `deleteWorld` two methods
    // above has always mutated only after the storage call returns.
    await setup([worldRow('w-old', 'Old World', undefined)]);
    store.saveWorld = async () => { throw new Error('quota exceeded'); };

    slotFor('w-old').querySelector('[data-action="upgrade"]').click();
    await screen.confirmUpgrade();

    expect(wm.getWorldgenVersion('w-old')).toBe(WORLDGEN_VERSION_LEGACY);
    // And the field is *absent* again, not present-and-1: a pre-S4 save has no such key,
    // and `serialize()` writes whatever is on the object.
    expect('worldgenVersion' in wm.getWorld('w-old')).toBe(false);

    // The badge is still there, because the offer is still open.
    screen.render();
    expect(slotFor('w-old').querySelector('[data-action="upgrade"]')).not.toBeNull();
  });
});

describe('the modal itself', () => {
  it('is reachable from UIManager.modals, like the other three', () => {
    expect(ui.modals.upgradeWorldgenModal).toBe(document.getElementById('upgrade-worldgen-modal'));
  });

  it('is not a .screen, so showScreen() cannot hide or reveal it', () => {
    // Modals are deliberately outside `UIManager.screens` — `show()` hides everything in
    // that map. A new modal that picked up `.screen` would be un-hidden by the first
    // navigation.
    expect(document.getElementById('upgrade-worldgen-modal').classList.contains('screen')).toBe(false);
  });
});
