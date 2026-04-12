export type TeamColors = {
  primary: string;
  secondary: string;
  lightGradient: [string, string];
  darkGradient: [string, string];
};

export const TEAM_COLORS: Record<string, TeamColors> = {
  ANA: {
    primary: "#F47A38",
    secondary: "#B9975B",
    lightGradient: ["#F47A38", "#2a1a0a"],
    darkGradient: ["#3D2113", "#2a1a0a"],
  },
  BOS: {
    primary: "#FFB81C",
    secondary: "#000000",
    lightGradient: ["#FFB81C", "#000000"],
    darkGradient: ["#1a1200", "#0d0d0d"],
  },
  BUF: {
    primary: "#004599",
    secondary: "#FCB514",
    lightGradient: ["#FCB514", "#004599"],
    darkGradient: ["#FCB514", "#1a1000"],
  },
  CAR: {
    primary: "#CC0000",
    secondary: "#000000",
    lightGradient: ["#CC0000", "#0d0d0d"],
    darkGradient: ["#770000", "#0d0d0d"],
  },
  CBJ: {
    primary: "#ccc",
    secondary: "#CE1126",
    lightGradient: ["#002654", "#CE1126"],
    darkGradient: ["#CE1126", "#000d1f"],
  },
  CGY: {
    primary: "#D2001C",
    secondary: "#FAAF19",
    lightGradient: ["#D2001C", "#FAAF19"],
    darkGradient: ["#1a0000", "#3f3521"],
  },
  CHI: {
    primary: "#CF0A2C",
    secondary: "#000000",
    lightGradient: ["#CF0A2C", "#111111"],
    darkGradient: ["#1a0008", "#0d0d0d"],
  },
  COL: {
    primary: "#6F263D",
    secondary: "#236192",
    lightGradient: ["#6F263D", "#236192"],
    darkGradient: ["#1a0810", "#071525"],
  },
  DAL: {
    primary: "#006847",
    secondary: "#8F8F8C",
    lightGradient: ["#006847", "#8F8F8C"],
    darkGradient: ["#001a12", "#1a1a1a"],
  },
  DET: {
    primary: "#CE1126",
    secondary: "#FFFFFF",
    lightGradient: ["#CE1126", "#aa3344"],
    darkGradient: ["#1a0008", "#2a1018"],
  },
  EDM: {
    primary: "#FF4C00",
    secondary: "#041E42",
    lightGradient: ["#FF4C00", "#003c90"],
    darkGradient: ["#1a0800", "#003c90"],
  },
  FLA: {
    primary: "#a0800c",
    secondary: "#041E42",
    lightGradient: ["#C8102E", "#041E42"],
    darkGradient: ["#C8102E", "#00071a"],
  },
  LAK: {
    primary: "#A2AAAD",
    secondary: "#111111",
    lightGradient: ["#A2AAAD", "#111111"],
    darkGradient: ["#1a1a1a", "#0d0d0d"],
  },
  MIN: {
    primary: "#a0800c",
    secondary: "#A6192E",
    lightGradient: ["#154734", "#A6192E"],
    darkGradient: ["#154734", "#1a0008"],
  },
  MTL: {
    primary: "#AF1E2D",
    secondary: "#192168",
    lightGradient: ["#AF1E2D", "#192168"],
    darkGradient: ["#1a0008", "#192168"],
  },
  NJD: {
    primary: "#CE1126",
    secondary: "#000000",
    lightGradient: ["#CE1126", "#333333"],
    darkGradient: ["#1a0008", "#333333"],
  },
  NSH: {
    primary: "#FFB81C",
    secondary: "#041E42",
    lightGradient: ["#FFB81C", "#041E42"],
    darkGradient: ["#1a1200", "#041E42"],
  },
  NYI: {
    primary: "#00539B",
    secondary: "#F47D30",
    lightGradient: ["#00539B", "#F47D30"],
    darkGradient: ["#001a33", "#F47D30"],
  },
  NYR: {
    primary: "#0038A8",
    secondary: "#CE1126",
    lightGradient: ["#0038A8", "#CE1126"],
    darkGradient: ["#00111f", "#CE1126"],
  },
  OTT: {
    primary: "#a0800c",
    secondary: "#000000",
    lightGradient: ["#C52032", "#0d0d0d"],
    darkGradient: ["#C52032", "#0d0d0d"],
  },
  PHI: {
    primary: "#F74902",
    secondary: "#000000",
    lightGradient: ["#F74902", "#333333"],
    darkGradient: ["#1a0800", "#0d0d0d"],
  },
  PIT: {
    primary: "#FCB514",
    secondary: "#000000",
    lightGradient: ["#FCB514", "#000000"],
    darkGradient: ["#1a1200", "#0d0d0d"],
  },
  SJS: {
    primary: "#006D75",
    secondary: "#EA7200",
    lightGradient: ["#006D75", "#EA7200"],
    darkGradient: ["#00282b", "#1a1a1a"],
  },
  SEA: {
    primary: "#99D9D9",
    secondary: "#001628",
    lightGradient: ["#001628", "#99D9D9"],
    darkGradient: ["#000d1a", "#0a2020"],
  },
  STL: {
    primary: "#FCB514",
    secondary: "#002F87",
    lightGradient: ["#FCB514", "#002F87"],
    darkGradient: ["#00101f", "#002F87"],
  },
  TBL: {
    primary: "#FFFFFF",
    secondary: "#002868",
    lightGradient: ["#002868", "#1a4a99"],
    darkGradient: ["#000d1f", "#071533"],
  },
  TOR: {
    primary: "#FFFFFF",
    secondary: "#00205B",
    lightGradient: ["#00205B", "#1a4a8a"],
    darkGradient: ["#000d1f", "#071533"],
  },
  UTA: {
    primary: "#69B3E7",
    secondary: "#000000",
    lightGradient: ["#69B3E7", "#000000"],
    darkGradient: ["#071525", "#0d0d0d"],
  },
  VAN: {
    primary: "#00843D",
    secondary: "#00205B",
    lightGradient: ["#00205B", "#00843D"],
    darkGradient: ["#000d1f", "#00200f"],
  },
  VGK: {
    primary: "#B4975A",
    secondary: "#333F42",
    lightGradient: ["#B4975A", "#333F42"],
    darkGradient: ["#1a1208", "#0d1010"],
  },
  WPG: {
    primary: "#C8102E",
    secondary: "#004C97",
    lightGradient: ["#004C97", "#041E42"],
    darkGradient: ["#004C97", "#00071a"],
  },
  WSH: {
    primary: "#003784",
    secondary: "#C8102E",
    lightGradient: ["#C8102E", "#041E42"],
    darkGradient: ["#C8102E", "#00071a"],
  },
};
