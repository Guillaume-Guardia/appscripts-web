// Fiche d'un prénom : essai avec le nom de famille, fête, naissances (INSEE) en histogramme,
// origine lue sur le Wiktionnaire et signification lue sur Wikipédia.

import { el, initiale, remplacerContenu } from "../shared/dom.js";
import { ecrireStockage, lireStockageJson } from "../shared/stockage.js";
import { etymologieWiktionnaire } from "./wiktionnaire.js";

const SVG = "http://www.w3.org/2000/svg";
const NOMBRE = new Intl.NumberFormat("fr-FR");
const MOIS = [
	"janvier",
	"février",
	"mars",
	"avril",
	"mai",
	"juin",
	"juillet",
	"août",
	"septembre",
	"octobre",
	"novembre",
	"décembre",
];

/** « 10-11 » → « 10 novembre », « 01-01 » → « 1er janvier ». */
export function jourDeFete(date) {
	const [jour, mois] = date.split("-").map(Number);
	return `${jour === 1 ? "1er" : jour} ${MOIS[mois - 1]}`;
}

/** « Fêtée le 10 novembre », « Fêté le 1er janvier et le 15 août », ou "" sans fête connue. */
export function texteFete(prenom) {
	if (!prenom.fetes?.length) return "";
	const jours = prenom.fetes.map((date) => `le ${jourDeFete(date)}`);
	return `${prenom.sexe === "f" ? "Fêtée" : "Fêté"} ${jours.join(" et ")}`;
}

/** « Léonie Martin », ou le prénom seul sans nom de famille. */
export const essai = (prenom, nomFamille) =>
	[prenom, nomFamille].filter(Boolean).join(" ");

/** « En hausse de 24 % sur 5 ans », « Nouveau », etc. */
export function texteTendance(prenom) {
	if (prenom.ajoute) return "";
	if (prenom.tendance === null) return "Nouveau ces dernières années";
	const ecart = Math.abs(prenom.tendance);
	if (prenom.sens === "hausse") return `En hausse de ${ecart} % sur 5 ans`;
	if (prenom.sens === "baisse") return `En baisse de ${ecart} % sur 5 ans`;
	return "Stable sur 5 ans";
}

function histogramme(prenom, { debut, pas, edition }) {
	const { courbe } = prenom;
	const max = Math.max(1, ...courbe);
	const largeurBarre = 10;
	const hauteur = 70;
	const barres = courbe.map((valeur, i) => {
		const de = debut + i * pas;
		const a = Math.min(de + pas - 1, edition);
		const h = valeur ? Math.max(1, (valeur / max) * hauteur) : 0;
		const barre = document.createElementNS(SVG, "rect");
		barre.setAttribute("x", String(i * largeurBarre + 1));
		barre.setAttribute("y", String(hauteur - h));
		barre.setAttribute("width", String(largeurBarre - 2));
		barre.setAttribute("height", String(h));
		barre.setAttribute("rx", "1.5");
		const titre = document.createElementNS(SVG, "title");
		titre.textContent = `${de === a ? de : `${de}–${a}`} : ${NOMBRE.format(valeur)} par an`;
		barre.append(titre);
		return barre;
	});
	const dessin = document.createElementNS(SVG, "svg");
	dessin.setAttribute(
		"viewBox",
		`0 0 ${courbe.length * largeurBarre} ${hauteur}`,
	);
	dessin.setAttribute("preserveAspectRatio", "none");
	dessin.setAttribute("role", "img");
	dessin.setAttribute(
		"aria-label",
		`Naissances par an de ${debut} à ${edition}, au plus haut vers ${prenom.anneePic}`,
	);
	dessin.append(...barres);
	return el(
		"figure",
		{ class: "histogramme" },
		dessin,
		el(
			"figcaption",
			{},
			el("span", {}, String(debut)),
			el("span", {}, "Naissances par an"),
			el("span", {}, String(edition)),
		),
	);
}

/** Résumé Wikipédia d'une page qui parle du prénom, ou null. */
async function resumeWikipedia(titre) {
	const reponse = await fetch(
		`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titre.replaceAll(" ", "_"))}`,
	);
	if (!reponse.ok) return null;
	const page = await reponse.json();
	if (!page.extract || !/prénom/i.test(page.extract)) return null;
	return { texte: page.extract, url: page.content_urls?.desktop?.page ?? "" };
}

/**
 * Signification du prénom sur Wikipédia : la page « Léonie (prénom) », sinon « Léonie » si elle
 * parle d'un prénom. Gardée sur l'appareil (null : pas trouvée).
 * @throws Sans réseau
 */
export async function signification(prenom) {
	const cle = `prenoms.wiki.${prenom}`;
	const gardee = lireStockageJson(cle);
	if (gardee) return gardee.texte ? gardee : null;
	const trouvee =
		(await resumeWikipedia(`${prenom} (prénom)`)) ??
		(await resumeWikipedia(prenom));
	ecrireStockage(cle, JSON.stringify(trouvee ?? { texte: "" }));
	return trouvee;
}

/**
 * Origine du prénom : son étymologie sur le Wiktionnaire, gardée sur l'appareil (null : pas
 * trouvée).
 * @throws Sans réseau, ou si le Wiktionnaire refuse la demande : rien n'est alors gardé
 */
export async function origine(prenom) {
	const cle = `prenoms.wiktionnaire.${prenom}`;
	const gardee = lireStockageJson(cle);
	if (gardee) return gardee.paragraphes?.length ? gardee : null;
	const titre = encodeURIComponent(prenom.replaceAll(" ", "_"));
	const reponse = await fetch(
		`https://fr.wiktionary.org/api/rest_v1/page/html/${titre}`,
	);
	if (!reponse.ok && reponse.status !== 404) {
		throw new Error(`Wiktionnaire : ${reponse.status}`);
	}
	const trouvee = {
		paragraphes: reponse.ok ? etymologieWiktionnaire(await reponse.text()) : [],
		url: `https://fr.wiktionary.org/wiki/${titre}#Français`,
	};
	ecrireStockage(cle, JSON.stringify(trouvee));
	return trouvee.paragraphes.length ? trouvee : null;
}

/**
 * Remplit, sous son titre, la zone d'un texte lu en ligne (origine, signification).
 * @param recherche Promesse de { paragraphes, url } (url vide : pas de lien), ou null
 * @param textes { lien, absent, indisponible } : le lien vers la source, et les messages sans
 * texte trouvé ou sans réponse
 */
function remplirTexte(zone, titre, recherche, textes) {
	const afficher = (...contenu) =>
		remplacerContenu(zone, el("h3", {}, titre), ...contenu);
	afficher(el("p", { class: "aide" }, "Chargement…"));
	recherche.then(
		(trouve) =>
			afficher(
				trouve
					? [
							...trouve.paragraphes.map((texte) => el("p", {}, texte)),
							trouve.url
								? el(
										"a",
										{ href: trouve.url, target: "_blank", rel: "noopener" },
										textes.lien,
									)
								: null,
						]
					: el("p", { class: "aide" }, textes.absent),
			),
		() => afficher(el("p", { class: "aide" }, textes.indisponible)),
	);
}

/**
 * Remplit la fiche du prénom dans `conteneur`.
 * @param contexte { nomFamille, donnees (edition, debut, pas), vote ("oui", "non" ou null),
 * match (vrai si c'est un match), surVote(vote) (absent : pas de boutons de vote) }
 */
export function remplirFiche(conteneur, prenom, contexte) {
	const { nomFamille, donnees, vote, match, surVote } = contexte;
	const zoneOrigine = el("section", { class: "texte-fiche" });
	const zoneSens = el("section", { class: "texte-fiche" });
	const stats = prenom.ajoute
		? [
				el(
					"p",
					{ class: "aide" },
					"Prénom ajouté à la main : absent des statistiques de l'INSEE.",
				),
			]
		: [
				el(
					"p",
					{},
					el("strong", {}, NOMBRE.format(prenom.derniere)),
					` naissances en ${donnees.edition}`,
					prenom.rang
						? ` · ${prenom.rang === 1 ? "1er" : `${prenom.rang}e`} prénom de ${prenom.sexe === "f" ? "fille" : "garçon"}`
						: "",
				),
				el(
					"p",
					{ class: "aide" },
					`${NOMBRE.format(prenom.total)} depuis ${donnees.debut} · ${texteTendance(prenom)}`,
				),
				histogramme(prenom, donnees),
			];
	conteneur.className = `sexe-${prenom.sexe}`;
	const initiales = [prenom.prenom, nomFamille]
		.filter(Boolean)
		.map((mot) => `${initiale(mot)}.`)
		.join(" ");
	remplacerContenu(
		conteneur,
		el(
			"header",
			{ class: "fiche-entete" },
			el("h2", {}, prenom.prenom),
			el(
				"p",
				{ class: "aide" },
				prenom.sexe === "f" ? "Fille" : "Garçon",
				match ? " · ❤ Match" : "",
			),
		),
		el(
			"section",
			{ class: "essai" },
			el("p", { class: "essai-nom" }, essai(prenom.prenom, nomFamille)),
			el("p", { class: "aide" }, `Initiales : ${initiales}`),
		),
		texteFete(prenom)
			? el("p", { class: "fete" }, `🎉 ${texteFete(prenom)}`)
			: null,
		el("section", { class: "stats" }, stats),
		zoneOrigine,
		zoneSens,
		surVote
			? el(
					"div",
					{ class: "boutons vote-fiche" },
					el(
						"button",
						{
							type: "button",
							class: vote === "non" ? "choisi non" : "non",
							"aria-pressed": String(vote === "non"),
							onclick: () => surVote("non"),
						},
						"✕ Non",
					),
					el(
						"button",
						{
							type: "button",
							class: vote === "oui" ? "choisi oui" : "oui",
							"aria-pressed": String(vote === "oui"),
							onclick: () => surVote("oui"),
						},
						"✓ Oui",
					),
				)
			: null,
	);
	remplirTexte(zoneOrigine, "Origine", origine(prenom.prenom), {
		lien: "Lire sur le Wiktionnaire",
		absent: "Pas d'origine trouvée sur le Wiktionnaire.",
		indisponible: "Origine indisponible pour l'instant (hors ligne ?).",
	});
	remplirTexte(
		zoneSens,
		"Signification",
		signification(prenom.prenom).then(
			(trouvee) =>
				trouvee && { paragraphes: [trouvee.texte], url: trouvee.url },
		),
		{
			lien: "Lire sur Wikipédia",
			absent: "Pas de signification trouvée sur Wikipédia.",
			indisponible: "Signification indisponible hors ligne.",
		},
	);
}
