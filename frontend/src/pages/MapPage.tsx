import { Box, useTheme } from "@mui/material";
import { useMemo } from "react";
import type { LatLngExpression, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useState } from "react";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  Link as RouterLink,
  useSearchParams,
  useLocation,
} from "react-router-dom";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";

import { ClusterMarker } from "../components/ClusterMarker";
import { useGridClustering } from "../hooks/useGridClustering";
import { getMediaLocations } from "../services/media";

export interface MediaLocation {
  id: number;
  latitude: number;
  longitude: number;
  thumbnail: string;
}

interface FocusLocation {
  latitude: number;
  longitude: number;
  zoom?: number;
}

function MapController({
  onLocationsChange,
  onMapChange,
  focus,
}: {
  onLocationsChange: (locs: MediaLocation[]) => void;
  onMapChange: (map: L.Map) => void;
  focus?: FocusLocation;
}) {
  const map = useMap();

  useEffect(() => {
    onMapChange(map);
    fetchLocationsForView();
  }, [map, onMapChange]);

  const fetchLocationsForView = useCallback(() => {
    const bounds = map.getBounds();
    getMediaLocations(
      bounds.getNorth(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getWest()
    )
      .then(onLocationsChange)
      .catch(console.error);
  }, [map, onLocationsChange]);

  useMapEvents({
    load: () => {
      if (!focus) {
        fetchLocationsForView();
      }
    },
    moveend: fetchLocationsForView,
    zoomend: fetchLocationsForView,
  });

  return null;
}

export default function MapPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [locations, setLocations] = useState<MediaLocation[]>([]);
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);
  const theme = useTheme();

  const focus = useMemo((): FocusLocation | undefined => {
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");

    if (lat && lng) {
      const zoom = searchParams.get("zoom");
      return {
        latitude: parseFloat(lat),
        longitude: parseFloat(lng),
        zoom: zoom ? parseInt(zoom, 10) : 15,
      };
    }
    return undefined;
  }, [searchParams]);

  useEffect(() => {
    if (mapInstance && focus) {
      mapInstance.flyTo([focus.latitude, focus.longitude], focus.zoom);
    }
  }, [mapInstance, focus]);

  // Our custom hook processes the raw locations into clusters
  const clusters = useGridClustering({ locations, map: mapInstance });

  const initialCenter: LatLngExpression = focus
    ? [focus.latitude, focus.longitude]
    : [20, 0]; // Default center
  const initialZoom = focus ? focus.zoom : 2; // Default zoom

  return (
    <Box sx={{ height: "calc(100vh - 64px)", width: "100%" }}>
      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        scrollWheelZoom
        style={{
          height: "100%",
          width: "100%",
          backgroundColor: theme.palette.background.default,
        }}
      >
        <TileLayer
          url={
            theme.palette.mode === "dark"
              ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          }
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />

        <MapController
          onLocationsChange={setLocations}
          onMapChange={setMapInstance}
          focus={focus}
        />

        {clusters.map((point) => {
          if (point.count > 1) {
            return <ClusterMarker key={point.id} cluster={point} />;
          }
          return (
            <Marker key={point.id} position={[point.lat, point.lon]}>
              <Popup>
                <RouterLink
                  to={`/medium/${point.baseId}`}
                  state={{ backgroundLocation: location }}
                >
                  <Box
                    component="img"
                    src={`${API}/thumbnails/${encodeFilePath(point.thumbnail)}`}
                    alt=""
                    sx={{
                      width: 96,
                      height: 96,
                      objectFit: "cover",
                      borderRadius: 1,
                    }}
                  />
                </RouterLink>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </Box>
  );
}
