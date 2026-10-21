import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  Grid,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";
import { startTask } from "../../services/taskActions";
import { VideoConversionMode } from "../../types";
import { ConfigSectionProps, SwitchSetting, getErrorMessage } from "./shared";

const MODE_CONSEQUENCES: Record<Exclude<VideoConversionMode, "off">, string> = {
  keep_original:
    "After each scan, every video your browser cannot play is converted to a playable MP4 copy stored in Omoide's data folder. Your original files are not changed, but the copies need additional disk space (roughly as much as the converted videos) and converting uses a lot of CPU or GPU time.",
  replace_original:
    "After each scan, every video your browser cannot play is converted to MP4 and the ORIGINAL FILE IS DELETED. The original format and quality cannot be restored, and other programs referring to the old file name will no longer find it. Read-only directories are skipped.",
};

/** Video settings, including how unplayable videos are converted. Switching
 * automatic conversion on requires confirming its consequences. */
export default function VideoSection({ config, onValueChange }: ConfigSectionProps) {
  const [pendingMode, setPendingMode] = useState<Exclude<VideoConversionMode, "off"> | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [convertMessage, setConvertMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const mode = config.video.auto_convert ?? "off";

  const requestMode = (next: VideoConversionMode) => {
    if (next === "off") {
      onValueChange("video", "auto_convert", "off");
      return;
    }
    setAcknowledged(false);
    setPendingMode(next);
  };

  const confirmMode = () => {
    if (pendingMode) onValueChange("video", "auto_convert", pendingMode);
    setPendingMode(null);
  };

  const convertNow = async () => {
    try {
      await startTask("convert_videos");
      setConvertMessage({ ok: true, text: "Conversion started; progress is shown under Tasks." });
    } catch (error) {
      setConvertMessage({ ok: false, text: getErrorMessage(error, "Failed to start conversion") });
    }
  };

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="Max Frames per Video"
          value={config.video.max_frames_per_video}
          onChange={(e) =>
            onValueChange(
              "video",
              "max_frames_per_video",
              parseInt(e.target.value)
            )
          }
          fullWidth
          margin="normal"
          type="number"
          helperText="Fallback frame sampling count when scene detection fails"
        />
      </Grid>
      <Grid size={{ xs: 12 }}>
        <FormGroup>
          <SwitchSetting
            label="Auto Scene Detection"
            checked={config.video.auto_scene_detection}
            onChange={(checked) =>
              onValueChange("video", "auto_scene_detection", checked)
            }
            description="Detects scene changes and uses those frames for thumbnails and search."
          />
          <SwitchSetting
            label="Convert Unplayable Videos While Playing"
            checked={config.video.convert_on_the_fly ?? false}
            onChange={(checked) =>
              onValueChange("video", "convert_on_the_fly", checked)
            }
            description="Videos your browser cannot show (e.g. HEVC phone videos, AVI, WMV) are converted by ffmpeg while they play. Files are not changed. Jumping to another position restarts the conversion, which takes a moment, and playback uses CPU or GPU time. Without this, such videos offer a one-off “Play converted version” button."
          />
        </FormGroup>
      </Grid>
      <Grid size={{ xs: 12 }}>
        <FormControl>
          <FormLabel id="auto-convert-label">Automatic Conversion of Unplayable Videos</FormLabel>
          <RadioGroup
            aria-labelledby="auto-convert-label"
            value={mode}
            onChange={(e) => requestMode(e.target.value as VideoConversionMode)}
          >
            <FormControlLabel value="off" control={<Radio />} label="Off (recommended unless you need it)" />
            <FormControlLabel value="keep_original" control={<Radio />} label="Convert and keep the originals (uses extra disk space)" />
            <FormControlLabel value="replace_original" control={<Radio />} label="Convert and replace the originals (deletes the original files)" />
          </RadioGroup>
        </FormControl>
        {mode !== "off" && (
          <Alert severity={mode === "replace_original" ? "warning" : "info"} sx={{ mt: 1 }}>
            {MODE_CONSEQUENCES[mode]}
          </Alert>
        )}
        <Box sx={{ mt: 2, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          <Button variant="outlined" onClick={convertNow} disabled={mode === "off"}>
            Convert unplayable videos now
          </Button>
          <Typography variant="caption" color="text.secondary">
            Uses the saved conversion mode — save your changes first.
          </Typography>
        </Box>
        {convertMessage && (
          <Alert severity={convertMessage.ok ? "success" : "error"} sx={{ mt: 1 }} onClose={() => setConvertMessage(null)}>
            {convertMessage.text}
          </Alert>
        )}
      </Grid>

      <Dialog open={pendingMode !== null} onClose={() => setPendingMode(null)} aria-labelledby="auto-convert-dialog-title">
        <DialogTitle id="auto-convert-dialog-title">
          {pendingMode === "replace_original" ? "Replace original videos?" : "Keep converted copies?"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>{pendingMode && MODE_CONSEQUENCES[pendingMode]}</DialogContentText>
          {pendingMode === "replace_original" && (
            <FormControlLabel
              sx={{ mt: 2 }}
              control={<Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />}
              label="I understand that the original video files will be permanently deleted."
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingMode(null)}>Cancel</Button>
          <Button
            onClick={confirmMode}
            color={pendingMode === "replace_original" ? "error" : "primary"}
            variant="contained"
            disabled={pendingMode === "replace_original" && !acknowledged}
          >
            {pendingMode === "replace_original" ? "Replace originals" : "Keep copies"}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}
