import { useState, useEffect, useCallback } from "react";
import {
  Container,
  Box,
  Typography,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  DialogActions,
  Button,
  Stack,
  Paper,
  Autocomplete,
  Avatar,
  Alert,
  Snackbar,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useListStore } from "../stores/useListStore";
import { usePagedList } from "../hooks/usePagedList";
import { isAbortError } from "../services/api";
import { getOrphanFaces } from "../services/face";
import {
  assignFace,
  createPersonFromFaces,
  deleteFace,
} from "../services/faceActions";
import { searchPersonsByName } from "../services/personActions";
import { FaceRead, Person } from "../types";
import { FaceGrid } from "../components/FaceGrid"; // Import our DUMB grid component
import ConfirmDialog from "../components/ConfirmDialog";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";

export default function OrphanFacesPage() {
  const navigate = useNavigate();
  const listKey = "orphan-faces";

  // --- State Management ---
  const {
    items: orphans,
    hasMore,
    isLoading,
    error,
    loaderRef,
    reload,
    removeItems,
  } = usePagedList<FaceRead>(listKey, (cursor, signal) =>
    getOrphanFaces(cursor, signal)
  );

  // Faces get assigned elsewhere, so a cached list is refetched on every visit
  // (usePagedList itself only loads lists that aren't cached).
  useEffect(() => {
    const cached = useListStore.getState().lists[listKey];
    if (cached && !cached.isLoading) reload();
  }, [listKey, reload]);

  // All UI state is now managed directly by the page
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedFaceIds, setSelectedFaceIds] = useState<number[]>([]);

  // State for dialogs
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [personOptions, setPersonOptions] = useState<Person[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error";
  }>({ open: false, message: "", severity: "success" });

  const showMessage = (
    message: string,
    severity: "success" | "error" = "success"
  ) => {
    setSnackbar({ open: true, message, severity });
  };

  // --- Action Handlers ---
  const handleBulkDelete = async () => {
    const faceIds = [...selectedFaceIds];
    setIsProcessing(true);
    try {
      await deleteFace(faceIds);
      removeItems(faceIds);
      setSelectedFaceIds([]);
      showMessage(
        `Deleted ${faceIds.length} face${faceIds.length === 1 ? "" : "s"}.`
      );
    } catch (err) {
      console.error("Failed to delete faces:", err);
      showMessage("Failed to delete faces.", "error");
    } finally {
      setIsProcessing(false);
      setConfirmDeleteOpen(false);
    }
  };

  const handleBulkCreate = async () => {
    if (!newPersonName.trim()) return;
    const faceIds = [...selectedFaceIds];
    setIsProcessing(true);
    try {
      const newPerson = await createPersonFromFaces(faceIds, newPersonName);
      if (!newPerson?.id) {
        throw new Error("Failed to get ID for newly created person.");
      }
      removeItems(faceIds);
      setSelectedFaceIds([]);
      setCreateDialogOpen(false);
      navigate(`/person/${newPerson.id}`, { state: { forceRefresh: true } });
    } catch (err) {
      console.error("Failed to create and navigate to new person:", err);
      showMessage("Failed to create new person.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const openAssignDialog = () => {
    setSearchTerm("");
    setPersonOptions([]);
    setAssignDialogOpen(true);
  };

  useEffect(() => {
    if (!assignDialogOpen) {
      return;
    }
    const trimmed = searchTerm.trim();
    if (trimmed.length < 2) {
      setPersonOptions([]);
      return;
    }
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      searchPersonsByName(trimmed, controller.signal)
        .then(setPersonOptions)
        .catch((err) => {
          if (isAbortError(err)) return;
          console.error("Failed to search persons:", err);
        });
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [assignDialogOpen, searchTerm]);

  const handleConfirmAssign = async (person: Person | null) => {
    if (!person) return;
    const faceIds = [...selectedFaceIds];
    setIsProcessing(true);
    try {
      await assignFace(faceIds, person.id);
      removeItems(faceIds);
      setSelectedFaceIds([]);
      setAssignDialogOpen(false);
      setSearchTerm("");
      setPersonOptions([]);
      showMessage(
        `Assigned ${faceIds.length} face${faceIds.length === 1 ? "" : "s"} to ${
          person.name || `Person ${person.id}`
        }.`
      );
    } catch (err) {
      console.error("Failed to assign faces:", err);
      showMessage("Failed to assign faces.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetry = reload;

  const handleToggleSelect = useCallback((faceId: number) => {
    setSelectedFaceIds((prev) =>
      prev.includes(faceId)
        ? prev.filter((id) => id !== faceId)
        : [...prev, faceId]
    );
  }, []);

  const handleSelectAll = () => {
    if (selectedFaceIds.length < orphans.length) {
      setSelectedFaceIds(orphans.map((f) => f.id));
    } else {
      setSelectedFaceIds([]);
    }
  };

  if (isLoading && orphans.length === 0) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="calc(100vh - 64px)"
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ pt: 4, pb: 7 }}>
      {/* The header and toolbar are now part of the page's main layout flow */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 2 }}>
        <Typography variant="h4" sx={{ flexGrow: 1 }}>
          Unassigned Faces
        </Typography>
        <Button
          size="small"
          onClick={handleSelectAll}
          disabled={orphans.length === 0}
        >
          {selectedFaceIds.length < orphans.length
            ? "Select All"
            : "Select None"}
        </Button>
      </Box>

      {selectedFaceIds.length > 0 && (
        <Paper elevation={2} sx={{ p: 1, mb: 2, bgcolor: "action.selected" }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ ml: 1 }} variant="subtitle1">
              {selectedFaceIds.length} selected
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button
              variant="contained"
              size="small"
              disabled={isProcessing}
              onClick={openAssignDialog}
            >
              Assign...
            </Button>
            <Button
              variant="contained"
              size="small"
              disabled={isProcessing}
              onClick={() => setCreateDialogOpen(true)}
            >
              Create...
            </Button>
            <Button
              variant="outlined"
              color="error"
              size="small"
              disabled={isProcessing}
              onClick={() => setConfirmDeleteOpen(true)}
            >
              Delete
            </Button>
            {isProcessing && <CircularProgress size={20} />}
          </Stack>
        </Paper>
      )}

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={handleRetry}>
              Retry
            </Button>
          }
        >
          Failed to load unassigned faces: {error}
        </Alert>
      )}

      {orphans.length === 0 && !isLoading ? (
        !error && (
          <Typography align="center" sx={{ py: 4 }}>
            No unassigned faces found.
          </Typography>
        )
      ) : (
        <FaceGrid
          faces={orphans}
          selectedFaceIds={selectedFaceIds}
          onToggleSelect={handleToggleSelect}
        />
      )}

      {/* The loader and sentinel are at the page level */}
      {isLoading && orphans.length > 0 && (
        <Box textAlign="center" py={4}>
          <CircularProgress />
        </Box>
      )}
      {hasMore && !error && <Box ref={loaderRef} sx={{ height: "50px" }} />}

      {/* --- Dialogs --- */}
      {/* Assign Dialog */}
      <Dialog
        open={assignDialogOpen}
        onClose={() => setAssignDialogOpen(false)}
        fullWidth
      >
        <DialogTitle>Assign {selectedFaceIds.length} faces to...</DialogTitle>
        <DialogContent>
          <Autocomplete
            options={personOptions}
            getOptionLabel={(o) => o.name || "Unknown"}
            inputValue={searchTerm}
            onInputChange={(_, value) => setSearchTerm(value)}
            onChange={(_, val) => handleConfirmAssign(val)}
            renderOption={(props, option) => {
              const thumbPath = option.profile_face?.thumbnail_path;
              const thumbUrl = thumbPath
                ? `${API}/thumbnails/${encodeFilePath(thumbPath)}`
                : undefined;
              const initials = (option.name || "?")
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .map((part) => part[0]?.toUpperCase())
                .join("")
                .slice(0, 2) || "?";
              return (
                <Box
                  component="li"
                  {...props}
                  sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 0.5 }}
                >
                  <Avatar src={thumbUrl} alt={option.name || `Person ${option.id}`}>
                    {thumbUrl ? null : initials}
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap>{option.name || `Person ${option.id}`}</Typography>
                    {option.appearance_count ? (
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {option.appearance_count} media
                      </Typography>
                    ) : null}
                  </Box>
                </Box>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Search for a person"
                autoFocus
                helperText={
                  searchTerm.length < 2
                    ? "Type at least two characters to search"
                    : undefined
                }
              />
            )}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setAssignDialogOpen(false);
              setSearchTerm("");
              setPersonOptions([]);
            }}
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
      {/* Create Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      >
        <DialogTitle>Create New Person</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Person Name"
            type="text"
            fullWidth
            variant="standard"
            value={newPersonName}
            onChange={(e) => setNewPersonName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleBulkCreate} disabled={isProcessing}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete Faces"
        message={`Are you sure you want to delete ${selectedFaceIds.length} face${selectedFaceIds.length === 1 ? "" : "s"}? This cannot be undone.`}
        confirmLabel="Delete"
        loading={isProcessing}
        onConfirm={handleBulkDelete}
        onClose={() => setConfirmDeleteOpen(false)}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
}
