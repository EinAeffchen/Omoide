import { useState } from "react";
import { FormGroup, Grid, TextField } from "@mui/material";
import { ConfigSectionProps, SwitchSetting } from "./shared";

export default function TaggingSection({
  config,
  onValueChange,
}: ConfigSectionProps) {
  // Local text buffer — avoids cursor-jump from the split→join round-trip.
  const [customTagsText, setCustomTagsText] = useState<string | null>(null);

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12 }}>
        <TextField
          label="Custom Tags"
          value={customTagsText ?? config.tagging.custom_tags.join(",")}
          onChange={(e) => setCustomTagsText(e.target.value)}
          onBlur={(e) => {
            onValueChange("tagging", "custom_tags", e.target.value.split(","));
            setCustomTagsText(null);
          }}
          fullWidth
          margin="normal"
          helperText="Comma-separated list of tags"
        />
      </Grid>
      <Grid size={{ xs: 12 }}>
        <FormGroup>
          <SwitchSetting
            label="Auto Tagging"
            checked={config.tagging.auto_tagging}
            onChange={(checked) =>
              onValueChange("tagging", "auto_tagging", checked)
            }
            description="Uses the CLIP model to generate descriptive tags for media."
          />
          <SwitchSetting
            label="Use Default Tags"
            checked={config.tagging.use_default_tags}
            onChange={(checked) =>
              onValueChange("tagging", "use_default_tags", checked)
            }
            description="Includes a curated set of common tags alongside your custom list."
          />
        </FormGroup>
      </Grid>
    </Grid>
  );
}
