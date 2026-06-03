/**
 * Cuubz — Touch Input Handler (Mobile-First)
 * Virtual joystick (left), swipe-to-look (right), tap to interact.
 */

class TouchInput {
  constructor() {
    // Joystick state
    this.joystickActive = false;
    this.joystickX = 0; // -1 to 1
    this.joystickY = 0; // -1 to 1
    
    // Look (swipe) state
    this.lookActive = false;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.lastLookX = 0;
    this.lastLookY = 0;
    
    // Tap detection
    this.justTapped = false;
    this.tapTimeout = null;
    
    // Mobile action button states (break, place)
    this.breakPressed = false;
    this.placePressed = false;
    
    // Jump button state
    this.jump = false;
    
    // Disposed flag for cleanup safety
    this._disposed = false;
    
    // Store bound handler references for removal on dispose
    this._handlers = {};
    
    if (typeof window !== 'undefined') {
      this._bindEvents();
    }
  }

  _bindEvents() {
    const joystickZone = document.getElementById('joystick-zone');
    const lookZone = document.getElementById('look-zone');
    
    // Store bound references for cleanup
    this._handlers.onJoystickStart = (e) => this._onJoystickStart(e);
    this._handlers.onJoystickMove = (e) => this._onJoystickMove(e);
    this._handlers.onJoystickEnd = (e) => this._onJoystickEnd(e);
    this._handlers.onLookStart = (e) => this._onLookStart(e);
    this._handlers.onLookMove = (e) => this._onLookMove(e);
    this._handlers.onLookEnd = (e) => this._onLookEnd(e);
    
    if (joystickZone) {
      joystickZone.addEventListener('touchstart', this._handlers.onJoystickStart, { passive: false });
      joystickZone.addEventListener('touchmove', this._handlers.onJoystickMove, { passive: false });
      joystickZone.addEventListener('touchend', this._handlers.onJoystickEnd, { passive: false });
    }
    
    if (lookZone) {
      lookZone.addEventListener('touchstart', this._handlers.onLookStart, { passive: false });
      lookZone.addEventListener('touchmove', this._handlers.onLookMove, { passive: false });
      lookZone.addEventListener('touchend', this._handlers.onLookEnd, { passive: false });
    }
    
    // Mobile action buttons
    const jumpBtn = document.getElementById('btn-jump-mobile');
    if (jumpBtn) {
      this._handlers.onJumpStart = (e) => { e.preventDefault(); this.jump = true; };
      this._handlers.onJumpEnd = (e) => { e.preventDefault(); this.jump = false; };
      jumpBtn.addEventListener('touchstart', this._handlers.onJumpStart);
      jumpBtn.addEventListener('touchend', this._handlers.onJumpEnd);
    }
    
    // Break block button
    const breakBtn = document.getElementById('btn-break-mobile');
    if (breakBtn) {
      this._handlers.onBreakStart = (e) => { e.preventDefault(); this.breakPressed = true; };
      this._handlers.onBreakEnd = (e) => { e.preventDefault(); this.breakPressed = false; };
      breakBtn.addEventListener('touchstart', this._handlers.onBreakStart);
      breakBtn.addEventListener('touchend', this._handlers.onBreakEnd);
    }
    
    // Place block button
    const placeBtn = document.getElementById('btn-place-mobile');
    if (placeBtn) {
      this._handlers.onPlaceStart = (e) => { e.preventDefault(); this.placePressed = true; };
      this._handlers.onPlaceEnd = (e) => { e.preventDefault(); this.placePressed = false; };
      placeBtn.addEventListener('touchstart', this._handlers.onPlaceStart);
      placeBtn.addEventListener('touchend', this._handlers.onPlaceEnd);
    }
  }

  _onJoystickStart(e) {
    e.preventDefault();
    this.joystickActive = true;
    
    const touch = e.touches[0];
    this._joystickOriginX = touch.clientX;
    this._joystickOriginY = touch.clientY;
  }

  _onJoystickMove(e) {
    e.preventDefault();
    if (!this.joystickActive) return;
    
    const touch = e.touches[0];
    const dx = touch.clientX - this._joystickOriginX;
    const dy = touch.clientY - this._joystickOriginY;
    
    // Clamp to joystick radius (60px)
    const maxDist = 60;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > maxDist) {
      this.joystickX = (dx / dist) * maxDist / maxDist;
      this.joystickY = (dy / dist) * maxDist / maxDist;
    } else {
      this.joystickX = dx / maxDist;
      this.joystickY = dy / maxDist;
    }
    
    // Update visual thumb position (browser only)
    if (typeof document !== 'undefined') {
      const thumb = document.getElementById('joystick-thumb');
      if (thumb) {
        const clampedDx = Math.sign(dx) * Math.min(dist, maxDist);
        const clampedDy = Math.sign(dy) * Math.min(dist, maxDist);
        thumb.style.left = (35 + clampedDx) + 'px';
        thumb.style.top = (35 + clampedDy) + 'px';
      }
    }
  }

  _onJoystickEnd(e) {
    e.preventDefault();
    this.joystickActive = false;
    this.joystickX = 0;
    this.joystickY = 0;
    
    // Reset thumb position (browser only)
    if (typeof document !== 'undefined') {
      const thumb = document.getElementById('joystick-thumb');
      if (thumb) {
        thumb.style.left = '35px';
        thumb.style.top = '35px';
      }
    }
  }

  _onLookStart(e) {
    e.preventDefault();
    this.lookActive = true;
    
    const touch = e.touches[0];
    this.lastLookX = touch.clientX;
    this.lastLookY = touch.clientY;
    
    // Start tap timer
    if (this.tapTimeout) clearTimeout(this.tapTimeout);
    this.tapTimeout = setTimeout(() => {
      this.justTapped = false; // Long press, not a tap
    }, 200);
  }

  _onLookMove(e) {
    e.preventDefault();
    if (!this.lookActive) return;
    
    const touch = e.touches[0];
    this.lookDeltaX += touch.clientX - this.lastLookX;
    this.lookDeltaY += touch.clientY - this.lastLookY;
    
    this.lastLookX = touch.clientX;
    this.lastLookY = touch.clientY;
  }

  _onLookEnd(e) {
    e.preventDefault();
    this.lookActive = false;
    this.justTapped = true;
    
    if (this.tapTimeout) {
      clearTimeout(this.tapTimeout);
      this.tapTimeout = null;
    }
  }

  /**
   * Update — clear per-frame state
   */
  update() {
    // Look deltas accumulate, so we don't clear them here
    // They should be consumed by the game loop
  }

  /**
   * Consume look deltas (call after using)
   */
  consumeLookDeltas() {
    const dx = this.lookDeltaX;
    const dy = this.lookDeltaY;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    return { x: dx, y: dy };
  }

  /**
   * Check if tap occurred (for break/place)
   */
  checkTap() {
    const tapped = this.justTapped;
    this.justTapped = false;
    return tapped;
  }

  /**
   * Clean up event listeners, timers, and release resources.
   * Call when the game is shutting down or switching screens.
   * Idempotent — safe to call multiple times.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    // Clear tap timeout timer
    if (this.tapTimeout) {
      clearTimeout(this.tapTimeout);
      this.tapTimeout = null;
    }

    // Remove all event listeners
    if (typeof document !== 'undefined') {
      const joystickZone = document.getElementById('joystick-zone');
      if (joystickZone) {
        if (this._handlers.onJoystickStart) joystickZone.removeEventListener('touchstart', this._handlers.onJoystickStart);
        if (this._handlers.onJoystickMove) joystickZone.removeEventListener('touchmove', this._handlers.onJoystickMove);
        if (this._handlers.onJoystickEnd) joystickZone.removeEventListener('touchend', this._handlers.onJoystickEnd);
      }

      const lookZone = document.getElementById('look-zone');
      if (lookZone) {
        if (this._handlers.onLookStart) lookZone.removeEventListener('touchstart', this._handlers.onLookStart);
        if (this._handlers.onLookMove) lookZone.removeEventListener('touchmove', this._handlers.onLookMove);
        if (this._handlers.onLookEnd) lookZone.removeEventListener('touchend', this._handlers.onLookEnd);
      }

      const jumpBtn = document.getElementById('btn-jump-mobile');
      if (jumpBtn) {
        if (this._handlers.onJumpStart) jumpBtn.removeEventListener('touchstart', this._handlers.onJumpStart);
        if (this._handlers.onJumpEnd) jumpBtn.removeEventListener('touchend', this._handlers.onJumpEnd);
      }

      const breakBtn = document.getElementById('btn-break-mobile');
      if (breakBtn) {
        if (this._handlers.onBreakStart) breakBtn.removeEventListener('touchstart', this._handlers.onBreakStart);
        if (this._handlers.onBreakEnd) breakBtn.removeEventListener('touchend', this._handlers.onBreakEnd);
      }

      const placeBtn = document.getElementById('btn-place-mobile');
      if (placeBtn) {
        if (this._handlers.onPlaceStart) placeBtn.removeEventListener('touchstart', this._handlers.onPlaceStart);
        if (this._handlers.onPlaceEnd) placeBtn.removeEventListener('touchend', this._handlers.onPlaceEnd);
      }
    }

    // Clear handler references to allow GC
    this._handlers = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TouchInput;

}