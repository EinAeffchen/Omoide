import React, { useEffect, useState } from "react";
import {
  getConfig,
  saveConfig,
  reloadConfig,
  pickDirectory,
  listProfiles,
  createProfile as apiCreateProfile,
  switchProfile as apiSwitchProfile,
  removeProfile as apiRemoveProfile,
  getProfileHealth,
} from "../services/config";
import { runProcessor } from "../services/taskActions";
import { useHomeWidgets } from "../hooks/useHomeWidgets";
import { HOME_WIDGETS, HomeWidgetId } from "../homeWidgets";
import {
  AppConfig,
  MediaDirectory,
  ProfileListResponse,
  VersionUpdateInfo,
} from "../types";
import { IconButton } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import FavoriteIcon from "@mui/icons-material/Favorite";
import StarIcon from "@mui/icons-material/Star";
import PhotoAlbumIcon from "@mui/icons-material/PhotoAlbum";
import InsightsIcon from "@mui/icons-material/Insights";
import { addExistingProfile } from "../services/config";
import {
  Button,
  Container,
  Typography,
  CircularProgress,
  Snackbar,
  TextField,
  Switch,
  FormGroup,
  FormControlLabel,
  Grid,
  Box,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Tabs,
  Tab,
  Alert,
  FormHelperText,
  Radio,
  ToggleButton,
  ToggleButtonGroup,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Checkbox,
} from "@mui/material";
import {
  Paper,
  Stack,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemSecondaryAction,
} from "@mui/material";
import { getVersionUpdateInfo } from "../services/version";

const HOME_WIDGET_ICONS: Record<HomeWidgetId, React.ReactNode> = {
  on_this_day: <AutoAwesomeIcon fontSize="small" />,
  recent_media: <PhotoLibraryIcon fontSize="small" />,
  favorites_strip: <FavoriteIcon fontSize="small" />,
  highlights_strip: <StarIcon fontSize="small" />,
  albums_preview: <PhotoAlbumIcon fontSize="small" />,
  statistics_snapshot: <InsightsIcon fontSize="small" />,
};

type FacePresetKey = "strict" | "normal" | "loose";

const facePresets: Record<
  FacePresetKey,
  Omit<AppConfig["face_recognition"], "preset" | "face_sharpness_filter_enabled" | "face_sharpness_min_variance">
> = {
  strict: {
    face_recognition_min_confidence: 0.6,
    existing_person_cosine_threshold: 0.68,
    existing_person_min_cosine_margin: 0.07,
    rerun_face_iou_dedupe_threshold: 0.7,
    face_recognition_min_face_pixels: 1600,
    person_min_face_count: 3,
    person_min_media_count: 2,
    person_merge_search_k: 30,
    person_cluster_max_l2_radius: 0.95,
    person_merge_percent_similarity: 78,
    cluster_batch_size: 15000,
    cluster_seed_min_det_score: 0.65,
    cluster_seed_min_frontality: 0.35,
    person_matching_max_prototypes: 3,
    hdbscan_min_cluster_size: 6,
    hdbscan_min_samples: 12,
    hdbscan_cluster_selection_method: "eom",
    hdbscan_cluster_selection_epsilon: 0.07,
    hdbscan_min_membership_probability: 0.4,
    cw_threshold: 0.7,
    cw_k_neighbors: 10,
    cw_iterations: 20,
    cw_min_member_similarity: 0.55,
  },
  normal: {
    face_recognition_min_confidence: 0.5,
    existing_person_cosine_threshold: 0.62,
    existing_person_min_cosine_margin: 0.05,
    rerun_face_iou_dedupe_threshold: 0.7,
    face_recognition_min_face_pixels: 1600,
    person_min_face_count: 2,
    person_min_media_count: 2,
    person_merge_search_k: 40,
    person_cluster_max_l2_radius: 1,
    person_merge_percent_similarity: 72,
    cluster_batch_size: 15000,
    cluster_seed_min_det_score: 0.6,
    cluster_seed_min_frontality: 0.3,
    person_matching_max_prototypes: 3,
    hdbscan_min_cluster_size: 6,
    hdbscan_min_samples: 10,
    hdbscan_cluster_selection_method: "eom",
    hdbscan_cluster_selection_epsilon: 0.1,
    hdbscan_min_membership_probability: 0.3,
    cw_threshold: 0.65,
    cw_k_neighbors: 10,
    cw_iterations: 20,
    cw_min_member_similarity: 0.5,
  },
  loose: {
    face_recognition_min_confidence: 0.4,
    existing_person_cosine_threshold: 0.56,
    existing_person_min_cosine_margin: 0.03,
    rerun_face_iou_dedupe_threshold: 0.7,
    face_recognition_min_face_pixels: 1200,
    person_min_face_count: 2,
    person_min_media_count: 2,
    person_merge_search_k: 50,
    person_cluster_max_l2_radius: 1.04,
    person_merge_percent_similarity: 68,
    cluster_batch_size: 15000,
    cluster_seed_min_det_score: 0.55,
    cluster_seed_min_frontality: 0.25,
    person_matching_max_prototypes: 3,
    hdbscan_min_cluster_size: 4,
    hdbscan_min_samples: 4,
    hdbscan_cluster_selection_method: "eom",
    hdbscan_cluster_selection_epsilon: 0.11,
    hdbscan_min_membership_probability: 0.2,
    cw_threshold: 0.62,
    cw_k_neighbors: 10,
    cw_iterations: 20,
    cw_min_member_similarity: 0.45,
  },
};

const facePresetDescriptions: Record<FacePresetKey, string> = {
  strict:
    "Highest precision. Requires sharp faces and strong matches before auto-grouping.",
  normal:
    "Balanced defaults. Works well for most libraries without over or under clustering.",
  loose:
    "Captures more borderline matches. Useful for sparse datasets at the cost of more review.",
};

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`vertical-tabpanel-${index}`}
      aria-labelledby={`vertical-tab-${index}`}
      {...other}
      style={{ width: "100%" }}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const normalizeMediaDirPath = (raw: string): string => {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const unified = trimmed.replace(/[\\/]+/g, "/");
  return unified.replace(/\/+$/, "").toLowerCase();
};

const normalizedMediaDirPaths = (dirs: MediaDirectory[] = []): string[] =>
  Array.from(
    new Set(
      dirs
        .map((dir) => normalizeMediaDirPath(dir?.path ?? ""))
        .filter((p) => p.length > 0)
    )
  );

interface MediaDirRemovalDialogState {
  open: boolean;
  index: number;
  path: string;
  acknowledged: boolean;
}

export default function ConfigurationPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<VersionUpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "success" as "success" | "error" | "info",
  });
  const [tabValue, setTabValue] = useState(0);
  const [profiles, setProfiles] = useState<ProfileListResponse | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [selectedProfilePath, setSelectedProfilePath] = useState<string | null>(
    null
  );
  const [isSwitchingProfile, setIsSwitchingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("My Library");
  const [newProfilePath, setNewProfilePath] = useState("");
  const [profileHealth, setProfileHealth] = useState<
    import("../types").ProfileHealth | null
  >(null);
  const [hasActiveTasks, setHasActiveTasks] = useState(false);
  const [faceSettingsMode, setFaceSettingsMode] = useState<
    "presets" | "manual"
  >("presets");
  const [runningProcessor, setRunningProcessor] = useState<string | null>(null);
  const {
    widgets: homeWidgets,
    toggle: toggleHomeWidget,
    move: moveHomeWidget,
  } = useHomeWidgets();
  const [savedMediaDirPaths, setSavedMediaDirPaths] = useState<string[]>([]);
  const [acknowledgedRemovedMediaDirPaths, setAcknowledgedRemovedMediaDirPaths] =
    useState<Set<string>>(new Set());
  const [removeMediaDirDialog, setRemoveMediaDirDialog] =
    useState<MediaDirRemovalDialogState>({
      open: false,
      index: -1,
      path: "",
      acknowledged: false,
    });

  // Local state for comma-separated text fields — avoids cursor-jump caused by
  // the parse→join round-trip through config state on every keystroke.
  const [customTagsText, setCustomTagsText] = useState<string | null>(null);
  const [imageSuffixesText, setImageSuffixesText] = useState<string | null>(null);
  const [videoSuffixesText, setVideoSuffixesText] = useState<string | null>(null);

  const handleRunProcessor = async (name: string, force: boolean) => {
    setRunningProcessor(name);
    try {
      await runProcessor(name, force);
      setSnackbar({
        open: true,
        message: `Started processor "${name}"${force ? " (reprocessing all)" : ""}.`,
        severity: "success",
      });
    } catch {
      setSnackbar({
        open: true,
        message: `Failed to start processor "${name}".`,
        severity: "error",
      });
    } finally {
      setRunningProcessor(null);
    }
  };

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const [data, release] = await Promise.all([
          getConfig(),
          getVersionUpdateInfo().catch((err) => {
            setUpdateError(err.message);
            return null;
          }),
        ]);
        setConfig(data);
        setSavedMediaDirPaths(
          normalizedMediaDirPaths(data.general.media_dirs ?? [])
        );
        setAcknowledgedRemovedMediaDirPaths(new Set());
        if (release) {
          setUpdateInfo(release);
          setUpdateError(release.error ?? null);
        } else {
          setUpdateInfo(null);
        }
        // Try to load profiles; ignore errors on Docker
        try {
          const p = await listProfiles();
          setProfiles(p);
          setSelectedProfilePath(p.active_path);
        } catch {
          setProfiles(null);
        }
        // Fetch profile health to detect moved/missing profiles
        try {
          const h = await getProfileHealth();
          setProfileHealth(h);
        } catch {}
        // Check active tasks to gate profile actions
        try {
          const tasks = await (
            await import("../services/taskActions")
          ).getActiveTasks();
          setHasActiveTasks(tasks.length > 0);
        } catch {}
      } catch {
        setError("Failed to load configuration.");
      } finally {
        setIsLoading(false);
      }
    };
    fetchConfig();
  }, []);

  useEffect(() => {
    if (!config) return;
    if (config.face_recognition.preset === "custom") {
      setFaceSettingsMode("manual");
    }
  }, [config]);

  const handleSave = async () => {
    if (!config) return;
    setIsSaving(true);
    try {
      const normalizedMediaDirs = (config.general.media_dirs ?? []).map(
        (dir) => ({
          path: (dir?.path ?? "").trim(),
          read_only: Boolean(dir?.read_only),
        })
      );
      const mediaDirMap = normalizedMediaDirs.reduce((acc, entry) => {
        if (!entry.path || acc.has(entry.path)) {
          return acc;
        }
        acc.set(entry.path, entry);
        return acc;
      }, new Map<string, MediaDirectory>());

      const sanitized = {
        ...config,
        general: {
          ...config.general,
          media_dirs: Array.from(mediaDirMap.values()),
        },
      };

      const currentNormalizedPaths = normalizedMediaDirPaths(
        sanitized.general.media_dirs ?? []
      );
      const removedMountedPaths = savedMediaDirPaths.filter(
        (path) => !currentNormalizedPaths.includes(path)
      );
      const hasUnacknowledgedRemoval = removedMountedPaths.some(
        (path) => !acknowledgedRemovedMediaDirPaths.has(path)
      );
      if (hasUnacknowledgedRemoval) {
        throw new Error(
          "Removing a media directory requires acknowledgement. Remove it via the delete button and confirm the warning first."
        );
      }

      await saveConfig(sanitized, removedMountedPaths.length > 0);

      // If a different profile is selected, switch to it as part of Save
      if (
        profiles &&
        selectedProfilePath &&
        selectedProfilePath !== profiles.active_path
      ) {
        setIsSwitchingProfile(true);
        await apiSwitchProfile(selectedProfilePath);
      }

      // Reload backend config and sync frontend runtime flags; also
      // update local state with the authoritative server config.
      const latest = await reloadConfig();
      setConfig(latest);
      setSavedMediaDirPaths(
        normalizedMediaDirPaths(latest.general.media_dirs ?? [])
      );
      setAcknowledgedRemovedMediaDirPaths(new Set());
      await refreshProfiles();

      // If the profile changed, do a full page reload to ensure all pages pull fresh data
      if (
        profiles &&
        selectedProfilePath &&
        selectedProfilePath !== profiles.active_path
      ) {
        try {
          window.location.reload();
        } catch {}
        return; // Unreachable after reload, but keeps intent clear
      }

      setSnackbar({
        open: true,
        message: "Configuration saved and reloaded successfully!",
        severity: "success",
      });
    } catch (err) {
      setSnackbar({
        open: true,
        message:
          err instanceof Error ? err.message : "An unknown error occurred.",
        severity: "error",
      });
    } finally {
      setIsSaving(false);
      setIsSwitchingProfile(false);
    }
  };

  const addMediaDir = async () => {
    const chosen = await pickDirectory();
    const value = chosen || "";
    setConfig((prev) => {
      if (!prev) return prev;
      const next = prev.general.media_dirs ?? [];
      return {
        ...prev,
        general: {
          ...prev.general,
          media_dirs: [...next, { path: value, read_only: false }],
        },
      };
    });
  };

  const updateMediaDirPath = (index: number, value: string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = [...(prev.general.media_dirs ?? [])];
      const existing = next[index] ?? { path: "", read_only: false };
      next[index] = { ...existing, path: value };
      return {
        ...prev,
        general: { ...prev.general, media_dirs: next },
      };
    });
  };

  const updateMediaDirReadOnly = (index: number, value: boolean) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = [...(prev.general.media_dirs ?? [])];
      const existing = next[index] ?? { path: "", read_only: false };
      next[index] = { ...existing, read_only: value };
      return {
        ...prev,
        general: { ...prev.general, media_dirs: next },
      };
    });
  };

  const requestRemoveMediaDir = (index: number) => {
    const currentPath =
      (config?.general.media_dirs?.[index]?.path ?? "").trim() || "(empty path)";
    setRemoveMediaDirDialog({
      open: true,
      index,
      path: currentPath,
      acknowledged: false,
    });
  };

  const confirmRemoveMediaDir = () => {
    const index = removeMediaDirDialog.index;
    const removedPath = normalizeMediaDirPath(removeMediaDirDialog.path);
    if (index < 0) return;
    setConfig((prev) => {
      if (!prev) return prev;
      const next = prev.general.media_dirs.filter((_, i) => i !== index);
      return {
        ...prev,
        general: { ...prev.general, media_dirs: next },
      };
    });
    if (removedPath) {
      setAcknowledgedRemovedMediaDirPaths((prev) => {
        const next = new Set(prev);
        next.add(removedPath);
        return next;
      });
    }
    setRemoveMediaDirDialog({
      open: false,
      index: -1,
      path: "",
      acknowledged: false,
    });
  };

  const closeRemoveMediaDirDialog = () => {
    setRemoveMediaDirDialog({
      open: false,
      index: -1,
      path: "",
      acknowledged: false,
    });
  };

  const browseMediaDir = async (index: number) => {
    const path = await pickDirectory();
    if (path && config) {
      updateMediaDirPath(index, path);
    }
  };

  const handleValueChange = <
    T extends keyof AppConfig,
    K extends keyof AppConfig[T],
  >(
    section: T,
    key: K,
    value: AppConfig[T][K]
  ) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const nextSection = {
        ...(prev[section] as AppConfig[T]),
        [key]: value,
      } as AppConfig[T];
      return {
        ...prev,
        [section]: nextSection,
      };
    });
  };

  const handleProcessorToggle = (
    key: keyof AppConfig["processors"],
    value: boolean
  ) => {
    let infoMessage: string | null = null;
    setConfig((prev) => {
      if (!prev) return prev;
      let next = {
        ...prev,
        processors: { ...prev.processors, [key]: value },
      };
      if (key === "image_embedding_processor_active" && !value) {
        const disabled: string[] = [];
        if (prev.tagging.auto_tagging) {
          disabled.push("Auto Tagger");
          next = {
            ...next,
            tagging: { ...prev.tagging, auto_tagging: false },
          };
        }
        if (disabled.length > 0) {
          infoMessage = `Disabled ${disabled.join(", ")} because image embeddings are turned off.`;
        }
      }
      return next;
    });
    if (infoMessage) {
      setSnackbar({ open: true, message: infoMessage, severity: "info" });
    }
  };

  const handleAutoTaggingToggle = (value: boolean) => {
    if (!config?.processors.image_embedding_processor_active && value) {
      setSnackbar({
        open: true,
        message:
          "Enable the image embeddings processor before turning on Auto Tagger.",
        severity: "info",
      });
      return;
    }
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tagging: { ...prev.tagging, auto_tagging: value },
      };
    });
  };

  const handleEnablePeopleToggle = (value: boolean) => {
    let infoMessage: string | null = null;
    setConfig((prev) => {
      if (!prev) return prev;
      let next = {
        ...prev,
        general: { ...prev.general, enable_people: value },
      };
      if (!value && prev.processors.face_processor_active) {
        infoMessage =
          "Face processor disabled because people features were turned off.";
        next = {
          ...next,
          processors: { ...prev.processors, face_processor_active: false },
        };
      }
      return next;
    });
    if (infoMessage) {
      setSnackbar({ open: true, message: infoMessage, severity: "info" });
    }
  };

  const handleFaceProcessorToggle = (value: boolean) => {
    if (value && !config?.general.enable_people) {
      setSnackbar({
        open: true,
        message: "Enable people features before turning on the face processor.",
        severity: "info",
      });
      return;
    }
    handleProcessorToggle("face_processor_active", value);
  };
  const getErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === "string" && error.trim().length > 0) {
      return error.trim();
    }
    return fallback;
  };

  const applyFacePreset = (preset: FacePresetKey) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const presetValues = facePresets[preset];
      const nextFace = {
        ...prev.face_recognition,
        ...presetValues,
        preset,
      };
      return { ...prev, face_recognition: nextFace };
    });
    setFaceSettingsMode("presets");
  };

  const setFaceValue = <K extends keyof AppConfig["face_recognition"]>(
    key: K,
    value: AppConfig["face_recognition"][K]
  ) => {
    setConfig((prev) => {
      if (!prev) return prev;
      if (
        typeof value === "number" &&
        (Number.isNaN(value) || value === Infinity || value === -Infinity)
      ) {
        return prev;
      }
      const nextFace = {
        ...prev.face_recognition,
        [key]: value,
      };
      if (key !== "preset") {
        nextFace.preset = "custom";
      }
      return { ...prev, face_recognition: nextFace };
    });
    if (key !== "preset") {
      setFaceSettingsMode("manual");
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const refreshProfiles = async () => {
    try {
      const p = await listProfiles();
      setProfiles(p);
      setProfileError(null);
    } catch (error: unknown) {
      setProfileError(getErrorMessage(error, "Failed to load profiles"));
    }
  };

  const createProfile = async () => {
    if (!newProfilePath) return;
    setCreatingProfile(true);
    try {
      await apiCreateProfile(newProfilePath, newProfileName || "Profile");
      const latest = await reloadConfig();
      setConfig(latest);
      setSavedMediaDirPaths(
        normalizedMediaDirPaths(latest.general.media_dirs ?? [])
      );
      setAcknowledgedRemovedMediaDirPaths(new Set());
      const lp = await listProfiles();
      setProfiles(lp);
      setSelectedProfilePath(lp.active_path);
      setSnackbar({
        open: true,
        message: "Profile created",
        severity: "success",
      });
      setNewProfilePath("");
    } catch (error: unknown) {
      setSnackbar({
        open: true,
        message: getErrorMessage(error, "Failed to create profile"),
        severity: "error",
      });
    } finally {
      setCreatingProfile(false);
    }
  };

  // Switching now happens as part of Save; users select via radio and then Save.

  const removeProfile = async (path: string) => {
    try {
      await apiRemoveProfile(path);
      await refreshProfiles();
      setSnackbar({
        open: true,
        message: "Removed profile",
        severity: "success",
      });
    } catch (error: unknown) {
      setSnackbar({
        open: true,
        message: getErrorMessage(error, "Failed to remove profile"),
        severity: "error",
      });
    }
  };

  const pickNewProfilePath = async () => {
    const p = await pickDirectory();
    if (p) setNewProfilePath(p);
  };

  // Relocate current profile if it was moved manually by selecting new path,
  // then clicking Save (will run switchProfile)
  const pickRelocatePath = async () => {
    const p = await pickDirectory();
    if (p) setSelectedProfilePath(p);
  };
  const handleAddExisting = async () => {
    try {
      const p = await pickDirectory();
      if (!p) return;
      await addExistingProfile(p);
      await refreshProfiles();
      setSelectedProfilePath(p);
      setSnackbar({
        open: true,
        message: "Profile added",
        severity: "success",
      });
    } catch (error: unknown) {
      setSnackbar({
        open: true,
        message: getErrorMessage(error, "Failed to add profile"),
        severity: "error",
      });
    }
  };

  if (isLoading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="80vh"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error && !config) {
    return <Typography color="error">{error}</Typography>;
  }

  if (!config) {
    return <Typography>No configuration loaded.</Typography>;
  }

  const latestVersionLabel =
    updateInfo?.latest_version ?? updateInfo?.latest_tag ?? null;
  const updateLink =
    updateInfo?.release_url ??
    (updateInfo?.repo
      ? `https://github.com/${updateInfo.repo}/releases`
      : undefined);
  const updateCheckEnabled = updateInfo?.update_check_enabled ?? true;
  const showUpdateNotice =
    updateCheckEnabled && Boolean(updateInfo?.update_available);
  const showUpdateError =
    updateCheckEnabled && !showUpdateNotice && Boolean(updateError);

  const isBinary = !!config.general.is_binary;
  const canEditMediaDirs = !config.general.is_docker;
  const activeFacePreset =
    config.face_recognition.preset === "custom"
      ? null
      : (config.face_recognition.preset as FacePresetKey);
  let sections: { label: string; content: React.ReactNode }[] = [
    {
      label: "Profiles",
      content: (
        <Grid container spacing={2}>
          {config.general.is_docker ? (
            <Grid size={{ xs: 12 }}>
              <Alert severity="info">
                Profiles are not available in this environment.
              </Alert>
            </Grid>
          ) : profileError ? (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error">{profileError}</Alert>
            </Grid>
          ) : profiles ? (
            <>
              {/* Active profile card */}
              <Grid size={{ xs: 12 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="h6" sx={{ mb: 1 }}>
                    Active Profile
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ color: "text.secondary", fontFamily: "monospace" }}
                  >
                    {profiles.active_path}
                  </Typography>
                  {profileHealth &&
                    (!profileHealth.active_exists || !profileHealth.has_db) && (
                      <Alert severity="warning" sx={{ mt: 2 }}>
                        The active profile looks missing or empty. If you moved
                        it, choose the new location and click Save to relink.
                        <Button
                          size="small"
                          sx={{ ml: 2 }}
                          variant="outlined"
                          onClick={pickRelocatePath}
                        >
                          Choose directory???
                        </Button>
                      </Alert>
                    )}
                </Paper>
              </Grid>

              {hasActiveTasks && (
                <Grid size={{ xs: 12 }}>
                  <Alert severity="warning">
                    Processing is active. Profile actions are disabled until
                    tasks finish.
                  </Alert>
                </Grid>
              )}

              {/* Two-column layout: list on left, create on right */}
              <Grid size={{ xs: 12, md: 7 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      mb: 1,
                    }}
                  >
                    <Typography variant="h6">All Profiles</Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={handleAddExisting}
                      disabled={hasActiveTasks}
                    >
                      Add Existing???
                    </Button>
                  </Box>
                  <Divider />
                  <List dense sx={{ mt: 1 }}>
                    {(profiles.profiles ?? []).map((p) => (
                      <ListItem key={p.path} disableGutters>
                        <ListItemIcon>
                          <Radio
                            edge="start"
                            checked={selectedProfilePath === p.path}
                            onChange={() => setSelectedProfilePath(p.path)}
                            disabled={hasActiveTasks || isSwitchingProfile}
                          />
                        </ListItemIcon>
                        <ListItemText
                          primary={p.name}
                          secondary={p.path}
                          secondaryTypographyProps={{
                            sx: { fontFamily: "monospace" },
                          }}
                        />
                        <ListItemSecondaryAction>
                          <IconButton
                            edge="end"
                            aria-label="remove profile"
                            onClick={() => removeProfile(p.path)}
                            disabled={
                              p.path === profiles.active_path ||
                              hasActiveTasks ||
                              isSwitchingProfile
                            }
                          >
                            <DeleteIcon />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>
                  {selectedProfilePath &&
                    selectedProfilePath !== profiles.active_path && (
                      <Typography
                        variant="caption"
                        sx={{
                          mt: 1,
                          display: "block",
                          color: "text.secondary",
                        }}
                      >
                        Selected profile will become active when you click Save
                        below.
                      </Typography>
                    )}
                </Paper>
              </Grid>

              <Grid size={{ xs: 12, md: 5 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="h6" sx={{ mb: 1 }}>
                    Create New Profile
                  </Typography>
                  <Stack direction="column" spacing={1.5}>
                    <TextField
                      label="Name"
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      fullWidth
                    />
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <TextField
                        label="Directory"
                        value={newProfilePath}
                        onChange={(e) => setNewProfilePath(e.target.value)}
                        fullWidth
                      />
                      <IconButton
                        aria-label="browse"
                        onClick={pickNewProfilePath}
                        disabled={hasActiveTasks}
                      >
                        <FolderOpenIcon />
                      </IconButton>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                      <Button
                        variant="contained"
                        color="primary"
                        startIcon={!creatingProfile ? <AddIcon /> : undefined}
                        onClick={createProfile}
                        disabled={
                          !newProfilePath || creatingProfile || hasActiveTasks
                        }
                        sx={{ minWidth: 120 }}
                      >
                        {creatingProfile ? (
                          <CircularProgress size={18} color="inherit" />
                        ) : (
                          "Create"
                        )}
                      </Button>
                    </Box>
                    <FormHelperText>
                      Destination directory must be empty or non-existent.
                    </FormHelperText>
                  </Stack>
                </Paper>
              </Grid>
            </>
          ) : (
            <Grid size={{ xs: 12 }}>
              <Alert severity="info">
                No profiles are registered yet. Create or add one below.
              </Alert>
            </Grid>
          )}
        </Grid>
      ),
    },
    {
      label: "General",
      content: (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Homepage Widgets
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Choose what shows on your homepage, and in what order. This only
              affects this browser, not other devices or users.
            </Typography>
            <Paper variant="outlined">
              <List dense disablePadding>
                {homeWidgets.map((widget, index) => {
                  const def = HOME_WIDGETS.find((w) => w.id === widget.id);
                  if (!def) return null;
                  return (
                    <ListItem
                      key={widget.id}
                      divider={index < homeWidgets.length - 1}
                      sx={{ py: 1 }}
                    >
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        {HOME_WIDGET_ICONS[widget.id]}
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <FormControlLabel
                            control={
                              <Switch
                                checked={widget.enabled}
                                onChange={(e) =>
                                  toggleHomeWidget(widget.id, e.target.checked)
                                }
                              />
                            }
                            label={def.label}
                          />
                        }
                        secondary={def.description}
                        secondaryTypographyProps={{ sx: { ml: 6 } }}
                      />
                      <ListItemSecondaryAction>
                        <IconButton
                          size="small"
                          aria-label={`Move ${def.label} up`}
                          disabled={index === 0}
                          onClick={() => moveHomeWidget(widget.id, -1)}
                        >
                          <ArrowUpwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label={`Move ${def.label} down`}
                          disabled={index === homeWidgets.length - 1}
                          onClick={() => moveHomeWidget(widget.id, 1)}
                        >
                          <ArrowDownwardIcon fontSize="small" />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                  );
                })}
              </List>
            </Paper>
          </Grid>
          {!isBinary && (
            <>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Port"
                  value={config.general.port}
                  onChange={(e) =>
                    handleValueChange(
                      "general",
                      "port",
                      parseInt(e.target.value)
                    )
                  }
                  fullWidth
                  margin="normal"
                  type="number"
                  helperText="HTTP port for the API/UI server (requires restart if running manually)"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Domain"
                  value={config.general.domain}
                  onChange={(e) =>
                    handleValueChange("general", "domain", e.target.value)
                  }
                  fullWidth
                  margin="normal"
                  helperText="Base URL used for generating links and API calls"
                />
              </Grid>
            </>
          )}
          {canEditMediaDirs && (
            <Grid size={{ xs: 12 }}>
              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                Media Directories
              </Typography>

              {(config.general.media_dirs ?? []).map((dir, idx) => (
                <Box
                  key={idx}
                  sx={{ display: "flex", alignItems: "center", gap: 1 }}
                >
                  <TextField
                    fullWidth
                    margin="normal"
                    label={`Media directory #${idx + 1}`}
                    value={dir?.path ?? ""}
                    onChange={(e) => updateMediaDirPath(idx, e.target.value)}
                    sx={{ flex: 1 }}
                    helperText="Absolute path."
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={Boolean(dir?.read_only)}
                        onChange={(e) =>
                          updateMediaDirReadOnly(idx, e.target.checked)
                        }
                      />
                    }
                    label="Read only"
                    sx={{ ml: 1, mr: 0 }}
                  />
                  <IconButton
                    aria-label="browse for media directory"
                    onClick={() => browseMediaDir(idx)}
                    size="large"
                  >
                    <FolderOpenIcon />
                  </IconButton>
                  <IconButton
                    aria-label="remove media directory"
                    onClick={() => requestRemoveMediaDir(idx)}
                    size="large"
                  >
                    <DeleteIcon />
                  </IconButton>
                </Box>
              ))}

              <Button
                startIcon={<AddIcon />}
                variant="outlined"
                onClick={addMediaDir}
                sx={{ mt: 1 }}
              >
                Add directory
              </Button>
            </Grid>
          )}
          <Grid size={{ xs: 12 }}>
            <FormGroup>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Read Only (Presentation Mode)
              </Typography>
              <Typography variant="body2" sx={{ ml: 0, mb: 1 }}>
                Managed only via Docker run environment (e.g.,
                <code style={{ marginLeft: 4 }}>
                  -e OMOIDE_GENERAL__PRESENTATION_MODE=true
                </code>
                ). Current:{" "}
                {config.general.presentation_mode ? "Enabled" : "Disabled"}.
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.general.enable_people}
                    onChange={(e) => handleEnablePeopleToggle(e.target.checked)}
                  />
                }
                label="Enable People"
              />
              <Typography
                variant="caption"
                sx={{ ml: 6, mt: -1, display: "block" }}
              >
                Enables face detection, recognition, and person clustering
                features.
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.general.meme_mode}
                    onChange={(e) =>
                      handleValueChange(
                        "general",
                        "meme_mode",
                        e.target.checked
                      )
                    }
                  />
                }
                label="Meme Mode"
              />
              <Typography
                variant="caption"
                sx={{ ml: 6, mt: -1, display: "block" }}
              >
                Displays animated GIFs in grids by loading the original files.
              </Typography>
            </FormGroup>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Thumbs per Folder"
              value={config.general.thumb_dir_folder_size}
              onChange={(e) =>
                handleValueChange(
                  "general",
                  "thumb_dir_folder_size",
                  parseInt(e.target.value)
                )
              }
              fullWidth
              margin="normal"
              type="number"
              helperText="Max thumbnails per subfolder (tune for filesystem inode limits)"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Relationship Graph Node Limit"
              value={config.general.person_relationship_max_nodes}
              onChange={(e) => {
                const parsed = parseInt(e.target.value, 10);
                const sanitized = Number.isFinite(parsed)
                  ? Math.max(1, parsed)
                  : 1;
                handleValueChange(
                  "general",
                  "person_relationship_max_nodes",
                  sanitized
                );
              }}
              fullWidth
              margin="normal"
              type="number"
              helperText="Maximum people to load when rendering the relationship graph"
            />
          </Grid>
        </Grid>
      ),
    },
    {
      label: "Events",
      content: (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12 }}>
            <FormGroup>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.events.events_enabled}
                    onChange={(e) =>
                      handleValueChange(
                        "events",
                        "events_enabled",
                        e.target.checked
                      )
                    }
                  />
                }
                label="Enable Events tab"
              />
              <Typography
                variant="caption"
                sx={{ ml: 6, mt: -1, display: "block" }}
              >
                Shows the Events tab and lets the library be clustered into
                trips and moments.
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.events.preserve_renamed_on_rebuild}
                    onChange={(e) =>
                      handleValueChange(
                        "events",
                        "preserve_renamed_on_rebuild",
                        e.target.checked
                      )
                    }
                  />
                }
                label="Preserve renamed events on rebuild"
              />
              <Typography
                variant="caption"
                sx={{ ml: 6, mt: -1, display: "block" }}
              >
                When "Rebuild events" runs again, try to match renamed events
                to their new cluster by media overlap and keep the custom
                title. When off, a rebuild always wipes every title.
              </Typography>
            </FormGroup>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Gap Between Events (hours)"
              value={config.events.event_gap_hours}
              onChange={(e) =>
                handleValueChange(
                  "events",
                  "event_gap_hours",
                  parseFloat(e.target.value)
                )
              }
              fullWidth
              margin="normal"
              type="number"
              helperText="A new event starts when consecutive media are further apart than this"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Minimum Media per Event"
              value={config.events.event_min_media}
              onChange={(e) =>
                handleValueChange(
                  "events",
                  "event_min_media",
                  parseInt(e.target.value, 10)
                )
              }
              fullWidth
              margin="normal"
              type="number"
              helperText="Clusters smaller than this are discarded as noise"
            />
          </Grid>
        </Grid>
      ),
    },
    {
      label: "Scan",
      content: (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Scan Interval (minutes)"
              value={config.scan.scan_interval_minutes}
              onChange={(e) =>
                handleValueChange(
                  "scan",
                  "scan_interval_minutes",
                  parseInt(e.target.value)
                )
              }
              fullWidth
              margin="normal"
              type="number"
              helperText="How often to look for new/changed files when Auto Scan is on"
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <FormGroup>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.scan.auto_scan}
                    onChange={(e) =>
                      handleValueChange("scan", "auto_scan", e.target.checked)
                    }
                  />
                }
                label="Auto Scan"
              />
              <Typography
                variant="caption"
                sx={{ ml: 6, mt: -1, display: "block" }}
              >
                Periodically scans media directories in the background.
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.scan.auto_clean_on_scan}
                    onChange={(e) =>
                      handleValueChange(
                        "scan",
                        "auto_clean_on_scan",
                        e.target.checked
                      )
                    }
                  />
                }
                label="Auto Clean on Scan"
              />
              <Typography
                variant="caption"
                sx={{ ml: 6, mt: -1, display: "block" }}
              >
                Flags missing files after each scan so you can review or
                auto-remove them later.
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.scan.auto_cleanup_without_review}
                    onChange={(e) =>
                      handleValueChange(
                        "scan",
                        "auto_cleanup_without_review",
                        e.target.checked
                      )
                    }
                  />
                }
                label="Auto Cleanup Without Review"
              />
              <Typography
                variant="caption"
                sx={{ ml: 6, mt: -1, display: "block" }}
              >
                When enabled, missing files are deleted automatically after the
                grace period below.
              </Typography>
              <TextField
                label="Cleanup Grace Period (hours)"
                type="number"
                value={config.scan.auto_cleanup_grace_hours}
                onChange={(e) =>
                  handleValueChange(
                    "scan",
                    "auto_cleanup_grace_hours",
                    e.target.value === ""
                      ? 0
                      : Math.max(0, Number(e.target.value))
                  )
                }
                inputProps={{ min: 0 }}
                margin="normal"
                sx={{ ml: 6, maxWidth: 240 }}
                helperText="Hours a file can remain missing before auto cleanup removes it."
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={config.scan.auto_cluster_on_scan}
                    onChange={(e) =>
                      handleValueChange(
                        "scan",
                        "auto_cluster_on_scan",
                        e.target.checked
                      )
                    }
                  />
                }
                label="Auto Cluster on Scan"
              />
              <Typography
                variant="caption"
                sx={{ ml: 6, mt: -1, display: "block" }}
              >
                Automatically clusters new faces into persons after each scan.
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.scan.auto_rotate}
                    onChange={(e) =>
                      handleValueChange("scan", "auto_rotate", e.target.checked)
                    }
                  />
                }
                label="Auto Rotate"
              />
              <Typography
                variant="caption"
                sx={{ ml: 6, mt: -1, display: "block" }}
              >
                Applies EXIF orientation to files and normalizes rotation.
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.scan.skip_thumbnails_on_scan}
                    onChange={(e) =>
                      handleValueChange(
                        "scan",
                        "skip_thumbnails_on_scan",
                        e.target.checked
                      )
                    }
                  />
                }
                label="Skip Thumbnails on Scan"
              />
              <Typography
                variant="caption"
                sx={{ ml: 6, mt: -1, display: "block" }}
              >
                Ignores files and folders named like thumbnails (for example,
                thumb_* or a thumbnails folder).
              </Typography>
            </FormGroup>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Image Formats"
              value={imageSuffixesText ?? config.scan.IMAGE_SUFFIXES.join(", ")}
              onChange={(e) => setImageSuffixesText(e.target.value)}
              onBlur={(e) => {
                handleValueChange(
                  "scan",
                  "IMAGE_SUFFIXES",
                  e.target.value
                    .split(",")
                    .map((s) => s.trim().toLowerCase())
                    .filter((s) => s.length > 0)
                    .map((s) => (s.startsWith(".") ? s : "." + s))
                );
                setImageSuffixesText(null);
              }}
              fullWidth
              margin="normal"
              helperText="Comma-separated image extensions (e.g. .jpg, .heic, .png)"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Video Formats"
              value={videoSuffixesText ?? config.scan.VIDEO_SUFFIXES.join(", ")}
              onChange={(e) => setVideoSuffixesText(e.target.value)}
              onBlur={(e) => {
                handleValueChange(
                  "scan",
                  "VIDEO_SUFFIXES",
                  e.target.value
                    .split(",")
                    .map((s) => s.trim().toLowerCase())
                    .filter((s) => s.length > 0)
                    .map((s) => (s.startsWith(".") ? s : "." + s))
                );
                setVideoSuffixesText(null);
              }}
              fullWidth
              margin="normal"
              helperText="Comma-separated video extensions (e.g. .mp4, .mov, .mkv)"
            />
          </Grid>
        </Grid>
      ),
    },
    {
      label: "AI",
      content: (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Clip Model"
              value={`${config.ai.clip_model} (${config.ai.clip_model_embedding_size}-d)`}
              fullWidth
              margin="normal"
              InputProps={{ readOnly: true }}
              helperText="Clip model is locked. Set OMOIDE_AI__CLIP_MODEL in the environment to change it."
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Min Search Distance"
              value={config.ai.min_search_dist}
              onChange={(e) =>
                handleValueChange(
                  "ai",
                  "min_search_dist",
                  parseFloat(e.target.value)
                )
              }
              fullWidth
              margin="normal"
              type="number"
              helperText="Higher = stricter similarity for search (fewer, more accurate results)"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Min Similarity Distance"
              value={config.ai.min_similarity_dist}
              onChange={(e) =>
                handleValueChange(
                  "ai",
                  "min_similarity_dist",
                  parseFloat(e.target.value)
                )
              }
              fullWidth
              margin="normal"
              type="number"
              helperText="Higher = stronger match needed to count media as similar"
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Alert severity="info" sx={{ mt: 1 }}>
              People clustering controls now live under Face Recognition presets
              and manual tuning.
            </Alert>
          </Grid>
        </Grid>
      ),
    },
    {
      label: "Tagging",
      content: (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12 }}>
            <TextField
              label="Custom Tags"
              value={customTagsText ?? config.tagging.custom_tags.join(",")}
              onChange={(e) => setCustomTagsText(e.target.value)}
              onBlur={(e) => {
                handleValueChange("tagging", "custom_tags", e.target.value.split(","));
                setCustomTagsText(null);
              }}
              fullWidth
              margin="normal"
              helperText="Comma-separated list of tags"
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <FormGroup>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.tagging.auto_tagging}
                    onChange={(e) =>
                      handleValueChange(
                        "tagging",
                        "auto_tagging",
                        e.target.checked
                      )
                    }
                  />
                }
                label="Auto Tagging"
              />
              <Typography
                variant="caption"
                sx={{ ml: 6, mt: -1, display: "block" }}
              >
                Uses the CLIP model to generate descriptive tags for media.
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.tagging.use_default_tags}
                    onChange={(e) =>
                      handleValueChange(
                        "tagging",
                        "use_default_tags",
                        e.target.checked
                      )
                    }
                  />
                }
                label="Use Default Tags"
              />
              <Typography
                variant="caption"
                sx={{ ml: 6, mt: -1, display: "block" }}
              >
                Includes a curated set of common tags alongside your custom
                list.
              </Typography>
            </FormGroup>
          </Grid>
        </Grid>
      ),
    },
    {
      label: "Face Recognition",
      content: (
        <Box>
          <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
            <Tabs
              value={faceSettingsMode}
              onChange={(_, value: "presets" | "manual") =>
                setFaceSettingsMode(value)
              }
              aria-label="Face recognition configuration mode"
            >
              <Tab label="Presets" value="presets" />
              <Tab label="Manual" value="manual" />
            </Tabs>
          </Box>
          {faceSettingsMode === "presets" ? (
            <Box>
              <ToggleButtonGroup
                exclusive
                color="primary"
                value={activeFacePreset}
                onChange={(_, next: FacePresetKey | null) => {
                  if (next) {
                    applyFacePreset(next);
                  }
                }}
                sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}
              >
                <ToggleButton value="strict">Strict</ToggleButton>
                <ToggleButton value="normal">Normal</ToggleButton>
                <ToggleButton value="loose">Loose</ToggleButton>
              </ToggleButtonGroup>
              {config.face_recognition.preset === "custom" && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  You are currently using custom values. Switch to Manual to
                  review them or pick a preset above to restore defaults.
                </Alert>
              )}
              {activeFacePreset && (
                <Typography variant="body2" sx={{ mt: 2 }}>
                  {facePresetDescriptions[activeFacePreset]}
                </Typography>
              )}
              <Typography variant="caption" sx={{ mt: 2, display: "block" }}>
                Presets adjust detection strictness, person assignment, and
                clustering thresholds together.
              </Typography>
            </Box>
          ) : (
            <Box>
              <Alert severity="warning" sx={{ mb: 2 }}>
                Changing any field switches the preset to Custom.
              </Alert>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Min Confidence"
                    value={
                      config.face_recognition.face_recognition_min_confidence
                    }
                    onChange={(e) =>
                      setFaceValue(
                        "face_recognition_min_confidence",
                        parseFloat(e.target.value)
                      )
                    }
                    fullWidth
                    margin="normal"
                    type="number"
                    helperText="Lower = detect more faces (including low-quality), higher = stricter"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Existing Person Cosine Threshold"
                    value={
                      config.face_recognition.existing_person_cosine_threshold
                    }
                    onChange={(e) =>
                      setFaceValue(
                        "existing_person_cosine_threshold",
                        parseFloat(e.target.value)
                      )
                    }
                    fullWidth
                    margin="normal"
                    type="number"
                    helperText="Stricter threshold when attaching to already-established persons"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Existing Person Min Cosine Margin"
                    value={
                      config.face_recognition.existing_person_min_cosine_margin
                    }
                    onChange={(e) =>
                      setFaceValue(
                        "existing_person_min_cosine_margin",
                        parseFloat(e.target.value)
                      )
                    }
                    fullWidth
                    margin="normal"
                    type="number"
                    inputProps={{ step: 0.01 }}
                    helperText="Require a gap between best and 2nd-best match to avoid ambiguity"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Rerun Face IoU Dedup Threshold"
                    value={
                      config.face_recognition.rerun_face_iou_dedupe_threshold
                    }
                    onChange={(e) =>
                      setFaceValue(
                        "rerun_face_iou_dedupe_threshold",
                        parseFloat(e.target.value)
                      )
                    }
                    fullWidth
                    margin="normal"
                    type="number"
                    inputProps={{ step: 0.01, min: 0, max: 1 }}
                    helperText="On face rerun, skip detections overlapping existing faces above this IoU"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Min Face Pixels"
                    value={
                      config.face_recognition.face_recognition_min_face_pixels
                    }
                    onChange={(e) =>
                      setFaceValue(
                        "face_recognition_min_face_pixels",
                        parseInt(e.target.value, 10)
                      )
                    }
                    fullWidth
                    margin="normal"
                    type="number"
                    helperText="Minimum face area (in pixels) to be considered detectible"
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={
                          config.face_recognition.face_sharpness_filter_enabled
                        }
                        onChange={(e) =>
                          setFaceValue(
                            "face_sharpness_filter_enabled",
                            e.target.checked
                          )
                        }
                      />
                    }
                    label="Sharpness filter"
                  />
                  <Typography variant="caption" display="block" color="text.secondary">
                    Skip blurry or out-of-focus face crops before embedding. Disable to detect faces in soft-focus photos (e.g. baby close-ups).
                  </Typography>
                </Grid>
                {config.face_recognition.face_sharpness_filter_enabled && (
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Sharpness Min Variance"
                      value={
                        config.face_recognition.face_sharpness_min_variance
                      }
                      onChange={(e) =>
                        setFaceValue(
                          "face_sharpness_min_variance",
                          parseFloat(e.target.value)
                        )
                      }
                      fullWidth
                      margin="normal"
                      type="number"
                      inputProps={{ step: 1, min: 0 }}
                      helperText="Laplacian variance threshold — lower = accept more blur (try 20–40)"
                    />
                  </Grid>
                )}
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Min Face Count per Person"
                    value={config.face_recognition.person_min_face_count}
                    onChange={(e) =>
                      setFaceValue(
                        "person_min_face_count",
                        parseInt(e.target.value, 10)
                      )
                    }
                    fullWidth
                    margin="normal"
                    type="number"
                    helperText="Faces required to automatically create a new person"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Min Media Count per Person"
                    value={config.face_recognition.person_min_media_count}
                    onChange={(e) =>
                      setFaceValue(
                        "person_min_media_count",
                        parseInt(e.target.value, 10)
                      )
                    }
                    fullWidth
                    margin="normal"
                    type="number"
                    helperText="Distinct media items required before a cluster becomes a person"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Merge search candidates"
                    value={config.face_recognition.person_merge_search_k}
                    onChange={(e) =>
                      setFaceValue(
                        "person_merge_search_k",
                        parseInt(e.target.value, 10)
                      )
                    }
                    fullWidth
                    margin="normal"
                    type="number"
                    helperText="How many persons to compare against for merging known people upon clustering"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Person Cluster Max L2 Radius"
                    value={config.face_recognition.person_cluster_max_l2_radius}
                    onChange={(e) =>
                      setFaceValue(
                        "person_cluster_max_l2_radius",
                        parseFloat(e.target.value)
                      )
                    }
                    fullWidth
                    margin="normal"
                    type="number"
                    inputProps={{ step: 0.01 }}
                    helperText="Max allowed L2 distance around centroid when forming a new person"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Person Merge  Similarity % Threshold"
                    value={
                      config.face_recognition.person_merge_percent_similarity
                    }
                    onChange={(e) =>
                      setFaceValue(
                        "person_merge_percent_similarity",
                        parseInt(e.target.value)
                      )
                    }
                    fullWidth
                    margin="normal"
                    type="number"
                    inputProps={{ step: 1, min: 0, max: 100 }}
                    helperText="After clustering, merge two persons when their similarity percent exceeds this threshold"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Cluster Batch Size"
                    value={config.face_recognition.cluster_batch_size}
                    onChange={(e) =>
                      setFaceValue(
                        "cluster_batch_size",
                        parseInt(e.target.value, 10)
                      )
                    }
                    fullWidth
                    margin="normal"
                    type="number"
                    helperText="Faces processed per clustering batch (memory vs. speed)"
                  />
                </Grid>
                {config.general.is_binary && (
                  <>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        label="Chinese Whispers Threshold"
                        value={config.face_recognition.cw_threshold}
                        onChange={(e) =>
                          setFaceValue(
                            "cw_threshold",
                            parseFloat(e.target.value)
                          )
                        }
                        fullWidth
                        margin="normal"
                        type="number"
                        helperText="Threshold for vector distance. Smaller = stricter matching"
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        label="Chinese Whispers Iterations"
                        value={config.face_recognition.cw_iterations}
                        onChange={(e) =>
                          setFaceValue(
                            "cw_iterations",
                            parseInt(e.target.value, 10)
                          )
                        }
                        fullWidth
                        margin="normal"
                        type="number"
                        helperText="Iterations for clustering. Usually 20 should be sufficient."
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        label="Chinese Whispers K nearest neighbors"
                        value={config.face_recognition.cw_k_neighbors}
                        onChange={(e) =>
                          setFaceValue(
                            "cw_k_neighbors",
                            parseInt(e.target.value, 10)
                          )
                        }
                        fullWidth
                        margin="normal"
                        type="number"
                        helperText="K neirest neighbors for clustering graph."
                      />
                    </Grid>
                  </>
                )}
                {config.general.is_docker && (
                  <>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        label="HDBSCAN Min Cluster Size"
                        value={config.face_recognition.hdbscan_min_cluster_size}
                        onChange={(e) =>
                          setFaceValue(
                            "hdbscan_min_cluster_size",
                            parseInt(e.target.value, 10)
                          )
                        }
                        fullWidth
                        margin="normal"
                        type="number"
                        helperText="Minimum faces to form a cluster; larger merges clusters (fewer small identities)"
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        label="HDBSCAN Min Samples"
                        value={config.face_recognition.hdbscan_min_samples}
                        onChange={(e) =>
                          setFaceValue(
                            "hdbscan_min_samples",
                            parseInt(e.target.value, 10)
                          )
                        }
                        fullWidth
                        margin="normal"
                        type="number"
                        helperText="Higher = more conservative (more points marked as noise/outliers)"
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <FormControl fullWidth margin="normal">
                        <InputLabel id="hdbscan-method-manual-label">
                          HDBSCAN Cluster Selection Method
                        </InputLabel>
                        <Select
                          labelId="hdbscan-method-manual-label"
                          value={
                            config.face_recognition
                              .hdbscan_cluster_selection_method
                          }
                          label="HDBSCAN Cluster Selection Method"
                          onChange={(e) =>
                            setFaceValue(
                              "hdbscan_cluster_selection_method",
                              e.target.value as string
                            )
                          }
                        >
                          <MenuItem value="leaf">
                            leaf (finer, more granular clusters)
                          </MenuItem>
                          <MenuItem value="eom">
                            eom (more stable, fewer splits)
                          </MenuItem>
                        </Select>
                        <FormHelperText>
                          Controls granularity of clusters; "leaf" yields finer
                          segmentation.
                        </FormHelperText>
                      </FormControl>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        label="HDBSCAN Selection Epsilon"
                        value={
                          config.face_recognition
                            .hdbscan_cluster_selection_epsilon
                        }
                        onChange={(e) =>
                          setFaceValue(
                            "hdbscan_cluster_selection_epsilon",
                            parseFloat(e.target.value)
                          )
                        }
                        fullWidth
                        margin="normal"
                        type="number"
                        inputProps={{ step: 0.01 }}
                        helperText="Extra split sensitivity; larger values produce more, smaller clusters"
                      />
                    </Grid>
                  </>
                )}
              </Grid>
            </Box>
          )}
        </Box>
      ),
    },
    {
      label: "Duplicates",
      content: (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth margin="normal">
              <InputLabel id="dup-auto-handling-label">
                Auto Handling
              </InputLabel>
              <Select
                labelId="dup-auto-handling-label"
                value={config.duplicates.duplicate_auto_handling}
                label="Auto Handling"
                onChange={(e) =>
                  handleValueChange(
                    "duplicates",
                    "duplicate_auto_handling",
                    e.target
                      .value as AppConfig["duplicates"]["duplicate_auto_handling"]
                  )
                }
              >
                <MenuItem value="keep">
                  keep (do nothing automatically)
                </MenuItem>
                <MenuItem value="remove">
                  remove (resolve without deleting files)
                </MenuItem>
                <MenuItem value="blacklist">blacklist duplicates</MenuItem>
                <MenuItem value="delete">delete duplicates</MenuItem>
              </Select>
              <FormHelperText>
                Automatic action when duplicates are found. "keep" is the safest
                default.
              </FormHelperText>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth margin="normal">
              <InputLabel id="dup-keep-rule-label">Auto Keep Rule</InputLabel>
              <Select
                labelId="dup-keep-rule-label"
                value={config.duplicates.duplicate_auto_keep_rule}
                label="Auto Keep Rule"
                onChange={(e) =>
                  handleValueChange(
                    "duplicates",
                    "duplicate_auto_keep_rule",
                    e.target
                      .value as AppConfig["duplicates"]["duplicate_auto_keep_rule"]
                  )
                }
              >
                <MenuItem value="biggest">biggest file size</MenuItem>
                <MenuItem value="smallest">smallest file size</MenuItem>
                <MenuItem value="highest_res">highest resolution</MenuItem>
                <MenuItem value="lowest_res">lowest resolution</MenuItem>
                <MenuItem value="oldest">oldest file date</MenuItem>
                <MenuItem value="newest">newest file date</MenuItem>
              </Select>
              <FormHelperText>
                Which file to keep when auto-handling duplicates is enabled.
              </FormHelperText>
            </FormControl>
          </Grid>
        </Grid>
      ),
    },
    {
      label: "Video",
      content: (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Max Frames per Video"
              value={config.video.max_frames_per_video}
              onChange={(e) =>
                handleValueChange(
                  "video",
                  "max_frames_per_video",
                  parseInt(e.target.value)
                )
              }
              fullWidth
              margin="normal"
              type="number"
              helperText="Fallback frame sampling count when scene detection fails"
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <FormGroup>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.video.auto_scene_detection}
                    onChange={(e) =>
                      handleValueChange(
                        "video",
                        "auto_scene_detection",
                        e.target.checked
                      )
                    }
                  />
                }
                label="Auto Scene Detection"
              />
              <Typography
                variant="caption"
                sx={{ ml: 6, mt: -1, display: "block" }}
              >
                Detects scene changes and uses those frames for thumbnails and
                search.
              </Typography>
            </FormGroup>
          </Grid>
        </Grid>
      ),
    },
    {
      label: "Processors",
      content: (
        <Stack spacing={2}>
          {(
            [
              {
                key: "exif_processor_active" as const,
                processorName: "exif",
                label: "EXIF Processor",
                description:
                  "Extracts date, camera, GPS and other metadata for search & maps.",
                enabled: config.processors.exif_processor_active,
                onToggle: (v: boolean) =>
                  handleProcessorToggle("exif_processor_active", v),
              },
              {
                key: "face_processor_active" as const,
                processorName: "faces",
                label: "Face Processor",
                description: `Detects faces in images and prepares them for recognition.${!config.general.enable_people ? " Enable People to turn this on." : ""}`,
                enabled: config.processors.face_processor_active,
                disabled: !config.general.enable_people,
                onToggle: handleFaceProcessorToggle,
              },
              {
                key: "image_embedding_processor_active" as const,
                processorName: "embedding_extractor",
                label: "Image Embedding Processor",
                description:
                  "Generates CLIP embeddings for search, similarity, and related content.",
                enabled: config.processors.image_embedding_processor_active,
                onToggle: (v: boolean) =>
                  handleProcessorToggle("image_embedding_processor_active", v),
              },
              {
                processorName: "auto_tagger",
                label: "Auto Tagger",
                description:
                  "Suggests tags based on CLIP embeddings. Requires image embeddings.",
                enabled: config.tagging.auto_tagging,
                disabled: !config.processors.image_embedding_processor_active,
                onToggle: handleAutoTaggingToggle,
              },
              {
                key: "blur_processor_active" as const,
                processorName: "blur",
                label: "Blur Detector",
                description:
                  "Scores each image for sharpness (Laplacian variance) to identify blurry photos.",
                enabled: config.processors.blur_processor_active,
                onToggle: (v: boolean) =>
                  handleProcessorToggle("blur_processor_active", v),
              },
            ] as {
              key?: keyof AppConfig["processors"];
              processorName: string;
              label: string;
              description: string;
              enabled: boolean;
              disabled?: boolean;
              onToggle: (v: boolean) => void;
            }[]
          ).map((proc) => (
            <Paper key={proc.processorName} variant="outlined" sx={{ p: 2 }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 2,
                }}
              >
                <Box sx={{ flex: 1 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={proc.enabled}
                        onChange={(e) => proc.onToggle(e.target.checked)}
                        disabled={proc.disabled}
                      />
                    }
                    label={proc.label}
                  />
                  <Typography
                    variant="caption"
                    sx={{ ml: 6, mt: -0.5, display: "block", color: "text.secondary" }}
                  >
                    {proc.description}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", gap: 1, flexShrink: 0, mt: 0.5 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={runningProcessor === proc.processorName}
                    onClick={() =>
                      handleRunProcessor(proc.processorName, false)
                    }
                  >
                    {runningProcessor === proc.processorName ? (
                      <CircularProgress size={16} />
                    ) : (
                      "Run"
                    )}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="warning"
                    disabled={runningProcessor === proc.processorName}
                    onClick={() => handleRunProcessor(proc.processorName, true)}
                  >
                    Rerun All
                  </Button>
                </Box>
              </Box>
            </Paper>
          ))}
        </Stack>
      ),
    },
  ];

  if (config.general.is_docker) {
    // Hide the Profiles tab entirely in Docker environments
    sections = sections.filter((s) => s.label !== "Profiles");
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {showUpdateNotice && (
        <Alert
          severity="info"
          sx={{ mb: 3 }}
          action={
            updateLink ? (
              <Button
                color="inherit"
                size="small"
                component="a"
                href={updateLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                View Release
              </Button>
            ) : undefined
          }
        >
          A newer version
          {latestVersionLabel ? ` ${latestVersionLabel}` : ""} is available. You
          are running {updateInfo?.current_version}.
        </Alert>
      )}
      {showUpdateError && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Could not check for updates
          {updateError ? `: ${updateError}` : "."}
        </Alert>
      )}
      <Typography variant="h4" gutterBottom sx={{ mb: 4 }}>
        Configuration
      </Typography>
      <Box sx={{ flexGrow: 1, bgcolor: "background.paper", display: "flex" }}>
        <Tabs
          orientation="vertical"
          variant="scrollable"
          value={tabValue}
          onChange={handleTabChange}
          aria-label="Vertical tabs example"
          sx={{ borderRight: 1, borderColor: "divider" }}
        >
          {sections.map((section, index) => (
            <Tab key={index} label={section.label} />
          ))}
        </Tabs>
        {sections.map((section, index) => (
          <TabPanel key={index} value={tabValue} index={index}>
            {section.content}
          </TabPanel>
        ))}
      </Box>
      <Box sx={{ mt: 4, display: "flex", justifyContent: "flex-end" }}>
        <Button
          variant="contained"
          color="primary"
          onClick={handleSave}
          disabled={isSaving}
          size="large"
        >
          {isSaving ? <CircularProgress size={24} color="inherit" /> : "Save"}
        </Button>
      </Box>
      <Dialog
        open={removeMediaDirDialog.open}
        onClose={closeRemoveMediaDirDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Remove Media Directory</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Removing this media directory from configuration will remove all indexed
            media records under that path from Omoide on save. Original files on disk
            are not deleted.
          </DialogContentText>
          <DialogContentText sx={{ mb: 2 }}>
            Directory: <code>{removeMediaDirDialog.path}</code>
          </DialogContentText>
          <FormControlLabel
            control={
              <Checkbox
                checked={removeMediaDirDialog.acknowledged}
                onChange={(e) =>
                  setRemoveMediaDirDialog((prev) => ({
                    ...prev,
                    acknowledged: e.target.checked,
                  }))
                }
              />
            }
            label="I understand the indexed media for this directory will be removed when I save."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRemoveMediaDirDialog}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={confirmRemoveMediaDir}
            disabled={!removeMediaDirDialog.acknowledged}
          >
            Remove Directory
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
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
    </Container>
  );
}
