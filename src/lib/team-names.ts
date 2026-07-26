import type { Locale } from '$lib/i18n';

/**
 * French team names, keyed `<league>:<CODE>` the same way as team colours and
 * logos — static per-team metadata that overrides what the feed reports.
 *
 * Only French lives here: English is whatever the league feed already gave us,
 * so a team we haven't translated simply keeps its English name rather than
 * disappearing. That also makes this safe to fill in league by league.
 *
 * Sources:
 * - NHL: the API's own `teamName.fr` (`/v1/standings/now`), which is where the
 *   article agreement comes from — "d'Ottawa", "du Minnesota", "de la Caroline".
 * - PWHL: the LPHF's French site.
 * - QMJHL: the LHJMQ's French site. These are the teams' real names; the
 *   HockeyTech feed reports an anglicized word order ("Baie-Comeau, Drakkar").
 * - WHL and OHL: fr.wikipedia.org, which is the only consistent published
 *   source — neither league publishes French names itself. Note this is only
 *   about the team names; both leagues keep their English acronyms, since
 *   neither uses a French one.
 */
const FRENCH_NAMES: Record<string, string> = {
	'nhl:ANA': "Ducks d'Anaheim",
	'nhl:BOS': 'Bruins de Boston',
	'nhl:BUF': 'Sabres de Buffalo',
	'nhl:CAR': 'Hurricanes de la Caroline',
	'nhl:CBJ': 'Blue Jackets de Columbus',
	'nhl:CGY': 'Flames de Calgary',
	'nhl:CHI': 'Blackhawks de Chicago',
	'nhl:COL': 'Avalanche du Colorado',
	'nhl:DAL': 'Stars de Dallas',
	'nhl:DET': 'Red Wings de Detroit',
	'nhl:EDM': "Oilers d'Edmonton",
	'nhl:FLA': 'Panthers de la Floride',
	'nhl:LAK': 'Kings de Los Angeles',
	'nhl:MIN': 'Wild du Minnesota',
	'nhl:MTL': 'Canadiens de Montréal',
	'nhl:NJD': 'Devils du New Jersey',
	'nhl:NSH': 'Predators de Nashville',
	'nhl:NYI': 'Islanders de New York',
	'nhl:NYR': 'Rangers de New York',
	'nhl:OTT': "Sénateurs d'Ottawa",
	'nhl:PHI': 'Flyers de Philadelphie',
	'nhl:PIT': 'Penguins de Pittsburgh',
	'nhl:SEA': 'Kraken de Seattle',
	'nhl:SJS': 'Sharks de San Jose',
	'nhl:STL': 'Blues de St. Louis',
	'nhl:TBL': 'Lightning de Tampa Bay',
	'nhl:TOR': 'Maple Leafs de Toronto',
	'nhl:UTA': "Mammoth de l'Utah",
	'nhl:VAN': 'Canucks de Vancouver',
	'nhl:VGK': 'Golden Knights de Vegas',
	'nhl:WPG': 'Jets de Winnipeg',
	'nhl:WSH': 'Capitals de Washington',

	'pwhl:BOS': 'Fleet de Boston',
	'pwhl:MIN': 'Frost du Minnesota',
	'pwhl:MTL': 'Victoire de Montréal',
	'pwhl:NY': 'Sirens de New York',
	'pwhl:OTT': "Charge d'Ottawa",
	'pwhl:SEA': 'Torrent de Seattle',
	'pwhl:TOR': 'Sceptres de Toronto',
	'pwhl:VAN': 'Goldeneyes de Vancouver',

	'whl:BDN': 'Wheat Kings de Brandon',
	'whl:CGY': 'Hitmen de Calgary',
	'whl:EDM': "Oil Kings d'Edmonton",
	'whl:EVT': "Silvertips d'Everett",
	'whl:KAM': 'Blazers de Kamloops',
	'whl:KEL': 'Rockets de Kelowna',
	'whl:LET': 'Hurricanes de Lethbridge',
	'whl:MH': 'Tigers de Medicine Hat',
	'whl:MJ': 'Warriors de Moose Jaw',
	'whl:PA': 'Raiders de Prince Albert',
	'whl:PEN': 'Vees de Penticton',
	'whl:PG': 'Cougars de Prince George',
	'whl:POR': 'Winterhawks de Portland',
	'whl:RD': 'Rebels de Red Deer',
	'whl:REG': 'Pats de Regina',
	'whl:SAS': 'Blades de Saskatoon',
	'whl:SC': 'Broncos de Swift Current',
	'whl:SEA': 'Thunderbirds de Seattle',
	'whl:SPO': 'Chiefs de Spokane',
	'whl:TC': 'Americans de Tri-City',
	'whl:VAN': 'Giants de Vancouver',
	'whl:VIC': 'Royals de Victoria',
	'whl:WEN': 'Wild de Wenatchee',

	'ohl:BAR': 'Colts de Barrie',
	'ohl:BFD': 'Bulldogs de Brantford',
	'ohl:BRAM': 'Steelheads de Brampton',
	'ohl:ER': "Otters d'Érié",
	'ohl:FLNT': 'Firebirds de Flint',
	'ohl:GUE': 'Storm de Guelph',
	'ohl:KGN': 'Frontenacs de Kingston',
	'ohl:KIT': 'Rangers de Kitchener',
	'ohl:LDN': 'Knights de London',
	'ohl:NB': 'Battalion de North Bay',
	'ohl:NIAG': 'IceDogs de Niagara',
	'ohl:OS': "Attack d'Owen Sound",
	'ohl:OSH': "Generals d'Oshawa",
	'ohl:OTT': "67 d'Ottawa",
	'ohl:PBO': 'Petes de Peterborough',
	'ohl:SAG': 'Spirit de Saginaw',
	'ohl:SAR': 'Sting de Sarnia',
	'ohl:SBY': 'Wolves de Sudbury',
	'ohl:SOO': 'Greyhounds de Sault-Sainte-Marie',
	'ohl:WSR': 'Spitfires de Windsor',

	'qmjhl:BAC': 'Drakkar de Baie-Comeau',
	'qmjhl:BLB': 'Armada de Blainville-Boisbriand',
	'qmjhl:CAP': 'Eagles du Cap-Breton',
	'qmjhl:CHA': 'Islanders de Charlottetown',
	'qmjhl:CHI': 'Saguenéens de Chicoutimi',
	'qmjhl:DRU': 'Voltigeurs de Drummondville',
	'qmjhl:GAT': 'Olympiques de Gatineau',
	'qmjhl:HAL': 'Mooseheads de Halifax',
	'qmjhl:MON': 'Wildcats de Moncton',
	'qmjhl:NFL': 'Régiment de Terre-Neuve',
	'qmjhl:QUE': 'Remparts de Québec',
	'qmjhl:RIM': 'Océanic de Rimouski',
	'qmjhl:ROU': 'Huskies de Rouyn-Noranda',
	'qmjhl:SHA': 'Cataractes de Shawinigan',
	'qmjhl:SHE': 'Phœnix de Sherbrooke',
	'qmjhl:SNB': 'Sea Dogs de Saint John',
	'qmjhl:VDO': "Foreurs de Val-d'Or",
	'qmjhl:VIC': 'Tigres de Victoriaville'
};

/** A team's name in the active locale, falling back to the feed's own name. */
export function teamName(
	locale: Locale,
	league: string,
	abbreviation: string,
	fallback: string
): string {
	if (locale === 'en') return fallback;
	return FRENCH_NAMES[`${league.toLowerCase()}:${abbreviation.toUpperCase()}`] ?? fallback;
}
