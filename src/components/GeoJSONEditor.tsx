import { useState } from "react";

export interface GeoJSONFeature {
  id: string;
  type: "Feature";
  geometry: {
    type: "Point" | "LineString" | "Polygon";
    coordinates: number[] | number[][] | number[][][];
  };
  properties: {
    name: string;
    description?: string;
    timestamp: number;
    altitude?: number;
    [key: string]: any;
  };
}

export interface GeoJSONCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

interface GeoJSONEditorProps {
  features: GeoJSONFeature[];
  onFeaturesChange: (features: GeoJSONFeature[]) => void;
  onFeatureSelect?: (feature: GeoJSONFeature | null) => void;
  selectedFeatureId?: string | null;
}

export function GeoJSONEditor({
  features,
  onFeaturesChange,
  onFeatureSelect,
  selectedFeatureId
}: GeoJSONEditorProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [editingFeature, setEditingFeature] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const handleDeleteFeature = (id: string) => {
    onFeaturesChange(features.filter(f => f.id !== id));
    if (selectedFeatureId === id) {
      onFeatureSelect?.(null);
    }
  };

  const handleStartEdit = (feature: GeoJSONFeature) => {
    setEditingFeature(feature.id);
    setEditName(feature.properties.name);
    setEditDescription(feature.properties.description || "");
  };

  const handleSaveEdit = () => {
    if (!editingFeature) return;
    
    const updatedFeatures = features.map(f => {
      if (f.id === editingFeature) {
        return {
          ...f,
          properties: {
            ...f.properties,
            name: editName,
            description: editDescription
          }
        };
      }
      return f;
    });
    
    onFeaturesChange(updatedFeatures);
    setEditingFeature(null);
  };

  const handleCancelEdit = () => {
    setEditingFeature(null);
    setEditName("");
    setEditDescription("");
  };

  const handleExportGeoJSON = () => {
    const collection: GeoJSONCollection = {
      type: "FeatureCollection",
      features
    };
    
    const blob = new Blob([JSON.stringify(collection, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `map-features-${Date.now()}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportGeoJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content) as GeoJSONCollection;
        
        if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
          // Ensure all features have required properties
          const validFeatures = parsed.features.map((f, idx) => ({
            ...f,
            id: f.id || `imported-${Date.now()}-${idx}`,
            properties: {
              name: f.properties?.name || `Imported Point ${idx + 1}`,
              timestamp: f.properties?.timestamp || Date.now(),
              ...f.properties
            }
          })) as GeoJSONFeature[];
          
          onFeaturesChange([...features, ...validFeatures]);
        }
      } catch (error) {
        console.error("Failed to import GeoJSON:", error);
        alert("Failed to import GeoJSON file. Please check the file format.");
      }
    };
    reader.readAsText(file);
  };

  const handleClearAll = () => {
    if (confirm(`Are you sure you want to delete all ${features.length} features?`)) {
      onFeaturesChange([]);
      onFeatureSelect?.(null);
    }
  };

  const formatCoordinates = (coords: number[] | number[][] | number[][][]): string => {
    if (Array.isArray(coords) && typeof coords[0] === "number") {
      const [lon, lat, alt] = coords as number[];
      return `[${lon.toFixed(6)}, ${lat.toFixed(6)}${alt !== undefined ? `, ${alt.toFixed(1)}` : ""}]`;
    }
    return JSON.stringify(coords);
  };

  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="absolute bottom-4 right-4 z-10 w-96 max-h-[70vh] flex flex-col">
      <div className="bg-black bg-opacity-90 backdrop-blur-sm text-white rounded-lg shadow-lg flex flex-col max-h-full">
        {/* Header */}
        <div
          className="flex items-center justify-between p-4 cursor-pointer border-b border-gray-600"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div>
            <h3 className="font-bold text-lg">GeoJSON Editor</h3>
            <p className="text-xs text-gray-400">{features.length} feature{features.length !== 1 ? 's' : ''}</p>
          </div>
          <span className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="flex flex-col overflow-hidden">
            {/* Action Buttons */}
            <div className="p-3 border-b border-gray-600 space-y-2">
              <div className="flex space-x-2">
                <button
                  onClick={handleExportGeoJSON}
                  disabled={features.length === 0}
                  className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm transition-colors"
                  title="Export as GeoJSON file"
                >
                  📥 Export
                </button>
                <label className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 rounded text-sm transition-colors text-center cursor-pointer">
                  📤 Import
                  <input
                    type="file"
                    accept=".geojson,.json"
                    onChange={handleImportGeoJSON}
                    className="hidden"
                  />
                </label>
              </div>
              <button
                onClick={handleClearAll}
                disabled={features.length === 0}
                className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm transition-colors"
              >
                🗑️ Clear All
              </button>
            </div>

            {/* Feature List */}
            <div className="overflow-y-auto flex-1 p-3 space-y-2">
              {features.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  <p className="text-sm">No features yet</p>
                  <p className="text-xs mt-2">Click on the map to add points</p>
                </div>
              ) : (
                features.map((feature) => (
                  <div
                    key={feature.id}
                    className={`bg-gray-800 rounded-lg p-3 transition-all ${
                      selectedFeatureId === feature.id ? 'ring-2 ring-blue-500' : ''
                    }`}
                  >
                    {editingFeature === feature.id ? (
                      // Edit Mode
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
                          placeholder="Feature name"
                          autoFocus
                        />
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm resize-none"
                          placeholder="Description (optional)"
                          rows={2}
                        />
                        <div className="flex space-x-2">
                          <button
                            onClick={handleSaveEdit}
                            className="flex-1 px-2 py-1 bg-green-600 hover:bg-green-700 rounded text-xs transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="flex-1 px-2 py-1 bg-gray-600 hover:bg-gray-700 rounded text-xs transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      // View Mode
                      <div>
                        <div className="flex items-start justify-between">
                          <div 
                            className="flex-1 cursor-pointer"
                            onClick={() => onFeatureSelect?.(feature)}
                          >
                            <div className="font-medium text-sm">
                              {feature.geometry.type === "Point" && "📍 "}
                              {feature.geometry.type === "LineString" && "📏 "}
                              {feature.geometry.type === "Polygon" && "⬟ "}
                              {feature.properties.name}
                            </div>
                            {feature.properties.description && (
                              <div className="text-xs text-gray-400 mt-1">
                                {feature.properties.description}
                              </div>
                            )}
                            <div className="text-xs text-gray-500 mt-1">
                              {formatTimestamp(feature.properties.timestamp)}
                            </div>
                            <div className="text-xs text-gray-500 font-mono mt-1">
                              {formatCoordinates(feature.geometry.coordinates)}
                            </div>
                          </div>
                          <div className="flex space-x-1 ml-2">
                            <button
                              onClick={() => handleStartEdit(feature)}
                              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
                              title="Edit"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeleteFeature(feature.id)}
                              className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs transition-colors"
                              title="Delete"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
