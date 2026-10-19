import LabelOffIcon from "@mui/icons-material/LabelOff";

import { ReviewPage } from "../components/ReviewPage";
import { formatBytes } from "../formatUtils";
import { ReviewMediaItem } from "../types";

export default function UntaggedPage() {
  return (
    <ReviewPage<ReviewMediaItem>
      endpoint="/api/untagged"
      title="Untagged Media"
      description="Media that has no tags assigned. Use this view to identify items that still need to be categorized. Click any thumbnail to open the full media view and add tags."
      statsText={(total) =>
        `${total.toLocaleString()} untagged item${total !== 1 ? "s" : ""}`
      }
      emptyIcon={<LabelOffIcon />}
      emptyText={() => "All media has at least one tag assigned."}
      badge={(item) => (item.duration != null ? { label: "video" } : undefined)}
      caption={(item) => formatBytes(item.size)}
    />
  );
}
