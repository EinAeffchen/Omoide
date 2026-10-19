import { useMemo, useState } from "react";
import { FormControl, InputLabel, MenuItem, Select } from "@mui/material";
import PersonOffIcon from "@mui/icons-material/PersonOff";

import { ReviewPage } from "../components/ReviewPage";
import { formatBytes } from "../formatUtils";
import { NoPersonsMediaItem } from "../types";

type Scope = "processed" | "all";

export default function NopersonsPage() {
  const [scope, setScope] = useState<Scope>("processed");
  const filters = useMemo(() => ({ scope }), [scope]);

  return (
    <ReviewPage<NoPersonsMediaItem>
      endpoint="/api/nopersons"
      title="No Persons Detected"
      description={
        <>
          Media where face detection was run but no persons were identified.
          Use this view to review and tidy up unrecognized content, or switch to{" "}
          <strong>All unlinked</strong> to see every item with no person
          association regardless of processing status. Click any thumbnail to
          open the full media view.
        </>
      }
      filters={filters}
      controls={
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="nopersons-scope">Scope</InputLabel>
          <Select
            labelId="nopersons-scope"
            label="Scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
          >
            <MenuItem value="processed">Processed — no persons found</MenuItem>
            <MenuItem value="all">All unlinked to any person</MenuItem>
          </Select>
        </FormControl>
      }
      rerunProcessors
      refreshOn={["process_media", "cluster_persons", "run_processor_for_media"]}
      statsText={(total) => `${total.toLocaleString()} item${total !== 1 ? "s" : ""}`}
      emptyIcon={<PersonOffIcon />}
      emptyText={() =>
        scope === "processed"
          ? "No processed media without persons. Run face detection to populate this view."
          : "All media is linked to at least one person."
      }
      badge={(item) => (item.duration != null ? { label: "video" } : undefined)}
      caption={(item) => formatBytes(item.size)}
    />
  );
}
