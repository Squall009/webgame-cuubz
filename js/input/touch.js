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
    
    if (typeof window !== 'undefined') {
      this._bindEvents();
    }
  }

  _bindEvents() {
    const joystickZone = document.getElementById('joystick-zone');
    const lookZone = document.getElementById('look-zone');
    
    if (joystickZone) {
      joystickZone.addEventListener('touchstart', (e) => this._onJoystickStart(e), { passive: false });
      joystickZone.addEventListener('touchmove', (e) => this._onJoystickMove(e), { passive: false });
      joystickZone.addEventListener('touchend', (e) => this._onJoystickEnd(e), { passive: false });
    }
    
    if (lookZone) {
      lookZone.addEventListener('touchstart', (e) => this._onLookStart(e), { passive: false });
      lookZone.addEventListener('touchmove', (e) => this._onLookMove(e), { passive: false });
      lookZone.addEventListener('touchend', (e) => this._onLookEnd(e), { passive: false });
    }
    
    // Mobile action buttons
    const jumpBtn = document.getElementById('btn-jump-mobile');
    if (jumpBtn) {
      jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.jump = true; });
      jumpBtn.addEventListener('touchend', (e) => { e.preventDefault(); this.jump = false; });
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
}

module.exports = TouchInput;
