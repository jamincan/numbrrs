import { db } from "$lib/server/db";
import { teams } from "$lib/server/db/schema";

export function load() {
    return { teams: db.select().from(teams).all() };
}
