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
    
    // Key press events (for single-press actions)
    this.justPressed = {};
    
    if (typeof window !== 'undefined') {
      this._bindEvents();
    }
  }

  _bindEvents() {
    document.addEventListener('keydown', (e) => this._onKeyDown(e));
    document.addEventListener('keyup', (e) => this._onKeyUp(e));
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
    }
  }

  /**
   * Clear just-pressed flags (call once per frame)
   */
  update() {
    this.justPressed = {};
  }

  /**
   * Check if a key was just pressed this frame
   */
  isJustPressed(code) {
    return !!this.justPressed[code];
  }
}

module.exports = KeyboardInput;
