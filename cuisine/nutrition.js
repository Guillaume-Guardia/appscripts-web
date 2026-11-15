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

/**
 * Les calculs suivants refont ceux de l'API (projets/cuisine, calculer-nutriments.ts), pour
 * afficher une modification avant sa réponse (enregistrement en arrière-plan) : l'état du serveur
 * les remplace ensuite.
 */

/** Kcal par gramme, pour déduire les kcal inconnues d'un aliment. */
const KCAL_DEDUITES = { proteines: 4, glucides: 4, lipides: 9, fibres: 2 };

/** Nombre saisi (« 12,5 » ou « 12.5 »), ou null si le champ est vide ou illisible. */
export function nombreSaisi(texte) {
	const valeur = Number(
		String(texte ?? "")
			.trim()
			.replace(",", "."),
	);
	return String(texte ?? "").trim() === "" || Number.isNaN(valeur)
		? null
		: valeur;
}

/**
 * Valeurs pour 100 g d'un aliment saisi : une valeur inconnue compte 0, des kcal inconnues sont
 * déduites des macros.
 * @param saisies Texte de chaque nutriment (vide : inconnu)
 */
export function pour100gComplet(saisies) {
	const valeurs = Object.fromEntries(
		NUTRIMENTS.map((n) => [n, nombreSaisi(saisies[n]) ?? 0]),
	);
	if (nombreSaisi(saisies.kcal) === null) {
		valeurs.kcal = Object.entries(KCAL_DEDUITES).reduce(
			(total, [n, kcal]) => total + valeurs[n] * kcal,
			0,
		);
	}
	return valeurs;
}

/** Arrondi du classeur : kcal entières, sel au centième, le reste au dixième. */
export function arrondir(valeurs) {
	return Object.fromEntries(
		NUTRIMENTS.map((n) => {
			const decimales = n === "kcal" ? 1 : n === "sel" ? 100 : 10;
			return [n, Math.round((valeurs[n] ?? 0) * decimales) / decimales];
		}),
	);
}

/**
 * Recette calculée d'après le catalogue : valeurs d'une portion (arrondies), poids d'une portion,
 * ingrédients absents du catalogue (comptés 0).
 * @param trouverAliment (nom) => aliment du catalogue, ou undefined
 */
export function calculerRecette({ portions, ingredients }, trouverAliment) {
	const inconnus = [];
	const valeurs = [];
	for (const { aliment, quantite } of ingredients) {
		const trouve = trouverAliment(aliment);
		if (trouve) valeurs.push(multiplier(trouve.pour100g, quantite / 100));
		else inconnus.push(aliment);
	}
	const poids = ingredients.reduce((total, i) => total + i.quantite, 0);
	return {
		parPortion: arrondir(multiplier(additionner(valeurs), 1 / portions)),
		poidsPortion: Math.round(poids / portions),
		inconnus,
	};
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
