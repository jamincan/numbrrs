import { env } from "$env/dynamic/private";
import { error, json } from "@sveltejs/kit";
import { syncRostersOnce } from "$lib/server/nhl";
import type { RequestHandler } from "./$types";

/**
 * Manually trigger a roster sync against the NHL API.
 *
 *   POST /api/sync            -> starts a sync and returns immediately (202)
 *   POST /api/sync?wait=true  -> waits for the sync to finish before responding
 *
 * Requires an `Authorization: Bearer <SYNC_TOKEN>` header. The endpoint is
 * disabled (503) unless the SYNC_TOKEN secret is configured.
 */
export const POST: RequestHandler = async ({ request, url }) => {
  const token = env.SYNC_TOKEN;
  if (!token) {
    throw error(503, "Sync endpoint is not configured (SYNC_TOKEN unset)");
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${token}`) {
    throw error(401, "Unauthorized");
  }

  const { started, done } = syncRostersOnce();

  if (url.searchParams.get("wait") === "true") {
    try {
      await done;
    } catch (err) {
      console.error("Manual roster sync failed:", err);
      throw error(500, "Roster sync failed");
    }
    return json({ status: "completed" });
  }

  // Fire-and-forget: a full sync takes ~15s, so don't block the request on it.
  done.catch((err) => console.error("Manual roster sync failed:", err));
  return json({ status: started ? "started" : "already-running" }, { status: 202 });
};
