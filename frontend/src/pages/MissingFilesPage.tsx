import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Checkbox,
} from "@mui/material";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import UndoIcon from "@mui/icons-material/Undo";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import ClearAllIcon from "@mui/icons-material/ClearAll";

import { MissingMediaItem, MissingSummaryEntry } from "../types";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";
import {
  confirmMissing,
  getMissingMedia,
  resetMissingFlags,
} from "../services/missing";
import { useTaskCompletionVersion, useTaskEvents } from "../TaskEventsContext";

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
};

const formatDuration = (iso: string | null) => {
  if (!iso) return "unknown";
  const date = new Date(iso+"Z");
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return date.toLocaleString();
  const diffHours = Math.floor(diffMs / 3_600_000);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 8) return `${diffWeeks}w ago`;
  return date.toLocaleTimeString();
};

const buildThumbUrl = (item: MissingMediaItem) => {
  const thumb = item.thumbnail_path
    ? encodeFilePath(item.thumbnail_path)
    : `${item.id}.jpg`;
  return `${API}/thumbnails/${thumb}`;
};
const MissingFilesPage: React.FC = () => {
  const [items, setItems] = useState<MissingMediaItem[]>([]);
  const [summary, setSummary] = useState<MissingSummaryEntry[]>([]);
  const [totalMissing, setTotalMissing] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error";
  }>({ open: false, message: "", severity: "success" });

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [pathFilter, setPathFilter] = useState("");
  const [includeConfirmed, setIncludeConfirmed] = useState(false);

  const refreshKey = useTaskCompletionVersion(["clean_missing_files"]);
  const { activeTasks } = useTaskEvents();
  const cleanupTask = activeTasks.find(
    (task) => task.task_type === "clean_missing_files"
  );

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const fetchMissing = useCallback(
    async (cursor: string | null, append: boolean) => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await getMissingMedia({
          cursor,
          pathPrefix: pathFilter.trim() || undefined,
          includeConfirmed,
        });
        setItems((prev) =>
          append ? [...prev, ...response.items] : response.items
        );
        setSummary(response.summary);
        setTotalMissing(response.total);
        setNextCursor(response.next_cursor);
        setHasMore(Boolean(response.next_cursor));
        if (!append) {
          clearSelection();
        }
      } catch (err) {
        console.error(err);
        setError(
          err instanceof Error ? err.message : "Failed to load missing files"
        );
      } finally {
        setIsLoading(false);
      }
    },
    [pathFilter, includeConfirmed, clearSelection]
  );

  useEffect(() => {
    fetchMissing(null, false);
  }, [fetchMissing, refreshKey]);

  useEffect(() => {
    const t = setTimeout(() => fetchMissing(null, false), 300);
    return () => clearTimeout(t);
  }, [pathFilter, includeConfirmed, fetchMissing]);

  const toggleSelection = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(items.map((item) => item.id)));
  };

  const handleConfirmSelected = async () => {
    if (selectedIds.size === 0) return;
    setIsActionLoading(true);
    try {
      await confirmMissing({ media_ids: Array.from(selectedIds) });
      setSnackbar({
        open: true,
        message: `Removed ${selectedIds.size} media record(s)`,
        severity: "success",
      });
      await fetchMissing(null, false);
    } catch (err) {
      setSnackbar({
        open: true,
        message:
          err instanceof Error
            ? err.message
            : "Failed to confirm missing media",
        severity: "error",
      });
    } finally {
      setIsActionLoading(false);
    }
  };
  const handleResetSelected = async () => {
    if (selectedIds.size === 0) return;
    setIsActionLoading(true);
    try {
      await resetMissingFlags({ media_ids: Array.from(selectedIds) });
      setSnackbar({
        open: true,
        message: `Cleared missing status for ${selectedIds.size} item(s)`,
        severity: "success",
      });
      await fetchMissing(null, false);
    } catch (err) {
      setSnackbar({
        open: true,
        message:
          err instanceof Error ? err.message : "Failed to reset missing status",
        severity: "error",
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleConfirmAllFiltered = async () => {
    if (
      !window.confirm("Remove all missing items matching the current filters?")
    ) {
      return;
    }
    setIsActionLoading(true);
    try {
      await confirmMissing({
        select_all: true,
        path_prefix: pathFilter.trim() || undefined,
        include_confirmed: includeConfirmed,
      });
      setSnackbar({
        open: true,
        message: "Removed all filtered missing media",
        severity: "success",
      });
      await fetchMissing(null, false);
    } catch (err) {
      setSnackbar({
        open: true,
        message:
          err instanceof Error
            ? err.message
            : "Failed to confirm filtered media",
        severity: "error",
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleResetAllFiltered = async () => {
    if (
      !window.confirm(
        "Clear missing status for all items matching the current filters?"
      )
    ) {
      return;
    }
    setIsActionLoading(true);
    try {
      await resetMissingFlags({
        select_all: true,
        path_prefix: pathFilter.trim() || undefined,
        include_confirmed: includeConfirmed,
      });
      setSnackbar({
        open: true,
        message: "Cleared missing status for filtered media",
        severity: "success",
      });
      await fetchMissing(null, false);
    } catch (err) {
      setSnackbar({
        open: true,
        message:
          err instanceof Error ? err.message : "Failed to reset filtered media",
        severity: "error",
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const selectedCount = selectedIds.size;

  return (
    <Box sx={{ p: 3, maxWidth: "1400px", mx: "auto" }}>
      <Typography variant="h4" gutterBottom>
        Missing Media Review
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
        Review items whose files are currently missing before removing them from
        your library. Use bulk actions to confirm deletions or clear items once
        the files are restored.
      </Typography>

      {cleanupTask && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Cleanup task in progress (processed {cleanupTask.processed}/
          {cleanupTask.total}). This list will refresh automatically when it
          finishes.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          alignItems={{ xs: "flex-start", md: "center" }}
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="h6">{totalMissing} files flagged</Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={includeConfirmed}
                  onChange={(e) => setIncludeConfirmed(e.target.checked)}
                  color="primary"
                />
              }
              label="Include confirmed"
            />
          </Stack>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            alignItems={{ xs: "stretch", sm: "center" }}
          >
            <TextField
              size="small"
              label="Path filter"
              value={pathFilter}
              onChange={(e) => setPathFilter(e.target.value)}
              placeholder="Enter a directory prefix"
              InputProps={{
                endAdornment: <FilterAltIcon color="action" fontSize="small" />,
              }}
              sx={{ minWidth: 260 }}
            />
            <Button
              variant="outlined"
              startIcon={<SelectAllIcon />}
              onClick={selectAllVisible}
              disabled={items.length === 0}
            >
              Select visible
            </Button>
            <Button
              variant="text"
              startIcon={<ClearAllIcon />}
              onClick={clearSelection}
              disabled={selectedCount === 0}
            >
              Clear selection
            </Button>
          </Stack>
        </Stack>
        {summary.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>
              Top folders with missing files
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {summary.map((entry) => (
                <Chip
                  key={entry.folder}
                  label={`${entry.folder} (${entry.count})`}
                  onClick={() => setPathFilter(entry.folder)}
                />
              ))}
            </Stack>
          </>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.5}
          alignItems={{ xs: "stretch", md: "center" }}
          justifyContent="space-between"
          sx={{ p: 2 }}
        >
          <Typography variant="subtitle1">
            Selected: {selectedCount} / {items.length}
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button
              variant="contained"
              color="error"
              startIcon={<DoneAllIcon />}
              onClick={handleConfirmSelected}
              disabled={selectedCount === 0 || isActionLoading}
            >
              Confirm selected
            </Button>
            <Button
              variant="outlined"
              startIcon={<UndoIcon />}
              onClick={handleResetSelected}
              disabled={selectedCount === 0 || isActionLoading}
            >
              Mark selected as found
            </Button>
            <Divider
              flexItem
              orientation="vertical"
              sx={{ display: { xs: "none", sm: "block" } }}
            />
            <Button
              variant="text"
              color="error"
              onClick={handleConfirmAllFiltered}
              disabled={isActionLoading || totalMissing === 0}
            >
              Confirm all filtered
            </Button>
            <Button
              variant="text"
              onClick={handleResetAllFiltered}
              disabled={isActionLoading || totalMissing === 0}
            >
              Clear all filtered
            </Button>
          </Stack>
        </Stack>
        <Divider />
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={
                      selectedCount > 0 && selectedCount < items.length
                    }
                    checked={items.length > 0 && selectedCount === items.length}
                    onChange={() => {
                      if (selectedCount === items.length) {
                        clearSelection();
                      } else {
                        selectAllVisible();
                      }
                    }}
                  />
                </TableCell>
                <TableCell>Preview</TableCell>
                <TableCell>File</TableCell>
                <TableCell>Folder</TableCell>
                <TableCell align="right">Size</TableCell>
                <TableCell>Missing since</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => {
                const selected = selectedIds.has(item.id);
                return (
                  <TableRow key={item.id} hover selected={selected}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selected}
                        onChange={() => toggleSelection(item.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <Box
                        sx={{
                          width: 56,
                          height: 56,
                          borderRadius: 1,
                          overflow: "hidden",
                          bgcolor: "action.hover",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Box
                          component="img"
                          src={buildThumbUrl(item)}
                          alt={item.filename}
                          sx={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            display: "block",
                          }}
                          onError={(e) => {
                            e.currentTarget.style.visibility = "hidden";
                          }}
                        />
                      </Box>
                    </TableCell>
                    <TableCell sx={{ fontFamily: "monospace" }}>
                      {item.filename}
                    </TableCell>
                    <TableCell sx={{ fontFamily: "monospace" }}>
                      {item.parent_directory}
                    </TableCell>
                    <TableCell align="right">
                      {formatBytes(item.size)}
                    </TableCell>
                    <TableCell>
                      {item.missing_since
                        ? `${formatDuration(item.missing_since)} (${new Date(item.missing_since).toLocaleString()})`
                        : "unknown"}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    No missing files match the current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        {isLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {!isLoading && hasMore && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
            <Button
              onClick={() => fetchMissing(nextCursor, true)}
              disabled={!nextCursor}
            >
              Load more
            </Button>
          </Box>
        )}
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default MissingFilesPage;
