import { API } from "../config";

/** An HTTP error from the backend, carrying FastAPI's `detail` as message. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue | QueryValue[]>;

export interface ApiOptions extends Omit<RequestInit, "body"> {
  /** Query parameters; null/undefined/"" are skipped, arrays repeat the key. */
  query?: Query;
  /** JSON-encoded unless it is FormData. */
  body?: unknown;
  /** Message used when the server response carries no usable `detail`. */
  errorMessage?: string;
}

export function buildQuery(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (value === null || value === undefined || value === "") continue;
      params.append(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function errorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    const detail = data?.detail;
    if (typeof detail === "string") return detail;
    if (typeof detail?.message === "string") return detail.message;
    // FastAPI validation errors: [{ msg, loc, ... }]
    if (Array.isArray(detail) && detail.length > 0) {
      return detail.map((d) => d?.msg ?? String(d)).join("; ");
    }
  } catch {
    // Body was empty or not JSON.
  }
  return fallback;
}

/**
 * Fetch `${API}${path}` and parse the JSON response (undefined for empty
 * bodies). Non-2xx responses throw an ApiError with the server's detail.
 * Pass `signal` to make the request cancellable.
 */
export async function apiFetch<T = void>(
  path: string,
  { query, body, errorMessage, headers, ...init }: ApiOptions = {}
): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`${API}${path}${buildQuery(query)}`, {
    ...init,
    headers:
      body !== undefined && !isForm
        ? { "Content-Type": "application/json", ...headers }
        : headers,
    body:
      body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ApiError(
      await errorDetail(res, errorMessage ?? `Request failed (${res.status})`),
      res.status
    );
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** True for errors caused by aborting a request (not worth reporting). */
export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";
