import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Observable } from "@babylonjs/core/Misc/observable";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CesiumIntegration, Tile3D, TerrainTile } from "../services/CesiumIntegration";

export interface LayerConfig {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  opacity: number;
  minZoom?: number;
  maxZoom?: number;
  source?: string;
}

export enum LayerType {
  TERRAIN = "terrain",
  BUILDINGS_3D = "buildings_3d",
  SATELLITE = "satellite",
  STREETS = "streets",
  LABELS = "labels",
  WEATHER = "weather",
  CUSTOM = "custom"
}

export interface LayerChangeEvent {
  layer: LayerConfig;
  type: 'visibility' | 'opacity' | 'added' | 'removed';
}

export class LayerManager {
  private scene: Scene;
  private cesiumIntegration: CesiumIntegration;
  private layers: Map<string, LayerConfig> = new Map();
  private layerMeshes: Map<string, Mesh[]> = new Map();
  
  // Observables
  public onLayerChangedObservable = new Observable<LayerChangeEvent>();
  public onLayersUpdatedObservable = new Observable<LayerConfig[]>();

  constructor(scene: Scene) {
    this.scene = scene;
    this.cesiumIntegration = new CesiumIntegration(scene);
    this.initializeDefaultLayers();
  }

  private initializeDefaultLayers(): void {
    // Add default layers
    this.addLayer({
      id: "terrain",
      name: "Terrain",
      type: LayerType.TERRAIN,
      visible: true,
      opacity: 1.0,
      minZoom: 0,
      maxZoom: 18
    });

    this.addLayer({
      id: "buildings_3d",
      name: "3D Buildings",
      type: LayerType.BUILDINGS_3D,
      visible: true,
      opacity: 1.0,
      minZoom: 12,
      maxZoom: 20
    });

    this.addLayer({
      id: "satellite",
      name: "Satellite Imagery",
      type: LayerType.SATELLITE,
      visible: true,
      opacity: 0.8,
      minZoom: 0,
      maxZoom: 18
    });

    this.addLayer({
      id: "streets",
      name: "Streets",
      type: LayerType.STREETS,
      visible: false,
      opacity: 1.0,
      minZoom: 10,
      maxZoom: 18
    });

    this.addLayer({
      id: "labels",
      name: "Labels",
      type: LayerType.LABELS,
      visible: true,
      opacity: 1.0,
      minZoom: 8,
      maxZoom: 18
    });
  }

  /**
   * Add a new layer
   */
  public addLayer(config: LayerConfig): void {
    this.layers.set(config.id, config);
    this.layerMeshes.set(config.id, []);
    
    this.onLayerChangedObservable.notifyObservers({
      layer: config,
      type: 'added'
    });
    
    this.notifyLayersUpdated();
  }

  /**
   * Remove a layer
   */
  public removeLayer(layerId: string): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;

    // Dispose all meshes for this layer
    const meshes = this.layerMeshes.get(layerId) || [];
    meshes.forEach(mesh => mesh.dispose());
    
    this.layers.delete(layerId);
    this.layerMeshes.delete(layerId);
    
    this.onLayerChangedObservable.notifyObservers({
      layer,
      type: 'removed'
    });
    
    this.notifyLayersUpdated();
  }

  /**
   * Toggle layer visibility
   */
  public toggleLayer(layerId: string): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;

    layer.visible = !layer.visible;
    this.updateLayerVisibility(layerId, layer.visible);
    
    this.onLayerChangedObservable.notifyObservers({
      layer,
      type: 'visibility'
    });
  }

  /**
   * Set layer opacity
   */
  public setLayerOpacity(layerId: string, opacity: number): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;

    layer.opacity = Math.max(0, Math.min(1, opacity));
    this.updateLayerOpacity(layerId, layer.opacity);
    
    this.onLayerChangedObservable.notifyObservers({
      layer,
      type: 'opacity'
    });
  }

  /**
   * Update layer visibility
   */
  private updateLayerVisibility(layerId: string, visible: boolean): void {
    const meshes = this.layerMeshes.get(layerId) || [];
    meshes.forEach(mesh => {
      mesh.setEnabled(visible);
    });
  }

  /**
   * Update layer opacity
   */
  private updateLayerOpacity(layerId: string, opacity: number): void {
    const meshes = this.layerMeshes.get(layerId) || [];
    meshes.forEach(mesh => {
      if (mesh.material) {
        mesh.material.alpha = opacity;
      }
    });
  }

  /**
   * Update layers based on camera position and zoom level
   */
  public async updateLayers(cameraPosition: Vector3, zoomLevel: number): Promise<void> {
    this.layers.forEach(async (layer, layerId) => {
      if (!layer.visible) return;
      
      // Check if layer should be visible at current zoom level
      if (layer.minZoom !== undefined && zoomLevel < layer.minZoom) return;
      if (layer.maxZoom !== undefined && zoomLevel > layer.maxZoom) return;

      await this.updateLayerContent(layer, cameraPosition, zoomLevel);
    });
  }

  /**
   * Update content for a specific layer
   */
  private async updateLayerContent(layer: LayerConfig, cameraPosition: Vector3, zoomLevel: number): Promise<void> {
    const viewDistance = this.calculateViewDistance(cameraPosition.y);
    
    switch (layer.type) {
      case LayerType.TERRAIN:
        await this.updateTerrainLayer(layer, cameraPosition, viewDistance);
        break;
        
      case LayerType.BUILDINGS_3D:
        await this.update3DBuildingsLayer(layer, cameraPosition, viewDistance);
        break;
        
      case LayerType.SATELLITE:
        await this.updateSatelliteLayer(layer, cameraPosition, viewDistance);
        break;
        
      case LayerType.STREETS:
        await this.updateStreetsLayer(layer, cameraPosition, viewDistance);
        break;
        
      case LayerType.LABELS:
        await this.updateLabelsLayer(layer, cameraPosition, viewDistance);
        break;
    }
  }

  /**
   * Update terrain layer
   */
  private async updateTerrainLayer(layer: LayerConfig, cameraPosition: Vector3, viewDistance: number): Promise<void> {
    try {
      const terrainTiles = await this.cesiumIntegration.loadTerrainTiles(cameraPosition, viewDistance);
      const meshes = terrainTiles.map(tile => tile.mesh).filter(mesh => mesh !== undefined) as Mesh[];
      
      // Update layer meshes
      this.updateLayerMeshes(layer.id, meshes);
      
      // Apply layer properties
      this.updateLayerVisibility(layer.id, layer.visible);
      this.updateLayerOpacity(layer.id, layer.opacity);
      
    } catch (error) {
      console.warn(`Failed to update terrain layer:`, error);
    }
  }

  /**
   * Update 3D buildings layer
   */
  private async update3DBuildingsLayer(layer: LayerConfig, cameraPosition: Vector3, viewDistance: number): Promise<void> {
    try {
      const buildingTiles = await this.cesiumIntegration.load3DTiles(cameraPosition, viewDistance);
      const meshes = buildingTiles.map(tile => tile.mesh).filter(mesh => mesh !== undefined) as Mesh[];
      
      // Update layer meshes
      this.updateLayerMeshes(layer.id, meshes);
      
      // Apply layer properties
      this.updateLayerVisibility(layer.id, layer.visible);
      this.updateLayerOpacity(layer.id, layer.opacity);
      
    } catch (error) {
      console.warn(`Failed to update 3D buildings layer:`, error);
    }
  }

  /**
   * Update satellite imagery layer
   */
  private async updateSatelliteLayer(layer: LayerConfig, cameraPosition: Vector3, viewDistance: number): Promise<void> {
    // In a real implementation, this would load satellite tiles and apply them as textures
    // For now, we'll just ensure terrain has appropriate satellite-like textures
  }

  /**
   * Update streets layer
   */
  private async updateStreetsLayer(layer: LayerConfig, cameraPosition: Vector3, viewDistance: number): Promise<void> {
    // In a real implementation, this would load street data and render as lines/meshes
  }

  /**
   * Update labels layer
   */
  private async updateLabelsLayer(layer: LayerConfig, cameraPosition: Vector3, viewDistance: number): Promise<void> {
    // In a real implementation, this would create 3D text labels for places
  }

  /**
   * Update meshes for a specific layer
   */
  private updateLayerMeshes(layerId: string, newMeshes: Mesh[]): void {
    // Dispose old meshes
    const oldMeshes = this.layerMeshes.get(layerId) || [];
    oldMeshes.forEach(mesh => {
      if (!newMeshes.includes(mesh)) {
        mesh.dispose();
      }
    });
    
    // Store new meshes
    this.layerMeshes.set(layerId, newMeshes);
  }

  /**
   * Calculate view distance based on camera altitude
   */
  private calculateViewDistance(altitude: number): number {
    // Logarithmic scaling for view distance
    return Math.min(50000, Math.max(1000, altitude * 2));
  }

  /**
   * Calculate zoom level based on camera altitude
   */
  public calculateZoomLevel(altitude: number): number {
    // Convert altitude to typical map zoom level (0-20)
    const maxAltitude = 100000;
    const minAltitude = 10;
    
    const normalizedAltitude = Math.log(altitude) / Math.log(maxAltitude);
    return Math.max(0, Math.min(20, 20 - normalizedAltitude * 20));
  }

  /**
   * Get all layers
   */
  public getLayers(): LayerConfig[] {
    return Array.from(this.layers.values());
  }

  /**
   * Get layer by ID
   */
  public getLayer(layerId: string): LayerConfig | undefined {
    return this.layers.get(layerId);
  }

  /**
   * Get visible layers
   */
  public getVisibleLayers(): LayerConfig[] {
    return this.getLayers().filter(layer => layer.visible);
  }

  /**
   * Cleanup distant tiles and meshes
   */
  public cleanup(cameraPosition: Vector3, maxDistance: number): void {
    this.cesiumIntegration.cleanupDistantTiles(cameraPosition, maxDistance);
    
    // Also cleanup layer meshes that are too far
    this.layerMeshes.forEach((meshes: Mesh[], layerId: string) => {
      const filteredMeshes = meshes.filter((mesh: Mesh) => {
        const distance = Vector3.Distance(cameraPosition, mesh.position);
        if (distance > maxDistance) {
          mesh.dispose();
          return false;
        }
        return true;
      });
      
      this.layerMeshes.set(layerId, filteredMeshes);
    });
  }

  /**
   * Notify that layers have been updated
   */
  private notifyLayersUpdated(): void {
    this.onLayersUpdatedObservable.notifyObservers(this.getLayers());
  }

  /**
   * Dispose all resources
   */
  public dispose(): void {
    // Dispose all layer meshes
    this.layerMeshes.forEach((meshes: Mesh[]) => {
      meshes.forEach((mesh: Mesh) => mesh.dispose());
    });
    
    this.layers.clear();
    this.layerMeshes.clear();
    this.cesiumIntegration.dispose();
    
    this.onLayerChangedObservable.clear();
    this.onLayersUpdatedObservable.clear();
  }
}