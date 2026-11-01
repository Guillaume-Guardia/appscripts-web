// Fenêtre « Suggestion ou bug » : le message devient une issue GitHub du dépôt, créée par l'API du
// projet droits (action creer-issue), même sans compte. La page charge ../commun/config.js
// (window.API_DROITS).

import { creerApi } from "./api.js";
import { el } from "./dom.js";

/** Projet d'une idée d'app qui n'existe pas encore (option des formulaires d'issue GitHub). */
const NOUVEAU_PROJET = "Nouveau projet";

const TYPES = {
	bug: {
		libelle: "Un bug",
		description: "Que se passe-t-il ?",
		details: "Comment le refaire (facultatif)",
	},
	suggestion: {
		libelle: "Une suggestion",
		description: "Ton idée",
		details: "Comment tu la verrais (facultatif)",
	},
};

/**
 * Ouvre la fenêtre d'envoi d'un bug ou d'une suggestion.
 * @param app Nom de l'app, joint au message (ex : « Voyage »)
 * @param version Version de l'app, jointe au message
 * @param projets Projets proposés (le premier est choisi d'avance), suivis de « Nouveau projet »
 * @param prenom Prénom proposé d'avance (ex : celui du compte connecté)
 */
export function ouvrirSignalement({
	app,
	version = window.VERSION_APP,
	projets = [app],
	prenom = "",
}) {
	let type = "suggestion";
	const erreur = el("p", { class: "erreur", role: "alert" });
	const puces = Object.entries(TYPES).map(([cle, { libelle }]) =>
		el(
			"button",
			{
				type: "button",
				class: "puce",
				"aria-pressed": String(cle === type),
				onclick: () => choisirType(cle),
			},
			libelle,
		),
	);
	const projet = el(
		"select",
		{ id: "signalement-projet" },
		[...projets, NOUVEAU_PROJET].map((nom) => el("option", {}, nom)),
	);
	const labelDescription = el("label", { for: "signalement-description" });
	const description = el("textarea", {
		id: "signalement-description",
		required: true,
		rows: "4",
		maxlength: "5000",
	});
	const labelDetails = el("label", { for: "signalement-details" });
	const details = el("textarea", {
		id: "signalement-details",
		rows: "3",
		maxlength: "5000",
	});
	const champPrenom = el("input", {
		id: "signalement-prenom",
		autocomplete: "given-name",
		maxlength: "40",
		value: prenom,
	});
	// Champ piège : caché aux personnes, seul un robot le remplit (l'envoi est alors ignoré).
	const piege = el("input", {
		name: "site",
		hidden: true,
		tabindex: "-1",
		autocomplete: "off",
	});
	const envoyer = el(
		"button",
		{ type: "submit", class: "bouton-principal" },
		"Envoyer",
	);

	function choisirType(cle) {
		type = cle;
		puces.forEach((puce, i) => {
			puce.setAttribute("aria-pressed", String(Object.keys(TYPES)[i] === cle));
		});
		labelDescription.textContent = TYPES[cle].description;
		labelDetails.textContent = TYPES[cle].details;
	}
	choisirType(type);

	async function soumettre(evenement) {
		evenement.preventDefault();
		envoyer.disabled = true;
		erreur.textContent = "";
		try {
			const appeler = creerApi({ url: window.API_DROITS });
			const issue = await appeler("creer-issue", {
				type,
				projet: projet.value,
				description: description.value,
				details: details.value,
				prenom: champPrenom.value,
				app,
				version,
				site: piege.value,
			});
			formulaire.replaceChildren(
				el("h2", {}, "Merci !"),
				el(
					"p",
					{ class: "aide" },
					issue
						? `Ton message est bien arrivé (n° ${issue.numero}).`
						: "Ton message est bien arrivé.",
				),
				el(
					"div",
					{ class: "boutons" },
					el(
						"button",
						{
							type: "button",
							class: "bouton-principal",
							onclick: () => dialogue.close(),
						},
						"Fermer",
					),
				),
			);
		} catch (e) {
			erreur.textContent = e.message;
			envoyer.disabled = false;
		}
	}

	const formulaire = el(
		"form",
		{ class: "formulaire", onsubmit: soumettre },
		el("h2", {}, "Suggestion ou bug"),
		el(
			"p",
			{ class: "aide" },
			"Ton message arrive directement chez le développeur des apps.",
		),
		el("div", { class: "puces", role: "group", "aria-label": "Type" }, puces),
		el("label", { for: "signalement-projet" }, "App concernée"),
		projet,
		labelDescription,
		description,
		labelDetails,
		details,
		el("label", { for: "signalement-prenom" }, "Ton prénom (facultatif)"),
		champPrenom,
		piege,
		erreur,
		el(
			"div",
			{ class: "boutons" },
			el(
				"button",
				{ type: "button", onclick: () => dialogue.close() },
				"Annuler",
			),
			envoyer,
		),
	);
	const dialogue = el(
		"dialog",
		{ class: "dialogue", onclose: () => dialogue.remove() },
		formulaire,
	);
	if (!window.API_DROITS) {
		erreur.textContent =
			"L'adresse de l'API n'est pas configurée (commun/config.js).";
		envoyer.disabled = true;
	}
	document.body.append(dialogue);
	dialogue.showModal();
	return dialogue;
}
