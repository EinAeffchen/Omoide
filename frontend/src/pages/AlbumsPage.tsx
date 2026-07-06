import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import PhotoAlbumIcon from "@mui/icons-material/PhotoAlbum";
import AddIcon from "@mui/icons-material/Add";
import { Link } from "react-router-dom";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";
import { EmptyState } from "../components/EmptyState";
import { createAlbum, getAlbums } from "../services/features";
import { Album } from "../types";

export default function AlbumsPage() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setIsLoading(true);
    getAlbums()
      .then(setAlbums)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load albums")
      )
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await createAlbum(trimmed);
      setName("");
      setCreateOpen(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create album");
    } finally {
      setBusy(false);
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
            Albums
          </Typography>
        </Box>
        <Button
          variant="contained"
          disableElevation
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
        >
          New Album
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Box textAlign="center" py={6}>
          <CircularProgress />
        </Box>
      ) : albums.length === 0 ? (
        <EmptyState
          icon={<PhotoAlbumIcon />}
          title="No albums yet"
          description="Create an album, then add media via Select Mode."
        />
      ) : (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: {
              xs: "repeat(2, 1fr)",
              sm: "repeat(3, 1fr)",
              md: "repeat(4, 1fr)",
              lg: "repeat(5, 1fr)",
            },
          }}
        >
          {albums.map((album) => (
            <Card key={album.id} sx={{ borderRadius: 3 }}>
              <CardActionArea component={Link} to={`/album/${album.id}`}>
                <Box
                  sx={{
                    aspectRatio: "4/3",
                    bgcolor: "action.hover",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  {album.cover_thumbnail ? (
                    <Box
                      component="img"
                      src={`${API}/thumbnails/${encodeFilePath(
                        album.cover_thumbnail
                      )}`}
                      alt={album.name}
                      loading="lazy"
                      sx={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <PhotoAlbumIcon color="disabled" sx={{ fontSize: 48 }} />
                  )}
                </Box>
                <CardContent sx={{ py: 1.5 }}>
                  <Typography variant="subtitle2" fontWeight={700} noWrap>
                    {album.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {album.media_count} item
                    {album.media_count === 1 ? "" : "s"}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>New album</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            placeholder="Album name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disableElevation
            onClick={handleCreate}
            disabled={busy || !name.trim()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
