import { escapeHtml } from '../../util/HTMLUtils.js';

/**
 * Cuubz — the writer for `#quest-tracker` (S1)
 *
 * ─── THE MARKUP HAS BEEN THERE THE WHOLE TIME ───────────────────────────────
 *
 * `src/ui/templates/hud.js` mounts `#quest-tracker` with `#quest-name`,
 * `#quest-objective` and `#quest-progress` inside it, and `quest-tracker.css` styles all
 * four — complete, imported, and load-bearing in `index.css`'s order (D-52). The panel
 * was permanently `hidden` and had **zero writers**: four ids, thirty-six lines of CSS,
 * and nothing in the codebase that ever set their text.
 *
 * This is the writer. It adds no markup of its own beyond one `<div>` per objective,
 * because a quest can have three (Q19 wants meat, bread and ice) and the template has
 * one line for them.
 *
 * ─── IT REDRAWS ONLY WHEN SOMETHING CHANGED ─────────────────────────────────
 *
 * The tracker is driven from the frame loop and a quest's text changes a few dozen times
 * per playthrough. Rebuilding three nodes every frame would be free-ish and still wrong:
 * it would fight the CSS transition and reset any text selection. So the last-rendered
 * view is fingerprinted and an identical one is dropped. `Hotbar.updateHotbarUI`
 * recreates nine canvases per call and is throttled to every fifth frame for the same
 * class of reason — this one just does the cheaper thing.
 */
export class QuestTrackerHUD {
  /**
   * @param {Document} [doc] — injectable so the jsdom tests can drive it
   */
  constructor(doc = typeof document !== 'undefined' ? document : null) {
    this._doc = doc;
    this._root = doc ? doc.getElementById('quest-tracker') : null;
    this._nameEl = doc ? doc.getElementById('quest-name') : null;
    this._objectiveEl = doc ? doc.getElementById('quest-objective') : null;
    this._progressEl = doc ? doc.getElementById('quest-progress') : null;
    this._fingerprint = null;
    this._visible = false;
  }

  /** Every element the writer needs is present. False in a headless unit test. */
  get isMounted() {
    return !!(this._root && this._nameEl && this._objectiveEl && this._progressEl);
  }

  /**
   * Draw one `QuestSystem.getTrackerView()` result.
   * @param {object|null} view — null hides the panel (the game is complete)
   * @param {object|null} [marker] — `SealSystem.getMarker()`: a direction and a
   *   distance to the seal this quest points at. A bearing and a compass letter rather
   *   than coordinates, because a player should be able to act on it without writing
   *   anything down.
   */
  render(view, marker) {
    if (!this.isMounted) return;

    if (!view) {
      this.hide();
      return;
    }

    const fingerprint = QuestTrackerHUD.fingerprint(view, marker);
    if (fingerprint === this._fingerprint && this._visible) return;
    this._fingerprint = fingerprint;

    this._nameEl.textContent = view.title;

    // Objectives, one line each, with a tick on the ones that are done. A party can
    // finish "5 cooked meat" while still short on bread, and seeing which is which is
    // the entire job of this panel.
    this._objectiveEl.innerHTML = view.objectives
      .map((o) => {
        const mark = o.complete ? '✔' : '•';
        const cls = o.complete ? 'quest-objective-line done' : 'quest-objective-line';
        return `<div class="${cls}">${mark} ${escapeHtml(o.label || o.key)}` +
          ` <span class="quest-objective-count">${o.n}/${o.target}</span></div>`;
      })
      .join('');

    const done = view.objectives.filter((o) => o.complete).length;
    let progress = `Act ${view.act} · Quest ${view.stage}/28 · ${done}/${view.objectives.length} objectives`;
    if (marker) {
      progress += ` · ${escapeHtml(marker.name)} ${marker.compass} ${marker.distance}m`;
    }
    this._progressEl.textContent = progress;

    this.show();
  }

  /**
   * A stable string for "the panel would look identical".
   *
   * Includes the counts, not just the ids: a pool moving from 4/20 to 5/20 has to
   * redraw, and that is the only thing that changes most of the time.
   */
  static fingerprint(view, marker) {
    return [
      view.id,
      view.title,
      ...view.objectives.map((o) => `${o.key}:${o.n}/${o.target}:${o.complete ? 1 : 0}`),
      // Rounded to 8 m so walking does not rebuild the panel every frame — the marker
      // is a direction, not a rangefinder.
      marker ? `${marker.sealId}:${marker.compass}:${Math.round(marker.distance / 8)}` : '',
    ].join('|');
  }

  show() {
    if (!this._root) return;
    this._root.classList.remove('hidden');
    this._visible = true;
  }

  hide() {
    if (!this._root) return;
    this._root.classList.add('hidden');
    this._visible = false;
    this._fingerprint = null;
  }

  /**
   * Flash the panel when a quest completes. Purely cosmetic and entirely optional — the
   * class is removed on a timer, and a missing element makes it a no-op.
   */
  flashComplete() {
    if (!this._root || !this._doc) return;
    this._root.classList.add('quest-complete-flash');
    const timer = setTimeout(() => {
      if (this._root) this._root.classList.remove('quest-complete-flash');
    }, 1200);
    // Returned so a teardown can cancel it; a session that ends mid-flash would
    // otherwise touch a detached node.
    return timer;
  }
}
