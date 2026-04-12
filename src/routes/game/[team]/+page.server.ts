import { error } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { players, teams } from "$lib/server/db/schema";

export function load({ params }) {
    const team = db.select().from(teams).where(eq(teams.id, params.team)).get();
    if (!team) throw error(404, "Team not found");
    const roster = db.select().from(players).where(eq(players.teamId, params.team)).all();
    return { team, roster };
}
