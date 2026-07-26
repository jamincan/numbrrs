import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(), // e.g. "nhl:TOR", "pwhl:TOR"
  league: text("league").notNull(), // e.g. "nhl", "pwhl"
  name: text("name").notNull(), // e.g. "Toronto Maple Leafs"
  abbreviation: text("abbreviation").notNull(), // e.g. "TOR"
  logoUrl: text("logo_url").notNull(),
});

export const players = sqliteTable(
  "players",
  {
    // Player IDs are only unique within a league (PWHL IDs are small
    // integers), so the primary key is (league, id).
    league: text("league").notNull(),
    id: integer("id").notNull(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    sweaterNumber: integer("sweater_number"),
    positionCode: text("position_code").notNull(),
    headshotUrl: text("headshot_url").notNull(),
  },
  (table) => [primaryKey({ columns: [table.league, table.id] })],
);
