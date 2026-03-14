import * as THREE from 'three';

/**
 * Physically-based atmospheric scattering using a custom ShaderMaterial.
 *
 * Implements a Rayleigh+Mie approximation:
 *   - Rayleigh fresnel rim: blue sky glow on the atmospheric limb
 *   - Sunset/sunrise warm band: warm orange-red at glancing sun angles
 *   - Mie forward scatter: bright halo directly toward the sun
 *
 * Uniforms updated per-frame:
 *   uSunDirection  — normalised world-space direction toward the sun
 *   uCameraPosition — camera world position (for fresnel view-direction)
 */

const VERT_GLSL = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vWorldPos    = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_GLSL = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  uniform vec3 uSunDirection;
  uniform vec3 uCameraPosition;

  void main() {
    vec3 norm    = normalize(vWorldNormal);
    vec3 viewDir = normalize(uCameraPosition - vWorldPos);

    // Fresnel rim — glow on the limb of the atmosphere
    float rim     = 1.0 - max(0.0, dot(viewDir, norm));
    float fresnel = pow(rim, 3.0);

    // Sun altitude above surface normal
    float sunDot   = dot(norm, uSunDirection);
    float dayFactor = smoothstep(-0.35, 0.55, sunDot);

    // Rayleigh: deep-blue on night side, bright sky-blue on day side
    vec3 rayleigh = mix(
      vec3(0.04, 0.10, 0.32),   // night twilight
      vec3(0.18, 0.52, 0.98),   // daytime sky
      dayFactor
    );

    // Sunset/sunrise warm glow near the terminator horizon
    float horizSun   = max(0.0, dot(viewDir, uSunDirection));
    float sunsetBand = pow(horizSun, 3.5) * (1.0 - abs(sunDot) * 0.45);
    vec3  sunsetCol  = mix(vec3(1.0, 0.30, 0.05), vec3(1.0, 0.60, 0.15), dayFactor)
                       * sunsetBand * 1.1;

    // Mie forward-scatter halo orbiting the sun disc
    float mieDot = max(0.0, dot(viewDir, uSunDirection));
    float mie    = pow(mieDot, 10.0) * 0.65 * dayFactor;
    vec3  mieCol = vec3(1.0, 0.95, 0.75) * mie;

    vec3  color = (rayleigh + sunsetCol + mieCol) * fresnel;
    float alpha = fresnel * (0.52 + dayFactor * 0.48);

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.92));
  }
`;

export interface AtmosphereSystem {
  mesh: THREE.Mesh;
  updateSun(sunDirection: THREE.Vector3): void;
  updateCamera(cameraPosition: THREE.Vector3): void;
}

export function createAtmosphereMesh(globeRadius: number): AtmosphereSystem {
  const uniforms = {
    uSunDirection: { value: new THREE.Vector3(1, 0, 0) },
    uCameraPosition: { value: new THREE.Vector3(0, 0, 5) }
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT_GLSL,
    fragmentShader: FRAG_GLSL,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending
  });

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(globeRadius * 1.068, 72, 72),
    material
  );
  mesh.renderOrder = 1; // draw after opaque globe

  return {
    mesh,
    updateSun(dir: THREE.Vector3): void {
      uniforms.uSunDirection.value.copy(dir).normalize();
    },
    updateCamera(pos: THREE.Vector3): void {
      uniforms.uCameraPosition.value.copy(pos);
    }
  };
}
