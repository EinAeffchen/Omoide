import React, { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  FormGroup,
  Snackbar,
  Typography,
} from "@mui/material";
import ReplayIcon from "@mui/icons-material/Replay";
import { runProcessorsForMedia } from "../services/taskActions";

const PROCESSORS = [
  { name: "faces", label: "Face Detection" },
  { name: "embedding_extractor", label: "Image Embeddings" },
  { name: "auto_tagger", label: "Auto Tags" },
  { name: "blur", label: "Blur Score" },
  { name: "exif", label: "EXIF Data" },
];

interface MediaProcessorsTabProps {
  mediaId: number;
}

export function MediaProcessorsTab({ mediaId }: MediaProcessorsTabProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(["faces"]));
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string }>({
    open: false,
    message: "",
  });

  const selectedNames = useMemo(() => Array.from(selected), [selected]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleRun = async () => {
    if (selectedNames.length === 0) return;
    setIsRunning(true);
    setError(null);
    try {
      await runProcessorsForMedia([mediaId], selectedNames);
      setSnackbar({
        open: true,
        message: "Processor task started for this media.",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start task");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Rerun selected processors only for this file.
      </Typography>
      <FormGroup>
        {PROCESSORS.map((processor) => (
          <FormControlLabel
            key={processor.name}
            control={
              <Checkbox
                checked={selected.has(processor.name)}
                onChange={() => toggle(processor.name)}
                disabled={isRunning}
              />
            }
            label={processor.label}
          />
        ))}
      </FormGroup>
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
      <Button
        variant="contained"
        startIcon={
          isRunning ? <CircularProgress size={16} color="inherit" /> : <ReplayIcon />
        }
        disabled={isRunning || selectedNames.length === 0}
        onClick={handleRun}
        sx={{ mt: 2 }}
      >
        Run Selected Processors
      </Button>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3500}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
