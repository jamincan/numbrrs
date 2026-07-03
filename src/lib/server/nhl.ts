import { db } from "./db";
import { teams, players } from "./db/schema";
import { and, eq, notInArray } from "drizzle-orm";

const NHL_API_BASE = "https://api-web.nhle.com/v1";

export const ACTIVE_TEAMS = [
  "ANA",
  "BOS",
  "BUF",
  "CAR",
  "CBJ",
  "CGY",
  "CHI",
  "COL",
  "DAL",
  "DET",
  "EDM",
  "FLA",
  "LAK",
  "MIN",
  "MTL",
  "NJD",
  "NSH",
  "NYI",
  "NYR",
  "OTT",
  "PHI",
  "PIT",
  "SEA",
  "SJS",
  "STL",
  "TBL",
  "TOR",
  "UTA",
  "VAN",
  "VGK",
  "WPG",
  "WSH",
] as const;

export type TEAM_CODE = (typeof ACTIVE_TEAMS)[number];

const TEAM_NAMES: Record<TEAM_CODE, string> = {
  ANA: "Anaheim Ducks",
  BOS: "Boston Bruins",
  BUF: "Buffalo Sabres",
  CAR: "Carolina Hurricanes",
  CBJ: "Columbus Blue Jackets",
  CGY: "Calgary Flames",
  CHI: "Chicago Blackhawks",
  COL: "Colorado Avalanche",
  DAL: "Dallas Stars",
  DET: "Detroit Red Wings",
  EDM: "Edmonton Oilers",
  FLA: "Florida Panthers",
  LAK: "Los Angeles Kings",
  MIN: "Minnesota Wild",
  MTL: "Montréal Canadiens",
  NJD: "New Jersey Devils",
  NSH: "Nashville Predators",
  NYI: "New York Islanders",
  NYR: "New York Rangers",
  OTT: "Ottawa Senators",
  PHI: "Philadelphia Flyers",
  PIT: "Pittsburgh Penguins",
  SEA: "Seattle Kraken",
  SJS: "San Jose Sharks",
  STL: "St. Louis Blues",
  TBL: "Tampa Bay Lightning",
  TOR: "Toronto Maple Leafs",
  UTA: "Utah Mammoth",
  VAN: "Vancouver Canucks",
  VGK: "Vegas Golden Knights",
  WPG: "Winnipeg Jets",
  WSH: "Washington Capitals",
};

interface NHLPlayer {
  id: number;
  headshot: string;
  firstName: { default: string };
  lastName: { default: string };
  sweaterNumber?: number;
  positionCode: string;
}

interface NHLRosterResponse {
  forwards: NHLPlayer[];
  defensemen: NHLPlayer[];
  goalies: NHLPlayer[];
}

type FetchResult =
  | { ok: true; players: NHLPlayer[] }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false; retryAfter: number };

async function fetchTeamRoster(teamCode: TEAM_CODE): Promise<FetchResult> {
  const res = await fetch(`${NHL_API_BASE}/roster/${teamCode}/current`);
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") ?? "60", 10);
    console.warn(`429 for ${teamCode}, retry after ${retryAfter}s`);
    return { ok: false, notFound: false, retryAfter: retryAfter * 1000 };
  }
  if (!res.ok) {
    console.error(`Failed to fetch roster for ${teamCode}: ${res.status}`);
    return { ok: false, notFound: true };
  }
  const data: NHLRosterResponse = await res.json();
  return {
    ok: true,
    players: [...data.defensemen, ...data.forwards, ...data.goalies],
  };
}

let inFlight: Promise<void> | null = null;

/**
 * Run a roster sync, coalescing concurrent callers onto a single run so a
 * manual trigger can't overlap the automatic hourly sync. Returns whether this
 * call started a new sync or joined one already in progress.
 */
export function syncRostersOnce(): { started: boolean; done: Promise<void> } {
  if (inFlight) return { started: false, done: inFlight };
  inFlight = syncRosters().finally(() => {
    inFlight = null;
  });
  return { started: true, done: inFlight };
}

export async function syncRosters(): Promise<void> {
  console.log("Syncing NHL rosters...");

  const queue: TEAM_CODE[] = [...ACTIVE_TEAMS];
  let i = 0;

  while (queue.length > 0) {
    if (i > 0) await new Promise((r) => setTimeout(r, 400));
    i++;

    const teamCode = queue.shift()!;
    const result = await fetchTeamRoster(teamCode);

    if (!result.ok) {
      if (!result.notFound) {
        // 429 — requeue after the retry delay
        await new Promise((r) => setTimeout(r, result.retryAfter));
        queue.push(teamCode);
        continue;
      } else {
        // Non-429 failure — team not found, remove from DB
        db.delete(teams).where(eq(teams.id, teamCode)).run();
        continue;
      }
    }

    const rosterPlayers = result.players;
    const rosterIds = rosterPlayers.map((p) => p.id);

    db.transaction((tx) => {
      tx.insert(teams)
        .values({
          id: teamCode,
          name: TEAM_NAMES[teamCode] || teamCode,
          abbreviation: teamCode,
        })
        .onConflictDoUpdate({
          target: teams.id,
          set: {
            name: TEAM_NAMES[teamCode] || teamCode,
          },
        })
        .run();

      for (const p of rosterPlayers) {
        // Players without a sweater number are still stored (with a null
        // number); the game treats them as already-identified.
        const sweaterNumber = p.sweaterNumber ?? null;
        tx.insert(players)
          .values({
            id: p.id,
            teamId: teamCode,
            firstName: p.firstName.default,
            lastName: p.lastName.default ?? p.lastName,
            sweaterNumber,
            positionCode: p.positionCode,
            headshotUrl: p.headshot,
          })
          .onConflictDoUpdate({
            target: players.id,
            set: {
              teamId: teamCode,
              firstName: p.firstName.default,
              lastName: p.lastName.default ?? p.lastName,
              sweaterNumber,
              positionCode: p.positionCode,
              headshotUrl: p.headshot,
            },
          })
          .run();
      }

      // Remove players who are no longer on this team's roster (trades,
      // waivers, call-ups/downs). Scoped to teamId so a player who moved to
      // another team isn't deleted here — their new team's sync owns them.
      tx.delete(players)
        .where(
          rosterIds.length > 0
            ? and(eq(players.teamId, teamCode), notInArray(players.id, rosterIds))
            : eq(players.teamId, teamCode),
        )
        .run();
    });
  }

  console.log("Roster sync complete");
}
