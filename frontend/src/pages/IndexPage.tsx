import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useInView } from "react-intersection-observer";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Container,
  Link as MuiLink,
  Menu,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
  Fade,
  Fab,
  Typography,
} from "@mui/material";
import Masonry from "react-masonry-css";
import SortIcon from "@mui/icons-material/Sort";
import GridViewIcon from "@mui/icons-material/GridView";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import RefreshIcon from "@mui/icons-material/Refresh";
import FolderIcon from "@mui/icons-material/Folder";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import { useListStore, defaultListState } from "../stores/useListStore";
import MediaCard from "../components/MediaCard";
import FolderCard from "../components/FolderCard";
import { MediaSkeleton } from "../components/MediaSkeleton";
import { EmptyState } from "../components/EmptyState";
import { MemoriesRail } from "../components/MemoriesRail";
import { MEDIA_SORT_LABELS } from "../components/MediaListPage";
import { getMediaFolders, getMediaList } from "../services/media";
import { getCameras } from "../services/features";
import { useTaskCompletionVersion } from "../TaskEventsContext";
import { CameraCount, MediaFolderListing } from "../types";

const breakpointColumnsObj = {
  default: 5,
  1600: 4,
  1200: 3,
  900: 3,
  600: 2,
};

export default function IndexPage() {
  const { ref: loaderRef, inView } = useInView({ threshold: 0.5 });
  const [tags] = useState<string[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const sortOrder: "newest" | "latest" =
    searchParams.get("sort") === "latest" ? "latest" : "newest";
  const viewMode: "grid" | "folders" =
    searchParams.get("view") === "folders" ? "folders" : "grid";
  const currentFolder = searchParams.get("folder");
  const cameraMake = searchParams.get("cam_make");
  const cameraModel = searchParams.get("cam_model");
  const camera = useMemo(
    () =>
      cameraMake || cameraModel
        ? { make: cameraMake, model: cameraModel }
        : null,
    [cameraMake, cameraModel]
  );
  const [cameras, setCameras] = useState<CameraCount[]>([]);
  const [cameraMenuAnchorEl, setCameraMenuAnchorEl] =
    useState<null | HTMLElement>(null);
  const [sortMenuAnchorEl, setSortMenuAnchorEl] = useState<null | HTMLElement>(
    null
  );
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [folderListing, setFolderListing] = useState<MediaFolderListing | null>(
    null
  );
  const [isFolderLoading, setIsFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(updates).forEach(([key, value]) => {
          if (value === null) next.delete(key);
          else next.set(key, value);
        });
        return next;
      });
    },
    [setSearchParams]
  );

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const mediaListKey = useMemo(() => {
    const tagString = [...tags].sort().join(",");
    const folderKey =
      viewMode === "folders" ? `folder:${currentFolder ?? ""}` : "all";
    const cameraKey = camera ? `${camera.make ?? ""}|${camera.model ?? ""}` : "";
    return `media-${viewMode}-${sortOrder}-${folderKey}-${tagString}-${cameraKey}`;
  }, [sortOrder, tags, viewMode, currentFolder, camera]);

  const listState = useListStore((state) => state.lists[mediaListKey]);
  const items = listState?.items ?? [];
  const hasMore = listState?.hasMore ?? defaultListState.hasMore;
  const isLoading = listState?.isLoading ?? defaultListState.isLoading;
  const listError = listState?.error ?? defaultListState.error;
  const { fetchInitial, loadMore, clearList, clearListsByPrefix } =
    useListStore();
  const refreshKey = useTaskCompletionVersion(["scan", "process_media"]);
  const [seenRefreshKey, setSeenRefreshKey] = useState(refreshKey);
  const hasNewItems = refreshKey !== seenRefreshKey;

  const folderParam = viewMode === "folders" ? currentFolder ?? "" : null;
  const recursive = viewMode !== "folders";

  // fetchInitial skips lists that already have content, so back-navigation
  // restores the cached list (and scroll position) instantly.
  useEffect(() => {
    fetchInitial(mediaListKey, () =>
      getMediaList(null, sortOrder, tags, folderParam, recursive, camera)
    );
  }, [
    mediaListKey,
    fetchInitial,
    sortOrder,
    tags,
    folderParam,
    recursive,
    camera,
  ]);

  useEffect(() => {
    if (inView && hasMore && !isLoading && !listError) {
      loadMore(mediaListKey, (cursor) =>
        getMediaList(cursor, sortOrder, tags, folderParam, recursive, camera)
      ).catch(console.error);
    }
  }, [
    inView,
    hasMore,
    isLoading,
    listError,
    loadMore,
    mediaListKey,
    sortOrder,
    tags,
    folderParam,
    recursive,
    camera,
  ]);

  const loadFolders = useCallback(async () => {
    if (viewMode !== "folders") {
      return;
    }
    setIsFolderLoading(true);
    setFolderError(null);
    try {
      const data = await getMediaFolders(currentFolder ?? null);
      setFolderListing(data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load folders";
      setFolderError(message);
    } finally {
      setIsFolderLoading(false);
    }
  }, [viewMode, currentFolder]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  const refetchList = useCallback(() => {
    clearList(mediaListKey);
    fetchInitial(mediaListKey, () =>
      getMediaList(null, sortOrder, tags, folderParam, recursive, camera)
    );
  }, [
    clearList,
    fetchInitial,
    mediaListKey,
    sortOrder,
    tags,
    folderParam,
    recursive,
    camera,
  ]);

  const handleRefresh = useCallback(() => {
    setSeenRefreshKey(refreshKey);
    // Clear every cached media list (both sort orders, folder views), not
    // just the visible one, so switching sort later doesn't show stale data.
    clearListsByPrefix("media-");
    fetchInitial(mediaListKey, () =>
      getMediaList(null, sortOrder, tags, folderParam, recursive, camera)
    );
    void loadFolders();
  }, [
    refreshKey,
    clearListsByPrefix,
    fetchInitial,
    mediaListKey,
    sortOrder,
    tags,
    folderParam,
    recursive,
    camera,
    loadFolders,
  ]);

  const handleSortMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setSortMenuAnchorEl(event.currentTarget);
  };
  const handleSortMenuClose = () => {
    setSortMenuAnchorEl(null);
  };

  const handleCameraMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setCameraMenuAnchorEl(event.currentTarget);
    if (cameras.length === 0) {
      getCameras()
        .then(setCameras)
        .catch((err) => console.warn("Failed to load cameras:", err));
    }
  };
  const handleCameraSelect = (selected: CameraCount | null) => {
    updateParams({
      cam_make: selected?.make ?? null,
      cam_model: selected?.model ?? null,
    });
    setCameraMenuAnchorEl(null);
  };
  const handleSortChange = (newSortOrder: "newest" | "latest") => {
    updateParams({ sort: newSortOrder === "newest" ? null : newSortOrder });
    handleSortMenuClose();
  };

  const handleViewModeChange = (
    _event: React.MouseEvent<HTMLElement>,
    nextMode: "grid" | "folders" | null
  ) => {
    if (!nextMode) return;
    updateParams({
      view: nextMode === "grid" ? null : nextMode,
      folder: nextMode === "grid" ? null : currentFolder,
    });
    if (nextMode === "folders") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleFolderOpen = useCallback(
    (path: string) => {
      updateParams({ folder: path });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [updateParams]
  );

  const handleBreadcrumbNavigate = useCallback(
    (path: string | null) => {
      updateParams({ folder: path });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [updateParams]
  );

  const handleGoUp = useCallback(() => {
    if (!folderListing) return;
    handleBreadcrumbNavigate(folderListing.parent_path ?? null);
  }, [folderListing, handleBreadcrumbNavigate]);

  const breadcrumbItems = folderListing?.breadcrumbs ?? [];
  const directCount = folderListing?.direct_media_count ?? 0;

  return (
    <Container
      maxWidth="xl"
      sx={{
        minHeight: "100vh",
        py: 4,
        px: { xs: 2, sm: 3, md: 4 },
      }}
    >
      <MemoriesRail />
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        gap={2}
        mb={4}
        sx={{
          p: 2,
          borderRadius: 3,
          bgcolor: "background.paper",
          boxShadow: (theme) => theme.shadows[1],
          backdropFilter: "blur(12px)",
          background: (theme) => 
            `linear-gradient(to right bottom, ${theme.palette.background.paper}, ${theme.palette.background.default})`,
        }}
      >
        <ToggleButtonGroup
          size="medium"
          value={viewMode}
          exclusive
          onChange={handleViewModeChange}
          aria-label="View mode"
          sx={{ 
            '& .MuiToggleButton-root': { 
                border: 'none',
                borderRadius: 2,
                mx: 0.5,
                px: 2,
                py: 1,
                '&.Mui-selected': {
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': {
                        bgcolor: 'primary.dark',
                    }
                }
            } 
          }}
        >
          <ToggleButton value="grid" aria-label="grid view" sx={{ gap: 1 }}>
            <GridViewIcon />
            <Typography variant="button" component="span" sx={{ textTransform: 'none' }}>
              Grid
            </Typography>
          </ToggleButton>
          <ToggleButton
            value="folders"
            aria-label="Folder view"
            sx={{ gap: 1 }}
          >
            <FolderIcon fontSize="small" />
            <Typography variant="button" component="span" sx={{ textTransform: 'none' }}>
              Folders
            </Typography>
          </ToggleButton>
        </ToggleButtonGroup>

        <Box display="flex" alignItems="center" gap={1}>
          {hasNewItems && (
            <Chip
              color="primary"
              variant="outlined"
              icon={<RefreshIcon />}
              label="New items — Refresh"
              onClick={handleRefresh}
            />
          )}
          <Button
            onClick={handleCameraMenuOpen}
            color="inherit"
            startIcon={<CameraAltIcon />}
            sx={{
                bgcolor: camera ? 'action.selected' : 'action.hover',
                borderRadius: 2,
                px: 2,
                color: camera ? 'primary.main' : 'text.primary'
            }}
          >
            {camera ? camera.model || camera.make : "Camera"}
          </Button>
          <Menu
            anchorEl={cameraMenuAnchorEl}
            open={Boolean(cameraMenuAnchorEl)}
            onClose={() => setCameraMenuAnchorEl(null)}
            PaperProps={{
                elevation: 2,
                sx: { borderRadius: 2, mt: 1, minWidth: 220, maxHeight: 420 }
            }}
          >
            <MenuItem
              onClick={() => handleCameraSelect(null)}
              selected={!camera}
              sx={{ borderRadius: 1, mx: 1 }}
            >
              All cameras
            </MenuItem>
            {cameras.map((cam) => (
              <MenuItem
                key={`${cam.make}-${cam.model}`}
                onClick={() => handleCameraSelect(cam)}
                selected={
                  camera?.make === cam.make && camera?.model === cam.model
                }
                sx={{ borderRadius: 1, mx: 1 }}
              >
                {[cam.make, cam.model].filter(Boolean).join(" ")} ({cam.count})
              </MenuItem>
            ))}
          </Menu>
          <Button
            onClick={handleSortMenuOpen}
            color="inherit"
            startIcon={<SortIcon />}
            sx={{
                bgcolor: 'action.hover',
                borderRadius: 2,
                px: 2,
                color: 'text.primary'
            }}
          >
            Sort by: {MEDIA_SORT_LABELS[sortOrder]}
          </Button>
        </Box>
        <Menu
          anchorEl={sortMenuAnchorEl}
          open={Boolean(sortMenuAnchorEl)}
          onClose={handleSortMenuClose}
          PaperProps={{
              elevation: 2,
              sx: { borderRadius: 2, mt: 1, minWidth: 180 }
          }}
        >
          <MenuItem
            onClick={() => handleSortChange("newest")}
            selected={sortOrder === "newest"}
            sx={{ borderRadius: 1, mx: 1 }}
          >
            {MEDIA_SORT_LABELS.newest}
          </MenuItem>
          <MenuItem
            onClick={() => handleSortChange("latest")}
            selected={sortOrder === "latest"}
            sx={{ borderRadius: 1, mx: 1 }}
          >
            {MEDIA_SORT_LABELS.latest}
          </MenuItem>
        </Menu>
      </Box>

      {viewMode === "folders" && (
        <>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            flexWrap="wrap"
            gap={1}
            mb={2}
          >
            <Breadcrumbs aria-label="folder breadcrumb" sx={{ flexGrow: 1 }}>
              <MuiLink
                component="button"
                variant="body2"
                onClick={() => handleBreadcrumbNavigate(null)}
                sx={{ color: "inherit", textDecoration: "none" }}
              >
                All media
              </MuiLink>
              {breadcrumbItems.map((crumb, index) => {
                const isLast = index === breadcrumbItems.length - 1;
                const key = crumb.path ?? `${crumb.name}-${index}`;
                if (isLast) {
                  return (
                    <Typography
                      key={key}
                      variant="body2"
                      color="text.primary"
                    >
                      {crumb.name}
                    </Typography>
                  );
                }
                return (
                  <MuiLink
                    key={key}
                    component="button"
                    variant="body2"
                    onClick={() =>
                      handleBreadcrumbNavigate(crumb.path ?? null)
                    }
                    sx={{ color: "inherit", textDecoration: "none" }}
                  >
                    {crumb.name}
                  </MuiLink>
                );
              })}
            </Breadcrumbs>
            <Button
              variant="text"
              size="small"
              startIcon={<KeyboardArrowUpIcon />}
              onClick={handleGoUp}
              disabled={!folderListing?.current_path}
            >
              Up one level
            </Button>
          </Box>

          {folderError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {folderError}
            </Alert>
          )}

          {isFolderLoading ? (
            <Box textAlign="center" py={4}>
              <CircularProgress />
            </Box>
          ) : (
            <>
              <Box
                sx={{
                  display: "grid",
                  gap: 2,
                  gridTemplateColumns: {
                    xs: "repeat(auto-fill, minmax(200px, 1fr))",
                    sm: "repeat(auto-fill, minmax(220px, 1fr))",
                    md: "repeat(auto-fill, minmax(240px, 1fr))",
                  },
                  mb:
                    folderListing && folderListing.folders.length > 0
                      ? 2
                      : 0,
                }}
              >
                {folderListing?.folders.map((folder) => (
                  <FolderCard
                    key={folder.path}
                    folder={folder}
                    onOpen={handleFolderOpen}
                  />
                ))}
              </Box>
              {folderListing && folderListing.folders.length === 0 && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 2 }}
                >
                  No subfolders in this location.
                </Typography>
              )}
            </>
          )}

          {!isFolderLoading && folderListing && (
            <Typography
              variant="subtitle2"
              color="text.secondary"
              sx={{ mb: 1 }}
            >
              {directCount
                ? `${directCount} item${
                    directCount === 1 ? "" : "s"
                  } in this folder`
                : "No files directly in this folder"}
            </Typography>
          )}
        </>
      )}

      {listError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={refetchList}>
              Retry
            </Button>
          }
        >
          {listError}
        </Alert>
      )}

      {/* Loading Skeletons */}
      {items.length === 0 && isLoading && (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            // Approximate masonry layout with grid for skeletons
            gridTemplateColumns: {
               xs: "repeat(2, 1fr)",
               sm: "repeat(3, 1fr)",
               md: "repeat(4, 1fr)",
               lg: "repeat(5, 1fr)",
            }
          }}
        >
          {[...Array(15)].map((_, i) => (
            <Box key={i} sx={{ aspectRatio: "3/4" }}>
              <MediaSkeleton />
            </Box>
          ))}
        </Box>
      )}

      {/* Empty State */}
      {items.length === 0 && !isLoading && !listError && (
        <EmptyState
          icon={<SearchOffIcon />}
          title="No media found"
          description="Try adjusting your filters or adding new media."
        />
      )}

      {/* Media Grid */}
      {items.length > 0 && (
        <Masonry
          breakpointCols={breakpointColumnsObj}
          className="my-masonry-grid"
          columnClassName="my-masonry-grid_column"
        >
          {items.map((mediaItem) => (
            <div key={mediaItem.id}>
              <MediaCard media={mediaItem} mediaListKey={mediaListKey} />
            </div>
          ))}
        </Masonry>
      )}

      {/* Load More Spinner */}
      {items.length > 0 && isLoading && (
        <Box textAlign="center" py={3}>
          <CircularProgress />
        </Box>
      )}
      {hasMore && !listError && <Box ref={loaderRef} sx={{ height: "10px" }} />}
      {/* Scroll to Top FAB */}
      <Fade in={showScrollTop}>
        <Box
          onClick={scrollToTop}
          role="presentation"
          sx={{ position: "fixed", bottom: 24, right: 24, zIndex: 100 }}
        >
          <Fab size="small" color="primary" aria-label="scroll back to top">
            <KeyboardArrowUpIcon />
          </Fab>
        </Box>
      </Fade>
    </Container>
  );
}
