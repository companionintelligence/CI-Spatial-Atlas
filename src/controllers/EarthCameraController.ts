import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Tools } from "@babylonjs/core/Misc/tools";
import { Observable } from "@babylonjs/core/Misc/observable";

export interface EarthCameraConfig {
  minAltitude: number;
  maxAltitude: number;
  defaultSpeed: number;
  speedMultiplier: number;
  smoothing: number;
  tiltLimits: { min: number; max: number };
}

export class EarthCameraController {
  private camera: UniversalCamera;
  private scene: Scene;
  private config: EarthCameraConfig;
  private targetPosition: Vector3;
  private currentVelocity: Vector3 = Vector3.Zero();
  private isTransitioning = false;

  // Observables for camera events
  public onPositionChangedObservable = new Observable<Vector3>();
  public onAltitudeChangedObservable = new Observable<number>();

  constructor(camera: UniversalCamera, scene: Scene, config?: Partial<EarthCameraConfig>) {
    this.camera = camera;
    this.scene = scene;
    this.targetPosition = camera.position.clone();
    
    this.config = {
      minAltitude: 10,
      maxAltitude: 100000,
      defaultSpeed: 100,
      speedMultiplier: 1,
      smoothing: 0.9,
      tiltLimits: { min: -Math.PI / 3, max: Math.PI / 3 },
      ...config
    };

    this.setupControls();
  }

  private setupControls(): void {
    // Override default camera movement for Earth-style navigation
    this.camera.speed = this.config.defaultSpeed;
    this.camera.inertia = this.config.smoothing;
    
    // Disable default key controls, we'll implement custom ones
    this.camera.keysUp = [];
    this.camera.keysDown = [];
    this.camera.keysLeft = [];
    this.camera.keysRight = [];

    // Custom movement handling
    this.scene.registerBeforeRender(() => {
      this.updateMovement();
      this.enforceConstraints();
      this.updateCameraSpeed();
    });

    // Handle keyboard input
    this.setupKeyboardControls();
    
    // Handle mouse input for smoother Earth navigation
    this.setupMouseControls();
  }

  private setupKeyboardControls(): void {
    const keys: { [key: string]: boolean } = {};

    window.addEventListener('keydown', (event) => {
      keys[event.code] = true;
    });

    window.addEventListener('keyup', (event) => {
      keys[event.code] = false;
    });

    // Update movement based on pressed keys
    this.scene.registerBeforeRender(() => {
      const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;
      const speed = this.getCurrentSpeed();
      
      let forward = 0;
      let right = 0;
      let up = 0;

      // Movement keys
      if (keys['KeyW'] || keys['ArrowUp']) forward = 1;
      if (keys['KeyS'] || keys['ArrowDown']) forward = -1;
      if (keys['KeyA'] || keys['ArrowLeft']) right = -1;
      if (keys['KeyD'] || keys['ArrowRight']) right = 1;
      if (keys['KeyQ'] || keys['Space']) up = 1;
      if (keys['KeyE'] || keys['ShiftLeft']) up = -1;

      // Apply movement
      if (forward !== 0 || right !== 0 || up !== 0) {
        this.moveCamera(forward, right, up, speed * deltaTime);
      }

      // Speed modifiers
      if (keys['ShiftLeft']) {
        this.config.speedMultiplier = 3;
      } else if (keys['ControlLeft']) {
        this.config.speedMultiplier = 0.1;
      } else {
        this.config.speedMultiplier = 1;
      }
    });
  }

  private setupMouseControls(): void {
    // Enhanced mouse sensitivity based on altitude
    this.scene.registerBeforeRender(() => {
      const altitude = this.getAltitude();
      const altitudeRatio = Math.log(altitude + 1) / Math.log(this.config.maxAltitude);
      this.camera.angularSensibility = 2000 * (1 + altitudeRatio * 2);
    });
  }

  private moveCamera(forward: number, right: number, up: number, speed: number): void {
    const cameraMatrix = this.camera.getWorldMatrix();
    
    // Get camera directions
    const forwardVector = Vector3.TransformNormal(Vector3.Forward(), cameraMatrix).normalize();
    const rightVector = Vector3.TransformNormal(Vector3.Right(), cameraMatrix).normalize();
    const upVector = Vector3.Up(); // Always use world up for vertical movement

    // Calculate movement vector
    const movement = forwardVector.scale(forward * speed)
      .add(rightVector.scale(right * speed))
      .add(upVector.scale(up * speed));

    // Apply movement with smoothing
    this.targetPosition.addInPlace(movement);
    
    // Smooth interpolation to target position
    this.camera.position = Vector3.Lerp(
      this.camera.position,
      this.targetPosition,
      1 - this.config.smoothing
    );

    this.onPositionChangedObservable.notifyObservers(this.camera.position);
  }

  private updateMovement(): void {
    // Ensure target position stays in sync if camera is moved externally
    if (!this.isTransitioning) {
      this.targetPosition = this.camera.position.clone();
    }
  }

  private enforceConstraints(): void {
    const altitude = this.getAltitude();
    
    // Enforce altitude limits
    if (altitude < this.config.minAltitude) {
      this.camera.position.y = this.config.minAltitude;
      this.targetPosition.y = this.config.minAltitude;
    } else if (altitude > this.config.maxAltitude) {
      this.camera.position.y = this.config.maxAltitude;
      this.targetPosition.y = this.config.maxAltitude;
    }

    // Enforce tilt limits
    const rotation = this.camera.rotation;
    if (rotation.x < this.config.tiltLimits.min) {
      this.camera.rotation.x = this.config.tiltLimits.min;
    } else if (rotation.x > this.config.tiltLimits.max) {
      this.camera.rotation.x = this.config.tiltLimits.max;
    }

    // Notify altitude changes
    this.onAltitudeChangedObservable.notifyObservers(altitude);
  }

  private updateCameraSpeed(): void {
    // Adjust camera speed based on altitude for more intuitive navigation
    const altitude = this.getAltitude();
    const altitudeRatio = altitude / this.config.maxAltitude;
    this.camera.speed = this.config.defaultSpeed * (1 + altitudeRatio * 10) * this.config.speedMultiplier;
  }

  private getCurrentSpeed(): number {
    return this.camera.speed;
  }

  /**
   * Get current altitude above ground
   */
  public getAltitude(): number {
    return Math.max(0, this.camera.position.y);
  }

  /**
   * Smoothly transition to a new position
   */
  public flyTo(position: Vector3, target?: Vector3, duration: number = 2000): Promise<void> {
    return new Promise((resolve) => {
      this.isTransitioning = true;
      const startPosition = this.camera.position.clone();
      const startTarget = this.camera.getTarget().clone();
      const endTarget = target || this.camera.getTarget();
      
      const startTime = Date.now();
      
      const animateCamera = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Use easing function for smooth transition
        const easedProgress = this.easeInOutCubic(progress);
        
        // Interpolate position
        this.camera.position = Vector3.Lerp(startPosition, position, easedProgress);
        this.targetPosition = this.camera.position.clone();
        
        // Interpolate target
        this.camera.setTarget(Vector3.Lerp(startTarget, endTarget, easedProgress));
        
        if (progress < 1) {
          requestAnimationFrame(animateCamera);
        } else {
          this.isTransitioning = false;
          resolve();
        }
      };
      
      animateCamera();
    });
  }

  /**
   * Look at a specific point on Earth
   */
  public lookAt(target: Vector3): void {
    this.camera.setTarget(target);
  }

  /**
   * Set camera to orbit around a point
   */
  public orbitAround(center: Vector3, radius: number, speed: number = 0.01): void {
    let angle = 0;
    
    const orbitAnimation = () => {
      angle += speed;
      const x = center.x + Math.cos(angle) * radius;
      const z = center.z + Math.sin(angle) * radius;
      const y = this.camera.position.y;
      
      this.camera.position = new Vector3(x, y, z);
      this.camera.setTarget(center);
      this.targetPosition = this.camera.position.clone();
    };
    
    this.scene.registerBeforeRender(orbitAnimation);
  }

  /**
   * Get geographic coordinates (simplified)
   */
  public getGeographicCoordinates(): { latitude: number; longitude: number; altitude: number } {
    const position = this.camera.position;
    
    // Simple conversion (in a real app, you'd use proper projection)
    const latitude = (position.z / 111320) * (180 / Math.PI); // Approximate meters to degrees
    const longitude = (position.x / (111320 * Math.cos(latitude * Math.PI / 180))) * (180 / Math.PI);
    const altitude = position.y;
    
    return { latitude, longitude, altitude };
  }

  /**
   * Set position from geographic coordinates
   */
  public setGeographicPosition(latitude: number, longitude: number, altitude: number): void {
    // Simple conversion (in a real app, you'd use proper projection)
    const x = longitude * (Math.PI / 180) * 111320 * Math.cos(latitude * Math.PI / 180);
    const z = latitude * (Math.PI / 180) * 111320;
    const y = altitude;
    
    this.camera.position = new Vector3(x, y, z);
    this.targetPosition = this.camera.position.clone();
  }

  /**
   * Easing function for smooth animations
   */
  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
  }

  /**
   * Get current view bounds for tile loading
   */
  public getViewBounds(): { min: Vector3; max: Vector3; distance: number } {
    const position = this.camera.position;
    const altitude = this.getAltitude();
    
    // Calculate view distance based on altitude and FOV
    const viewDistance = altitude * 2; // Simplified calculation
    
    return {
      min: new Vector3(
        position.x - viewDistance,
        0,
        position.z - viewDistance
      ),
      max: new Vector3(
        position.x + viewDistance,
        altitude * 2,
        position.z + viewDistance
      ),
      distance: viewDistance
    };
  }

  /**
   * Dispose controller
   */
  public dispose(): void {
    this.onPositionChangedObservable.clear();
    this.onAltitudeChangedObservable.clear();
  }
}