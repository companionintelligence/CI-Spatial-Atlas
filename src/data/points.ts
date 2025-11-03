import * as Cesium from 'cesium';

export interface TimedPointSample {
  time: string; // ISO timestamp
  lon: number;
  lat: number;
  height?: number;
}

export interface TimedPointTrack {
  id: string;
  samples: TimedPointSample[];
  color?: string; // hex string e.g. #ff8800
  meta?: Record<string, any>;
}

// Example tracks: two moving points over 5 minutes
export const tracks: TimedPointTrack[] = [
  {
    id: 'alpha',
  color: '#00ffff',
    samples: generateLinearSamples({
      startISO: new Date().toISOString(),
      minutes: 5,
      startLon: -122.4194,
      startLat: 37.7749,
      dLon: 0.01,
      dLat: 0.005
    })
  },
  {
    id: 'bravo',
  color: '#ffa500',
    samples: generateLinearSamples({
      startISO: new Date().toISOString(),
      minutes: 5,
      startLon: -122.45,
      startLat: 37.78,
      dLon: 0.008,
      dLat: -0.004
    })
  }
];

interface LinearGenConfig {
  startISO: string;
  minutes: number;
  startLon: number;
  startLat: number;
  dLon: number;
  dLat: number;
}

function generateLinearSamples(cfg: LinearGenConfig): TimedPointSample[] {
  const start = Cesium.JulianDate.fromDate(new Date(cfg.startISO));
  return Array.from({ length: cfg.minutes + 1 }, (_, i) => {
    const t = Cesium.JulianDate.addMinutes(start, i, new Cesium.JulianDate());
    return {
      time: Cesium.JulianDate.toIso8601(t),
      lon: cfg.startLon + i * cfg.dLon,
      lat: cfg.startLat + i * cfg.dLat,
      height: 0
    };
  });
}

export function buildSampledPosition(samples: TimedPointSample[]): Cesium.SampledPositionProperty {
  const property = new Cesium.SampledPositionProperty();
  for (const s of samples) {
    const time = Cesium.JulianDate.fromIso8601(s.time);
    const pos = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, s.height || 0);
    property.addSample(time, pos);
  }
  return property;
}
