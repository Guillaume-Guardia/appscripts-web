// Graphe en ligne d'une seule série (gain cumulé ou bankroll, session après session), en SVG, avec
// la valeur du point le plus proche au survol ou au toucher. Sans dépendance.

import { el, remplacerContenu } from "../shared/dom.js";

const SVG = "http://www.w3.org/2000/svg";
/** Largeur minimale du dessin, en pixels : en dessous, il est réduit. */
const LARGEUR_MIN = 280;
const HAUTEUR = 240;

/** Zones déjà suivies : le graphe est redessiné à leur nouvelle largeur (rotation, fenêtre). */
const suivies = new WeakMap();
const observateur = new ResizeObserver((entrees) => {
	for (const { target } of entrees) {
		const trace = suivies.get(target);
		if (trace && Math.round(target.clientWidth) !== trace.largeur)
			trace.redessiner();
	}
});
const MARGE = { haut: 12, droite: 12, bas: 26, gauche: 56 };

function svg(balise, attributs = {}, ...enfants) {
	const element = document.createElementNS(SVG, balise);
	for (const [nom, valeur] of Object.entries(attributs)) {
		element.setAttribute(nom, valeur);
	}
	element.append(...enfants);
	return element;
}

/**
 * Graduations « rondes » (1, 2, 2,5 ou 5 × une puissance de 10), environ `nombre` intervalles,
 * de la graduation sous `min` à celle au-dessus de `max` : la courbe reste entre la première et la
 * dernière.
 */
export function graduations(min, max, nombre = 5) {
	if (min === max) return [min];
	const brut = (max - min) / nombre;
	const puissance = 10 ** Math.floor(Math.log10(brut));
	const pas =
		[1, 2, 2.5, 5, 10].find((facteur) => facteur * puissance >= brut) *
		puissance;
	const valeurs = [];
	for (let i = Math.floor(min / pas); i <= Math.ceil(max / pas); i++) {
		valeurs.push(i * pas);
	}
	return valeurs;
}

/**
 * Trace la courbe dans `zone`.
 * @param points [{ date: Date, valeur: number }], du plus ancien au plus récent
 * @param formats { valeur(nombre), date(Date), axe(nombre) } : textes de l'infobulle et de l'axe
 * @param avecZero vrai pour garder 0 dans l'échelle et tracer sa ligne (gain cumulé)
 */
export function tracerGraphe(zone, points, formats, { avecZero = false } = {}) {
	// Dessiné à la largeur de la zone : le texte des axes garde sa taille sur un téléphone.
	const largeur = Math.max(LARGEUR_MIN, Math.round(zone.clientWidth) || 640);
	if (!suivies.has(zone)) observateur.observe(zone);
	suivies.set(zone, {
		largeur: Math.round(zone.clientWidth),
		redessiner: () => tracerGraphe(zone, points, formats, { avecZero }),
	});
	if (points.length < 2) {
		remplacerContenu(
			zone,
			el("p", { class: "aide vide" }, "Pas assez de sessions pour un graphe."),
		);
		return;
	}
	const valeurs = points.map((point) => point.valeur);
	let min = Math.min(...valeurs, ...(avecZero ? [0] : []));
	let max = Math.max(...valeurs, ...(avecZero ? [0] : []));
	if (min === max) {
		min -= 1;
		max += 1;
	}
	const ticks = graduations(min, max);
	min = Math.min(min, ticks[0]);
	max = Math.max(max, ticks.at(-1));
	const debut = points[0].date.getTime();
	const etendue = points.at(-1).date.getTime() - debut || 1;
	const x = (date) =>
		MARGE.gauche +
		((date.getTime() - debut) / etendue) *
			(largeur - MARGE.gauche - MARGE.droite);
	const y = (valeur) =>
		MARGE.haut +
		(1 - (valeur - min) / (max - min)) * (HAUTEUR - MARGE.haut - MARGE.bas);

	const grille = ticks.flatMap((tick) => [
		svg("line", {
			class: tick === 0 && avecZero ? "zero" : "grille",
			x1: MARGE.gauche,
			x2: largeur - MARGE.droite,
			y1: y(tick),
			y2: y(tick),
		}),
		svg(
			"text",
			{
				class: "axe",
				x: MARGE.gauche - 8,
				y: y(tick) + 4,
				"text-anchor": "end",
			},
			formats.axe(tick),
		),
	]);
	const datesAxe = [
		svg(
			"text",
			{ class: "axe", x: MARGE.gauche, y: HAUTEUR - 6 },
			formats.date(points[0].date),
		),
		svg(
			"text",
			{
				class: "axe",
				x: largeur - MARGE.droite,
				y: HAUTEUR - 6,
				"text-anchor": "end",
			},
			formats.date(points.at(-1).date),
		),
	];
	const trace = points
		.map(
			(p, i) =>
				`${i ? "L" : "M"}${x(p.date).toFixed(1)} ${y(p.valeur).toFixed(1)}`,
		)
		.join("");
	const repere = svg("line", {
		class: "repere",
		y1: MARGE.haut,
		y2: HAUTEUR - MARGE.bas,
		visibility: "hidden",
	});
	const pastille = svg("circle", {
		class: "pastille",
		r: 5,
		visibility: "hidden",
	});
	const dessin = svg(
		"svg",
		{
			viewBox: `0 0 ${largeur} ${HAUTEUR}`,
			role: "img",
			"aria-label": `Courbe de ${points.length} sessions, de ${formats.valeur(points[0].valeur)} à ${formats.valeur(points.at(-1).valeur)}`,
		},
		...grille,
		...datesAxe,
		svg("path", { class: "courbe", d: trace }),
		repere,
		pastille,
	);
	const infobulle = el("div", { class: "graphe-infobulle", hidden: true });

	function montrer(evenement) {
		const cadre = dessin.getBoundingClientRect();
		const xSouris = ((evenement.clientX - cadre.left) / cadre.width) * largeur;
		// Le point le plus proche en x : une session, pas une valeur interpolée.
		const point = points.reduce((proche, candidat) =>
			Math.abs(x(candidat.date) - xSouris) < Math.abs(x(proche.date) - xSouris)
				? candidat
				: proche,
		);
		const px = x(point.date);
		const py = y(point.valeur);
		repere.setAttribute("x1", px);
		repere.setAttribute("x2", px);
		repere.setAttribute("visibility", "visible");
		pastille.setAttribute("cx", px);
		pastille.setAttribute("cy", py);
		pastille.setAttribute("visibility", "visible");
		remplacerContenu(
			infobulle,
			el("strong", {}, formats.valeur(point.valeur)),
			el("span", {}, formats.date(point.date)),
		);
		infobulle.hidden = false;
		const gauche = (px / largeur) * 100;
		infobulle.style.left = `${gauche}%`;
		infobulle.style.top = `${(py / HAUTEUR) * 100}%`;
		infobulle.classList.toggle("a-gauche", gauche > 60);
	}
	function cacher() {
		repere.setAttribute("visibility", "hidden");
		pastille.setAttribute("visibility", "hidden");
		infobulle.hidden = true;
	}
	dessin.addEventListener("pointermove", montrer);
	dessin.addEventListener("pointerdown", montrer);
	dessin.addEventListener("pointerleave", cacher);

	remplacerContenu(zone, dessin, infobulle);
}
