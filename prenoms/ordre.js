// Ordre des cartes de la sélection quand on ne les veut pas au hasard (melanger, dans donnees.js).
// Sans DOM : testé par projets/prenoms/test/web/ordre.test.ts.

/**
 * Pile du plus donné au moins donné : naissances de la dernière année, puis depuis le début du
 * fichier (prénoms qui ne sont plus donnés). Les prénoms ajoutés à la main d'abord, comme dans
 * melanger.
 * @param {{ cle: string, prenom: string, derniere: number, total: number, ajoute?: boolean }[]} candidats
 * Les prénoms à voter (filtrés, pas encore votés)
 * @return Les clés, de la première carte à la dernière
 */
export function parPopularite(candidats) {
	return [...candidats]
		.sort(
			(a, b) =>
				Number(Boolean(b.ajoute)) - Number(Boolean(a.ajoute)) ||
				b.derniere - a.derniere ||
				b.total - a.total ||
				a.prenom.localeCompare(b.prenom, "fr"),
		)
		.map((p) => p.cle);
}
