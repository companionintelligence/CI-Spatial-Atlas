"use client";

import { useState, useEffect } from "react";
import { LayerConfig, LayerType } from "../managers/LayerManager";

interface LayerControlPanelProps {
  layers: LayerConfig[];
  onToggleLayer: (layerId: string) => void;
  onOpacityChange: (layerId: string, opacity: number) => void;
  currentLocation?: { latitude: number; longitude: number; altitude: number };
  zoomLevel?: number;
}

export function LayerControlPanel({
  layers,
  onToggleLayer,
  onOpacityChange,
  currentLocation,
  zoomLevel
}: LayerControlPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const getLayerIcon = (type: LayerType): string => {
    switch (type) {
      case LayerType.TERRAIN:
        return "🏔️";
      case LayerType.BUILDINGS_3D:
        return "🏢";
      case LayerType.SATELLITE:
        return "🛰️";
      case LayerType.STREETS:
        return "🛣️";
      case LayerType.LABELS:
        return "🏷️";
      case LayerType.WEATHER:
        return "🌤️";
      default:
        return "📍";
    }
  };

  const getLayersByCategory = () => {
    if (selectedCategory === "all") {
      return layers;
    }
    return layers.filter(layer => layer.type === selectedCategory);
  };

  const getUniqueCategories = () => {
    const categories = new Set(layers.map(layer => layer.type));
    return Array.from(categories);
  };

  return (
    <div className="absolute top-4 right-4 z-10 w-80">
      {/* Main Panel */}
      <div className="bg-black bg-opacity-90 backdrop-blur-sm text-white rounded-lg shadow-lg">
        {/* Header */}
        <div 
          className="flex items-center justify-between p-4 cursor-pointer border-b border-gray-600"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <h3 className="font-bold text-lg">Layers</h3>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-300">{layers.filter(l => l.visible).length}/{layers.length} visible</span>
            <span className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </div>
        </div>

        {/* Location Info */}
        {currentLocation && (
          <div className="p-3 border-b border-gray-600 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-gray-400">Lat:</span> {currentLocation.latitude.toFixed(6)}
              </div>
              <div>
                <span className="text-gray-400">Lng:</span> {currentLocation.longitude.toFixed(6)}
              </div>
              <div>
                <span className="text-gray-400">Alt:</span> {Math.round(currentLocation.altitude)}m
              </div>
              <div>
                <span className="text-gray-400">Zoom:</span> {zoomLevel?.toFixed(1)}
              </div>
            </div>
          </div>
        )}

        {/* Expanded Content */}
        {isExpanded && (
          <div className="p-4 space-y-4">
            {/* Category Filter */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedCategory("all")}
                className={`px-3 py-1 rounded text-xs transition-colors ${
                  selectedCategory === "all" 
                    ? "bg-blue-600 text-white" 
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                All
              </button>
              {getUniqueCategories().map(category => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-3 py-1 rounded text-xs transition-colors ${
                    selectedCategory === category 
                      ? "bg-blue-600 text-white" 
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  {category.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </button>
              ))}
            </div>

            {/* Layer List */}
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {getLayersByCategory().map(layer => (
                <LayerControl
                  key={layer.id}
                  layer={layer}
                  icon={getLayerIcon(layer.type)}
                  onToggle={() => onToggleLayer(layer.id)}
                  onOpacityChange={(opacity) => onOpacityChange(layer.id, opacity)}
                />
              ))}
            </div>

            {/* Quick Actions */}
            <div className="border-t border-gray-600 pt-4">
              <div className="flex space-x-2">
                <button
                  onClick={() => layers.forEach(layer => !layer.visible && onToggleLayer(layer.id))}
                  className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 rounded text-sm transition-colors"
                >
                  Show All
                </button>
                <button
                  onClick={() => layers.forEach(layer => layer.visible && onToggleLayer(layer.id))}
                  className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 rounded text-sm transition-colors"
                >
                  Hide All
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface LayerControlProps {
  layer: LayerConfig;
  icon: string;
  onToggle: () => void;
  onOpacityChange: (opacity: number) => void;
}

function LayerControl({ layer, icon, onToggle, onOpacityChange }: LayerControlProps) {
  const [showOpacity, setShowOpacity] = useState(false);

  return (
    <div className="bg-gray-800 rounded-lg p-3">
      {/* Main Layer Control */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <span className="text-lg">{icon}</span>
          <div>
            <div className="font-medium">{layer.name}</div>
            <div className="text-xs text-gray-400">
              {layer.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </div>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Opacity Button */}
          <button
            onClick={() => setShowOpacity(!showOpacity)}
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
            title="Adjust opacity"
          >
            {Math.round(layer.opacity * 100)}%
          </button>
          
          {/* Visibility Toggle */}
          <button
            onClick={onToggle}
            className={`w-12 h-6 rounded-full transition-colors relative ${
              layer.visible 
                ? "bg-blue-600" 
                : "bg-gray-600"
            }`}
            title={layer.visible ? "Hide layer" : "Show layer"}
          >
            <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${
              layer.visible ? "translate-x-7" : "translate-x-1"
            }`} />
          </button>
        </div>
      </div>

      {/* Opacity Slider */}
      {showOpacity && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <div className="flex items-center space-x-3">
            <span className="text-xs text-gray-400 w-16">Opacity:</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={layer.opacity}
              onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
              className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #4F46E5 0%, #4F46E5 ${layer.opacity * 100}%, #374151 ${layer.opacity * 100}%, #374151 100%)`
              }}
            />
            <span className="text-xs text-gray-400 w-10 text-right">
              {Math.round(layer.opacity * 100)}%
            </span>
          </div>
        </div>
      )}

      {/* Zoom Range Info */}
      {(layer.minZoom !== undefined || layer.maxZoom !== undefined) && (
        <div className="mt-2 text-xs text-gray-500">
          Zoom: {layer.minZoom ?? 0} - {layer.maxZoom ?? 20}
        </div>
      )}
    </div>
  );
}