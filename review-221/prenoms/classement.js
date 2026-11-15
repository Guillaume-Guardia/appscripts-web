// Classement des matchs par leurs duels (score Elo, comme aux échecs) et choix du duel suivant.
// Sans DOM : testé par projets/prenoms/test/web/classement.test.ts.
//
// Chaque prénom part de SCORE_DEPART points. À chaque duel, le gagnant prend des points au
// perdant : d'autant plus que sa victoire était inattendue (un prénom bien classé qui bat un prénom
// mal classé ne gagne presque rien). Les duels sont rejoués dans l'ordre où ils ont été joués.

export const SCORE_DEPART = 1000;
/** Points en jeu dans un duel entre deux prénoms de même score : la moitié change de camp. */
export const K = 32;
/** En dessous de ce nombre de duels, la place d'un prénom est encore incertaine. */
export const DUELS_STABLES = 5;
/** Les duels récents à ne pas rejouer tout de suite (moins s'il y a peu de paires possibles). */
const DUELS_RECENTS = 10;
/** Nombre d'adversaires de score proche parmi lesquels le duel suivant est tiré. */
const ADVERSAIRES_PROCHES = 3;

/**
 * Classement de matchs d'un même sexe.
 * @param {{ cle: string }[]} matchs Les prénoms à classer ; `cle` les identifie
 * @param {{ gagnant: string, perdant: string }[]} duels Les clés du gagnant et du perdant de
 * chaque duel, dans l'ordre où ils ont été joués ; ceux d'un prénom qui n'est pas dans `matchs`
 * (match défait) sont ignorés
 * @return Les matchs, du meilleur score au moins bon, avec `score` (arrondi), `duels`, `victoires`
 * et `place` (1 pour le premier ; la même pour deux scores égaux ; « rang » est déjà celui de
 * l'INSEE)
 */
export function classer(matchs, duels) {
	const parCle = new Map(
		matchs.map((match) => [
			match.cle,
			{ ...match, score: SCORE_DEPART, duels: 0, victoires: 0, place: 0 },
		]),
	);
	for (const duel of duels) {
		const gagnant = parCle.get(duel.gagnant);
		const perdant = parCle.get(duel.perdant);
		if (!gagnant || !perdant || gagnant === perdant) continue;
		const attendu = 1 / (1 + 10 ** ((perdant.score - gagnant.score) / 400));
		const points = K * (1 - attendu);
		gagnant.score += points;
		perdant.score -= points;
		gagnant.duels++;
		perdant.duels++;
		gagnant.victoires++;
	}
	const classes = [...parCle.values()]
		.map((match) => ({ ...match, score: Math.round(match.score) }))
		.sort((a, b) => b.score - a.score || b.victoires - a.victoires);
	classes.forEach((match, i) => {
		const precedent = classes[i - 1];
		match.place =
			precedent && precedent.score === match.score ? precedent.place : i + 1;
	});
	return classes;
}

/** Clé d'une paire de prénoms, dans un ordre ou dans l'autre. */
export const clePaire = (/** @type {string} */ a, /** @type {string} */ b) =>
	a < b ? `${a}~${b}` : `${b}~${a}`;

/**
 * Le duel suivant : le prénom qui a eu le moins de duels (un nouveau match passe vite), contre
 * l'un des prénoms de score le plus proche, sans rejouer une paire des derniers duels.
 * @param {{ cle: string, score: number, duels: number }[]} classement Voir classer
 * @param {{ gagnant: string, perdant: string }[]} duels Les duels joués, du plus ancien au plus
 * récent
 * @param {() => number} aleatoire Nombre au hasard dans [0, 1[ (Math.random)
 * @return Les deux prénoms, dans un ordre tiré au hasard (haut, bas), ou null avec moins de deux
 * prénoms
 */
export function choisirDuel(classement, duels, aleatoire = Math.random) {
	if (classement.length < 2) return null;
	const tirer = (/** @type {any[]} */ liste) =>
		liste[Math.floor(aleatoire() * liste.length)];
	const moinsDeDuels = Math.min(...classement.map((m) => m.duels));
	const premier = tirer(classement.filter((m) => m.duels === moinsDeDuels));
	// Avec deux prénoms, une seule paire : elle revient à chaque duel.
	const paires = (classement.length * (classement.length - 1)) / 2;
	const nombreRecents = Math.min(DUELS_RECENTS, paires - 1);
	const recentes = new Set(
		nombreRecents > 0
			? duels.slice(-nombreRecents).map((d) => clePaire(d.gagnant, d.perdant))
			: [],
	);
	const parProximite = classement
		.filter((m) => m !== premier)
		.sort(
			(a, b) =>
				Math.abs(a.score - premier.score) - Math.abs(b.score - premier.score),
		);
	// Toutes les paires du premier sont récentes : seule la toute dernière est écartée.
	const dernier = duels.at(-1);
	const derniere =
		paires > 1 && dernier ? clePaire(dernier.gagnant, dernier.perdant) : "";
	const nouveaux = parProximite.filter(
		(m) => !recentes.has(clePaire(m.cle, premier.cle)),
	);
	const pasLaDerniere = parProximite.filter(
		(m) => clePaire(m.cle, premier.cle) !== derniere,
	);
	const second = tirer(
		(nouveaux.length ? nouveaux : pasLaDerniere).slice(0, ADVERSAIRES_PROCHES),
	);
	return aleatoire() < 0.5 ? [premier, second] : [second, premier];
}
