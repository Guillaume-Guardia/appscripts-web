import { brancherBalayage, voisin } from "../shared/balayage.js";
import {
	brancherBiometrie,
	compteConnecte,
	connecterUnAutreAppareil,
	exigerAccesApp,
} from "../shared/connexion.js";
import { versChampDate, versDate } from "../shared/dates.js";
import { $, el, notifier, remplacerContenu } from "../shared/dom.js";
import { afficherProfil, brancherProfil } from "../shared/profil.js";
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
import {
	age,
	caps,
	dateDeFin,
	formaterDuree,
	formaterParJour,
	joursCalendrier,
	nombre,
	pourcent,
	restants,
	semaines,
	tempsActivite,
	vieRestante,
} from "./calcul.js";

// ---------------------------------------------------------------------------
// État : réglages et compteurs gardés sur l'appareil, rien n'est envoyé.
// ---------------------------------------------------------------------------

const CLES = { reglages: "compteurs.reglages", onglet: "compteurs.onglet" };
const ONGLETS = ["vie", "quotidien", "restants", "dates"];

const ACTIVITES_DEPART = [
	{ nom: "Toilettes", minutes: 20, debut: 0, fin: null },
	{ nom: "Sommeil", minutes: 480, debut: 0, fin: null },
	{ nom: "Téléphone", minutes: 180, debut: 12, fin: null },
	{ nom: "Douche", minutes: 10, debut: 3, fin: null },
	{ nom: "Repas", minutes: 90, debut: 0, fin: null },
	{ nom: "Transport", minutes: 60, debut: 18, fin: 64 },
];

const REGLAGES_DEPART = { naissance: null, esperance: 82, retraite: 64 };

function identifiant() {
	return (
		globalThis.crypto?.randomUUID?.() ??
		`${Date.now()}-${Math.random().toString(36).slice(2)}`
	);
}

function lireReglages() {
	const lus = lireStockageJson(CLES.reglages) ?? {};
	return {
		...REGLAGES_DEPART,
		...lus,
		activites: Array.isArray(lus.activites)
			? lus.activites
			: ACTIVITES_DEPART.map((activite) => ({
					...activite,
					id: identifiant(),
				})),
		dates: Array.isArray(lus.dates) ? lus.dates : [],
	};
}

const reglages = lireReglages();
const etat = {
	onglet: ONGLETS.includes(lireStockage(CLES.onglet))
		? lireStockage(CLES.onglet)
		: "vie",
	/** Activité ou date ouverte dans son dialogue (null : ajout). */
	enEdition: null,
	minuterie: null,
	reglagesProposes: false,
};

function enregistrer() {
	ecrireStockage(CLES.reglages, JSON.stringify(reglages));
}

const naissance = () =>
	reglages.naissance ? versDate(reglages.naissance) : null;

// ---------------------------------------------------------------------------
// Mise en forme
// ---------------------------------------------------------------------------

const FORMAT_DATE = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	year: "numeric",
});
const formaterDate = (date) => FORMAT_DATE.format(date);
const accorder = (n, un, plusieurs) => (Math.abs(n) > 1 ? plusieurs : un);
const jours = (n) => `${nombre(n)} ${accorder(n, "jour", "jours")}`;

/**
 * Écart à une date, à partir du nombre de jours : « dans 12 jours », « depuis 3 jours » ou
 * « aujourd'hui », et dessous la durée en mois et années au-delà de 2 mois.
 */
function ecart(nJours) {
	const principal =
		nJours === 0
			? "aujourd'hui"
			: `${nJours > 0 ? "dans" : "depuis"} ${jours(Math.abs(nJours))}`;
	return el(
		"span",
		{ class: "ecart" },
		el("span", {}, principal),
		Math.abs(nJours) >= 60 &&
			el("span", { class: "aide" }, formaterDuree(Math.abs(nJours) * 86400000)),
	);
}

function texteAges({ debut, fin }) {
	if (fin) return `de ${debut} à ${fin} ans`;
	return debut > 0 ? `dès ${debut} ans` : "toute la vie";
}

// ---------------------------------------------------------------------------
// Onglet Vie
// ---------------------------------------------------------------------------

function rendreRebours(maintenant = new Date()) {
	const date = naissance();
	if (!date) return;
	const vie = vieRestante(date, reglages.esperance, maintenant);
	$("#titre-rebours").textContent = vie.depasse
		? `Temps bonus depuis tes ${reglages.esperance} ans`
		: "Il te reste";
	remplacerContenu(
		$("#rebours"),
		[
			[vie.annees, "an", "ans"],
			[vie.jours, "jour", "jours"],
			[vie.heures, "heure", "heures"],
			[vie.minutes, "minute", "minutes"],
			[vie.secondes, "seconde", "secondes"],
		].map(([valeur, un, plusieurs]) =>
			el(
				"div",
				{ class: "tuile-rebours" },
				el("span", { class: "valeur" }, String(valeur)),
				el("span", { class: "unite" }, accorder(valeur, un, plusieurs)),
			),
		),
	);
	$("#fin-de-vie").textContent = vie.depasse
		? `Tes ${reglages.esperance} ans sont passés le ${formaterDate(vie.fin)} : chaque jour est un bonus.`
		: `Jusqu'à tes ${reglages.esperance} ans, le ${formaterDate(vie.fin)} : ${jours(vie.joursTotal)}, ${nombre(Math.floor(vie.totalMs / 1000))} secondes.`;
	$("#barre-vecue").style.width = `${vie.partVecue * 100}%`;
	$("#part-vecue").textContent =
		`${pourcent(vie.partVecue, 2)} de ta vie (${age(date, maintenant)} ans sur ${reglages.esperance})`;
}

function couleur(variable) {
	return getComputedStyle(document.documentElement)
		.getPropertyValue(variable)
		.trim();
}

/** Grille de la vie en semaines : une ligne par année, une case par semaine. */
function dessinerGrille() {
	const date = naissance();
	const canvas = $("#grille");
	const largeur = canvas.clientWidth;
	if (!date || !largeur) return;
	const grille = semaines(date, reglages.esperance, new Date());
	const colonnes = 52;
	const ecartCases = largeur < 420 ? 1 : 2;
	const cote = (largeur - ecartCases * (colonnes - 1)) / colonnes;
	/** Espace de plus toutes les 10 années, pour lire les décennies. */
	const ecartDecennie = Math.max(3, cote * 0.8);
	const y = (ligne) =>
		ligne * (cote + ecartCases) + Math.floor(ligne / 10) * ecartDecennie;
	const hauteur = y(grille.lignes - 1) + cote;
	const ratio = window.devicePixelRatio || 1;
	canvas.width = Math.round(largeur * ratio);
	canvas.height = Math.round(hauteur * ratio);
	canvas.style.height = `${hauteur}px`;
	const contexte = canvas.getContext("2d");
	contexte.scale(ratio, ratio);
	const couleurs = {
		vecue: couleur("--grille-vecue"),
		actuelle: couleur("--grille-actuelle"),
		aVivre: couleur("--grille-a-vivre"),
		retraite: couleur("--grille-retraite"),
	};
	for (let ligne = 0; ligne < grille.lignes; ligne++) {
		for (let colonne = 0; colonne < colonnes; colonne++) {
			let teinte = couleurs.aVivre;
			if (
				ligne < grille.ageAnnees ||
				(ligne === grille.ageAnnees && colonne < grille.semaine)
			) {
				teinte = couleurs.vecue;
			} else if (ligne === grille.ageAnnees && colonne === grille.semaine) {
				teinte = couleurs.actuelle;
			} else if (ligne >= reglages.retraite) {
				teinte = couleurs.retraite;
			}
			contexte.fillStyle = teinte;
			contexte.fillRect(colonne * (cote + ecartCases), y(ligne), cote, cote);
		}
	}
	const texte = `${nombre(grille.vecues)} semaines vécues sur ${nombre(grille.total)}. Une ligne par année, une case par semaine.`;
	$("#texte-grille").textContent = texte;
	canvas.setAttribute("aria-label", texte);
}

// ---------------------------------------------------------------------------
// Onglet Quotidien
// ---------------------------------------------------------------------------

function rendreQuotidien(maintenant) {
	const date = naissance();
	const calculs = reglages.activites.map((activite) => ({
		activite,
		temps: tempsActivite(
			{
				minutesParJour: activite.minutes,
				ageDebut: activite.debut,
				ageFin: activite.fin,
			},
			date,
			reglages.esperance,
			maintenant,
		),
	}));
	remplacerContenu(
		$("#activites"),
		calculs.length
			? calculs.map(({ activite, temps }) =>
					el(
						"button",
						{
							type: "button",
							class: "carte element",
							"data-activite": activite.id,
						},
						el(
							"span",
							{ class: "element-titre" },
							el("strong", {}, activite.nom),
							el(
								"span",
								{ class: "aide" },
								`${formaterParJour(activite.minutes)} par jour, ${texteAges(activite)} · ${pourcent(temps.part)} de ta vie`,
							),
						),
						el(
							"span",
							{ class: "mesures" },
							mesure("Déjà", formaterDuree(temps.passeMs)),
							mesure("Encore", formaterDuree(temps.restantMs)),
							mesure("En tout", formaterDuree(temps.totalMs)),
						),
					),
				)
			: el("p", { class: "aide vide" }, "Aucune activité : ajoutes-en une."),
	);
	const fin = dateDeFin(date, reglages.esperance);
	const resteVie = Math.max(0, fin - maintenant);
	const resteActivites = calculs.reduce(
		(s, { temps }) => s + temps.restantMs,
		0,
	);
	const part = calculs.reduce((s, { temps }) => s + temps.part, 0);
	$("#temps-libre").textContent = formaterDuree(
		Math.max(0, resteVie - resteActivites),
	);
	$("#bilan-activites").textContent = calculs.length
		? `Il te reste ${formaterDuree(resteVie)} à vivre, dont ${formaterDuree(resteActivites)} pour ces ${calculs.length} activités, qui prennent ${pourcent(Math.min(1, part))} de ta vie.`
		: "Tout le temps qui reste est libre.";
}

function mesure(libelle, valeur) {
	return el(
		"span",
		{ class: "mesure" },
		el("span", { class: "aide" }, libelle),
		el("span", { class: "valeur-mesure" }, valeur),
	);
}

// ---------------------------------------------------------------------------
// Onglet À vivre
// ---------------------------------------------------------------------------

function rendreRestants(maintenant) {
	const date = naissance();
	const r = restants(date, reglages.esperance, reglages.retraite, maintenant);
	const tuile = (valeur, titre, aide) =>
		el(
			"div",
			{ class: "carte tuile" },
			el("span", { class: "chiffre" }, nombre(valeur)),
			el("strong", {}, titre),
			el("span", { class: "aide" }, aide),
		);
	const vecus = (n) => `déjà vécus : ${nombre(n)}`;
	const retraite =
		r.retraite.jours > 0
			? tuile(
					r.retraite.jours,
					accorder(
						r.retraite.jours,
						"jour avant la retraite",
						"jours avant la retraite",
					),
					`à ${reglages.retraite} ans, le ${formaterDate(r.retraite.date)}`,
				)
			: tuile(
					-r.retraite.jours,
					accorder(-r.retraite.jours, "jour de retraite", "jours de retraite"),
					`depuis le ${formaterDate(r.retraite.date)}`,
				);
	remplacerContenu(
		$("#restants"),
		tuile(
			r.jours,
			accorder(r.jours, "jour", "jours"),
			`jusqu'à tes ${reglages.esperance} ans`,
		),
		tuile(
			r.weekends.restants,
			accorder(r.weekends.restants, "week-end", "week-ends"),
			vecus(r.weekends.vecus),
		),
		tuile(
			r.etes.restants,
			accorder(r.etes.restants, "été", "étés"),
			vecus(r.etes.vecus),
		),
		tuile(
			r.noels.restants,
			accorder(r.noels.restants, "Noël", "Noëls"),
			vecus(r.noels.vecus),
		),
		tuile(
			r.anniversaires.restants,
			accorder(r.anniversaires.restants, "anniversaire", "anniversaires"),
			vecus(r.anniversaires.vecus),
		),
		retraite,
	);
}

// ---------------------------------------------------------------------------
// Onglet Dates
// ---------------------------------------------------------------------------

function rendreDates(maintenant) {
	const mesDates = [...reglages.dates].sort((a, b) =>
		a.date.localeCompare(b.date),
	);
	remplacerContenu(
		$("#mes-dates"),
		mesDates.length
			? mesDates.map((entree) => {
					const nJours = joursCalendrier(maintenant, versDate(entree.date));
					return el(
						"button",
						{
							type: "button",
							class: `carte element date${nJours < 0 ? " passee" : ""}`,
							"data-date": entree.id,
						},
						el(
							"span",
							{ class: "element-titre" },
							el("strong", {}, entree.titre),
							el(
								"span",
								{ class: "aide" },
								formaterDate(versDate(entree.date)),
							),
						),
						ecart(nJours),
					);
				})
			: el(
					"p",
					{ class: "aide vide" },
					"Vacances, rencontre, arrêt du tabac : ajoute une date pour la voir en compte à rebours, ou en « depuis ».",
				),
	);
	const date = naissance();
	$("#titre-caps").hidden = !date;
	$("#caps").hidden = !date;
	if (!date) return;
	const liste = caps(date, reglages.esperance, maintenant);
	const prochain = liste.find((cap) => !cap.passe);
	remplacerContenu(
		$("#caps"),
		liste.map((cap) =>
			el(
				"div",
				{
					class: `carte element cap${cap.passe ? " passe" : ""}${cap === prochain ? " prochain" : ""}`,
				},
				el(
					"span",
					{ class: "element-titre" },
					el("strong", {}, cap.nom),
					el("span", { class: "aide" }, formaterDate(cap.date)),
				),
				cap.passe
					? el(
							"span",
							{ class: "ecart" },
							`il y a ${formaterDuree(maintenant - cap.date)}`,
						)
					: ecart(joursCalendrier(maintenant, cap.date)),
			),
		),
	);
}

// ---------------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------------

function rendre() {
	const maintenant = new Date();
	const date = naissance();
	for (const onglet of ONGLETS) {
		$(`#onglet-${onglet}`).hidden =
			onglet !== etat.onglet || (!date && onglet !== "dates");
	}
	for (const bouton of document.querySelectorAll("[data-onglet]")) {
		bouton.setAttribute(
			"aria-selected",
			String(bouton.dataset.onglet === etat.onglet),
		);
	}
	$("#sans-naissance").hidden = Boolean(date);
	if (etat.onglet === "dates") rendreDates(maintenant);
	else if (date) {
		if (etat.onglet === "vie") {
			rendreRebours(maintenant);
			dessinerGrille();
		} else if (etat.onglet === "quotidien") rendreQuotidien(maintenant);
		else rendreRestants(maintenant);
	}
	demarrerMinuterie();
}

function choisirOnglet(onglet) {
	etat.onglet = onglet;
	ecrireStockage(CLES.onglet, onglet);
	rendre();
}

/** Passe à l'onglet voisin (-1 : précédent, 1 : suivant) ; faux s'il n'y en a pas. */
function choisirOngletVoisin(sens) {
	const onglet = voisin(ONGLETS, etat.onglet, sens);
	if (onglet) choisirOnglet(onglet);
	return Boolean(onglet);
}

/** Le compte à rebours avance chaque seconde, tant que l'onglet Vie est à l'écran. */
function demarrerMinuterie() {
	clearTimeout(etat.minuterie);
	etat.minuterie = null;
	if (
		etat.onglet !== "vie" ||
		!naissance() ||
		$("#ecran-app").hidden ||
		document.visibilityState !== "visible"
	) {
		return;
	}
	const battre = () => {
		rendreRebours();
		etat.minuterie = setTimeout(battre, 1000 - (Date.now() % 1000) + 10);
	};
	etat.minuterie = setTimeout(battre, 1000 - (Date.now() % 1000) + 10);
}

// ---------------------------------------------------------------------------
// Dialogues
// ---------------------------------------------------------------------------

function erreurDialogue(formulaire, message) {
	formulaire.querySelector(".erreur").textContent = message;
}

function ouvrirReglages() {
	const formulaire = $("#form-reglages");
	erreurDialogue(formulaire, "");
	$("#champ-naissance").value = reglages.naissance ?? "";
	$("#champ-naissance").max = versChampDate(new Date());
	$("#champ-esperance").value = reglages.esperance;
	$("#champ-retraite").value = reglages.retraite;
	$("#dialogue-reglages").showModal();
}

function enregistrerReglages(evenement) {
	evenement.preventDefault();
	const formulaire = evenement.currentTarget;
	const champNaissance = $("#champ-naissance").value;
	if (!champNaissance || versDate(champNaissance) > new Date()) {
		erreurDialogue(formulaire, "La date de naissance doit être passée.");
		return;
	}
	reglages.naissance = champNaissance;
	reglages.esperance = Number($("#champ-esperance").value);
	reglages.retraite = Number($("#champ-retraite").value);
	enregistrer();
	$("#dialogue-reglages").close();
	rendre();
}

function ouvrirActivite(id) {
	const activite = reglages.activites.find((a) => a.id === id) ?? null;
	etat.enEdition = activite;
	const formulaire = $("#form-activite");
	erreurDialogue(formulaire, "");
	$("#titre-dialogue-activite").textContent = activite
		? "Modifier l'activité"
		: "Ajouter une activité";
	$("#champ-activite").value = activite?.nom ?? "";
	$("#champ-heures").value = activite ? Math.floor(activite.minutes / 60) : "";
	$("#champ-minutes").value = activite ? activite.minutes % 60 : "";
	$("#champ-age-debut").value = activite?.debut ?? 0;
	$("#champ-age-fin").value = activite?.fin ?? "";
	$("#supprimer-activite").hidden = !activite;
	$("#dialogue-activite").showModal();
}

function enregistrerActivite(evenement) {
	evenement.preventDefault();
	const formulaire = evenement.currentTarget;
	const nom = $("#champ-activite").value.trim();
	const minutes =
		Number($("#champ-heures").value || 0) * 60 +
		Number($("#champ-minutes").value || 0);
	const debut = Number($("#champ-age-debut").value || 0);
	const fin =
		$("#champ-age-fin").value === "" ? null : Number($("#champ-age-fin").value);
	if (!nom) return erreurDialogue(formulaire, "Donne un nom à l'activité.");
	if (minutes <= 0 || minutes > 24 * 60) {
		return erreurDialogue(
			formulaire,
			"Le temps par jour va de 1 minute à 24 heures.",
		);
	}
	if (fin !== null && fin <= debut) {
		return erreurDialogue(
			formulaire,
			"L'âge de fin doit dépasser l'âge de début.",
		);
	}
	const valeurs = { nom, minutes, debut, fin };
	if (etat.enEdition) Object.assign(etat.enEdition, valeurs);
	else reglages.activites.push({ id: identifiant(), ...valeurs });
	enregistrer();
	$("#dialogue-activite").close();
	rendre();
}

function supprimerActivite() {
	reglages.activites = reglages.activites.filter((a) => a !== etat.enEdition);
	enregistrer();
	$("#dialogue-activite").close();
	notifier(`« ${etat.enEdition.nom} » supprimée.`);
	rendre();
}

function ouvrirDate(id) {
	const entree = reglages.dates.find((d) => d.id === id) ?? null;
	etat.enEdition = entree;
	erreurDialogue($("#form-date"), "");
	$("#titre-dialogue-date").textContent = entree
		? "Modifier la date"
		: "Ajouter une date";
	$("#champ-titre-date").value = entree?.titre ?? "";
	$("#champ-date").value = entree?.date ?? "";
	$("#supprimer-date").hidden = !entree;
	$("#dialogue-date").showModal();
}

function enregistrerDate(evenement) {
	evenement.preventDefault();
	const titre = $("#champ-titre-date").value.trim();
	const date = $("#champ-date").value;
	if (!titre || !date) {
		return erreurDialogue(evenement.currentTarget, "Donne un nom et une date.");
	}
	if (etat.enEdition) Object.assign(etat.enEdition, { titre, date });
	else reglages.dates.push({ id: identifiant(), titre, date });
	enregistrer();
	$("#dialogue-date").close();
	rendre();
}

function supprimerDate() {
	reglages.dates = reglages.dates.filter((d) => d !== etat.enEdition);
	enregistrer();
	$("#dialogue-date").close();
	notifier(`« ${etat.enEdition.titre} » supprimée.`);
	rendre();
}

// ---------------------------------------------------------------------------
// Menu et démarrage
// ---------------------------------------------------------------------------

function afficherVersion() {
	for (const element of document.querySelectorAll(".version")) {
		element.textContent = `Version ${window.VERSION_APP ?? "?"}`;
	}
}

function basculerMenu() {
	const menu = $("#menu");
	menu.hidden = !menu.hidden;
	$("#bouton-menu").setAttribute("aria-expanded", String(!menu.hidden));
}

function fermerMenu() {
	$("#menu").hidden = true;
	$("#bouton-menu").setAttribute("aria-expanded", "false");
}

/** À l'ouverture de l'app : sans date de naissance, les réglages s'ouvrent une fois. */
function surOuverte() {
	afficherProfil();
	rendre();
	if (!reglages.naissance && !etat.reglagesProposes) {
		etat.reglagesProposes = true;
		ouvrirReglages();
	}
}

function brancherEvenements() {
	for (const bouton of document.querySelectorAll("[data-onglet]")) {
		bouton.addEventListener("click", () =>
			choisirOnglet(bouton.dataset.onglet),
		);
	}
	brancherBalayage($("#ecran-app"), choisirOngletVoisin, {
		anime: () => $(`#onglet-${etat.onglet}`),
	});
	$("#activites").addEventListener("click", (e) => {
		const carte = e.target.closest("[data-activite]");
		if (carte) ouvrirActivite(carte.dataset.activite);
	});
	$("#mes-dates").addEventListener("click", (e) => {
		const carte = e.target.closest("[data-date]");
		if (carte) ouvrirDate(carte.dataset.date);
	});
	$("#ajouter-activite").addEventListener("click", () => ouvrirActivite(null));
	$("#ajouter-date").addEventListener("click", () => ouvrirDate(null));
	$("#form-reglages").addEventListener("submit", enregistrerReglages);
	$("#form-activite").addEventListener("submit", enregistrerActivite);
	$("#form-date").addEventListener("submit", enregistrerDate);
	$("#supprimer-activite").addEventListener("click", supprimerActivite);
	$("#supprimer-date").addEventListener("click", supprimerDate);
	for (const bouton of document.querySelectorAll("[data-reglages]")) {
		bouton.addEventListener("click", ouvrirReglages);
	}
	for (const bouton of document.querySelectorAll("[data-fermer]")) {
		bouton.addEventListener("click", () => bouton.closest("dialog").close());
	}

	// La grille suit la largeur de l'écran et les couleurs du thème.
	let redimensionnement = null;
	window.addEventListener("resize", () => {
		clearTimeout(redimensionnement);
		redimensionnement = setTimeout(() => {
			if (etat.onglet === "vie") dessinerGrille();
		}, 150);
	});
	matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
		if (etat.onglet === "vie") dessinerGrille();
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
	$("#menu-reglages").addEventListener("click", () => {
		fermerMenu();
		ouvrirReglages();
	});
	$("#menu-installer").addEventListener("click", fermerMenu);
	brancherInstallation($("#menu-installer"), { connexion: true });
	brancherBiometrie($("#menu-biometrie"), "Compteurs");
	$("#menu-autre-appareil").addEventListener("click", async () => {
		fermerMenu();
		try {
			await connecterUnAutreAppareil("Compteurs");
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	});
	$("#menu-deconnecter").addEventListener("click", () => {
		fermerMenu();
		acces.seDeconnecter();
	});
	$("#bouton-signalement").addEventListener("click", () => {
		fermerMenu();
		ouvrirSignalement({ app: "Compteurs", prenom: compteConnecte()?.prenom });
	});
	// Au retour dans l'app, les compteurs repartent de l'heure du moment (le jour a pu changer).
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") {
			chercherMiseAJour();
			if (!$("#ecran-app").hidden) rendre();
		} else {
			clearTimeout(etat.minuterie);
		}
	});
}

afficherVersion();
enregistrerServiceWorker();
// Réservée aux comptes qui ont accès à Compteurs (onglet Droits du projet droits).
brancherProfil();
const acces = exigerAccesApp({
	cle: "compteurs",
	nomApp: "Compteurs",
	surOuverte,
});
brancherEvenements();
