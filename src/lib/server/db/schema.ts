import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(), // e.g. "TOR"
  name: text("name").notNull(), // e.g. "Toronto Maple Leafs"
  abbreviation: text("abbreviation").notNull(),
});

export const players = sqliteTable("players", {
  id: integer("id").primaryKey(), // NHL player ID
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  sweaterNumber: integer("sweater_number"),
  positionCode: text("position_code").notNull(),
  headshotUrl: text("headshot_url").notNull(),
});
