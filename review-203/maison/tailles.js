// Tailles proposées selon le produit : dans « Mode, maroquinerie & bijoux » ou « Sport & mobilité »,
// un pantalon et un t-shirt n'ont pas les mêmes tailles.

const HAUTS = ["XS", "S", "M", "L", "XL", "XXL"];

function pointures(debut, fin, pas) {
	return Array.from({ length: (fin - debut) / pas + 1 }, (_, i) =>
		String(debut + i * pas),
	);
}

const TAILLES = [
	{
		debuts: ["pantalon", "jean", "short", "chino", "legging", "jogging"],
		tailles: pointures(34, 50, 2),
	},
	{
		debuts: ["chaussure", "basket", "botte", "bottine", "sandale", "tong"],
		tailles: pointures(35, 47, 1),
	},
	{
		debuts: [
			"tshirt",
			"teeshirt",
			"tee",
			"vetement",
			"haut",
			"pull",
			"sweat",
			"chemise",
			"polo",
			"veste",
			"manteau",
			"blouson",
			"gilet",
			"robe",
			"jupe",
			"nuisette",
		],
		tailles: HAUTS,
	},
];

/**
 * Tailles d'un produit, d'après les mots de son nom ; seulement pour la mode et le sport.
 * @param normaliser Le texte sans accents ni casse (shared/dom.js)
 * @return La liste, ou null pour un produit sans tailles connues (champ libre)
 * @example
 * taillesDuProduit("Mode, maroquinerie & bijoux", "Jean brut", normaliser); // ["34", "36", …]
 */
export function taillesDuProduit(categorie, produit, normaliser) {
	if (!/^(mode|sport)/.test(normaliser(categorie))) return null;
	const mots = normaliser(produit)
		.replace(/t[-\s]shirt/g, "tshirt")
		.split(/[^a-z0-9]+/);
	return (
		TAILLES.find(({ debuts }) =>
			debuts.some((debut) => mots.some((mot) => mot.startsWith(debut))),
		)?.tailles ?? null
	);
}
