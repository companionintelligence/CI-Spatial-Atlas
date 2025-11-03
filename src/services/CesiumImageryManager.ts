import * as Cesium from "cesium";
import { Scene } from "@babylonjs/core/scene";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

/**
 * Progressive Cesium imagery manager: builds a dynamic equirectangular texture for the Earth sphere
 * by sampling low → higher zoom tiles from an Ion imagery provider. Refines as altitude decreases.
 */
export class CesiumImageryManager {
  private scene: Scene;
  private ionToken?: string;
  private provider?: Cesium.IonImageryProvider;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private currentLevel = -1;
  private maxLevel: number;
  private assetId: number;
  private loading = false;
  private inited = false;
  private lastRequestTime = 0;
  private levelAltitudeThresholds: Array<{ level: number; maxAltitude: number }>; // sorted ascending level

  constructor(scene: Scene, options?: { token?: string; assetId?: number; maxLevel?: number }) {
    this.scene = scene;
    this.ionToken = options?.token;
    this.assetId = options?.assetId ?? 2; // Default Bing Aerial imagery asset
    this.maxLevel = options?.maxLevel ?? 5;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 256; // temporary until first level set
    this.canvas.height = 256;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to acquire 2D context for Cesium imagery canvas.");
    this.ctx = ctx;
    // Altitude thresholds (rough) for level selection; tune based on your scale.
    this.levelAltitudeThresholds = [
      { level: 2, maxAltitude: Infinity },
      { level: 3, maxAltitude: 300000 },
      { level: 4, maxAltitude: 100000 },
      { level: 5, maxAltitude: 30000 }
    ];
  }

  async ensureProvider() {
    if (this.inited) return;
    if (this.ionToken) Cesium.Ion.defaultAccessToken = this.ionToken;
    this.provider = await Cesium.IonImageryProvider.fromAssetId(this.assetId);
    this.inited = true;
  }

  /** Decide target tile level from camera altitude */
  private chooseLevel(altitude: number): number {
    for (let i = this.levelAltitudeThresholds.length - 1; i >= 0; i--) {
      const entry = this.levelAltitudeThresholds[i];
      if (altitude < entry.maxAltitude) return Math.min(entry.level, this.maxLevel);
    }
    return 2; // fallback
  }

  /** Public update entry: call every frame with Earth mesh + camera altitude */
  async updateEarthTexture(earth: Mesh, altitude: number) {
    await this.ensureProvider();
    if (!this.provider) return;

    const targetLevel = this.chooseLevel(altitude);
    // Avoid spamming requests: only refine if higher level desired & not currently loading
    if ((this.currentLevel === -1 || targetLevel > this.currentLevel) && !this.loading) {
      // Rate limit (e.g., 1s between refinements)
      const now = performance.now();
      if (now - this.lastRequestTime < 1000) return;
      this.lastRequestTime = now;
      this.loading = true;
      try {
        await this.buildMosaic(targetLevel);
        this.applyToEarth(earth);
        this.currentLevel = targetLevel;
      } catch (err) {
        console.warn("Cesium imagery mosaic build failed", err);
      } finally {
        this.loading = false;
      }
    }
  }

  private async buildMosaic(level: number) {
    if (!this.provider) return;
    const tileCount = 1 << level; // 2^level
    const tileSize = 256; // Cesium imagery typical tile size
    this.canvas.width = tileCount * tileSize;
    this.canvas.height = tileCount * tileSize;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const promises: Promise<void>[] = [];
    for (let y = 0; y < tileCount; y++) {
      for (let x = 0; x < tileCount; x++) {
        promises.push(this.fetchAndDrawTile(x, y, level, tileSize));
      }
    }
    // concurrency control: allow all; imagery provider handles internal queue
    await Promise.all(promises);
  }

  private async fetchAndDrawTile(x: number, y: number, level: number, tileSize: number) {
    if (!this.provider) return;
    try {
      const img = await this.provider.requestImage(x, y, level);
      if (img) {
        this.ctx.drawImage(img as CanvasImageSource, x * tileSize, y * tileSize, tileSize, tileSize);
      }
    } catch (err) {
      // Draw placeholder if tile fails
      this.ctx.fillStyle = "#222";
      this.ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
    }
  }

  private applyToEarth(earth: Mesh) {
    const mat = earth.material as PBRMaterial;
    // Reuse dynamic texture if exists
    let dyn = mat.albedoTexture as DynamicTexture | undefined;
    if (!(dyn instanceof DynamicTexture)) {
      dyn = new DynamicTexture("earthCesiumDynTex", { width: this.canvas.width, height: this.canvas.height }, this.scene, false);
      mat.albedoTexture = dyn;
    } else if (dyn.getSize().width !== this.canvas.width || dyn.getSize().height !== this.canvas.height) {
      // Recreate if size changed (level refinement)
      dyn = new DynamicTexture("earthCesiumDynTex", { width: this.canvas.width, height: this.canvas.height }, this.scene, false);
      mat.albedoTexture = dyn;
    }
    const dctx = dyn.getContext();
    dctx.drawImage(this.canvas, 0, 0);
    dyn.update(false);
  }

  dispose() {
    // Nothing special yet; dynamic texture will be GC'ed if removed.
  }
}
