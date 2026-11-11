// Suivi des sessions de poker, en consultation : l'API (projet poktrack) lit le classeur que le
// programme PokTrack du PC remplit. Le filtre par pseudo choisit une des vues de l'état.

import { creerApi, ErreurReseau } from "../shared/api.js";
import { brancherBalayage, voisin } from "../shared/balayage.js";
import {
	afficherConnexion as afficherFormulaireConnexion,
	brancherBiometrie,
	brancherBoutonPortail,
	compteConnecte,
	connecterUnAutreAppareil,
	deconnecter as deconnecterAppareil,
	estAccesRefuse,
	estSessionRefusee,
	invitationDuLien,
	lireSession,
	oublierConnexion,
} from "../shared/connexion.js";
import {
	$,
	el,
	notifier,
	remplacerContenu,
	remplirCarteMenu,
} from "../shared/dom.js";
import {
	brancherInstallation,
	chercherMiseAJour,
	enregistrerServiceWorker,
} from "../shared/pwa.js";
import { ouvrirSignalement } from "../shared/signalement.js";
import {
	ecrireStockage,
	lireStockage,
	lireStockageJson,
} from "../shared/stockage.js";
import { tracerGraphe } from "./graphe.js";

const ECRANS = ["connexion", "refus", "app"];
const ONGLETS = ["bord", "sessions", "tournois"];
const MESURES = { cumul: "Gain cumulé", bankroll: "Bankroll" };
const NOMS_TYPES = { mtt: "MTT", expresso: "Expresso" };
/** Clé de la vue de tous les pseudos réunis (voir l'API). */
const TOUS = "";
const CLES = {
	etat: "poktrack.etat",
	pseudo: "poktrack.pseudo",
	onglet: "poktrack.onglet",
	mesure: "poktrack.mesure",
};

const app = {
	/** { moi, pseudos, vues, tournois, statistiquesTournois } renvoyé par l'API. */
	etat: null,
	pseudo: lireStockage(CLES.pseudo) ?? TOUS,
	onglet: ONGLETS.includes(lireStockage(CLES.onglet))
		? lireStockage(CLES.onglet)
		: "bord",
	mesure:
		lireStockage(CLES.mesure) in MESURES ? lireStockage(CLES.mesure) : "cumul",
	versionApi: null,
};

// État en cache : seulement celui du compte connecté sur l'appareil.
const etatEnCache = lireStockageJson(CLES.etat);
if (lireSession() && etatEnCache?.compteId === compteConnecte()?.id) {
	app.etat = etatEnCache.etat;
}

const appelerApi = creerApi({
	url: window.API_URL,
	identifiants: () => ({ session: lireSession() }),
	surVersion: (version) => {
		app.versionApi = version;
		afficherVersions();
	},
});

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

const EUROS = new Intl.NumberFormat("fr-FR", {
	style: "currency",
	currency: "EUR",
});
const EUROS_RONDS = new Intl.NumberFormat("fr-FR", {
	style: "currency",
	currency: "EUR",
	maximumFractionDigits: 0,
});
const POURCENT = new Intl.NumberFormat("fr-FR", {
	style: "percent",
	maximumFractionDigits: 2,
});
const NOMBRE = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
/** Luck : deux décimales, et pas de « -0 » pour un écart infime. */
const LUCK = new Intl.NumberFormat("fr-FR", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
	signDisplay: "exceptZero",
});
const DATE_HEURE = new Intl.DateTimeFormat("fr-FR", {
	dateStyle: "short",
	timeStyle: "short",
});
const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" });
const MOIS = new Intl.DateTimeFormat("fr-FR", {
	month: "long",
	year: "numeric",
});

const euros = (montant) => EUROS.format(montant);
/** Montant avec son signe : le sens d'un gain ne repose pas sur la seule couleur. */
const eurosSignes = (montant) =>
	`${montant > 0 ? "+" : ""}${EUROS.format(montant)}`;
const pourcent = (part) => POURCENT.format(part);

/** « 314 h 20 » ou « 17 min ». */
function duree(secondes) {
	const minutes = Math.round(secondes / 60);
	const heures = Math.floor(minutes / 60);
	return heures > 0
		? `${heures} h ${String(minutes % 60).padStart(2, "0")}`
		: `${minutes} min`;
}

/** « octobre 2026 » d'un mois « 2026-10 ». */
function nomMois(mois) {
	const [annee, numero] = mois.split("-").map(Number);
	return MOIS.format(new Date(annee, numero - 1, 1));
}

/** Élément d'un montant signé, vert ou rouge selon son sens. */
function montantSigne(montant, balise = "span") {
	const sens = montant > 0 ? " gain" : montant < 0 ? " perte" : "";
	return el(balise, { class: `montant${sens}` }, eurosSignes(montant));
}

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------

const vueActuelle = () => app.etat.vues[app.pseudo] ?? app.etat.vues[TOUS];

function tuile(libelle, valeur, detail) {
	return el(
		"div",
		{ class: "carte tuile" },
		el("span", { class: "aide" }, libelle),
		valeur instanceof Node ? valeur : el("strong", {}, valeur),
		detail && el("span", { class: "aide" }, detail),
	);
}

function rendreTuiles(vue) {
	const resultat = vue.mtt.resume.resultat + vue.expresso.resume.resultat;
	const dureeSec = vue.mtt.resume.dureeSec + vue.expresso.resume.dureeSec;
	const sessions = vue.mtt.resume.sessions + vue.expresso.resume.sessions;
	remplacerContenu(
		$("#tuiles"),
		tuile(
			"Bankroll",
			vue.bankroll === null ? "–" : euros(vue.bankroll),
			"après la dernière session",
		),
		tuile("Gain total", montantSigne(resultat, "strong"), "MTT et Expresso"),
		tuile("Temps de jeu", duree(dureeSec), `${sessions} sessions`),
	);
}

function rendreGraphe(vue) {
	for (const bouton of document.querySelectorAll("[data-mesure]")) {
		bouton.setAttribute(
			"aria-pressed",
			String(bouton.dataset.mesure === app.mesure),
		);
	}
	$("#titre-graphe").textContent =
		app.mesure === "cumul"
			? "Gain cumulé, session après session"
			: "Bankroll après chaque session";
	const points = vue.courbe.flatMap((point) => {
		const valeur = point[app.mesure];
		return valeur === null ? [] : [{ date: new Date(point.date), valeur }];
	});
	tracerGraphe(
		$("#graphe"),
		points,
		{
			valeur: app.mesure === "cumul" ? eurosSignes : euros,
			date: (date) => DATE.format(date),
			axe: (valeur) => EUROS_RONDS.format(valeur),
		},
		{ avecZero: app.mesure === "cumul" },
	);
}

function indicateur(libelle, valeur, detail) {
	return el(
		"div",
		{ class: "indicateur" },
		el("span", { class: "aide" }, libelle),
		valeur instanceof Node ? valeur : el("strong", {}, valeur),
		detail && el("span", { class: "aide" }, detail),
	);
}

/** Les indicateurs de l'ancien onglet Dashboard, pour un type de partie, puis mois par mois. */
function rendreIndicateurs(selecteur, { resume, parMois }, type) {
	if (resume.sessions === 0) {
		remplacerContenu(
			$(selecteur),
			el("p", { class: "carte aide vide" }, "Aucune session."),
		);
		return;
	}
	const estMtt = type === "mtt";
	remplacerContenu(
		$(selecteur),
		el(
			"div",
			{ class: "carte indicateurs" },
			indicateur(
				"Durée",
				duree(resume.dureeSec),
				`${duree(resume.dureeMoyenneSec)} par session`,
			),
			indicateur(
				"Sessions",
				resume.sessions,
				`${pourcent(resume.partPositives)} positives`,
			),
			indicateur(
				estMtt ? "Tournois" : "Expressos",
				resume.parties,
				`${NOMBRE.format(resume.partiesParSession)} par session`,
			),
			estMtt &&
				indicateur(
					"Tables finales",
					resume.tablesFinales,
					pourcent(resume.partTablesFinales),
				),
			estMtt &&
				indicateur("Podiums", resume.podiums, pourcent(resume.partPodiums)),
			indicateur("Buy-in moyen", euros(resume.abi)),
			indicateur("Gain", montantSigne(resume.resultat, "strong")),
			indicateur("Gain par heure", montantSigne(resume.netParHeure, "strong")),
			indicateur("ROI", pourcent(resume.roi)),
			indicateur("ITM", pourcent(resume.itm)),
		),
		el(
			"details",
			{ class: "carte par-mois" },
			el("summary", {}, "Mois par mois"),
			tableau(
				["Mois", "Sessions", estMtt ? "Tournois" : "Expressos", "Gain", "ROI"],
				parMois.map((mois) => [
					nomMois(mois.mois),
					mois.sessions,
					mois.parties,
					montantSigne(mois.resultat),
					pourcent(mois.roi),
				]),
			),
		),
	);
}

/** Tableau ; la première colonne est du texte, les autres des nombres alignés à droite. */
function tableau(enTetes, lignes) {
	return el(
		"div",
		{ class: "tableau", "data-sans-balayage": true },
		el(
			"table",
			{},
			el(
				"thead",
				{},
				el(
					"tr",
					{},
					enTetes.map((texte) => el("th", {}, texte)),
				),
			),
			el(
				"tbody",
				{},
				lignes.map((ligne) =>
					el(
						"tr",
						{},
						ligne.map((cellule) => el("td", {}, cellule)),
					),
				),
			),
		),
	);
}

function rendreBord() {
	const vue = vueActuelle();
	rendreTuiles(vue);
	rendreGraphe(vue);
	rendreIndicateurs("#indicateurs-mtt", vue.mtt, "mtt");
	rendreIndicateurs("#indicateurs-expresso", vue.expresso, "expresso");
}

// ---------------------------------------------------------------------------
// Sessions et tournois
// ---------------------------------------------------------------------------

function ligne(titre, montant, details) {
	return el(
		"div",
		{ class: "ligne" },
		el(
			"div",
			{ class: "ligne-titre" },
			el("strong", {}, titre),
			montantSigne(montant),
		),
		details
			.filter(Boolean)
			.map((detail) => el("span", { class: "aide" }, detail)),
	);
}

function rendreListe(selecteur, lignes, messageVide) {
	remplacerContenu(
		$(selecteur),
		lignes.length > 0 ? lignes : el("p", { class: "aide vide" }, messageVide),
	);
}

function rendreSessions() {
	rendreListe(
		"#liste-sessions",
		vueActuelle().sessions.map((session) =>
			ligne(
				`${NOMS_TYPES[session.type]} · ${DATE_HEURE.format(new Date(session.debut))}`,
				session.resultat,
				[
					[
						`${session.parties} ${session.type === "mtt" ? "tournois" : "Expressos"}`,
						session.reentries > 0 &&
							`dont ${session.reentries} re-entr${session.reentries > 1 ? "ies" : "y"}`,
						`${euros(session.cout)} de buy-ins`,
						duree(session.dureeSec),
					]
						.filter(Boolean)
						.join(" · "),
					[
						session.bankroll !== null && `Bankroll ${euros(session.bankroll)}`,
						session.luck !== null && `Luck ${LUCK.format(session.luck)}`,
						app.pseudo === TOUS && session.pseudo,
					]
						.filter(Boolean)
						.join(" · "),
					session.commentaire !== "by PokTrack" && session.commentaire,
				],
			),
		),
		"Aucune session.",
	);
}

function rendreParBuyin() {
	remplacerContenu(
		$("#par-buyin"),
		Object.entries(NOMS_TYPES).map(([type, nom]) => {
			const { resume, parBuyin } = app.etat.statistiquesTournois[type];
			if (resume.tournois === 0) return null;
			return el(
				"details",
				{ class: "carte par-mois", open: type === "mtt" },
				el(
					"summary",
					{},
					`${nom} par buy-in · ${resume.tournois} tournois · ${eurosSignes(resume.resultat)}`,
				),
				tableau(
					["Buy-in", "Tournois", "Payés", "Victoires", "Gain", "ROI"],
					parBuyin.map((buyin) => [
						euros(buyin.buyin),
						buyin.tournois,
						buyin.payes,
						buyin.victoires,
						montantSigne(buyin.resultat),
						pourcent(buyin.roi),
					]),
				),
			);
		}),
	);
}

function rendreTournois() {
	rendreParBuyin();
	rendreListe(
		"#liste-tournois",
		app.etat.tournois.map((tournoi) =>
			ligne(tournoi.nom || NOMS_TYPES[tournoi.type], tournoi.resultat, [
				[
					DATE_HEURE.format(new Date(tournoi.debut)),
					`buy-in ${euros(tournoi.buyin)}`,
					tournoi.entrees > 1 && `${tournoi.entrees} entrées`,
				]
					.filter(Boolean)
					.join(" · "),
				[
					tournoi.place !== null &&
						`Place ${tournoi.place}${tournoi.joueurs ? ` sur ${tournoi.joueurs}` : ""}`,
					tournoi.dureeSec > 0 && duree(tournoi.dureeSec),
					tournoi.luck !== null && `Luck ${LUCK.format(tournoi.luck)}`,
				]
					.filter(Boolean)
					.join(" · "),
			]),
		),
		"Aucun tournoi : les onglets Tournois et Expressos sont vides.",
	);
}

// ---------------------------------------------------------------------------
// Écrans, onglets, filtre
// ---------------------------------------------------------------------------

function rendreChoixPseudo() {
	const { pseudos } = app.etat;
	if (!pseudos.includes(app.pseudo)) app.pseudo = TOUS;
	remplacerContenu(
		$("#choix-pseudo"),
		el("option", { value: TOUS }, "Tous les pseudos"),
		pseudos.map((pseudo) => el("option", { value: pseudo }, pseudo)),
	);
	$("#choix-pseudo").value = app.pseudo;
}

function rendre() {
	if (!app.etat) return;
	rendreChoixPseudo();
	for (const onglet of ONGLETS) {
		$(`#onglet-${onglet}`).hidden = onglet !== app.onglet;
	}
	for (const bouton of document.querySelectorAll("[data-onglet]")) {
		bouton.setAttribute(
			"aria-selected",
			String(bouton.dataset.onglet === app.onglet),
		);
	}
	// Le filtre par pseudo ne s'applique pas aux tournois (voir la note de l'onglet).
	$(".filtres").hidden = app.onglet === "tournois";
	if (app.onglet === "bord") rendreBord();
	else if (app.onglet === "sessions") rendreSessions();
	else rendreTournois();
	afficherEcran("app");
}

function choisirOnglet(onglet) {
	app.onglet = onglet;
	ecrireStockage(CLES.onglet, onglet);
	rendre();
}

/** Passe à l'onglet voisin (-1 : précédent, 1 : suivant) ; faux s'il n'y en a pas. */
function choisirOngletVoisin(sens) {
	const onglet = voisin(ONGLETS, app.onglet, sens);
	if (onglet) choisirOnglet(onglet);
	return Boolean(onglet);
}

function afficherEcran(nom) {
	for (const ecran of ECRANS) {
		$(`#ecran-${ecran}`).hidden = ecran !== nom;
	}
	$("#bouton-actualiser").hidden = nom !== "app";
	$("#bouton-menu").hidden = nom === "connexion";
	const compte = compteConnecte();
	remplirCarteMenu(compte?.prenom ?? "");
}

/** Charge l'état ; celui gardé sur l'appareil reste affiché pendant ce temps, et hors ligne. */
async function actualiser() {
	const bouton = $("#bouton-actualiser");
	bouton.classList.add("tourne");
	const dejaAffiche = Boolean(app.etat);
	if (dejaAffiche) rendre();
	try {
		app.etat = await appelerApi("etat", {}, { discret: dejaAffiche });
		ecrireStockage(
			CLES.etat,
			JSON.stringify({ compteId: compteConnecte()?.id, etat: app.etat }),
		);
		rendre();
	} catch (erreur) {
		if (estSessionRefusee(erreur)) {
			oublierConnexion();
			app.etat = null;
			afficherConnexion(erreur.message);
		} else if (estAccesRefuse(erreur)) {
			app.etat = null;
			afficherRefus(erreur.message);
		} else if (dejaAffiche) {
			notifier(
				erreur instanceof ErreurReseau
					? "Hors ligne : les derniers chiffres chargés restent affichés."
					: erreur.message,
				true,
			);
		} else {
			afficherEcran("connexion");
			$("#connexion").textContent =
				erreur instanceof ErreurReseau
					? "Impossible de charger les données. Vérifie ta connexion, puis rouvre l'app."
					: erreur.message;
		}
	} finally {
		bouton.classList.remove("tourne");
	}
}

function afficherConnexion(message = "", invitation = null) {
	afficherEcran("connexion");
	afficherFormulaireConnexion($("#connexion"), {
		nomApp: "PokTrack",
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
	app.etat = null;
	ecrireStockage(CLES.etat, "");
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
	const texte = `Version ${window.VERSION_APP ?? "?"}${app.versionApi ? ` · API ${app.versionApi}` : ""}`;
	for (const element of document.querySelectorAll(".version")) {
		element.textContent = texte;
	}
}

async function lancerDepuisMenu(action) {
	fermerMenu();
	try {
		await action("PokTrack");
	} catch (erreur) {
		notifier(erreur.message, true);
	}
}

function brancherEvenements() {
	$("#bouton-actualiser").addEventListener("click", actualiser);
	$("#choix-pseudo").addEventListener("change", (e) => {
		app.pseudo = e.target.value;
		ecrireStockage(CLES.pseudo, app.pseudo);
		rendre();
	});
	for (const bouton of document.querySelectorAll("[data-onglet]")) {
		bouton.addEventListener("click", () =>
			choisirOnglet(bouton.dataset.onglet),
		);
	}
	for (const bouton of document.querySelectorAll("[data-mesure]")) {
		bouton.addEventListener("click", () => {
			app.mesure = bouton.dataset.mesure;
			ecrireStockage(CLES.mesure, app.mesure);
			rendreGraphe(vueActuelle());
		});
	}
	// Balayer l'écran vers la gauche ou la droite passe à l'onglet suivant ou précédent
	brancherBalayage($("#ecran-app"), choisirOngletVoisin, {
		anime: () => $(`#onglet-${app.onglet}`),
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
	brancherBiometrie($("#menu-biometrie"), "PokTrack");
	$("#menu-installer").addEventListener("click", fermerMenu);
	brancherInstallation($("#menu-installer"), { connexion: true });
	$("#bouton-signalement").addEventListener("click", () => {
		fermerMenu();
		ouvrirSignalement({ app: "PokTrack", prenom: compteConnecte()?.prenom });
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
	brancherBoutonPortail();
	// Lien de connexion d'un appareil (…#invitation=<code>), retiré aussitôt de l'adresse.
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
