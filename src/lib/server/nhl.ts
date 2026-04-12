import { db } from "./db";
import { teams, players } from "./db/schema";
import { eq } from "drizzle-orm";

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
  sweaterNumber: number;
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

    db.insert(teams)
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
      if (!p.sweaterNumber) continue;
      db.insert(players)
        .values({
          id: p.id,
          teamId: teamCode,
          firstName: p.firstName.default,
          lastName: p.lastName.default ?? p.lastName,
          sweaterNumber: p.sweaterNumber,
          positionCode: p.positionCode,
          headshotUrl: p.headshot,
        })
        .onConflictDoUpdate({
          target: players.id,
          set: {
            teamId: teamCode,
            firstName: p.firstName.default,
            lastName: p.lastName.default ?? p.lastName,
            sweaterNumber: p.sweaterNumber,
            positionCode: p.positionCode,
            headshotUrl: p.headshot,
          },
        })
        .run();
    }
  }

  console.log("Roster sync complete");
}
