"use client";

import { useState } from "react";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

interface NavigationControlsProps {
  onFlyTo: (position: Vector3, target?: Vector3) => void;
  onSearch: (query: string) => void;
  currentLocation?: { latitude: number; longitude: number; altitude: number };
}

export function NavigationControls({ 
  onFlyTo, 
  onSearch, 
  currentLocation 
}: NavigationControlsProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showQuickLocations, setShowQuickLocations] = useState(false);

  // Predefined interesting locations
  const quickLocations = [
    {
      name: "New York City",
      position: new Vector3(-8238310, 1000, 4969803), // Approximate WebMercator coordinates
      target: new Vector3(-8238310, 0, 4969803)
    },
    {
      name: "London",
      position: new Vector3(-14245, 1000, 6711665),
      target: new Vector3(-14245, 0, 6711665)
    },
    {
      name: "Tokyo",
      position: new Vector3(15496570, 1000, 4262000),
      target: new Vector3(15496570, 0, 4262000)
    },
    {
      name: "Paris",
      position: new Vector3(261272, 1000, 6248490),
      target: new Vector3(261272, 0, 6248490)
    },
    {
      name: "Sydney",
      position: new Vector3(16787310, 1000, -4016320),
      target: new Vector3(16787310, 0, -4016320)
    },
    {
      name: "Mountain View",
      position: new Vector3(-13627000, 1000, 4545000),
      target: new Vector3(-13627000, 0, 4545000)
    }
  ];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onSearch(searchQuery.trim());
    }
  };

  const handleQuickLocation = (location: typeof quickLocations[0]) => {
    onFlyTo(location.position, location.target);
    setShowQuickLocations(false);
  };

  const getAltitudeLevel = (altitude: number) => {
    if (altitude < 100) return "Street Level";
    if (altitude < 1000) return "Building Level";
    if (altitude < 10000) return "City Level";
    if (altitude < 50000) return "Regional Level";
    return "Country Level";
  };

  return (
    <div className="absolute top-4 left-4 z-10 space-y-3">
      {/* Search Bar */}
      <div className="bg-black bg-opacity-90 backdrop-blur-sm rounded-lg shadow-lg">
        <form onSubmit={handleSearch} className="flex">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for a place..."
            className="flex-1 px-4 py-3 bg-transparent text-white placeholder-gray-400 border-none outline-none rounded-l-lg"
          />
          <button
            type="submit"
            className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-r-lg transition-colors"
          >
            🔍
          </button>
        </form>
      </div>

      {/* Quick Locations */}
      <div className="bg-black bg-opacity-90 backdrop-blur-sm text-white rounded-lg shadow-lg">
        <button
          onClick={() => setShowQuickLocations(!showQuickLocations)}
          className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-gray-800 rounded-lg transition-colors"
        >
          <span className="font-medium">Quick Locations</span>
          <span className={`transform transition-transform ${showQuickLocations ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </button>
        
        {showQuickLocations && (
          <div className="border-t border-gray-600">
            {quickLocations.map((location, index) => (
              <button
                key={index}
                onClick={() => handleQuickLocation(location)}
                className="w-full px-4 py-2 text-left hover:bg-gray-800 transition-colors text-sm"
              >
                {location.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Navigation Info */}
      <div className="bg-black bg-opacity-90 backdrop-blur-sm text-white p-4 rounded-lg shadow-lg">
        <h3 className="font-bold mb-2">Navigation</h3>
        <div className="space-y-1 text-sm">
          <div><span className="text-gray-400">WASD:</span> Move camera</div>
          <div><span className="text-gray-400">Mouse:</span> Look around</div>
          <div><span className="text-gray-400">Scroll:</span> Zoom in/out</div>
          <div><span className="text-gray-400">Q/E:</span> Up/Down</div>
          <div><span className="text-gray-400">Shift:</span> Fast mode</div>
          <div><span className="text-gray-400">Ctrl:</span> Slow mode</div>
        </div>
        
        {currentLocation && (
          <div className="mt-3 pt-3 border-t border-gray-600 space-y-1 text-sm">
            <div className="font-medium text-blue-400">
              {getAltitudeLevel(currentLocation.altitude)}
            </div>
            <div>
              <span className="text-gray-400">Altitude:</span> {Math.round(currentLocation.altitude)}m
            </div>
            <div>
              <span className="text-gray-400">Coordinates:</span>
            </div>
            <div className="text-xs text-gray-500 font-mono">
              {currentLocation.latitude.toFixed(6)}, {currentLocation.longitude.toFixed(6)}
            </div>
          </div>
        )}
      </div>

      {/* Camera Controls */}
      <div className="bg-black bg-opacity-90 backdrop-blur-sm text-white rounded-lg shadow-lg">
        <div className="p-3">
          <h4 className="font-medium mb-3">Camera Controls</h4>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => onFlyTo(new Vector3(0, 50000, -50000), Vector3.Zero())}
              className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
              title="Global view"
            >
              🌍
            </button>
            <button
              onClick={() => currentLocation && onFlyTo(
                new Vector3(
                  currentLocation.longitude * 111320,
                  5000,
                  currentLocation.latitude * 111320
                )
              )}
              className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
              title="City view"
            >
              🏙️
            </button>
            <button
              onClick={() => currentLocation && onFlyTo(
                new Vector3(
                  currentLocation.longitude * 111320,
                  100,
                  currentLocation.latitude * 111320
                )
              )}
              className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
              title="Street view"
            >
              🚶
            </button>
          </div>
        </div>
      </div>

      {/* Performance Info */}
      <div className="bg-black bg-opacity-90 backdrop-blur-sm text-white p-3 rounded-lg shadow-lg">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Performance</span>
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-xs text-gray-400">Streaming</span>
          </div>
        </div>
      </div>
    </div>
  );
}