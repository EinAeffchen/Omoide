import React, { useState, useEffect, useCallback, MutableRefObject } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardMedia,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { API } from "../config";
import config from "../config";
import { encodeFilePath } from "../urlUtils";
import { Person, SceneRead } from "../types";
import { createScene, deleteScene, getScenes } from "../services/scene";

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const parseTimeInput = (value: string): number | null => {
  const colonMatch = value.match(/^(\d+):(\d{1,2})$/);
  if (colonMatch) {
    return parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2]);
  }
  const numericMatch = value.match(/^(\d+(?:\.\d+)?)$/);
  if (numericMatch) return parseFloat(numericMatch[1]);
  return null;
};

interface SceneManagerProps {
  mediaId: number;
  duration: number;
  persons: Person[];
  onSeekRequest: (time: number) => void;
  videoTimeRef?: MutableRefObject<number>;
}

export function SceneManager({
  mediaId,
  duration,
  persons,
  onSeekRequest,
  videoTimeRef,
}: SceneManagerProps) {
  const [scenes, setScenes] = useState<SceneRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newStartTime, setNewStartTime] = useState("");
  const [newEndTime, setNewEndTime] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadScenes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getScenes(mediaId);
      setScenes(data);
      setError(null);
    } catch {
      setError("Failed to load scenes");
    } finally {
      setLoading(false);
    }
  }, [mediaId]);

  useEffect(() => {
    loadScenes();
  }, [loadScenes]);

  const filteredScenes =
    selectedPersonId != null
      ? scenes.filter((s) => s.persons?.some((p) => p.id === selectedPersonId))
      : scenes;

  const handleDeleteScene = async (sceneId: number) => {
    try {
      await deleteScene(mediaId, sceneId);
      setScenes((prev) => prev.filter((s) => s.id !== sceneId));
    } catch {
      setError("Failed to delete scene");
    }
  };

  const handleOpenAddDialog = () => {
    const currentSecs = videoTimeRef?.current ?? 0;
    setNewStartTime(currentSecs > 0 ? formatTime(currentSecs) : "");
    setNewEndTime("");
    setNewDescription("");
    setCreateError(null);
    setAddDialogOpen(true);
  };

  const handleCreateScene = async () => {
    const startSecs = parseTimeInput(newStartTime);
    const rawEnd = newEndTime.trim() ? parseTimeInput(newEndTime) : null;

    if (startSecs == null) {
      setCreateError("Invalid start time. Use M:SS or seconds (e.g. 1:30 or 90).");
      return;
    }
    if (newEndTime.trim() && rawEnd == null) {
      setCreateError("Invalid end time. Use M:SS or seconds.");
      return;
    }
    if (rawEnd != null && startSecs >= rawEnd) {
      setCreateError("End time must be after start time.");
      return;
    }
    if (rawEnd != null && rawEnd > duration) {
      setCreateError(`End time exceeds video duration (${formatTime(duration)}).`);
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const scene = await createScene(mediaId, {
        start_time: startSecs,
        ...(rawEnd != null && { end_time: rawEnd }),
        description: newDescription.trim() || undefined,
      });
      setScenes((prev) =>
        [...prev, scene].sort((a, b) => a.start_time - b.start_time)
      );
      setAddDialogOpen(false);
    } catch {
      setCreateError("Failed to create scene.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Box>
      {/* Filter chips + Add button */}
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          gap: 1,
          mb: 2,
          alignItems: "center",
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
          Filter:
        </Typography>
        <Chip
          label="All scenes"
          color={selectedPersonId == null ? "primary" : "default"}
          onClick={() => setSelectedPersonId(null)}
          size="small"
        />
        {persons.map((p) => (
          <Chip
            key={p.id}
            label={p.name || `Person ${p.id}`}
            color={selectedPersonId === p.id ? "primary" : "default"}
            onClick={() =>
              setSelectedPersonId((prev) => (prev === p.id ? null : p.id))
            }
            size="small"
            avatar={
              p.profile_face?.thumbnail_path ? (
                <Box
                  component="img"
                  src={`${API}/thumbnails/${encodeFilePath(p.profile_face.thumbnail_path)}`}
                  alt=""
                  sx={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    objectFit: "cover",
                  }}
                />
              ) : undefined
            }
          />
        ))}
        <Box sx={{ flexGrow: 1 }} />
        {!config.PRESENTATION_MODE && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={handleOpenAddDialog}
          >
            Add Scene
          </Button>
        )}
      </Box>

      {/* Timeline */}
      {!loading && duration > 0 && scenes.length > 0 && (
        <SceneTimeline
          scenes={scenes}
          filteredScenes={filteredScenes}
          duration={duration}
          onSeekRequest={onSeekRequest}
        />
      )}

      {/* Content */}
      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {!loading && !error && filteredScenes.length === 0 && (
        <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
          {selectedPersonId != null
            ? "No scenes found for this person."
            : "No scenes detected. Use the Processors tab to extract scenes, or add one manually."}
        </Typography>
      )}
      {!loading && filteredScenes.length > 0 && (
        <Grid container spacing={2}>
          {filteredScenes.map((scene) => (
            <Grid item key={scene.id} xs={6} sm={4} md={3}>
              <SceneCard
                scene={scene}
                onSeek={() => onSeekRequest(scene.start_time)}
                onDelete={
                  !config.PRESENTATION_MODE
                    ? () => handleDeleteScene(scene.id)
                    : undefined
                }
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Add Scene Dialog */}
      <Dialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Add Scene</DialogTitle>
        <DialogContent>
          {createError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {createError}
            </Alert>
          )}
          <TextField
            label="Start time"
            placeholder="e.g. 1:30 or 90"
            value={newStartTime}
            onChange={(e) => setNewStartTime(e.target.value)}
            fullWidth
            sx={{ mt: 1, mb: 2 }}
            helperText="Format: M:SS or total seconds"
          />
          <TextField
            label="End time (optional)"
            placeholder="e.g. 2:00 or 120"
            value={newEndTime}
            onChange={(e) => setNewEndTime(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
            helperText={`Leave blank to auto-detect from next scene or end of video. Duration: ${formatTime(duration)}`}
          />
          <TextField
            label="Description (optional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDialogOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateScene}
            variant="contained"
            disabled={creating || !newStartTime.trim()}
          >
            {creating ? "Adding…" : "Add Scene"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function SceneCard({
  scene,
  onSeek,
  onDelete,
}: {
  scene: SceneRead;
  onSeek: () => void;
  onDelete?: () => void;
}) {
  const thumbUrl = scene.thumbnail_path
    ? `${API}/thumbnails/${encodeFilePath(scene.thumbnail_path)}`
    : null;

  return (
    <Card
      elevation={2}
      sx={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      {thumbUrl ? (
        <CardMedia
          component="img"
          image={thumbUrl}
          alt={`Scene at ${formatTime(scene.start_time)}`}
          sx={{ height: 110, objectFit: "cover", cursor: "pointer" }}
          onClick={onSeek}
        />
      ) : (
        <Box
          sx={{
            height: 110,
            bgcolor: "action.hover",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
          onClick={onSeek}
        >
          <Typography variant="caption" color="text.secondary">
            No thumbnail
          </Typography>
        </Box>
      )}
      <CardContent sx={{ py: 1, px: 1.5, flexGrow: 1 }}>
        <Typography variant="body2" fontWeight={600}>
          {formatTime(scene.start_time)} – {formatTime(scene.end_time)}
        </Typography>
        {scene.persons && scene.persons.length > 0 && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
            {scene.persons.map((p) => (
              <Chip
                key={p.id}
                label={p.name || `P${p.id}`}
                size="small"
                sx={{ height: 18, fontSize: "0.65rem" }}
              />
            ))}
          </Box>
        )}
        {scene.description && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 0.5, display: "block" }}
          >
            {scene.description}
          </Typography>
        )}
      </CardContent>
      <CardActions sx={{ px: 1, py: 0.5, justifyContent: "space-between" }}>
        <Tooltip title="Jump to scene">
          <IconButton size="small" onClick={onSeek} color="primary">
            <PlayArrowIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {onDelete && (
          <Tooltip title="Delete scene">
            <IconButton size="small" onClick={onDelete} color="error">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </CardActions>
    </Card>
  );
}

function SceneTimeline({
  scenes,
  filteredScenes,
  duration,
  onSeekRequest,
}: {
  scenes: SceneRead[];
  filteredScenes: SceneRead[];
  duration: number;
  onSeekRequest: (time: number) => void;
}) {
  const filteredIds = new Set(filteredScenes.map((s) => s.id));

  return (
    <Box sx={{ mb: 2.5 }}>
      <Typography variant="caption" color="text.secondary">
        Timeline
      </Typography>
      <Box
        sx={{
          position: "relative",
          height: 36,
          bgcolor: "action.hover",
          borderRadius: 1,
          overflow: "hidden",
          border: "1px solid",
          borderColor: "divider",
          mt: 0.5,
        }}
      >
        {scenes.map((scene) => {
          const left = (scene.start_time / duration) * 100;
          const width = Math.max(
            0.5,
            ((scene.end_time - scene.start_time) / duration) * 100
          );
          const highlighted = filteredIds.has(scene.id);
          return (
            <Tooltip
              key={scene.id}
              title={`${formatTime(scene.start_time)} – ${formatTime(scene.end_time)}`}
              placement="top"
            >
              <Box
                onClick={() => onSeekRequest(scene.start_time)}
                sx={{
                  position: "absolute",
                  left: `${left}%`,
                  width: `${width}%`,
                  top: 0,
                  height: "100%",
                  bgcolor: highlighted ? "primary.main" : "action.selected",
                  opacity: highlighted ? 0.75 : 0.4,
                  borderRight: "1px solid",
                  borderColor: "background.paper",
                  cursor: "pointer",
                  transition: "opacity 0.15s",
                  "&:hover": { opacity: 1 },
                }}
              />
            </Tooltip>
          );
        })}
        <Box sx={{ position: "absolute", bottom: 2, left: 4, pointerEvents: "none" }}>
          <Typography variant="caption" sx={{ fontSize: "0.6rem", color: "text.secondary" }}>
            0:00
          </Typography>
        </Box>
        <Box sx={{ position: "absolute", bottom: 2, right: 4, pointerEvents: "none" }}>
          <Typography variant="caption" sx={{ fontSize: "0.6rem", color: "text.secondary" }}>
            {formatTime(duration)}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
