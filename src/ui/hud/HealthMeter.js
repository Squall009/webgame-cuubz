/**
 * Cuubz — the writer for `#health-meter .meter-fill` (S3)
 *
 * ─── FIVE BARS, HARD-CODED TO 100%, WITH NO WRITER ──────────────────────────
 *
 * `hud.js` mounts health, hunger, thirst, sleep and stamina; `meters.css` sets
 * `.meter-fill { width: 100% }` and its own comment says *"Nothing in src/ ever writes
 * `.meter-fill`"*. That was true. This file makes it false for exactly one of the five.
 *
 * The other four keep their 100% and keep their comment. There is no hunger system, no
 * thirst system and no stamina system — PR 34 deleted the 1,159-line one — and a bar
 * that animates while nothing behind it exists is a worse lie than a bar that plainly
 * does not move.
 *
 * ─── COLOUR IS THE ONLY WARNING THE HUD GIVES ───────────────────────────────
 *
 * There is no low-health sound and no screen border. The bar goes green → amber → red so
 * that a player mining in a corrupt patch, whose health is draining at 0.25/s behind
 * them, has something to notice before it matters.
 */

/** Above this fraction the bar is green. */
const HEALTHY = 0.5;
/** Below this it is red. */
const CRITICAL = 0.25;

const COLOR_HEALTHY = '#4caf50';
const COLOR_HURT = '#ff9800';
const COLOR_CRITICAL = '#e53935';

export class HealthMeter {
  /**
   * @param {Document} [doc]
   */
  constructor(doc = typeof document !== 'undefined' ? document : null) {
    this._doc = doc;
    const meter = doc ? doc.getElementById('health-meter') : null;
    this._fill = meter ? meter.querySelector('.meter-fill') : null;
    this._flash = doc ? doc.getElementById('damage-flash') : null;
    this._flashTimer = null;
  }

  get isMounted() {
    return !!this._fill;
  }

  /**
   * @param {number} health
   * @param {number} maxHealth
   */
  render(health, maxHealth) {
    if (!this._fill) return;
    const fraction = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;
    this._fill.style.width = `${(fraction * 100).toFixed(1)}%`;
    this._fill.style.backgroundColor =
      fraction > HEALTHY ? COLOR_HEALTHY : fraction > CRITICAL ? COLOR_HURT : COLOR_CRITICAL;
  }

  /**
   * The red vignette, on a hit.
   *
   * `#damage-flash` and its `.active` rule have been in the template and the stylesheet
   * with no writer, exactly like the meters. The 150 ms matches the CSS transition.
   */
  flashDamage() {
    if (!this._flash) return;
    this._flash.classList.add('active');
    if (this._flashTimer) clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      if (this._flash) this._flash.classList.remove('active');
      this._flashTimer = null;
    }, 150);
  }

  /** Cancel a pending un-flash — a session teardown must not touch a detached node. */
  dispose() {
    if (this._flashTimer) {
      clearTimeout(this._flashTimer);
      this._flashTimer = null;
    }
    if (this._flash) this._flash.classList.remove('active');
  }
}
