import { Alert, Grid, TextField } from "@mui/material";
import { ConfigSectionProps } from "./shared";

export default function AiSection({ config, onValueChange }: ConfigSectionProps) {
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="Clip Model"
          value={`${config.ai.clip_model} (${config.ai.clip_model_embedding_size}-d)`}
          fullWidth
          margin="normal"
          InputProps={{ readOnly: true }}
          helperText="Clip model is locked. Set OMOIDE_AI__CLIP_MODEL in the environment to change it."
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="Min Search Distance"
          value={config.ai.min_search_dist}
          onChange={(e) =>
            onValueChange("ai", "min_search_dist", parseFloat(e.target.value))
          }
          fullWidth
          margin="normal"
          type="number"
          helperText="Higher = stricter similarity for search (fewer, more accurate results)"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="Min Similarity Distance"
          value={config.ai.min_similarity_dist}
          onChange={(e) =>
            onValueChange(
              "ai",
              "min_similarity_dist",
              parseFloat(e.target.value)
            )
          }
          fullWidth
          margin="normal"
          type="number"
          helperText="Higher = stronger match needed to count media as similar"
        />
      </Grid>
      <Grid size={{ xs: 12 }}>
        <Alert severity="info" sx={{ mt: 1 }}>
          People clustering controls now live under Face Recognition presets
          and manual tuning.
        </Alert>
      </Grid>
    </Grid>
  );
}
