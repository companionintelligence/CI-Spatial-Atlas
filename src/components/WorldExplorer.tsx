"use client";

import { useEffect, useRef, useState } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { SkyMaterial } from "@babylonjs/materials/sky/skyMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { CesiumIntegration } from "../services/CesiumIntegration";
import * as Cesium from "cesium";
import { CesiumImageryManager } from "../services/CesiumImageryManager";

// Import required modules
import "@babylonjs/core/Loading/loadingScreen";
import "@babylonjs/core/Cameras/universalCamera";
import "@babylonjs/core/Lights/directionalLight";
import "@babylonjs/core/Lights/hemisphericLight";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Materials/Textures/texture";
import "@babylonjs/core/Meshes/groundMesh";
import "@babylonjs/materials/sky";

interface WorldExplorerProps {
  initialPosition?: Vector3;
  enableTerrain?: boolean;
  enable3DTiles?: boolean;
}

export default function WorldExplorer({ 
  initialPosition = new Vector3(0, 1000, -5000),
  enableTerrain = true,
  enable3DTiles = true 
}: WorldExplorerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState<Vector3>(initialPosition);
  const [showTerrain, setShowTerrain] = useState(enableTerrain);
  const [showBuildings, setShowBuildings] = useState(enable3DTiles);
  const [showAtmosphere, setShowAtmosphere] = useState(true);
  const [useCesiumImagery, setUseCesiumImagery] = useState(false);
  const terrainPatchesRef = useRef<Mesh[]>([]);
  const earthRef = useRef<Mesh | null>(null);
  const originalEarthTextureRef = useRef<Texture | null>(null);
  const skyRef = useRef<Mesh | null>(null);
  const starRef = useRef<Mesh | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cesiumRef = useRef<CesiumIntegration | null>(null);
  const buildingsLoadedRef = useRef<boolean>(false);
  const imageryManagerRef = useRef<CesiumImageryManager | null>(null);

  // Intentionally defined outside useEffect and not a dependency; world setup should only occur once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initializeWorld = async (engine: Engine, scene: Scene) => {
    // Create camera with Earth-like controls
    const camera = createEarthCamera(scene, initialPosition);
    // Environment (reflection) texture
    const envTexture = CubeTexture.CreateFromPrefilteredData("https://playground.babylonjs.com/textures/environment.env", scene);
  scene.environmentTexture = envTexture;
  // Manual skybox (createDefaultSkybox not present in trimmed build). Use environment texture.
  const skybox = MeshBuilder.CreateBox("envSkybox", { size: 1000000 }, scene);
  const skyboxMaterial = new StandardMaterial("envSkyboxMat", scene);
  skyboxMaterial.backFaceCulling = false;
  skyboxMaterial.reflectionTexture = envTexture;
  skyboxMaterial.reflectionTexture.coordinatesMode = 5; // SKYBOX_MODE
  skyboxMaterial.disableLighting = true;
  skyboxMaterial.diffuseColor = new Color3(0,0,0);
  skyboxMaterial.specularColor = new Color3(0,0,0);
  skybox.material = skyboxMaterial;
    // Create atmospheric lighting & sun
    const lighting = createAtmosphericLighting(scene);
    // Create sky dome & starfield
    const sky = createSkyDome(scene); skyRef.current = sky;
    const stars = createStarfield(scene); starRef.current = stars;
    // Create Earth globe
    const earth = createEarthSphere(scene); earthRef.current = earth;
    if (useCesiumImagery) {
      initializeProgressiveImagery(scene, earth);
    }
    // Procedural terrain patches (optional future LOD tiles)
    const terrainPatches = showTerrain ? createTerrainPatches(scene) : [];
    terrainPatchesRef.current = terrainPatches;
    // Apply spherical projection to terrain patches (approx) so they curve with globe
    if (terrainPatches.length) {
      terrainPatches.forEach(p => projectGroundToSphere(p, 63710 * 2));
    }
    // Add shadows (buildings/terrain patches can be added later)
    setupShadows(scene, lighting.directionalLight, [...terrainPatches]);
    // Day-night cycle update
    scene.onBeforeRenderObservable.add(() => {
      if (showAtmosphere) {
        updateSunAndAtmosphere(scene, lighting.directionalLight, sky);
      }
      toggleSpace(scene, sky, stars, camera, showAtmosphere);
      updateHUD(camera);
      if (showBuildings) {
        manageBuildings(scene, camera);
      } else if (buildingsLoadedRef.current && cesiumRef.current) {
        cesiumRef.current.dispose();
        buildingsLoadedRef.current = false;
      }
      // Reactively apply or remove Cesium imagery if toggle changed post init
      if (earthRef.current && useCesiumImagery) {
        imageryManagerRef.current?.updateEarthTexture(earthRef.current, camera.position.length());
      } else if (earthRef.current && !useCesiumImagery && earthRef.current.metadata?.cesiumApplied) {
        const mat = earthRef.current.material as PBRMaterial;
        if (originalEarthTextureRef.current) mat.albedoTexture = originalEarthTextureRef.current;
        earthRef.current.metadata.cesiumApplied = false;
      }
    });
    // Setup camera controls for Earth exploration
    await setupEarthControls(camera, scene);
  cesiumRef.current = new CesiumIntegration(scene);
    // Start render loop
    engine.runRenderLoop(() => {
      scene.render();
    });
  };

  useEffect(() => {
    if (!canvasRef.current) return;

    const engine = new Engine(canvasRef.current, true, {
      stencil: true,
      antialias: true,
      audioEngine: false,
      adaptToDeviceRatio: true,
      disableWebGL2Support: false,
      useHighPrecisionFloats: true,
      powerPreference: "high-performance",
      failIfMajorPerformanceCaveat: false,
    });

  const scene = new Scene(engine);
  sceneRef.current = scene;
    scene.clearColor = new Color4(0.2, 0.6, 1.0, 1.0); // Sky blue

    // Initialize the world
    initializeWorld(engine, scene).then(() => {
      setIsLoading(false);
    });

    // Handle resize
    const handleResize = () => engine.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      scene.dispose();
      engine.dispose();
      window.removeEventListener("resize", handleResize);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // initializeWorld moved above for dependency tracking

  function createEarthCamera(scene: Scene, position: Vector3): UniversalCamera {
    const camera = new UniversalCamera("earthCamera", position, scene);
    camera.setTarget(Vector3.Zero());
    camera.attachControl();
    
    // Configure for Earth exploration
    camera.speed = 100;
    camera.maxZ = 1000000; // Very far view distance for Earth scale
    camera.minZ = 0.1;
    camera.fov = Math.PI / 3;
    
    // Smooth movement
    camera.inertia = 0.9;
    camera.angularSensibility = 2000;
    
    return camera;
  }

  function createAtmosphericLighting(scene: Scene) {
    // Initial sun vector (will be updated each frame)
    const sunLight = new DirectionalLight("sunLight", new Vector3(0.5, -1, 0.2), scene);
    sunLight.intensity = 1.1;
    sunLight.diffuse = new Color3(1, 0.97, 0.85);
    sunLight.specular = new Color3(1, 1, 0.95);

    const ambientLight = new HemisphericLight("ambientLight", new Vector3(0, 1, 0), scene);
    ambientLight.intensity = 0.35;
    ambientLight.diffuse = new Color3(0.6, 0.75, 1);
    ambientLight.groundColor = new Color3(0.2, 0.2, 0.25);

    return { directionalLight: sunLight, ambientLight };
  }

  function createSkyDome(scene: Scene): Mesh {
    const skyDome = MeshBuilder.CreateSphere("skyDome", { diameter: 500000, segments: 48 }, scene);
    const skyMaterial = new SkyMaterial("skyMaterial", scene);
    skyMaterial.backFaceCulling = false;
    skyMaterial.useSunPosition = true;
    skyMaterial.sunPosition = new Vector3(0, 100, 0);
    skyMaterial.turbidity = 10;
    skyMaterial.luminance = 0.9;
    skyMaterial.mieCoefficient = 0.004;
    skyMaterial.mieDirectionalG = 0.8;
    skyMaterial.rayleigh = 3;
  // Optional camera offset not needed; ensure default
  skyMaterial.cameraOffset = Vector3.Zero();
    skyDome.material = skyMaterial;
    skyDome.infiniteDistance = true;
    return skyDome;
  }

  function createStarfield(scene: Scene): Mesh {
    const starSphere = MeshBuilder.CreateSphere("starfield", { diameter: 4000000, segments: 8 }, scene);
    const starMaterial = new StandardMaterial("starMat", scene);
    starMaterial.backFaceCulling = false;
    starMaterial.emissiveColor = new Color3(1,1,1);
    // Generate procedural star texture (placeholder tiny white noise)
  // Use Babylon CDN stable star texture; fallback handled by onError observable if needed
  starMaterial.diffuseTexture = new Texture("https://assets.babylonjs.com/textures/starfield.jpg", scene, undefined, false);
    starMaterial.disableLighting = true;
    starSphere.material = starMaterial;
    starSphere.infiniteDistance = true;
    starSphere.isVisible = false; // Hidden until high altitude
    return starSphere;
  }

  function toggleSpace(scene: Scene, sky: Mesh, stars: Mesh, camera: UniversalCamera, atmosphereEnabled: boolean) {
    const altitude = camera.position.length();
    if (!atmosphereEnabled) {
      sky.isVisible = false;
      stars.isVisible = true;
      return;
    }
    if (altitude > 300000) {
      sky.isVisible = false;
      stars.isVisible = true;
    } else {
      sky.isVisible = true;
      stars.isVisible = false;
    }
  }

  function updateSunAndAtmosphere(scene: Scene, sunLight: DirectionalLight, sky: Mesh) {
    const skyMaterial = sky.material as SkyMaterial;
    // Simple time-based rotation (24h cycle = 60s demo)
    const t = (scene.getEngine().getDeltaTime() / 1000);
    (scene as any)._timeAccumulator = (scene as any)._timeAccumulator ? (scene as any)._timeAccumulator + t : 0;
    const dayProgress = ((scene as any)._timeAccumulator / 60) % 1; // 0..1
    const angle = dayProgress * Math.PI * 2; // full rotation
    const sunDir = new Vector3(Math.cos(angle), Math.sin(angle), 0.2).normalize();
    sunLight.direction = sunDir.scale(-1); // directional light points opposite to sun direction
    skyMaterial.sunPosition = sunDir.scale(100);
    // Adjust intensity for dusk/dawn
    const elevation = sunDir.y;
    sunLight.intensity = Math.max(0.05, elevation > 0 ? 1.1 * elevation : 0.15);
  }

  function createEarthSphere(scene: Scene): Mesh {
    const earth = MeshBuilder.CreateSphere("earth", { diameter: 127420, segments: 64 }, scene); // Scaled km * 1000
    const earthMat = new PBRMaterial("earthMat", scene);
  // Replace 404 playground URLs with Babylon CDN Earth textures (example placeholders)
  earthMat.albedoTexture = new Texture("https://assets.babylonjs.com/textures/earth.jpg", scene);
  earthMat.bumpTexture = new Texture("https://assets.babylonjs.com/textures/earth_normal_map.jpg", scene);
    originalEarthTextureRef.current = earthMat.albedoTexture as Texture;
    earthMat.metallic = 0;
    earthMat.roughness = 1;
    earthMat.environmentIntensity = 0.7;
  // PBR uses reflectivity/metallic/roughness instead of specularColor
  earthMat.reflectivityColor = new Color3(0.02,0.02,0.02);
    earth.material = earthMat;
    earth.receiveShadows = true;
    return earth;
  }

  function initializeProgressiveImagery(scene: Scene, earth: Mesh) {
    const token = process.env.CESIUM_API; // Removed NEXT_PUBLIC_CESIUM_ION_TOKEN fallback
    imageryManagerRef.current = new CesiumImageryManager(scene, { token, assetId: 2, maxLevel: 5 });
    earth.metadata = earth.metadata || {};
    earth.metadata.cesiumApplied = true;
  }

  function createTerrainPatches(scene: Scene): Mesh[] {
    const patches: Mesh[] = [];
    const patchSize = 20000;
    const gridRadius = 1; // 3x3 around center for demo
    for (let gx = -gridRadius; gx <= gridRadius; gx++) {
      for (let gz = -gridRadius; gz <= gridRadius; gz++) {
        const patch = MeshBuilder.CreateGround(`terrainPatch_${gx}_${gz}`, { width: patchSize, height: patchSize, subdivisions: 128 }, scene);
        patch.position = new Vector3(gx * patchSize, 0, gz * patchSize);
        const mat = new StandardMaterial(`terrainMat_${gx}_${gz}`, scene);
        mat.diffuseColor = new Color3(0.25, 0.45, 0.25);
        mat.specularColor = new Color3(0.05,0.05,0.05);
        mat.roughness = 0.9;
        patch.material = mat;
        patch.receiveShadows = true;
        sculptTerrain(patch, gx, gz);
        patches.push(patch);
      }
    }
    return patches;
  }

  function projectGroundToSphere(patch: Mesh, sphereDiameter: number) {
    const radius = sphereDiameter / 2;
    const positions = patch.getVerticesData("position");
    if (!positions) return;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] + patch.position.x;
      const z = positions[i + 2] + patch.position.z;
      // Treat ground plane as tangent at origin; approximate sphere elevation difference
      const dist = Math.sqrt(x * x + z * z);
      // If near origin flatten, otherwise adjust y downwards so edges fall along sphere
      const sphereY = Math.sqrt(Math.max(0, radius * radius - dist * dist)) - radius;
      positions[i + 1] += sphereY; // subtracting radius so center near 0
    }
    patch.setVerticesData("position", positions);
    patch.createNormals(true);
  }

  function updateHUD(camera: UniversalCamera) {
    // Convert position to lat/long assuming Earth sphere centered at 0,0,0
    const pos = camera.position;
    const radius = 63710; // scaled Earth radius (approx km*0.5?) adjust for our sphere (we used 127420 diameter)
    const lat = (Math.asin(pos.y / radius) * 180) / Math.PI;
    const lon = (Math.atan2(pos.z, pos.x) * 180) / Math.PI;
    setCurrentLocation(new Vector3(lon, pos.length(), lat));
  }

  async function manageBuildings(scene: Scene, camera: UniversalCamera) {
    if (!cesiumRef.current) return;
    const viewDistance = camera.position.length();
    // Load procedural building tiles around camera (simplified distance metric)
    if (!buildingsLoadedRef.current || viewDistance < 200000) {
      await cesiumRef.current.load3DTiles(camera.position, 5000);
      cesiumRef.current.cleanupDistantTiles(camera.position, 15000);
      buildingsLoadedRef.current = true;
    }
  }

  function sculptTerrain(patch: Mesh, gx: number, gz: number) {
    const positions = patch.getVerticesData("position");
    if (!positions) return;
    const scale = 0.00025;
    const amp1 = 450;
    const amp2 = 120;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] + gx * 0.1;
      const z = positions[i + 2] + gz * 0.1;
      const n = perlinLike(x * scale, z * scale);
      const m = perlinLike(x * scale * 2, z * scale * 2);
      const height = n * amp1 + m * amp2;
      positions[i + 1] = height;
    }
    patch.setVerticesData("position", positions);
    patch.createNormals(true);
  }

  function perlinLike(x: number, y: number): number {
    // Simple fractal noise using sin/cos layers (cheap placeholder for Perlin)
    let v = 0;
    v += Math.sin(x) * Math.cos(y);
    v += 0.5 * Math.sin(x * 2.1 + 1.3) * Math.cos(y * 1.7 - 0.7);
    v += 0.25 * Math.sin(x * 4.3 - 2.2) * Math.cos(y * 3.9 + 0.4);
    return (v) / (1 + 0.5 + 0.25) * 0.5 + 0.5; // normalize 0..1
  }

  function setupShadows(scene: Scene, light: DirectionalLight, meshes: Mesh[]) {
    const shadowGenerator = new ShadowGenerator(2048, light);
    shadowGenerator.useBlurExponentialShadowMap = true;
    shadowGenerator.blurKernel = 32;
    shadowGenerator.blurScale = 2;
    shadowGenerator.depthScale = 50;
    
    // Add meshes to shadow casting (terrain usually doesn't cast shadows on itself)
    // You can add other objects here that should cast shadows
  }

  async function setupEarthControls(camera: UniversalCamera, scene: Scene) {
    // Enhanced camera controls for Earth exploration
    scene.onPointerObservable.add((pointerInfo) => {
      switch (pointerInfo.type) {
        case 4: // POINTERDOWN
          // You can add custom interaction logic here
          break;
        case 8: // POINTERWHEEL
          // Custom zoom behavior for Earth scale
          break;
      }
    });
    
    // Keyboard controls for better navigation
    const { ActionManager } = await import("@babylonjs/core/Actions/actionManager");
    scene.actionManager = scene.actionManager || new ActionManager(scene);
  }

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full outline-none select-none"
      />
      
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-900 bg-opacity-75">
          <div className="text-white text-xl">Loading World Explorer...</div>
        </div>
      )}
      
      {/* UI Controls */}
      <div className="absolute top-4 left-4 z-10 space-y-2">
        <div className="bg-black bg-opacity-50 text-white p-3 rounded">
          <h3 className="font-bold">World Explorer</h3>
          <p className="text-sm">WASD: Move | Mouse: Look | Scroll: Zoom</p>
        </div>
        
        <div className="bg-black bg-opacity-50 text-white p-2 rounded text-sm">
          Lon: {currentLocation.x.toFixed(2)}°  Dist:{currentLocation.y.toFixed(0)}  Lat: {currentLocation.z.toFixed(2)}°
        </div>
      </div>
      
      {/* Layer Controls */}
      <div className="absolute top-4 right-4 z-10">
        <div className="bg-black bg-opacity-50 text-white p-3 rounded space-y-2">
          <h4 className="font-bold">Layers</h4>
          <LayerToggle label="Terrain" checked={showTerrain} onChange={(v) => {
            setShowTerrain(v);
            terrainPatchesRef.current.forEach(m => m.dispose());
            if (sceneRef.current) {
              terrainPatchesRef.current = v ? createTerrainPatches(sceneRef.current) : [];
            } else {
              terrainPatchesRef.current = [];
            }
          }} />
          <LayerToggle label="3D Buildings" checked={showBuildings} onChange={(v) => {
            setShowBuildings(v);
            // Placeholder: future building tile streaming integration
          }} />
          <LayerToggle label="Atmosphere" checked={showAtmosphere} onChange={(v) => {
            setShowAtmosphere(v);
            if (skyRef.current) skyRef.current.isVisible = v;
          }} />
          <LayerToggle label="Earth Globe" checked={!!earthRef.current?.isVisible} onChange={(v) => {
            if (earthRef.current) earthRef.current.isVisible = v;
          }} />
          <LayerToggle label="Cesium Imagery" checked={useCesiumImagery} onChange={(v) => setUseCesiumImagery(v)} />
          <LayerToggle label="Stars" checked={!!starRef.current?.isVisible} onChange={(v) => {
            if (starRef.current) starRef.current.isVisible = v;
          }} />
        </div>
      </div>
    </div>
  );
}

interface LayerToggleProps { label: string; checked: boolean; onChange: (checked: boolean)=>void }
function LayerToggle({ label, checked, onChange }: LayerToggleProps) {
  return (
    <label className="flex items-center space-x-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-blue-500"
      />
      <span>{label}</span>
    </label>
  );
}