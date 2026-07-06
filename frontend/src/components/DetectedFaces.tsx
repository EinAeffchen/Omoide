import React, { useCallback, useState, useEffect, useMemo } from "react";
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import VideoLibraryIcon from "@mui/icons-material/VideoLibrary";
import ViewModuleIcon from "@mui/icons-material/ViewModule";
import { FaceRead, Person } from "../types";
import FaceCard from "./FaceCard";
import FaceMediaGroup from "./FaceMediaGroup";
import ConfirmDialog from "./ConfirmDialog";
import { useFaceSelection } from "../hooks/useFaceSelection";
import { searchPersonsByName } from "../services/personActions";
import config, { API } from "../config";
import { encodeFilePath } from "../urlUtils";

interface DetectedFacesProps {
  isProcessing: boolean;
  faces: FaceRead[];
  title: string;
  onDelete: (faceIds: number[]) => void | Promise<void>;
  onDetach: (faceIds: number[]) => void | Promise<void>;
  onAssign: (faceIds: number[], personId: number) => void | Promise<void>;
  onCreateMultiple?: (faceIds: number[], name?: string) => Promise<Person | void>;
  personId?: number;

  profileFaceId?: number;
  onSetProfile?: (faceId: number) => void;

  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;

  disableInternalScroll?: boolean;

  // Pinned faces jumped from timeline
  pinnedFaces?: FaceRead[];
  onClearPinned?: () => void;
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
  pinnedFaces,
  onClearPinned,
}: DetectedFacesProps) {
  const theme = useTheme();
  const {
    selectedFaceIds,
    onToggleSelect,
    onSelectAll,
    onClearSelection,
    setSelectedFaceIds,
  } = useFaceSelection();

  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<number>>(new Set());

  const toggleGroupExpand = useCallback((mediaId: number) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });
  }, []);

  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [assignSearchTerm, setAssignSearchTerm] = useState("");
  const [assignCandidates, setAssignCandidates] = useState<Person[]>([]);
  const [assignTargetPerson, setAssignTargetPerson] = useState<Person | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [openCreateDialog, setOpenCreateDialog] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");

  const canMutate = !config.PRESENTATION_MODE;
  const [groupByVideo, setGroupByVideo] = useState(config.GROUP_FACES_BY_VIDEO);
  const isAnythingSelected = selectedFaceIds.length > 0;

  // Group faces by media_id; preserve iteration order
  const groupedItems = useMemo(() => {
    const map = new Map<number, FaceRead[]>();
    for (const face of faces) {
      const existing = map.get(face.media_id);
      if (existing) {
        existing.push(face);
      } else {
        map.set(face.media_id, [face]);
      }
    }
    return Array.from(map.entries()).map(([mediaId, fs]) => ({ mediaId, faces: fs }));
  }, [faces]);

  const handleToggleGroupSelect = useCallback(
    (faceIds: number[]) => {
      const allSelected = faceIds.every((id) => selectedFaceIds.includes(id));
      setSelectedFaceIds((prev) => {
        if (allSelected) {
          return prev.filter((id) => !faceIds.includes(id));
        } else {
          return [...new Set([...prev, ...faceIds])];
        }
      });
    },
    [selectedFaceIds, setSelectedFaceIds],
  );

  const resolveProfileThumb = useCallback((person: Person) => {
    const thumbPath = person.profile_face?.thumbnail_path;
    if (!thumbPath) return undefined;
    return `${API}/thumbnails/${encodeFilePath(thumbPath)}`;
  }, []);

  const getInitials = useCallback((name = "") => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase() || "?";
  }, []);

  const [lastCardNode, setLastCardNode] = useState<HTMLDivElement | null>(
    null,
  );
  const lastCardRef = useCallback((node: HTMLDivElement | null) => {
    setLastCardNode(node);
  }, []);

  useEffect(() => {
    if (!lastCardNode || !hasMore || !onLoadMore || isLoadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px 100px 0px" },
    );
    observer.observe(lastCardNode);
    return () => {
      observer.disconnect();
    };
  }, [lastCardNode, hasMore, isLoadingMore, onLoadMore]);

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
    const controller = new AbortController();
    const handler = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchPersonsByName(
          assignSearchTerm,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setAssignCandidates(results);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Failed to search for people:", error);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 300);
    return () => {
      clearTimeout(handler);
      controller.abort();
    };
  }, [assignSearchTerm, canMutate]);

  if (faces.length === 0 && !isLoadingMore && !hasMore && title === "Detected Faces") {
    return null;
  }
  if (faces.length === 0 && isLoadingMore && onLoadMore) {
    return null;
  }

  const handleAssign = async (faceIds: number[], assignedToPersonId: number) => {
    if (!canMutate) return;
    try {
      await onAssign(faceIds, assignedToPersonId);
      onClearSelection();
    } catch (error) {
      console.error("Failed to assign faces:", error);
    }
  };

  const handleDetach = async () => {
    if (!onDetach || selectedFaceIds.length === 0 || !canMutate) return;
    const faceIds = [...selectedFaceIds];
    try {
      await onDetach(faceIds);
      onClearSelection();
    } catch (error) {
      console.error("Failed to detach faces:", error);
    }
  };

  const handleConfirmDelete = async () => {
    if (!onDelete || selectedFaceIds.length === 0 || !canMutate) return;
    const faceIds = [...selectedFaceIds];
    try {
      await onDelete(faceIds);
      onClearSelection();
      setConfirmDeleteOpen(false);
    } catch (error) {
      console.error("Failed to delete faces:", error);
      setConfirmDeleteOpen(false);
    }
  };

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
    if (!canMutate) return;
    if (personId) {
      handleAssign(selectedFaceIds, personId);
    } else {
      setIsAssignDialogOpen(true);
    }
  };

  const scrollContainerSx = !disableInternalScroll
    ? {
        maxHeight: "400px",
        overflowY: "auto",
        pr: 1,
        "&::-webkit-scrollbar": { width: "8px" },
        "&::-webkit-scrollbar-track": { background: theme.palette.background.default },
        "&::-webkit-scrollbar-thumb": {
          backgroundColor: theme.palette.divider,
          borderRadius: "4px",
        },
        "&::-webkit-scrollbar-thumb:hover": { background: theme.palette.text.secondary },
      }
    : {};

  const faceItems: React.ReactNode[] = groupByVideo
    ? groupedItems.flatMap((item, groupIndex) => {
        const isLastGroup = groupIndex === groupedItems.length - 1;
        if (item.faces.length > 1) {
          const isExpanded = expandedGroupIds.has(item.mediaId);
          return [
            <div
              key={`group-${item.mediaId}`}
              ref={!disableInternalScroll && isLastGroup && !isExpanded ? lastCardRef : null}
            >
              <FaceMediaGroup
                faces={item.faces}
                selectedFaceIds={selectedFaceIds}
                onToggleGroupSelect={handleToggleGroupSelect}
                canMutate={canMutate}
                onToggleExpand={() => toggleGroupExpand(item.mediaId)}
              />
            </div>,
            isExpanded && (
              <Box
                key={`expanded-${item.mediaId}`}
                ref={!disableInternalScroll && isLastGroup ? lastCardRef : null}
                sx={{
                  flexBasis: "100%",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 1,
                  p: 1,
                  borderRadius: 1,
                  bgcolor: "action.hover",
                }}
              >
                {item.faces.map((face) => (
                  <FaceCard
                    key={face.id}
                    face={face as any}
                    isProfile={face.id === profileFaceId}
                    onSetProfile={canMutate ? onSetProfile : undefined}
                    selected={canMutate && selectedFaceIds.includes(face.id)}
                    onToggleSelect={canMutate ? onToggleSelect : undefined}
                  />
                ))}
              </Box>
            ),
          ].filter(Boolean) as React.ReactNode[];
        }
        return [
          <div
            key={item.faces[0].id}
            ref={!disableInternalScroll && isLastGroup ? lastCardRef : null}
          >
            <FaceCard
              face={item.faces[0] as any}
              isProfile={item.faces[0].id === profileFaceId}
              onSetProfile={canMutate ? onSetProfile : undefined}
              selected={canMutate && selectedFaceIds.includes(item.faces[0].id)}
              onToggleSelect={canMutate ? onToggleSelect : undefined}
            />
          </div>,
        ];
      })
    : faces.map((face, index) => {
        const isLast = index === faces.length - 1;
        return (
          <div
            key={face.id}
            ref={!disableInternalScroll && isLast ? lastCardRef : null}
          >
            <FaceCard
              face={face as any}
              isProfile={face.id === profileFaceId}
              onSetProfile={canMutate ? onSetProfile : undefined}
              selected={canMutate && selectedFaceIds.includes(face.id)}
              onToggleSelect={canMutate ? onToggleSelect : undefined}
            />
          </div>
        );
      });

  return (
    <Paper variant="outlined" sx={{ p: 2, my: 4 }}>
      <Box sx={{ mb: 1 }}>
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {title}
          </Typography>
          <Tooltip title={groupByVideo ? "Show as flat grid" : "Group by video"}>
            <IconButton size="small" onClick={() => setGroupByVideo((v) => !v)}>
              {groupByVideo ? <ViewModuleIcon fontSize="small" /> : <VideoLibraryIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>
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
                onClick={() => setConfirmDeleteOpen(true)}
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

      {/* Create-person dialog */}
      <Dialog open={canMutate && openCreateDialog} onClose={() => setOpenCreateDialog(false)}>
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
              if (onCreateMultiple && canMutate) {
                try {
                  await onCreateMultiple(selectedFaceIds, newPersonName);
                  setOpenCreateDialog(false);
                  setSelectedFaceIds([]);
                  setNewPersonName("");
                } catch (error) {
                  console.error("Failed to create person:", error);
                }
              }
            }}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={canMutate && confirmDeleteOpen}
        title="Delete Faces"
        message={`Delete ${selectedFaceIds.length} selected face${selectedFaceIds.length === 1 ? "" : "s"}? This cannot be undone.`}
        confirmLabel="Delete"
        loading={isProcessing}
        onConfirm={handleConfirmDelete}
        onClose={() => setConfirmDeleteOpen(false)}
      />

      {/* Assign-to-person dialog */}
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
                    person.appearance_count ? `${person.appearance_count} media` : undefined
                  }
                />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAssignDialog}>Cancel</Button>
          <Button onClick={handleConfirmAssign} disabled={!assignTargetPerson || isProcessing}>
            Assign
          </Button>
        </DialogActions>
      </Dialog>

      {/* Pinned faces (jumped from timeline) */}
      {pinnedFaces && pinnedFaces.length > 0 && (
        <Paper
          variant="outlined"
          sx={{ p: 2, mb: 2, borderColor: "primary.main", borderWidth: 2 }}
        >
          <Box
            sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}
          >
            <Typography variant="body2" color="primary">
              Jumped from timeline — {pinnedFaces.length} face
              {pinnedFaces.length !== 1 ? "s" : ""} from this photo
            </Typography>
            <Button size="small" onClick={onClearPinned}>
              Clear
            </Button>
          </Box>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {pinnedFaces.map((face) => (
              <FaceCard
                key={face.id}
                face={face as any}
                isProfile={face.id === profileFaceId}
                onSetProfile={canMutate ? onSetProfile : undefined}
                selected={canMutate && selectedFaceIds.includes(face.id)}
                onToggleSelect={canMutate ? onToggleSelect : undefined}
              />
            ))}
          </Box>
        </Paper>
      )}

      {/* Faces grid — grouped by media */}
      <Box sx={scrollContainerSx}>
        {faces.length === 0 && !isLoadingMore ? (
          <Typography sx={{ textAlign: "center", p: 4, color: "text.secondary" }}>
            No faces to display.
          </Typography>
        ) : (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "flex-start" }}>
            {faceItems}
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
