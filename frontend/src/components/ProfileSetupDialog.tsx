import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  TextField,
  List,
  ListItemText,
  Radio,
  ListItemButton,
  ListItemIcon,
  Snackbar,
  Alert,
  IconButton,
  CircularProgress,
} from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import AddIcon from "@mui/icons-material/Add";
import {
  createProfile,
  getConfig,
  listProfiles,
  pickDirectory,
  reloadConfig,
  switchProfile,
  addExistingProfile,
} from "../services/config";
import { getActiveTasks } from "../services/taskActions";
import type { AppConfig, ProfileListResponse } from "../types";
import config from "../config";

const LS_KEY = "omoide.profile.onboarding.v1";

export default function ProfileSetupDialog() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [profiles, setProfiles] = useState<ProfileListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [newName, setNewName] = useState<string>("My Library");
  const [newPath, setNewPath] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState<{ open: boolean; msg: string; sev: "success" | "error" }>(
    { open: false, msg: "", sev: "success" }
  );
  const [hasActiveTasks, setHasActiveTasks] = useState(false);

  const shouldSkip = useMemo(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(LS_KEY) === "done";
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Read-only showcase: never prompt for profile setup
    if (config.PRESENTATION_MODE) {
      setLoading(false);
      return;
    }
    const init = async () => {
      try {
        setLoading(true);
        const c = await getConfig();
        if (cancelled) return;
        setCfg(c);

        if (c.general.is_docker || c.general.presentation_mode) {
          // Profiles unsupported in Docker; never show dialog
          setOpen(false);
          return;
        }

        if (shouldSkip) {
          setOpen(false);
          return;
        }

        try {
          const p = await listProfiles();
          if (cancelled) return;
          setProfiles(p);
          // Default selection is current active
          setSelectedPath(p.active_path);
          // Fetch active tasks; if present, only allow viewing, not changing
          try {
            const tasks = await getActiveTasks();
            if (!cancelled) setHasActiveTasks(tasks.length > 0);
          } catch {}
          setOpen(true);
        } catch {
          // If listing fails (unlikely), don't block the app
          setOpen(false);
        }
      } catch {
        setError("Failed to initialize profile setup.");
        setOpen(false);
      } finally {
        setLoading(false);
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [shouldSkip]);

  const markDoneAndClose = () => {
    try {
      localStorage.setItem(LS_KEY, "done");
    } catch {}
    setOpen(false);
  };

  const handlePickPath = async () => {
    const p = await pickDirectory();
    if (p) setNewPath(p);
  };
  const handleAddExisting = async () => {
    try {
      const p = await pickDirectory();
      if (!p) return;
      await addExistingProfile(p);
      const updated = await listProfiles();
      setProfiles(updated);
      setSelectedPath(p);
      setSnack({ open: true, msg: "Profile added.", sev: "success" });
    } catch (e) {
      setSnack({
        open: true,
        msg: (e instanceof Error && e.message) || "Failed to add profile",
        sev: "error",
      });
    }
  };

  const handleSaveSelected = async () => {
    if (!selectedPath) return markDoneAndClose();
    if (hasActiveTasks) return;
    // Only switch if selection differs from active
    const current = profiles?.active_path || "";
    if (selectedPath === current) {
      return markDoneAndClose();
    }
    setSaving(true);
    try {
      await switchProfile(selectedPath);
      await reloadConfig();
      // Ensure all views reflect the new profile by reloading the SPA
      try {
        window.location.reload();
      } catch {}
    } catch (e) {
      setSnack({
        open: true,
        msg: (e instanceof Error && e.message) || "Failed to switch profile",
        sev: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!newPath) return;
    if (hasActiveTasks) return;
    setCreating(true);
    try {
      await createProfile(newPath, newName || "Profile");
      await reloadConfig();
      setSnack({ open: true, msg: "Profile created.", sev: "success" });
      markDoneAndClose();
    } catch (e) {
      setSnack({
        open: true,
        msg: (e instanceof Error && e.message) || "Failed to create profile",
        sev: "error",
      });
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  const defaultPath = cfg?.general.data_dir || "";
  const hasMultiple = (profiles?.profiles?.length || 0) > 1;

  return (
    <>
      <Dialog open={open} onClose={markDoneAndClose} maxWidth="sm" fullWidth>
        <DialogTitle>Set Up Your Data Profile</DialogTitle>
        <DialogContent>
          {hasActiveTasks && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Processing is active. Profile changes are disabled until tasks finish.
            </Alert>
          )}
          {loading ? (
            <Typography>Loading…</Typography>
          ) : error ? (
            <Typography color="error">{error}</Typography>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {!hasMultiple ? (
                <>
                  <Typography>
                    Choose where to store omoide’s data profile. If you’re unsure,
                    keep the default location. You can change this later in Configuration.
                  </Typography>
                  <Box>
                    <Typography variant="subtitle2">Default location</Typography>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      {defaultPath}
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", gap: 1 }}>
                    <Button variant="contained" onClick={handleSaveSelected} disabled={hasActiveTasks || saving}>
                      {saving ? (
                        <>
                          Saving… <CircularProgress size={16} sx={{ ml: 1 }} />
                        </>
                      ) : (
                        "Save"
                      )}
                    </Button>
                    <Button startIcon={<FolderOpenIcon />} onClick={handlePickPath} disabled={hasActiveTasks}>
                      Choose directory…
                    </Button>
                  </Box>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    <TextField
                      label="Profile name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      fullWidth
                    />
                  </Box>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    <TextField
                      label="Profile directory"
                      value={newPath}
                      onChange={(e) => setNewPath(e.target.value)}
                      fullWidth
                      placeholder="Pick or enter a path"
                    />
                    <IconButton aria-label="browse" onClick={handlePickPath} disabled={hasActiveTasks}>
                      <FolderOpenIcon />
                    </IconButton>
                    <Button
                      variant="contained"
                      color="primary"
                      startIcon={!creating ? <AddIcon /> : undefined}
                      onClick={handleCreate}
                      disabled={!newPath || creating || hasActiveTasks}
                    >
                      {creating ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        "Create here"
                      )}
                    </Button>
                  </Box>
                </>
              ) : (
                <>
                  <Typography>
                    Select your active profile or create a new one.
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
                    <Button variant="outlined" onClick={handleAddExisting} disabled={hasActiveTasks}>
                      Add Existing…
                    </Button>
                  </Box>
                  <List dense>
                    {profiles?.profiles?.map((p) => (
                      <ListItemButton
                        key={p.path}
                        onClick={() => setSelectedPath(p.path)}
                        selected={selectedPath === p.path}
                      >
                        <ListItemIcon>
                          <Radio checked={selectedPath === p.path} onChange={() => setSelectedPath(p.path)} />
                        </ListItemIcon>
                        <ListItemText
                          primary={p.name || "Profile"}
                          secondary={p.path}
                        />
                      </ListItemButton>
                    ))}
                  </List>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 1 }}>
                    <TextField
                      label="New profile name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      fullWidth
                    />
                  </Box>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    <TextField
                      label="New profile directory"
                      value={newPath}
                      onChange={(e) => setNewPath(e.target.value)}
                      fullWidth
                      placeholder="Pick or enter a path"
                    />
                    <IconButton aria-label="browse" onClick={handlePickPath} disabled={hasActiveTasks}>
                      <FolderOpenIcon />
                    </IconButton>
                    <Button
                      variant="contained"
                      color="primary"
                      startIcon={!creating ? <AddIcon /> : undefined}
                      onClick={handleCreate}
                      disabled={!newPath || creating || hasActiveTasks}
                    >
                      {creating ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        "Create new"
                      )}
                    </Button>
                  </Box>
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleSaveSelected} disabled={hasActiveTasks || saving} variant="contained">
            {saving ? <CircularProgress size={16} sx={{ color: "white" }} /> : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack({ ...snack, open: false })}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snack.sev} onClose={() => setSnack({ ...snack, open: false })}>
          {snack.msg}
        </Alert>
      </Snackbar>
    </>
  );
}
