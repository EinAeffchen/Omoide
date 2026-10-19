import { FormGroup, Grid, TextField, Typography } from "@mui/material";
import MediaDirectoriesSection from "./MediaDirectoriesSection";
import {
  ConfigSectionProps,
  ConfigUpdate,
  ShowSnackbar,
  SwitchSetting,
} from "./shared";

interface GeneralSectionProps extends ConfigSectionProps {
  onChange: ConfigUpdate;
  showSnackbar: ShowSnackbar;
  onAcknowledgeMediaDirRemoval: (normalizedPath: string) => void;
}

export default function GeneralSection({
  config,
  onValueChange,
  onChange,
  showSnackbar,
  onAcknowledgeMediaDirRemoval,
}: GeneralSectionProps) {
  const isBinary = !!config.general.is_binary;
  const canEditMediaDirs = !config.general.is_docker;

  const handleEnablePeopleToggle = (value: boolean) => {
    let infoMessage: string | null = null;
    onChange((prev) => {
      let next = {
        ...prev,
        general: { ...prev.general, enable_people: value },
      };
      if (!value && prev.processors.face_processor_active) {
        infoMessage =
          "Face processor disabled because people features were turned off.";
        next = {
          ...next,
          processors: { ...prev.processors, face_processor_active: false },
        };
      }
      return next;
    });
    if (infoMessage) {
      showSnackbar(infoMessage, "info");
    }
  };

  return (
    <Grid container spacing={2}>
      {!isBinary && (
        <>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Port"
              value={config.general.port}
              onChange={(e) =>
                onValueChange("general", "port", parseInt(e.target.value))
              }
              fullWidth
              margin="normal"
              type="number"
              helperText="HTTP port for the API/UI server (requires restart if running manually)"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Domain"
              value={config.general.domain}
              onChange={(e) =>
                onValueChange("general", "domain", e.target.value)
              }
              fullWidth
              margin="normal"
              helperText="Base URL used for generating links and API calls"
            />
          </Grid>
        </>
      )}
      {canEditMediaDirs && (
        <MediaDirectoriesSection
          config={config}
          onChange={onChange}
          onAcknowledgeRemoval={onAcknowledgeMediaDirRemoval}
        />
      )}
      <Grid size={{ xs: 12 }}>
        <FormGroup>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Read Only (Presentation Mode)
          </Typography>
          <Typography variant="body2" sx={{ ml: 0, mb: 1 }}>
            Managed only via Docker run environment (e.g.,
            <code style={{ marginLeft: 4 }}>
              -e OMOIDE_GENERAL__PRESENTATION_MODE=true
            </code>
            ). Current:{" "}
            {config.general.presentation_mode ? "Enabled" : "Disabled"}.
          </Typography>
          <SwitchSetting
            label="Enable People"
            checked={config.general.enable_people}
            onChange={handleEnablePeopleToggle}
            description="Enables face detection, recognition, and person clustering features."
          />
          <SwitchSetting
            label="Meme Mode"
            checked={config.general.meme_mode}
            onChange={(checked) =>
              onValueChange("general", "meme_mode", checked)
            }
            description="Displays animated GIFs in grids by loading the original files."
          />
        </FormGroup>
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="Thumbs per Folder"
          value={config.general.thumb_dir_folder_size}
          onChange={(e) =>
            onValueChange(
              "general",
              "thumb_dir_folder_size",
              parseInt(e.target.value)
            )
          }
          fullWidth
          margin="normal"
          type="number"
          helperText="Max thumbnails per subfolder (tune for filesystem inode limits)"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="Relationship Graph Node Limit"
          value={config.general.person_relationship_max_nodes}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            const sanitized = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
            onValueChange("general", "person_relationship_max_nodes", sanitized);
          }}
          fullWidth
          margin="normal"
          type="number"
          helperText="Maximum people to load when rendering the relationship graph"
        />
      </Grid>
    </Grid>
  );
}
