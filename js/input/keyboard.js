/**
 * Cuubz — Keyboard Input Handler (Desktop)
 * WASD movement, Space jump, Shift sprint, E interact.
 */

class KeyboardInput {
  constructor() {
    this.keys = {}; // key code → boolean
    
    // Input state
    this.forward = false;
    this.backward = false;
    this.left = false;
    this.right = false;
    this.jump = false;
    this.sprint = false;
    this.interact = false;
    this.flyToggle = false;  // Press F to toggle fly mode off in survival
    
    // Key press events (for single-press actions)
    this.justPressed = {};
    
    // Disposed flag for cleanup safety
    this._disposed = false;
    
    // Store bound handler references for removal on dispose
    this._onKeyDownBound = null;
    this._onKeyUpBound = null;
    
    if (typeof window !== 'undefined') {
      this._bindEvents();
    }
  }

  _bindEvents() {
    // Store bound references so we can remove them on dispose
    this._onKeyDownBound = (e) => this._onKeyDown(e);
    this._onKeyUpBound = (e) => this._onKeyUp(e);
    
    document.addEventListener('keydown', this._onKeyDownBound);
    document.addEventListener('keyup', this._onKeyUpBound);
  }

  _onKeyDown(e) {
    const code = e.code;
    this.keys[code] = true;
    this.justPressed[code] = true;
    
    switch (code) {
      case 'KeyW': this.forward = true; break;
      case 'KeyS': this.backward = true; break;
      case 'KeyA': this.left = true; break;
      case 'KeyD': this.right = true; break;
      case 'Space': this.jump = true; e.preventDefault(); break;
      case 'ShiftLeft': case 'ShiftRight': this.sprint = true; break;
      case 'KeyE': this.interact = true; break;
      case 'KeyF': 
        this.flyToggle = true; 
        this._pendingJustPressed = 'KeyF';
        break;
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
      case 'Space': this.jump = false; break;
      case 'ShiftLeft': case 'ShiftRight': this.sprint = false; break;
      case 'KeyE': this.interact = false; break;
      case 'KeyF': 
        this.flyToggle = false; 
        break;
    }
  }

  /**
   * Clear just-pressed flags (call once per frame)
   */
  update() {
    if (this._disposed) return;
    this.justPressed = {};
    // Consume _pendingJustPressed — keys pressed this frame that haven't been read yet
    this._pendingJustPressed = null;
  }

  /**
   * Check if a key was just pressed this frame (before update() clears it).
   * Returns true only once per press.
   */
  isJustPressed(code) {
    return !!this.justPressed[code];
  }

  /**
   * Get the single-press flag for KeyF and clear it immediately.
   * Used for one-shot actions like toggling fly mode.
   */
  consumeFlyToggle() {
    const wasPressed = this._pendingJustPressed === 'KeyF';
    this._pendingJustPressed = null;
    return wasPressed;
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

    // Clear references to allow GC
    this._onKeyDownBound = null;
    this._onKeyUpBound = null;
    this.keys = null;
    this.justPressed = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KeyboardInput;

}