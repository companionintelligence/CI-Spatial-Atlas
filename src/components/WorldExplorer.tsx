// Vite environment: remove Next.js client directive.

import { useEffect, useRef, useState } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { SkyMaterial } from "@babylonjs/materials/sky/skyMaterial";
// PBRMaterial removed (using StandardMaterial for custom night/day blending)
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
import { GeodeticCameraController } from "../controllers/GeodeticCameraController";
// High-res Earth & space map assets
// For Next.js static assets we can reference them via /maps/... from public or ensure import gives a string (some setups return an object). Cast to string defensively.
// If these imports resolve to objects (default export), we coerce to string using (value as any).src || value.
import dayMap8kRaw from "../maps/8k_earth_daymap.jpg";
import dayMap2kRaw from "../maps/2k_earth_daymap.jpg";
import nightMap8kRaw from "../maps/8k_earth_nightmap.jpg"; // future night emissive
import nightMap2kRaw from "../maps/2k_earth_nightmap.jpg"; // fallback
import normalMap8kRaw from "../maps/earthNormalMap_8k-tig.png";
// @ts-ignore allow tif import placeholder
import stars8kRaw from "../maps/8k_stars.jpg";
import starsMilky8kRaw from "../maps/8k_stars_milky_way.jpg";

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
  // Use real-Earth meter scale (radius ~6,378,137 m) start a couple radii away
  initialPosition = new Vector3(0, 1_500_000, -14_000_000),
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
  const geodeticControllerRef = useRef<GeodeticCameraController | null>(null);
  const frameCounterRef = useRef<number>(0);
  const [debugStats, setDebugStats] = useState({ meshes: 0, cameraDist: 0 });

  // Intentionally defined outside useEffect and not a dependency; world setup should only occur once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initializeWorld = async (engine: Engine, scene: Scene) => {
  // Create camera with Earth-like controls
  const camera = createEarthCamera(scene, initialPosition);
    // Environment (reflection) texture
    let envTexture: CubeTexture | undefined;
    try {
      envTexture = CubeTexture.CreateFromPrefilteredData("https://playground.babylonjs.com/textures/environment.env", scene);
      if (envTexture) {
        scene.environmentTexture = envTexture;
      }
    } catch (e) {
      console.warn("Env texture failed; proceeding without environment reflection", e);
    }
  // Manual skybox (createDefaultSkybox not present in trimmed build). Use environment texture.
  const skybox = MeshBuilder.CreateBox("envSkybox", { size: 1000000 }, scene);
  const skyboxMaterial = new StandardMaterial("envSkyboxMat", scene);
  skyboxMaterial.backFaceCulling = false;
  if (envTexture) {
    skyboxMaterial.reflectionTexture = envTexture;
    if (skyboxMaterial.reflectionTexture) {
      skyboxMaterial.reflectionTexture.coordinatesMode = 5; // SKYBOX_MODE
    }
  }
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
    // If camera spawned inside/too far from Earth, relocate to good vantage
    const earthRadius = 12_756_274 / 2;
    if (camera.position.length() < earthRadius * 1.05 || camera.position.length() > earthRadius * 10) {
      camera.position = new Vector3(0, earthRadius * 0.25, -earthRadius * 2.2);
      camera.setTarget(Vector3.Zero());
      console.info("Camera auto-relocated outside Earth to avoid interior view.");
    }
    if (useCesiumImagery) {
      initializeProgressiveImagery(scene, earth);
    }
    // Procedural terrain patches (optional future LOD tiles)
    const terrainPatches = showTerrain ? createTerrainPatches(scene) : [];
    terrainPatchesRef.current = terrainPatches;
    // Apply spherical projection to terrain patches (approx) so they curve with globe
    if (terrainPatches.length) {
  terrainPatches.forEach(p => projectGroundToSphere(p, 12_756_274));
    }
    // Add shadows (buildings/terrain patches can be added later)
    setupShadows(scene, lighting.directionalLight, [...terrainPatches]);
    // Day-night cycle update
    scene.onBeforeRenderObservable.add(() => {
      if (showAtmosphere) {
        updateSunAndAtmosphere(scene, lighting.directionalLight, sky);
      }
      toggleSpace(scene, sky, stars, camera, showAtmosphere);
      // Night/day emissive blend for city lights
      if (earthRef.current) {
        const mat = earthRef.current.material as StandardMaterial;
        const nightTex: Texture | null = earthRef.current.metadata?.nightTex || null;
        if (nightTex) {
          // Estimate day factor using light direction vs up vector (simple)
          const lightDir = lighting.directionalLight.direction.normalize();
          const dayFactor = Math.max(0, -lightDir.y); // crude heuristic
          const nightFactor = 1 - dayFactor;
          if (nightFactor > 0.02) {
            mat.emissiveTexture = nightTex;
            mat.emissiveColor = new Color3(nightFactor * 0.8, nightFactor * 0.8, nightFactor * 0.8);
          } else {
            mat.emissiveTexture = null;
            mat.emissiveColor = Color3.Black();
          }
        }
      }
      // Throttled geodetic HUD update
      if (geodeticControllerRef.current) {
        frameCounterRef.current = (frameCounterRef.current + 1) % 5; // update every 5 frames
        if (frameCounterRef.current === 0) {
          const g = geodeticControllerRef.current.getGeodetic();
          setCurrentLocation(new Vector3(g.lon, g.alt, g.lat)); // x: lon, y: alt (m), z: lat
        }
      }
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
        const mat = earthRef.current.material as StandardMaterial;
        if (originalEarthTextureRef.current) mat.diffuseTexture = originalEarthTextureRef.current;
        earthRef.current.metadata.cesiumApplied = false;
      }
    });
    // Setup camera controls for Earth exploration
    await setupEarthControls(camera, scene);
    // Instantiate geodetic controller AFTER any camera customization
    geodeticControllerRef.current = new GeodeticCameraController(camera, scene, {});
  cesiumRef.current = new CesiumIntegration(scene);
    // Start render loop
  if (!engine.isDisposed) {
      engine.runRenderLoop(() => {
        try {
          scene.render();
        } catch (e) {
          console.error("Render loop error", e);
        }
      });
    }
  };

  useEffect(() => {
    if (!canvasRef.current) {
      console.error("WorldExplorer: canvas ref missing; cannot initialize Babylon engine.");
      return;
    }

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
    console.info("Babylon Engine initialized", engine.version);

  const scene = new Scene(engine);
  sceneRef.current = scene;
    // Space-like background; atmosphere provides blue near surface
    scene.clearColor = new Color4(0, 0, 0, 1.0);

    // Initialize the world
    initializeWorld(engine, scene).then(() => {
      setIsLoading(false);
    });

    // Debug stats updater (every second)
    const statsInterval = setInterval(() => {
  if (!scene.isDisposed) {
        const activeCamera = scene.activeCamera as UniversalCamera | null;
        setDebugStats({ meshes: scene.meshes.length, cameraDist: activeCamera ? activeCamera.position.length() : 0 });
      }
    }, 1000);

    // Handle resize
    const handleResize = () => engine.resize();
    window.addEventListener("resize", handleResize);

    return () => {
  clearInterval(statsInterval);
  geodeticControllerRef.current?.dispose();
  if (sceneRef.current && (sceneRef.current as any)._shadowGen) {
    try { (sceneRef.current as any)._shadowGen.dispose(); } catch {}
  }
  scene.dispose();
      engine.dispose();
      window.removeEventListener("resize", handleResize);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reactive Cesium imagery initialization if user toggles after load.
  useEffect(() => {
    if (useCesiumImagery && earthRef.current && sceneRef.current && !earthRef.current.metadata?.cesiumApplied) {
      initializeProgressiveImagery(sceneRef.current, earthRef.current);
    }
  }, [useCesiumImagery]);

  // initializeWorld moved above for dependency tracking

  function createEarthCamera(scene: Scene, position: Vector3): UniversalCamera {
    const camera = new UniversalCamera("earthCamera", position, scene);
    camera.setTarget(Vector3.Zero());
    camera.attachControl();
    
  // Configure for Earth exploration (meter units)
  camera.speed = 250; // base speed; geodetic controller scales movement
  camera.maxZ = 50_000_000; // far clip to view whole Earth from distance
  camera.minZ = 10; // raise near plane a bit to reduce precision issues
    camera.fov = Math.PI / 3;
    
    // Smooth movement
    camera.inertia = 0.9;
    camera.angularSensibility = 2000;
    
    return camera;
  }

  function createAtmosphericLighting(scene: Scene) {
    // Initial sun vector (will be updated each frame)
  const sunLight = new DirectionalLight("sunLight", new Vector3(0.5, -1, 0.2), scene);
  sunLight.intensity = 0.65;
    sunLight.diffuse = new Color3(1, 0.97, 0.85);
    sunLight.specular = new Color3(1, 1, 0.95);

    const ambientLight = new HemisphericLight("ambientLight", new Vector3(0, 1, 0), scene);
    ambientLight.intensity = 0.35;
    ambientLight.diffuse = new Color3(0.6, 0.75, 1);
    ambientLight.groundColor = new Color3(0.2, 0.2, 0.25);

    return { directionalLight: sunLight, ambientLight };
  }

  function createSkyDome(scene: Scene): Mesh {
    const skyDome = MeshBuilder.CreateSphere("skyDome", { diameter: 30_000_000, segments: 64 }, scene);
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
    const starSphere = MeshBuilder.CreateSphere("starfield", { diameter: 200_000_000, segments: 16 }, scene);
    const starMaterial = new StandardMaterial("starMat", scene);
    starMaterial.backFaceCulling = false;
    starMaterial.emissiveColor = new Color3(1,1,1);
    starMaterial.diffuseTexture = generateProceduralStarfieldTexture(scene);
  const starsMilky8k = (starsMilky8kRaw as any)?.src || (starsMilky8kRaw as any);
  const stars8k = (stars8kRaw as any)?.src || (stars8kRaw as any);
  const starUrl = (typeof starsMilky8k === 'string' ? starsMilky8k : '/maps/8k_stars_milky_way.jpg') || (typeof stars8k === 'string' ? stars8k : '/maps/8k_stars.jpg');
  try { const tex = new Texture(starUrl, scene, undefined, false, Texture.TRILINEAR_SAMPLINGMODE, () => { starMaterial.diffuseTexture = tex; console.info("Starfield: high-res star map applied", starUrl); }); } catch { /* keep procedural */ }
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
  sunLight.intensity = Math.max(0.05, elevation > 0 ? 0.9 * elevation : 0.1);
  }

  function createEarthSphere(scene: Scene): Mesh {
    const earth = MeshBuilder.CreateSphere("earth", { diameter: 12_756_274, segments: 128 }, scene);
    // Use StandardMaterial for simpler diagnostics (diffuse + emissive night blending)
    const earthMat = new StandardMaterial("earthMat", scene);
    earthMat.diffuseColor = new Color3(0.15,0.25,0.35); // interim tint before texture loads
    earthMat.specularColor = new Color3(0.05,0.05,0.05);
    earthMat.emissiveColor = Color3.Black();
    const procedural = generateProceduralEarthTexture(scene);
    earthMat.diffuseTexture = procedural; originalEarthTextureRef.current = procedural;
    const dayMap8k = (dayMap8kRaw as any)?.src || (dayMap8kRaw as any);
    const dayMap2k = (dayMap2kRaw as any)?.src || (dayMap2kRaw as any);
    const nightMap8k = (nightMap8kRaw as any)?.src || (nightMap8kRaw as any);
    const nightMap2k = (nightMap2kRaw as any)?.src || (nightMap2kRaw as any);
    const dayUrl = (typeof dayMap8k === 'string' ? dayMap8k : '/maps/8k_earth_daymap.jpg') || (typeof dayMap2k === 'string' ? dayMap2k : '/maps/2k_earth_daymap.jpg');
    const nightUrl = (typeof nightMap8k === 'string' ? nightMap8k : '/maps/8k_earth_nightmap.jpg') || (typeof nightMap2k === 'string' ? nightMap2k : '/maps/2k_earth_nightmap.jpg');
    console.info("Earth texture requested", { dayUrl });
    const dayTex = new Texture(dayUrl, scene, undefined, false, Texture.TRILINEAR_SAMPLINGMODE,
      () => {
        earthMat.diffuseTexture = dayTex;
        earthMat.diffuseColor = Color3.White();
        originalEarthTextureRef.current = dayTex;
        console.info("Earth: high-res day map applied", dayUrl);
      },
      (err) => {
        console.warn("Earth day map failed, retaining procedural diffuse", { dayUrl, err });
      }
    );
    let nightTex: Texture | null = null;
    try { nightTex = new Texture(nightUrl, scene, undefined, false, Texture.TRILINEAR_SAMPLINGMODE, () => console.info("Earth: night map loaded", nightUrl)); } catch {/* ignore */}
    earth.metadata = earth.metadata || {};
    earth.metadata.nightTex = nightTex;
    earth.material = earthMat;
    earth.receiveShadows = true;
    // Rotate Earth so texture orientation matches expected view (Y rotate 180°)
    earth.rotation.y = Math.PI;
    return earth;
  }

  function initializeProgressiveImagery(scene: Scene, earth: Mesh) {
    const token = (import.meta as any).env?.VITE_CESIUM_API || (import.meta as any).env?.CESIUM_API; // support legacy key
    if (!token) {
      console.warn("Cesium Ion token (VITE_CESIUM_API) not set. Add VITE_CESIUM_API=YOUR_TOKEN to .env.");
      return;
    }
    try {
      imageryManagerRef.current = new CesiumImageryManager(scene, { token, assetId: 2, maxLevel: 5 });
      earth.metadata = earth.metadata || {};
      earth.metadata.cesiumApplied = true;
      console.info("Cesium progressive imagery initialized.");
    } catch (e) {
      console.error("Failed to initialize Cesium imagery manager", e);
    }
  }

  function createTerrainPatches(scene: Scene): Mesh[] {
    const patches: Mesh[] = [];
  const patchSize = 200000; // scaled for meter-based Earth
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

  // Legacy updateHUD removed; geodetic controller supplies authoritative lat/lon/alt.

  // Procedural fallback textures
  function generateProceduralStarfieldTexture(scene: Scene): DynamicTexture {
    const size = 2048;
    const dt = new DynamicTexture("starfieldProcedural", { width: size, height: size }, scene, false);
    const ctx = dt.getContext();
    if (!ctx) return dt;
    ctx.fillStyle = "#000"; ctx.fillRect(0,0,size,size);
    for (let i = 0; i < 10000; i++) {
      const x = Math.random()*size; const y = Math.random()*size; const b = 180+Math.random()*75; const r = Math.random()*1.2+0.2;
      ctx.fillStyle = `rgb(${b},${b},${b})`; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    }
    dt.update(false); return dt;
  }
  function generateProceduralEarthTexture(scene: Scene): DynamicTexture {
    const width = 1024, height = 512; const dt = new DynamicTexture("earthProcedural", { width, height }, scene, false); const ctx = dt.getContext();
    if (!ctx) return dt;
    ctx.fillStyle = "#0a2f5d"; ctx.fillRect(0,0,width,height);
  for (let i=0;i<5000;i++){ const x=Math.random()*width; const y=Math.random()*height; const w=20+Math.random()*80; const h=w*(0.4+Math.random()*0.6); ctx.fillStyle = `hsl(${60+Math.random()*30} ${40+Math.random()*30}% ${30+Math.random()*20}%)`; ctx.beginPath(); (ctx as any).ellipse(x,y,w,h,Math.random()*Math.PI,0,Math.PI*2); ctx.fill(); }
    dt.update(false); return dt;
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
    meshes.forEach(m => shadowGenerator.addShadowCaster(m));
    // Store on scene for later disposal if needed
    (scene as any)._shadowGen = shadowGenerator;
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
    if (!scene.meshes.find(m => m.name === '__debugAxesCenter')) {
      createDebugAxes(scene, 1_000_000);
    }
  }

  function createDebugAxes(scene: Scene, size: number) {
    const addAxis = (name: string, dir: Vector3, color: Color3) => {
      const cyl = MeshBuilder.CreateCylinder(name, { height: size, diameter: size * 0.01 }, scene);
      const mat = new StandardMaterial(name + 'Mat', scene); mat.emissiveColor = color; mat.disableLighting = true; cyl.material = mat;
      cyl.position = dir.scale(size / 2);
      if (dir.x === 1) cyl.rotation.z = Math.PI / 2; else if (dir.z === 1) cyl.rotation.x = Math.PI / 2;
      cyl.isPickable = false;
    };
    addAxis('__axisX', new Vector3(1,0,0), new Color3(1,0,0));
    addAxis('__axisY', new Vector3(0,1,0), new Color3(0,1,0));
    addAxis('__axisZ', new Vector3(0,0,1), new Color3(0,0,1));
    const center = MeshBuilder.CreateSphere('__debugAxesCenter', { diameter: size * 0.04 }, scene);
    const cmat = new StandardMaterial('__debugAxesCenterMat', scene); cmat.emissiveColor = new Color3(1,1,1); cmat.disableLighting = true; center.material = cmat;
    center.isPickable = false;
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
          <p className="text-xs opacity-70">{debugStats.meshes} meshes | dist {(debugStats.cameraDist/1000).toFixed(1)} km</p>
        </div>
        
        <div className="bg-black bg-opacity-50 text-white p-2 rounded text-sm">
          Lon: {currentLocation.x.toFixed(2)}°  Alt: {currentLocation.y.toFixed(0)} m  Lat: {currentLocation.z.toFixed(2)}°
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