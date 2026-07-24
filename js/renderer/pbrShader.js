/**
 * Cuubz — PBR Shader Material
 * 
 * Simplified PBR with 3 texture atlases (diffuse, normal, smoothness).
 * Hemisphere ambient + sun diffuse + Blinn-Phong specular.
 * 
 * All lighting computed in WORLD SPACE for consistency.
 * 
 * Three shader variants:
 *   Solid       — fully opaque
 *   Cutout      — alpha discard (leaves, flowers, torches)
 *   Transparent — alpha-blended (water, ice, glass)
 */

// ── Vertex Shader (shared across all variants) ──────────────────────────
const PBRVertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldNormal;   // Geometry normal in world space
  varying vec3 vWorldPosition;
  varying vec3 vWorldViewDir;  // View direction in world space
  varying mat3 vTBNWorld;      // Tangent→World space matrix
  varying vec3 vColor;         // Vertex color (humidity-based tint)

  void main() {
    vUv = uv;
    vColor = color;  // Pass vertex color through (white default if no color attribute)
    
    // World position
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldViewDir = normalize(cameraPosition - worldPos.xyz);
    
    // Geometry normal in world space
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    
    // Build TBN matrix in world space.
    // T = direction U increases, B = direction V increases (world-space).
    // Must match the UV layout in ChunkMeshBuilder face definitions.
    // Using a deterministic switch on the axis-aligned face normal
    // so the tangent space is consistent with how normal maps are baked.
    vec3 N = vWorldNormal;
    vec3 T, B;
    
    if (N.y > 0.5) {         // top face   N=[0, 1, 0]
      T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 0.0,-1.0);
    } else if (N.y < -0.5) { // bottom face N=[0,-1, 0]
      T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 0.0, 1.0);
    } else if (N.z > 0.5) {  // front face  N=[0, 0, 1]
      T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 1.0, 0.0);
    } else if (N.z < -0.5) { // back face   N=[0, 0,-1]
      T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 1.0, 0.0);
    } else if (N.x > 0.5) {  // right face  N=[1, 0, 0]
      T = vec3(0.0, 0.0,-1.0); B = vec3(0.0, 1.0, 0.0);
    } else {                  // left face   N=[-1, 0, 0]
      T = vec3(0.0, 0.0, 1.0); B = vec3(0.0, 1.0, 0.0);
    }
    
    // TBN transforms tangent-space vectors to world space
    vTBNWorld = mat3(T, B, N);
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ── Fragment Shader — Solid (fully opaque) ─────────────────────────────
const PBRFragmentShader = `
  precision mediump float;

  uniform sampler2D uDiffuseMap;
  uniform sampler2D uNormalMap;
  uniform sampler2D uSmoothnessMap;

  uniform vec3 uSunDirection;  // World space
  uniform vec3 uSunColor;
  uniform float uSunIntensity;

  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform float uAmbientIntensity;

  uniform sampler2D uShadowMap;
  uniform mat4 uShadowMatrix;

  uniform float uEmissive;
  uniform float uSurfaceHeight;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vWorldViewDir;
  varying mat3 vTBNWorld;
  varying vec3 vColor;  // Vertex color (humidity-based tint)

  void main() {
    // ── Sample textures ──
    vec3 albedo = texture2D(uDiffuseMap, vUv).rgb * vColor;
    vec3 packedNormal = texture2D(uNormalMap, vUv).rgb;
    float smoothness = texture2D(uSmoothnessMap, vUv).r;

    // ── Normal map: unpack [0,1] → [-1,1], transform tangent→world ──
    vec3 tangentNormal = packedNormal * 2.0 - 1.0;
    vec3 N = normalize(vTBNWorld * tangentNormal);

    // ── Cave factor: attenuate sun light below surface ──
    float caveFactor = smoothstep(uSurfaceHeight - 12.0, uSurfaceHeight + 6.0, vWorldPosition.y);

    // ── Hemisphere ambient (world space) ──
    float NdotY = max(N.y, 0.0);
    vec3 ambient = mix(uGroundColor, uSkyColor, NdotY) * uAmbientIntensity;

    // ── Diffuse lighting (Lambert, world space) ──
    vec3 L = normalize(uSunDirection);
    float NdotL = max(dot(N, L), 0.0);
    vec3 diffuse = albedo * uSunColor * uSunIntensity * NdotL * caveFactor;

    // ── Specular (Blinn-Phong, world space) ──
    vec3 H = normalize(L + vWorldViewDir);
    float NdotH = max(dot(N, H), 0.0);
    float specExponent = mix(4.0, 128.0, smoothness);
    float spec = pow(NdotH, specExponent);
    vec3 specular = uSunColor * uSunIntensity * spec * smoothness * 0.5 * caveFactor;

    // ── Shadow factor ──
    vec4 shadowCoord = uShadowMatrix * vec4(vWorldPosition, 1.0);
    float shadowFactor = 1.0;
    vec3 shadowPos = shadowCoord.xyz / shadowCoord.w;
    vec2 uv = shadowPos.xy * 0.5 + 0.5; // [-1,1] → [0,1]
    float storedDepth = 0.0;
    float fragDepth = 0.0;
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        // shadowPos.z is in [-1,1] NDC; convert to [0,1] to match depth shader output
        if (shadowPos.z > -1.0 && shadowPos.z < 1.0) {
            storedDepth = texture2D(uShadowMap, uv).r;
            fragDepth = shadowPos.z * 0.5 + 0.5;
            // In shadow if fragment is behind the stored depth (with bias)
            shadowFactor = step(fragDepth - 0.001, storedDepth);
        }
    }

    // ── Combine ──
    vec3 color = albedo * ambient + (diffuse + specular) * shadowFactor;

    // ── Emissive ──
    color += albedo * uEmissive;

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ── Fragment Shader — Cutout (alpha discard) ───────────────────────────
const PBRFragmentShaderCutout = `
  precision mediump float;

  uniform sampler2D uDiffuseMap;
  uniform sampler2D uNormalMap;
  uniform sampler2D uSmoothnessMap;

  uniform vec3 uSunDirection;  // World space
  uniform vec3 uSunColor;
  uniform float uSunIntensity;

  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform float uAmbientIntensity;

  uniform sampler2D uShadowMap;
  uniform mat4 uShadowMatrix;

  uniform float uEmissive;
  uniform float uAlphaCutoff;
  uniform float uSurfaceHeight;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vWorldViewDir;
  varying mat3 vTBNWorld;
  varying vec3 vColor;  // Vertex color (humidity-based tint)

  void main() {
    vec4 albedoAlpha = texture2D(uDiffuseMap, vUv);
    vec3 albedo = albedoAlpha.rgb * vColor;

    if (albedoAlpha.a < uAlphaCutoff) discard;

    vec3 packedNormal = texture2D(uNormalMap, vUv).rgb;
    float smoothness = texture2D(uSmoothnessMap, vUv).r;

    // Normal map: tangent→world
    vec3 tangentNormal = packedNormal * 2.0 - 1.0;
    vec3 N = normalize(vTBNWorld * tangentNormal);

    // Cave factor
    float caveFactor = smoothstep(uSurfaceHeight - 12.0, uSurfaceHeight + 6.0, vWorldPosition.y);

    float NdotY = max(N.y, 0.0);
    vec3 ambient = mix(uGroundColor, uSkyColor, NdotY) * uAmbientIntensity;

    vec3 L = normalize(uSunDirection);
    float NdotL = max(dot(N, L), 0.0);
    vec3 diffuse = albedo * uSunColor * uSunIntensity * NdotL * caveFactor;

    vec3 H = normalize(L + vWorldViewDir);
    float NdotH = max(dot(N, H), 0.0);
    float specExponent = mix(4.0, 128.0, smoothness);
    float spec = pow(NdotH, specExponent);
    vec3 specular = uSunColor * uSunIntensity * spec * smoothness * 0.3 * caveFactor;

    // ── Shadow factor ──
    vec4 shadowCoord = uShadowMatrix * vec4(vWorldPosition, 1.0);
    float shadowFactor = 1.0;
    vec3 shadowPos = shadowCoord.xyz / shadowCoord.w;
    vec2 uv = shadowPos.xy * 0.5 + 0.5; // [-1,1] → [0,1]
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        if (shadowPos.z > -1.0 && shadowPos.z < 1.0) {
            float storedDepth = texture2D(uShadowMap, uv).r;
            float fragDepth = shadowPos.z * 0.5 + 0.5;
            shadowFactor = step(fragDepth - 0.001, storedDepth);
        }
    }

    vec3 color = albedo * ambient + (diffuse + specular) * shadowFactor + albedo * uEmissive;

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ── Fragment Shader — Transparent (alpha-blended) ──────────────────────
const PBRFragmentShaderTransparent = `
  precision mediump float;

  uniform sampler2D uDiffuseMap;
  uniform sampler2D uNormalMap;
  uniform sampler2D uSmoothnessMap;

  uniform vec3 uSunDirection;  // World space
  uniform vec3 uSunColor;
  uniform float uSunIntensity;

  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform float uAmbientIntensity;

  uniform sampler2D uShadowMap;
  uniform mat4 uShadowMatrix;

  uniform float uEmissive;
  uniform float uOpacity;
  uniform float uSurfaceHeight;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vWorldViewDir;
  varying mat3 vTBNWorld;
  varying vec3 vColor;  // Vertex color (humidity-based tint)

  void main() {
    vec4 albedoAlpha = texture2D(uDiffuseMap, vUv);
    vec3 albedo = albedoAlpha.rgb * vColor;

    vec3 packedNormal = texture2D(uNormalMap, vUv).rgb;
    float smoothness = texture2D(uSmoothnessMap, vUv).r;

    // Normal map: tangent→world
    vec3 tangentNormal = packedNormal * 2.0 - 1.0;
    vec3 N = normalize(vTBNWorld * tangentNormal);

    // Cave factor
    float caveFactor = smoothstep(uSurfaceHeight - 12.0, uSurfaceHeight + 6.0, vWorldPosition.y);

    float NdotY = max(N.y, 0.0);
    vec3 ambient = mix(uGroundColor, uSkyColor, NdotY) * uAmbientIntensity;

    vec3 L = normalize(uSunDirection);
    float NdotL = max(dot(N, L), 0.0);
    vec3 diffuse = albedo * uSunColor * uSunIntensity * NdotL * caveFactor;

    vec3 H = normalize(L + vWorldViewDir);
    float NdotH = max(dot(N, H), 0.0);
    float specExponent = mix(4.0, 256.0, smoothness);
    float spec = pow(NdotH, specExponent);
    vec3 specular = uSunColor * uSunIntensity * spec * smoothness * 0.8 * caveFactor;

    // ── Shadow factor ──
    vec4 shadowCoord = uShadowMatrix * vec4(vWorldPosition, 1.0);
    float shadowFactor = 1.0;
    vec3 shadowPos = shadowCoord.xyz / shadowCoord.w;
    vec2 uv = shadowPos.xy * 0.5 + 0.5; // [-1,1] → [0,1]
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        if (shadowPos.z > -1.0 && shadowPos.z < 1.0) {
            float storedDepth = texture2D(uShadowMap, uv).r;
            float fragDepth = shadowPos.z * 0.5 + 0.5;
            shadowFactor = step(fragDepth - 0.001, storedDepth);
        }
    }

    vec3 color = albedo * ambient + (diffuse + specular) * shadowFactor + albedo * uEmissive;

    gl_FragColor = vec4(color, uOpacity * albedoAlpha.a);
  }
`;

// ── Material Factory ────────────────────────────────────────────────────

class PBRMaterialFactory {
  constructor(diffuseTex, normalTex, smoothnessTex, sunDirection) {
    this.diffuseTex = diffuseTex;
    this.normalTex = normalTex;
    this.smoothnessTex = smoothnessTex;
    this.sunDirection = sunDirection || new THREE.Vector3(50, 100, 50).normalize();
    
    // Shared shadow map uniform value — all materials reference the same object
    this._shadowMapValue = { value: this._createWhiteTexture() };
    this._shadowMatrixValue = { value: new THREE.Matrix4() };
  }

  /** Create a 1×1 white texture as shadow map placeholder */
  _createWhiteTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1, 1);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  /**
   * Update the shadow map texture and matrix from the renderer's DirectionalLight.
   * Call this each frame after the shadow camera is updated.
   * All PBR materials share these uniform values, so updating here affects all of them.
   */
  updateShadowData(shadowMap, shadowMatrix) {
    if (shadowMap) {
      this._shadowMapValue.value = shadowMap;
      if (typeof this._pbrDebugCount === 'undefined') this._pbrDebugCount = 0;
      this._pbrDebugCount++;
      if (this._pbrDebugCount <= 3 || this._pbrDebugCount % 300 === 0) {
        console.log('[Shadow PBR] Updated shadow map:', {
          frame: this._pbrDebugCount,
          isWebGLTexture: shadowMap.__webglTexture !== undefined,
          imageWidth: shadowMap.image?.width,
          imageHeight: shadowMap.image?.height,
        });
      }
    }
    if (shadowMatrix) {
      this._shadowMatrixValue.value = shadowMatrix;
    }
  }

  _baseUniforms() {
    return {
      uDiffuseMap:       { value: this.diffuseTex },
      uNormalMap:        { value: this.normalTex },
      uSmoothnessMap:    { value: this.smoothnessTex },
      uSunDirection:     { value: this.sunDirection },
      uSunColor:         { value: new THREE.Color(1.0, 0.98, 0.92) },
      uSunIntensity:     { value: 1.2 },
      uSkyColor:         { value: new THREE.Color(0.53, 0.81, 1.0) },
      uGroundColor:      { value: new THREE.Color(0.22, 0.18, 0.11) },
      uAmbientIntensity: { value: 0.35 },
      uShadowMap:        this._shadowMapValue,
      uShadowMatrix:     this._shadowMatrixValue,
      uEmissive:         { value: 0.0 },
      uSurfaceHeight:    { value: 64.0 },
    };
  }

  createSolid(emissive = 0.0) {
    const uniforms = this._baseUniforms();
    uniforms.uEmissive.value = emissive;
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: PBRVertexShader,
      fragmentShader: PBRFragmentShader,
      defines: { USE_COLOR: 1 },
      fog: false,
    });
  }

  createCutout(emissive = 0.0, alphaCutoff = 0.5) {
    const uniforms = this._baseUniforms();
    uniforms.uEmissive.value = emissive;
    uniforms.uAlphaCutoff = { value: alphaCutoff };
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: PBRVertexShader,
      fragmentShader: PBRFragmentShaderCutout,
      defines: { USE_COLOR: 1 },
      transparent: true,
      alphaToCoverage: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: false,
    });
  }

  createTransparent(emissive = 0.0, opacity = 0.6) {
    const uniforms = this._baseUniforms();
    uniforms.uEmissive.value = emissive;
    uniforms.uOpacity = { value: opacity };
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: PBRVertexShader,
      fragmentShader: PBRFragmentShaderTransparent,
      defines: { USE_COLOR: 1 },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
  }
}

// ── Export for module environments ──────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PBRVertexShader,
    PBRFragmentShader,
    PBRFragmentShaderCutout,
    PBRFragmentShaderTransparent,
    PBRMaterialFactory,
  };
}
