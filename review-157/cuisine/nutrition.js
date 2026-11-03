// Valeurs nutritionnelles côté app : aperçus avant enregistrement (l'API refait le calcul) et
// formats d'affichage.

/** Dans l'ordre des colonnes du classeur. */
export const NUTRIMENTS = [
	"kcal",
	"proteines",
	"glucides",
	"sucres",
	"lipides",
	"fibres",
	"sel",
];

/** Kcal par gramme de protéines, glucides et lipides (répartition des kcal). */
export const KCAL_PAR_GRAMME = { proteines: 4, glucides: 4, lipides: 9 };

export function vides() {
	return Object.fromEntries(NUTRIMENTS.map((n) => [n, 0]));
}

export function multiplier(valeurs, facteur) {
	return Object.fromEntries(
		NUTRIMENTS.map((n) => [n, (valeurs?.[n] ?? 0) * facteur]),
	);
}

export function additionner(liste) {
	const total = vides();
	for (const valeurs of liste) {
		for (const n of NUTRIMENTS) total[n] += valeurs?.[n] ?? 0;
	}
	return total;
}

const format1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const format0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** « 12,5 » ; kcal sans décimale. */
export const nombre = (valeur, decimales = 1) =>
	(decimales === 0 ? format0 : format1).format(valeur ?? 0);

/** « 150 g », « 1,5 portion » */
export function quantiteTexte(type, quantite) {
	if (type === "recette") {
		return `${nombre(quantite)} portion${quantite > 1 ? "s" : ""}`;
	}
	return `${nombre(quantite)} g`;
}

/** « 140 kcal · P 12,5 g · G 0 g · L 10 g » */
export function resume(valeurs) {
	return `${nombre(valeurs.kcal, 0)} kcal · P ${nombre(valeurs.proteines)} g · G ${nombre(valeurs.glucides)} g · L ${nombre(valeurs.lipides)} g`;
}
