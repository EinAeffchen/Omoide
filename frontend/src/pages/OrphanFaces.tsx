import React, { useState, useEffect, useCallback } from "react";
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
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useInView } from "react-intersection-observer";
import { useListStore, defaultListState } from "../stores/useListStore";
import { getOrphanFaces } from "../services/face";
import {
  assignFace,
  createPersonFromFaces,
  deleteFace,
} from "../services/faceActions";
import { searchPersonsByName } from "../services/personActions";
import { Person } from "../types";
import { FaceGrid } from "../components/FaceGrid"; // Import our DUMB grid component
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
  } = useListStore((state) => state.lists[listKey] || defaultListState);
  const { fetchInitial, loadMore, removeItems, clearList } = useListStore();

  // All UI state is now managed directly by the page
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedFaceIds, setSelectedFaceIds] = useState<number[]>([]);

  // State for dialogs
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [personOptions, setPersonOptions] = useState<Person[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  // --- Infinite Scroll ---
  // The 'skip' option is a crucial fix: it disables the observer while data is loading.
  const { ref: loaderRef, inView } = useInView({
    threshold: 0.5,
    skip: isLoading || !hasMore,
    rootMargin: "0px 0px 200px 0px",
  });

  useEffect(() => {
    clearList(listKey);
    fetchInitial(listKey, () => getOrphanFaces(null));
  }, [clearList, fetchInitial, listKey]);

  useEffect(() => {
    if (inView) {
      loadMore(listKey, (cursor) => getOrphanFaces(cursor));
    }
  }, [inView, loadMore, listKey]);

  // --- Action Handlers ---
  const handleBulkDelete = async () => {
    if (
      !window.confirm(
        `Are you sure you want to delete ${selectedFaceIds.length} faces?`
      )
    )
      return;
    setIsProcessing(true);
    try {
      await deleteFace(selectedFaceIds);
      removeItems(listKey, selectedFaceIds);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkCreate = async () => {
    if (!newPersonName.trim()) return;
    setIsProcessing(true);
    try {
      const newPerson = await createPersonFromFaces(
        selectedFaceIds,
        newPersonName
      );
      if (!newPerson?.id) {
        throw new Error("Failed to get ID for newly created person.");
      }
      removeItems(listKey, selectedFaceIds);

      const newPersonMediaListKey = `person-${newPerson.id}-media-appearances`;
      const newPersonFacesListKey = `/api/person/${newPerson.id}/faces`; // The key used on PersonDetailPage

      clearList(newPersonMediaListKey);
      clearList(newPersonFacesListKey);

      setCreateDialogOpen(false);
      if (newPerson?.id) navigate(`/person/${newPerson.id}`);
    } catch (error) {
      console.error("Failed to create and navigate to new person:", error);
      alert("Failed to create new person.");
    } finally {
      setIsProcessing(false);
      setSelectedFaceIds([]);
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
    let active = true;
    const handle = window.setTimeout(() => {
      searchPersonsByName(trimmed)
        .then((results) => {
          if (active) {
            setPersonOptions(results);
          }
        })
        .catch((err) => {
          console.error("Failed to search persons:", err);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [assignDialogOpen, searchTerm]);

  const handleConfirmAssign = async (person: Person | null) => {
    if (!person) return;
    setIsProcessing(true);
    try {
      await assignFace(selectedFaceIds, person.id);
      removeItems(listKey, selectedFaceIds);
      setAssignDialogOpen(false);
      setSearchTerm("");
      setPersonOptions([]);
    } finally {
      setIsProcessing(false);
      setSelectedFaceIds([]);
    }
  };

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
              onClick={handleBulkDelete}
            >
              Delete
            </Button>
            {isProcessing && <CircularProgress size={20} />}
          </Stack>
        </Paper>
      )}

      {orphans.length === 0 && !isLoading ? (
        <Typography align="center" sx={{ py: 4 }}>
          No unassigned faces found.
        </Typography>
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
      {hasMore && <Box ref={loaderRef} sx={{ height: "50px" }} />}

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
    </Container>
  );
}
