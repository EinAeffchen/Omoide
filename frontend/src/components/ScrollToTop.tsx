import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

export function ScrollToTop() {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    // Keep scroll positions on browser back/forward (POP) and when a media
    // modal opens over a background grid.
    if (navigationType === "POP") return;
    if (location.state?.backgroundLocation) return;
    window.scrollTo(0, 0);
  }, [location, navigationType]);

  return null;
}
