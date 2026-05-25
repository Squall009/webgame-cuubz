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
    
    // Disposed flag for cleanup safety
    this._disposed = false;
    
    // Store bound handler references for removal on dispose
    this._onMouseDownBound = null;
    this._onMouseUpBound = null;
    this._onWheelBound = null;
    this._onContextMenuBound = null;
    
    if (typeof window !== 'undefined') {
      this._bindEvents();
    }
  }

  _bindEvents() {
    // Store bound references so we can remove them on dispose
    this._onMouseDownBound = (e) => this._onMouseDown(e);
    this._onMouseUpBound = (e) => this._onMouseUp(e);
    this._onWheelBound = (e) => this._onWheel(e);
    this._onContextMenuBound = (e) => e.preventDefault();
    
    this.canvas.addEventListener('mousedown', this._onMouseDownBound);
    this.canvas.addEventListener('mouseup', this._onMouseUpBound);
    this.canvas.addEventListener('wheel', this._onWheelBound, { passive: true });
    
    // Prevent context menu on right click
    this.canvas.addEventListener('contextmenu', this._onContextMenuBound);
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
    if (typeof document !== 'undefined' && typeof document.exitPointerLock === 'function') {
      document.exitPointerLock();
    }
  }

  /**
   * Update — clear just-clicked flags (call once per frame)
   */
  update() {
    if (this._disposed) return;
    this.justClickedLeft = false;
    this.justClickedRight = false;
  }

  /**
   * Clean up event listeners and release resources.
   * Call when the game is shutting down or switching screens.
   * Idempotent — safe to call multiple times.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    // Exit pointer lock if active
    this.exitPointerLock();

    if (typeof document !== 'undefined' && this.canvas) {
      if (this._onMouseDownBound) {
        this.canvas.removeEventListener('mousedown', this._onMouseDownBound);
      }
      if (this._onMouseUpBound) {
        this.canvas.removeEventListener('mouseup', this._onMouseUpBound);
      }
      if (this._onWheelBound) {
        this.canvas.removeEventListener('wheel', this._onWheelBound);
      }
      if (this._onContextMenuBound) {
        this.canvas.removeEventListener('contextmenu', this._onContextMenuBound);
      }
    }

    // Clear references to allow GC
    this._onMouseDownBound = null;
    this._onMouseUpBound = null;
    this._onWheelBound = null;
    this._onContextMenuBound = null;
    this.canvas = null;
  }
}

module.exports = MouseInput;
