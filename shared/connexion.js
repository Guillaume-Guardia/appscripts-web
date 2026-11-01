// Connexion aux apps : un compte par personne (projet droits), créé avec son prénom. Un autre
// appareil se connecte au même compte avec le QR code (ou le lien) affiché par un appareil déjà
// connecté. La clé de session est gardée par le navigateur, dans le stockage que partagent les apps
// de l'origine (une seule connexion pour toutes, sauf les apps installées sur iPhone, qui ont
// chacune leur stockage), et envoyée à chaque API, qui retrouve le compte dans le classeur Droits.

import { creerApi } from "./api.js";
import { el, remplacerContenu } from "./dom.js";
import { ouvrirQr } from "./qr.js";
import { ouvrirSignalement } from "./signalement.js";
import { ecrireStockage, lireStockage, lireStockageJson } from "./stockage.js";

const CLES = { session: "appscripts.session", compte: "appscripts.compte" };

/** Clé de session de l'appareil, ou null s'il n'est pas connecté. */
export const lireSession = () => lireStockage(CLES.session);

/** Compte connecté ({ id, prenom }), tel qu'à la dernière connexion, ou null. */
export const compteConnecte = () => lireStockageJson(CLES.compte);

function garderConnexion({ session, compte }) {
	ecrireStockage(CLES.session, session);
	ecrireStockage(CLES.compte, JSON.stringify(compte));
}

/** Oublie la connexion de l'appareil (sans prévenir l'API). */
export function oublierConnexion() {
	ecrireStockage(CLES.session, null);
	ecrireStockage(CLES.compte, null);
}

/** L'API a refusé la session (fermée, compte bloqué) : il faut reconnecter l'appareil. */
export const estSessionRefusee = (erreur) =>
	/Session expirée/.test(erreur?.message ?? "");

/** API du projet droits (adresse dans shared/config.js). */
const appelerDroits = creerApi({
	url: window.API_DROITS,
	identifiants: () => ({ session: lireSession() }),
});

/** Déconnecte l'appareil : sa session est fermée (si le réseau le permet) puis oubliée. */
export async function deconnecter() {
	try {
		await appelerDroits("deconnecter");
	} catch {
		// Hors ligne : la session reste ouverte côté serveur, mais l'appareil l'oublie.
	}
	oublierConnexion();
}

/**
 * Ferme toutes les sessions du compte, y compris celle de l'appareil (appareil perdu). Les apps
 * les refusent au plus tard 10 minutes après.
 */
export async function deconnecterPartout() {
	await appelerDroits("deconnecter-partout");
	oublierConnexion();
}

/** Change le prénom du compte connecté. @return Le compte à jour */
export async function modifierPrenom(prenom) {
	const compte = await appelerDroits("modifier-profil", { prenom });
	ecrireStockage(CLES.compte, JSON.stringify(compte));
	return compte;
}

/** Code d'invitation d'un lien de connexion (…#invitation=<code>), ou null. */
export function invitationDuLien(texte) {
	const trouve = /#invitation=([0-9a-f]+)/i.exec(String(texte));
	return trouve ? trouve[1] : null;
}

/** Lien de connexion de l'app pour une invitation (le code après « # » n'est pas envoyé au site). */
const lienInvitation = (code) =>
	`${location.origin}${location.pathname}#invitation=${code}`;

/**
 * Affiche le QR code qui connecte un autre appareil au compte (valable 15 minutes, une fois).
 * @param nomApp Nom de l'app, pour le message qui accompagne le lien envoyé
 * @throws Si l'API refuse (hors ligne, session fermée)
 */
export async function connecterUnAutreAppareil(nomApp) {
	const code = await appelerDroits("inviter-appareil");
	ouvrirQr({
		titre: "Connecter un autre appareil",
		aide: "À scanner avec l'appareil photo de l'autre téléphone : l'app s'y ouvre, connectée à ton compte. Valable 15 minutes, une seule fois. Ne le montre qu'à toi-même : il donne accès à ton compte.",
		lien: lienInvitation(code),
		texteEnvoi: `Pour connecter cet appareil à ton compte ${nomApp} :`,
	});
}

/** Description de l'appareil, pour s'y retrouver dans l'onglet Sessions. */
function appareil(nomApp) {
	const plateforme =
		navigator.userAgentData?.platform || navigator.platform || "appareil";
	return `${nomApp} · ${plateforme}`;
}

/**
 * Affiche la connexion dans `conteneur` : nouveau compte (prénom), ou appareil à connecter à un
 * compte existant (lien d'un QR code collé).
 * @param nomApp Nom de l'app, pour décrire l'appareil
 * @param surConnecte Appelée avec le compte, une fois connecté
 * @param message Message à afficher (ex : session expirée)
 * @param invitation Code d'un lien de connexion ouvert sur l'appareil (invitationDuLien) : utilisé
 * aussitôt
 */
export function afficherConnexion(
	conteneur,
	{ nomApp, surConnecte, message = "", invitation = null },
) {
	const erreur = el("p", { class: "erreur", role: "alert" }, message);

	/** Lance une connexion : bouton désactivé et erreur effacée pendant l'appel. */
	async function connecter(evenement, action, parametres) {
		evenement?.preventDefault();
		const bouton = evenement?.submitter;
		if (bouton) bouton.disabled = true;
		erreur.textContent = "";
		try {
			const connexion = await appelerDroits(action, {
				...parametres,
				appareil: appareil(nomApp),
			});
			garderConnexion(connexion);
			surConnecte(connexion.compte);
		} catch (e) {
			erreur.textContent = e.message;
		} finally {
			if (bouton) bouton.disabled = false;
		}
	}

	const prenom = el("input", {
		id: "connexion-prenom",
		required: true,
		autocomplete: "given-name",
		maxlength: "40",
	});
	const lien = el("input", {
		id: "connexion-lien",
		type: "url",
		inputmode: "url",
		required: true,
		autocomplete: "off",
		placeholder: "https://…#invitation=…",
	});
	remplacerContenu(
		conteneur,
		el(
			"form",
			{
				class: "carte formulaire",
				onsubmit: (e) => connecter(e, "creer-compte", { prenom: prenom.value }),
			},
			el("label", { for: "connexion-prenom" }, "Ton prénom"),
			prenom,
			el(
				"button",
				{ type: "submit", class: "bouton-principal" },
				"Créer mon compte",
			),
		),
		el(
			"form",
			{
				class: "carte formulaire",
				onsubmit: (e) => {
					const code = invitationDuLien(lien.value);
					if (!code) {
						e.preventDefault();
						erreur.textContent =
							"Ce n'est pas un lien de connexion : il contient « #invitation= ».";
						return;
					}
					connecter(e, "utiliser-invitation", { invitation: code });
				},
			},
			el(
				"p",
				{ class: "aide" },
				"Déjà un compte sur un autre appareil ? Sur cet appareil-là : menu → « Connecter un autre appareil », puis scanne le QR code avec l'appareil photo. Ou colle ici le lien reçu :",
			),
			el("label", { for: "connexion-lien" }, "Lien de connexion"),
			lien,
			el("button", { type: "submit" }, "Connecter cet appareil"),
		),
		erreur,
		// Pas encore de compte, ou la connexion ne marche pas : le dire quand même.
		el(
			"button",
			{
				type: "button",
				class: "lien-signalement",
				onclick: () => ouvrirSignalement({ app: nomApp }),
			},
			"Une suggestion ou un bug ?",
		),
	);
	if (!window.API_DROITS) {
		erreur.textContent =
			"L'adresse de l'API de connexion n'est pas configurée (shared/config.js).";
	} else if (invitation) {
		erreur.textContent = "Connexion…";
		connecter(null, "utiliser-invitation", { invitation });
	}
}
