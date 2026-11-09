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
	ouvrirInvitation,
	ouvrirMesConnexions,
} from "../shared/connexion.js";
import { aujourdhui, versChampDate, versDate } from "../shared/dates.js";
import {
	$,
	afficherBandeau,
	el,
	masquerBandeau,
	notifier,
	remplacerContenu,
} from "../shared/dom.js";
import {
	brancherInstallation,
	chercherMiseAJour,
	enregistrerServiceWorker,
} from "../shared/pwa.js";
import { ouvrirSignalement } from "../shared/signalement.js";
import { ecrireStockage, lireStockage } from "../shared/stockage.js";

/** Relecture du planning tant que l'app est à l'écran (le planning peut changer à tout moment). */
const INTERVALLE_ACTUALISATION_MS = 2 * 60 * 1000;

const CLES = { planning: "calendrier.planning" };

// ---------------------------------------------------------------------------
// État de l'app
// ---------------------------------------------------------------------------

const app = {
	/** { jours, joursFeries } renvoyé par l'API (action planning), gardé pour le hors ligne. */
	planning: null,
	/** Le même, en texte : un planning inchangé n'est pas redessiné. */
	planningTexte: null,
	/** Jours du planning par date (« aaaa-mm-jj »), et nom des jours fériés. */
	parDate: new Map(),
	feries: new Map(),
	/** Premier jour du mois affiché. */
	mois: premierDuMois(aujourdhui()),
	/** Jour dont le détail est affiché (« aaaa-mm-jj »). */
	jourChoisi: versChampDate(aujourdhui()),
	/** Heure de la dernière lecture réussie. */
	misAJourLe: null,
	horsLigne: false,
	/** Version de l'API, renvoyée avec chaque réponse (affichée avec celle de l'app). */
	versionApi: null,
};

function premierDuMois(date) {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

// ---------------------------------------------------------------------------
// API (Web App Apps Script, projet calendrier)
// ---------------------------------------------------------------------------

const appelerApi = creerApi({
	url: window.API_URL,
	identifiants: () => ({ session: lireSession() }),
	surVersion: (version) => {
		app.versionApi = version;
		afficherVersions();
	},
});

function appliquerPlanning(planning) {
	app.misAJourLe = new Date();
	app.horsLigne = false;
	afficherBandeauHorsLigne();
	const texte = JSON.stringify(planning);
	if (texte !== app.planningTexte) {
		app.planning = planning;
		app.planningTexte = texte;
		ecrireStockage(CLES.planning, texte);
		indexerPlanning();
		rendrePlanning();
	} else {
		afficherMiseAJour();
	}
}

/** Lit le planning ; silencieux : sans notification hors ligne (actualisation automatique). */
async function actualiser({ silencieux = false } = {}) {
	if (!lireSession()) return;
	const bouton = $("#bouton-actualiser");
	bouton.classList.add("tourne");
	try {
		appliquerPlanning(
			await appelerApi(
				"planning",
				{},
				{ discret: silencieux && Boolean(app.planning) },
			),
		);
		afficherEcran("planning");
	} catch (erreur) {
		if (erreur instanceof ErreurReseau) {
			app.horsLigne = true;
			afficherBandeauHorsLigne();
			if (!silencieux) notifier(erreur.message, true);
		} else if (estSessionRefusee(erreur)) {
			// Session fermée ou compte bloqué : l'appareil l'oublie (pas de relecture en boucle).
			oublierConnexion();
			afficherConnexion(erreur.message);
		} else if (estAccesRefuse(erreur)) {
			afficherRefus(erreur.message);
		} else {
			notifier(erreur.message, true);
		}
	} finally {
		bouton.classList.remove("tourne");
	}
}

/** Planning gardé par l'appareil, affiché avant la réponse de l'API (et hors ligne). */
function lirePlanningGarde() {
	const texte = lireStockage(CLES.planning);
	if (!texte) return;
	try {
		app.planning = JSON.parse(texte);
		app.planningTexte = texte;
		indexerPlanning();
	} catch {
		ecrireStockage(CLES.planning, null);
	}
}

function oublierPlanning() {
	app.planning = null;
	app.planningTexte = null;
	app.parDate = new Map();
	app.feries = new Map();
	ecrireStockage(CLES.planning, null);
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function indexerPlanning() {
	app.parDate = new Map();
	for (const jour of app.planning?.jours ?? []) {
		const jours = app.parDate.get(jour.date) ?? [];
		jours.push(jour);
		app.parDate.set(jour.date, jours);
	}
	app.feries = new Map(
		(app.planning?.joursFeries ?? []).map(({ date, nom }) => [date, nom]),
	);
}

/** Code court d'un poste : « M4 - CHGR » → « M4 », « RH » → « RH ». */
const codeCourt = (titre) => titre.split(" - ")[0].trim() || titre;

/** Texte foncé sur une couleur claire (ex : Banane), blanc sinon. */
function texteSur(hex) {
	const [r, g, b] = [1, 3, 5].map((i) =>
		Number.parseInt(hex.slice(i, i + 2), 16),
	);
	return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#1d2a2c" : "#ffffff";
}

/** Pastille colorée d'un poste (couleur de l'agenda, sinon celle de l'app). */
function pastille(jour, texte) {
	const style = jour.couleur
		? `background:${jour.couleur};color:${texteSur(jour.couleur)}`
		: null;
	return el("span", { class: "pastille", style, title: jour.titre }, texte);
}

const formatMois = new Intl.DateTimeFormat("fr-FR", {
	month: "long",
	year: "numeric",
});
const formatJour = new Intl.DateTimeFormat("fr-FR", {
	weekday: "long",
	day: "numeric",
	month: "long",
});
const formatHeure = new Intl.DateTimeFormat("fr-FR", {
	hour: "2-digit",
	minute: "2-digit",
});

function caseJour(date) {
	const cle = versChampDate(date);
	const jours = app.parDate.get(cle) ?? [];
	const ferie = app.feries.get(cle);
	const classes = [
		"jour",
		cle === versChampDate(aujourdhui()) && "aujourdhui",
		cle === app.jourChoisi && "choisi",
		ferie && "ferie",
		date.getDay() === 0 || date.getDay() === 6 ? "week-end" : "",
	]
		.filter(Boolean)
		.join(" ");
	const description = [
		formatJour.format(date),
		ferie,
		...jours.map((jour) => jour.titre),
	]
		.filter(Boolean)
		.join(", ");
	return el(
		"button",
		{
			type: "button",
			class: classes,
			"aria-label": description,
			"aria-pressed": String(cle === app.jourChoisi),
			onclick: () => choisirJour(cle),
		},
		el("span", { class: "numero" }, date.getDate()),
		jours.map((jour) => pastille(jour, codeCourt(jour.titre))),
	);
}

function rendreGrille() {
	const { mois } = app;
	const titre = formatMois.format(mois);
	$("#titre-mois").textContent = titre.charAt(0).toUpperCase() + titre.slice(1);
	// Lundi en premier : cases vides avant le 1er.
	const decalage = (mois.getDay() + 6) % 7;
	const nbJours = new Date(
		mois.getFullYear(),
		mois.getMonth() + 1,
		0,
	).getDate();
	const cases = [];
	for (let i = 0; i < decalage; i++) {
		cases.push(el("span", { class: "jour vide-case", "aria-hidden": "true" }));
	}
	for (let jour = 1; jour <= nbJours; jour++) {
		cases.push(caseJour(new Date(mois.getFullYear(), mois.getMonth(), jour)));
	}
	remplacerContenu($("#grille"), cases);
}

function rendreDetail() {
	const date = versDate(app.jourChoisi);
	const jours = app.parDate.get(app.jourChoisi) ?? [];
	const ferie = app.feries.get(app.jourChoisi);
	const titre = formatJour.format(date);
	remplacerContenu(
		$("#detail-jour"),
		el("h3", {}, titre.charAt(0).toUpperCase() + titre.slice(1)),
		ferie && el("p", { class: "nom-ferie" }, `Férié : ${ferie}`),
		jours.length
			? jours.map((jour) =>
					el(
						"div",
						{ class: "poste" },
						pastille(jour, codeCourt(jour.titre)),
						el(
							"div",
							{},
							el("p", { class: "poste-titre" }, jour.titre),
							jour.explication &&
								el("p", { class: "poste-detail" }, jour.explication),
							jour.lieu && el("p", { class: "poste-detail" }, jour.lieu),
							jour.description &&
								el("p", { class: "poste-detail" }, jour.description),
						),
					),
				)
			: el("p", { class: "aide" }, "Rien au planning."),
	);
}

function afficherMiseAJour() {
	$("#mise-a-jour").textContent = app.misAJourLe
		? `Mis à jour à ${formatHeure.format(app.misAJourLe)}${app.horsLigne ? " (hors ligne)" : ""}`
		: "";
}

function rendrePlanning() {
	if (!app.planning) return;
	rendreGrille();
	rendreDetail();
	afficherMiseAJour();
}

function choisirJour(cle) {
	app.jourChoisi = cle;
	const date = versDate(cle);
	if (premierDuMois(date).getTime() !== app.mois.getTime()) {
		app.mois = premierDuMois(date);
	}
	rendrePlanning();
}

function changerMois(delta) {
	app.mois = new Date(app.mois.getFullYear(), app.mois.getMonth() + delta, 1);
	// Le détail suit le mois affiché : aujourd'hui s'il en fait partie, sinon le 1er.
	const auj = aujourdhui();
	app.jourChoisi = versChampDate(
		premierDuMois(auj).getTime() === app.mois.getTime() ? auj : app.mois,
	);
	rendrePlanning();
}

/** Glisser le doigt vers la gauche ou la droite sur la grille change de mois. */
function brancherGlissement() {
	let depart = null;
	$("#grille").addEventListener(
		"touchstart",
		(e) => {
			depart = e.touches[0];
		},
		{ passive: true },
	);
	$("#grille").addEventListener("touchend", (e) => {
		if (!depart) return;
		const fin = e.changedTouches[0];
		const dx = fin.clientX - depart.clientX;
		const dy = fin.clientY - depart.clientY;
		depart = null;
		if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) {
			changerMois(dx < 0 ? 1 : -1);
		}
	});
}

// ---------------------------------------------------------------------------
// Écrans et connexion (shared/connexion.js)
// ---------------------------------------------------------------------------

function afficherEcran(nom) {
	$("#ecran-connexion").hidden = nom !== "connexion";
	$("#ecran-refus").hidden = nom !== "refus";
	$("#ecran-planning").hidden = nom !== "planning";
	$("#bouton-actualiser").hidden = nom !== "planning";
	$("#bouton-menu").hidden = nom === "connexion";
	const compte = compteConnecte();
	$("#menu-compte").textContent = compte ? `Connecté : ${compte.prenom}` : "";
	if (nom === "planning") rendrePlanning();
}

/**
 * Écran de connexion : nouveau compte (prénom), ou appareil à connecter à un compte existant.
 * @param message Message à afficher (ex : session expirée)
 * @param invitation Code d'un lien de connexion (QR code d'un autre appareil), utilisé aussitôt
 */
function afficherConnexion(message = "", invitation = null) {
	oublierPlanning();
	afficherEcran("connexion");
	afficherFormulaireConnexion($("#connexion"), {
		nomApp: "Calendrier",
		message,
		invitation,
		surConnecte: () => actualiser(),
	});
}

/** Compte connecté qui n'a pas (encore) accès à calendrier. */
function afficherRefus(message) {
	oublierPlanning();
	$("#message-refus").textContent = message;
	afficherEcran("refus");
}

async function seDeconnecter() {
	fermerMenu();
	await deconnecterAppareil();
	afficherConnexion();
}

// ---------------------------------------------------------------------------
// Menu et bandeau
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

function afficherBandeauHorsLigne() {
	if (app.horsLigne && app.planning) {
		afficherBandeau("hors-ligne", "Hors ligne : dernier planning connu.", {
			libelle: "Réessayer",
			faire: () => actualiser(),
		});
	} else {
		masquerBandeau();
	}
	afficherMiseAJour();
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
	$("#bouton-actualiser").addEventListener("click", () => actualiser());
	$("#mois-precedent").addEventListener("click", () => changerMois(-1));
	$("#mois-suivant").addEventListener("click", () => changerMois(1));
	$("#bouton-aujourdhui").addEventListener("click", () =>
		choisirJour(versChampDate(aujourdhui())),
	);
	brancherGlissement();
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
	$("#menu-inviter").addEventListener("click", () => {
		fermerMenu();
		ouvrirInvitation("Calendrier");
	});
	$("#menu-autre-appareil").addEventListener("click", async () => {
		fermerMenu();
		try {
			await connecterUnAutreAppareil("Calendrier");
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	});
	$("#menu-connexions").addEventListener("click", async () => {
		fermerMenu();
		try {
			await ouvrirMesConnexions("Calendrier");
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	});
	$("#menu-installer").addEventListener("click", fermerMenu);
	brancherInstallation($("#menu-installer"), { connexion: true });
	$("#bouton-signalement").addEventListener("click", () => {
		fermerMenu();
		ouvrirSignalement({ app: "Calendrier", prenom: compteConnecte()?.prenom });
	});
	$("#menu-deconnecter").addEventListener("click", seDeconnecter);
	$("#bouton-deconnecter-refus").addEventListener("click", seDeconnecter);

	// Temps réel : relecture au retour sur l'app, au retour du réseau, et régulièrement tant
	// qu'elle est à l'écran.
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "visible") return;
		actualiser({ silencieux: true });
		chercherMiseAJour();
	});
	window.addEventListener("online", () => actualiser({ silencieux: true }));
	setInterval(() => {
		if (
			document.visibilityState === "visible" &&
			!$("#ecran-planning").hidden
		) {
			actualiser({ silencieux: true });
		}
	}, INTERVALLE_ACTUALISATION_MS);
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
	lirePlanningGarde();
	if (app.planning) afficherEcran("planning");
	actualiser({ silencieux: true }).then(() => {
		// Ni planning gardé ni réponse (hors ligne au premier lancement) : aucun écran affiché.
		const aucunEcran = [...document.querySelectorAll("main > section")].every(
			(ecran) => ecran.hidden,
		);
		if (aucunEcran) {
			afficherEcran("connexion");
			$("#connexion").textContent =
				"Impossible de charger le planning. Vérifie ta connexion, puis rouvre l'app.";
		}
	});
}

demarrer();
