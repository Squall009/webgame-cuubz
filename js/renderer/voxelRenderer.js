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
   * Raycast from camera center for block targeting
   */
  raycast(maxDistance = 7) {
    if (!this.camera || !this.scene) return null;
    
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    raycaster.far = maxDistance;
    
    const intersects = raycaster.intersectObjects(this.chunkGroup.children, true);
    
    if (intersects.length > 0) {
      return intersects[0];
    }
    
    return null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VoxelRenderer;

}