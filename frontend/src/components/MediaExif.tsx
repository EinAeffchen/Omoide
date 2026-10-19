import React, { useState, useEffect } from "react";
import {
  Box,
  CircularProgress,
  Typography,
  Paper,
  Divider,
  Link as MuiLink,
} from "@mui/material";
import Grid from "@mui/material/Grid";
import { Link } from "react-router-dom";

// Icons for a nicer look
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import IsoIcon from "@mui/icons-material/Iso";
import ShutterSpeedIcon from "@mui/icons-material/ShutterSpeed";
import ApertureIcon from "@mui/icons-material/DonutLarge";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import { getExifData } from "../services/exif";
import { ExifData } from "../types";

interface MediaExifProps {
  mediaId: number;
}

export function MediaExif({ mediaId }: MediaExifProps) {
  // State: 'loading', 'loaded', or 'error'
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading"
  );
  const [exif, setExif] = useState<ExifData | null>(null);

  useEffect(() => {
    // This effect runs only when the component is first mounted (i.e., when the tab is clicked)
    let isCancelled = false;
    setStatus("loading");

    getExifData(mediaId)
      .then((body) => {
        if (!isCancelled) {
          setExif(body);
          setStatus("loaded");
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setStatus("error");
          setExif(null);
        }
      });

    // Cleanup function to prevent state updates on unmounted components
    return () => {
      isCancelled = true;
    };
  }, [mediaId]); // Re-fetches if the mediaId changes while the tab is open

  if (status === "loading") {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "200px",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (status === "error" || !exif || Object.keys(exif).length === 0) {
    return (
      <Typography sx={{ textAlign: "center", py: 4 }}>
        No EXIF data available.
      </Typography>
    );
  }

  // Helper to render each EXIF data point with an icon
  const ExifDataPoint = ({
    icon,
    label,
    value,
  }: {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
  }) => {
    if (!value) return null;
    return (
      <Grid
        size={{ xs: 12, sm: 6, md: 4 }}
        sx={{ display: "flex", alignItems: "center", gap: 2 }}
      >
        <Box sx={{ color: "text.secondary" }}>{icon}</Box>
        <Box>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="body1" fontWeight="500">
            {value}
          </Typography>
        </Box>
      </Grid>
    );
  };

  return (
    <Paper variant="outlined" sx={{ p: 3, backgroundColor: "action.hover" }}>
      <Grid container spacing={3}>
        <ExifDataPoint
          icon={<CameraAltIcon />}
          label="Camera"
          value={exif.make && `${exif.make} ${exif.model || ""}`}
        />
        <ExifDataPoint
          icon={<AccessTimeIcon />}
          label="Shot"
          value={exif.timestamp && new Date(exif.timestamp).toLocaleString()}
        />
        <ExifDataPoint
          icon={<ApertureIcon />}
          label="Aperture"
          value={exif.aperture}
        />
        <ExifDataPoint
          icon={<ShutterSpeedIcon />}
          label="Shutter Speed"
          value={exif.exposure_time && `${exif.exposure_time}s`}
        />
        <ExifDataPoint icon={<IsoIcon />} label="ISO" value={exif.iso} />
        <ExifDataPoint
          icon={<PhotoCameraIcon />}
          label="Focal Length"
          value={exif.focal_length && `${exif.focal_length}mm`}
        />
      </Grid>
      {exif.lat != null && exif.lon != null && (
        <>
          <Divider sx={{ my: 3 }} />
          <MuiLink
            component={Link}
            to={`/map?lat=${exif?.lat}&lng=${exif?.lon}`}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              textDecoration: "none",
              color: "primary.main",
              fontWeight: 500,
            }}
          >
            <MyLocationIcon /> View on map
          </MuiLink>
        </>
      )}
    </Paper>
  );
}
