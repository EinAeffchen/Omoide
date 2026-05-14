import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  Container,
  Box,
  Dialog,
  DialogContent,
  Typography,
  Button,
  CircularProgress,
  Snackbar,
  LinearProgress,
  Alert,
  IconButton,
  useTheme,
  useMediaQuery,
  Fade,
} from "@mui/material";
import { ArrowBackIosNew, ArrowForwardIos } from "@mui/icons-material";
import CloseIcon from "@mui/icons-material/Close";

import { useListStore } from "../stores/useListStore";

import { ActionDialogs } from "../components/ActionDialogs";
import { MediaDisplay } from "../components/MediaDisplay";
import { MediaHeader } from "../components/MediaHeader";
import { MediaContentTabs } from "../components/MediaContentTabs";
import { SwipeHint } from "../components/SwipeHint";

import { Media, MediaDetail, Tag, Task } from "../types";
import { getMedia } from "../services/media";
import { getConfig } from "../services/config";
import {
  convertMedia,
  deleteMediaRecord,
  deleteMediaFile,
  openMediaFolder,
  openMediaFile,
} from "../services/mediaActions";
import { getTask } from "../services/task";

export default function MediaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const backgroundLocation = location.state?.backgroundLocation;
  const sceneStartTime: number | null = location.state?.sceneStart ?? null;
  const shouldAutoplayVideo = location.state?.autoplayVideo === true;
  const buildNavigationState = useCallback(
    (extra: Record<string, unknown> = {}) => {
      const baseState = location.state ? { ...location.state } : {};
      if (baseState && "sceneStart" in baseState) {
        delete (baseState as Record<string, unknown>).sceneStart;
      }
      return { ...baseState, ...extra };
    },
    [location.state]
  );
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  // --- 1. STATE MANAGEMENT ---
  const mediaListKey = location.state?.mediaListKey as string | undefined;
  const listFromStore = useListStore((state) =>
    mediaListKey ? state.lists[mediaListKey] : undefined
  );
  // A. Global state from Zustand for the list context
  const items: unknown[] = listFromStore?.items ?? [];

  const { removeItem } = useListStore();

  // B. Local state for this specific modal's content
  const preloadedMedia = location.state?.media as Media | null;
  const [detail, setDetail] = useState<MediaDetail | null>(
    preloadedMedia ? { media: preloadedMedia, persons: [], orphans: [] } : null
  );
  const [isDetailLoading, setIsDetailLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ status?: number; message: string } | null>(null);

  // C. Local state for all other UI and features
  const [task, setTask] = useState<Task | null>(null);
  const [dialogType, setDialogType] = useState<
    "convert" | "deleteRecord" | "deleteFile" | null
  >(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error";
  }>({ open: false, message: "", severity: "success" });
  const [tabValue, setTabValue] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const [isBinary, setIsBinary] = useState<boolean>(false);

  // --- 2. DERIVED DATA & CONTEXT ---

  const navigationIdsFromState = useMemo(() => {
    const ids = location.state?.navigationContext?.ids;
    if (!Array.isArray(ids)) return [];
    return ids.filter((value): value is number => typeof value === "number");
  }, [location.state]);

  const allMediaIdsInView = useMemo(() => {
    const extractItemId = (item: unknown): number | null => {
      if (typeof item === "number") return item;
      if (item && typeof item === "object") {
        const candidate = item as {
          id?: unknown;
          media?: unknown;
          data?: unknown;
        };

        if (typeof candidate.id === "number") return candidate.id;

        const mediaCandidate = candidate.media as { id?: unknown } | undefined;
        if (mediaCandidate && typeof mediaCandidate.id === "number") {
          return mediaCandidate.id;
        }

        const dataCandidate = candidate.data as { id?: unknown } | undefined;
        if (dataCandidate && typeof dataCandidate.id === "number") {
          return dataCandidate.id;
        }
      }
      return null;
    };

    if (navigationIdsFromState.length > 0) {
      const numericId = id ? Number(id) : NaN;
      if (
        !Number.isNaN(numericId) &&
        !navigationIdsFromState.includes(numericId)
      ) {
        return [...navigationIdsFromState, numericId];
      }
      return navigationIdsFromState;
    }

    const idsFromList = items
      .map(extractItemId)
      .filter((value): value is number => value !== null);

    if (idsFromList.length > 0) {
      return Array.from(new Set(idsFromList));
    }

    if (id) {
      const numericId = Number(id);
      return Number.isNaN(numericId) ? [] : [numericId];
    }

    return [];
  }, [items, navigationIdsFromState, id]);
  const neighbors = useMemo(() => {
    if (!id || !allMediaIdsInView) return { previousId: null, nextId: null };
    const currentIndex = allMediaIdsInView.findIndex(
      (mediaId) => mediaId === Number(id)
    );
    if (currentIndex === -1) return { previousId: null, nextId: null };

    const previousId =
      currentIndex > 0 ? allMediaIdsInView[currentIndex - 1] : null;
    const nextId =
      currentIndex < allMediaIdsInView.length - 1
        ? allMediaIdsInView[currentIndex + 1]
        : null;
    return { previousId, nextId };
  }, [id, allMediaIdsInView]);

  // --- 3. DATA FETCHING & NAVIGATION ---

  const fetchDetail = useCallback(
    async (signal?: AbortSignal) => {
      if (!id) return;
      setIsDetailLoading(true);
      try {
        const data = await getMedia(id);
        if (!signal?.aborted) setDetail(data);
      } catch (err) {
        if (!signal?.aborted)
          console.error("Failed to fetch media detail:", err);
      } finally {
        if (!signal?.aborted) setIsDetailLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    const controller = new AbortController();
    const currentPreloaded = location.state?.media as Media | null;
    if (currentPreloaded && String(currentPreloaded.id) === id) {
      setDetail({ media: currentPreloaded, persons: [], orphans: [] });
    }
    fetchDetail(controller.signal);
    // Load app configuration to determine if running as binary
    getConfig()
      .then((cfg) => setIsBinary(!!cfg.general.is_binary))
      .catch(() => setIsBinary(false));
    return () => controller.abort();
  }, [id, location.key, fetchDetail]);

  const handleNavigate = useCallback(
    (direction: "prev" | "next") => {
      const targetId =
        direction === "prev" ? neighbors.previousId : neighbors.nextId;
      if (!targetId) return;

      navigate(`/medium/${targetId}`, {
        state: buildNavigationState({ media: null, autoplayVideo: true }),
      });
    },
    [navigate, neighbors, buildNavigationState]
  );

  useEffect(() => {
    if (isMobile && (neighbors.nextId || neighbors.previousId)) {
      const hintShown = sessionStorage.getItem("swipeHintShown");
      if (!hintShown) {
        setShowSwipeHint(true);
        sessionStorage.setItem("swipeHintShown", "true");
      }
    }
  }, [isMobile, neighbors.nextId, neighbors.previousId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") handleNavigate("prev");
      if (e.key === "ArrowRight") handleNavigate("next");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNavigate]);

  useEffect(() => {
    if (!task?.id || ["completed", "failed"].includes(task.status)) return;
    const intervalId = setInterval(async () => {
      try {
        const updatedTask = await getTask(task.id);
        if (["completed", "cancelled"].includes(updatedTask.status)) {
          clearInterval(intervalId);
          if (updatedTask.status === "completed") fetchDetail();
        }
        setTask(updatedTask);
      } catch (error) {
        console.error("Failed to fetch task status:", error);
        clearInterval(intervalId);
      }
    }, 1500);
    return () => clearInterval(intervalId);
  }, [task?.id, task?.status, fetchDetail]);

  const handleTouchStart = (e: React.TouchEvent) =>
    setTouchStartX(e.targetTouches[0].clientX);
  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchEndX = e.changedTouches[0].clientX;
    if (touchStartX === null) return;
    const distance = touchStartX - touchEndX;
    if (distance > 50) handleNavigate("next");
    else if (distance < -50) handleNavigate("prev");
    setTouchStartX(null);
  };
  const handleMediaUpdate = (updatedMedia: Media) => {
    setDetail((prevDetail) => {
      if (!prevDetail) return null;
      return { ...prevDetail, media: updatedMedia };
    });
  };

  const handleTagAddedToMedia = (newTag: Tag) => {
    setDetail((prevDetail) => {
      if (!prevDetail) return null;

      const updatedMedia = {
        ...prevDetail.media,
        tags: [...(prevDetail.media.tags || []), newTag],
      };

      return { ...prevDetail, media: updatedMedia };
    });
  };

  const closeDialog = () => setDialogType(null);
  const confirmConvert = async () => {
    if (!detail || !detail.media) return;
    try {
      const t = await convertMedia(detail.media.id);
      setTask(t);
      setSnackbar({
        open: true,
        message: "Conversion started",
        severity: "success",
      });
    } catch {
      setSnackbar({
        open: true,
        message: "Conversion failed",
        severity: "error",
      });
    } finally {
      closeDialog();
    }
  };
  const navigateAfterDelete = useCallback(() => {
    if (backgroundLocation) {
      navigate(backgroundLocation.pathname + backgroundLocation.search);
    } else {
      navigate("/");
    }
  }, [navigate, backgroundLocation]);

  const confirmDeleteRecord = async () => {
    if (!detail || !detail.media) return;
    try {
      if (mediaListKey) removeItem(mediaListKey, detail.media.id);
      await deleteMediaRecord(detail.media.id);
      setSnackbar({
        open: true,
        message: "Record deleted",
        severity: "success",
      });
      navigateAfterDelete();
    } catch {
      setSnackbar({ open: true, message: "Delete failed", severity: "error" });
    } finally {
      closeDialog();
    }
  };
  const confirmDeleteFile = async () => {
    if (!detail || !detail.media) return;
    try {
      if (mediaListKey) removeItem(mediaListKey, detail.media.id);
      await deleteMediaFile(detail.media.id);
      setSnackbar({ open: true, message: "File deleted", severity: "success" });
      navigateAfterDelete();
    } catch {
      setSnackbar({
        open: true,
        message: "File delete failed",
        severity: "error",
      });
    } finally {
      closeDialog();
    }
  };

  const handleClose = () => {
    if (backgroundLocation) {
      navigate(backgroundLocation.pathname + backgroundLocation.search);
    } else {
      navigate("/");
    }
  };
  const isLoading = !detail && isDetailLoading;

  return (
    <Dialog
      open={true}
      onClose={handleClose}
      fullWidth
      maxWidth="xl"
      fullScreen={isMobile}
      slotProps={{
        backdrop: { sx: { backgroundColor: (theme) => `rgba(0,0,0,${theme.palette.mode === 'dark' ? 0.85 : 0.8})` } },
        paper: {
          sx: {
            mt: { xs: 0, sm: 4, md: 8 },
            borderRadius: { xs: 0, sm: 2 },
          },
        },
      }}
      sx={{
        "& .MuiDialog-container": {
          alignItems: "flex-start",
        },
      }}
    >
      <IconButton
        onClick={handleClose}
        sx={{
          position: "absolute",
          right: 8,
          top: 8,
          zIndex: 1000,
          color: "grey.500",
          bgcolor: { xs: "rgba(0,0,0,0.3)", sm: "transparent" },
          "&:hover": {
             bgcolor: { xs: "rgba(0,0,0,0.5)", sm: "rgba(0,0,0,0.04)" },
          }
        }}
      >
        <CloseIcon />
      </IconButton>
      <DialogContent sx={{ p: { xs: 0, sm: 2, md: 3 } }}>
        {isLoading ? (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "80vh",
            }}
          >
            <CircularProgress />
          </Box>
        ) : (
          detail && (
            <Container maxWidth="xl" sx={{ pt: { xs: 0, sm: 2 }, pb: { xs: 2, sm: 6 }, px: { xs: 0, sm: 3 } }}>
              {task &&
                (task.status === "running" || task.status === "pending") && (
                  <Box mb={2}>
                    <Typography variant="body2" gutterBottom>
                      Converting… {task.processed}%
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={task.processed}
                      sx={{ height: 8, borderRadius: 1 }}
                    />
                  </Box>
                )}
              <Box
                sx={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {!isMobile && neighbors.previousId && (
                  <IconButton
                    onClick={() => handleNavigate("prev")}
                    disabled={isDetailLoading}
                    sx={{
                      position: "absolute",
                      left: -40,
                      zIndex: 1,
                      "&.Mui-disabled": { opacity: 0.2 },
                    }}
                  >
                    <ArrowBackIosNew fontSize="large" />
                  </IconButton>
                )}
                <Box
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                  sx={{ width: "90%" }}
                >
                  <MediaHeader
                    media={detail.media}
                    onOpenDialog={setDialogType}
                    onToggleExif={() => setTabValue(3)}
                    showExif={tabValue === 3}
                    isBinary={isBinary}
                    onOpenFolder={async (mediaId) => {
                      try {
                        await openMediaFolder(mediaId);
                      } catch (error: unknown) {
                        const message =
                          error instanceof Error && error.message
                            ? error.message
                            : "Failed to open folder";
                        setSnackbar({ open: true, message, severity: "error" });
                      }
                    }}
                    onOpenFile={async (mediaId) => {
                      try {
                        await openMediaFile(mediaId);
                      } catch (error: unknown) {
                        const message =
                          error instanceof Error && error.message
                            ? error.message
                            : "Failed to open file";
                        setSnackbar({ open: true, message, severity: "error" });
                      }
                    }}
                  />
                  <MediaDisplay
                    media={detail.media}
                    initialTime={sceneStartTime ?? undefined}
                    autoplay={shouldAutoplayVideo}
                  />
                </Box>
                {showSwipeHint && <SwipeHint />}
                {!isMobile && neighbors.nextId && (
                  <IconButton
                    onClick={() => handleNavigate("next")}
                    disabled={isDetailLoading}
                    sx={{
                      position: "absolute",
                      right: -40,
                      zIndex: 1,
                      "&.Mui-disabled": { opacity: 0.2 },
                    }}
                  >
                    <ArrowForwardIos fontSize="large" />
                  </IconButton>
                )}
              </Box>
              <ActionDialogs
                dialogType={dialogType}
                onClose={closeDialog}
                onConfirmConvert={confirmConvert}
                onConfirmDeleteRecord={confirmDeleteRecord}
                onConfirmDeleteFile={confirmDeleteFile}
              />
              {isDetailLoading ? (
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    flexGrow: 1, // Allow the box to grow and fill the minHeight
                  }}
                >
                  <CircularProgress />
                </Box>
              ) : (
                <MediaContentTabs
                  detail={detail}
                  onTagAdded={handleTagAddedToMedia}
                  onDetailReload={fetchDetail}
                  onTagUpdate={handleMediaUpdate}
                />
              )}
              <Snackbar
                open={snackbar.open}
                autoHideDuration={3000}
                onClose={() => setSnackbar({ ...snackbar, open: false })}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
              >
                <Alert
                  severity={snackbar.severity}
                  sx={{ width: "100%" }}
                  onClose={() => setSnackbar({ ...snackbar, open: false })}
                >
                  {snackbar.message}
                </Alert>
              </Snackbar>
            </Container>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
