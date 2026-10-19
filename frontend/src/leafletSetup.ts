// Leaflet's CSS and default marker icons, imported only by the map pages so
// the library stays out of the main bundle.
import "leaflet/dist/leaflet.css";

import L from "leaflet";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

// Bundlers rewrite the asset URLs, so point the default icon at them
// explicitly instead of letting Leaflet guess them from its CSS.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });
