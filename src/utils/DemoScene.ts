import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";

/**
 * Create a simple demo scene for Earth exploration
 */
export function createDemoScene(scene: Scene): void {
  // Create some landmark buildings for demonstration
  createLandmarks(scene);
  
  // Create terrain features
  createTerrainFeatures(scene);
}

function createLandmarks(scene: Scene): void {
  // Create simplified landmarks at real-world approximate positions
  const landmarks = [
    {
      name: "Empire State Building",
      position: new Vector3(-8238000, 381, 4969800), // Approximate WebMercator
      size: { width: 129, height: 381, depth: 61 },
      color: new Color3(0.8, 0.8, 0.9)
    },
    {
      name: "Eiffel Tower",
      position: new Vector3(261000, 324, 6248400),
      size: { width: 125, height: 324, depth: 125 },
      color: new Color3(0.6, 0.4, 0.2)
    },
    {
      name: "Tokyo Tower",
      position: new Vector3(15496000, 333, 4262000),
      size: { width: 100, height: 333, depth: 100 },
      color: new Color3(0.9, 0.2, 0.2)
    }
  ];

  landmarks.forEach(landmark => {
    const building = MeshBuilder.CreateBox(landmark.name, {
      width: landmark.size.width,
      height: landmark.size.height,
      depth: landmark.size.depth
    }, scene);

    building.position = landmark.position.clone();
    building.position.y = landmark.size.height / 2; // Position at ground level

    const material = new StandardMaterial(`${landmark.name}_material`, scene);
    material.diffuseColor = landmark.color;
    material.specularColor = new Color3(0.1, 0.1, 0.1);
    building.material = material;
  });
}

function createTerrainFeatures(scene: Scene): void {
  // Create some hills and valleys for terrain variation
  const features = [
    {
      name: "Hill1",
      position: new Vector3(5000, 0, 5000),
      size: { width: 2000, height: 500, depth: 2000 },
      color: new Color3(0.3, 0.5, 0.2)
    },
    {
      name: "Hill2",
      position: new Vector3(-3000, 0, -3000),
      size: { width: 1500, height: 300, depth: 1500 },
      color: new Color3(0.4, 0.6, 0.3)
    },
    {
      name: "Valley",
      position: new Vector3(0, -100, 8000),
      size: { width: 3000, height: 200, depth: 1000 },
      color: new Color3(0.2, 0.4, 0.6)
    }
  ];

  features.forEach(feature => {
    const terrain = MeshBuilder.CreateBox(feature.name, {
      width: feature.size.width,
      height: feature.size.height,
      depth: feature.size.depth
    }, scene);

    terrain.position = feature.position.clone();
    terrain.position.y = feature.size.height / 2;

    const material = new StandardMaterial(`${feature.name}_material`, scene);
    material.diffuseColor = feature.color;
    material.specularColor = new Color3(0.1, 0.1, 0.1);
    material.roughness = 0.8;
    terrain.material = material;
    terrain.receiveShadows = true;
  });
}