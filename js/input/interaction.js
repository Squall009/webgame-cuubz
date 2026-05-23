/**
 * Cuubz — Block Interaction System
 * Raycast from camera center through crosshair for break/place.
 */

class BlockInteraction {
  constructor(crosshair, player) {
    this.crosshair = crosshair;
    this.player = player;
    
    // Break progress (for holding attack)
    this.breakProgress = 0;
    this.breakTarget = null;
    this.breakDuration = 1.0; // seconds to break a block
    
    // Events/callbacks
    this.onBlockBreak = null;
    this.onBlockPlace = null;
  }

  /**
   * Update interaction state per frame
   */
  update(deltaTime) {
    if (!this.crosshair) return;
    
    const target = this.crosshair.getTargetBlock();
    
    // Handle block breaking (hold left click / tap on mobile)
    if (target && this._isBreaking()) {
      if (!this.breakTarget || !this._sameBlock(this.breakTarget, target)) {
        this.breakTarget = target;
        this.breakProgress = 0;
      }
      
      this.breakProgress += deltaTime;
      
      // Show break progress UI (TODO)
      this._updateBreakUI();
      
      if (this.breakProgress >= this.breakDuration) {
        this._breakBlock(target);
        this.breakProgress = 0;
        this.breakTarget = null;
      }
    } else {
      this.breakTarget = null;
      this.breakProgress = 0;
    }
    
    // Handle block placing (right click / secondary tap)
    if (target && this._isPlacing()) {
      const placePos = this.crosshair.getPlacePosition();
      
      if (placePos && !this._isInsidePlayer(placePos)) {
        this._placeBlock(placePos);
        this._consumePlaceAction();
      }
    }
  }

  /**
   * Break a block at the target position
   */
  _breakBlock(target) {
    if (this.onBlockBreak) {
      this.onBlockBreak(target);
    }
    
    // TODO: Add block to inventory, play break sound
  }

  /**
   * Place a block at the target face
   */
  _placeBlock(position) {
    if (this.onBlockPlace) {
      const selectedSlot = this.player ? this.player.inventory?.selectedSlot : 0;
      this.onBlockPlace(position, selectedSlot);
    }
    
    // TODO: Remove block from inventory, play place sound
  }

  /**
   * Check if player is breaking (holding attack)
   */
  _isBreaking() {
    // Desktop: left mouse button held
    // Mobile: break button or long tap
    return false; // Will be wired to input handlers
  }

  /**
   * Check if player is placing
   */
  _isPlacing() {
    // Desktop: right click
    // Mobile: place button
    return false; // Will be wired to input handlers
  }

  /**
   * Consume the place action (prevent repeat)
   */
  _consumePlaceAction() {
    // Clear the placing flag
  }

  /**
   * Check if position is inside player bounding box
   */
  _isInsidePlayer(pos) {
    if (!this.player) return false;
    
    const px = this.player.position.x;
    const py = this.player.position.y;
    const pz = this.player.position.z;
    
    // Player dimensions: ~0.8 wide × 1.8 tall
    return (
      Math.abs(pos.x - px) < 0.5 &&
      Math.abs(pos.z - pz) < 0.5 &&
      pos.y >= py && pos.y <= py + 1.8
    );
  }

  /**
   * Check if two block positions are the same
   */
  _sameBlock(a, b) {
    return a.x === b.x && a.y === b.y && a.z === b.z;
  }

  /**
   * Update break progress UI
   */
  _updateBreakUI() {
    // TODO: Show progress bar near crosshair
  }
}

module.exports = BlockInteraction;
