import React, { useState } from "react";
import {
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  Typography,
} from "@mui/material";
import { runProcessorsForMedia } from "../services/taskActions";

const PROCESSORS = [
  { name: "faces", label: "Face Detection" },
  { name: "embedding_extractor", label: "Image Embeddings" },
  { name: "auto_tagger", label: "Auto Tags" },
  { name: "blur", label: "Blur Score" },
  { name: "exif", label: "EXIF Data" },
];

interface Props {
  open: boolean;
  mediaIds: number[];
  onClose: () => void;
  onStarted: () => void;
}

export const RerunProcessorsDialog: React.FC<Props> = ({
  open,
  mediaIds,
  onClose,
  onStarted,
}) => {
  const [selected, setSelected] = useState<Set<string>>(new Set(["faces"]));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleRun = async () => {
    if (selected.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      await runProcessorsForMedia(mediaIds, Array.from(selected));
      onStarted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        Rerun Processors
        <Typography variant="body2" color="text.secondary" mt={0.5}>
          {mediaIds.length} item{mediaIds.length !== 1 ? "s" : ""} selected
        </Typography>
      </DialogTitle>
      <DialogContent>
        <FormGroup>
          {PROCESSORS.map((p) => (
            <FormControlLabel
              key={p.name}
              control={
                <Checkbox
                  checked={selected.has(p.name)}
                  onChange={() => toggle(p.name)}
                  disabled={loading}
                />
              }
              label={p.label}
            />
          ))}
        </FormGroup>
        {error && (
          <Typography color="error" variant="body2" mt={1}>
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleRun}
          variant="contained"
          disabled={loading || selected.size === 0}
          startIcon={loading ? <CircularProgress size={16} /> : undefined}
        >
          Run
        </Button>
      </DialogActions>
    </Dialog>
  );
};
