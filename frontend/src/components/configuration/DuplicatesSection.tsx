import {
  FormControl,
  FormHelperText,
  Grid,
  InputLabel,
  MenuItem,
  Select,
} from "@mui/material";
import { AppConfig } from "../../types";
import { ConfigSectionProps } from "./shared";

export default function DuplicatesSection({
  config,
  onValueChange,
}: ConfigSectionProps) {
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, sm: 6 }}>
        <FormControl fullWidth margin="normal">
          <InputLabel id="dup-auto-handling-label">Auto Handling</InputLabel>
          <Select
            labelId="dup-auto-handling-label"
            value={config.duplicates.duplicate_auto_handling}
            label="Auto Handling"
            onChange={(e) =>
              onValueChange(
                "duplicates",
                "duplicate_auto_handling",
                e.target
                  .value as AppConfig["duplicates"]["duplicate_auto_handling"]
              )
            }
          >
            <MenuItem value="keep">keep (do nothing automatically)</MenuItem>
            <MenuItem value="remove">
              remove (resolve without deleting files)
            </MenuItem>
            <MenuItem value="blacklist">blacklist duplicates</MenuItem>
            <MenuItem value="delete">delete duplicates</MenuItem>
          </Select>
          <FormHelperText>
            Automatic action when duplicates are found. "keep" is the safest
            default.
          </FormHelperText>
        </FormControl>
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <FormControl fullWidth margin="normal">
          <InputLabel id="dup-keep-rule-label">Auto Keep Rule</InputLabel>
          <Select
            labelId="dup-keep-rule-label"
            value={config.duplicates.duplicate_auto_keep_rule}
            label="Auto Keep Rule"
            onChange={(e) =>
              onValueChange(
                "duplicates",
                "duplicate_auto_keep_rule",
                e.target
                  .value as AppConfig["duplicates"]["duplicate_auto_keep_rule"]
              )
            }
          >
            <MenuItem value="biggest">biggest file size</MenuItem>
            <MenuItem value="smallest">smallest file size</MenuItem>
            <MenuItem value="highest_res">highest resolution</MenuItem>
            <MenuItem value="lowest_res">lowest resolution</MenuItem>
            <MenuItem value="oldest">oldest file date</MenuItem>
            <MenuItem value="newest">newest file date</MenuItem>
          </Select>
          <FormHelperText>
            Which file to keep when auto-handling duplicates is enabled.
          </FormHelperText>
        </FormControl>
      </Grid>
    </Grid>
  );
}
