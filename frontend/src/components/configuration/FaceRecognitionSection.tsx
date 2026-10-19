import {
  Alert,
  Box,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { AppConfig } from "../../types";
import {
  FacePresetKey,
  facePresetDescriptions,
  facePresets,
} from "./facePresets";
import { ConfigSectionProps, ConfigUpdate } from "./shared";

export type FaceSettingsMode = "presets" | "manual";

type FaceConfig = AppConfig["face_recognition"];
type NumericFaceKey = {
  [K in keyof FaceConfig]: FaceConfig[K] extends number ? K : never;
}[keyof FaceConfig];

interface NumericFieldDef {
  key: NumericFaceKey;
  label: string;
  helperText: string;
  parse: (raw: string) => number;
  inputProps?: { step?: number; min?: number; max?: number };
}

const float = (raw: string) => parseFloat(raw);
const int = (raw: string) => parseInt(raw, 10);

const DETECTION_FIELDS: NumericFieldDef[] = [
  {
    key: "face_recognition_min_confidence",
    label: "Min Confidence",
    parse: float,
    helperText:
      "Lower = detect more faces (including low-quality), higher = stricter",
  },
  {
    key: "existing_person_cosine_threshold",
    label: "Existing Person Cosine Threshold",
    parse: float,
    helperText:
      "Stricter threshold when attaching to already-established persons",
  },
  {
    key: "existing_person_min_cosine_margin",
    label: "Existing Person Min Cosine Margin",
    parse: float,
    inputProps: { step: 0.01 },
    helperText:
      "Require a gap between best and 2nd-best match to avoid ambiguity",
  },
  {
    key: "rerun_face_iou_dedupe_threshold",
    label: "Rerun Face IoU Dedup Threshold",
    parse: float,
    inputProps: { step: 0.01, min: 0, max: 1 },
    helperText:
      "On face rerun, skip detections overlapping existing faces above this IoU",
  },
  {
    key: "face_recognition_min_face_pixels",
    label: "Min Face Pixels",
    parse: int,
    helperText: "Minimum face area (in pixels) to be considered detectible",
  },
];

const SHARPNESS_FIELD: NumericFieldDef = {
  key: "face_sharpness_min_variance",
  label: "Sharpness Min Variance",
  parse: float,
  inputProps: { step: 1, min: 0 },
  helperText:
    "Laplacian variance threshold — lower = accept more blur (try 20–40)",
};

const PERSON_FIELDS: NumericFieldDef[] = [
  {
    key: "person_min_face_count",
    label: "Min Face Count per Person",
    parse: int,
    helperText: "Faces required to automatically create a new person",
  },
  {
    key: "person_min_media_count",
    label: "Min Media Count per Person",
    parse: int,
    helperText:
      "Distinct media items required before a cluster becomes a person",
  },
  {
    key: "person_merge_search_k",
    label: "Merge search candidates",
    parse: int,
    helperText:
      "How many persons to compare against for merging known people upon clustering",
  },
  {
    key: "person_cluster_max_l2_radius",
    label: "Person Cluster Max L2 Radius",
    parse: float,
    inputProps: { step: 0.01 },
    helperText:
      "Max allowed L2 distance around centroid when forming a new person",
  },
  {
    key: "person_merge_percent_similarity",
    label: "Person Merge  Similarity % Threshold",
    parse: int,
    inputProps: { step: 1, min: 0, max: 100 },
    helperText:
      "After clustering, merge two persons when their similarity percent exceeds this threshold",
  },
  {
    key: "cluster_batch_size",
    label: "Cluster Batch Size",
    parse: int,
    helperText: "Faces processed per clustering batch (memory vs. speed)",
  },
];

/** Chinese Whispers settings (only shown for the binary build). */
const CHINESE_WHISPERS_FIELDS: NumericFieldDef[] = [
  {
    key: "cw_threshold",
    label: "Chinese Whispers Threshold",
    parse: float,
    helperText: "Threshold for vector distance. Smaller = stricter matching",
  },
  {
    key: "cw_iterations",
    label: "Chinese Whispers Iterations",
    parse: int,
    helperText: "Iterations for clustering. Usually 20 should be sufficient.",
  },
  {
    key: "cw_k_neighbors",
    label: "Chinese Whispers K nearest neighbors",
    parse: int,
    helperText: "K neirest neighbors for clustering graph.",
  },
];

/** HDBSCAN settings (only shown in Docker). The selection-method Select sits between these. */
const HDBSCAN_FIELDS: NumericFieldDef[] = [
  {
    key: "hdbscan_min_cluster_size",
    label: "HDBSCAN Min Cluster Size",
    parse: int,
    helperText:
      "Minimum faces to form a cluster; larger merges clusters (fewer small identities)",
  },
  {
    key: "hdbscan_min_samples",
    label: "HDBSCAN Min Samples",
    parse: int,
    helperText:
      "Higher = more conservative (more points marked as noise/outliers)",
  },
];

const HDBSCAN_EPSILON_FIELD: NumericFieldDef = {
  key: "hdbscan_cluster_selection_epsilon",
  label: "HDBSCAN Selection Epsilon",
  parse: float,
  inputProps: { step: 0.01 },
  helperText:
    "Extra split sensitivity; larger values produce more, smaller clusters",
};

interface FaceRecognitionSectionProps extends ConfigSectionProps {
  onChange: ConfigUpdate;
  /** Lifted to the page so the chosen sub-tab survives switching tabs. */
  mode: FaceSettingsMode;
  onModeChange: (mode: FaceSettingsMode) => void;
}

export default function FaceRecognitionSection({
  config,
  onValueChange,
  onChange,
  mode,
  onModeChange,
}: FaceRecognitionSectionProps) {
  const face = config.face_recognition;
  const activeFacePreset =
    face.preset === "custom" ? null : (face.preset as FacePresetKey);

  const applyFacePreset = (preset: FacePresetKey) => {
    onChange((prev) => ({
      ...prev,
      face_recognition: {
        ...prev.face_recognition,
        ...facePresets[preset],
        preset,
      },
    }));
    onModeChange("presets");
  };

  const setFaceValue = <K extends keyof FaceConfig>(
    key: K,
    value: FaceConfig[K]
  ) => {
    onChange((prev) => {
      if (
        typeof value === "number" &&
        (Number.isNaN(value) || value === Infinity || value === -Infinity)
      ) {
        return prev;
      }
      const nextFace = {
        ...prev.face_recognition,
        [key]: value,
      };
      if (key !== "preset") {
        nextFace.preset = "custom";
      }
      return { ...prev, face_recognition: nextFace };
    });
    if (key !== "preset") {
      onModeChange("manual");
    }
  };

  const renderNumericField = (field: NumericFieldDef) => (
    <Grid key={field.key} size={{ xs: 12, sm: 6 }}>
      <TextField
        label={field.label}
        value={face[field.key]}
        onChange={(e) => setFaceValue(field.key, field.parse(e.target.value))}
        fullWidth
        margin="normal"
        type="number"
        inputProps={field.inputProps}
        helperText={field.helperText}
      />
    </Grid>
  );

  return (
    <Box>
      <FormControl fullWidth margin="normal" sx={{ mt: 0, mb: 3 }}>
        <InputLabel id="face-detection-model-label">
          Face Detection Model
        </InputLabel>
        <Select
          labelId="face-detection-model-label"
          value={face.face_detection_model}
          label="Face Detection Model"
          onChange={(e) =>
            onValueChange(
              "face_recognition",
              "face_detection_model",
              e.target.value as FaceConfig["face_detection_model"]
            )
          }
        >
          <MenuItem value="buffalo_l">Accurate (buffalo_l)</MenuItem>
          <MenuItem value="buffalo_s">Fast (buffalo_s)</MenuItem>
        </Select>
        <FormHelperText>
          The fast detector finds faces about 4x quicker but misses more
          small or partly hidden faces. Recognition is the same for both,
          so existing people are unaffected.
        </FormHelperText>
      </FormControl>
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
        <Tabs
          value={mode}
          onChange={(_, value: FaceSettingsMode) => onModeChange(value)}
          aria-label="Face recognition configuration mode"
        >
          <Tab label="Presets" value="presets" />
          <Tab label="Manual" value="manual" />
        </Tabs>
      </Box>
      {mode === "presets" ? (
        <Box>
          <ToggleButtonGroup
            exclusive
            color="primary"
            value={activeFacePreset}
            onChange={(_, next: FacePresetKey | null) => {
              if (next) {
                applyFacePreset(next);
              }
            }}
            aria-label="Face recognition preset"
            sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}
          >
            <ToggleButton value="strict">Strict</ToggleButton>
            <ToggleButton value="normal">Normal</ToggleButton>
            <ToggleButton value="loose">Loose</ToggleButton>
          </ToggleButtonGroup>
          {face.preset === "custom" && (
            <Alert severity="info" sx={{ mt: 2 }}>
              You are currently using custom values. Switch to Manual to
              review them or pick a preset above to restore defaults.
            </Alert>
          )}
          {activeFacePreset && (
            <Typography variant="body2" sx={{ mt: 2 }}>
              {facePresetDescriptions[activeFacePreset]}
            </Typography>
          )}
          <Typography variant="caption" sx={{ mt: 2, display: "block" }}>
            Presets adjust detection strictness, person assignment, and
            clustering thresholds together.
          </Typography>
        </Box>
      ) : (
        <Box>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Changing any field switches the preset to Custom.
          </Alert>
          <Grid container spacing={2}>
            {DETECTION_FIELDS.map(renderNumericField)}
            <Grid size={{ xs: 12 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={face.face_sharpness_filter_enabled}
                    onChange={(e) =>
                      setFaceValue(
                        "face_sharpness_filter_enabled",
                        e.target.checked
                      )
                    }
                  />
                }
                label="Sharpness filter"
              />
              <Typography variant="caption" display="block" color="text.secondary">
                Skip blurry or out-of-focus face crops before embedding. Disable to detect faces in soft-focus photos (e.g. baby close-ups).
              </Typography>
            </Grid>
            {face.face_sharpness_filter_enabled &&
              renderNumericField(SHARPNESS_FIELD)}
            {PERSON_FIELDS.map(renderNumericField)}
            {config.general.is_binary &&
              CHINESE_WHISPERS_FIELDS.map(renderNumericField)}
            {config.general.is_docker && (
              <>
                {HDBSCAN_FIELDS.map(renderNumericField)}
                <Grid size={{ xs: 12, sm: 6 }}>
                  <FormControl fullWidth margin="normal">
                    <InputLabel id="hdbscan-method-manual-label">
                      HDBSCAN Cluster Selection Method
                    </InputLabel>
                    <Select
                      labelId="hdbscan-method-manual-label"
                      value={face.hdbscan_cluster_selection_method}
                      label="HDBSCAN Cluster Selection Method"
                      onChange={(e) =>
                        setFaceValue(
                          "hdbscan_cluster_selection_method",
                          e.target.value as string
                        )
                      }
                    >
                      <MenuItem value="leaf">
                        leaf (finer, more granular clusters)
                      </MenuItem>
                      <MenuItem value="eom">
                        eom (more stable, fewer splits)
                      </MenuItem>
                    </Select>
                    <FormHelperText>
                      Controls granularity of clusters; "leaf" yields finer
                      segmentation.
                    </FormHelperText>
                  </FormControl>
                </Grid>
                {renderNumericField(HDBSCAN_EPSILON_FIELD)}
              </>
            )}
          </Grid>
        </Box>
      )}
    </Box>
  );
}
