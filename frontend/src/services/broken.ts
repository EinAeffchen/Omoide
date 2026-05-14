import { API } from "../config";
import { BrokenMediaPage, BrokenResolvePayload } from "../types";

export const getBrokenMedia = async (params: {
  cursor?: string | null;
  limit?: number;
}): Promise<BrokenMediaPage> => {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  const res = await fetch(`${API}/api/broken?${query}`);
  if (!res.ok) throw new Error("Failed to load broken media");
  return res.json();
};

export const resolveBroken = async (
  payload: BrokenResolvePayload
): Promise<{ removed: number }> => {
  const res = await fetch(`${API}/api/broken/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "Failed to resolve broken media");
    throw new Error(msg || "Failed to resolve broken media");
  }
  return res.json();
};
