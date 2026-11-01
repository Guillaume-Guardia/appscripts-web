// Graphiques de l'app : kcal des 7 derniers jours (boutons HTML, un par jour) et courbe du poids
// (SVG). Les couleurs viennent de style.css (variables du thème clair ou sombre).

import { el } from "../shared/dom.js";
import { nombre } from "./nutrition.js";

/**
 * Kcal de chaque jour, en colonnes ; l'objectif en trait horizontal.
 * @param jours [{ jour: « aaaa-mm-jj », court: « lun. », kcal: nombre ou null (inconnu) }]
 * @param objectif Kcal par jour, ou null
 * @param jourChoisi Le jour affiché, mis en avant
 * @param surClic Appelée avec le jour d'une colonne touchée
 */
export function histogrammeKcal(jours, objectif, jourChoisi, surClic) {
	const max = Math.max(objectif ?? 0, ...jours.map((j) => j.kcal ?? 0)) * 1.1;
	const hauteur = (kcal) => (max > 0 ? Math.min(100, (kcal / max) * 100) : 0);
	return el(
		"div",
		{ class: "semaine" },
		objectif
			? el("div", {
					class: "ligne-objectif",
					style: `--part: ${hauteur(objectif) / 100}`,
					"aria-hidden": "true",
				})
			: null,
		jours.map((j) =>
			el(
				"button",
				{
					type: "button",
					class: `jour-semaine${j.jour === jourChoisi ? " choisi" : ""}${objectif && j.kcal > objectif ? " au-dessus" : ""}`,
					"aria-label": `${j.court} : ${j.kcal === null ? "pas encore chargé" : `${nombre(j.kcal, 0)} kcal`}`,
					onclick: () => surClic(j.jour),
				},
				el(
					"span",
					{ class: "colonne" },
					el("span", {
						class: "barre-kcal",
						style: `height: ${hauteur(j.kcal ?? 0)}%`,
					}),
				),
				el("span", { class: "court" }, j.court),
			),
		),
	);
}

const SVG = "http://www.w3.org/2000/svg";

function svg(balise, attributs = {}, ...enfants) {
	const element = document.createElementNS(SVG, balise);
	for (const [nom, valeur] of Object.entries(attributs)) {
		element.setAttribute(nom, String(valeur));
	}
	for (const enfant of enfants.flat(Infinity)) {
		if (enfant === null || enfant === undefined) continue;
		element.append(
			enfant instanceof Node ? enfant : document.createTextNode(String(enfant)),
		);
	}
	return element;
}

/**
 * Courbe du poids.
 * @param pesees [{ date: Date, poids }], de la plus ancienne à la plus récente (2 au moins)
 * @param cible Poids cible en kg, ou null
 * @param formatDate Date → texte court, pour l'axe
 */
export function courbePoids(pesees, cible, formatDate) {
	const largeur = 320;
	const haut = 160;
	const marge = { gauche: 36, droite: 10, haut: 12, bas: 24 };
	const poids = pesees.map((p) => p.poids);
	const bas = Math.floor(Math.min(...poids, cible ?? Infinity) - 0.5);
	const hautKg = Math.ceil(Math.max(...poids, cible ?? -Infinity) + 0.5);
	const debut = pesees[0].date.getTime();
	const duree = Math.max(1, pesees.at(-1).date.getTime() - debut);
	const x = (date) =>
		marge.gauche +
		((date.getTime() - debut) / duree) *
			(largeur - marge.gauche - marge.droite);
	const y = (kg) =>
		marge.haut +
		((hautKg - kg) / (hautKg - bas)) * (haut - marge.haut - marge.bas);
	const points = pesees.map((p) => `${x(p.date)},${y(p.poids)}`).join(" ");
	return svg(
		"svg",
		{
			class: "courbe",
			viewBox: `0 0 ${largeur} ${haut}`,
			role: "img",
			"aria-label": `Poids du ${formatDate(pesees[0].date)} au ${formatDate(pesees.at(-1).date)} : de ${nombre(poids[0])} à ${nombre(poids.at(-1))} kg`,
		},
		[hautKg, bas].map((kg) => [
			svg("line", {
				class: "grille",
				x1: marge.gauche,
				x2: largeur - marge.droite,
				y1: y(kg),
				y2: y(kg),
			}),
			svg(
				"text",
				{
					class: "axe",
					x: marge.gauche - 6,
					y: y(kg) + 4,
					"text-anchor": "end",
				},
				nombre(kg, 0),
			),
		]),
		cible
			? svg("line", {
					class: "cible",
					x1: marge.gauche,
					x2: largeur - marge.droite,
					y1: y(cible),
					y2: y(cible),
				})
			: null,
		svg(
			"text",
			{ class: "axe", x: marge.gauche, y: haut - 6 },
			formatDate(pesees[0].date),
		),
		svg(
			"text",
			{
				class: "axe",
				x: largeur - marge.droite,
				y: haut - 6,
				"text-anchor": "end",
			},
			formatDate(pesees.at(-1).date),
		),
		svg("polyline", { class: "trace", points }),
		pesees.length <= 60
			? pesees.map((p) =>
					svg("circle", {
						class: "point",
						cx: x(p.date),
						cy: y(p.poids),
						r: 3,
					}),
				)
			: null,
	);
}
