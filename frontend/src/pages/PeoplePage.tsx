import React, { useCallback, useEffect, useState } from "react";
import {
  Container,
  Box,
  Typography,
  CircularProgress,
  Button,
  Stack,
  Snackbar,
  Alert,
} from "@mui/material";
import Grid from "@mui/material/Grid";
import { CursorResponse, useInfinite } from "../hooks/useInfinite";
import PersonCard from "../components/PersonCard";
import ConfirmDialog from "../components/ConfirmDialog";
import { PersonReadSimple } from "../types";
import config from "../config";
import { getPeople } from "../services/person";
import { deletePersonsBulk } from "../services/personActions";
import { useTaskCompletionVersion } from "../TaskEventsContext";

export default function PeoplePage() {
  const fetchPeople = useCallback(
    async (cursor?: string): Promise<CursorResponse<PersonReadSimple>> => {
      const data = await getPeople(cursor);
      return { items: data.items, next_cursor: data.next_cursor };
    },
    [],
  );

  const refreshKey = useTaskCompletionVersion([
    "process_media",
    "cluster_persons",
  ]);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    new Set<number>(),
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error";
  }>({ open: false, message: "", severity: "success" });

  const {
    items: people,
    setItems,
    hasMore,
    loading,
    error,
    loaderRef,
  } = useInfinite<PersonReadSimple>(fetchPeople, [refreshKey, retryKey]);

  useEffect(() => {
    setSelectedIds((previous) => {
      if (previous.size === 0) {
        return previous;
      }
      const available = new Set(people.map((person) => person.id));
      let changed = false;
      const next = new Set<number>();
      previous.forEach((id) => {
        if (available.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [people]);

  if (!config.ENABLE_PEOPLE) {
    return (
      <Typography variant="h5" color="text.primary" gutterBottom>
        People disabled!
      </Typography>
    );
  }

  if (loading && people.length === 0) {
    return (
      <Box textAlign="center" py={4}>
        <CircularProgress color="secondary" />
      </Box>
    );
  }

  const handleSelectionModeToggle = () => {
    setSelectionMode((prev) => {
      if (prev) {
        setSelectedIds(new Set<number>());
        return false;
      }
      return true;
    });
  };

  const handleToggleSelect = (personId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }
      return next;
    });
  };

  const handleDeleteSelected = () => {
    if (!selectionMode || selectedIds.size === 0) {
      return;
    }
    setConfirmDeleteOpen(true);
  };

  const handleConfirmDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      setConfirmDeleteOpen(false);
      return;
    }

    setIsDeleting(true);
    try {
      const result = await deletePersonsBulk(ids);
      const deletedSet = new Set(result.deleted_ids);
      const deletedCount = deletedSet.size;

      if (deletedCount > 0) {
        setItems((prev) => prev.filter((person) => !deletedSet.has(person.id)));
      }

      setSelectedIds((prev) => {
        if (deletedCount === 0) {
          return prev;
        }
        const next = new Set(prev);
        deletedSet.forEach((id) => next.delete(id));
        return next;
      });

      if (deletedCount > 0 && deletedCount === ids.length) {
        setSelectionMode(false);
        setSelectedIds(new Set<number>());
      }

      const parts: string[] = [];
      if (deletedCount > 0) {
        parts.push(
          `Deleted ${deletedCount} person${deletedCount === 1 ? "" : "s"}.`,
        );
      }
      if (result.skipped_ids.length > 0) {
        parts.push(
          `${result.skipped_ids.length} person${result.skipped_ids.length === 1 ? "" : "s"} skipped.`,
        );
      }
      const message = parts.join(" ") || "No people were deleted.";
      setSnackbar({
        open: true,
        message,
        severity: deletedCount > 0 ? "success" : "error",
      });
    } catch (error) {
      console.error("Failed to delete selected people", error);
      setSnackbar({
        open: true,
        message: "Failed to delete selected people",
        severity: "error",
      });
    } finally {
      setIsDeleting(false);
      setConfirmDeleteOpen(false);
    }
  };

  const handleCloseSnackbar = () =>
    setSnackbar((prev) => ({ ...prev, open: false }));

  const selectedCount = selectedIds.size;

  return (
    <Container
      maxWidth={false}
      sx={{ pt: 4, pb: 6, bgcolor: "background.default", px: 4 }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        sx={{ mb: 3 }}
      >
        <Typography variant="h5" color="text.primary">
          People
        </Typography>
        <Stack direction="row" spacing={1.5} alignItems="center">
          {selectionMode && (
            <Typography variant="body2" color="text.secondary">
              {selectedCount} selected
            </Typography>
          )}
          <Button
            variant="outlined"
            size="small"
            onClick={handleSelectionModeToggle}
          >
            {selectionMode ? "Cancel Selection" : "Select People"}
          </Button>
          <Button
            variant="contained"
            color="error"
            size="small"
            onClick={handleDeleteSelected}
            disabled={!selectionMode || selectedCount === 0 || isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete Selected"}
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => setRetryKey((prev) => prev + 1)}
            >
              Retry
            </Button>
          }
        >
          Failed to load people: {error}
        </Alert>
      )}

      <Grid container spacing={3} alignItems="stretch">
        {people.map((person) => (
          <Grid key={person.id} size={{ xs: 6, sm: 4, md: 2, lg: 1.5 }}>
            <PersonCard
              person={person}
              selectable={selectionMode}
              selected={selectionMode && selectedIds.has(person.id)}
              onToggleSelect={handleToggleSelect}
            />
          </Grid>
        ))}
      </Grid>

      {loading && (
        <Box textAlign="center" py={2}>
          <CircularProgress color="secondary" />
        </Box>
      )}

      {!loading && hasMore && (
        <Box
          ref={loaderRef}
          textAlign="center"
          py={2}
          sx={{ color: "text.secondary" }}
        >
          Scroll to load more...
        </Box>
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete Selected People"
        message={`Delete ${selectedCount} selected person${selectedCount === 1 ? "" : "s"}? This cannot be undone.`}
        confirmLabel="Delete"
        loading={isDeleting}
        onConfirm={handleConfirmDeleteSelected}
        onClose={() => setConfirmDeleteOpen(false)}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
}
