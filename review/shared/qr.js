// Fenêtre qui montre un lien en QR code (à scanner avec l'appareil photo d'un autre téléphone),
// avec « Envoyer le lien » (partage du téléphone, sinon copie). La page charge
// ../shared/vendor/qrcode.min.js (qrcode-generator) avant ses modules.

import { el, notifier } from "./dom.js";

/** Dessine le QR code d'un texte (SVG). */
function dessinerQr(texte) {
	const qr = window.qrcode(0, "M");
	qr.addData(texte);
	qr.make();
	const conteneur = el("div", { class: "qr" });
	conteneur.innerHTML = qr.createSvgTag({
		cellSize: 6,
		margin: 4,
		scalable: true,
	});
	return conteneur;
}

/** Envoie un lien : partage du téléphone (SMS, messagerie…), sinon copie. */
export async function envoyerLien(lien, titre, texte) {
	if (navigator.share) {
		try {
			await navigator.share({ title: titre, text: texte, url: lien });
			return;
		} catch (erreur) {
			if (erreur?.name === "AbortError") return;
		}
	}
	try {
		await navigator.clipboard.writeText(lien);
		notifier("Lien copié.");
	} catch {
		notifier("Impossible de copier le lien.", true);
	}
}

/**
 * Ouvre la fenêtre du QR code.
 * @param titre Titre de la fenêtre
 * @param aide Explication sous le titre
 * @param lien Lien du QR code
 * @param texteEnvoi Message qui accompagne le lien envoyé
 * @param enPlus Éléments ajoutés sous le QR code (ex : liste des participants)
 * @param actions Boutons en plus : [{ libelle, faire }]
 */
export function ouvrirQr({
	titre,
	aide,
	lien,
	texteEnvoi,
	enPlus = [],
	actions = [],
}) {
	const dialogue = el(
		"dialog",
		{ class: "dialogue", onclose: () => dialogue.remove() },
		el("h2", {}, titre),
		el("p", { class: "aide" }, aide),
		dessinerQr(lien),
		enPlus,
		el(
			"div",
			{ class: "boutons" },
			actions.map(({ libelle, faire }) =>
				el("button", { type: "button", onclick: faire }, libelle),
			),
			el(
				"button",
				{
					type: "button",
					onclick: () => envoyerLien(lien, titre, texteEnvoi),
				},
				"Envoyer le lien",
			),
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
	document.body.append(dialogue);
	dialogue.showModal();
	return dialogue;
}
