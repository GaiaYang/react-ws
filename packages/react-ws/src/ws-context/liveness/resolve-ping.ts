import type { LivenessOptions } from "./types";

export function resolvePingPayload(ping: LivenessOptions["ping"]): unknown {
  return typeof ping === "function" ? ping() : ping;
}
