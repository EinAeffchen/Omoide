import config from "./config";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Non-GET endpoints that only read; mirrors `allow_in_presentation_mode`
// on the backend.
const READ_ONLY_API_PATHS = ["/api/search/by-image"];

const requestMethod = (input: RequestInfo | URL, init?: RequestInit) =>
  (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

const requestPath = (input: RequestInfo | URL) => {
  const raw = input instanceof Request ? input.url : String(input);
  return new URL(raw, window.location.href).pathname;
};

/**
 * Frontend counterpart of the backend's presentation-mode guard: while the
 * app runs read-only, no write request to the API leaves the browser, even
 * from a control that forgot to hide itself. Callers get the same 403 the
 * server would send.
 */
export function installPresentationGuard(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (config.PRESENTATION_MODE && !READ_METHODS.has(requestMethod(input, init))) {
      const path = requestPath(input);
      if (
        path.includes("/api/") &&
        !READ_ONLY_API_PATHS.some((allowed) => path.endsWith(allowed))
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ detail: "Not allowed in presentation mode." }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          )
        );
      }
    }
    return originalFetch(input, init);
  };
}
