import { useState } from "react";
import { GeoJSONFeature } from "./GeoJSONEditor";

interface TimelineProps {
  features: GeoJSONFeature[];
  onFeatureSelect?: (feature: GeoJSONFeature) => void;
  onFeatureDelete?: (featureId: string) => void;
  selectedFeatureId?: string | null;
}

export function Timeline({
  features,
  onFeatureSelect,
  onFeatureDelete,
  selectedFeatureId
}: TimelineProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Sort features by timestamp
  const sortedFeatures = [...features].sort((a, b) => {
    const timeA = a.properties.timestamp;
    const timeB = b.properties.timestamp;
    return sortOrder === "desc" ? timeB - timeA : timeA - timeB;
  });

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleDateString();
  };

  const getRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  // Group features by date
  const groupedFeatures = sortedFeatures.reduce((acc, feature) => {
    const date = formatDate(feature.properties.timestamp);
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(feature);
    return acc;
  }, {} as Record<string, GeoJSONFeature[]>);

  const toggleSortOrder = () => {
    setSortOrder(sortOrder === "desc" ? "asc" : "desc");
  };

  const getGeometryIcon = (type: string): string => {
    switch (type) {
      case "Point":
        return "📍";
      case "LineString":
        return "📏";
      case "Polygon":
        return "⬟";
      default:
        return "📌";
    }
  };

  return (
    <div className="absolute bottom-4 left-4 z-10 w-80 max-h-[70vh] flex flex-col">
      <div className="bg-black bg-opacity-90 backdrop-blur-sm text-white rounded-lg shadow-lg flex flex-col max-h-full">
        {/* Header */}
        <div
          className="flex items-center justify-between p-4 cursor-pointer border-b border-gray-600"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div>
            <h3 className="font-bold text-lg">Timeline</h3>
            <p className="text-xs text-gray-400">
              {features.length} point{features.length !== 1 ? 's' : ''} recorded
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleSortOrder();
              }}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
              title={`Sort ${sortOrder === "desc" ? "oldest first" : "newest first"}`}
            >
              {sortOrder === "desc" ? "⬇️" : "⬆️"}
            </button>
            <span className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </div>
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="overflow-y-auto flex-1 p-3">
            {features.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                <p className="text-sm">No points in timeline</p>
                <p className="text-xs mt-2">Click on the map to add points</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(groupedFeatures).map(([date, dateFeatures]) => (
                  <div key={date}>
                    {/* Date Header */}
                    <div className="text-xs font-semibold text-gray-400 mb-2 sticky top-0 bg-black bg-opacity-90 py-1">
                      {date}
                    </div>

                    {/* Timeline Items */}
                    <div className="space-y-2 relative">
                      {/* Vertical Line */}
                      <div className="absolute left-[11px] top-0 bottom-0 w-0.5 bg-gray-700"></div>

                      {dateFeatures.map((feature, index) => (
                        <div
                          key={feature.id}
                          className={`relative pl-8 transition-all ${
                            selectedFeatureId === feature.id
                              ? 'transform scale-105'
                              : ''
                          }`}
                        >
                          {/* Timeline Dot */}
                          <div
                            className={`absolute left-[7px] top-2 w-3 h-3 rounded-full border-2 ${
                              selectedFeatureId === feature.id
                                ? 'bg-blue-500 border-blue-400'
                                : 'bg-gray-700 border-gray-600'
                            }`}
                          ></div>

                          {/* Content Card */}
                          <div
                            className={`bg-gray-800 rounded-lg p-3 cursor-pointer transition-all hover:bg-gray-750 ${
                              selectedFeatureId === feature.id
                                ? 'ring-2 ring-blue-500 shadow-lg'
                                : ''
                            }`}
                            onClick={() => onFeatureSelect?.(feature)}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center space-x-2">
                                  <span className="text-base">
                                    {getGeometryIcon(feature.geometry.type)}
                                  </span>
                                  <span className="text-sm font-medium">
                                    {feature.properties.name}
                                  </span>
                                </div>
                                
                                {feature.properties.description && (
                                  <div className="text-xs text-gray-400 mt-1">
                                    {feature.properties.description}
                                  </div>
                                )}

                                <div className="flex items-center space-x-3 mt-2 text-xs text-gray-500">
                                  <span>{formatTime(feature.properties.timestamp)}</span>
                                  <span>•</span>
                                  <span>{getRelativeTime(feature.properties.timestamp)}</span>
                                </div>

                                {feature.properties.altitude !== undefined && (
                                  <div className="text-xs text-gray-500 mt-1">
                                    Alt: {feature.properties.altitude.toFixed(0)}m
                                  </div>
                                )}
                              </div>

                              {onFeatureDelete && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onFeatureDelete(feature.id);
                                  }}
                                  className="ml-2 px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs transition-colors"
                                  title="Delete"
                                >
                                  🗑️
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
