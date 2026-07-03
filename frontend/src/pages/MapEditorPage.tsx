import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useInView } from "react-intersection-observer";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  Box,
  Typography,
  TextField,
  Autocomplete,
  Paper,
  useTheme,
  IconButton,
  Snackbar,
  Alert,
  CircularProgress,
} from "@mui/material";
import { MediaPreview } from "../types";
import {
  getMissingGeoMedia,
  updateMediaGeolocation,
} from "../services/mapEditor";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import L from "leaflet";
import { useListStore, defaultListState } from "../stores/useListStore";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";

function MapClickHandler({
  selected,
  onMapClick,
}: {
  selected: MediaPreview | null;
  onMapClick: (latlng: typeof L.LatLng) => void;
}) {
  useMapEvents({
    click(e: any) {
      if (selected) {
        onMapClick(e.latlng);
      }
    },
  });
  return null;
}

function FitBounds({ bounds }: { bounds: any | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.flyToBounds(bounds, { padding: [50, 50] });
    }
  }, [bounds, map]);
  return null;
}

export default function MapEditorPage() {
  // Core State
  const listKey = "media-missing-geolocation";

  const {
    items: orphans,
    hasMore,
    isLoading,
  } = useListStore((state) => state.lists[listKey] || defaultListState);
  const { fetchInitial, loadMore, removeItem } = useListStore();
  const { ref: loaderRef, inView } = useInView({ threshold: 0.5 });

  const [selectedMedia, setSelectedMedia] = useState<MediaPreview | null>(null);
  const [newPosition, setNewPosition] = useState<typeof L.LatLng | null>(null);
  const [saving, setSaving] = useState(false);

  // Search State
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Map State
  const [mapBounds, setMapBounds] = useState<any | null>(null);

  // UI State
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error";
  }>({ open: false, message: "", severity: "success" });
  const theme = useTheme();

  useEffect(() => {
    fetchInitial(listKey, () => getMissingGeoMedia(null));
  }, [listKey, fetchInitial]);
  useEffect(() => {
    if (inView && hasMore && !isLoading) {
      loadMore(listKey, (cursor) => getMissingGeoMedia(cursor));
    }
  }, [inView, hasMore, isLoading, loadMore, listKey]);

  // Debounced search for locations using Nominatim API
  useEffect(() => {
    if (searchInput.length < 3) {
      setSearchResults([]);
      return;
    }
    const handler = setTimeout(() => {
      setSearchLoading(true);
      fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchInput
        )}`
      )
        .then((res) => res.json())
        .then((data) => setSearchResults(data))
        .catch(console.error)
        .finally(() => setSearchLoading(false));
    }, 500);
    return () => clearTimeout(handler);
  }, [searchInput]);

  const handleSelectMedia = (media: MediaPreview) => {
    setSelectedMedia(media);
    setNewPosition(null);
  };

  const handleMapClick = (latlng: typeof L.LatLng) => {
    setNewPosition(latlng);
  };

  const saveGeo = async () => {
    if (!selectedMedia || !newPosition) return;
    setSaving(true);
    try {
      await updateMediaGeolocation(
        selectedMedia.id,
        newPosition.lat,
        newPosition.lng
      );

      // 9. Use the store's action to optimistically update the list
      removeItem(listKey, selectedMedia.id);

      setSnackbar({
        open: true,
        message: "Location saved!",
        severity: "success",
      });
      setSelectedMedia(null);
      setNewPosition(null);
    } catch (err) {
      setSnackbar({
        open: true,
        message: "Failed to save location",
        severity: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setNewPosition(null);
  };

  const handleSearchSelect = (value: any) => {
    if (!value) return;
    const lat = parseFloat(value.lat);
    const lon = parseFloat(value.lon);
    if (value.boundingbox) {
      const [south, north, west, east] = (value.boundingbox as string[]).map(
        parseFloat
      );
      setMapBounds([
        [south, west],
        [north, east],
      ]);
    } else {
      setMapBounds([
        [lat - 0.1, lon - 0.1],
        [lat + 0.1, lon + 0.1],
      ]);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        height: "calc(100vh - 64px)",
        width: "100%",
        position: "relative",
      }}
    >
      <Paper
        elevation={4}
        sx={{
          position: "absolute",
          top: 16,
          left: 16,
          width: { xs: "calc(100% - 32px)", sm: 320 },
          height: "calc(100% - 32px)",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          p: 2,
          bgcolor: "background.default",
        }}
      >
        <Typography variant="h6" gutterBottom>
          Un-located Media
        </Typography>
        <Autocomplete
          sx={{ mb: 2 }}
          options={searchResults}
          getOptionLabel={(opt) => opt.display_name || ""}
          onInputChange={(_, v) => setSearchInput(v)}
          filterOptions={(x) => x}
          noOptionsText={
            searchInput.length < 3 ? "Type to search..." : "No results"
          }
          loading={searchLoading}
          onChange={(_, value) => handleSearchSelect(value)}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Search for a location"
              variant="outlined"
              size="small"
              slotProps={{
                input: {
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {searchLoading ? (
                        <CircularProgress color="inherit" size={20} />
                      ) : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                },
              }}
            />
          )}
        />
        <Box sx={{ overflowY: "auto", flexGrow: 1 }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: 1,
            }}
          >
            {orphans.map((m) => {
              // FIX: Determine the correct thumbnail URL
              const thumbUrl = m.thumbnail_path
                ? `${API}/thumbnails/${encodeFilePath(m.thumbnail_path)}`
                : `${API}/thumbnails/${m.id}.jpg`;

              return (
                <Box
                  key={m.id}
                  component="img"
                  // Use the correctly determined URL
                  src={thumbUrl}
                  alt={`Un-located media ${m.id}`}
                  onClick={() => handleSelectMedia(m)}
                  sx={{
                    width: "100%",
                    height: "auto",
                    aspectRatio: "1 / 1",
                    objectFit: "cover",
                    borderRadius: 2,
                    cursor: "pointer",
                    border:
                      selectedMedia?.id === m.id
                        ? `3px solid ${theme.palette.primary.main}`
                        : "3px solid transparent",
                    transition: "border 0.2s ease",
                    "&:hover": {
                      border: `3px solid ${theme.palette.primary.light}`,
                    },
                  }}
                />
              );
            })}
          </Box>
          {isLoading && (
            <Box textAlign="center" py={2}>
              <CircularProgress size={24} />
            </Box>
          )}
          {hasMore && <Box ref={loaderRef} sx={{ height: "1px" }} />}
        </Box>
      </Paper>

      <Box sx={{ flex: 1, height: "100%", width: "100%" }}>
        <MapContainer
          center={[20, 0]}
          zoom={2}
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
          <MapClickHandler
            selected={selectedMedia}
            onMapClick={handleMapClick}
          />
          <FitBounds bounds={mapBounds} />

          {selectedMedia && newPosition && (
            <Marker position={newPosition}>
              <Popup>
                <Box sx={{ textAlign: "center" }}>
                  <Typography variant="body2" gutterBottom>
                    Set location for this photo?
                  </Typography>
                  <Box
                    component="img"
                    src={
                      selectedMedia.thumbnail_path
                        ? `${API}/thumbnails/${encodeFilePath(selectedMedia.thumbnail_path)}`
                        : `${API}/thumbnails/${selectedMedia.id}.jpg`
                    }
                    sx={{
                      width: 100,
                      height: 100,
                      objectFit: "cover",
                      borderRadius: 1,
                      mb: 1,
                    }}
                  />
                  <Box>
                    <IconButton
                      size="small"
                      onClick={handleCancel}
                      color="error"
                      title="Cancel"
                    >
                      <CancelIcon />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={saveGeo}
                      color="primary"
                      disabled={saving}
                      title="Confirm"
                    >
                      {saving ? (
                        <CircularProgress size={20} />
                      ) : (
                        <CheckCircleIcon />
                      )}
                    </IconButton>
                  </Box>
                </Box>
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
