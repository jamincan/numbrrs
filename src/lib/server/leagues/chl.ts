import { createHockeyTechAdapter, type HockeyTechTeam } from './hockeytech';

// The three CHL member leagues share one HockeyTech key, published by the
// leagues' own sites. Note the QMJHL's client code is its French acronym.
const CHL_API_KEY = 'f1aa699db3d81487';

const chlDefaults = {
	apiKey: CHL_API_KEY,
	// The QMJHL feed formats `name` as "Baie-Comeau, Drakkar"; city and nickname
	// rebuild it without the comma, and are identical to `name` for the WHL and
	// OHL (bar spelling out "Sault Ste. Marie" for the Soo Greyhounds).
	teamName: (t: HockeyTechTeam) => `${t.city} ${t.nickname}`.trim(),
	// The QMJHL feed mixes case in its codes ("BaC", "VdO"); uppercase them so
	// URLs and DB IDs look the same in every league.
	teamCode: (t: HockeyTechTeam) => t.code.toUpperCase()
};

export const whlAdapter = createHockeyTechAdapter({
	id: 'whl',
	clientCode: 'whl',
	...chlDefaults
});

export const ohlAdapter = createHockeyTechAdapter({
	id: 'ohl',
	clientCode: 'ohl',
	...chlDefaults
});

export const qmjhlAdapter = createHockeyTechAdapter({
	id: 'qmjhl',
	clientCode: 'lhjmq',
	...chlDefaults
});
