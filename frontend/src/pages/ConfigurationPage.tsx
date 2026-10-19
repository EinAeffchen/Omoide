import React, { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Snackbar,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import {
  getConfig,
  reloadConfig,
  saveConfig,
  switchProfile as apiSwitchProfile,
} from "../services/config";
import { getVersionUpdateInfo } from "../services/version";
import { AppConfig, VersionUpdateInfo } from "../types";
import AiSection from "../components/configuration/AiSection";
import DuplicatesSection from "../components/configuration/DuplicatesSection";
import EventsSection from "../components/configuration/EventsSection";
import FaceRecognitionSection, {
  FaceSettingsMode,
} from "../components/configuration/FaceRecognitionSection";
import GeneralSection from "../components/configuration/GeneralSection";
import ProcessorsSection from "../components/configuration/ProcessorsSection";
import ProfilesSection from "../components/configuration/ProfilesSection";
import ScanSection from "../components/configuration/ScanSection";
import TaggingSection from "../components/configuration/TaggingSection";
import UpdateNotice from "../components/configuration/UpdateNotice";
import VideoSection from "../components/configuration/VideoSection";
import WidgetsSection from "../components/configuration/WidgetsSection";
import {
  normalizedMediaDirPaths,
  sanitizeMediaDirs,
} from "../components/configuration/mediaDirs";
import {
  ConfigUpdate,
  ConfigValueChange,
  ShowSnackbar,
  SnackbarSeverity,
} from "../components/configuration/shared";
import { useProfiles } from "../components/configuration/useProfiles";

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
    severity: "success" as SnackbarSeverity,
  });
  const [tabValue, setTabValue] = useState(0);
  const [faceSettingsMode, setFaceSettingsMode] =
    useState<FaceSettingsMode>("presets");
  // Media dirs as last saved, plus removals the user confirmed in the dialog.
  // Save refuses to drop a saved directory without that acknowledgement.
  const [savedMediaDirPaths, setSavedMediaDirPaths] = useState<string[]>([]);
  const [acknowledgedRemovedMediaDirPaths, setAcknowledgedRemovedMediaDirPaths] =
    useState<Set<string>>(new Set());

  const showSnackbar: ShowSnackbar = (message, severity) =>
    setSnackbar({ open: true, message, severity });

  /** Adopt an authoritative server config and reset media-dir removal tracking. */
  const applyServerConfig = (latest: AppConfig) => {
    setConfig(latest);
    setSavedMediaDirPaths(
      normalizedMediaDirPaths(latest.general.media_dirs ?? [])
    );
    setAcknowledgedRemovedMediaDirPaths(new Set());
  };

  const profilesCtl = useProfiles({
    showSnackbar,
    onConfigReloaded: applyServerConfig,
  });
  const { loadInitial: loadInitialProfiles } = profilesCtl;

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
        applyServerConfig(data);
        if (release) {
          setUpdateInfo(release);
          setUpdateError(release.error ?? null);
        } else {
          setUpdateInfo(null);
        }
        await loadInitialProfiles();
      } catch {
        setError("Failed to load configuration.");
      } finally {
        setIsLoading(false);
      }
    };
    fetchConfig();
  }, [loadInitialProfiles]);

  useEffect(() => {
    if (!config) return;
    if (config.face_recognition.preset === "custom") {
      setFaceSettingsMode("manual");
    }
  }, [config]);

  const updateConfig: ConfigUpdate = (updater) =>
    setConfig((prev) => (prev ? updater(prev) : prev));

  const handleValueChange: ConfigValueChange = (section, key, value) =>
    updateConfig((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));

  const acknowledgeMediaDirRemoval = (normalizedPath: string) =>
    setAcknowledgedRemovedMediaDirPaths((prev) => {
      const next = new Set(prev);
      next.add(normalizedPath);
      return next;
    });

  const handleSave = async () => {
    if (!config) return;
    setIsSaving(true);
    const switchTarget = profilesCtl.hasPendingSwitch
      ? profilesCtl.selectedProfilePath
      : null;
    try {
      const sanitized = {
        ...config,
        general: {
          ...config.general,
          media_dirs: sanitizeMediaDirs(config.general.media_dirs ?? []),
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
      if (switchTarget) {
        profilesCtl.setIsSwitchingProfile(true);
        await apiSwitchProfile(switchTarget);
      }

      // Reload backend config and sync frontend runtime flags; also
      // update local state with the authoritative server config.
      const latest = await reloadConfig();
      applyServerConfig(latest);
      await profilesCtl.refreshProfiles();

      // If the profile changed, do a full page reload to ensure all pages pull fresh data
      if (switchTarget) {
        try {
          window.location.reload();
        } catch {}
        return; // Unreachable after reload, but keeps intent clear
      }

      showSnackbar("Configuration saved and reloaded successfully!", "success");
    } catch (err) {
      showSnackbar(
        err instanceof Error ? err.message : "An unknown error occurred.",
        "error"
      );
    } finally {
      setIsSaving(false);
      profilesCtl.setIsSwitchingProfile(false);
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

  const sectionProps = { config, onValueChange: handleValueChange };
  const sections: { label: string; content: React.ReactNode }[] = [
    // The Profiles tab is hidden entirely in Docker environments
    ...(config.general.is_docker
      ? []
      : [
          {
            label: "Profiles",
            content: (
              <ProfilesSection
                isDocker={config.general.is_docker}
                profilesCtl={profilesCtl}
              />
            ),
          },
        ]),
    {
      label: "General",
      content: (
        <GeneralSection
          {...sectionProps}
          onChange={updateConfig}
          showSnackbar={showSnackbar}
          onAcknowledgeMediaDirRemoval={acknowledgeMediaDirRemoval}
        />
      ),
    },
    { label: "Widgets", content: <WidgetsSection {...sectionProps} /> },
    { label: "Events", content: <EventsSection {...sectionProps} /> },
    { label: "Scan", content: <ScanSection {...sectionProps} /> },
    { label: "AI", content: <AiSection {...sectionProps} /> },
    { label: "Tagging", content: <TaggingSection {...sectionProps} /> },
    {
      label: "Face Recognition",
      content: (
        <FaceRecognitionSection
          {...sectionProps}
          onChange={updateConfig}
          mode={faceSettingsMode}
          onModeChange={setFaceSettingsMode}
        />
      ),
    },
    { label: "Duplicates", content: <DuplicatesSection {...sectionProps} /> },
    { label: "Video", content: <VideoSection {...sectionProps} /> },
    {
      label: "Processors",
      content: (
        <ProcessorsSection
          config={config}
          onChange={updateConfig}
          showSnackbar={showSnackbar}
        />
      ),
    },
  ];

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <UpdateNotice updateInfo={updateInfo} updateError={updateError} />
      <Typography variant="h4" gutterBottom sx={{ mb: 4 }}>
        Configuration
      </Typography>
      <Box sx={{ flexGrow: 1, bgcolor: "background.paper", display: "flex" }}>
        <Tabs
          orientation="vertical"
          variant="scrollable"
          value={tabValue}
          onChange={(_, newValue: number) => setTabValue(newValue)}
          aria-label="Configuration sections"
          sx={{ borderRight: 1, borderColor: "divider" }}
        >
          {sections.map((section, index) => (
            <Tab
              key={index}
              label={section.label}
              id={`vertical-tab-${index}`}
              aria-controls={`vertical-tabpanel-${index}`}
            />
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
