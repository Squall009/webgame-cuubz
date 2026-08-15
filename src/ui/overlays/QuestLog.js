import { escapeHtml } from '../../util/HTMLUtils.js';
import { ACTS } from '../../game/data/QuestDefinitions.js';

/**
 * Cuubz — the quest log overlay, bound to `J` (S1)
 *
 * The HUD tracker shows the active quest and nothing else. This is the full list: seven
 * acts, twenty-eight quests, what is done, what is next, and every title earned.
 *
 * ─── IT BUILDS ITS OWN ELEMENT ──────────────────────────────────────────────
 *
 * `#quest-tracker` is in `hud.js`'s template because it is a HUD widget that sits over
 * the game. The log is an overlay, opened and closed, and it is created here on first
 * open rather than added to the template — `test/unit/ui/pageLoad.test.js` asserts the
 * *assembled* DOM, and an always-mounted 28-row list would be 28 rows of markup that
 * exist from page load to prove nothing. The panel is built once and reused.
 *
 * ─── `J` AND NOT `Q` ────────────────────────────────────────────────────────
 *
 * `Q` is the conventional drop-item key and this game may want it. `J` is what
 * `quest_implementation.md` §9 specifies and it collides with nothing: the existing
 * bindings are WASD, Space, Shift, E (inventory), Escape (pause), F (fly) and the digits.
 *
 * The listener is registered through `state.addTeardown` by `initQuests`, not here —
 * **D-50**: eight listeners were added per `startGame()` and nothing removed them, so a
 * player who exited to the menu and started again carried a second set closing over the
 * previous `GameState`.
 */
export class QuestLog {
  /**
   * @param {object} config
   * @param {import('../../game/systems/QuestSystem.js').QuestSystem} config.questSystem
   * @param {Document} [config.doc]
   */
  constructor(config) {
    this._quests = config.questSystem;
    this._doc = config.doc || (typeof document !== 'undefined' ? document : null);
    this._el = null;
    this._open = false;
  }

  get isOpen() {
    return this._open;
  }

  /** Create the panel on first use. Idempotent. */
  _ensureElement() {
    if (this._el || !this._doc) return this._el;
    const el = this._doc.createElement('div');
    el.id = 'quest-log';
    el.className = 'hidden';
    const host = this._doc.getElementById('game-container') || this._doc.body;
    if (host) host.appendChild(el);
    this._el = el;
    return el;
  }

  toggle() {
    if (this._open) this.close();
    else this.open();
  }

  open() {
    const el = this._ensureElement();
    if (!el) return;
    this.render();
    el.classList.remove('hidden');
    this._open = true;
  }

  close() {
    if (!this._el) return;
    this._el.classList.add('hidden');
    this._open = false;
  }

  /** Rebuild the whole panel. Called on open, so cost does not matter. */
  render() {
    const el = this._ensureElement();
    if (!el) return;

    const view = this._quests.getLogView();
    const { completed, total } = this._quests.getCompletionSummary();
    const titles = this._quests.getTitles();

    const acts = ACTS.map((act) => {
      const quests = view.filter((q) => q.act === act.act);
      if (quests.length === 0) return '';
      const rows = quests.map((q) => this._questRow(q)).join('');
      const actDone = quests.every((q) => q.status === 'completed');
      return `
        <section class="quest-log-act${actDone ? ' act-complete' : ''}">
          <h3>Act ${act.act}: ${escapeHtml(act.title)}
            <span class="quest-log-theme">${escapeHtml(act.theme)}</span>
          </h3>
          ${rows}
        </section>`;
    }).join('');

    const titleList = titles.length
      ? titles.map((t) =>
          `<li><strong>${escapeHtml(t.name)}</strong> — ${escapeHtml(t.significance)}</li>`
        ).join('')
      : '<li class="quest-log-empty">None yet.</li>';

    el.innerHTML = `
      <div class="quest-log-panel">
        <header class="quest-log-header">
          <h2>📜 Quest Log</h2>
          <span class="quest-log-count">${completed}/${total} complete</span>
          <button type="button" class="quest-log-close" aria-label="Close">✕</button>
        </header>
        <div class="quest-log-body">${acts}</div>
        <footer class="quest-log-titles">
          <h3>Titles</h3>
          <ul>${titleList}</ul>
        </footer>
      </div>`;

    const closeBtn = el.querySelector('.quest-log-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
  }

  /**
   * One quest row.
   *
   * A locked quest shows its number and nothing else — no title, no narrative. The
   * storyline's turn is in Q27's text and a log that listed it from Act 1 would give
   * away that the seals were never being restored.
   */
  _questRow(q) {
    if (q.status === 'locked') {
      return `<div class="quest-log-row locked">
        <span class="quest-log-stage">${q.stage}</span>
        <span class="quest-log-title">— locked —</span>
      </div>`;
    }

    const objectives = q.objectives.length
      ? `<ul class="quest-log-objectives">${
          q.objectives.map((o) =>
            `<li>${escapeHtml(o.label || o.key)} <span>${o.n}/${o.target}</span></li>`
          ).join('')
        }</ul>`
      : '';

    const mark = q.status === 'completed' ? '✔' : q.status === 'active' ? '▶' : '○';

    return `<div class="quest-log-row ${q.status}">
      <span class="quest-log-stage">${mark} ${q.stage}</span>
      <div class="quest-log-main">
        <div class="quest-log-title">${escapeHtml(q.title)}
          <span class="quest-log-type">${escapeHtml(q.type)}</span>
        </div>
        ${q.status === 'active' && q.narrative
          ? `<p class="quest-log-narrative">${escapeHtml(q.narrative)}</p>` : ''}
        ${objectives}
      </div>
    </div>`;
  }

  /** Remove the element entirely — a session teardown, not a close. */
  dispose() {
    if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
    this._el = null;
    this._open = false;
  }
}
