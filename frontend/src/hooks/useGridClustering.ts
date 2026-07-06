import { useMemo } from "react";
import L from "leaflet";
import { ClusterPoint } from "../components/ClusterMarker";
import { MediaLocation } from "../types";

// The size of our grid cells in pixels. A larger value means more clustering.
const CELL_SIZE_PIXELS = 80;
const MAX_CLUSTERING_ZOOM = 18;

export function useGridClustering({
  locations,
  map,
  zoom,
}: {
  locations: MediaLocation[];
  map: L.Map | null;
  zoom: number | null;
}): ClusterPoint[] {
  return useMemo(() => {
    // Cannot cluster without a map instance, a known zoom level, or locations
    if (!map || zoom == null || !locations || locations.length === 0) {
      return [];
    }

    if (zoom >= MAX_CLUSTERING_ZOOM) {
      // Return each location as a single-point "cluster"
      return locations.map((loc) => ({
        id: `point-${loc.id}`,
        count: 1,
        lat: loc.latitude,
        lon: loc.longitude,
        baseId: loc.id,
        thumbnail: loc.thumbnail,
        bounds: L.latLngBounds([L.latLng(loc.latitude, loc.longitude)]),
      }));
    }
    const grid: Record<string, MediaLocation[]> = {};

    // 1. Assign each location to a grid cell
    for (const loc of locations) {
      const latLng = L.latLng(loc.latitude, loc.longitude);

      // Convert lat/lon to a pixel coordinate at the current zoom level
      const point = map.project(latLng, zoom);

      // "Snap" the pixel coordinate to our grid to get the cell's ID
      const gridKey = `${Math.floor(point.x / CELL_SIZE_PIXELS)}-${Math.floor(
        point.y / CELL_SIZE_PIXELS
      )}`;

      // Add the location to the corresponding grid cell
      if (!grid[gridKey]) {
        grid[gridKey] = [];
      }
      grid[gridKey].push(loc);
    }

    const result: ClusterPoint[] = [];

    // 2. Process each grid cell to create either a single marker or a cluster
    for (const gridKey in grid) {
      const group = grid[gridKey];
      const count = group.length;

      const representativePoint = group[0];

      if (count === 1) {
        // This cell has only one point, so render a single marker
        result.push({
          id: `point-${representativePoint.id}`,
          count: 1,
          lat: representativePoint.latitude,
          lon: representativePoint.longitude,
          baseId: representativePoint.id,
          thumbnail: representativePoint.thumbnail,
          bounds: L.latLngBounds([
            L.latLng(
              representativePoint.latitude,
              representativePoint.longitude
            ),
          ]),
        });
      } else {
        // This cell has multiple points, so create a cluster
        let sumLat = 0;
        let sumLon = 0;
        const latLngs: L.LatLng[] = [];

        group.forEach((p) => {
          sumLat += p.latitude;
          sumLon += p.longitude;
          latLngs.push(L.latLng(p.latitude, p.longitude));
        });

        result.push({
          id: `cluster-${representativePoint.id}`,
          count: count,
          lat: sumLat / count, // Average position for the cluster center
          lon: sumLon / count,
          thumbnail: representativePoint.thumbnail,
          baseId: representativePoint.id,
          bounds: L.latLngBounds(latLngs), // The bounds of all points in the cluster
        });
      }
    }

    return result;
  }, [locations, map, zoom]); // Re-run clustering when locations, the map instance, or zoom change
}
