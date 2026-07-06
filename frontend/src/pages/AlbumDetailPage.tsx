import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Snackbar,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import PhotoAlbumIcon from "@mui/icons-material/PhotoAlbum";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import { useNavigate, useParams } from "react-router-dom";
import { CursorMediaGrid } from "../components/CursorMediaGrid";
import { EmptyState } from "../components/EmptyState";
import { useSelection } from "../context/SelectionContext";
import {
  deleteAlbum,
  getAlbum,
  getAlbumMedia,
  removeMediaFromAlbum,
  updateAlbum,
} from "../services/features";
import { Album } from "../types";

export default function AlbumDetailPage() {
  const { id } = useParams<{ id: string }>();
  const albumId = Number(id);
  const navigate = useNavigate();
  const { selectedIds, clear, isSelecting, toggleSelecting } = useSelection();

  const [album, setAlbum] = useState<Album | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [snackbar, setSnackbar] = useState("");

  useEffect(() => {
    if (!Number.isFinite(albumId)) return;
    getAlbum(albumId)
      .then((data) => {
        setAlbum(data);
        setNewName(data.name);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load album")
      );
  }, [albumId, refreshToken]);

  const fetcher = useCallback(
    (cursor: string | null) => getAlbumMedia(albumId, cursor),
    [albumId]
  );

  const handleRename = async () => {
    const trimmed = newName.trim();
    if (!trimmed || !album) return;
    try {
      const updated = await updateAlbum(albumId, { name: trimmed });
      setAlbum(updated);
      setRenameOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename album");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteAlbum(albumId);
      navigate("/albums");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete album");
    }
  };

  const handleStartAdding = () => {
    // Jump to the library in select mode; the floating action bar's
    // "Add to Album" finishes the flow.
    if (!isSelecting) toggleSelecting();
    navigate("/images");
  };

  const handleRemoveSelected = async () => {
    if (selectedIds.size === 0) return;
    try {
      const updated = await removeMediaFromAlbum(
        albumId,
        Array.from(selectedIds)
      );
      setAlbum(updated);
      clear();
      setRefreshToken((t) => t + 1);
      setSnackbar("Removed from album.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove media");
    }
  };

  return (
    <Container maxWidth="xl" sx={{ minHeight: "100vh", py: 4 }}>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        gap={1}
        mb={3}
      >
        <Box display="flex" alignItems="center" gap={1}>
          <PhotoAlbumIcon color="primary" />
          <Typography variant="h5" fontWeight={700}>
            {album?.name ?? "Album"}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {album ? `${album.media_count} items` : ""}
          </Typography>
        </Box>
        <Box display="flex" gap={1}>
          <Button
            size="small"
            variant="contained"
            disableElevation
            startIcon={<AddPhotoAlternateIcon />}
            onClick={handleStartAdding}
          >
            Add media
          </Button>
          {isSelecting && selectedIds.size > 0 && (
            <Button
              size="small"
              color="warning"
              variant="outlined"
              startIcon={<RemoveCircleOutlineIcon />}
              onClick={handleRemoveSelected}
            >
              Remove {selectedIds.size} from album
            </Button>
          )}
          <Tooltip title="Rename album">
            <IconButton onClick={() => setRenameOpen(true)}>
              <EditIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete album (keeps the media)">
            <IconButton color="error" onClick={() => setDeleteOpen(true)}>
              <DeleteIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <CursorMediaGrid
        listKey={`album-${albumId}`}
        fetcher={fetcher}
        refreshToken={refreshToken}
        empty={
          <EmptyState
            icon={<PhotoAlbumIcon />}
            title="Album is empty"
            description="Click “Add media” above (or use Select Mode in any grid), pick items, then “Add to Album”."
          />
        }
      />

      <Dialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Rename album</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRename();
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disableElevation
            onClick={handleRename}
            disabled={!newName.trim()}
          >
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <DialogTitle>Delete album?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            "{album?.name}" will be deleted. The media itself stays in your
            library.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" disableElevation onClick={handleDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar("")}
        message={snackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Container>
  );
}
