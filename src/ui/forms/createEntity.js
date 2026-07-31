/**
 * Cuubz — one create-entity form, five call sites (PR 26, BUGS.md D-41)
 *
 * ─── THE FIVE ───────────────────────────────────────────────────────────────
 *
 *   1. `CharacterScreen`'s create/edit modal
 *   2. the lobby browse panel's inline character form
 *   3. the lobby host panel's inline character form
 *   4. the lobby host panel's inline world form
 *   5. `WorldScreen`'s create modal
 *
 * D-41's row says three. There are five, and they disagreed on nine separate things —
 * including two that were *opposite* for the same shape of code:
 * `CharacterScreen.js:36` read `if (cm && !cm.canCreateMore()) return;`, which **opens**
 * the modal when the manager is null, while `WorldScreen.js:47` read
 * `if (!wm || !wm.canCreateMore()) return;`, which does not.
 *
 * ─── DECISION 55 — THE GREYED-OUT BUTTON, ON THE TWO MODALS ─────────────────
 *
 * Three of the five already disabled their create button at the limit, and
 * `#char-slot-info` / `#world-slot-info` already narrate `"3/3 characters (0 slots
 * available)"`. So on the modals the button wins: `syncCreateButton` is the one
 * implementation of the `disabled` / `'Slots Full'` / `opacity` block that
 * `CharacterScreen.render` and `WorldScreen.render` carried verbatim — **disabled, not
 * hidden**, so the control stays where the player last saw it.
 *
 * **Decision 59 scopes that to `#btn-create-char` and `#btn-create-world` only.** The
 * lobby's three `+ New` toggles are *not* synced: a toggle carries an open state, a
 * `disabled` <button> dispatches no `click`, and disabling one therefore removes its own
 * close branch exactly when it matters. They stay enabled and answer a click at the limit
 * with the manager's message — see `LobbyForms.initInlineCreateForm`.
 *
 * The error banner **stays reachable everywhere**: `CharacterManager` and `WorldManager`
 * still refuse over the limit and return `CHARACTER_LIMIT_MESSAGE` /
 * `WORLD_LIMIT_MESSAGE`, and `submitCreate` still renders whichever came back. That check
 * is a manager-level invariant — the UI disabling a button is not a reason to drop it.
 *
 * Sub-ruling: **`WorldScreen`'s null-manager polarity wins.** `canOpen(null)` is `false`.
 * Refusing to open a form backed by nothing is the safer of the two behaviours, and it is
 * the one that cannot produce a modal whose save button throws.
 *
 * ─── `setBanner` IS PROMOTED, NOT REWRITTEN ─────────────────────────────────
 *
 * It was `LobbyForms.js:31-35` and it was already null-guarded. The two `showError`
 * methods on the screens were not — `document.getElementById('char-error').textContent =`
 * with no guard at all — so promoting the lobby's version and pointing both screens at it
 * closes that hole as a side effect rather than as a second fix.
 */

/** The one seed-rejection message. Paths 4 and 5 had byte-identical logic and two strings. */
export const SEED_ERROR = 'Seed must be a valid integer (or leave blank for random)';

/**
 * May a create form be opened at all?
 *
 * A missing manager is a "no" (see the header) — the two screens disagreed about this and
 * `WorldScreen`'s reading is the one kept.
 *
 * @param {{canCreateMore: function():boolean}|null|undefined} manager
 * @returns {boolean}
 */
export function canOpen(manager) {
  return !!manager && manager.canCreateMore();
}

/**
 * Set and reveal one of the five inline error banners.
 * Null-guarded: three of the five elements are inside panels that may not be mounted.
 */
export function setBanner(el, message) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

/** Hide a banner. The inverse of `setBanner`, same null tolerance. */
export function hideBanner(el) {
  if (el) el.classList.add('hidden');
}

/** A random `#rrggbb`, zero-padded — `toString(16)` drops leading zeroes. */
export function randomHexColor() {
  return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
}

/** A random 32-bit world seed, as the string a text input wants. */
export function randomSeed() {
  return String(Math.floor(Math.random() * 0xFFFFFFFF));
}

/**
 * Blank means "random, let the generator pick"; anything non-numeric is **rejected**
 * rather than silently falling back, so a typo cannot quietly produce a different world.
 *
 * @param {string} raw
 * @returns {{ok: true, seed: number|undefined}|{ok: false, error: string}}
 */
export function parseSeed(raw) {
  const trimmed = (raw || '').trim();
  if (trimmed === '') return { ok: true, seed: undefined };
  const parsed = parseInt(trimmed, 10);
  if (isNaN(parsed)) return { ok: false, error: SEED_ERROR };
  return { ok: true, seed: parsed };
}

/**
 * Reflect the manager's remaining capacity onto a create button.
 *
 * `disabled` is exactly `!canOpen(manager)`, so the button is dead precisely when the
 * click handler would refuse. The label only says `'Slots Full'` when that is *true* —
 * a null manager disables the button but keeps its normal label, because "full" would be
 * a lie about a manager that has not loaded.
 *
 * @param {HTMLButtonElement|null} btn
 * @param {{canCreateMore: function():boolean}|null|undefined} manager
 * @param {{idle: string, full: string}} labels
 */
export function syncCreateButton(btn, manager, labels) {
  if (!btn) return;
  const open = canOpen(manager);
  btn.disabled = !open;
  btn.style.opacity = open ? '1' : '0.5';
  btn.textContent = manager && !open ? labels.full : labels.idle;
}

/**
 * Validate, create, and render the outcome into one banner.
 *
 * @param {object} opts
 * @param {object} opts.manager — `CharacterManager` or `WorldManager`.
 * @param {'character'|'world'} opts.noun — picks the manager method and the messages.
 * @param {string} opts.name — already trimmed.
 * @param {string} [opts.extra] — the form's second field: a `#rrggbb` for a character,
 *   the **raw** seed text for a world (this function parses it).
 * @param {HTMLElement|null} [opts.errorEl] — the banner.
 * @param {function(object):void} [opts.onSuccess] — receives the manager's result.
 * @param {function():Promise<object>} [opts.submit] — override the create call. Used by
 *   `CharacterScreen`'s edit mode, so update shares this function's validation and banner.
 * @returns {Promise<object|null>} the manager's result, or `null` if it never got that far.
 */
export async function submitCreate({ manager, noun, name, extra, errorEl, onSuccess, submit }) {
  if (!name) {
    setBanner(errorEl, `Please enter a ${noun} name.`);
    return null;
  }
  if (!manager) {
    setBanner(errorEl, `No ${noun} storage is available — try reloading.`);
    return null;
  }

  let result;
  if (submit) {
    result = await submit();
  } else if (noun === 'world') {
    const parsed = parseSeed(extra);
    if (!parsed.ok) {
      setBanner(errorEl, parsed.error);
      return null;
    }
    result = await manager.createWorld(name, parsed.seed);
  } else {
    // `extra` is passed through blank-and-all: `CharacterManager.createCharacter` already
    // reads `color || DEFAULT_COLOR`, and a second fallback here was dead code that could
    // only ever drift from it. The colour default has one owner — the manager.
    result = await manager.createCharacter(name, extra);
  }

  if (result && result.success) {
    hideBanner(errorEl);
    if (onSuccess) onSuccess(result);
  } else {
    setBanner(errorEl, (result && result.error) || `Could not create the ${noun}.`);
  }
  return result;
}
