/**
 * Cuubz — Crosshair & Block Targeting
 * Center screen crosshair overlay + targeted block wireframe highlight.
 */

class Crosshair {
  constructor(renderer) {
    this.renderer = renderer;
    this.targetBlock = null; // { x, y, z, faceNormal }
    
    // Wireframe highlight mesh (Three.js EdgesGeometry)
    this.highlightMesh = null;
  }

  /**
   * Update crosshair based on raycast from camera center
   */
  update() {
    if (!this.renderer || !this.renderer.raycast) return;
    
    const hit = this.renderer.raycast(7); // Max 7 block reach
    
    if (hit && hit.object && hit.point) {
      // Convert world position to block coordinates
      const bx = Math.floor(hit.point.x - (hit.faceNormal.x * 0.01));
      const by = Math.floor(hit.point.y - (hit.faceNormal.y * 0.01));
      const bz = Math.floor(hit.point.z - (hit.faceNormal.z * 0.01));
      
      this.targetBlock = {
        x: bx, y: by, z: bz,
        faceNormal: hit.faceNormal ? [hit.faceNormal.x, hit.faceNormal.y, hit.faceNormal.z] : [0, 0, 0],
      };
      
      // Update wireframe highlight
      this._updateHighlight(bx, by, bz);
    } else {
      this.targetBlock = null;
      this._hideHighlight();
    }
  }

  /**
   * Update the wireframe highlight mesh position
   */
  _updateHighlight(x, y, z) {
    if (typeof THREE === 'undefined') return;
    
    if (!this.highlightMesh) {
      const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.005, 1.005, 1.005));
      const material = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
      this.highlightMesh = new THREE.LineSegments(geometry, material);
      
      if (this.renderer.scene) {
        this.renderer.scene.add(this.highlightMesh);
      }
    }
    
    this.highlightMesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.highlightMesh.visible = true;
  }

  /**
   * Hide the wireframe highlight
   */
  _hideHighlight() {
    if (this.highlightMesh) {
      this.highlightMesh.visible = false;
    }
  }

  /**
   * Get the target block position for interaction
   */
  getTargetBlock() {
    return this.targetBlock;
  }

  /**
   * Get the place position (adjacent to target face)
   */
  getPlacePosition() {
    if (!this.targetBlock) return null;
    
    const [nx, ny, nz] = this.targetBlock.faceNormal || [0, 0, 0];
    
    return {
      x: this.targetBlock.x + nx,
      y: this.targetBlock.y + ny,
      z: this.targetBlock.z + nz,
    };
  }

  /**
   * Cleanup resources
   */
  dispose() {
    if (this.highlightMesh) {
      if (this.renderer.scene) {
        this.renderer.scene.remove(this.highlightMesh);
      }
      this.highlightMesh.geometry.dispose();
      this.highlightMesh.material.dispose();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Crosshair;

}