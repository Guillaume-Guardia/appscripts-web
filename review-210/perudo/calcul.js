// Probabilités du Perudo : combien de dés de la table montrent une face, d'après mes dés et le
// nombre de dés cachés chez les autres. Sans dépendance au navigateur.
//
// Une partie : { total, mesDes, palifico } (total : dés en jeu, les miens compris ; mesDes : faces
// de 1 à 6, 1 = paco).

/** Dés cachés chez les autres joueurs. */
export const desCaches = (partie) => partie.total - partie.mesDes.length;

/**
 * Chance qu'un dé caché compte pour la face : la face ou un paco (1 sur 3), 1 sur 6 pour les pacos
 * et en palifico (les pacos n'y sont plus jokers).
 */
export const chanceFace = (partie, face) =>
	face === 1 || partie.palifico ? 1 / 6 : 1 / 3;

/** Mes dés qui comptent pour la face : la face, et les pacos hors palifico. */
export function compterChezMoi(partie, face) {
	return partie.mesDes.filter(
		(de) => de === face || (!partie.palifico && face !== 1 && de === 1),
	).length;
}

/** Loi binomiale : probabilité de k succès parmi n, pour k de 0 à n (p < 1). */
export function loiBinomiale(n, p) {
	const loi = new Array(n + 1).fill(0);
	loi[0] = (1 - p) ** n;
	for (let k = 1; k <= n; k++) {
		loi[k] = (((loi[k - 1] * (n - k + 1)) / k) * p) / (1 - p);
	}
	return loi;
}

/** Probabilité qu'il y ait au moins `quantite` dés de la face sur la table. */
export function auMoins(partie, quantite, face) {
	const manquants = quantite - compterChezMoi(partie, face);
	const caches = desCaches(partie);
	if (manquants <= 0) return 1;
	if (manquants > caches) return 0;
	return loiBinomiale(caches, chanceFace(partie, face))
		.slice(manquants)
		.reduce((a, b) => a + b, 0);
}

/** Probabilité qu'il y ait exactement `quantite` dés de la face sur la table (calza). */
export function exactement(partie, quantite, face) {
	const manquants = quantite - compterChezMoi(partie, face);
	const caches = desCaches(partie);
	return manquants < 0 || manquants > caches
		? 0
		: loiBinomiale(caches, chanceFace(partie, face))[manquants];
}

/** Dernière quantité qui tient au moins une fois sur deux sur cette face (0 si aucune). */
export function bascule(partie, face) {
	let derniere = 0;
	for (let k = 1; k <= partie.total; k++) {
		if (auMoins(partie, k, face) < 0.5) break;
		derniere = k;
	}
	return derniere;
}

/**
 * Plus petites surenchères légales sur `quantite` × `face`, de la plus sûre à la plus risquée :
 * [{ quantite, face, proba }]. Passer aux pacos : moitié de la quantité, arrondie au-dessus ; en
 * revenir : double plus un. En palifico, seule la quantité monte.
 */
export function surencheres(partie, quantite, face) {
	const liste = [];
	if (partie.palifico) liste.push({ quantite: quantite + 1, face });
	else if (face === 1) {
		liste.push({ quantite: quantite + 1, face: 1 });
		for (let g = 2; g <= 6; g++)
			liste.push({ quantite: 2 * quantite + 1, face: g });
	} else {
		for (let g = 2; g <= 6; g++) {
			liste.push({ quantite: g > face ? quantite : quantite + 1, face: g });
		}
		liste.push({ quantite: Math.ceil(quantite / 2), face: 1 });
	}
	return liste
		.filter((s) => s.quantite <= partie.total)
		.map((s) => ({ ...s, proba: auMoins(partie, s.quantite, s.face) }))
		.sort((a, b) => b.proba - a.proba);
}
