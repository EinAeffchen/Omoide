import React, { useRef, useCallback, useState, useEffect } from "react";
import {
  Avatar,
  Box,
  Typography,
  CircularProgress,
  Button,
  Stack,
  Paper,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  DialogActions,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
} from "@mui/material";
import { FaceRead, Person } from "../types";
import FaceCard from "./FaceCard";
import { useFaceSelection } from "../hooks/useFaceSelection";
import { searchPersonsByName } from "../services/personActions";
import config, { API } from "../config";

interface DetectedFacesProps {
  isProcessing: boolean;
  faces: FaceRead[];
  title: string;
  onDelete: (faceIds: number[]) => void;
  onDetach: (faceIds: number[]) => void;
  onAssign: (faceIds: number[], personId: number) => void;
  onCreateMultiple?: (faceIds: number[], name?: string) => Promise<Person>;
  personId?: number; // Make optional for orphan faces

  // --- Profile Actions ---
  profileFaceId?: number;
  onSetProfile?: (faceId: number) => void;

  // --- Infinite Scroll ---
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;

  disableInternalScroll?: boolean;
}

export default function DetectedFaces({
  isProcessing,
  faces,
  title,
  onDelete,
  onDetach,
  onAssign,
  personId,
  profileFaceId,
  onSetProfile,
  onLoadMore,
  hasMore,
  isLoadingMore,
  onCreateMultiple,
  disableInternalScroll = false,
}: DetectedFacesProps) {
  const theme = useTheme();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const {
    selectedFaceIds,
    onToggleSelect,
    onSelectAll,
    onClearSelection,
    setSelectedFaceIds,
  } = useFaceSelection();

  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [assignSearchTerm, setAssignSearchTerm] = useState("");
  const [assignCandidates, setAssignCandidates] = useState<Person[]>([]);
  const [assignTargetPerson, setAssignTargetPerson] = useState<Person | null>(
    null
  );
  const [isSearching, setIsSearching] = useState(false);
  const [openCreateDialog, setOpenCreateDialog] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");

  const canMutate = !config.PRESENTATION_MODE;
  const isAnythingSelected = selectedFaceIds.length > 0;

  const resolveProfileThumb = useCallback((person: Person) => {
    const thumbPath = person.profile_face?.thumbnail_path;
    if (!thumbPath) return undefined;
    return `${API}/thumbnails/${encodeURIComponent(thumbPath)}`;
  }, []);

  const getInitials = useCallback((name = "") => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase() || "?";
  }, []);

  const lastCardRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isLoadingMore) return;
      if (observerRef.current) observerRef.current.disconnect();

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (
            entries[0].isIntersecting &&
            hasMore &&
            onLoadMore &&
            !isLoadingMore
          ) {
            onLoadMore();
          }
        },
        { threshold: 0.1, rootMargin: "0px 0px 100px 0px" } // Trigger when 100px from bottom
      );

      if (node) observerRef.current.observe(node);
    },
    [isLoadingMore, hasMore, onLoadMore]
  );
  useEffect(() => {
    onClearSelection();
  }, [personId]);

  useEffect(() => {
    if (!canMutate) {
      setIsAssignDialogOpen(false);
      setOpenCreateDialog(false);
      onClearSelection();
    }
  }, [canMutate, onClearSelection]);

  useEffect(() => {
    if (!canMutate) {
      setAssignCandidates([]);
      return;
    }

    if (!assignSearchTerm.trim()) {
      setAssignCandidates([]);
      return;
    }

    const handler = setTimeout(async () => {
      setIsSearching(true);
      try {
        // Assumes a service function that returns a list of people
        const results = await searchPersonsByName(assignSearchTerm);
        setAssignCandidates(results);
      } catch (error) {
        console.error("Failed to search for people:", error);
      } finally {
        setIsSearching(false);
      }
    }, 300); // 300ms debounce

    return () => {
      clearTimeout(handler);
    };
  }, [assignSearchTerm, canMutate]);

  if (
    faces.length === 0 &&
    !isLoadingMore &&
    !hasMore &&
    title === "Detected Faces"
  ) {
    return null;
  }

  if (faces.length === 0 && isLoadingMore && onLoadMore) {
    return null;
  }

  const handleAssign = async (
    faceIds: number[],
    assignedToPersonId: number
  ) => {
    if (!canMutate) {
      return;
    }
    onClearSelection();
    await onAssign(faceIds, assignedToPersonId);
  };
  const handleDetach = async () => {
    if (!onDetach || selectedFaceIds.length === 0 || !canMutate) {
      return;
    }
    const faceIds = [...selectedFaceIds];
    onClearSelection();
    await onDetach(faceIds);
  };
  // --- NEW: Handlers for the assign dialog ---
  const handleCloseAssignDialog = () => {
    setIsAssignDialogOpen(false);
    setAssignSearchTerm("");
    setAssignCandidates([]);
    setAssignTargetPerson(null);
  };

  const handleConfirmAssign = async () => {
    if (!assignTargetPerson || !canMutate) return;
    await handleAssign(selectedFaceIds, assignTargetPerson.id);
    handleCloseAssignDialog();
  };

  const handleAssignClick = () => {
    if (!canMutate) {
      return;
    }
    if (personId) {
      // Context: We are on a person's page. Assign directly.
      handleAssign(selectedFaceIds, personId);
    } else {
      // Context: We are on a page with unassigned faces. Open the search dialog.
      setIsAssignDialogOpen(true);
    }
  };

  const scrollContainerSx = !disableInternalScroll
    ? {
        maxHeight: "400px",
        overflowY: "auto",
        pr: 1, // Padding for scrollbar
        // Custom scrollbar styling
        "&::-webkit-scrollbar": { width: "8px" },
        "&::-webkit-scrollbar-track": {
          background: theme.palette.background.default,
        },
        "&::-webkit-scrollbar-thumb": {
          backgroundColor: theme.palette.divider,
          borderRadius: "4px",
        },
        "&::-webkit-scrollbar-thumb:hover": {
          background: theme.palette.text.secondary,
        },
      }
    : {};

  return (
    <Paper variant="outlined" sx={{ p: 2, my: 4 }}>
      <Box sx={{ mb: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        {isAnythingSelected && canMutate && (
          <Stack direction="row" spacing={1} alignItems="center">
            <Button size="small" onClick={onClearSelection}>
              {selectedFaceIds.length} selected
            </Button>
            <Box sx={{ flexGrow: 1 }} />

            <Button
              variant="contained"
              size="small"
              disabled={isProcessing}
              onClick={handleAssignClick}
            >
              Assign
            </Button>
            {onCreateMultiple && (
              <Button
                variant="contained"
                size="small"
                disabled={isProcessing}
                onClick={() => setOpenCreateDialog(true)}
              >
                Create New
              </Button>
            )}
            {onDetach && (
              <Button
                variant="outlined"
                color="secondary"
                size="small"
                disabled={isProcessing}
                onClick={handleDetach}
              >
                Detach
              </Button>
            )}
            {onDelete && (
              <Button
                variant="outlined"
                color="error"
                size="small"
                disabled={isProcessing}
                onClick={() => onDelete(selectedFaceIds)}
              >
                Delete
              </Button>
            )}
            {onSetProfile && (
              <Button
                variant="contained"
                size="small"
                disabled={isProcessing || selectedFaceIds.length !== 1}
                onClick={() => onSetProfile(selectedFaceIds[0])}
              >
                Set as Profile
              </Button>
            )}
            {isProcessing && <CircularProgress size={20} />}
          </Stack>
        )}
        <Button
          size="small"
          onClick={() => onSelectAll(faces)}
          disabled={!canMutate}
        >
          {selectedFaceIds.length < faces.length ? "Select All" : "Select None"}
        </Button>
      </Box>
      <Dialog
        open={canMutate && openCreateDialog}
        onClose={() => setOpenCreateDialog(false)}
      >
        <DialogTitle>Create New Person</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Person Name"
            type="text"
            fullWidth
            variant="standard"
            value={newPersonName}
            onChange={(e) => setNewPersonName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCreateDialog(false)}>Cancel</Button>
          <Button
            onClick={async () => {
              if (onCreateMultiple) {
                if (!canMutate) {
                  return;
                }
                await onCreateMultiple(selectedFaceIds, newPersonName);
                setOpenCreateDialog(false);
                setSelectedFaceIds([]);
                setNewPersonName("");
              }
            }}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={canMutate && isAssignDialogOpen}
        onClose={handleCloseAssignDialog}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Assign to Person</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Search for a person"
            type="text"
            fullWidth
            variant="standard"
            value={assignSearchTerm}
            onChange={(e) => setAssignSearchTerm(e.target.value)}
          />
          {isSearching && (
            <Box sx={{ display: "flex", justifyContent: "center", my: 1 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          <List>
            {assignCandidates.map((person) => (
              <ListItemButton
                key={person.id}
                selected={assignTargetPerson?.id === person.id}
                onClick={() => setAssignTargetPerson(person)}
              >
                <ListItemAvatar>
                  <Avatar
                    src={resolveProfileThumb(person)}
                    alt={person.name || `Person ${person.id}`}
                  >
                    {getInitials(person.name)}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={person.name || `Person ${person.id}`}
                  secondary={
                    person.appearance_count
                      ? `${person.appearance_count} media`
                      : undefined
                  }
                />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAssignDialog}>Cancel</Button>
          <Button
            onClick={handleConfirmAssign}
            disabled={!assignTargetPerson || isProcessing}
          >
            Assign
          </Button>
        </DialogActions>
      </Dialog>
      {/* --- Faces Grid --- */}
      <Box sx={scrollContainerSx}>
        {faces.length === 0 && !isLoadingMore ? (
          <Typography
            sx={{ textAlign: "center", p: 4, color: "text.secondary" }}
          >
            No faces to display.
          </Typography>
        ) : (
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 2,
              justifyContent: "flex-start",
            }}
          >
            {faces.map((face, index) => (
              <div
                key={face.id}
                // Only attach the internal scroller's ref if internal scroll is enabled
                ref={
                  !disableInternalScroll && index === faces.length - 1
                    ? lastCardRef
                    : null
                }
                style={{ padding: "4px" }}
              >
                <FaceCard
                  face={face}
                  isProfile={face.id === profileFaceId}
                  onSetProfile={canMutate ? onSetProfile : undefined}
                  selected={
                    canMutate && selectedFaceIds.includes(face.id)
                  }
                  onToggleSelect={canMutate ? onToggleSelect : undefined}
                />
              </div>
            ))}
          </Box>
        )}
        {isLoadingMore && (
          <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
            <CircularProgress size={24} />
          </Box>
        )}
      </Box>
    </Paper>
  );
}
