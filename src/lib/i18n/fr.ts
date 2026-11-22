import type { Messages } from './messages';
import type { Gender } from './index';
import type { TrophyId } from '#lib/trophies.ts';

/**
 * French keeps ":" attached to the word before it with a non-breaking space.
 * Built from its code point rather than typed literally: a real U+00A0 in a string
 * is invisible in review, trips the no-irregular-whitespace lint, and gets
 * silently "corrected" to a normal space by editors.
 */
const NBSP = String.fromCharCode(0xa0);

/** "New", as an adjective standing for players new to a roster: it agrees with
 *  them in gender and number. */
function newcomers(count: number, gender: Gender): string {
	if (gender === 'f') return count === 1 ? 'nouvelle' : 'nouvelles';
	return count === 1 ? 'nouveau' : 'nouveaux';
}

const TROPHY_NAMES: Record<TrophyId, string> = {
	stanley: 'Coupe Stanley',
	walter: 'Coupe Walter',
	memorial: 'Coupe Memorial',
	chynoweth: 'Coupe Ed Chynoweth',
	robertson: 'Coupe J. Ross Robertson',
	courteau: 'Trophée Gilles-Courteau'
};

/** Whose teams each is won by beating, as it reads after « les équipes ». */
const TROPHY_LEAGUES: Record<TrophyId, string> = {
	stanley: 'de la LNH',
	walter: 'de la LPHF',
	memorial: 'de la WHL, de l’OHL et de la LHJMQ',
	chynoweth: 'de la WHL',
	robertson: 'de l’OHL',
	courteau: 'de la LHJMQ'
};

// Quebec French, since every league here is Canadian: "chandail" rather than
// "maillot", "alignement" for a roster, "attaquant" for a forward.
//
// Punctuation follows Quebec (OQLF) convention rather than French-from-France:
// no space before "?" and "!". The space before "%" comes from
// Intl.NumberFormat, not from these strings.
//
// Messages that name players take a gender, because French has no neutral
// form and the PWHL is a women's league — see `Gender` in ./index.
export const fr: Messages = {
	title: 'Numbrrs - Apprenez les numéros de chandail',
	description:
		'Un jeu de cartes pour apprendre les numéros de chandail au hockey. Choisissez une équipe de la LNH, de la LPHF, de la WHL, de l’OHL ou de la LHJMQ et devinez qui porte chaque numéro.',
	tagline: 'Apprenez les numéros de chandail, une carte à la fois',
	socialImageAlt: `Numbrrs${NBSP}: un jeu de cartes pour apprendre les numéros de chandail au hockey`,
	language: 'Langue',
	github: 'GitHub',
	skipToContent: 'Aller au contenu',
	nav: {
		main: 'Principale',
		footer: 'Pied de page'
	},

	home: {
		league: 'Ligue',
		chooseTeam: 'Choisissez une équipe',
		teamsSyncing: 'Les équipes se synchronisent avec la ligue. Actualisez dans un instant.',
		goldCount: (count, total) => `l’or pour ${count} équipes sur ${total}`,
		newPlayers: (count, gender) => `${count} ${newcomers(count, gender)}`
	},

	trophies: {
		title: 'Trophées',
		names: TROPHY_NAMES,
		tip: (trophy, season) =>
			`${TROPHY_NAMES[trophy]}${NBSP}: l’or pour toutes les équipes ${TROPHY_LEAGUES[trophy]}, saison ${season}-${season + 1}`
	},

	// The rules speak of names, cards and the roster rather than of players:
	// the page is the same for every league, so nothing in it can take the
	// players' gender.
	howTo: {
		title: 'Comment jouer',
		description: `Le fonctionnement de Numbrrs${NBSP}: les quatre niveaux, ce qui vaut une médaille et l’endroit où vos résultats sont gardés.`,
		intro:
			'Chaque carte montre une équipe et un numéro de chandail. Choisissez qui le porte, et continuez jusqu’à avoir trouvé tout l’alignement.',
		levelsTitle: 'Niveaux',
		levels: {
			learn: `Le point de départ pour une équipe que vous ne connaissez pas. Les nouvelles cartes sont distribuées face visible, cinq à la fois, et chacune vous est redemandée quelques cartes plus tard. L’alignement est un livre ouvert pendant l’apprentissage${NBSP}: chaque nom trouvé est marqué de son numéro. Un dernier tour repasse ensuite tout l’alignement, numéros cachés, et c’est ce tour qui donne votre résultat.`,
			easy: 'Cinq noms sur chaque carte.',
			medium: 'Dix noms sur chaque carte.',
			hard: 'Chaque carte propose tout l’alignement.'
		},
		quizBody:
			'Facile, Moyen et Difficile sont des quiz. L’alignement garde ses numéros pour lui, et chaque carte propose autant de noms, peu importe combien vous en avez déjà trouvé.',
		missesTitle: 'Erreurs',
		missesBody:
			'Une mauvaise réponse vous montre qui porte vraiment le numéro, ainsi que le numéro de la personne que vous aviez choisie. La carte revient quelques cartes plus tard, et la partie continue jusqu’à ce que tout l’alignement soit trouvé. Il arrive que deux noms partagent un numéro au cours d’une saison; les deux sont alors de bonnes réponses.',
		medalsTitle: 'Médailles',
		medalsBody: `Trouvez tout l’alignement à un niveau de quiz sans une seule erreur et vous gagnez sa médaille${NBSP}: le bronze pour Facile, l’argent pour Moyen, l’or pour Difficile. La médaille à côté du décompte, sous les cartes, indique si le sans-faute tient toujours. Après une erreur, vous pouvez recommencer, ou continuer et terminer l’alignement. Changer de niveau en cours de partie fait compter celle-ci au plus facile des niveaux utilisés, et passer au niveau Apprendre ou le quitter recommence la partie.`,
		medalsWhere:
			'Votre meilleure médaille pour une équipe figure sur sa tuile à la page d’accueil et à côté de son nom quand vous y jouez. L’onglet de chaque ligue compte les équipes pour lesquelles vous avez l’or.',
		newTitle: 'Changements à l’alignement',
		newBody:
			'Les alignements changent au fil de la saison. Quand une équipe que vous avez jouée jusqu’au bout ajoute quelqu’un ou change un numéro, sa tuile à la page d’accueil indique combien de cartes sont nouvelles pour vous, et la page de l’équipe propose une courte partie au niveau Apprendre pour celles-là seulement. Votre médaille n’est pas touchée.',
		seasonsTitle: 'Saisons',
		seasonsBody:
			'Les médailles et les meilleurs résultats valent pour la saison en cours, qui change le 1er septembre. Une médaille gagnée vous reste jusque-là, quoi qu’il arrive à l’alignement.',
		recordsTitle: 'Vos résultats',
		recordsBody: `Les médailles et les résultats sont gardés dans ce navigateur, et nulle part ailleurs. Ils ne sont jamais envoyés au serveur${NBSP}: ils ne vous suivent donc pas sur un autre appareil, et effacer les données de site de votre navigateur les supprime.`,
		recordsEmpty: 'Rien n’est encore enregistré.',
		reset: 'Effacer mes résultats',
		resetConfirm:
			'Effacer toutes les médailles et tous les résultats gardés dans ce navigateur? C’est irréversible.',
		resetYes: 'Effacer',
		resetCancel: 'Garder',
		resetDone: 'Vos résultats ont été effacés.'
	},

	card: {
		prompt: 'Qui porte ce numéro?',
		correct: 'Exact!',
		wrong: 'Raté'
	},

	game: {
		// The team name leads the sentence rather than sitting inside it, which
		// would need the team's grammatical gender for the article.
		description: (team) =>
			`${team} — devinez qui porte chaque numéro et complétez l’alignement, une carte à la fois.`,
		levelLabel: 'Niveau',
		levelCurrent: (level) => `Niveau${NBSP}: ${level}`,
		levelHint: 'Envie d’un défi? Changez de niveau ici.',
		levelHintDismiss: 'Fermer',
		levels: {
			learn: 'Apprendre',
			easy: 'Facile',
			medium: 'Moyen',
			hard: 'Difficile'
		},
		levelOption: (level, choices) => `${level}${NBSP}: ${choices}`,
		levelChoices: (count) => (count === null ? 'alignement complet' : `${count} choix`),
		medals: {
			bronze: 'médaille de bronze',
			silver: 'médaille d’argent',
			gold: 'médaille d’or'
		},
		congratulations: 'Félicitations!',
		allIdentified: (gender) =>
			gender === 'f'
				? 'Vous avez identifié toutes les joueuses de cette équipe!'
				: 'Vous avez identifié tous les joueurs de cette équipe!',
		// "À trouver" and "à revoir" rather than "restants" or "ratés": neither
		// takes the players' gender.
		remaining: (count) => `${count} à trouver`,
		progress: 'Progression',
		medalInReach: (medal) => `Sans faute jusqu’ici${NBSP}: ${medal} à portée`,
		medalLost: 'Pas de médaille cette fois-ci',
		medalTip: (medal, level, season) =>
			`${medal.charAt(0).toUpperCase()}${medal.slice(1)}${NBSP}: un sans-faute au niveau ${level}, saison ${season}-${season + 1}`,
		restart: 'Recommencer',
		wears: (name, sweaterNumber) => `${name} porte le numéro ${sweaterNumber}.`,
		firstTry: (found, total) => `Du premier coup${NBSP}: ${found} / ${total}`,
		medalEarned: (medal) => `Sans faute${NBSP}: ${medal}`,
		missedHeading: 'À revoir',
		best: (level, found, total) =>
			`Meilleur résultat de la saison au niveau ${level}${NBSP}: ${found} / ${total}`,
		playAgain: 'Rejouer',
		loadingRoster: 'Chargement de l’alignement',
		noScript:
			'Numbrrs a besoin de JavaScript pour distribuer les cartes. Activez-le, puis rechargez la page.',
		noRoster: 'L’alignement n’est pas disponible pour le moment.',
		retryRoster: 'Réessayer',
		answerChoices: 'Choix de réponse',
		guessResult: (correct, sweaterNumber, name) =>
			`${correct ? 'Exact' : 'Raté'} — le numéro ${sweaterNumber}, c’est ${name}.`,
		nextNumber: (sweaterNumber) => `Prochain numéro${NBSP}: ${sweaterNumber}.`,
		introduced: (sweaterNumber, name) =>
			`Nouvelle carte${NBSP}: le numéro ${sweaterNumber}, c’est ${name}.`,
		next: 'Continuer',
		toLearn: (count) => `${count} à apprendre`,
		finalLap: (count) => `Dernier tour${NBSP}: ${count} à trouver`,
		lapStart: `Dernier tour${NBSP}: toutes les cartes une dernière fois, et cette fois l’alignement garde ses numéros pour lui.`,
		tryLevel: (level) => `Essayer le niveau ${level}`,
		learnNew: (count, gender) => `Apprendre ${count} ${newcomers(count, gender)}`,
		hideRoster: 'masquer l’alignement',
		showAll: 'tout afficher',
		groups: {
			forwards: (gender) => (gender === 'f' ? 'Attaquantes' : 'Attaquants'),
			defense: (gender) => (gender === 'f' ? 'Défenseures' : 'Défenseurs'),
			goalies: (gender) => (gender === 'f' ? 'Gardiennes' : 'Gardiens'),
			other: 'Autres'
		}
	},

	positions: {
		C: () => 'Centre',
		L: (gender) => (gender === 'f' ? 'Ailière gauche' : 'Ailier gauche'),
		R: (gender) => (gender === 'f' ? 'Ailière droite' : 'Ailier droit'),
		F: (gender) => (gender === 'f' ? 'Attaquante' : 'Attaquant'),
		D: (gender) => (gender === 'f' ? 'Défenseure' : 'Défenseur'),
		G: (gender) => (gender === 'f' ? 'Gardienne' : 'Gardien')
	},

	footer: {
		disclaimer:
			'Projet indépendant réalisé par un amateur. Sans lien avec la LNH, la LPHF, la WHL, l’OHL ou la LHJMQ, et sans leur approbation. Les noms et logos d’équipe appartiennent à leurs clubs respectifs, et les noms des trophées à leurs ligues respectives.',
		privacy: 'Confidentialité',
		source: 'Code source'
	},

	privacy: {
		title: 'Confidentialité',
		description: 'Ce que Numbrrs enregistre, pourquoi, et pour combien de temps.',
		summary:
			'Numbrrs compte les pages consultées, simplement pour savoir si le site sert à quelqu’un. Il n’y a ni compte, ni publicité, ni outil de mesure ou traceur tiers, et rien n’est vendu. Les entreprises qui acheminent le site jusqu’à vous traitent forcément votre requête; elles sont nommées plus bas.',
		collectedTitle: 'Ce qu’une page consultée enregistre',
		collected: [
			'La date et l’heure de la visite',
			'Le chemin de la page et la route correspondante',
			'La ligue et l’équipe, s’il s’agit d’une page d’équipe',
			'La langue dans laquelle la page a été servie',
			'Le site d’où vous arrivez — le domaine seulement, jamais l’adresse complète',
			'Un code de visite, décrit ci-dessous'
		],
		hashTitle: 'Le code de visite',
		hashBody: `Pour distinguer deux visiteurs au cours d’une même journée, votre adresse IP et votre navigateur sont hachés avec une valeur aléatoire. Cette valeur est régénérée chaque jour et n’est jamais écrite sur disque${NBSP}: une fois la journée terminée, plus rien ne relie le code à vous, et le code d’aujourd’hui ne peut être rapproché de celui de demain. Votre adresse IP elle-même n’est jamais inscrite dans la base de données du site. Le seul endroit où le site consigne une adresse IP est le journal de son serveur, conservé peu de temps${NBSP}: une tentative refusée ou échouée d’accéder à la page d’administration du site y est notée avec l’adresse d’où elle provient.`,
		cookiesTitle: 'Témoins (cookies)',
		cookiesBody:
			'Aucun n’est utilisé à des fins de mesure. Deux témoins retiennent vos préférences — votre langue (numbrrs_locale) et le dernier onglet de ligue ouvert (numbrrs_league) — pendant un an chacun. Votre niveau de jeu est gardé dans le stockage local de votre navigateur (numbrrs_difficulty) et n’est jamais envoyé au serveur. Il en va de même des médailles et des meilleurs résultats que vous obtenez, et des noms que vous avez déjà trouvés (numbrrs_records), qui ne sont pas envoyés non plus. Il en va de même d’une note indiquant que vous avez fermé l’indice sur le changement de niveau (numbrrs_level_hint). Vous pouvez tout effacer en tout temps dans votre navigateur, et la page Comment jouer a un bouton qui efface vos résultats. La partie en cours est gardée dans le stockage de session de l’onglet (sous des clés commençant par numbrrs_game, une par équipe), n’est jamais envoyée au serveur et disparaît à la fermeture de l’onglet.',
		errorsTitle: 'Erreurs',
		errorsBody:
			'Lorsqu’une erreur survient — sur le serveur ou dans votre navigateur —, son message, la page concernée et une trace technique sont enregistrés afin de pouvoir la corriger. Votre adresse IP n’y est pas jointe. Les occurrences répétées d’une même erreur sont regroupées en une seule entrée.',
		retentionTitle: 'Durée de conservation',
		retentionBody:
			'Les enregistrements de pages consultées sont supprimés automatiquement après 90 jours, ou plus tôt si le stockage dépasse une taille fixée. Une entrée d’erreur est supprimée 90 jours après la dernière occurrence de l’erreur; celles qui proviennent des navigateurs le sont plus tôt si elles s’accumulent. Les copies de sauvegarde du disque du serveur peuvent encore contenir un enregistrement supprimé, jusqu’à ce qu’elles soient éliminées à leur tour.',
		sharingTitle: 'Qui d’autre intervient',
		sharingBody: `Les enregistrements décrits ci-dessus sont conservés dans la base de données du site, sur un serveur situé à Toronto, au Canada, ainsi que dans ses copies de sauvegarde, et je suis la seule personne à les consulter. Trois entreprises interviennent en cours de route${NBSP}: Fly.io (États-Unis) exploite ce serveur et en détient les copies de sauvegarde; Cloudflare (États-Unis) est placée devant lui, de sorte que chaque requête — y compris votre adresse IP — transite par son réseau, qui peut la traiter à l’extérieur du Canada et tient ses propres journaux de trafic et de sécurité; et Discord (États-Unis) reçoit une alerte lorsqu’une erreur est enregistrée, contenant le texte de l’erreur, sans adresse IP. Les photos des joueuses et des joueurs, ainsi que les logos d’équipe que le site n’héberge pas lui-même, sont chargés directement depuis des serveurs d’images exploités par les ligues et par leur fournisseur de statistiques; ces serveurs voient donc votre adresse IP, votre navigateur et le fait que vous venez de Numbrrs lorsqu’une page les affiche.`,
		contactTitle: 'Questions',
		contactBody:
			'Pour une question, une correction ou une demande de suppression, ouvrez un ticket dans le dépôt GitHub du projet.',
		updated: (date) => `Dernière mise à jour${NBSP}: ${date}.`
	},

	error: {
		notFoundTitle: 'Page introuvable',
		notFoundBody:
			'Cette page n’existe pas. Le lien est peut-être périmé, ou une équipe a peut-être changé.',
		leagueNotFound: 'Ligue introuvable',
		teamNotFound: 'Équipe introuvable',
		genericTitle: 'Une erreur est survenue',
		genericBody: 'Désolé, cette requête a échoué de notre côté. Réessayer fonctionne souvent.',
		home: 'Retour aux équipes',
		reference: 'Référence'
	}
};
