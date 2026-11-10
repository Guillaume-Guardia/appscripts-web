import { creerApi, ErreurReseau } from "../shared/api.js";
import { brancherBalayage } from "../shared/balayage.js";
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
import {
	aujourdhui,
	pluriel,
	versChampDate,
	versDate,
} from "../shared/dates.js";
import {
	$,
	afficherBandeau,
	el,
	masquerBandeau,
	notifier,
	remplacerContenu,
} from "../shared/dom.js";
import { reduireImage } from "../shared/image.js";
import {
	brancherInstallation,
	chercherMiseAJour,
	enregistrerServiceWorker,
} from "../shared/pwa.js";
import { ouvrirSignalement } from "../shared/signalement.js";
import { ecrireStockage, lireStockage } from "../shared/stockage.js";

/** Relecture du planning tant que l'app est à l'écran (le planning peut changer à tout moment). */
const INTERVALLE_ACTUALISATION_MS = 2 * 60 * 1000;

/** Plus grand côté d'une photo envoyée : envoi plus rapide, largement assez net pour l'OCR. */
const TAILLE_MAX_PHOTO_PX = 3000;

const CLES = { planning: "calendrier.planning" };

// ---------------------------------------------------------------------------
// État de l'app
// ---------------------------------------------------------------------------

const app = {
	/** { jours, joursFeries, droitsConges } renvoyé par l'API (action planning), gardé pour le hors ligne. */
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
	/** Droit à congés ouvert dans la fenêtre de modification. */
	droitModifie: null,
	/** Vrai pendant l'import d'une photo : sa fenêtre reste ouverte jusqu'au récapitulatif. */
	importEnCours: false,
	/** Photo lue, renvoyée à la validation pour être sauvegardée avec le planning. */
	photoImport: null,
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

const formatJourRevue = new Intl.DateTimeFormat("fr-FR", {
	weekday: "short",
	day: "numeric",
});
const formatNombre = new Intl.NumberFormat("fr-FR");

const majuscule = (texte) => texte.charAt(0).toUpperCase() + texte.slice(1);

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
	$("#titre-mois").textContent = majuscule(formatMois.format(mois));
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
	remplacerContenu(
		$("#detail-jour"),
		el("h3", {}, majuscule(formatJour.format(date))),
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

/** Nombre de jours par titre, du plus fréquent au moins fréquent. */
function compterParTitre(jours) {
	const parTitre = new Map();
	for (const jour of jours) {
		const entree = parTitre.get(jour.titre) ?? { jour, nombre: 0 };
		entree.nombre++;
		parTitre.set(jour.titre, entree);
	}
	return [...parTitre.values()].sort((a, b) => b.nombre - a.nombre);
}

function blocRepartition(titre, jours) {
	return el(
		"section",
		{ class: "bloc-statistiques" },
		el("h3", {}, titre),
		jours.length
			? el(
					"ul",
					{ class: "repartition" },
					compterParTitre(jours).map(({ jour, nombre }) =>
						el(
							"li",
							{},
							pastille(jour, codeCourt(jour.titre)),
							el("span", {}, `${nombre} j`),
						),
					),
				)
			: el("p", { class: "aide" }, "Rien au planning."),
	);
}

function rangeeDroit(droit, joursAnnee) {
	const poses = joursAnnee.filter(
		(jour) => codeCourt(jour.titre) === codeCourt(droit.code),
	).length;
	const reste = droit.jours - poses;
	const solde =
		reste >= 0
			? `reste ${formatNombre.format(reste)}`
			: `dépassé de ${formatNombre.format(-reste)}`;
	return el(
		"li",
		{},
		el("span", { class: "droit-code" }, droit.code),
		el(
			"span",
			{ class: "droit-solde" },
			`${pluriel(poses, "posé")} sur ${formatNombre.format(droit.jours)}, ${solde}`,
		),
		droit.modifiable &&
			el(
				"button",
				{
					type: "button",
					class: "puce",
					"aria-label": `Modifier ${droit.code} ${droit.annee}`,
					onclick: () => ouvrirDroit(droit),
				},
				"Modifier",
			),
	);
}

function rendreStatistiques() {
	const { mois } = app;
	const annee = mois.getFullYear();
	const prefixeMois = versChampDate(mois).slice(0, 7);
	// Une ligne de la feuille peut être datée sans titre (jour pas encore rempli).
	const joursAnnee = app.planning.jours.filter(
		(jour) => jour.titre && jour.date.startsWith(`${annee}-`),
	);
	const droits = (app.planning.droitsConges ?? []).filter(
		(droit) => droit.annee === annee,
	);
	remplacerContenu(
		$("#statistiques"),
		blocRepartition(
			majuscule(formatMois.format(mois)),
			joursAnnee.filter((jour) => jour.date.startsWith(prefixeMois)),
		),
		blocRepartition(`Année ${annee}`, joursAnnee),
		el(
			"section",
			{ class: "bloc-statistiques" },
			el("h3", {}, "Congés à poser"),
			droits.length
				? el(
						"ul",
						{ class: "droits" },
						droits.map((droit) => rangeeDroit(droit, joursAnnee)),
					)
				: el(
						"p",
						{ class: "aide" },
						`Aucun droit renseigné pour ${annee} dans DroitsCongés.`,
					),
		),
	);
}

function ouvrirDroit(droit) {
	app.droitModifie = droit;
	const form = $("#form-droit");
	form.reset();
	form.querySelector(".erreur").textContent = "";
	$("#titre-dialogue-droit").textContent = `${droit.code} ${droit.annee}`;
	$("#champ-jours-droit").value = droit.jours;
	$("#dialogue-droit").showModal();
	$("#champ-jours-droit").focus();
}

async function enregistrerDroit(evenement) {
	evenement.preventDefault();
	const form = evenement.target;
	const erreur = form.querySelector(".erreur");
	const bouton = form.querySelector('button[type="submit"]');
	erreur.textContent = "";
	bouton.disabled = true;
	const { ligne, code, annee } = app.droitModifie;
	try {
		appliquerPlanning(
			await appelerApi("modifier-droit-conge", {
				droit: {
					ligne,
					code,
					annee,
					jours: Number($("#champ-jours-droit").value),
				},
			}),
		);
		$("#dialogue-droit").close();
		notifier(`${code} ${annee} enregistré.`);
	} catch (probleme) {
		erreur.textContent = probleme.message;
	} finally {
		bouton.disabled = false;
	}
}

/** Lien de téléchargement des mots lus par l'OCR ; ocr absent : pas de lien. */
function afficherLienOcr(ocr) {
	const zone = $("#lien-ocr");
	const ancien = zone.querySelector("a");
	if (ancien) URL.revokeObjectURL(ancien.href);
	remplacerContenu(
		zone,
		ocr &&
			el(
				"a",
				{
					href: URL.createObjectURL(
						new Blob([ocr.content], { type: "application/json" }),
					),
					download: ocr.name,
				},
				"Télécharger les mots lus sur la photo (pour analyse)",
			),
	);
}

function afficherRapportImport(lignes) {
	remplacerContenu(
		$("#rapport-import"),
		lignes.map((ligne) => el("li", {}, ligne)),
	);
}

/** Pendant un appel : fenêtre impossible à fermer, validation bloquée. */
function signalerImportEnCours(enCours) {
	app.importEnCours = enCours;
	$("#fermer-import").disabled = enCours;
	$("#valider-import").disabled = enCours;
}

function masquerRevue() {
	app.photoImport = null;
	$("#form-revue").hidden = true;
	$("#valider-import").hidden = true;
	$("#fermer-import").textContent = "Fermer";
	remplacerContenu($("#jours-revue"));
	$("#form-revue .erreur").textContent = "";
}

/** Un jour de la revue : sa date et la liste des codes, avec le code lu sur la photo présélectionné. */
function ligneRevue(jour, codes, cleAujourdhui) {
	const id = `revue-${jour.date}`;
	return el(
		"div",
		{ class: "ligne-revue" },
		el(
			"label",
			{ for: id },
			majuscule(formatJourRevue.format(versDate(jour.date))),
		),
		el(
			"select",
			{ id, "data-date": jour.date, disabled: jour.date < cleAujourdhui },
			el("option", { value: "", selected: !jour.titre }, "Non renseigné"),
			codes.map((code) =>
				el("option", { value: code, selected: code === jour.titre }, code),
			),
		),
	);
}

function afficherRevue({ jours, codes }) {
	const cleAujourdhui = versChampDate(aujourdhui());
	$("#titre-dialogue-import").textContent = majuscule(
		formatMois.format(versDate(jours[0].date)),
	);
	remplacerContenu(
		$("#jours-revue"),
		jours.map((jour) => ligneRevue(jour, codes, cleAujourdhui)),
	);
	$("#form-revue").hidden = false;
	$("#valider-import").hidden = false;
	$("#fermer-import").textContent = "Annuler";
}

async function importerPhoto() {
	const champ = $("#champ-photo");
	const fichier = champ.files[0];
	if (!fichier) return;
	// Vidé aussitôt : la même photo peut être choisie de nouveau.
	champ.value = "";
	const etat = $("#etat-import");
	masquerRevue();
	remplacerContenu($("#rapport-import"));
	afficherLienOcr(null);
	$("#titre-dialogue-import").textContent = "Import du planning";
	etat.textContent = "Préparation de la photo…";
	signalerImportEnCours(true);
	$("#dialogue-import").showModal();
	try {
		const photo = {
			base64: await reduireImage(fichier, TAILLE_MAX_PHOTO_PX),
			nom: `${fichier.name.replace(/\.[^.]+$/, "")}.jpg`,
		};
		etat.textContent = "Lecture du planning…";
		const { report, ocrFile, revue } = await appelerApi("lire-photo", {
			photo,
		});
		afficherRapportImport(report);
		afficherLienOcr(ocrFile);
		if (revue) {
			app.photoImport = photo;
			afficherRevue(revue);
			etat.textContent = "";
		} else {
			etat.textContent = "Photo illisible : rien n'a été importé.";
		}
	} catch (probleme) {
		etat.textContent = `Erreur : ${probleme.message}`;
	} finally {
		signalerImportEnCours(false);
	}
}

/** Bouton Valider : reporte les jours dans la feuille et crée les événements de l'agenda. */
async function validerImport(evenement) {
	evenement.preventDefault();
	const etat = $("#etat-import");
	const erreur = $("#form-revue .erreur");
	const jours = [...document.querySelectorAll("#jours-revue select")]
		.filter((choix) => choix.value)
		.map((choix) => ({ date: choix.dataset.date, titre: choix.value }));
	erreur.textContent = "";
	etat.textContent = "Création des événements…";
	signalerImportEnCours(true);
	try {
		const { report, planning } = await appelerApi("valider-import", {
			photo: app.photoImport,
			jours,
		});
		appliquerPlanning(planning);
		masquerRevue();
		afficherLienOcr(null);
		afficherRapportImport(report);
		etat.textContent = "Terminé.";
	} catch (probleme) {
		// La revue reste affichée : rien de ce qui a été corrigé n'est perdu.
		etat.textContent = "";
		erreur.textContent = probleme.message;
	} finally {
		signalerImportEnCours(false);
	}
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
	rendreStatistiques();
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
	// Balayer la grille vers la gauche ou la droite passe au mois suivant ou précédent
	brancherBalayage($("#grille"), (sens) => {
		changerMois(sens);
		return true;
	});
	$("#form-droit").addEventListener("submit", enregistrerDroit);
	$("#bouton-import").addEventListener("click", () =>
		$("#champ-photo").click(),
	);
	$("#champ-photo").addEventListener("change", importerPhoto);
	$("#form-revue").addEventListener("submit", validerImport);
	$("#dialogue-import").addEventListener("cancel", (e) => {
		if (app.importEnCours) e.preventDefault();
	});
	$("#dialogue-import").addEventListener("close", masquerRevue);
	for (const bouton of document.querySelectorAll("[data-fermer]")) {
		bouton.addEventListener("click", () => bouton.closest("dialog").close());
	}
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
