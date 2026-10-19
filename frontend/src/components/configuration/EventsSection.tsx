import { FormGroup, Grid, TextField } from "@mui/material";
import { ConfigSectionProps, SwitchSetting } from "./shared";

export default function EventsSection({
  config,
  onValueChange,
}: ConfigSectionProps) {
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12 }}>
        <FormGroup>
          <SwitchSetting
            label="Enable Events tab"
            checked={config.events.events_enabled}
            onChange={(checked) =>
              onValueChange("events", "events_enabled", checked)
            }
            description="Shows the Events tab and lets the library be clustered into trips and moments."
          />
          <SwitchSetting
            label="Preserve renamed events on rebuild"
            checked={config.events.preserve_renamed_on_rebuild}
            onChange={(checked) =>
              onValueChange("events", "preserve_renamed_on_rebuild", checked)
            }
            description={
              'When "Rebuild events" runs again, try to match renamed events to their new cluster by media overlap and keep the custom title. When off, a rebuild always wipes every title.'
            }
          />
        </FormGroup>
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="Gap Between Events (hours)"
          value={config.events.event_gap_hours}
          onChange={(e) =>
            onValueChange(
              "events",
              "event_gap_hours",
              parseFloat(e.target.value)
            )
          }
          fullWidth
          margin="normal"
          type="number"
          helperText="A new event starts when consecutive media are further apart than this"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label="Minimum Media per Event"
          value={config.events.event_min_media}
          onChange={(e) =>
            onValueChange(
              "events",
              "event_min_media",
              parseInt(e.target.value, 10)
            )
          }
          fullWidth
          margin="normal"
          type="number"
          helperText="Clusters smaller than this are discarded as noise"
        />
      </Grid>
    </Grid>
  );
}
