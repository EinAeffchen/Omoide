import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Box,
  Typography,
  Button,
  LinearProgress,
  Stack,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Snackbar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import { TaskFailure, TaskType } from "../types";
import {
  startTask as startTaskService,
  cancelTask as cancelTaskService,
  getTaskFailures,
} from "../services/taskActions";
import { useTaskEvents } from "../TaskEventsContext";
import config from "../config";
import SyncIcon from "@mui/icons-material/Sync";
import MovieIcon from "@mui/icons-material/Movie";
import Diversity3Icon from "@mui/icons-material/Diversity3";
import CleaningServicesIcon from "@mui/icons-material/CleaningServices";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

type TaskLabels = Record<TaskType, string>;
const TASK_LABELS: TaskLabels = {
  scan: "Scan Folder",
  process_media: "Process Media",
  clean_missing_files: "Cleanup missing files",
  cluster_persons: "Cluster Persons",
  find_duplicates: "Find duplicates",
};

type TaskManagerProps = {
  isActive: boolean;
};

export default function TaskManager({ isActive }: TaskManagerProps) {
  const { activeTasks, forceRefresh, lastCompletedTasks } =
    useTaskEvents(isActive);
  const [snack, setSnack] = useState<{
    open: boolean;
    msg: string;
    sev: "success" | "error";
    action?: React.ReactNode;
  }>({ open: false, msg: "", sev: "success" });
  const [failureEntries, setFailureEntries] = useState<TaskFailure[]>([]);
  const [failureDialogOpen, setFailureDialogOpen] = useState(false);
  const [failureTaskId, setFailureTaskId] = useState<string | null>(null);
  const [lastSeenScanTaskId, setLastSeenScanTaskId] = useState<string | null>(
    null
  );
  // Track when each task last made progress to enable an indeterminate fallback
  const lastProgressRef = useRef<
    Record<string, { value: number; changedAt: number }>
  >({});

  const loadFailures = useCallback(
    async (
      taskId: string,
      {
        openDialog = true,
        notifyEmpty = true,
      }: { openDialog?: boolean; notifyEmpty?: boolean } = {}
    ) => {
      try {
        const entries = await getTaskFailures(taskId);
        if (!entries.length) {
          if (notifyEmpty) {
            setSnack({
              open: true,
              msg: "No failures recorded for this task.",
              sev: "success",
            });
          }
          setFailureEntries([]);
          setFailureTaskId(null);
          if (openDialog) {
            setFailureDialogOpen(false);
          }
          return entries;
        }
        setFailureEntries(entries);
        setFailureTaskId(taskId);
        if (openDialog) {
          setFailureDialogOpen(true);
        }
        return entries;
      } catch (err) {
        console.error("Failed to load failures for task", taskId, err);
        setSnack({
          open: true,
          msg: "Failed to load failure details",
          sev: "error",
        });
        return [] as TaskFailure[];
      }
    },
    []
  );

  useEffect(() => {
    const now = Date.now();
    const nextMap: Record<string, { value: number; changedAt: number }> = {
      ...lastProgressRef.current,
    };

    activeTasks.forEach((t) => {
      const effectiveProcessed =
        t.task_type === "cluster_persons" &&
        typeof t.merge_processed === "number" &&
        typeof t.merge_total === "number" &&
        t.merge_total > 0
          ? t.merge_processed
          : t.processed;
      const prev = nextMap[t.id];
      if (!prev || prev.value !== effectiveProcessed) {
        nextMap[t.id] = { value: effectiveProcessed, changedAt: now };
      }
    });

    const activeIds = new Set(activeTasks.map((t) => t.id));
    Object.keys(nextMap).forEach((id) => {
      if (!activeIds.has(id)) {
        delete nextMap[id];
      }
    });

    lastProgressRef.current = nextMap;
  }, [activeTasks]);

  useEffect(() => {
    const completedScan = lastCompletedTasks.scan;
    if (!completedScan || completedScan.id === lastSeenScanTaskId) {
      return;
    }
    setLastSeenScanTaskId(completedScan.id);
    loadFailures(completedScan.id, { notifyEmpty: false }).then((entries) => {
      if (!entries.length) {
        return;
      }
      setSnack({
        open: true,
        msg: `Scan skipped ${entries.length} file${entries.length === 1 ? "" : "s"}.`,
        sev: "error",
        action: (
          <Button
            color="inherit"
            size="small"
            onClick={() => setFailureDialogOpen(true)}
          >
            View
          </Button>
        ),
      });
    });
  }, [lastCompletedTasks, lastSeenScanTaskId, loadFailures]);

  const startTask = async (type: TaskType) => {
    try {
      await startTaskService(type);
      await forceRefresh();
      setSnack({
        open: true,
        msg: `${TASK_LABELS[type]} started`,
        sev: "success",
      });
    } catch (err: any) {
      console.error("Error starting task", type, err);
      const msg = err?.message || "Failed to start task";
      setSnack({ open: true, msg, sev: "error" });
    }
  };

  const cancelTask = async (id: string) => {
    try {
      await cancelTaskService(id);
      await forceRefresh();
    } catch (err) {
      console.error("Error cancelling task", id, err);
    }
  };

  const isTaskRunning = (type: TaskType) =>
    activeTasks.some(
      (t) =>
        t.task_type === type &&
        (t.status === "running" || t.status === "pending")
    );

  return (
    <>
      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack({ ...snack, open: false })}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={snack.sev}
          onClose={() => setSnack({ ...snack, open: false })}
          action={snack.action}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <Box sx={{ flexGrow: 1 }}>
          {failureEntries.length > 0 && (
            <Alert
              severity="warning"
              sx={{ mb: 2 }}
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => setFailureDialogOpen(true)}
                >
                  View
                </Button>
              }
            >
              Last scan skipped {failureEntries.length} file
              {failureEntries.length === 1 ? "" : "s"}.
            </Alert>
          )}
          {/* Active Tasks Section */}
          {activeTasks.length > 0 && (
            <Stack spacing={2} mb={2}>
              <Typography variant="overline" color="text.secondary">
                Active Tasks
              </Typography>
              {activeTasks.map((t) => {
                const isClusterTask = t.task_type === "cluster_persons";
                const hasMergeProgress =
                  isClusterTask &&
                  typeof t.merge_total === "number" &&
                  t.merge_total > 0 &&
                  typeof t.merge_processed === "number";
                const effectiveProcessed = hasMergeProgress
                  ? t.merge_processed ?? 0
                  : t.processed;
                const effectiveTotal = hasMergeProgress
                  ? t.merge_total ?? 0
                  : t.total;
                const pct =
                  effectiveTotal > 0
                    ? Math.min(
                        100,
                        Math.round((effectiveProcessed / effectiveTotal) * 100)
                      )
                    : t.status === "completed"
                      ? 100
                      : 0;
                const lp = lastProgressRef.current[t.id];
                const staleForMs = lp
                  ? Date.now() - lp.changedAt
                  : Number.POSITIVE_INFINITY;
                // If we haven't seen progress in a bit (e.g., long video/scenes/model load),
                // switch to an indeterminate bar to show activity.
                const showIndeterminate =
                  t.status === "running" &&
                  (effectiveTotal === 0 || staleForMs > 8000);
                const failureCount = t.failure_count ?? 0;
                const clusteringPct =
                  isClusterTask && t.total > 0
                    ? Math.min(
                        100,
                        Math.round((t.processed / t.total) * 100)
                      )
                    : null;
                const totalDisplay =
                  effectiveTotal > 0 ? effectiveTotal : "?";
                const pctLabel = showIndeterminate ? "..." : `${pct}%`;
                return (
                  <Box key={t.id}>
                    <Box
                      display="flex"
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      <Typography variant="body2" fontWeight="bold">
                        {TASK_LABELS[t.task_type]}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t.status}
                        {t.status === "running" &&
                          ` (${pctLabel} - ${effectiveProcessed}/${totalDisplay})`}
                      </Typography>
                    </Box>
                    {hasMergeProgress ? (
                      <Box sx={{ mt: 0.5 }}>
                        {typeof clusteringPct === "number" && (
                          <>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {`Clustering: ${clusteringPct}% (${t.processed}/${t.total})`}
                            </Typography>
                            <LinearProgress
                              variant="determinate"
                              value={clusteringPct}
                              sx={{
                                height: 6,
                                borderRadius: 3,
                                mt: 0.5,
                                bgcolor: "divider",
                                "& .MuiLinearProgress-bar": {
                                  bgcolor: "primary.main",
                                },
                              }}
                            />
                          </>
                        )}
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            mt: typeof clusteringPct === "number" ? 1 : 0,
                          }}
                        >
                          {`Merging Similar Persons: ${pctLabel} (${effectiveProcessed}/${totalDisplay})${
                            typeof t.merge_pending === "number"
                              ? ` • Queue ${t.merge_pending}`
                              : ""
                          }`}
                        </Typography>
                        <LinearProgress
                          variant={
                            showIndeterminate ? "indeterminate" : "determinate"
                          }
                          value={showIndeterminate ? undefined : pct}
                          sx={{
                            height: 6,
                            borderRadius: 3,
                            mt: 0.5,
                            bgcolor: "divider",
                            "& .MuiLinearProgress-bar": {
                              bgcolor: "primary.main",
                            },
                          }}
                        />
                      </Box>
                    ) : (
                      <LinearProgress
                        variant={
                          showIndeterminate ? "indeterminate" : "determinate"
                        }
                        value={showIndeterminate ? undefined : pct}
                        sx={{
                          height: 6,
                          borderRadius: 3,
                          mt: 0.5,
                          bgcolor: "divider",
                          "& .MuiLinearProgress-bar": {
                            bgcolor: "primary.main",
                          },
                        }}
                      />
                    )}
                    {failureCount > 0 && (
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                        mt={0.5}
                      >
                        <Typography variant="caption" color="error.main">
                          {failureCount} file{failureCount === 1 ? "" : "s"}{" "}
                          failed
                        </Typography>
                        <Button
                          size="small"
                          onClick={() =>
                            loadFailures(t.id, { notifyEmpty: false })
                          }
                          sx={{ ml: 1 }}
                        >
                          View
                        </Button>
                      </Box>
                    )}
                    {t.status === "running" && (
                      <Typography variant="caption" color="text.secondary">
                        {t.current_step
                          ? `Step: ${t.current_step}`
                          : showIndeterminate
                            ? "Working..."
                            : ""}
                        {t.current_item ? `  -  ${t.current_item}` : ""}
                      </Typography>
                    )}
                    {t.status === "running" && (
                      <Button
                        size="small"
                        onClick={() => cancelTask(t.id)}
                        sx={{ mt: 0.5, ml: -1, color: "text.secondary" }}
                      >
                        Cancel
                      </Button>
                    )}
                  </Box>
                );
              })}
            </Stack>
          )}

          <Divider sx={{ my: 2 }} />

          <List>
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => startTask("scan")}
                disabled={isTaskRunning("scan")}
              >
                <ListItemIcon>
                  <SyncIcon />
                </ListItemIcon>
                <ListItemText primary="Scan Media Folder" />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => startTask("clean_missing_files")}
                disabled={isTaskRunning("clean_missing_files")}
              >
                <ListItemIcon>
                  <CleaningServicesIcon />
                </ListItemIcon>
                <ListItemText primary="Clean missing files" />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => startTask("process_media")}
                disabled={isTaskRunning("process_media")}
              >
                <ListItemIcon>
                  <MovieIcon />
                </ListItemIcon>
                <ListItemText primary="Process New Media" />
              </ListItemButton>
            </ListItem>
            {config.ENABLE_PEOPLE && (
              <ListItem disablePadding>
                <ListItemButton
                  onClick={() => startTask("cluster_persons")}
                  disabled={isTaskRunning("cluster_persons")}
                >
                  <ListItemIcon>
                    <Diversity3Icon />
                  </ListItemIcon>
                  <ListItemText primary="Cluster All Persons" />
                </ListItemButton>
              </ListItem>
            )}
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => startTask("find_duplicates")}
                disabled={isTaskRunning("find_duplicates")}
              >
                <ListItemIcon>
                  <ContentCopyIcon />
                </ListItemIcon>
                <ListItemText primary="Find Duplicates" />
              </ListItemButton>
            </ListItem>
          </List>
        </Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ mt: "auto", pt: 2, textAlign: "center" }}
        >
          {`Version ${config.APP_VERSION}`}
        </Typography>
      </Box>
      <Dialog
        open={failureDialogOpen}
        onClose={() => setFailureDialogOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Skipped Files ({failureEntries.length})</DialogTitle>
        <DialogContent dividers>
          {failureEntries.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No failures recorded.
            </Typography>
          ) : (
            <List dense disablePadding>
              {failureEntries.map((entry, idx) => (
                <ListItem
                  key={`${entry.path}-${idx}`}
                  alignItems="flex-start"
                  sx={{ py: 0.5 }}
                >
                  <ListItemText
                    primary={entry.path}
                    secondary={entry.reason}
                    primaryTypographyProps={{ variant: "body2" }}
                    secondaryTypographyProps={{
                      variant: "caption",
                      color: "text.secondary",
                    }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: "space-between" }}>
          <Typography variant="caption" color="text.secondary">
            {failureTaskId ? `Task: ${failureTaskId}` : ""}
          </Typography>
          <Button onClick={() => setFailureDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
