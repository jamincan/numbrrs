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
		primary: '#F47A38',
		secondary: '#B9975B',
		lightGradient: ['#F47A38', '#2a1206'],
		darkGradient: ['#42200c', '#0d0d0d']
	},
	BOS: {
		primary: '#FFB81C',
		secondary: '#000000',
		lightGradient: ['#FFB81C', '#241800'],
		darkGradient: ['#3d2c00', '#0d0d0d']
	},
	BUF: {
		primary: '#4283E0',
		secondary: '#FCB514',
		lightGradient: ['#1C5CC9', '#001233'],
		darkGradient: ['#122b5c', '#060c1a']
	},
	CAR: {
		primary: '#CC0000',
		secondary: '#000000',
		lightGradient: ['#CC0000', '#1c0000'],
		darkGradient: ['#4d0000', '#0d0d0d']
	},
	CBJ: {
		primary: '#5C88D6',
		secondary: '#CE1126',
		lightGradient: ['#2C5AA6', '#001030'],
		darkGradient: ['#0e2247', '#070b14']
	},
	CGY: {
		primary: '#D2001C',
		secondary: '#FAAF19',
		lightGradient: ['#D2001C', '#2b0005'],
		darkGradient: ['#480810', '#0d0d0d']
	},
	CHI: {
		primary: '#CF0A2C',
		secondary: '#000000',
		lightGradient: ['#CF0A2C', '#26030a'],
		darkGradient: ['#460612', '#0d0d0d']
	},
	COL: {
		primary: '#A34A66',
		secondary: '#236192',
		lightGradient: ['#7E2D48', '#140409'],
		darkGradient: ['#3a121f', '#0d0d0d']
	},
	DAL: {
		primary: '#009E60',
		secondary: '#8F8F8C',
		lightGradient: ['#007A4C', '#00170e'],
		darkGradient: ['#003523', '#0a0f0c']
	},
	DET: {
		primary: '#CE1126',
		secondary: '#FFFFFF',
		lightGradient: ['#CE1126', '#20050a'],
		darkGradient: ['#4a0810', '#0d0d0d']
	},
	EDM: {
		primary: '#FF4C00',
		secondary: '#041E42',
		lightGradient: ['#FF4C00', '#041E42'],
		darkGradient: ['#122b4e', '#070b14']
	},
	FLA: {
		primary: '#C8102E',
		secondary: '#B9975B',
		lightGradient: ['#C8102E', '#041E42'],
		darkGradient: ['#122444', '#070b14']
	},
	LAK: {
		primary: '#A2AAAD',
		secondary: '#000000',
		lightGradient: ['#5E6A70', '#0e1112'],
		darkGradient: ['#22282b', '#0c0d0e']
	},
	MIN: {
		primary: '#2FA377',
		secondary: '#A6192E',
		lightGradient: ['#166B4C', '#04130d'],
		darkGradient: ['#0f3d2b', '#0a0f0c']
	},
	MTL: {
		primary: '#C8313E',
		secondary: '#192168',
		lightGradient: ['#AF1E2D', '#10143f'],
		darkGradient: ['#151b52', '#080a1c']
	},
	NJD: {
		primary: '#CE1126',
		secondary: '#000000',
		lightGradient: ['#CE1126', '#1a0308'],
		darkGradient: ['#420810', '#0d0d0d']
	},
	NSH: {
		primary: '#FFB81C',
		secondary: '#041E42',
		lightGradient: ['#FFB81C', '#041E42'],
		darkGradient: ['#122b4e', '#070b14']
	},
	NYI: {
		primary: '#1E7FD2',
		secondary: '#F47D30',
		lightGradient: ['#0060B6', '#001633'],
		darkGradient: ['#0e2f52', '#070d16']
	},
	NYR: {
		primary: '#3A6BD9',
		secondary: '#CE1126',
		lightGradient: ['#1E4FC2', '#050e33'],
		darkGradient: ['#12245c', '#080a18']
	},
	OTT: {
		primary: '#C52032',
		secondary: '#B79257',
		lightGradient: ['#C52032', '#1d0306'],
		darkGradient: ['#440a12', '#0d0d0d']
	},
	PHI: {
		primary: '#F74902',
		secondary: '#000000',
		lightGradient: ['#F74902', '#200a00'],
		darkGradient: ['#4b1800', '#0d0d0d']
	},
	PIT: {
		primary: '#FCB514',
		secondary: '#000000',
		lightGradient: ['#FCB514', '#231700'],
		darkGradient: ['#3a2a00', '#0d0d0d']
	},
	SJS: {
		primary: '#00A4B0',
		secondary: '#EA7200',
		lightGradient: ['#007D87', '#001416'],
		darkGradient: ['#00343a', '#0a0e0f']
	},
	SEA: {
		primary: '#99D9D9',
		secondary: '#001628',
		lightGradient: ['#2C6E86', '#00121f'],
		darkGradient: ['#0d2836', '#060d12']
	},
	STL: {
		primary: '#2F6BDB',
		secondary: '#FCB514',
		lightGradient: ['#1A55C0', '#001233'],
		darkGradient: ['#0f2557', '#070b16']
	},
	TBL: {
		primary: '#4C82E0',
		secondary: '#FFFFFF',
		lightGradient: ['#1C4FB8', '#021033'],
		darkGradient: ['#0e2050', '#080a14']
	},
	TOR: {
		primary: '#4E7FDB',
		secondary: '#FFFFFF',
		lightGradient: ['#164AAE', '#001033'],
		darkGradient: ['#0d1e47', '#090b12']
	},
	UTA: {
		primary: '#69B3E7',
		secondary: '#000000',
		lightGradient: ['#3E8FD0', '#05101c'],
		darkGradient: ['#12283c', '#0a0e12']
	},
	VAN: {
		primary: '#00A15A',
		secondary: '#00205B',
		lightGradient: ['#008148', '#001233'],
		darkGradient: ['#10263e', '#0a120e']
	},
	VGK: {
		primary: '#B4975A',
		secondary: '#333F42',
		lightGradient: ['#B4975A', '#23282a'],
		darkGradient: ['#2e2510', '#0d0f10']
	},
	WPG: {
		primary: '#2E7CD6',
		secondary: '#AC162C',
		lightGradient: ['#0057AE', '#020d1f'],
		darkGradient: ['#0d2544', '#080c12']
	},
	WSH: {
		primary: '#C8102E',
		secondary: '#041E42',
		lightGradient: ['#C8102E', '#0a1633'],
		darkGradient: ['#360a14', '#0a0e14']
	}
};

const PWHL_TEAM_COLORS: Record<string, TeamColors> = {
	BOS: {
		// Boston Fleet — fleet green & black
		primary: '#00B388',
		secondary: '#000000',
		lightGradient: ['#00B388', '#00251c'],
		darkGradient: ['#003d2e', '#0d0d0d']
	},
	MIN: {
		// Minnesota Frost — frost purple & ice blue
		primary: '#8C6BC8',
		secondary: '#A4DBE8',
		lightGradient: ['#582C83', '#1a0f2e'],
		darkGradient: ['#2c1650', '#120a1f']
	},
	MTL: {
		// Montréal Victoire — burgundy
		primary: '#A6304C',
		secondary: '#000000',
		lightGradient: ['#862633', '#1f080c'],
		darkGradient: ['#4a1520', '#0d0d0d']
	},
	NY: {
		// New York Sirens — siren teal & navy
		primary: '#00B2A9',
		secondary: '#041E42',
		lightGradient: ['#00B2A9', '#041E42'],
		darkGradient: ['#00332f', '#00071a']
	},
	OTT: {
		// Ottawa Charge — charge red & black
		primary: '#D50032',
		secondary: '#000000',
		lightGradient: ['#D50032', '#1a0008'],
		darkGradient: ['#5c0016', '#0d0d0d']
	},
	SEA: {
		// Seattle Torrent — torrent blue & deep navy
		primary: '#3BA8C4',
		secondary: '#001628',
		lightGradient: ['#3BA8C4', '#001628'],
		darkGradient: ['#0e3947', '#000d1a']
	},
	TOR: {
		// Toronto Sceptres — royal blue & gold
		primary: '#307FE2',
		secondary: '#FFB81C',
		lightGradient: ['#307FE2', '#001233'],
		darkGradient: ['#122e5c', '#000d1f']
	},
	VAN: {
		// Vancouver Goldeneyes — gold & deep blue
		primary: '#C9A227',
		secondary: '#1B3F6E',
		lightGradient: ['#C9A227', '#12233d'],
		darkGradient: ['#2b220a', '#0a0e16']
	}
};

// The three CHL leagues have 61 teams between them, so instead of hand-tuning
// four values each, their palettes are derived from official brand colors
// (source: trucolor.net) by the same rules the NHL/PWHL maps follow by hand.

type Hsl = { h: number; s: number; l: number };

/** Near-black the cards and page sit on; every palette is built to read on it. */
const CARD_BLACK = '#0d0d0d';

// Loosest contrast the hand-tuned palettes sit at (Carolina's red is ~3.3), so
// deriving to this keeps the CHL tiles consistent with the NHL/PWHL ones.
const MIN_CONTRAST = 3.5;

function hexToHsl(hex: string): Hsl {
	const n = parseInt(hex.slice(1), 16);
	const r = ((n >> 16) & 255) / 255;
	const g = ((n >> 8) & 255) / 255;
	const b = (n & 255) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	if (d === 0) return { h: 0, s: 0, l };
	let h: number;
	if (max === r) h = (g - b) / d;
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	h *= 60;
	if (h < 0) h += 360;
	return { h, s: d / (1 - Math.abs(2 * l - 1)), l };
}

function hslToHex({ h, s, l }: Hsl): string {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hp = (((h % 360) + 360) % 360) / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	const rgb =
		hp < 1
			? [c, x, 0]
			: hp < 2
				? [x, c, 0]
				: hp < 3
					? [0, c, x]
					: hp < 4
						? [0, x, c]
						: hp < 5
							? [x, 0, c]
							: [c, 0, x];
	const m = l - c / 2;
	return (
		'#' +
		rgb
			.map((v) =>
				Math.round(Math.min(1, Math.max(0, v + m)) * 255)
					.toString(16)
					.padStart(2, '0')
			)
			.join('')
	);
}

function luminance(hex: string): number {
	const n = parseInt(hex.slice(1), 16);
	const channel = (v: number) => {
		const c = v / 255;
		return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	};
	return (
		0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
	);
}

function contrastOnBlack(hex: string): number {
	const a = luminance(hex);
	const b = luminance(CARD_BLACK);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Build a full palette from a team's official brand color. `brand` drives every
 * shade, so it has to be the team's chromatic color — for the many junior teams
 * whose official first color is black, pass their second color and keep the
 * black as `secondary`.
 */
function brandPalette(brand: string, secondary: string): TeamColors {
	const hsl = hexToHsl(brand);

	// primary is used as text, borders and glows on near-black, so lift its
	// lightness until it's legible there. Deep navies move a long way; reds and
	// golds are already clear and come through untouched. Saturation is capped
	// while brightening, because a fully saturated navy lifted to a legible
	// lightness turns electric — the hand-tuned equivalents sit around 0.72.
	let primary = brand;
	let l = hsl.l;
	while (contrastOnBlack(primary) < MIN_CONTRAST && l < 0.75) {
		l = Math.min(0.75, l + 0.02);
		primary = hslToHex({ ...hsl, s: Math.min(hsl.s, 0.72), l });
	}

	return {
		primary,
		secondary,
		// Card front, under the big white number: the brand color itself, lifted
		// only when it's so dark the number would sit on near-black anyway.
		lightGradient: [
			// Vivid brands are used exactly as published; only the dark ones get
			// lifted, and only those need the saturation cap.
			hsl.l < 0.38 ? hslToHex({ ...hsl, s: Math.min(hsl.s, 0.85), l: 0.38 }) : brand,
			hslToHex({ ...hsl, s: Math.min(hsl.s, 0.95), l: 0.07 })
		],
		// Card back and team tiles: a muted deep tint falling into the page.
		darkGradient: [hslToHex({ ...hsl, s: Math.min(hsl.s, 0.8), l: 0.16 }), CARD_BLACK]
	};
}

/** [brand, secondary] per team code, keyed the way the league's feed codes them. */
type BrandPair = [brand: string, secondary: string];

const WHL_BRANDS: Record<string, BrandPair> = {
	BDN: ['#D9C756', '#010101'], // Brandon Wheat Kings
	CGY: ['#C8102E', '#010101'], // Calgary Hitmen
	EDM: ['#A6192E', '#012169'], // Edmonton Oil Kings
	EVT: ['#154734', '#9E652E'], // Everett Silvertips
	KAM: ['#041E42', '#CF4520'], // Kamloops Blazers
	KEL: ['#006271', '#C8102E'], // Kelowna Rockets
	LET: ['#BA0C2F', '#041E42'], // Lethbridge Hurricanes
	MH: ['#FF6720', '#010101'], // Medicine Hat Tigers
	MJ: ['#C8102E', '#010101'], // Moose Jaw Warriors
	PEN: ['#0C2340', '#8BBEE8'], // Penticton Vees
	POR: ['#C8102E', '#010101'], // Portland Winterhawks
	PA: ['#007A33', '#C5B783'], // Prince Albert Raiders
	PG: ['#D22730', '#BF9474'], // Prince George Cougars
	RD: ['#862633', '#8D9093'], // Red Deer Rebels
	REG: ['#001489', '#EF3340'], // Regina Pats
	SAS: ['#012169', '#FFC72C'], // Saskatoon Blades
	SEA: ['#00205B', '#00843D'], // Seattle Thunderbirds
	SPO: ['#001E62', '#A6192E'], // Spokane Chiefs
	SC: ['#00205B', '#046A38'], // Swift Current Broncos
	TC: ['#A6192E', '#041E42'], // Tri-City Americans
	VAN: ['#A6192E', '#010101'], // Vancouver Giants
	VIC: ['#00205B', '#010101'], // Victoria Royals
	WEN: ['#003087', '#010101'] // Wenatchee Wild
};

const OHL_BRANDS: Record<string, BrandPair> = {
	BAR: ['#002F6C', '#EE2737'], // Barrie Colts
	BRAM: ['#00205B', '#A2AAAD'], // Brampton Steelheads
	BFD: ['#FFC72C', '#010101'], // Brantford Bulldogs
	ER: ['#041E42', '#AB2328'], // Erie Otters
	FLNT: ['#041E42', '#FF6720'], // Flint Firebirds
	GUE: ['#862633', '#010101'], // Guelph Storm
	KGN: ['#B9975B', '#010101'], // Kingston Frontenacs
	KIT: ['#0032A0', '#C8102E'], // Kitchener Rangers
	LDN: ['#046A38', '#FFC72C'], // London Knights
	NIAG: ['#C8102E', '#010101'], // Niagara IceDogs
	NB: ['#787121', '#FFC72C'], // North Bay Battalion
	OSH: ['#C8102E', '#041E42'], // Oshawa Generals
	OTT: ['#A6192E', '#010101'], // Ottawa 67's
	OS: ['#C8102E', '#010101'], // Owen Sound Attack
	PBO: ['#6F263D', '#FFFFFF'], // Peterborough Petes
	SAG: ['#0C2340', '#A6192E'], // Saginaw Spirit
	SAR: ['#C69214', '#010101'], // Sarnia Sting
	SOO: ['#C8102E', '#FFFFFF'], // Sault Ste. Marie Greyhounds
	SBY: ['#00205B', '#A2AAAD'], // Sudbury Wolves
	WSR: ['#091F2C', '#CB333B'] // Windsor Spitfires
};

const QMJHL_BRANDS: Record<string, BrandPair> = {
	BAC: ['#DA291C', '#F1C400'], // Baie-Comeau Drakkar
	// The Armada's official colors are only black and white; silver stands in so
	// the tile isn't indistinguishable from the page.
	BLB: ['#A2AAAD', '#010101'], // Blainville-Boisbriand Armada
	CAP: ['#FFB81C', '#25282A'], // Cape Breton Eagles
	CHA: ['#8C714C', '#010101'], // Charlottetown Islanders
	CHI: ['#0C2340', '#62B5E5'], // Chicoutimi Saguenéens
	DRU: ['#DA291C', '#010101'], // Drummondville Voltigeurs
	GAT: ['#888B8D', '#010101'], // Gatineau Olympiques
	HAL: ['#154734', '#C8102E'], // Halifax Mooseheads
	MON: ['#BA0C2F', '#003087'], // Moncton Wildcats
	NFL: ['#0C2340', '#862633'], // Newfoundland Regiment
	QUE: ['#C8102E', '#010101'], // Québec Remparts
	RIM: ['#221C35', '#98A4AE'], // Rimouski Océanic
	ROU: ['#DA291C', '#7C878E'], // Rouyn-Noranda Huskies
	SNB: ['#003087', '#010101'], // Saint John Sea Dogs
	SHA: ['#041E42', '#FFC72C'], // Shawinigan Cataractes
	SHE: ['#041E42', '#6CACE4'], // Sherbrooke Phœnix
	VDO: ['#046A38', '#8C714C'], // Val-d'Or Foreurs
	VIC: ['#FFC72C', '#010101'] // Victoriaville Tigres
};

function derivePalettes(brands: Record<string, BrandPair>): Record<string, TeamColors> {
	return Object.fromEntries(
		Object.entries(brands).map(([code, [brand, secondary]]) => [
			code,
			brandPalette(brand, secondary)
		])
	);
}

export const TEAM_COLORS: Record<string, Record<string, TeamColors>> = {
	nhl: NHL_TEAM_COLORS,
	pwhl: PWHL_TEAM_COLORS,
	whl: derivePalettes(WHL_BRANDS),
	ohl: derivePalettes(OHL_BRANDS),
	qmjhl: derivePalettes(QMJHL_BRANDS)
};

export function getTeamColors(league: string, abbreviation: string): TeamColors | undefined {
	return TEAM_COLORS[league]?.[abbreviation];
}
