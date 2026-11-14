// Profil du compte, le même dans toutes les apps (projet droits) : son prénom, son nom et sa photo. Le rond
// du bouton du menu (en-tête) et la carte du haut du menu montrent la photo, ou l'initiale du
// prénom ; la carte ouvre « Mon profil ». Le profil est gardé sur l'appareil (connexion.js) et mis
// à jour à chaque ouverture d'une app (action moi) : changé dans une app, il suit dans les autres.

import {
	compteConnecte,
	modifierProfil,
	photoDuCompte,
	surProfilChange,
} from "./connexion.js";
import { $, el, initiale, notifier } from "./dom.js";
import { reduireImageSous } from "./image.js";

/** Photo de profil : affichée en petit (en-tête, menu), elle reste légère. [côté en px, qualité] */
const REDUCTIONS_PROFIL = [
	[256, 0.8],
	[192, 0.7],
	[128, 0.6],
];
/** Une photo est gardée dans une cellule du classeur (limite vérifiée aussi par l'API). */
const LONGUEUR_MAX_PHOTO = 45000;

export const urlPhoto = (base64) => `data:image/jpeg;base64,${base64}`;

/** Remplit un rond (.avatar) : l'initiale du prénom, recouverte par la photo s'il y en a une. */
export function remplirAvatar(rond, prenom, photo) {
	rond.replaceChildren(
		initiale(prenom),
		...(photo ? [el("img", { alt: "", src: urlPhoto(photo) })] : []),
	);
}

/** Rond du bouton du menu, carte du haut du menu : photo ou initiale, et prénom du compte. */
export function afficherProfil() {
	const prenom = compteConnecte()?.prenom ?? "";
	const photo = photoDuCompte();
	for (const rond of document.querySelectorAll(
		"#bouton-menu .avatar, .menu-carte .avatar",
	)) {
		remplirAvatar(rond, prenom, photo);
	}
	const nom = $("#menu-compte");
	if (nom) nom.textContent = prenom;
}

/**
 * Choix de la photo de profil : le rond (sa photo, ou l'initiale de son prénom), une croix pour la
 * retirer et un crayon pour la changer (sur téléphone, le sélecteur propose aussi l'appareil photo).
 * @param photo La photo actuelle (JPEG en base64), ou null
 * @return `element` à afficher, et `photo()` : l'image réduite à envoyer, "" pour la retirer,
 * undefined si elle ne change pas
 */
export function choixPhotoProfil({ prenom, photo }) {
	let fichier = null;
	let retiree = false;
	const apercu = el("img", {
		alt: "",
		src: photo ? urlPhoto(photo) : null,
		hidden: !photo,
	});
	const pastille = (classe, libelle, symbole, onclick) =>
		el(
			"button",
			{
				type: "button",
				class: `pastille-photo ${classe}`,
				"aria-label": libelle,
				title: libelle,
				onclick,
			},
			symbole,
		);
	const retirer = pastille("retirer", "Retirer la photo", "×", () => {
		fichier = null;
		retiree = Boolean(photo);
		apercu.hidden = true;
		apercu.removeAttribute("src");
		retirer.hidden = true;
	});
	retirer.hidden = !photo;
	const galerie = el("input", {
		type: "file",
		accept: "image/*",
		hidden: true,
		onchange: (evenement) => {
			const choisi = evenement.target.files[0];
			if (!choisi) return;
			fichier = choisi;
			retiree = false;
			apercu.src = URL.createObjectURL(choisi);
			apercu.hidden = false;
			retirer.hidden = false;
			// Vidé aussitôt : la même image peut être choisie de nouveau.
			evenement.target.value = "";
		},
	});
	return {
		element: el(
			"div",
			{ class: "cadre-photo rond photo-profil" },
			el("span", { class: "initiale-profil" }, initiale(prenom)),
			apercu,
			retirer,
			pastille("modifier", "Changer la photo", "✎", () => galerie.click()),
			galerie,
		),
		photo: async () => {
			if (retiree) return "";
			if (!fichier) return undefined;
			return reduireImageSous(fichier, REDUCTIONS_PROFIL, LONGUEUR_MAX_PHOTO);
		},
	};
}

/**
 * Fenêtre « Mon profil » : la photo, le prénom et le nom du compte, les mêmes dans toutes les apps.
 * @param apresEnregistrement Appelée une fois le profil enregistré (ex : recharger les données)
 */
export function ouvrirProfil({ apresEnregistrement } = {}) {
	const compte = compteConnecte();
	if (!compte) return;
	const choix = choixPhotoProfil({
		prenom: compte.prenom,
		photo: photoDuCompte(),
	});
	const prenom = el("input", {
		id: "profil-prenom",
		required: true,
		autocomplete: "given-name",
		maxlength: "40",
		value: compte.prenom,
	});
	const nom = el("input", {
		id: "profil-nom",
		autocomplete: "family-name",
		maxlength: "60",
		value: compte.nom ?? "",
	});
	const erreur = el("p", { class: "erreur", role: "alert", hidden: true });
	const dialogue = el(
		"dialog",
		{ class: "dialogue", tabindex: "-1", onclose: () => dialogue.remove() },
		el("h2", {}, "Mon profil"),
		el(
			"form",
			{
				class: "formulaire",
				onsubmit: async (e) => {
					e.preventDefault();
					const bouton = e.submitter ?? e.target.querySelector("[type=submit]");
					bouton.disabled = true;
					erreur.hidden = true;
					try {
						await modifierProfil({
							prenom: prenom.value,
							nom: nom.value,
							photo: await choix.photo(),
						});
						dialogue.close();
						notifier("Profil enregistré.");
						apresEnregistrement?.();
					} catch (probleme) {
						erreur.textContent = probleme.message;
						erreur.hidden = false;
					} finally {
						bouton.disabled = false;
					}
				},
			},
			el("div", { class: "profil-photo" }, choix.element),
			el("label", { for: "profil-prenom" }, "Ton prénom"),
			prenom,
			el("label", { for: "profil-nom" }, "Ton nom (facultatif)"),
			nom,
			erreur,
			el(
				"div",
				{ class: "boutons" },
				el(
					"button",
					{ type: "button", onclick: () => dialogue.close() },
					"Annuler",
				),
				el(
					"button",
					{ type: "submit", class: "bouton-principal" },
					"Enregistrer",
				),
			),
		),
	);
	document.body.append(dialogue);
	dialogue.showModal();
	// Le focus sur la fenêtre, pas sur la croix qui retire la photo (premier bouton).
	dialogue.focus();
}

/**
 * Branche le profil sur la page : rond du bouton du menu et carte du menu (mis à jour quand le
 * profil change), la carte (#menu-profil) fermant le menu et ouvrant « Mon profil ».
 * @param apresEnregistrement Voir ouvrirProfil
 */
export function brancherProfil({ apresEnregistrement } = {}) {
	afficherProfil();
	surProfilChange(afficherProfil);
	$("#menu-profil")?.addEventListener("click", () => {
		$("#menu").hidden = true;
		$("#bouton-menu")?.setAttribute("aria-expanded", "false");
		ouvrirProfil({ apresEnregistrement });
	});
}
