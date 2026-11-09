// Suivi de la location, pour le compte du propriétaire (droit « location » du projet droits). Les
// données personnelles des locataires ne sont pas gardées sur l'appareil.

import { creerApi, ErreurReseau } from "../shared/api.js";
import {
	afficherConnexion as afficherFormulaireConnexion,
	compteConnecte,
	connecterUnAutreAppareil,
	deconnecter as deconnecterAppareil,
	estAccesRefuse,
	estSessionRefusee,
	invitationDuLien,
	lireSession,
	oublierConnexion,
	ouvrirMesConnexions,
} from "../shared/connexion.js";
import { versDate } from "../shared/dates.js";
import { $, el, notifier, remplacerContenu } from "../shared/dom.js";
import {
	brancherInstallation,
	chercherMiseAJour,
	enregistrerServiceWorker,
} from "../shared/pwa.js";
import { ouvrirSignalement } from "../shared/signalement.js";

let versionApi = null;

const appelerApi = creerApi({
	url: window.API_URL,
	identifiants: () => ({ session: lireSession() }),
	surVersion: (version) => {
		versionApi = version;
		afficherVersions();
	},
});

function dateFr(texte) {
	return versDate(texte).toLocaleDateString("fr-FR");
}

function ligneSuivi(titre, detail, enAlerte = false) {
	return el(
		"div",
		{ class: "ligne-suivi" },
		el("strong", {}, titre),
		el("span", { class: enAlerte ? "alerte" : "aide" }, detail),
	);
}

function rendreListe(selecteur, lignes, messageVide) {
	remplacerContenu(
		$(selecteur),
		lignes.length > 0 ? lignes : el("p", { class: "aide vide" }, messageVide),
	);
}

function rendreSuivi({ avenants, chaudieres, locataires }) {
	rendreListe(
		"#liste-avenants",
		avenants.map(({ locataire, envoi, relance }) =>
			ligneSuivi(
				locataire,
				`Envoyé le ${dateFr(envoi)}${relance ? `, relancé le ${dateFr(relance)}` : ""}`,
			),
		),
		"Aucun avenant en attente de signature.",
	);
	rendreListe(
		"#liste-chaudieres",
		chaudieres.map(({ logement, echeance, enRetard }) =>
			ligneSuivi(
				logement,
				`${enRetard ? "En retard depuis le" : "À faire d'ici le"} ${dateFr(echeance)}`,
				enRetard,
			),
		),
		"Tous les entretiens sont à jour.",
	);
	rendreListe(
		"#liste-locataires",
		locataires.map(({ nom, statut, logement, fin }) =>
			ligneSuivi(
				nom,
				`${statut} · ${logement}${fin ? ` · jusqu'au ${dateFr(fin)}` : ""}`,
			),
		),
		"Aucun locataire en place.",
	);
}

async function actualiser() {
	const bouton = $("#bouton-actualiser");
	bouton.classList.add("tourne");
	try {
		rendreSuivi(await appelerApi("suivi"));
		afficherEcran("suivi");
	} catch (erreur) {
		if (estSessionRefusee(erreur)) {
			oublierConnexion();
			afficherConnexion(erreur.message);
		} else if (estAccesRefuse(erreur)) {
			afficherRefus(erreur.message);
		} else if ($("#ecran-suivi").hidden) {
			afficherEcran("connexion");
			$("#connexion").textContent =
				erreur instanceof ErreurReseau
					? "Impossible de charger le suivi. Vérifie ta connexion, puis rouvre l'app."
					: erreur.message;
		} else {
			notifier(erreur.message, true);
		}
	} finally {
		bouton.classList.remove("tourne");
	}
}

function afficherEcran(nom) {
	$("#ecran-connexion").hidden = nom !== "connexion";
	$("#ecran-refus").hidden = nom !== "refus";
	$("#ecran-suivi").hidden = nom !== "suivi";
	$("#bouton-actualiser").hidden = nom !== "suivi";
	$("#bouton-menu").hidden = nom === "connexion";
	const compte = compteConnecte();
	$("#menu-compte").textContent = compte ? `Connecté : ${compte.prenom}` : "";
}

function afficherConnexion(message = "", invitation = null) {
	afficherEcran("connexion");
	afficherFormulaireConnexion($("#connexion"), {
		nomApp: "Location",
		message,
		invitation,
		surConnecte: () => actualiser(),
	});
}

function afficherRefus(message) {
	$("#message-refus").textContent = message;
	afficherEcran("refus");
}

async function seDeconnecter() {
	fermerMenu();
	await deconnecterAppareil();
	afficherConnexion();
}

function fermerMenu() {
	$("#menu").hidden = true;
	$("#bouton-menu").setAttribute("aria-expanded", "false");
}

function basculerMenu() {
	const ouvert = $("#menu").hidden;
	$("#menu").hidden = !ouvert;
	$("#bouton-menu").setAttribute("aria-expanded", String(ouvert));
}

function afficherVersions() {
	const texte = `Version ${window.VERSION_APP ?? "?"}${versionApi ? ` · API ${versionApi}` : ""}`;
	for (const element of document.querySelectorAll(".version")) {
		element.textContent = texte;
	}
}

async function lancerDepuisMenu(action) {
	fermerMenu();
	try {
		await action("Location");
	} catch (erreur) {
		notifier(erreur.message, true);
	}
}

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
	$("#menu-autre-appareil").addEventListener("click", () =>
		lancerDepuisMenu(connecterUnAutreAppareil),
	);
	$("#menu-connexions").addEventListener("click", () =>
		lancerDepuisMenu(ouvrirMesConnexions),
	);
	$("#menu-installer").addEventListener("click", fermerMenu);
	brancherInstallation($("#menu-installer"), { connexion: true });
	$("#bouton-signalement").addEventListener("click", () => {
		fermerMenu();
		ouvrirSignalement({ app: "Location", prenom: compteConnecte()?.prenom });
	});
	$("#menu-deconnecter").addEventListener("click", seDeconnecter);
	$("#bouton-deconnecter-refus").addEventListener("click", seDeconnecter);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") chercherMiseAJour();
	});
}

function demarrer() {
	afficherVersions();
	brancherEvenements();
	enregistrerServiceWorker();
	// Lien de connexion d'un appareil (…#invitation=<code>), retiré aussitôt de l'adresse.
	const invitation = invitationDuLien(location.hash);
	history.replaceState(null, "", location.pathname);
	if (!window.API_URL) {
		afficherEcran("connexion");
		$("#connexion").textContent =
			"L'adresse de l'API n'est pas configurée (config.js).";
		return;
	}
	if (invitation || !lireSession()) {
		afficherConnexion("", invitation);
		return;
	}
	actualiser();
}

demarrer();
