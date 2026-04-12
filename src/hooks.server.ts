import { syncRosters } from "$lib/server/nhl";

let lastCheckAt = 0;
const ONE_HOUR = 60 * 60 * 1000;

function maybeSync() {
  const now = Date.now();
  if (now - lastCheckAt < ONE_HOUR) return;
  lastCheckAt = now;
  // syncRosters itself checks the 24h threshold — this just ensures
  // we check at most once per hour rather than on every request
  syncRosters().catch((err) => console.error("Failed to sync rosters:", err));
}

export async function init() {
  lastCheckAt = Date.now();
  syncRosters().catch((err) => console.error("Failed to sync rosters:", err));
}

export const handle = async ({ event, resolve }) => {
  maybeSync();
  return await resolve(event);
};
