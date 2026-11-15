// Visite guidée d'une app : une bulle par étape, posée près de l'élément qu'elle présente, mis en
// lumière (le reste de l'écran est assombri). Fenêtre modale : rien d'autre ne se touche pendant la
// visite, et shared/pwa.js attend sa fin pour recharger la page après une mise à jour.

import { el } from "./dom.js";

/** Marge entre l'élément mis en lumière et le bord de sa lumière, puis la bulle. */
const MARGE_LUMIERE = 6;
const ECART_BULLE = 12;
/** Gouttière laissée de chaque côté de l'écran. */
const GOUTTIERE = 16;

/**
 * Lance une visite guidée.
 * @param etapes [{ cible, titre, texte, avant }] : `cible` (sélecteur, ou fonction qui renvoie
 *   l'élément) est mise en lumière, sans cible la bulle est au centre ; `avant` prépare l'écran
 *   (ex : ouvrir l'onglet présenté)
 * @return Promesse résolue à la fin de la visite, terminée ou passée
 */
export function lancerVisite(etapes) {
	let index = 0;
	const lumiere = el("div", { class: "visite-lumiere", "aria-hidden": "true" });
	const numero = el("p", { class: "visite-numero" });
	const titre = el("h2", { id: "visite-titre" });
	const texte = el("p", { class: "visite-texte" });
	const passer = el(
		"button",
		{ type: "button", class: "visite-passer", onclick: () => fermer() },
		"Passer",
	);
	const precedent = el(
		"button",
		{ type: "button", onclick: () => aller(index - 1) },
		"Précédent",
	);
	const suivant = el("button", {
		type: "button",
		class: "bouton-principal",
		onclick: () => (index === etapes.length - 1 ? fermer() : aller(index + 1)),
	});
	const bulle = el(
		"div",
		{ class: "visite-bulle" },
		numero,
		titre,
		texte,
		el("div", { class: "boutons" }, passer, precedent, suivant),
	);
	const dialogue = el(
		"dialog",
		{
			class: "visite",
			"aria-labelledby": "visite-titre",
			onclose: () => {
				window.removeEventListener("resize", placer);
				dialogue.remove();
			},
			onkeydown: (e) => {
				if (e.key === "ArrowRight" && index < etapes.length - 1)
					aller(index + 1);
				else if (e.key === "ArrowLeft" && index > 0) aller(index - 1);
			},
		},
		lumiere,
		bulle,
	);

	function fermer() {
		dialogue.close();
	}

	function cibleDe(etape) {
		if (!etape.cible) return null;
		const cible =
			typeof etape.cible === "function"
				? etape.cible()
				: document.querySelector(etape.cible);
		// Une cible masquée (ex : absente sur ce compte) : la bulle passe au centre.
		return cible?.getClientRects().length ? cible : null;
	}

	/** Pose la lumière sur la cible de l'étape, et la bulle au-dessous (ou au-dessus, faute de place). */
	function placer() {
		const cible = cibleDe(etapes[index]);
		const largeur = window.innerWidth;
		const hauteur = window.innerHeight;
		const hauteurBulle = bulle.offsetHeight;
		const largeurBulle = bulle.offsetWidth;
		if (!cible) {
			// Sans cible : une lumière de taille nulle au centre, tout l'écran est assombri.
			Object.assign(lumiere.style, {
				top: `${hauteur / 2}px`,
				left: `${largeur / 2}px`,
				width: "0px",
				height: "0px",
			});
			Object.assign(bulle.style, {
				top: `${Math.max(GOUTTIERE, (hauteur - hauteurBulle) / 2)}px`,
				left: `${(largeur - largeurBulle) / 2}px`,
			});
			return;
		}
		const zone = cible.getBoundingClientRect();
		const haut = zone.top - MARGE_LUMIERE;
		const bas = zone.bottom + MARGE_LUMIERE;
		Object.assign(lumiere.style, {
			top: `${haut}px`,
			left: `${zone.left - MARGE_LUMIERE}px`,
			width: `${zone.width + 2 * MARGE_LUMIERE}px`,
			height: `${zone.height + 2 * MARGE_LUMIERE}px`,
		});
		const dessous = bas + ECART_BULLE + hauteurBulle <= hauteur - GOUTTIERE;
		const top = dessous
			? bas + ECART_BULLE
			: Math.max(GOUTTIERE, haut - ECART_BULLE - hauteurBulle);
		const centre = zone.left + zone.width / 2 - largeurBulle / 2;
		const left = Math.min(
			Math.max(GOUTTIERE, centre),
			largeur - GOUTTIERE - largeurBulle,
		);
		Object.assign(bulle.style, { top: `${top}px`, left: `${left}px` });
	}

	function aller(nouvelIndex) {
		index = nouvelIndex;
		const etape = etapes[index];
		etape.avant?.();
		numero.textContent = `${index + 1} / ${etapes.length}`;
		titre.textContent = etape.titre;
		texte.textContent = etape.texte;
		const derniere = index === etapes.length - 1;
		passer.hidden = derniere;
		precedent.hidden = index === 0;
		suivant.textContent = derniere ? "C'est parti" : "Suivant";
		cibleDe(etape)?.scrollIntoView({ block: "nearest" });
		placer();
		suivant.focus();
	}

	document.body.append(dialogue);
	dialogue.showModal();
	window.addEventListener("resize", placer);
	aller(0);
	return new Promise((resolve) => {
		dialogue.addEventListener("close", resolve);
	});
}
