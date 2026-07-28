/**
 * Cuubz — First-Person Hand Renderer
 * 
 * Renders a 3D arm + hand + held item in the bottom-right of the viewport.
 * Attached to the camera so it follows the player's view.
 * 
 * Features:
 *   - Box-geometry forearm and hand (neutral skin tone)
 *   - Plane geometry for the held item texture
 *   - Swing animation triggered on block break
 *   - Idle bob animation
 *   - Updates item texture when hotbar selection changes
 */

class FirstPersonHand {
  /**
   * @param {THREE.PerspectiveCamera} camera - The player's camera
   * @param {Object} options
   * @param {ItemTextureAtlas} options.itemAtlas - Atlas for item textures
   */
  constructor(camera, options = {}) {
    this.camera = camera;
    this.itemAtlas = options.itemAtlas || null;

    // Arm group — pivots from shoulder position
    this.group = new THREE.Group();
    camera.add(this.group);

    // Skin color (neutral medium tone, adjustable later for character creator)
    const skinColor = 0xC68642;

    // ─── Forearm ──────────────────────────────────────────
    // Thick box extending from shoulder toward bottom-right of view
    const forearmGeo = new THREE.BoxGeometry(0.08, 0.7, 0.08);
    const forearmMat = new THREE.MeshLambertMaterial({ color: skinColor });
    this.forearm = new THREE.Mesh(forearmGeo, forearmMat);
    this.forearm.position.set(0, -0.25, 0);
    this.group.add(this.forearm);

    // ─── Hand ─────────────────────────────────────────────
    // Wider box at the end of the forearm
    const handGeo = new THREE.BoxGeometry(0.12, 0.16, 0.1);
    const handMat = new THREE.MeshLambertMaterial({ color: skinColor });
    this.hand = new THREE.Mesh(handGeo, handMat);
    this.hand.position.set(0, -0.6, 0);
    this.group.add(this.hand);

    // ─── Item Plane ───────────────────────────────────────
    // Plane showing the item texture, positioned in front of the hand
    this.itemTexture = null;
    this.itemMesh = null;
    this.currentItemKey = null;

    if (this.itemAtlas && this.itemAtlas.canvas) {
      this.itemTexture = new THREE.CanvasTexture(this.itemAtlas.canvas);
      this.itemTexture.magFilter = THREE.NearestFilter;
      this.itemTexture.minFilter = THREE.NearestFilter;
      this.itemTexture.generateMipmaps = false;

      const itemGeo = new THREE.PlaneGeometry(0.5, 0.5);
      const itemMat = new THREE.MeshBasicMaterial({
        map: this.itemTexture,
        transparent: true,
        side: THREE.FrontSide,
        depthTest: true,
      });
      this.itemMesh = new THREE.Mesh(itemGeo, itemMat);
      this.itemMesh.position.set(0, -0.7, -0.12);
      this.itemMesh.visible = false;
      this.group.add(this.itemMesh);
    }

    // ─── Position and rotate the entire arm group ─────────
    // Move to bottom-right of viewport, angled naturally
    // z=-0.3 keeps it just in front of near clip plane
    this.group.position.set(0.45, -0.35, -0.3);
    this.group.rotation.set(0.2, -0.2, -0.35);

    // ─── Animation State ──────────────────────────────────
    this.swingProgress = 0;    // 0-1-0 swing cycle
    this.swingActive = false;
    this.swingDuration = 0.35;  // total swing time (s)
    this.idlePhase = Math.random() * Math.PI * 2;

    // Rest rotation for the arm group
    this.restRotation = this.group.rotation.clone();
    this.restPosition = this.group.position.clone();
  }

  /**
   * Set the held item. Pass null for bare hand.
   * @param {string|number|null} itemKey - Item type ID (string name or block number)
   */
  setItem(itemKey) {
    if (itemKey === this.currentItemKey) return;
    this.currentItemKey = itemKey;

    if (!this.itemMesh || !this.itemAtlas) {
      if (this.itemMesh) this.itemMesh.visible = false;
      return;
    }

    if (!itemKey) {
      this.itemMesh.visible = false;
      return;
    }

    // Look up UV coordinates in the atlas
    const uv = this.itemAtlas.getItemUV(itemKey);
    if (!uv) {
      // Try string key for numeric IDs
      const uvStr = this.itemAtlas.getItemUV(String(itemKey));
      if (!uvStr) {
        this.itemMesh.visible = false;
        return;
      }
      this._applyUV(uvStr);
    } else {
      this._applyUV(uv);
    }
    this.itemMesh.visible = true;
  }

  /**
   * Apply UV coordinates to the item plane.
   */
  _applyUV(uv) {
    const mat = this.itemMesh.material;
    const uvSize = uv.size;

    // Offset UVs to center the tile on the plane
    mat.map.offset.set(uv.u, uv.v);
    mat.map.repeat.set(uvSize, uvSize);
    mat.map.needsUpdate = true;
  }

  /**
   * Trigger a swing animation.
   */
  swing() {
    this.swingProgress = 0;
    this.swingActive = true;
  }

  /**
   * Update animation state.
   * @param {number} delta - Time delta in seconds
   */
  update(delta) {
    // Clamp delta to avoid huge jumps when tab is backgrounded
    delta = Math.min(delta, 0.05);

    // ─── Idle bob ─────────────────────────────────────────
    this.idlePhase += delta * 1.5;
    const bobY = Math.sin(this.idlePhase) * 0.005;

    // ─── Swing animation ──────────────────────────────────
    if (this.swingActive) {
      this.swingProgress += delta / this.swingDuration;

      if (this.swingProgress >= 1) {
        this.swingActive = false;
        this.swingProgress = 0;
        this.group.rotation.copy(this.restRotation);
        this.group.position.copy(this.restPosition);
      } else {
        // Smooth swing curve: forward then return
        const t = this.swingProgress;
        const swingAngle = Math.sin(t * Math.PI) * 0.6; // Max 0.6 rad forward
        const swingForward = Math.sin(t * Math.PI) * 0.15;

        this.group.rotation.x = this.restRotation.x - swingAngle + bobY;
        this.group.rotation.z = this.restRotation.z - swingAngle * 0.3;
        this.group.position.z = this.restPosition.z - swingForward;
      }
    } else {
      // Idle state
      this.group.rotation.x = this.restRotation.x + bobY;
      this.group.rotation.z = this.restRotation.z;
    }
  }

  /**
   * Clean up resources.
   */
  dispose() {
    if (this.itemTexture) this.itemTexture.dispose();
    this.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FirstPersonHand;
}
