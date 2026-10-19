import { useState } from "react";
import { FormGroup, Grid, TextField } from "@mui/material";
import { ConfigSectionProps, SwitchSetting } from "./shared";

/** "jpg, .HEIC ,png" -> [".jpg", ".heic", ".png"] */
const parseSuffixList = (raw: string): string[] =>
  raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .map((s) => (s.startsWith(".") ? s : "." + s));

export default function ScanSection({
  config,
  onValueChange,
}: ConfigSectionProps) {
  // Local text buffers for comma-separated fields — avoids cursor-jump caused
  // by the parse→join round-trip through config state on every keystroke.
  const [imageSuffixesText, setImageSuffixesText] = useState<string | null>(null);
  const [videoSuffixesText, setVideoSuffixesText] = useState<string | null>(null);

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="Scan Interval (minutes)"
          value={config.scan.scan_interval_minutes}
          onChange={(e) =>
            onValueChange(
              "scan",
              "scan_interval_minutes",
              parseInt(e.target.value)
            )
          }
          fullWidth
          margin="normal"
          type="number"
          helperText="How often to look for new/changed files when Auto Scan is on"
        />
      </Grid>
      <Grid size={{ xs: 12 }}>
        <FormGroup>
          <SwitchSetting
            label="Auto Scan"
            checked={config.scan.auto_scan}
            onChange={(checked) => onValueChange("scan", "auto_scan", checked)}
            description="Periodically scans media directories in the background."
          />
          <SwitchSetting
            label="Auto Clean on Scan"
            checked={config.scan.auto_clean_on_scan}
            onChange={(checked) =>
              onValueChange("scan", "auto_clean_on_scan", checked)
            }
            description="Flags missing files after each scan so you can review or auto-remove them later."
          />
          <SwitchSetting
            label="Auto Cleanup Without Review"
            checked={config.scan.auto_cleanup_without_review}
            onChange={(checked) =>
              onValueChange("scan", "auto_cleanup_without_review", checked)
            }
            description="When enabled, missing files are deleted automatically after the grace period below."
          />
          <TextField
            label="Cleanup Grace Period (hours)"
            type="number"
            value={config.scan.auto_cleanup_grace_hours}
            onChange={(e) =>
              onValueChange(
                "scan",
                "auto_cleanup_grace_hours",
                e.target.value === "" ? 0 : Math.max(0, Number(e.target.value))
              )
            }
            inputProps={{ min: 0 }}
            margin="normal"
            sx={{ ml: 6, maxWidth: 240 }}
            helperText="Hours a file can remain missing before auto cleanup removes it."
          />
          <SwitchSetting
            label="Auto Cluster on Scan"
            checked={config.scan.auto_cluster_on_scan}
            onChange={(checked) =>
              onValueChange("scan", "auto_cluster_on_scan", checked)
            }
            description="Automatically clusters new faces into persons after each scan."
          />
          <SwitchSetting
            label="Auto Rotate"
            checked={config.scan.auto_rotate}
            onChange={(checked) => onValueChange("scan", "auto_rotate", checked)}
            description="Applies EXIF orientation to files and normalizes rotation."
          />
          <SwitchSetting
            label="Skip Thumbnails on Scan"
            checked={config.scan.skip_thumbnails_on_scan}
            onChange={(checked) =>
              onValueChange("scan", "skip_thumbnails_on_scan", checked)
            }
            description="Ignores files and folders named like thumbnails (for example, thumb_* or a thumbnails folder)."
          />
        </FormGroup>
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="Image Formats"
          value={imageSuffixesText ?? config.scan.IMAGE_SUFFIXES.join(", ")}
          onChange={(e) => setImageSuffixesText(e.target.value)}
          onBlur={(e) => {
            onValueChange(
              "scan",
              "IMAGE_SUFFIXES",
              parseSuffixList(e.target.value)
            );
            setImageSuffixesText(null);
          }}
          fullWidth
          margin="normal"
          helperText="Comma-separated image extensions (e.g. .jpg, .heic, .png)"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="Video Formats"
          value={videoSuffixesText ?? config.scan.VIDEO_SUFFIXES.join(", ")}
          onChange={(e) => setVideoSuffixesText(e.target.value)}
          onBlur={(e) => {
            onValueChange(
              "scan",
              "VIDEO_SUFFIXES",
              parseSuffixList(e.target.value)
            );
            setVideoSuffixesText(null);
          }}
          fullWidth
          margin="normal"
          helperText="Comma-separated video extensions (e.g. .mp4, .mov, .mkv)"
        />
      </Grid>
    </Grid>
  );
}
