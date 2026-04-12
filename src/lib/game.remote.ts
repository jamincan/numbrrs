import * as v from "valibot";
import { eq } from "drizzle-orm";
import { db } from "./server/db";
import { players, teams } from "./server/db/schema";
import { query } from "$app/server";
import { error } from "@sveltejs/kit";

export const getTeam = query(v.string(), (teamId) => {
  const team = db.select().from(teams).where(eq(teams.id, teamId)).get();
  if (!team) throw error(404, "Team not found");
  return team;
});

export const getTeams = query(() => {
  return db.select().from(teams).all();
});

export const getTeamRoster = query(v.string(), (teamId) => {
  return db.select().from(players).where(eq(players.teamId, teamId)).all();
});
