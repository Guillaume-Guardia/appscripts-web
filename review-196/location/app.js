// Suivi de la location, pour le compte du propriétaire (droit « location » du projet droits). Les
// données personnelles des locataires ne sont pas gardées sur l'appareil. L'adresse choisit l'écran :
// suivi (sans ancre), #etats-des-lieux, #etat-des-lieux/<id> (saisie), #signer-etat-des-lieux/<id>.

import { creerApi, ErreurReseau } from "../shared/api.js";
import {
	afficherConnexion as afficherFormulaireConnexion,
	brancherBiometrie,
	compteConnecte,
	connecterUnAutreAppareil,
	deconnecter as deconnecterAppareil,
	estAccesRefuse,
	estSessionRefusee,
	invitationDuLien,
	lireSession,
	oublierConnexion,
} from "../shared/connexion.js";
import { aujourdhui, joursEntre, pluriel, versDate } from "../shared/dates.js";
import { $, el, notifier, remplacerContenu } from "../shared/dom.js";
import {
	brancherInstallation,
	chercherMiseAJour,
	enregistrerServiceWorker,
} from "../shared/pwa.js";
import { ouvrirSignalement } from "../shared/signalement.js";
import {
	initialiserEtatsDesLieux,
	ouvrirListeEtatsDesLieux,
	ouvrirSaisieEtatDesLieux,
	ouvrirSignatureEtatDesLieux,
	prechargerListeEtatsDesLieux,
	quitterSaisieEtatDesLieux,
} from "./etat-des-lieux.js";

const STATUT_LITIGE = "Litige";
const ECRANS = [
	"connexion",
	"refus",
	"suivi",
	"etats-des-lieux",
	"saisie-edl",
	"signature-edl",
];
const EUROS = new Intl.NumberFormat("fr-FR", {
	style: "currency",
	currency: "EUR",
});

let versionApi = null;
// Le dernier suivi chargé, en mémoire seulement (pas sur l'appareil) : affiché tout de suite au retour
let dernierSuivi = null;
let ecranAffiche = null;

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

/** Une ligne d'une liste ; enAlerte colore son premier détail. Les détails vides sont ignorés. */
function ligneSuivi(titre, details, enAlerte = false) {
	return el(
		"div",
		{ class: "ligne-suivi" },
		el("strong", {}, titre),
		details
			.filter(Boolean)
			.map((detail, i) =>
				el("span", { class: enAlerte && i === 0 ? "alerte" : "aide" }, detail),
			),
	);
}

function tuile(valeur, libelle, enAlerte = false) {
	return el(
		"div",
		{ class: `carte tuile${enAlerte ? " alerte" : ""}` },
		el("strong", {}, valeur),
		el("span", { class: "aide" }, libelle),
	);
}

function rendreResume({ resume, avenants, chaudieres }) {
	const enRetard = chaudieres.filter((c) => c.enRetard).length;
	remplacerContenu(
		$("#resume"),
		tuile(EUROS.format(resume.mensuel), "Loyers et charges par mois"),
		tuile(resume.locataires, "Locataires"),
		tuile(resume.enAttenteLoyer, "Loyers en attente"),
		tuile(resume.litiges, "Litiges", resume.litiges > 0),
		tuile(avenants.length, "Avenants à signer"),
		tuile(enRetard, "Chaudières en retard", enRetard > 0),
	);
}

function detailEcheance(echeance, enRetard) {
	const ecart = Math.abs(joursEntre(aujourdhui(), versDate(echeance)));
	const jours = pluriel(ecart, "jour");
	return enRetard
		? `En retard depuis le ${dateFr(echeance)} (${jours})`
		: `À faire d'ici le ${dateFr(echeance)} (${ecart === 0 ? "aujourd'hui" : `dans ${jours}`})`;
}

function detailBail({ debut, fin }) {
	if (debut && fin) return `Bail du ${dateFr(debut)} au ${dateFr(fin)}`;
	if (debut) return `Bail depuis le ${dateFr(debut)}`;
	return fin ? `Bail jusqu'au ${dateFr(fin)}` : "";
}

function rendreListe(selecteur, lignes, messageVide) {
	remplacerContenu(
		$(selecteur),
		lignes.length > 0 ? lignes : el("p", { class: "aide vide" }, messageVide),
	);
}

function rendreSuivi(suivi) {
	const { avenants, chaudieres, locataires } = suivi;
	rendreResume(suivi);
	rendreListe(
		"#liste-avenants",
		avenants.map(({ locataire, type, logement, envoi, relance }) =>
			ligneSuivi(locataire, [
				`${type} · ${logement}`,
				envoi && `Envoyé le ${dateFr(envoi)}`,
				relance && `Relancé le ${dateFr(relance)}`,
			]),
		),
		"Aucun avenant en attente de signature.",
	);
	rendreListe(
		"#liste-chaudieres",
		chaudieres.map(({ logement, echeance, enRetard, occupants }) =>
			ligneSuivi(
				logement,
				[
					detailEcheance(echeance, enRetard),
					occupants.length > 0
						? `Occupé par ${occupants.join(", ")}`
						: "Sans locataire : aucun rappel envoyé",
				],
				enRetard,
			),
		),
		"Tous les entretiens sont à jour.",
	);
	rendreListe(
		"#liste-locataires",
		locataires.map((locataire) =>
			ligneSuivi(
				locataire.nom,
				[
					locataire.statut,
					locataire.logement,
					`Loyer ${EUROS.format(locataire.loyer)} + charges ${EUROS.format(locataire.charges)} · caution ${EUROS.format(locataire.caution)}`,
					detailBail(locataire),
					locataire.derniereQuittance
						? `Dernière quittance le ${dateFr(locataire.derniereQuittance)}`
						: "Aucune quittance",
				],
				locataire.statut === STATUT_LITIGE,
			),
		),
		"Aucun locataire en place.",
	);
}

/** La route de l'adresse : son nom et l'Id qui la suit (ex : « #etat-des-lieux/<id> »). */
function routeActuelle() {
	const [nom, id] = location.hash.slice(1).split("/");
	return { nom, id: id ? decodeURIComponent(id) : "" };
}

/** Affiche l'écran de l'adresse ; une saisie d'état des lieux quittée s'enregistre en arrière-plan. */
async function actualiser() {
	const bouton = $("#bouton-actualiser");
	bouton.classList.add("tourne");
	const { nom, id } = routeActuelle();
	try {
		// La saisie quittée s'enregistre en arrière-plan : l'écran suivant ne l'attend pas
		if (nom !== "etat-des-lieux") quitterSaisieEtatDesLieux();
		if (nom === "etats-des-lieux") {
			await ouvrirListeEtatsDesLieux();
		} else if (nom === "etat-des-lieux" && id) {
			await ouvrirSaisieEtatDesLieux(id);
		} else if (nom === "signer-etat-des-lieux" && id) {
			await ouvrirSignatureEtatDesLieux(id);
		} else {
			definirTitre("Location");
			await ouvrirSuivi();
			prechargerListeEtatsDesLieux();
		}
	} catch (erreur) {
		if (estSessionRefusee(erreur)) {
			oublierConnexion();
			afficherConnexion(erreur.message);
		} else if (estAccesRefuse(erreur)) {
			afficherRefus(erreur.message);
		} else if (!ecranAffiche || ecranAffiche === "connexion") {
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

/**
 * L'écran de suivi : le dernier chargé s'affiche tout de suite (retour depuis les états des lieux),
 * puis se met à jour sans barre de chargement.
 */
async function ouvrirSuivi() {
	const dejaCharge = dernierSuivi !== null;
	if (dejaCharge) {
		rendreSuivi(dernierSuivi);
		afficherEcran("suivi");
	}
	try {
		dernierSuivi = await appelerApi("suivi", {}, { discret: dejaCharge });
	} catch (erreur) {
		if (!dejaCharge) throw erreur;
		return;
	}
	// Pas de retour au suivi si l'on en est parti pendant la mise à jour
	if (routeActuelle().nom) return;
	rendreSuivi(dernierSuivi);
	afficherEcran("suivi");
}

function definirTitre(titre) {
	$("#titre").textContent = titre;
}

/** Remonte d'un écran : saisie → liste des états des lieux → suivi. */
function revenir() {
	const { nom, id } = routeActuelle();
	if (nom === "signer-etat-des-lieux") location.hash = `#etat-des-lieux/${id}`;
	else if (nom === "etat-des-lieux") location.hash = "#etats-des-lieux";
	else location.hash = "";
}

function afficherEcran(nom) {
	ecranAffiche = nom;
	for (const ecran of ECRANS) {
		$(`#ecran-${ecran}`).hidden = ecran !== nom;
	}
	$("#bouton-actualiser").hidden = !["suivi", "etats-des-lieux"].includes(nom);
	$("#bouton-retour").hidden = ["connexion", "refus", "suivi"].includes(nom);
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
	$("#bouton-retour").addEventListener("click", revenir);
	window.addEventListener("hashchange", () => {
		if (lireSession()) actualiser();
	});
	initialiserEtatsDesLieux({
		appelerApi,
		afficher: afficherEcran,
		titre: definirTitre,
	});
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
	brancherBiometrie($("#menu-biometrie"), "Location");
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
	// Lien de connexion d'un appareil (…#invitation=<code>), retiré aussitôt de l'adresse. Les
	// autres ancres (états des lieux) restent : elles choisissent l'écran.
	const invitation = invitationDuLien(location.hash);
	if (invitation) history.replaceState(null, "", location.pathname);
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
