import { FormGroup, Grid, TextField } from "@mui/material";
import { ConfigSectionProps, SwitchSetting } from "./shared";

export default function VideoSection({
  config,
  onValueChange,
}: ConfigSectionProps) {
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
        </FormGroup>
      </Grid>
    </Grid>
  );
}
