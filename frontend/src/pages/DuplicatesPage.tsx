import React, { useEffect, useMemo, useState } from "react";
import { useInView } from "react-intersection-observer";
import {
  Typography,
  Box,
  Button,
  CircularProgress,
  Alert,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@mui/material";
import Grid from "@mui/material/Grid";
import { useListStore, defaultListState } from "../stores/useListStore";
import { getDuplicates, getDuplicateStats } from "../services/duplicates";
import { DuplicateGroup } from "../components/DuplicateGroup"; // Our new smart component
import { DuplicateStats } from "../types";
import { useTaskCompletionVersion, useTaskEvents } from "../TaskEventsContext";
import { formatBytes } from "../formatUtils";

const DuplicatesPage: React.FC = () => {
  const [sortBy, setSortBy] = useState<"count" | "size">("count");
  const [mediaType, setMediaType] = useState<"" | "image" | "video">("");
  const [minCount, setMinCount] = useState<number>(2);

  const listKey = useMemo(
    () => `duplicate-groups-${sortBy}-${mediaType}-${minCount}`,
    [sortBy, mediaType, minCount]
  );

  const {
    items: duplicateGroups,
    hasMore,
    isLoading,
    error: listError,
  } = useListStore((state) => state.lists[listKey] || defaultListState);
  const { fetchInitial, loadMore, removeItem, clearList } = useListStore();
  const { ref: loaderRef, inView } = useInView({ threshold: 0.5 });
  const refreshKey = useTaskCompletionVersion(["find_duplicates", "generate_hashes"]);
  const { activeTasks } = useTaskEvents();
  const duplicateTask = activeTasks.find(
    (task) => task.task_type === "find_duplicates"
  );

  const hashTask = activeTasks.find(
    (task) => task.task_type === "generate_hashes"
  );

  const [stats, setStats] = useState<DuplicateStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const mt = mediaType || undefined;

  useEffect(() => {
    clearList(listKey);
    fetchInitial(listKey, () => getDuplicates(null, sortBy, mt, 10, minCount));
  }, [fetchInitial, listKey, clearList, refreshKey, sortBy, mt, minCount]);

  useEffect(() => {
    if (inView && hasMore && !isLoading) {
      loadMore(listKey, (cursor) => getDuplicates(cursor, sortBy, mt, 10, minCount));
    }
  }, [inView, hasMore, isLoading, loadMore, listKey, sortBy, mt, minCount]);

  useEffect(() => {
    if (!isLoading && hasMore && duplicateGroups.length === 0) {
      loadMore(listKey, (cursor) => getDuplicates(cursor, sortBy, mt, 10, minCount));
    }
  }, [duplicateGroups.length, hasMore, isLoading, loadMore, listKey, sortBy, mt, minCount]);

  useEffect(() => {
    let isActive = true;

    const loadStats = async () => {
      setIsLoadingStats(true);
      try {
        const result = await getDuplicateStats();
        if (isActive) {
          setStats(result);
          setStatsError(null);
        }
      } catch (error) {
        if (isActive) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to load duplicate statistics";
          setStatsError(message);
        }
      } finally {
        if (isActive) {
          setIsLoadingStats(false);
        }
      }
    };

    loadStats();

    return () => {
      isActive = false;
    };
  }, [refreshKey]);

  // This handler will be passed down to remove a whole group from the UI once it's resolved
  const handleGroupResolved = (groupId: number) => {
    removeItem(listKey, groupId);
    setIsLoadingStats(true);
    getDuplicateStats()
      .then((result) => {
        setStats(result);
        setStatsError(null);
      })
      .catch((error) => {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load duplicate statistics";
        setStatsError(message);
      })
      .finally(() => {
        setIsLoadingStats(false);
      });
  };

  const handleRetryLoad = () => {
    clearList(listKey);
    fetchInitial(listKey, () => getDuplicates(null, sortBy, mt, 10, minCount));
  };

  const formatNumber = (value: number) => value.toLocaleString();

  const typeLabel = (value: "image" | "video") =>
    value === "image" ? "Images" : "Videos";

  return (
    <Box sx={{ p: 2, maxWidth: "1600px", mx: "auto" }}>
      <Typography variant="h4" gutterBottom>
        Potential Duplicates
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        Start duplicate detection from the control panel in the header; progress
        is tracked there and this list refreshes when a run completes.
      </Alert>

      {duplicateTask && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Duplicate detection running... {duplicateTask.processed}/{duplicateTask.total}
          {duplicateTask.current_step ? " (" + duplicateTask.current_step + ")" : ""}
        </Alert>
      )}

      {hashTask && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Hash generation running... {hashTask.processed}/{hashTask.total}
          {hashTask.current_step ? " (" + hashTask.current_step + ")" : ""}
        </Alert>
      )}

      {statsError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {statsError}
        </Alert>
      )}

      {isLoadingStats && !stats && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
          <CircularProgress size={20} />
          <Typography variant="body2">
            Loading duplicate statistics...
          </Typography>
        </Box>
      )}

      {stats && (
        <Box sx={{ mb: 3, display: "flex", flexDirection: "column", gap: 2 }}>
          {isLoadingStats && (
            <Typography variant="caption" color="text.secondary">
              Refreshing statistics...
            </Typography>
          )}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Duplicate Groups
                </Typography>
                <Typography variant="h5">
                  {formatNumber(stats.total_groups)}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Duplicate Files
                </Typography>
                <Typography variant="h5">
                  {formatNumber(stats.total_items)}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Duplicate Size
                </Typography>
                <Typography variant="h5">
                  {formatBytes(stats.total_size_bytes)}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Potential Reclaim
                </Typography>
                <Typography variant="h5">
                  {formatBytes(stats.total_reclaimable_bytes)}
                </Typography>
              </Paper>
            </Grid>
          </Grid>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Media Type Breakdown
            </Typography>
            {stats.type_breakdown.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No duplicate media detected yet.
              </Typography>
            ) : (
              <Grid container spacing={2}>
                {stats.type_breakdown.map((entry) => (
                  <Grid key={entry.type} item xs={12} sm={6} md={4}>
                    <Box sx={{ display: "flex", flexDirection: "column" }}>
                      <Typography variant="body1">
                        {typeLabel(entry.type)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {formatNumber(entry.items)} items | {formatBytes(entry.size_bytes)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatNumber(entry.groups)} groups
                      </Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            )}
          </Paper>
          {stats.top_folders.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography
                variant="subtitle2"
                color="text.secondary"
                gutterBottom
              >
                Top Folders by Duplicates
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                {stats.top_folders.map((folder) => (
                  <Box
                    key={folder.folder}
                    sx={{
                      display: "flex",
                      flexDirection: { xs: "column", md: "row" },
                      justifyContent: "space-between",
                      gap: 0.5,
                    }}
                  >
                    <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                      {folder.folder}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatNumber(folder.items)} items | {formatBytes(folder.size_bytes)} | {formatNumber(folder.groups)} groups
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Paper>
          )}
        </Box>
      )}

      <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap", alignItems: "center" }}>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Media Type</InputLabel>
          <Select
            value={mediaType}
            label="Media Type"
            onChange={(e) => setMediaType(e.target.value as "" | "image" | "video")}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="image">Images</MenuItem>
            <MenuItem value="video">Videos</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Sort By</InputLabel>
          <Select
            value={sortBy}
            label="Sort By"
            onChange={(e) => setSortBy(e.target.value as "count" | "size")}
          >
            <MenuItem value="count">Most Files</MenuItem>
            <MenuItem value="size">Largest Size</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Min. Copies</InputLabel>
          <Select
            value={minCount}
            label="Min. Copies"
            onChange={(e) => setMinCount(Number(e.target.value))}
          >
            <MenuItem value={2}>Any (2+)</MenuItem>
            <MenuItem value={3}>3 or more</MenuItem>
            <MenuItem value={4}>4 or more</MenuItem>
            <MenuItem value={5}>5 or more</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {isLoading && duplicateGroups.length === 0 ? (
        <Box sx={{ display: "flex", justifyContent: "center", my: 4 }}>
          <CircularProgress />
        </Box>
      ) : listError && duplicateGroups.length === 0 ? (
        <Alert
          severity="error"
          sx={{ my: 4 }}
          action={
            <Button color="inherit" size="small" onClick={handleRetryLoad}>
              Retry
            </Button>
          }
        >
          {listError}
        </Alert>
      ) : duplicateGroups.length === 0 ? (
        <Typography align="center" sx={{ my: 4 }}>
          No duplicates found.
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {duplicateGroups.map(
            (group) =>
              group.items.length > 1 && (
                <DuplicateGroup
                  key={group.group_id}
                  group={group}
                  onGroupResolved={() => handleGroupResolved(group.group_id)}
                />
              )
          )}
          {hasMore && <Box ref={loaderRef} sx={{ height: "1px" }} />}
        </Box>
      )}
    </Box>
  );

};

export default DuplicatesPage;
