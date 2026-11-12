// Outils d'affichage communs aux apps. Ils s'appuient sur les éléments de base de la page :
// #toasts (notifications) et #bandeau (hors ligne, mise à jour).

export const $ = (selecteur) => document.querySelector(selecteur);

/** Crée un élément ; les textes passent par des nœuds texte (aucun HTML injecté). */
export function el(balise, attributs = {}, ...enfants) {
	const element = document.createElement(balise);
	for (const [nom, valeur] of Object.entries(attributs)) {
		if (valeur === false || valeur === null || valeur === undefined) continue;
		if (nom === "class") element.className = valeur;
		else if (nom.startsWith("on"))
			element.addEventListener(nom.slice(2), valeur);
		else if (valeur === true) element.setAttribute(nom, "");
		else element.setAttribute(nom, valeur);
	}
	for (const enfant of enfants.flat()) {
		if (enfant === null || enfant === undefined || enfant === false) continue;
		element.append(
			enfant instanceof Node ? enfant : document.createTextNode(String(enfant)),
		);
	}
	return element;
}

/** Initiale d'un prénom, en majuscule (« ? » sans prénom). */
export function initiale(prenom) {
	return [...(prenom ?? "").trim()][0]?.toUpperCase() ?? "?";
}

/** Carte du haut du menu (.menu-carte) : le prénom du compte, et son initiale dans le rond. */
export function remplirCarteMenu(prenom) {
	$("#menu-compte").textContent = prenom;
	$(".menu-carte .avatar").textContent = initiale(prenom);
}

/** Remplace le contenu d'un élément ; les enfants absents (null, false) sont ignorés. */
export function remplacerContenu(element, ...enfants) {
	element.replaceChildren(
		...enfants
			.flat()
			.filter(
				(enfant) => enfant !== null && enfant !== undefined && enfant !== false,
			),
	);
}

/** Notification en bas de l'écran (5 s pour une erreur, 3 s sinon). */
export function notifier(message, erreur = false) {
	const toast = el(
		"div",
		{
			class: `toast${erreur ? " erreur-toast" : ""}`,
			role: erreur ? "alert" : "status",
		},
		message,
	);
	$("#toasts").append(toast);
	setTimeout(() => toast.remove(), erreur ? 5000 : 3000);
}

/**
 * Bandeau sous l'en-tête, avec un bouton facultatif.
 * @param type Genre de bandeau (« hors-ligne »)
 * @param action { libelle, faire }
 */
export function afficherBandeau(type, message, action) {
	const bandeau = $("#bandeau");
	bandeau.dataset.type = type;
	remplacerContenu(
		bandeau,
		el("span", {}, message),
		action
			? el("button", { type: "button", onclick: action.faire }, action.libelle)
			: null,
	);
	bandeau.hidden = false;
}

/** Masque le bandeau. */
export function masquerBandeau() {
	$("#bandeau").hidden = true;
}

/**
 * Normalise un texte pour le comparer : sans accents, en minuscules, sans espaces autour, ligatures
 * en deux lettres (« Œuf » = « oeuf »).
 */
export const normaliser = (texte) =>
	String(texte)
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/œ/g, "oe")
		.replace(/æ/g, "ae")
		.trim();
