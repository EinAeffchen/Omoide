import EventBusyIcon from "@mui/icons-material/EventBusy";

import { ReviewPage } from "../components/ReviewPage";
import { formatBytes } from "../formatUtils";
import { ReviewMediaItem } from "../types";

export default function NoExifDatePage() {
  return (
    <ReviewPage<ReviewMediaItem>
      endpoint="/api/noexifdate"
      title="No EXIF Date"
      description="Media with no capture timestamp in their EXIF metadata. These are typically screenshots, downloaded images, WhatsApp-forwarded content, or files whose metadata was stripped. They appear at an incorrect position in timeline views."
      statsText={(total) =>
        `${total.toLocaleString()} item${total !== 1 ? "s" : ""} without EXIF date`
      }
      emptyIcon={<EventBusyIcon />}
      emptyText={() => "All media has a capture date in its EXIF metadata."}
      badge={(item) => (item.duration != null ? { label: "video" } : undefined)}
      caption={(item) =>
        `${formatBytes(item.size)}${
          item.width && item.height ? ` · ${item.width}×${item.height}` : ""
        }`
      }
    />
  );
}
