import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { altitudeSpeedScale, cartesianToGeo, clampLat, geoToCartesian, smoothStep, wrapLon } from "../utils/geodesy";

export interface GeodeticState { lat: number; lon: number; alt: number }

export class GeodeticCameraController {
  private camera: UniversalCamera;
  private scene: Scene;
  private state: GeodeticState;
  private targetState: GeodeticState;
  private flyToActive = false;
  private flyCallback?: () => void;
  private keys = { forward:false, back:false, left:false, right:false, up:false, down:false };

  constructor(camera: UniversalCamera, scene: Scene, initial?: Partial<GeodeticState>) {
    this.camera = camera; this.scene = scene;
    // derive initial geodetic from camera position
    const geo = cartesianToGeo(camera.position);
    this.state = { lat: geo.lat, lon: geo.lon, alt: Math.max(100, geo.alt) };
    this.targetState = { ...this.state, ...initial };
    this.attachInput();
    scene.onBeforeRenderObservable.add(() => this.update(scene.getEngine().getDeltaTime()/1000));
  }

  private attachInput() {
    window.addEventListener('keydown', e=> this.handleKey(e, true));
    window.addEventListener('keyup', e=> this.handleKey(e, false));
    window.addEventListener('wheel', e=> this.onWheel(e), { passive: true });
  }
  private handleKey(e: KeyboardEvent, down: boolean) {
    switch(e.key.toLowerCase()){
      case 'w': this.keys.forward = down; break;
      case 's': this.keys.back = down; break;
      case 'a': this.keys.left = down; break;
      case 'd': this.keys.right = down; break;
      case 'q': this.keys.down = down; break;
      case 'e': this.keys.up = down; break;
    }
  }
  private onWheel(e: WheelEvent){
    const factor = 1 + (e.deltaY>0?0.25:-0.25);
    this.targetState.alt = Math.max(50, this.targetState.alt * factor);
  }

  flyTo(target: GeodeticState, duration = 3, cb?: ()=>void){
    this.flyToActive = true;
    this.flyCallback = cb;
    this.targetState = { lat: clampLat(target.lat), lon: wrapLon(target.lon), alt: Math.max(50, target.alt) };
  }

  private update(dt: number){
    // Movement input in local tangent frame (lat/lon)
    const speed = altitudeSpeedScale(this.state.alt);
    const moveLat = (this.keys.forward?1:0) - (this.keys.back?1:0);
    const moveLon = (this.keys.right?1:0) - (this.keys.left?1:0);
    const ascend = (this.keys.up?1:0) - (this.keys.down?1:0);
    if (moveLat||moveLon||ascend){
      // scale movement by cos(lat) for longitude convergence
      this.targetState.lat = clampLat(this.targetState.lat + moveLat * speed * dt / 111000); // meters to degrees approx
      const lonScale = Math.max(0.00001, Math.cos(this.targetState.lat * Math.PI/180));
      this.targetState.lon = wrapLon(this.targetState.lon + moveLon * speed * dt /(111000 * lonScale));
      this.targetState.alt = Math.max(50, this.targetState.alt + ascend * speed * 0.8 * dt);
    }
    // Smooth interpolation
    this.state.lat = smoothStep(this.state.lat, this.targetState.lat, dt);
    this.state.lon = smoothStep(this.state.lon, this.targetState.lon, dt);
    this.state.alt = smoothStep(this.state.alt, this.targetState.alt, dt);
    const cart = geoToCartesian(this.state);
    this.camera.position.copyFrom(cart);
    this.camera.setTarget(Vector3.Zero());
    if (this.flyToActive && Math.abs(this.state.lat-this.targetState.lat)<0.0001 && Math.abs(this.state.lon-this.targetState.lon)<0.0001){
      this.flyToActive = false; this.flyCallback?.();
    }
  }

  getGeodetic(): GeodeticState { return { ...this.state }; }
}
