/**
 * Cuubz — Mouse Input Handler (Desktop)
 * Pointer lock, click events for break/place.
 */

class MouseInput {
  constructor(canvas) {
    this.canvas = canvas;
    
    // Click state
    this.leftClick = false;
    this.rightClick = false;
    this.scrollDelta = 0;
    
    // Just-clicked flags
    this.justClickedLeft = false;
    this.justClickedRight = false;
    
    // Pointer lock state
    this.locked = false;
    
    if (typeof window !== 'undefined') {
      this._bindEvents();
    }
  }

  _bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
    this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: true });
    
    // Prevent context menu on right click
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _onMouseDown(e) {
    if (e.button === 0) {
      this.leftClick = true;
      this.justClickedLeft = true;
    } else if (e.button === 2) {
      this.rightClick = true;
      this.justClickedRight = true;
    }
  }

  _onMouseUp(e) {
    if (e.button === 0) this.leftClick = false;
    if (e.button === 2) this.rightClick = false;
  }

  _onWheel(e) {
    this.scrollDelta += e.deltaY > 0 ? 1 : -1;
  }

  /**
   * Request pointer lock for mouse look
   */
  requestPointerLock() {
    if (typeof this.canvas.requestPointerLock === 'function') {
      this.canvas.requestPointerLock();
    }
  }

  /**
   * Exit pointer lock
   */
  exitPointerLock() {
    if (typeof document.exitPointerLock === 'function') {
      document.exitPointerLock();
    }
  }

  /**
   * Update — clear just-clicked flags (call once per frame)
   */
  update() {
    this.justClickedLeft = false;
    this.justClickedRight = false;
  }
}

module.exports = MouseInput;
