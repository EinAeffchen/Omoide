import { useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { runProcessor } from "../../services/taskActions";
import { AppConfig } from "../../types";
import { ConfigUpdate, ShowSnackbar } from "./shared";

interface ProcessorRow {
  processorName: string;
  label: string;
  description: string;
  enabled: boolean;
  disabled?: boolean;
  onToggle: (v: boolean) => void;
}

interface ProcessorsSectionProps {
  config: AppConfig;
  onChange: ConfigUpdate;
  showSnackbar: ShowSnackbar;
}

export default function ProcessorsSection({
  config,
  onChange,
  showSnackbar,
}: ProcessorsSectionProps) {
  const [runningProcessor, setRunningProcessor] = useState<string | null>(null);

  const handleRunProcessor = async (name: string, force: boolean) => {
    setRunningProcessor(name);
    try {
      await runProcessor(name, force);
      showSnackbar(
        `Started processor "${name}"${force ? " (reprocessing all)" : ""}.`,
        "success"
      );
    } catch {
      showSnackbar(`Failed to start processor "${name}".`, "error");
    } finally {
      setRunningProcessor(null);
    }
  };

  const handleProcessorToggle = (
    key: keyof AppConfig["processors"],
    value: boolean
  ) => {
    let infoMessage: string | null = null;
    onChange((prev) => {
      let next = {
        ...prev,
        processors: { ...prev.processors, [key]: value },
      };
      if (key === "image_embedding_processor_active" && !value) {
        const disabled: string[] = [];
        if (prev.tagging.auto_tagging) {
          disabled.push("Auto Tagger");
          next = {
            ...next,
            tagging: { ...prev.tagging, auto_tagging: false },
          };
        }
        if (disabled.length > 0) {
          infoMessage = `Disabled ${disabled.join(", ")} because image embeddings are turned off.`;
        }
      }
      return next;
    });
    if (infoMessage) {
      showSnackbar(infoMessage, "info");
    }
  };

  const handleAutoTaggingToggle = (value: boolean) => {
    if (!config.processors.image_embedding_processor_active && value) {
      showSnackbar(
        "Enable the image embeddings processor before turning on Auto Tagger.",
        "info"
      );
      return;
    }
    onChange((prev) => ({
      ...prev,
      tagging: { ...prev.tagging, auto_tagging: value },
    }));
  };

  const handleFaceProcessorToggle = (value: boolean) => {
    if (value && !config.general.enable_people) {
      showSnackbar(
        "Enable people features before turning on the face processor.",
        "info"
      );
      return;
    }
    handleProcessorToggle("face_processor_active", value);
  };

  const rows: ProcessorRow[] = [
    {
      processorName: "exif",
      label: "EXIF Processor",
      description:
        "Extracts date, camera, GPS and other metadata for search & maps.",
      enabled: config.processors.exif_processor_active,
      onToggle: (v) => handleProcessorToggle("exif_processor_active", v),
    },
    {
      processorName: "faces",
      label: "Face Processor",
      description: `Detects faces in images and prepares them for recognition.${!config.general.enable_people ? " Enable People to turn this on." : ""}`,
      enabled: config.processors.face_processor_active,
      disabled: !config.general.enable_people,
      onToggle: handleFaceProcessorToggle,
    },
    {
      processorName: "embedding_extractor",
      label: "Image Embedding Processor",
      description:
        "Generates CLIP embeddings for search, similarity, and related content.",
      enabled: config.processors.image_embedding_processor_active,
      onToggle: (v) =>
        handleProcessorToggle("image_embedding_processor_active", v),
    },
    {
      processorName: "auto_tagger",
      label: "Auto Tagger",
      description:
        "Suggests tags based on CLIP embeddings. Requires image embeddings.",
      enabled: config.tagging.auto_tagging,
      disabled: !config.processors.image_embedding_processor_active,
      onToggle: handleAutoTaggingToggle,
    },
    {
      processorName: "blur",
      label: "Blur Detector",
      description:
        "Scores each image for sharpness (Laplacian variance) to identify blurry photos.",
      enabled: config.processors.blur_processor_active,
      onToggle: (v) => handleProcessorToggle("blur_processor_active", v),
    },
  ];

  return (
    <Stack spacing={2}>
      {rows.map((proc) => {
        const isRunning = runningProcessor === proc.processorName;
        return (
          <Paper key={proc.processorName} variant="outlined" sx={{ p: 2 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 2,
              }}
            >
              <Box sx={{ flex: 1 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={proc.enabled}
                      onChange={(e) => proc.onToggle(e.target.checked)}
                      disabled={proc.disabled}
                    />
                  }
                  label={proc.label}
                />
                <Typography
                  variant="caption"
                  sx={{ ml: 6, mt: -0.5, display: "block", color: "text.secondary" }}
                >
                  {proc.description}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", gap: 1, flexShrink: 0, mt: 0.5 }}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={isRunning}
                  onClick={() => handleRunProcessor(proc.processorName, false)}
                  aria-label={isRunning ? `Run ${proc.label}` : undefined}
                >
                  {isRunning ? <CircularProgress size={16} /> : "Run"}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  disabled={isRunning}
                  onClick={() => handleRunProcessor(proc.processorName, true)}
                >
                  Rerun All
                </Button>
              </Box>
            </Box>
          </Paper>
        );
      })}
    </Stack>
  );
}
