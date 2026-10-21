import {
  canPersistServer,
  validateServer,
  type MediaServer,
} from "../domain/servers";
import { diagnose } from "../domain/errors";
export const SERVERS_KEY = "opentv:servers:v1";
export function readServers(storage: Pick<Storage, "getItem">): MediaServer[] {
  try {
    const value = JSON.parse(storage.getItem(SERVERS_KEY) || "null");
    if (value?.version !== 1 || !Array.isArray(value.servers)) return [];
    const map = new Map<string, MediaServer>();
    for (const raw of value.servers.slice(0, 200)) {
      const server = validateServer(raw);
      if (server && canPersistServer(server)) map.set(server.id, server);
    }
    return [...map.values()];
  } catch {
    diagnose("servers.read-failed");
    return [];
  }
}
export function writeServers(
  storage: Pick<Storage, "setItem">,
  servers: MediaServer[],
): boolean {
  try {
    const safe = servers
      .map(validateServer)
      .filter((s): s is MediaServer => !!s && canPersistServer(s));
    storage.setItem(SERVERS_KEY, JSON.stringify({ version: 1, servers: safe }));
    return true;
  } catch {
    diagnose("servers.write-failed");
    return false;
  }
}
export const CHECKS_KEY = "opentv:server-checks:v1";
export interface ServerCheck {
  ok: boolean;
  at: number;
  // Why a check failed, in plain words. Music instances only.
  reason?: string;
}
// The last check result for each server, so it survives a reload.
export function readChecks(
  storage: Pick<Storage, "getItem">,
  key = CHECKS_KEY,
): Record<string, ServerCheck> {
  try {
    const value = JSON.parse(storage.getItem(key) || "{}");
    const out: Record<string, ServerCheck> = {};
    for (const [id, c] of Object.entries(value || {}).slice(0, 200)) {
      const r = c as Partial<ServerCheck>;
      if (typeof r?.ok === "boolean" && Number.isFinite(r.at))
        out[id] = {
          ok: r.ok,
          at: r.at as number,
          ...(typeof r.reason === "string"
            ? { reason: r.reason.slice(0, 200) }
            : {}),
        };
    }
    return out;
  } catch {
    return {};
  }
}
export function writeChecks(
  storage: Pick<Storage, "setItem">,
  checks: Record<string, ServerCheck>,
  key = CHECKS_KEY,
) {
  try {
    storage.setItem(key, JSON.stringify(checks));
  } catch {
    diagnose("servers.write-failed");
  }
}
// "just now", "5 min ago", "3 h ago", "2 d ago".
export function ago(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}
