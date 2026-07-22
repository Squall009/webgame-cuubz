/**
 * Cuubz — Voxel Renderer (Three.js)
 * Scene, camera, WebGL renderer setup. Mobile-first with touch controls.
 */

class VoxelRenderer {
  constructor(container, width, height) {
    this.container = container;
    this.width = width || window.innerWidth;
    this.height = height || window.innerHeight;
    
    // Initialize when Three.js is available
    if (typeof THREE !== 'undefined') {
      this._initThree();
    }
  }

  _initThree() {
    // Scene with gradient skybox
    this.scene = new THREE.Scene();
    
    // Gradient sky using a large sphere (far radius)
    const skyGeo = new THREE.SphereGeometry(500, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x0077ff) },    // Deep blue at top
        bottomColor: { value: new THREE.Color(0xaaddff) }, // Light blue at horizon
        offset: { value: 20 },
        exponent: { value: 0.6 }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
        }
      `,
      side: THREE.BackSide
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));
    
    // Fog matches sky gradient bottom color
    this.scene.fog = new THREE.Fog(0xaaddff, 50, 120);
    
    // Camera — first-person perspective
    this.camera = new THREE.PerspectiveCamera(
      75, this.width / this.height, 0.1, 1000
    );
    this.camera.position.set(0, 20, 0);
    
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);
    
    // Expose domElement for external access (input handlers)
    this.domElement = this.renderer.domElement;
    
    // Lighting — ambient + directional sun
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    this.scene.add(ambientLight);
    
    const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
    sunLight.position.set(50, 100, 50);
    this.scene.add(sunLight);
    
    // Texture loader for pre-baked textures
    this.textureLoader = new THREE.TextureLoader();
    this.textures = {};
    
    // Chunk meshes container
    this.chunkGroup = new THREE.Group();
    this.scene.add(this.chunkGroup);
  }

  /**
   * Load a texture from file path
   */
  loadTexture(name, path) {
    if (!this.textureLoader) return null;
    
    const texture = this.textureLoader.load(path);
    texture.magFilter = THREE.NearestFilter; // Pixel art look
    texture.minFilter = THREE.NearestFilter;
    this.textures[name] = texture;
    return texture;
  }

  /**
   * Update camera position and rotation
   */
  updateCamera(position, yaw, pitch) {
    if (!this.camera) return;
    
    this.camera.position.copy(position);
    
    // Convert yaw/pitch to quaternion for Three.js
    const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  /**
   * Render the scene
   */
  render() {
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Handle window resize
   */
  onResize(width, height) {
    this.width = width;
    this.height = height;
    
    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    
    if (this.renderer) {
      this.renderer.setSize(width, height);
    }
  }

  /**
   * Add a chunk mesh to the scene
   */
  addChunkMesh(mesh, chunkX, chunkZ) {
    if (!this.chunkGroup) return;
    
    mesh.position.set(chunkX * 16, 0, chunkZ * 16);
    this.chunkGroup.add(mesh);
  }

  /**
   * Remove a chunk mesh from the scene
   */
  removeChunkMesh(mesh) {
    if (!this.chunkGroup) return;
    
    this.chunkGroup.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  }

  /**
   * Raycast from camera center for block targeting.
   * Uses voxel DDA (Digital Differential Analyzer) to walk through chunk data directly.
   * Much more reliable than Three.js geometry raycast — gives exact block coords and face normal.
   * @param {number} maxDistance - Maximum raycast distance in blocks
   * @param {ChunkManager} [chunkManager] - Optional: when provided, does voxel DDA raycast.
   *   When null, falls back to Three.js geometry raycast (legacy).
   * @returns {{ point, faceNormal } | null}
   */
  raycast(maxDistance = 7, chunkManager = null) {
    if (!this.camera) return null;

    // With chunkManager: use voxel DDA raycast through chunk data directly
    if (chunkManager) {
      return this._voxelRaycast(this.camera, maxDistance, chunkManager);
    }

    // Legacy fallback: Three.js geometry raycast (no faceNormal, less reliable)
    if (!this.scene) return null;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    raycaster.far = maxDistance;
    const intersects = raycaster.intersectObjects(this.chunkGroup.children, true);
    return intersects.length > 0 ? intersects[0] : null;
  }

  /**
   * Voxel DDA raycast — walks through voxel space step by step.
   * Returns the first solid (non-air, non-fluid) block hit.
   * @param {THREE.Camera} camera
   * @param {number} maxDistance
   * @param {ChunkManager} chunkManager
   * @returns {{ point, faceNormal } | null}
   */
  _voxelRaycast(camera, maxDistance, chunkManager) {
    // Get camera position and forward direction
    const origin = camera.position;
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    const dx = direction.x;
    const dy = direction.y;
    const dz = direction.z;

    // Starting voxel
    let startx = Math.floor(origin.x);
    let starty = Math.floor(origin.y);
    let startz = Math.floor(origin.z);

    // Which direction to step on each axis
    const stepX = dx >= 0 ? 1 : -1;
    const stepY = dy >= 0 ? 1 : -1;
    const stepZ = dz >= 0 ? 1 : -1;

    // Distance to next voxel boundary on each axis
    let tMaxX = dx !== 0 ? ((stepX > 0 ? startx + 1 : startx) - origin.x) / dx : Infinity;
    let tMaxY = dy !== 0 ? ((stepY > 0 ? starty + 1 : starty) - origin.y) / dy : Infinity;
    let tMaxZ = dz !== 0 ? ((stepZ > 0 ? startz + 1 : startz) - origin.z) / dz : Infinity;

    // Distance to step to next voxel on each axis
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

    let x = startx;
    let y = starty;
    let z = startz;

    // Current face normal (the face we entered the current voxel through)
    let faceNormal = null;

    const maxSteps = maxDistance * 3; // Safety limit
    let steps = 0;

    while (steps < maxSteps) {
      // Get block type at current voxel
      const blockType = chunkManager.getVoxel(x, y, z);

      // Skip air and cave air
      if (blockType !== 0 && blockType !== 12) {
        // Found a non-air block — this is our hit!
        // Compute the hit point on the face we entered through
        const t = Math.min(
          faceNormal ? (faceNormal.x !== 0 ? (x + (faceNormal.x > 0 ? 0 : 1) - origin.x) / dx :
                        faceNormal.y !== 0 ? (y + (faceNormal.y > 0 ? 0 : 1) - origin.y) / dy :
                        (z + (faceNormal.z > 0 ? 0 : 1) - origin.z) / dz) : 0
        );

        const hitPoint = new THREE.Vector3(
          origin.x + dx * Math.max(0, t),
          origin.y + dy * Math.max(0, t),
          origin.z + dz * Math.max(0, t)
        );

        // Check distance
        const dist = hitPoint.distanceTo(origin);
        if (dist <= maxDistance) {
          return { point: hitPoint, faceNormal: faceNormal || new THREE.Vector3(0, 1, 0) };
        }
        return null; // Solid block but beyond range
      }

      // Step to next voxel along the axis with smallest tMax
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          // Check if we've gone beyond max distance
          if (tMaxX > maxDistance) break;
          faceNormal = new THREE.Vector3(-stepX, 0, 0);
          x += stepX;
          tMaxX += tDeltaX;
        } else {
          if (tMaxZ > maxDistance) break;
          faceNormal = new THREE.Vector3(0, 0, -stepZ);
          z += stepZ;
          tMaxZ += tDeltaZ;
        }
      } else {
        if (tMaxY < tMaxZ) {
          if (tMaxY > maxDistance) break;
          faceNormal = new THREE.Vector3(0, -stepY, 0);
          y += stepY;
          tMaxY += tDeltaY;
        } else {
          if (tMaxZ > maxDistance) break;
          faceNormal = new THREE.Vector3(0, 0, -stepZ);
          z += stepZ;
          tMaxZ += tDeltaZ;
        }
      }

      steps++;
    }

    return null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VoxelRenderer;

}