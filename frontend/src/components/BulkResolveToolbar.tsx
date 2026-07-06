import React, { useState } from "react";
import {
  Button,
  Divider,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import BlockIcon from "@mui/icons-material/Block";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";

import ConfirmDialog from "./ConfirmDialog";
import { formatBytes } from "../formatUtils";

export type BulkResolveAction = "DELETE_FILES" | "DELETE_RECORDS" | "BLACKLIST_RECORDS";

export type FeedbackSeverity = "success" | "error" | "warning";

export const resolveConfirmCopy = (action: BulkResolveAction, count: number) => {
  switch (action) {
    case "DELETE_FILES":
      return {
        title: "Delete files from disk",
        message: `Permanently delete ${count} file(s) from disk and remove them from the library. This cannot be undone.`,
        confirmLabel: "Delete files",
      };
    case "DELETE_RECORDS":
      return {
        title: "Remove records",
        message: `Remove ${count} record(s) from the library. The files stay on disk and may be re-imported by a future scan.`,
        confirmLabel: "Remove records",
      };
    case "BLACKLIST_RECORDS":
      return {
        title: "Blacklist items",
        message: `Blacklist ${count} item(s) so they are never re-imported and remove their records from the library. The files stay on disk.`,
        confirmLabel: "Blacklist",
      };
  }
};

interface BulkResolveToolbarProps {
  statsText: string;
  shownCount: number;
  shownSize: number;
  total: number;
  selectedIds: Set<number>;
  onSelectVisible: () => void;
  onClearSelection: () => void;
  resolve: (params: {
    action: BulkResolveAction;
    mediaIds?: number[];
    selectAll?: boolean;
  }) => Promise<{ removed: number }>;
  onResolved: (removedIds: number[], removed: number, selectAll: boolean) => void;
  onFeedback: (message: string, severity: FeedbackSeverity) => void;
  extraActions?: React.ReactNode;
}

const BulkResolveToolbar: React.FC<BulkResolveToolbarProps> = ({
  statsText,
  shownCount,
  shownSize,
  total,
  selectedIds,
  onSelectVisible,
  onClearSelection,
  resolve,
  onResolved,
  onFeedback,
  extraActions,
}) => {
  const [pending, setPending] = useState<{ action: BulkResolveAction; selectAll: boolean } | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [allMenuAnchor, setAllMenuAnchor] = useState<null | HTMLElement>(null);

  const selectedCount = selectedIds.size;

  const requestAction = (action: BulkResolveAction, selectAll = false) => {
    setAllMenuAnchor(null);
    if (!selectAll && selectedCount === 0) return;
    setPending({ action, selectAll });
  };

  const handleConfirm = async () => {
    if (!pending) return;
    const ids = pending.selectAll ? [] : Array.from(selectedIds);
    setIsActionLoading(true);
    try {
      const { removed } = await resolve(
        pending.selectAll
          ? { action: pending.action, selectAll: true }
          : { action: pending.action, mediaIds: ids }
      );
      if (removed > 0) {
        onFeedback(`${removed} item(s) processed`, "success");
      } else {
        onFeedback("No items matched", "warning");
      }
      onResolved(ids, removed, pending.selectAll);
      setPending(null);
    } catch (e) {
      onFeedback(e instanceof Error ? e.message : "Action failed", "error");
      setPending(null);
    } finally {
      setIsActionLoading(false);
    }
  };

  const copy = pending
    ? resolveConfirmCopy(pending.action, pending.selectAll ? total : selectedCount)
    : null;

  return (
    <>
      <Paper variant="outlined" sx={{ mb: 3, position: "sticky", top: 64, zIndex: 10 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          alignItems={{ md: "center" }}
          justifyContent="space-between"
          sx={{ p: 2 }}
        >
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
            <Typography variant="subtitle1">{statsText}</Typography>
            <Typography variant="body2" color="text.secondary">
              shown: {shownCount} · {formatBytes(shownSize)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              selected: {selectedCount}
            </Typography>
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button
              size="small"
              startIcon={<SelectAllIcon />}
              onClick={onSelectVisible}
              disabled={shownCount === 0}
            >
              Select visible
            </Button>
            <Button
              size="small"
              startIcon={<ClearAllIcon />}
              onClick={onClearSelection}
              disabled={selectedCount === 0}
            >
              Clear selection
            </Button>
            {extraActions}
            <Divider flexItem orientation="vertical" sx={{ display: { xs: "none", sm: "block" } }} />
            <Tooltip title="Delete files from disk">
              <span>
                <Button
                  size="small"
                  variant="contained"
                  color="error"
                  startIcon={<DeleteForeverIcon />}
                  onClick={() => requestAction("DELETE_FILES")}
                  disabled={selectedCount === 0 || isActionLoading}
                >
                  Delete files
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Remove records from library (keep files)">
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => requestAction("DELETE_RECORDS")}
                  disabled={selectedCount === 0 || isActionLoading}
                >
                  Remove records
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Blacklist and remove from library">
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<BlockIcon />}
                  onClick={() => requestAction("BLACKLIST_RECORDS")}
                  disabled={selectedCount === 0 || isActionLoading}
                >
                  Blacklist
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Apply an action to every item matching the current filters, not just the loaded ones">
              <span>
                <Button
                  size="small"
                  color="error"
                  endIcon={<ArrowDropDownIcon />}
                  onClick={(e) => setAllMenuAnchor(e.currentTarget)}
                  disabled={total === 0 || isActionLoading}
                >
                  All {total.toLocaleString()} matching
                </Button>
              </span>
            </Tooltip>
            <Menu
              anchorEl={allMenuAnchor}
              open={Boolean(allMenuAnchor)}
              onClose={() => setAllMenuAnchor(null)}
            >
              <MenuItem onClick={() => requestAction("DELETE_FILES", true)}>
                Delete all {total.toLocaleString()} files
              </MenuItem>
              <MenuItem onClick={() => requestAction("DELETE_RECORDS", true)}>
                Remove all {total.toLocaleString()} records
              </MenuItem>
              <MenuItem onClick={() => requestAction("BLACKLIST_RECORDS", true)}>
                Blacklist all {total.toLocaleString()}
              </MenuItem>
            </Menu>
          </Stack>
        </Stack>
      </Paper>

      <ConfirmDialog
        open={Boolean(pending)}
        title={copy?.title ?? ""}
        message={copy?.message ?? ""}
        confirmLabel={copy?.confirmLabel}
        loading={isActionLoading}
        onConfirm={handleConfirm}
        onClose={() => setPending(null)}
      />
    </>
  );
};

export default BulkResolveToolbar;
