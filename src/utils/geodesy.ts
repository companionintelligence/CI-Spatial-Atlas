// Basic WGS84 geodesy helpers (sufficient for camera navigation)
// You can extend later with full ellipsoid formulas.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

// WGS84 semi-major & semi-minor axes (meters) scaled to our world units (assume 1 unit = 1 meter for now)
const WGS84_A = 6378137.0;
const WGS84_B = 6356752.314245;
const WGS84_E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);

export interface GeoCoord { lat: number; lon: number; alt: number } // degrees, degrees, meters

// Convert geodetic (lat, lon, alt) to ECEF Cartesian (x,y,z)
export function geoToCartesian({ lat, lon, alt }: GeoCoord): Vector3 {
  const radLat = (lat * Math.PI) / 180;
  const radLon = (lon * Math.PI) / 180;
  const sinLat = Math.sin(radLat);
  const cosLat = Math.cos(radLat);
  const cosLon = Math.cos(radLon);
  const sinLon = Math.sin(radLon);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat); // prime vertical radius of curvature
  const x = (N + alt) * cosLat * cosLon;
  const y = (N + alt) * cosLat * sinLon;
  const z = (N * (1 - WGS84_E2) + alt) * sinLat;
  return new Vector3(x, z, y); // map z->Y for Babylon's Y-up using (x,y,z)->(x,z,y)
}

// Convert ECEF Cartesian to geodetic using iterative Bowring formula
export function cartesianToGeo(v: Vector3): GeoCoord {
  const x = v.x;
  const y = v.z; // reverse mapping
  const z = v.y;
  const p = Math.sqrt(x * x + y * y);
  const theta = Math.atan2(z * WGS84_A, p * WGS84_B);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  const lat = Math.atan2(
    z + ( (WGS84_E2 * (WGS84_A * WGS84_A)) / (WGS84_B * WGS84_B) ) * WGS84_B * sinTheta * sinTheta * sinTheta,
    p - WGS84_E2 * WGS84_A * cosTheta * cosTheta * cosTheta
  );
  const lon = Math.atan2(y, x);
  const sinLat = Math.sin(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const alt = p / Math.cos(lat) - N;
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI, alt };
}

export function greatCircleDistance(a: GeoCoord, b: GeoCoord): number {
  const R = (WGS84_A + WGS84_B) * 0.5; // average radius
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function clampLat(lat: number) { return Math.max(-89.9999, Math.min(89.9999, lat)); }
export function wrapLon(lon: number) { let L = ((lon + 180) % 360 + 360) % 360 - 180; return L; }

// Adaptive movement speed scaling based on altitude (logarithmic)
export function altitudeSpeedScale(alt: number): number {
  // alt in meters; clamp within sensible bounds and map log10 to range (support higher orbital altitudes)
  const minAlt = 100; const maxAlt = 40_000_000;
  const a = Math.min(maxAlt, Math.max(minAlt, alt));
  const t = (Math.log10(a) - Math.log10(minAlt)) / (Math.log10(maxAlt) - Math.log10(minAlt));
  return 50 + t * 50000; // base speed + scaled component
}

// Smooth interpolation utility (critically damped-ish)
export function smoothStep(current: number, target: number, dt: number, halfLife = 0.15): number {
  const lambda = Math.log(2)/halfLife; // convert halflife to decay constant
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export const WGS84 = { A: WGS84_A, B: WGS84_B, E2: WGS84_E2 };
