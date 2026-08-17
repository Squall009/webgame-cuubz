import { escapeHtml } from '../../util/HTMLUtils.js';

/**
 * Cuubz — the boss health bar (S6)
 *
 * The one piece of new HUD markup this whole feature adds. Everything else — the quest
 * tracker, the five meters, the damage flash — was already in `hud.js` waiting for a
 * writer; a boss bar was not, because there was never a boss.
 *
 * ─── IT MOUNTS ITSELF, LIKE THE QUEST LOG ──────────────────────────────────
 *
 * Built on first show rather than added to the template. `pageLoad.test.js` asserts the
 * *assembled* DOM, and a permanently-mounted boss bar would be markup that exists from
 * page load to prove nothing — it is visible for perhaps six minutes of a playthrough.
 *
 * ─── PHASE IS SHOWN, NOT JUST HP ────────────────────────────────────────────
 *
 * The Corruption Overlord has three phases and the five seal bosses have two. A bar that
 * only fell would make "it stopped taking damage" (a shield) and "it came apart and
 * reassembled" (a phase transition) look identical to a player, and both of those are
 * things they need to react to.
 */
export class BossBar {
  /**
   * @param {Document} [doc]
   */
  constructor(doc = typeof document !== 'undefined' ? document : null) {
    this._doc = doc;
    this._el = null;
    this._fillEl = null;
    this._nameEl = null;
    this._phaseEl = null;
    this._visible = false;
    this._fingerprint = null;
  }

  get isVisible() {
    return this._visible;
  }

  _ensureElement() {
    if (this._el || !this._doc) return this._el;
    const el = this._doc.createElement('div');
    el.id = 'boss-bar';
    el.className = 'hidden';
    el.innerHTML = `
      <div class="boss-bar-name"></div>
      <div class="boss-bar-track"><div class="boss-bar-fill"></div></div>
      <div class="boss-bar-phase"></div>`;
    const host = this._doc.getElementById('hud') || this._doc.body;
    if (host) host.appendChild(el);
    this._el = el;
    this._nameEl = el.querySelector('.boss-bar-name');
    this._fillEl = el.querySelector('.boss-bar-fill');
    this._phaseEl = el.querySelector('.boss-bar-phase');
    return el;
  }

  /**
   * @param {object|null} boss — a `BossEntity`, or null to hide
   */
  render(boss) {
    if (!boss || boss.isDead) { this.hide(); return; }
    const el = this._ensureElement();
    if (!el) return;

    const fraction = boss.hpFraction;
    const phase = boss.phase;
    const fingerprint = `${boss.id}|${Math.round(fraction * 200)}|${boss.phaseIndex}|${boss.isShielded ? 1 : 0}`;
    if (fingerprint === this._fingerprint && this._visible) return;
    this._fingerprint = fingerprint;

    this._nameEl.textContent = boss.definition.name;
    this._fillEl.style.width = `${(fraction * 100).toFixed(1)}%`;

    // A shielded boss is taking no damage, and the bar has to say so — otherwise the
    // player reads a frozen bar as a bug and keeps hitting it.
    if (boss.isShielded) {
      this._fillEl.classList.add('shielded');
      this._phaseEl.textContent = 'SHIELDED — break it';
    } else {
      this._fillEl.classList.remove('shielded');
      const total = boss.definition.phases.length;
      const label = phase && phase.name ? phase.name : `Phase ${boss.phaseIndex + 1}`;
      this._phaseEl.innerHTML = total > 1
        ? `${escapeHtml(label)} <span class="boss-bar-phase-count">${boss.phaseIndex + 1}/${total}</span>`
        : '';
    }

    this.show();
  }

  show() {
    if (!this._el) return;
    this._el.classList.remove('hidden');
    this._visible = true;
  }

  hide() {
    if (!this._el) return;
    this._el.classList.add('hidden');
    this._visible = false;
    this._fingerprint = null;
  }

  /** Remove it entirely — a session teardown, not a hide. */
  dispose() {
    if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
    this._el = null;
    this._fillEl = null;
    this._nameEl = null;
    this._phaseEl = null;
    this._visible = false;
  }
}
