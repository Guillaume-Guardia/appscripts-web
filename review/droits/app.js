import { creerApi, ErreurReseau } from "../shared/api.js";
import {
	afficherConnexion as afficherFormulaireConnexion,
	compteConnecte,
	connecterUnAutreAppareil,
	deconnecter as deconnecterAppareil,
	estSessionRefusee,
	invitationDuLien,
	lireSession,
} from "../shared/connexion.js";
import { $, el, notifier, remplacerContenu } from "../shared/dom.js";
import { chercherMiseAJour, enregistrerServiceWorker } from "../shared/pwa.js";
import { ouvrirSignalement } from "../shared/signalement.js";

// ---------------------------------------------------------------------------
// État de l'app
// ---------------------------------------------------------------------------

const app = {
	/** { apps, comptes } renvoyé par l'API (action administration). */
	administration: null,
	occupe: false,
	/** Version de l'API, renvoyée avec chaque réponse (affichée avec celle de l'app). */
	versionApi: null,
};

/** Compte connecté sans accès à l'app droits (MESSAGE_ACCES_REFUSE du projet shared). */
const estAccesRefuse = (erreur) =>
	/Pas encore accès/.test(erreur?.message ?? "");

// ---------------------------------------------------------------------------
// API (Web App Apps Script, projet droits)
// ---------------------------------------------------------------------------

const appelerApi = creerApi({
	url: window.API_DROITS,
	identifiants: () => ({ session: lireSession() }),
	surVersion: (version) => {
		app.versionApi = version;
		afficherVersions();
	},
});

/** Erreur d'un appel : retour à la connexion, écran de refus, ou notification. */
function traiterErreur(erreur) {
	if (estSessionRefusee(erreur)) afficherConnexion(erreur.message);
	else if (estAccesRefuse(erreur)) afficherRefus(erreur.message);
	else notifier(erreur.message, true);
}

async function actualiser() {
	const bouton = $("#bouton-actualiser");
	bouton.classList.add("tourne");
	try {
		app.administration = await appelerApi("administration");
		afficherEcran("comptes");
	} catch (erreur) {
		traiterErreur(erreur);
	} finally {
		bouton.classList.remove("tourne");
	}
}

/** Lance une modification ; l'API renvoie la liste à jour. */
async function modifier(action, parametres, messageSucces) {
	if (app.occupe) return;
	app.occupe = true;
	try {
		app.administration = await appelerApi(action, parametres);
		notifier(messageSucces);
	} catch (erreur) {
		if (erreur instanceof ErreurReseau) notifier(erreur.message, true);
		else traiterErreur(erreur);
	} finally {
		app.occupe = false;
		// Liste à jour, ou remise des cases comme avant en cas d'échec.
		if (app.administration) rendreComptes();
	}
}

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

function casesDesApps(compte, apps, moi) {
	return apps.map(({ cle, nom }) =>
		el(
			"label",
			{ class: "case" },
			el("input", {
				type: "checkbox",
				checked: compte.apps.includes(cle),
				// « * » et son propre compte ne se changent que dans l'onglet Droits.
				disabled: compte.toutes || moi,
				onchange: (e) =>
					modifier(
						"changer-droit",
						{ compteId: compte.id, app: cle, acces: e.target.checked },
						`${nom} ${e.target.checked ? "ouvert" : "fermé"} à ${compte.prenom}.`,
					),
			}),
			nom,
		),
	);
}

function deconnecterSesAppareils(compte) {
	if (!confirm(`Déconnecter tous les appareils de ${compte.prenom} ?`)) return;
	modifier(
		"deconnecter-compte",
		{ compteId: compte.id },
		`Appareils de ${compte.prenom} déconnectés.`,
	);
}

function basculerBlocage(compte) {
	if (
		!compte.bloque &&
		!confirm(`Bloquer ${compte.prenom} sur toutes les apps ?`)
	) {
		return;
	}
	modifier(
		"changer-blocage",
		{ compteId: compte.id, bloque: !compte.bloque },
		`${compte.prenom} ${compte.bloque ? "débloqué" : "bloqué"}.`,
	);
}

function carteCompte(compte, apps) {
	const moi = compte.id === compteConnecte()?.id;
	const detail = [
		`Appareils connectés : ${compte.appareils}`,
		compte.bloque ? "bloqué" : "",
		compte.toutes ? "toutes les apps (onglet Droits)" : "",
		moi ? "toi" : "",
	]
		.filter(Boolean)
		.join(" · ");
	return el(
		"article",
		{ class: `carte carte-compte${compte.bloque ? " bloque" : ""}` },
		el("h3", {}, compte.prenom || "Sans prénom"),
		el("p", { class: "detail" }, detail),
		casesDesApps(compte, apps, moi),
		!moi &&
			el(
				"div",
				{ class: "boutons" },
				el(
					"button",
					{
						type: "button",
						disabled: compte.appareils === 0,
						onclick: () => deconnecterSesAppareils(compte),
					},
					"Déconnecter ses appareils",
				),
				el(
					"button",
					{
						type: "button",
						class: compte.bloque ? "" : "danger",
						onclick: () => basculerBlocage(compte),
					},
					compte.bloque ? "Débloquer" : "Bloquer",
				),
			),
	);
}

function rendreComptes() {
	const { apps, comptes } = app.administration;
	remplacerContenu(
		$("#liste-comptes"),
		comptes.length
			? comptes.map((compte) => carteCompte(compte, apps))
			: el("p", { class: "vide" }, "Aucun compte."),
	);
}

// ---------------------------------------------------------------------------
// Écrans et connexion (shared/connexion.js)
// ---------------------------------------------------------------------------

function afficherEcran(nom) {
	$("#ecran-connexion").hidden = nom !== "connexion";
	$("#ecran-refus").hidden = nom !== "refus";
	$("#ecran-comptes").hidden = nom !== "comptes";
	$("#bouton-actualiser").hidden = nom !== "comptes";
	$("#bouton-menu").hidden = nom === "connexion";
	const compte = compteConnecte();
	$("#menu-compte").textContent = compte ? `Connecté : ${compte.prenom}` : "";
	if (nom === "comptes") rendreComptes();
}

/**
 * Écran de connexion : nouveau compte (prénom), ou appareil à connecter à un compte existant.
 * @param message Message à afficher (ex : session expirée)
 * @param invitation Code d'un lien de connexion (QR code d'un autre appareil), utilisé aussitôt
 */
function afficherConnexion(message = "", invitation = null) {
	app.administration = null;
	afficherEcran("connexion");
	afficherFormulaireConnexion($("#connexion"), {
		nomApp: "Droits",
		message,
		invitation,
		surConnecte: () => actualiser(),
	});
}

/** Compte connecté qui ne gère pas les droits. */
function afficherRefus(message) {
	app.administration = null;
	$("#message-refus").textContent = message;
	afficherEcran("refus");
}

async function seDeconnecter() {
	fermerMenu();
	await deconnecterAppareil();
	afficherConnexion();
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function fermerMenu() {
	$("#menu").hidden = true;
	$("#bouton-menu").setAttribute("aria-expanded", "false");
}

function basculerMenu() {
	const ouvert = $("#menu").hidden;
	$("#menu").hidden = !ouvert;
	$("#bouton-menu").setAttribute("aria-expanded", String(ouvert));
}

/** Versions de l'app et de l'API, en bas du menu et de l'écran de connexion. */
function afficherVersions() {
	const texte = `Version ${window.VERSION_APP ?? "?"}${app.versionApi ? ` · API ${app.versionApi}` : ""}`;
	for (const element of document.querySelectorAll(".version")) {
		element.textContent = texte;
	}
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

function brancherEvenements() {
	$("#bouton-actualiser").addEventListener("click", actualiser);
	$("#bouton-menu").addEventListener("click", (e) => {
		e.stopPropagation();
		basculerMenu();
	});
	document.addEventListener("click", (e) => {
		if (!$("#menu").hidden && !$("#menu").contains(e.target)) fermerMenu();
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") fermerMenu();
	});
	$("#menu-autre-appareil").addEventListener("click", async () => {
		fermerMenu();
		try {
			await connecterUnAutreAppareil("Droits");
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	});
	$("#menu-signalement").addEventListener("click", () => {
		fermerMenu();
		ouvrirSignalement({ app: "Droits", prenom: compteConnecte()?.prenom });
	});
	$("#menu-maj").addEventListener("click", () => {
		fermerMenu();
		chercherMiseAJour();
	});
	$("#menu-deconnecter").addEventListener("click", seDeconnecter);
	$("#bouton-deconnecter-refus").addEventListener("click", seDeconnecter);
}

function demarrer() {
	afficherVersions();
	brancherEvenements();
	enregistrerServiceWorker();
	// Lien de connexion d'un appareil (…#invitation=<code>), retiré aussitôt de l'adresse.
	const invitation = invitationDuLien(location.hash);
	history.replaceState(null, "", location.pathname);
	if (!window.API_DROITS) {
		afficherEcran("connexion");
		$("#connexion").textContent =
			"L'adresse de l'API n'est pas configurée (shared/config.js).";
		return;
	}
	if (invitation || !lireSession()) {
		afficherConnexion("", invitation);
		return;
	}
	actualiser();
}

demarrer();
