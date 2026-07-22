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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
    
    // Expose domElement for external access (input handlers)
    this.domElement = this.renderer.domElement;
    
    // PBR lighting is handled via shader uniforms — no Three.js lights needed
    this.sunDirection = new THREE.Vector3(50, 100, 50).normalize();
    
    // ── Shadow map setup ──
    // DirectionalLight for shadow camera (actual lighting is in PBR shader)
    this.shadowLight = new THREE.DirectionalLight(0xffffff, 1);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.width = 2048;
    this.shadowLight.shadow.mapSize.height = 2048;
    this.shadowLight.shadow.camera.near = 1;
    this.shadowLight.shadow.camera.far = 200;
    this.shadowLight.shadow.camera.left = -30;
    this.shadowLight.shadow.camera.right = 30;
    this.shadowLight.shadow.camera.top = 30;
    this.shadowLight.shadow.camera.bottom = -30;
    this.shadowLight.shadow.bias = -0.002;
    this.shadowLight.shadow.normalBias = 0.02;
    this.shadowLight.shadow.autoUpdate = false; // We render manually
    this.scene.add(this.shadowLight);
    this.scene.add(this.shadowLight.target);
    
    // Manual render target for depth-as-color.
    // Three.js r128's native shadow map is a DepthTexture that can't be sampled
    // by custom shaders (__webglTexture not bound). We render depth as color instead.
    this.shadowRenderTarget = new THREE.WebGLRenderTarget(2048, 2048, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: true,
    });
    
    // Cached matrix for shadow matrix computation (avoid per-frame GC)
    this._shadowTempMatrix = new THREE.Matrix4();
    
    // Depth-to-color shader: outputs normalized depth as red channel
    this._shadowDepthMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uFar: { value: this.shadowLight.shadow.camera.far },
        uNear: { value: this.shadowLight.shadow.camera.near },
      },
      vertexShader: `
        varying float vMvZ;
        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vMvZ = -mvPos.z; // Depth in view space (positive)
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying float vMvZ;
        uniform float uFar;
        uniform float uNear;
        void main() {
          float depth = (vMvZ - uNear) / (uFar - uNear);
          depth = clamp(depth, 0.0, 1.0);
          gl_FragColor = vec4(vec3(depth), 1.0);
        }
      `,
    });
    
    console.log('[Shadow] DirectionalLight + depth shader created (2048x2048)');
    
    // PBR material factory — initialized after atlas is built
    this.pbrFactory = null;
    
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
   * Update the shadow camera to follow the player.
   * Positions the light and manually computes the shadow matrix.
   */
  updateShadowCamera(playerPosition) {
    if (!this.shadowLight) return;
    
    const light = this.shadowLight;
    const shadowCam = light.shadow.camera;
    
    // Position the light high above the player, aligned with sun direction
    const height = 80;
    light.position.set(
      playerPosition.x + this.sunDirection.x * height,
      playerPosition.y + this.sunDirection.y * height,
      playerPosition.z + this.sunDirection.z * height
    );
    
    // Target the player's position (slightly below to cover ground)
    light.target.position.set(
      playerPosition.x,
      playerPosition.y - 10,
      playerPosition.z
    );
    light.target.updateMatrixWorld();
    
    // Position the shadow camera to match the light
    shadowCam.position.copy(light.position);
    shadowCam.lookAt(light.target.position);
    shadowCam.updateMatrixWorld(true);
    shadowCam.updateProjectionMatrix();
    
    // Manually compute shadow matrix: projectionMatrix × worldInverse
    this._shadowTempMatrix.copy(shadowCam.matrixWorld).invert();
    light.shadow.matrix.copy(shadowCam.projectionMatrix).multiply(this._shadowTempMatrix);
  }

  /**
   * Get the shadow map texture and matrix for PBR materials.
   */
  getShadowData() {
    if (!this.shadowRenderTarget) return null;
    return {
      map: this.shadowRenderTarget.texture,
      matrix: this.shadowLight.shadow.matrix,
    };
  }

  /**
   * Render the scene
   */
  render() {
    if (this.renderer && this.scene && this.camera) {
      this._renderShadowMap();
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Render the shadow depth map into our manual render target.
   */
  _renderShadowMap() {
    const shadowCam = this.shadowLight.shadow.camera;
    const target = this.shadowRenderTarget;

    // Disable Three.js auto shadow updates to prevent recursive rendering
    const prevAutoUpdate = this.renderer.shadowMap.autoUpdate;
    this.renderer.shadowMap.autoUpdate = false;

    // Use scene.overrideMaterial to force the depth shader on all objects
    this.scene.overrideMaterial = this._shadowDepthMaterial;

    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(this.scene, shadowCam);
    this.renderer.setRenderTarget(null);

    this.scene.overrideMaterial = null;
    this.renderer.shadowMap.autoUpdate = prevAutoUpdate;

    // Fix: copy __webglTexture from renderer.properties to the texture object
    const texture = target.texture;
    if (texture.__webglTexture === undefined) {
      const props = this.renderer.properties.get(texture);
      if (props && props.__webglTexture !== undefined) {
        texture.__webglTexture = props.__webglTexture;
        console.log('[Shadow] Bound WebGL texture ID:', props.__webglTexture);
      }
    }
  }

  /**
   * Debug: print shadow system state to console.
   */
  debugShadowState() {
    console.log('=== Shadow System Debug ===');
    console.log('[Shadow] Renderer shadowMap:', this.renderer.shadowMap);
    console.log('[Shadow] Light:', {
      castShadow: this.shadowLight.castShadow,
      pos: this.shadowLight.position.toArray().map(v => v.toFixed(1)),
      target: this.shadowLight.target.position.toArray().map(v => v.toFixed(1)),
      mapExists: !!this.shadowLight.shadow.map,
      matrix: this.shadowLight.shadow.matrix.elements.map(v => v.toFixed(3)),
    });
    const map = this.shadowLight.shadow.map;
    console.log('[Shadow] Shadow map texture:', {
      isWebGLTexture: map ? map.__webglTexture !== undefined : false,
      webglTextureId: map ? map.__webglTexture : null,
    });

    // Check chunk meshes for shadow flags
    let receiveCount = 0, castCount = 0, totalCount = 0;
    this.chunkGroup.traverse((child) => {
      if (child.isMesh) {
        totalCount++;
        if (child.receiveShadow) receiveCount++;
        if (child.castShadow) castCount++;
      }
    });
    console.log('[Shadow] Chunk meshes:', { total: totalCount, receiveShadow: receiveCount, castShadow: castCount });
    console.log('=== End Shadow Debug ===');
  }

  /**
   * Initialize PBR material factory from the triple atlas.
   * Call after textureAtlas.buildAtlas() resolves.
   */
  initPBR(atlas) {
    this.pbrFactory = new PBRMaterialFactory(
      atlas.diffuseTexture,
      atlas.normalTexture,
      atlas.smoothnessTexture,
      this.sunDirection
    );
    console.log('[VoxelRenderer] PBR material factory initialized');
    return this.pbrFactory;
  }

  /**
   * Get the PBR material factory (after initPBR is called).
   */
  getPBRFactory() {
    return this.pbrFactory;
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
    mesh.receiveShadow = true;
    mesh.castShadow = true;
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
   * Returns the first solid (non-air, non-cave_air) block hit.
   *
   * Tracks `t` (distance along ray) as we step. When we find a solid block,
   * the hit point is origin + direction * t, which lies exactly on the face
   * we entered the voxel through.
   *
   * @param {THREE.Camera} camera
   * @param {number} maxDistance
   * @param {ChunkManager} chunkManager
   * @returns {{ point, faceNormal } | null}
   */
  _voxelRaycast(camera, maxDistance, chunkManager) {
    const origin = camera.position;
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    const dx = direction.x;
    const dy = direction.y;
    const dz = direction.z;

    // Starting voxel (the one the camera is inside)
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    // Step direction: +1 if going positive, -1 if going negative
    const stepX = dx >= 0 ? 1 : -1;
    const stepY = dy >= 0 ? 1 : -1;
    const stepZ = dz >= 0 ? 1 : -1;

    // Distance along ray to the next voxel boundary on each axis.
    // When step > 0: boundary is at floor(coord)+1.
    // When step < 0: boundary is at floor(coord).
    let tMaxX = dx !== 0 ? ((stepX > 0 ? x + 1 : x) - origin.x) / dx : Infinity;
    let tMaxY = dy !== 0 ? ((stepY > 0 ? y + 1 : y) - origin.y) / dy : Infinity;
    let tMaxZ = dz !== 0 ? ((stepZ > 0 ? z + 1 : z) - origin.z) / dz : Infinity;

    // Distance to advance one full voxel on each axis (always positive)
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

    // Face normal of the face we entered the current voxel through.
    // null for the starting voxel (we haven't entered it from any face yet).
    let faceNormal = null;

    // `t` is the distance along the ray to the entry point of the current voxel.
    // Starts at 0 (camera position). Updated each time we step to a new voxel.
    let t = 0;

    const maxSteps = Math.ceil(maxDistance) * 3 + 2;
    let steps = 0;

    while (steps < maxSteps) {
      const blockType = chunkManager.getVoxel(x, y, z);

      // Stop on any non-air block
      if (blockType !== 0) {
        // Hit! `t` is the distance to the face we entered through.
        // For the starting voxel (t=0), hit point is at the camera.
        if (t <= maxDistance) {
          const hitPoint = new THREE.Vector3(
            origin.x + dx * t,
            origin.y + dy * t,
            origin.z + dz * t
          );
          // If we started inside a block (faceNormal is null), pick a default.
          const normal = faceNormal || new THREE.Vector3(0, 1, 0);
          return { point: hitPoint, faceNormal: normal };
        }
        return null; // Solid block but beyond range
      }

      // ── Step to the next voxel along the axis with smallest tMax ──
      // Before stepping, record the t value at which we cross the boundary.
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          if (tMaxX > maxDistance) break;
          t = tMaxX;
          faceNormal = new THREE.Vector3(-stepX, 0, 0);
          x += stepX;
          tMaxX += tDeltaX;
        } else {
          if (tMaxZ > maxDistance) break;
          t = tMaxZ;
          faceNormal = new THREE.Vector3(0, 0, -stepZ);
          z += stepZ;
          tMaxZ += tDeltaZ;
        }
      } else {
        if (tMaxY < tMaxZ) {
          if (tMaxY > maxDistance) break;
          t = tMaxY;
          faceNormal = new THREE.Vector3(0, -stepY, 0);
          y += stepY;
          tMaxY += tDeltaY;
        } else {
          if (tMaxZ > maxDistance) break;
          t = tMaxZ;
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
