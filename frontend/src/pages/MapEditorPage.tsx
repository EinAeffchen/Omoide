import { useState, useEffect, useMemo } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
  useMap,
} from "react-leaflet";
import "../leafletSetup";
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
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Tooltip,
} from "@mui/material";
import {
  FolderWriteStatus,
  MissingGeoFolder,
  MissingGeoMedia,
  MissingGeoSort,
} from "../types";
import {
  getMissingGeoFolders,
  getMissingGeoMedia,
  updateMediaGeolocation,
} from "../services/mapEditor";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import LockIcon from "@mui/icons-material/Lock";
import L from "leaflet";
import { usePagedList } from "../hooks/usePagedList";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";

function MapClickHandler({
  selected,
  onMapClick,
}: {
  selected: MissingGeoMedia | null;
  onMapClick: (latlng: L.LatLng) => void;
}) {
  useMapEvents({
    click(e: L.LeafletMouseEvent) {
      if (selected) {
        onMapClick(e.latlng);
      }
    },
  });
  return null;
}

/** Subset of a Nominatim `/search?format=json` result used by this page. */
interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  /** [south, north, west, east] as decimal strings. */
  boundingbox?: string[];
}

const SORT_LABELS: Record<MissingGeoSort, string> = {
  latest: "Recently added",
  newest: "Taken, newest first",
  oldest: "Taken, oldest first",
  path: "Folder & file name",
};

const isSort = (value: string | null): value is MissingGeoSort =>
  value !== null && value in SORT_LABELS;

/** Whether `mediaPath` lies in `folder` (a forward-slash folder path). */
const isInFolder = (mediaPath: string, folder: string) =>
  mediaPath
    .replace(/\\/g, "/")
    .toLowerCase()
    .startsWith(`${folder.replace(/\/$/, "").toLowerCase()}/`);

function WriteStatusIcon({
  status,
  reason,
}: {
  status: FolderWriteStatus | null;
  reason: string | null;
}) {
  if (status !== "blocked" && status !== "mixed") return null;
  return (
    <Tooltip title={reason ?? ""}>
      <LockIcon
        fontSize="small"
        color={status === "blocked" ? "error" : "warning"}
        aria-label={
          status === "blocked" ? "Write-protected" : "Partly write-protected"
        }
      />
    </Tooltip>
  );
}

function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.flyToBounds(bounds, { padding: [50, 50] });
    }
  }, [bounds, map]);
  return null;
}

export default function MapEditorPage() {
  // Filter State (kept in the URL so it survives navigating away and back)
  const [searchParams, setSearchParams] = useSearchParams();
  const folder = searchParams.get("folder");
  const sortParam = searchParams.get("sort");
  const sort: MissingGeoSort = isSort(sortParam) ? sortParam : "latest";

  const [folders, setFolders] = useState<MissingGeoFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    getMissingGeoFolders(controller.signal)
      .then((data) => setFolders(data.folders))
      .catch((err) => {
        if (!controller.signal.aborted) console.error(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setFoldersLoading(false);
      });
    return () => controller.abort();
  }, []);
  const selectedFolder = useMemo(
    () => folders.find((f) => f.path === folder) ?? null,
    [folders, folder]
  );
  const blockedFolderCount = folders.filter(
    (f) => f.write_status === "blocked"
  ).length;

  // Core State
  const listKey = `media-missing-geolocation:${sort}:${folder ?? ""}`;

  const {
    items: orphans,
    hasMore,
    isLoading,
    error,
    loaderRef,
    removeItems,
  } = usePagedList<MissingGeoMedia>(listKey, (cursor, signal) =>
    getMissingGeoMedia(cursor, { folder, sort }, signal)
  );

  const [selectedMedia, setSelectedMedia] = useState<MissingGeoMedia | null>(
    null
  );
  const [newPosition, setNewPosition] = useState<L.LatLng | null>(null);
  const [saving, setSaving] = useState(false);

  // Search State
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Map State
  const [mapBounds, setMapBounds] = useState<L.LatLngBoundsExpression | null>(
    null
  );

  // UI State
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error";
  }>({ open: false, message: "", severity: "success" });
  const theme = useTheme();

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
        .then((data: NominatimResult[]) => setSearchResults(data))
        .catch(console.error)
        .finally(() => setSearchLoading(false));
    }, 500);
    return () => clearTimeout(handler);
  }, [searchInput]);

  const updateFilter = (key: "folder" | "sort", value: string | null) => {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true }
    );
    setSelectedMedia(null);
    setNewPosition(null);
  };

  const handleSelectMedia = (media: MissingGeoMedia) => {
    setSelectedMedia(media);
    setNewPosition(null);
  };

  const handleMapClick = (latlng: L.LatLng) => {
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

      // The media now has a location: drop it from the cached list
      removeItems([selectedMedia.id]);
      const savedPath = selectedMedia.path;
      setFolders((current) =>
        current
          .map((f) =>
            isInFolder(savedPath, f.path)
              ? { ...f, media_count: f.media_count - 1 }
              : f
          )
          .filter((f) => f.media_count > 0)
      );

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
        // The server explains refusals (e.g. a file Omoide may not write to).
        message: err instanceof Error ? err.message : "Failed to save location",
        severity: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setNewPosition(null);
  };

  const handleSearchSelect = (value: NominatimResult | null) => {
    if (!value) return;
    const lat = parseFloat(value.lat);
    const lon = parseFloat(value.lon);
    if (value.boundingbox) {
      const [south, north, west, east] = value.boundingbox.map(
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
        <Autocomplete
          sx={{ mb: 1.5 }}
          size="small"
          options={folders}
          value={selectedFolder}
          loading={foldersLoading}
          onChange={(_, value) => updateFilter("folder", value?.path ?? null)}
          getOptionLabel={(f) => f.path}
          isOptionEqualToValue={(a, b) => a.path === b.path}
          noOptionsText="No un-located media left"
          renderOption={({ key, ...props }, f) => (
            <Box
              component="li"
              key={key}
              {...props}
              sx={{ gap: 1, pl: `${1 + f.depth * 1.5}rem !important` }}
            >
              <Typography
                variant="body2"
                noWrap
                title={f.path}
                sx={{ flexGrow: 1, minWidth: 0 }}
              >
                {f.name}
              </Typography>
              <WriteStatusIcon
                status={f.write_status}
                reason={f.write_block_reason}
              />
              <Typography variant="caption" color="text.secondary">
                {f.media_count}
              </Typography>
            </Box>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Folder"
              placeholder="All folders"
              slotProps={{ inputLabel: { shrink: true } }}
            />
          )}
        />
        <FormControl size="small" fullWidth sx={{ mb: 1 }}>
          <InputLabel id="missing-geo-sort-label">Order</InputLabel>
          <Select
            labelId="missing-geo-sort-label"
            label="Order"
            value={sort}
            onChange={(e) => updateFilter("sort", e.target.value)}
          >
            {(Object.keys(SORT_LABELS) as MissingGeoSort[]).map((key) => (
              <MenuItem key={key} value={key}>
                {SORT_LABELS[key]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {selectedFolder?.write_status === "blocked" ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {selectedFolder.write_block_reason} Locations can't be written
            here. Turn off "Write Locations into Files" in{" "}
            <Link component={RouterLink} to="/configuration">
              Configuration
            </Link>{" "}
            to store them only in Omoide.
          </Alert>
        ) : (
          blockedFolderCount > 0 &&
          !selectedFolder && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mb: 1, display: "flex", alignItems: "center", gap: 0.5 }}
            >
              <LockIcon sx={{ fontSize: 14 }} color="error" />
              {blockedFolderCount} write-protected folder
              {blockedFolderCount === 1 ? "" : "s"}, marked in the folder list
            </Typography>
          )
        )}
        {selectedMedia?.write_block_reason && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {selectedMedia.write_block_reason}
          </Alert>
        )}
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

              const tile = (
                <Box
                  component="img"
                  // Use the correctly determined URL
                  src={thumbUrl}
                  alt={`Un-located media ${m.id}`}
                  title={m.write_block_reason ? undefined : m.path}
                  onClick={() => handleSelectMedia(m)}
                  sx={{
                    display: "block",
                    opacity: m.write_block_reason ? 0.5 : 1,
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

              if (!m.write_block_reason) {
                return <Box key={m.id}>{tile}</Box>;
              }
              return (
                <Tooltip key={m.id} title={m.write_block_reason}>
                  <Box sx={{ position: "relative" }}>
                    {tile}
                    <LockIcon
                      fontSize="small"
                      color="error"
                      sx={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        pointerEvents: "none",
                        bgcolor: "background.paper",
                        borderRadius: "50%",
                        p: 0.25,
                      }}
                    />
                  </Box>
                </Tooltip>
              );
            })}
          </Box>
          {isLoading && (
            <Box textAlign="center" py={2}>
              <CircularProgress size={24} />
            </Box>
          )}
          {error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {error}
            </Alert>
          )}
          {hasMore && !error && <Box ref={loaderRef} sx={{ height: "1px" }} />}
        </Box>
      </Paper>

      <Box sx={{ flex: 1, height: "100%", width: "100%" }}>
        <MapContainer
          center={[20, 0]}
          zoom={2}
          className={theme.palette.mode === "dark" ? "map-dark-tiles" : undefined}
          style={{
            height: "100%",
            width: "100%",
            backgroundColor: theme.palette.background.default,
          }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
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
                    {selectedMedia.write_block_reason
                      ? "This file is write-protected."
                      : "Set location for this photo?"}
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
                      disabled={saving || !!selectedMedia.write_block_reason}
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
        autoHideDuration={snackbar.severity === "error" ? 10000 : 4000}
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
