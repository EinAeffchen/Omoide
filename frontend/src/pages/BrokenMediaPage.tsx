import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import BlockIcon from "@mui/icons-material/Block";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import ReplayIcon from "@mui/icons-material/Replay";

import { BrokenMediaItem } from "../types";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";
import { getBrokenMedia, resolveBroken, retryBroken } from "../services/broken";
import ConfirmDialog from "../components/ConfirmDialog";
import { resolveConfirmCopy, BulkResolveAction, FeedbackSeverity } from "../components/BulkResolveToolbar";
import { formatBytes } from "../formatUtils";

const buildThumbUrl = (item: BrokenMediaItem) =>
  `${API}/thumbnails/${item.thumbnail_path ? encodeFilePath(item.thumbnail_path) : `${item.id}.jpg`}`;

const BrokenMediaPage: React.FC = () => {
  const [items, setItems] = useState<BrokenMediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [pendingAction, setPendingAction] = useState<{
    action: BulkResolveAction;
    selectAll: boolean;
  } | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: FeedbackSeverity;
  }>({ open: false, message: "", severity: "success" });

  const fetchBroken = useCallback(
    async (cursor: string | null, append: boolean) => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await getBrokenMedia({ cursor });
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setTotal(data.total);
        setNextCursor(data.next_cursor);
        if (!append) setSelectedIds(new Set());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load broken media");
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchBroken(null, false);
  }, [fetchBroken]);

  const toggleSelection = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectAllVisible = () => setSelectedIds(new Set(items.map((i) => i.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const removeLocalItems = (ids: number[], removed: number) => {
    const idSet = new Set(ids);
    setItems((prev) => prev.filter((item) => !idSet.has(item.id)));
    setTotal((prev) => Math.max(0, prev - removed));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const requestAction = (action: BulkResolveAction, selectAll = false) => {
    if ((selectAll ? total : selectedIds.size) === 0) return;
    setPendingAction({ action, selectAll });
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) return;
    const ids = pendingAction.selectAll ? [] : Array.from(selectedIds);
    setIsActionLoading(true);
    try {
      const payload = pendingAction.selectAll
        ? { select_all: true, action: pendingAction.action }
        : { media_ids: ids, action: pendingAction.action };
      const result = await resolveBroken(payload);
      setSnackbar({
        open: true,
        message: result.removed > 0 ? `${result.removed} item(s) processed` : "No items matched",
        severity: result.removed > 0 ? "success" : "warning",
      });
      if (pendingAction.selectAll) {
        await fetchBroken(null, false);
      } else {
        removeLocalItems(ids, result.removed);
      }
      setPendingAction(null);
    } catch (err) {
      setSnackbar({
        open: true,
        message: err instanceof Error ? err.message : "Action failed",
        severity: "error",
      });
      setPendingAction(null);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRetry = async (selectAll = false) => {
    const count = selectAll ? total : selectedIds.size;
    if (count === 0) return;

    setIsActionLoading(true);
    try {
      const payload = selectAll
        ? { select_all: true }
        : { media_ids: Array.from(selectedIds) };
      // The server retries at most a small batch per call and reports how many
      // matching items are left; keep going while batches still recover items.
      let retried = 0;
      let cleared = 0;
      let stillBroken = 0;
      for (;;) {
        const result = await retryBroken(payload);
        retried += result.retried;
        cleared += result.cleared;
        stillBroken += result.still_broken;
        if (!result.remaining || result.cleared === 0) break;
      }
      setSnackbar({
        open: true,
        message: `Retried ${retried} item(s): ${cleared} recovered, ${stillBroken} still broken`,
        severity: cleared > 0 ? "success" : "warning",
      });
      await fetchBroken(null, false);
    } catch (err) {
      setSnackbar({
        open: true,
        message: err instanceof Error ? err.message : "Retry failed",
        severity: "error",
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const selectedCount = selectedIds.size;
  const allVisibleSelected = items.length > 0 && selectedCount === items.length;
  const pendingCopy = pendingAction
    ? resolveConfirmCopy(pendingAction.action, pendingAction.selectAll ? total : selectedCount)
    : null;

  return (
    <Box sx={{ p: 3, maxWidth: "1400px", mx: "auto" }}>
      <Typography variant="h4" gutterBottom>
        Broken Media
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
        These files could not be processed — frames could not be extracted, making
        them unsearchable. Review the error, then delete or blacklist them.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems={{ xs: "flex-start", sm: "center" }}
          justifyContent="space-between"
        >
          <Typography variant="h6">{total} file(s) with processing errors</Typography>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              startIcon={<SelectAllIcon />}
              onClick={selectAllVisible}
              disabled={items.length === 0}
            >
              Select visible
            </Button>
            <Button
              size="small"
              startIcon={<ClearAllIcon />}
              onClick={clearSelection}
              disabled={selectedCount === 0}
            >
              Clear selection
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ xs: "stretch", sm: "center" }}
          justifyContent="space-between"
          sx={{ p: 2 }}
        >
          <Typography variant="subtitle1">
            Selected: {selectedCount} / {items.length}
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} flexWrap="wrap">
            <Tooltip title="Remove the DB record but keep the file on disk">
              <span>
                <Button
                  variant="outlined"
                  startIcon={<DeleteIcon />}
                  onClick={() => requestAction("DELETE_RECORDS")}
                  disabled={selectedCount === 0 || isActionLoading}
                >
                  Remove records
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Delete the file from disk and remove the DB record">
              <span>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteForeverIcon />}
                  onClick={() => requestAction("DELETE_FILES")}
                  disabled={selectedCount === 0 || isActionLoading}
                >
                  Delete files
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Blacklist the path so it is never re-imported, and remove the DB record">
              <span>
                <Button
                  variant="contained"
                  color="error"
                  startIcon={<BlockIcon />}
                  onClick={() => requestAction("BLACKLIST_RECORDS")}
                  disabled={selectedCount === 0 || isActionLoading}
                >
                  Blacklist
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Re-attempt thumbnail generation; clears the error and requeues for processing if successful">
              <span>
                <Button
                  variant="outlined"
                  color="primary"
                  startIcon={<ReplayIcon />}
                  onClick={() => handleRetry()}
                  disabled={selectedCount === 0 || isActionLoading}
                >
                  Retry
                </Button>
              </span>
            </Tooltip>
            {total > 0 && (
              <>
                <Divider flexItem orientation="vertical" sx={{ display: { xs: "none", sm: "block" } }} />
                <Button
                  variant="text"
                  color="error"
                  startIcon={<BlockIcon />}
                  onClick={() => requestAction("BLACKLIST_RECORDS", true)}
                  disabled={isActionLoading}
                >
                  Blacklist all
                </Button>
                <Button
                  variant="text"
                  color="primary"
                  startIcon={<ReplayIcon />}
                  onClick={() => handleRetry(true)}
                  disabled={isActionLoading}
                >
                  Retry all
                </Button>
              </>
            )}
          </Stack>
        </Stack>

        <Divider />

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={selectedCount > 0 && !allVisibleSelected}
                    checked={allVisibleSelected}
                    onChange={() =>
                      allVisibleSelected ? clearSelection() : selectAllVisible()
                    }
                  />
                </TableCell>
                <TableCell>Preview</TableCell>
                <TableCell>File</TableCell>
                <TableCell>Folder</TableCell>
                <TableCell align="right">Size</TableCell>
                <TableCell>Error</TableCell>
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
                          loading="lazy"
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
                    <TableCell align="right">{formatBytes(item.size)}</TableCell>
                    <TableCell
                      sx={{
                        maxWidth: 400,
                        color: "error.main",
                        fontFamily: "monospace",
                        fontSize: "0.75rem",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {item.processing_error}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    No broken media found. All files processed successfully.
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
        {!isLoading && nextCursor && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
            <Button onClick={() => fetchBroken(nextCursor, true)}>
              Load more
            </Button>
          </Box>
        )}
      </Paper>

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingCopy?.title ?? ""}
        message={pendingCopy?.message ?? ""}
        confirmLabel={pendingCopy?.confirmLabel}
        loading={isActionLoading}
        onConfirm={handleConfirmAction}
        onClose={() => setPendingAction(null)}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((p) => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setSnackbar((p) => ({ ...p, open: false }))}
          severity={snackbar.severity}
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default BrokenMediaPage;
