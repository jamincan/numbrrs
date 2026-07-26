export type TeamColors = {
  primary: string;
  secondary: string;
  lightGradient: [string, string];
  darkGradient: [string, string];
};

// Color system (see PWHL palette below for the reference look):
// - primary: brightened brand hue — used as text on near-black (header,
//   card-back number), borders, and glows, so it must stay legible on dark.
// - lightGradient: card FRONT background — vibrant brand color into a deep
//   shade, with the big white number on top.
// - darkGradient: card BACK + team tile backgrounds — muted deep brand tint
//   into near-black.
// - secondary: true brand secondary; currently unused by the UI.
const NHL_TEAM_COLORS: Record<string, TeamColors> = {
  ANA: {
    primary: "#F47A38",
    secondary: "#B9975B",
    lightGradient: ["#F47A38", "#2a1206"],
    darkGradient: ["#42200c", "#0d0d0d"],
  },
  BOS: {
    primary: "#FFB81C",
    secondary: "#000000",
    lightGradient: ["#FFB81C", "#241800"],
    darkGradient: ["#3d2c00", "#0d0d0d"],
  },
  BUF: {
    primary: "#4283E0",
    secondary: "#FCB514",
    lightGradient: ["#1C5CC9", "#001233"],
    darkGradient: ["#122b5c", "#060c1a"],
  },
  CAR: {
    primary: "#CC0000",
    secondary: "#000000",
    lightGradient: ["#CC0000", "#1c0000"],
    darkGradient: ["#4d0000", "#0d0d0d"],
  },
  CBJ: {
    primary: "#5C88D6",
    secondary: "#CE1126",
    lightGradient: ["#2C5AA6", "#001030"],
    darkGradient: ["#0e2247", "#070b14"],
  },
  CGY: {
    primary: "#D2001C",
    secondary: "#FAAF19",
    lightGradient: ["#D2001C", "#2b0005"],
    darkGradient: ["#480810", "#0d0d0d"],
  },
  CHI: {
    primary: "#CF0A2C",
    secondary: "#000000",
    lightGradient: ["#CF0A2C", "#26030a"],
    darkGradient: ["#460612", "#0d0d0d"],
  },
  COL: {
    primary: "#A34A66",
    secondary: "#236192",
    lightGradient: ["#7E2D48", "#140409"],
    darkGradient: ["#3a121f", "#0d0d0d"],
  },
  DAL: {
    primary: "#009E60",
    secondary: "#8F8F8C",
    lightGradient: ["#007A4C", "#00170e"],
    darkGradient: ["#003523", "#0a0f0c"],
  },
  DET: {
    primary: "#CE1126",
    secondary: "#FFFFFF",
    lightGradient: ["#CE1126", "#20050a"],
    darkGradient: ["#4a0810", "#0d0d0d"],
  },
  EDM: {
    primary: "#FF4C00",
    secondary: "#041E42",
    lightGradient: ["#FF4C00", "#041E42"],
    darkGradient: ["#122b4e", "#070b14"],
  },
  FLA: {
    primary: "#C8102E",
    secondary: "#B9975B",
    lightGradient: ["#C8102E", "#041E42"],
    darkGradient: ["#122444", "#070b14"],
  },
  LAK: {
    primary: "#A2AAAD",
    secondary: "#000000",
    lightGradient: ["#5E6A70", "#0e1112"],
    darkGradient: ["#22282b", "#0c0d0e"],
  },
  MIN: {
    primary: "#2FA377",
    secondary: "#A6192E",
    lightGradient: ["#166B4C", "#04130d"],
    darkGradient: ["#0f3d2b", "#0a0f0c"],
  },
  MTL: {
    primary: "#C8313E",
    secondary: "#192168",
    lightGradient: ["#AF1E2D", "#10143f"],
    darkGradient: ["#151b52", "#080a1c"],
  },
  NJD: {
    primary: "#CE1126",
    secondary: "#000000",
    lightGradient: ["#CE1126", "#1a0308"],
    darkGradient: ["#420810", "#0d0d0d"],
  },
  NSH: {
    primary: "#FFB81C",
    secondary: "#041E42",
    lightGradient: ["#FFB81C", "#041E42"],
    darkGradient: ["#122b4e", "#070b14"],
  },
  NYI: {
    primary: "#1E7FD2",
    secondary: "#F47D30",
    lightGradient: ["#0060B6", "#001633"],
    darkGradient: ["#0e2f52", "#070d16"],
  },
  NYR: {
    primary: "#3A6BD9",
    secondary: "#CE1126",
    lightGradient: ["#1E4FC2", "#050e33"],
    darkGradient: ["#12245c", "#080a18"],
  },
  OTT: {
    primary: "#C52032",
    secondary: "#B79257",
    lightGradient: ["#C52032", "#1d0306"],
    darkGradient: ["#440a12", "#0d0d0d"],
  },
  PHI: {
    primary: "#F74902",
    secondary: "#000000",
    lightGradient: ["#F74902", "#200a00"],
    darkGradient: ["#4b1800", "#0d0d0d"],
  },
  PIT: {
    primary: "#FCB514",
    secondary: "#000000",
    lightGradient: ["#FCB514", "#231700"],
    darkGradient: ["#3a2a00", "#0d0d0d"],
  },
  SJS: {
    primary: "#00A4B0",
    secondary: "#EA7200",
    lightGradient: ["#007D87", "#001416"],
    darkGradient: ["#00343a", "#0a0e0f"],
  },
  SEA: {
    primary: "#99D9D9",
    secondary: "#001628",
    lightGradient: ["#2C6E86", "#00121f"],
    darkGradient: ["#0d2836", "#060d12"],
  },
  STL: {
    primary: "#2F6BDB",
    secondary: "#FCB514",
    lightGradient: ["#1A55C0", "#001233"],
    darkGradient: ["#0f2557", "#070b16"],
  },
  TBL: {
    primary: "#4C82E0",
    secondary: "#FFFFFF",
    lightGradient: ["#1C4FB8", "#021033"],
    darkGradient: ["#0e2050", "#080a14"],
  },
  TOR: {
    primary: "#4E7FDB",
    secondary: "#FFFFFF",
    lightGradient: ["#164AAE", "#001033"],
    darkGradient: ["#0d1e47", "#090b12"],
  },
  UTA: {
    primary: "#69B3E7",
    secondary: "#000000",
    lightGradient: ["#3E8FD0", "#05101c"],
    darkGradient: ["#12283c", "#0a0e12"],
  },
  VAN: {
    primary: "#00A15A",
    secondary: "#00205B",
    lightGradient: ["#008148", "#001233"],
    darkGradient: ["#10263e", "#0a120e"],
  },
  VGK: {
    primary: "#B4975A",
    secondary: "#333F42",
    lightGradient: ["#B4975A", "#23282a"],
    darkGradient: ["#2e2510", "#0d0f10"],
  },
  WPG: {
    primary: "#2E7CD6",
    secondary: "#AC162C",
    lightGradient: ["#0057AE", "#020d1f"],
    darkGradient: ["#0d2544", "#080c12"],
  },
  WSH: {
    primary: "#C8102E",
    secondary: "#041E42",
    lightGradient: ["#C8102E", "#0a1633"],
    darkGradient: ["#360a14", "#0a0e14"],
  },
};

const PWHL_TEAM_COLORS: Record<string, TeamColors> = {
  BOS: {
    // Boston Fleet — fleet green & black
    primary: "#00B388",
    secondary: "#000000",
    lightGradient: ["#00B388", "#00251c"],
    darkGradient: ["#003d2e", "#0d0d0d"],
  },
  MIN: {
    // Minnesota Frost — frost purple & ice blue
    primary: "#8C6BC8",
    secondary: "#A4DBE8",
    lightGradient: ["#582C83", "#1a0f2e"],
    darkGradient: ["#2c1650", "#120a1f"],
  },
  MTL: {
    // Montréal Victoire — burgundy
    primary: "#A6304C",
    secondary: "#000000",
    lightGradient: ["#862633", "#1f080c"],
    darkGradient: ["#4a1520", "#0d0d0d"],
  },
  NY: {
    // New York Sirens — siren teal & navy
    primary: "#00B2A9",
    secondary: "#041E42",
    lightGradient: ["#00B2A9", "#041E42"],
    darkGradient: ["#00332f", "#00071a"],
  },
  OTT: {
    // Ottawa Charge — charge red & black
    primary: "#D50032",
    secondary: "#000000",
    lightGradient: ["#D50032", "#1a0008"],
    darkGradient: ["#5c0016", "#0d0d0d"],
  },
  SEA: {
    // Seattle Torrent — torrent blue & deep navy
    primary: "#3BA8C4",
    secondary: "#001628",
    lightGradient: ["#3BA8C4", "#001628"],
    darkGradient: ["#0e3947", "#000d1a"],
  },
  TOR: {
    // Toronto Sceptres — royal blue & gold
    primary: "#307FE2",
    secondary: "#FFB81C",
    lightGradient: ["#307FE2", "#001233"],
    darkGradient: ["#122e5c", "#000d1f"],
  },
  VAN: {
    // Vancouver Goldeneyes — gold & deep blue
    primary: "#C9A227",
    secondary: "#1B3F6E",
    lightGradient: ["#C9A227", "#12233d"],
    darkGradient: ["#2b220a", "#0a0e16"],
  },
};

export const TEAM_COLORS: Record<string, Record<string, TeamColors>> = {
  nhl: NHL_TEAM_COLORS,
  pwhl: PWHL_TEAM_COLORS,
};

export function getTeamColors(
  league: string,
  abbreviation: string,
): TeamColors | undefined {
  return TEAM_COLORS[league]?.[abbreviation];
}
