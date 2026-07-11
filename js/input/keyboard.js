/**
 * Cuubz — Keyboard Input Handler (Desktop)
 * WASD movement, Space jump, Shift sprint, E interact.
 *
 * Uses InputAction for edge detection (down/up/held) on jump and sneak
 * so the game loop gets clean one-shot events instead of level signals.
 */

/**
 * Tracks state transitions for a single boolean input.
 * Call update(current) once per frame with the raw boolean.
 */
class InputAction {
  constructor() {
    this.prev = false;
    this.down = false;  // just pressed (true for one frame)
    this.up   = false;  // just released (true for one frame)
    this.held = false;  // currently pressed
  }

  update(current) {
    this.down = !this.prev && !!current;
    this.up   = this.prev && !current;
    this.held = !!current;
    this.prev = this.held;
  }
}

class KeyboardInput {
  constructor() {
    this.keys = {}; // key code → boolean

    // Movement state (level signals — true while held)
    this.forward = false;
    this.backward = false;
    this.left = false;
    this.right = false;
    this.sprint = false;
    this.interact = false;

    // Edge-detected actions (call .update() once per frame)
    this.jumpAction = new InputAction();
    this.sneakAction = new InputAction();

    // Disposed flag for cleanup safety
    this._disposed = false;

    // Just-pressed tracking (for backward compatibility)
    this._justPressed = {};

    // Store bound handler references for removal on dispose
    this._onKeyDownBound = null;
    this._onKeyUpBound = null;

    if (typeof window !== 'undefined') {
      this._bindEvents();
    }
  }

  _bindEvents() {
    this._onKeyDownBound = (e) => this._onKeyDown(e);
    this._onKeyUpBound = (e) => this._onKeyUp(e);

    document.addEventListener('keydown', this._onKeyDownBound);
    document.addEventListener('keyup', this._onKeyUpBound);
  }

  _onKeyDown(e) {
    const code = e.code;
    this.keys[code] = true;
    this._justPressed[code] = true;

    switch (code) {
      case 'KeyW': this.forward = true; break;
      case 'KeyS': this.backward = true; break;
      case 'KeyA': this.left = true; break;
      case 'KeyD': this.right = true; break;
      case 'Space': this.keys['Space'] = true; e.preventDefault(); break;
      case 'ShiftLeft': case 'ShiftRight': this.sprint = true; break;
      case 'KeyE': this.interact = true; break;
    }
  }

  _onKeyUp(e) {
    const code = e.code;
    this.keys[code] = false;

    switch (code) {
      case 'KeyW': this.forward = false; break;
      case 'KeyS': this.backward = false; break;
      case 'KeyA': this.left = false; break;
      case 'KeyD': this.right = false; break;
      case 'Space': this.keys['Space'] = false; break;
      case 'ShiftLeft': case 'ShiftRight': this.sprint = false; break;
      case 'KeyE': this.interact = false; break;
    }
  }

  /**
   * Update edge-detected actions (call once per frame).
   * Converts raw key levels into down/up/held signals.
   */
  update() {
    if (this._disposed) return;

    // Jump = Space key
    this.jumpAction.update(!!this.keys['Space']);

    // Sneak = Shift keys
    this.sneakAction.update(!!(this.keys['ShiftLeft'] || this.keys['ShiftRight']));

    // Clear just-pressed map
    this._justPressed = {};
  }

  /**
   * Check if a key was just pressed this frame (before update() clears it).
   * Returns true only once per press. Kept for backward compatibility.
   */
  isJustPressed(code) {
    return !!this._justPressed[code];
  }

  /**
   * Clean up event listeners and release resources.
   * Call when the game is shutting down or switching screens.
   * Idempotent — safe to call multiple times.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    if (typeof document !== 'undefined') {
      if (this._onKeyDownBound) {
        document.removeEventListener('keydown', this._onKeyDownBound);
      }
      if (this._onKeyUpBound) {
        document.removeEventListener('keyup', this._onKeyUpBound);
      }
    }

    this._onKeyDownBound = null;
    this._onKeyUpBound = null;
    this.keys = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KeyboardInput, InputAction };
}
