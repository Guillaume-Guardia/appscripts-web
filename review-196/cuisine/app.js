import { creerApi, ErreurReseau } from "../shared/api.js";
import { brancherBalayage, voisin } from "../shared/balayage.js";
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
	ouvrirInvitation,
} from "../shared/connexion.js";
import {
	aujourdhui,
	joursEntre,
	pluriel,
	versChampDate,
	versDate,
} from "../shared/dates.js";
import {
	$,
	afficherBandeau,
	el,
	masquerBandeau,
	normaliser,
	notifier,
	remplacerContenu,
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
import { courbePoids, histogrammeKcal } from "./graphiques.js";
import {
	additionner,
	KCAL_PAR_GRAMME,
	multiplier,
	NUTRIMENTS,
	nombre,
	quantiteTexte,
	resume,
	vides,
} from "./nutrition.js";
import { scannerCodeBarres, scannerDisponible } from "./scanner.js";

// ---------------------------------------------------------------------------
// État de l'app
// ---------------------------------------------------------------------------

const CLES = {
	/** Clé du lien de connexion d'avant les comptes : effacée au démarrage. */
	ancienneCle: "cuisine.cle",
	/** Compte dont l'état est en cache. */
	compte: "cuisine.compte",
	etat: "cuisine.etat",
	profil: "cuisine.profil",
	vue: "cuisine.vue",
	versionApi: "cuisine.versionApi",
};

const VUES = ["journal", "poids", "recettes"];

const app = {
	/** { profils, aliments, recettes, journal, journalDepuis, poids, options } renvoyé par l'API. */
	etat: null,
	/** Nom du profil suivi sur cet appareil. */
	profil: lireStockage(CLES.profil),
	vue: VUES.includes(lireStockage(CLES.vue))
		? lireStockage(CLES.vue)
		: "journal",
	/** Jour affiché par le journal, « aaaa-mm-jj ». */
	jour: versChampDate(aujourdhui()),
	/** Aujourd'hui au dernier affichage : le journal suit le changement de jour. */
	aujourdhui: versChampDate(aujourdhui()),
	/** Journal des jours que l'état n'a pas (plus anciens) : jour → entrées, « chargement » ou « erreur ». */
	joursAnciens: new Map(),
	/** Ajout en cours : { repas, choix: { type, nom, quantite? } }. */
	ajout: null,
	/** Entrée du journal en cours de modification. */
	entree: null,
	/** Nom de la recette en cours de modification (null : nouvelle recette). */
	recette: null,
	horsLigne: false,
	occupe: false,
	/** Version de l'API, renvoyée avec chaque réponse (affichée avec celle de l'app). */
	versionApi: lireStockage(CLES.versionApi),
};

const etatEnCache = lireStockageJson(CLES.etat);
// État en cache : seulement celui du compte connecté sur l'appareil.
if (
	lireSession() &&
	lireStockage(CLES.compte) === compteConnecte()?.id &&
	Array.isArray(etatEnCache?.journal) &&
	etatEnCache.options
) {
	app.etat = etatEnCache;
}

// ---------------------------------------------------------------------------
// API (Web App Apps Script, projet cuisine)
// ---------------------------------------------------------------------------

const appelerApi = creerApi({
	url: window.API_URL,
	identifiants: () => ({ session: lireSession() }),
	surVersion: (version) => {
		if (version === app.versionApi) return;
		app.versionApi = version;
		ecrireStockage(CLES.versionApi, version);
		afficherVersions();
	},
});

function enregistrerEtat() {
	ecrireStockage(CLES.etat, JSON.stringify(app.etat));
	ecrireStockage(CLES.compte, compteConnecte()?.id ?? null);
}

function passerHorsLigne() {
	app.horsLigne = true;
	afficherBandeauHorsLigne();
}

function appliquerEtat(etat) {
	app.etat = etat;
	app.horsLigne = false;
	enregistrerEtat();
	afficherBandeauHorsLigne();
	rendre();
}

/** Erreur d'un appel qui ne modifie rien : déconnexion, accès refusé, hors ligne ou notification. */
function signalerErreur(erreur, silencieux = false) {
	if (estSessionRefusee(erreur)) {
		deconnecter(erreur.message);
		return;
	}
	if (estAccesRefuse(erreur)) {
		afficherRefus(erreur.message);
		return;
	}
	if (erreur instanceof ErreurReseau) passerHorsLigne();
	if (!silencieux) notifier(erreur.message, true);
}

async function actualiser({ silencieux = false } = {}) {
	if (!lireSession()) return;
	const bouton = $("#bouton-actualiser");
	bouton.classList.add("tourne");
	app.joursAnciens.clear();
	try {
		appliquerEtat(
			await appelerApi(
				"etat",
				{},
				{ discret: silencieux && Boolean(app.etat) },
			),
		);
	} catch (erreur) {
		signalerErreur(erreur, silencieux && erreur instanceof ErreurReseau);
	} finally {
		bouton.classList.remove("tourne");
	}
}

/**
 * Lance une modification ; l'API renvoie { resultat, etat }.
 * @param surErreur affiche l'erreur (par défaut : une notification)
 * @return le résultat (true s'il n'y en a pas), ou null en cas d'échec
 */
async function modifier(
	action,
	parametres,
	messageSucces,
	surErreur = (message) => notifier(message, true),
) {
	if (app.occupe) return null;
	if (app.horsLigne) {
		surErreur("Hors ligne : les modifications reviendront avec la connexion.");
		return null;
	}
	app.occupe = true;
	document.body.style.cursor = "progress";
	try {
		const { resultat, etat } = await appelerApi(action, parametres);
		// Un jour plus ancien que l'état est relu : il vient peut-être de changer.
		app.joursAnciens.clear();
		appliquerEtat(etat);
		if (messageSucces) notifier(messageSucces);
		return resultat ?? true;
	} catch (erreur) {
		if (estSessionRefusee(erreur) || estAccesRefuse(erreur)) {
			signalerErreur(erreur);
			return null;
		}
		surErreur(erreur.message);
		if (erreur instanceof ErreurReseau) passerHorsLigne();
		return null;
	} finally {
		app.occupe = false;
		document.body.style.cursor = "";
	}
}

// ---------------------------------------------------------------------------
// Profils, catalogue et journal
// ---------------------------------------------------------------------------

/** Profil suivi sur cet appareil (le premier par défaut), ou null s'il n'y en a aucun. */
function profilActif() {
	const profils = app.etat?.profils ?? [];
	return profils.find((p) => p.nom === app.profil) ?? profils[0] ?? null;
}

function choisirProfil(nom) {
	app.profil = nom;
	ecrireStockage(CLES.profil, nom);
	rendre();
}

const parNom = (liste, nom) =>
	liste.find((element) => normaliser(element.nom) === normaliser(nom));

/** Aliment ou recette de l'état : { type, nom, element }, ou null s'il n'existe plus. */
function trouverChoix(type, nom) {
	const liste = type === "recette" ? app.etat.recettes : app.etat.aliments;
	const element = parNom(liste, nom);
	return element ? { type, nom: element.nom, element } : null;
}

/** Valeurs d'une quantité d'aliment (grammes) ou de recette (portions), pour les aperçus. */
function valeursDe({ type, element }, quantite) {
	return type === "recette"
		? multiplier(element.parPortion, quantite)
		: multiplier(element.pour100g, quantite / 100);
}

/** Entrées d'un jour (tous profils), ou null si ce jour n'est pas encore chargé. */
function entreesDuJour(jour) {
	if (!app.etat) return null;
	if (jour >= app.etat.journalDepuis) {
		return app.etat.journal.filter((e) => e.date === jour);
	}
	const anciennes = app.joursAnciens.get(jour);
	return Array.isArray(anciennes) ? anciennes : null;
}

/** Charge un jour plus ancien que l'état (action journal), puis le réaffiche. */
async function chargerJourAncien(jour) {
	if (app.joursAnciens.has(jour) || app.horsLigne) return;
	app.joursAnciens.set(jour, "chargement");
	try {
		app.joursAnciens.set(
			jour,
			await appelerApi("journal", { du: jour, au: jour }),
		);
	} catch (erreur) {
		// Pas de nouvel essai avant « Actualiser » (qui vide joursAnciens).
		app.joursAnciens.set(jour, "erreur");
		signalerErreur(erreur);
	}
	if (app.jour === jour && app.vue === "journal") rendre();
}

const decalerJour = (jour, jours) => {
	const date = versDate(jour);
	date.setDate(date.getDate() + jours);
	return versChampDate(date);
};

// ---------------------------------------------------------------------------
// Vue Journal
// ---------------------------------------------------------------------------

const formatJour = new Intl.DateTimeFormat("fr-FR", {
	weekday: "short",
	day: "numeric",
	month: "short",
});
const formatJourCourt = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const formatDateCourte = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "short",
});

/** « Aujourd'hui », « Hier », « Demain » ou « dim. 25 oct. » */
function libelleJour(jour) {
	const ecart = joursEntre(aujourdhui(), versDate(jour));
	const date = formatJour.format(versDate(jour));
	if (ecart === 0) return `Aujourd'hui, ${date}`;
	if (ecart === -1) return `Hier, ${date}`;
	if (ecart === 1) return `Demain, ${date}`;
	return date.charAt(0).toUpperCase() + date.slice(1);
}

function allerAuJour(jour) {
	app.jour = jour;
	rendre();
}

/**
 * Barre de progression vers un objectif.
 * @param sens « min » (à atteindre), « max » (à ne pas dépasser) ou « cible »
 */
function barreObjectif(valeur, objectif, sens) {
	const etat =
		sens === "max"
			? valeur > objectif
				? " depasse"
				: ""
			: valeur >= objectif
				? sens === "min"
					? " complete"
					: valeur > objectif * 1.1
						? " depasse"
						: " complete"
				: "";
	return el(
		"div",
		{
			class: `barre${etat}`,
			role: "progressbar",
			"aria-valuemin": "0",
			"aria-valuemax": String(Math.round(objectif)),
			"aria-valuenow": String(Math.round(valeur)),
		},
		el("span", {
			style: `width: ${Math.min(100, (valeur / objectif) * 100)}%`,
		}),
	);
}

/** Objectifs détaillés : [nutriment, libellé, clé de l'objectif, sens]. */
const LIGNES_OBJECTIFS = [
	["proteines", "Protéines", "proteines", "min"],
	["glucides", "Glucides", "glucides", "cible"],
	["sucres", "dont sucres", "sucresMax", "max"],
	["lipides", "Lipides", "lipides", "cible"],
	["fibres", "Fibres", "fibres", "min"],
	["sel", "Sel", "selMax", "max"],
];

/** Part des kcal venant des protéines, glucides et lipides. */
function repartition(totaux) {
	const kcal = Object.entries(KCAL_PAR_GRAMME).map(([n, k]) => [
		n,
		totaux[n] * k,
	]);
	const somme = kcal.reduce((t, [, k]) => t + k, 0);
	if (somme <= 0) return null;
	const noms = {
		proteines: "Protéines",
		glucides: "Glucides",
		lipides: "Lipides",
	};
	const parts = kcal.map(([n, k]) => [n, Math.round((k / somme) * 100)]);
	return el(
		"div",
		{ class: "repartition" },
		el(
			"div",
			{ class: "barre-repartition", "aria-hidden": "true" },
			parts.map(([n, p]) => el("span", { class: n, style: `width: ${p}%` })),
		),
		el(
			"p",
			{ class: "legende" },
			parts.map(([n, p]) => el("span", { class: n }, `${noms[n]} ${p} %`)),
		),
	);
}

function carteTotaux(totaux, objectifs) {
	const kcal = Math.round(totaux.kcal);
	const objectif = objectifs.kcal;
	let reste = "Pas d'objectif de kcal (menu → Mes objectifs).";
	if (objectif) {
		reste =
			kcal <= objectif
				? `Reste ${nombre(objectif - kcal, 0)} kcal`
				: `${nombre(kcal - objectif, 0)} kcal au-dessus de l'objectif`;
	}
	return el(
		"section",
		{ class: "carte totaux" },
		el(
			"p",
			{ class: "kcal" },
			el("strong", {}, nombre(kcal, 0)),
			objectif ? ` / ${nombre(objectif, 0)} kcal` : " kcal",
		),
		objectif ? barreObjectif(kcal, objectif, "cible") : null,
		el("p", { class: "aide" }, reste),
		el(
			"div",
			{ class: "nutriments" },
			LIGNES_OBJECTIFS.map(([n, libelle, cle, sens]) => {
				const valeur = totaux[n];
				const cible = objectifs[cle];
				return el(
					"div",
					{ class: `nutriment${sens === "max" ? " maximum" : ""}` },
					el("span", { class: "libelle" }, libelle),
					el(
						"span",
						{ class: "valeur" },
						cible
							? `${nombre(valeur)} / ${sens === "max" ? "max " : ""}${nombre(cible)} g`
							: `${nombre(valeur)} g`,
					),
					cible ? barreObjectif(valeur, cible, sens) : null,
				);
			}),
		),
		repartition(totaux),
	);
}

function carteSemaine(profil) {
	const jours = Array.from({ length: 7 }, (_, i) => {
		const jour = decalerJour(app.jour, i - 6);
		const entrees = entreesDuJour(jour);
		return {
			jour,
			court: formatJourCourt.format(versDate(jour)),
			kcal: entrees
				? entrees
						.filter((e) => e.profil === profil.nom)
						.reduce((t, e) => t + e.nutriments.kcal, 0)
				: null,
		};
	});
	const renseignes = jours.filter((j) => j.kcal);
	const moyenne = renseignes.length
		? renseignes.reduce((t, j) => t + j.kcal, 0) / renseignes.length
		: null;
	return el(
		"section",
		{ class: "carte carte-semaine" },
		el(
			"h3",
			{},
			"7 derniers jours",
			moyenne
				? el("span", { class: "compte" }, `moyenne ${nombre(moyenne, 0)} kcal`)
				: null,
		),
		histogrammeKcal(jours, profil.objectifs.kcal, app.jour, allerAuJour),
	);
}

function ligneEntree(entree) {
	return el(
		"li",
		{},
		el(
			"button",
			{
				type: "button",
				class: "entree",
				onclick: () => ouvrirEntree(entree),
			},
			el(
				"span",
				{ class: "texte" },
				el("span", { class: "nom" }, entree.nom),
				el(
					"span",
					{ class: "detail" },
					quantiteTexte(entree.type, entree.quantite),
					entree.type === "recette" ? " · recette" : "",
				),
			),
			el(
				"span",
				{ class: "kcal" },
				`${nombre(entree.nutriments.kcal, 0)} kcal`,
			),
		),
	);
}

function carteRepas(repas, entrees, veille) {
	const kcal = entrees.reduce((t, e) => t + e.nutriments.kcal, 0);
	const aCopier = entrees.length === 0 ? (veille ?? []) : [];
	return el(
		"section",
		{ class: "carte repas" },
		el(
			"h3",
			{},
			repas,
			entrees.length
				? el("span", { class: "compte" }, `${nombre(kcal, 0)} kcal`)
				: null,
		),
		entrees.length
			? el("ul", { class: "entrees" }, entrees.map(ligneEntree))
			: null,
		el(
			"div",
			{ class: "actions-repas" },
			el(
				"button",
				{ type: "button", onclick: () => ouvrirAjout(repas) },
				"+ Ajouter",
			),
			aCopier.length
				? el(
						"button",
						{ type: "button", onclick: () => copierRepasDeLaVeille(repas) },
						`Comme la veille (${aCopier.length})`,
					)
				: null,
		),
	);
}

function rendreJournal(profil) {
	$("#libelle-jour").textContent = libelleJour(app.jour);
	$("#champ-jour").value = app.jour;
	const contenu = $("#contenu-journal");
	const entrees = entreesDuJour(app.jour);
	if (!entrees) {
		chargerJourAncien(app.jour);
		const enCours = app.joursAnciens.get(app.jour) === "chargement";
		remplacerContenu(
			contenu,
			el(
				"p",
				{ class: "vide" },
				enCours
					? "Chargement…"
					: "Ce jour n'a pas pu être chargé : actualise quand tu seras en ligne.",
			),
		);
		return;
	}
	const miennes = entrees.filter((e) => e.profil === profil.nom);
	const veille = entreesDuJour(decalerJour(app.jour, -1))?.filter(
		(e) => e.profil === profil.nom,
	);
	const repas = [...app.etat.options.repas];
	// Repas écrits autrement dans le classeur : à la fin.
	for (const e of miennes) if (!repas.includes(e.repas)) repas.push(e.repas);
	remplacerContenu(
		contenu,
		carteTotaux(
			additionner(miennes.map((e) => e.nutriments)),
			profil.objectifs,
		),
		...repas.map((r) =>
			carteRepas(
				r,
				miennes.filter((e) => e.repas === r),
				veille?.filter((e) => e.repas === r),
			),
		),
		carteSemaine(profil),
	);
}

function copierRepasDeLaVeille(repas) {
	modifier(
		"copier-repas",
		{
			copie: {
				profil: profilActif().nom,
				repas,
				depuis: decalerJour(app.jour, -1),
				vers: app.jour,
			},
		},
		`${repas} : copié de la veille.`,
	);
}

// ---------------------------------------------------------------------------
// Ajout au journal : recherche, puis quantité
// ---------------------------------------------------------------------------

/** Derniers aliments et recettes mangés par le profil, avec leur dernière quantité. */
function recents() {
	const profil = profilActif();
	const vus = new Set();
	const liste = [];
	for (const e of [...app.etat.journal].reverse()) {
		const cle = `${e.type}:${normaliser(e.nom)}`;
		if (e.profil !== profil.nom || vus.has(cle)) continue;
		vus.add(cle);
		const choix = trouverChoix(e.type, e.nom);
		if (choix) liste.push({ ...choix, quantite: e.quantite });
		if (liste.length === 12) break;
	}
	return liste;
}

/** Aliments et recettes dont le nom contient tous les mots cherchés. */
function rechercher(texte) {
	const mots = normaliser(texte).split(/\s+/).filter(Boolean);
	const debut = mots.join(" ");
	return [
		...app.etat.recettes.map((element) => ({
			type: "recette",
			nom: element.nom,
			element,
		})),
		...app.etat.aliments.map((element) => ({
			type: "aliment",
			nom: element.nom,
			element,
		})),
	]
		.map((choix) => ({ choix, nom: normaliser(choix.nom) }))
		.filter(({ nom }) => mots.every((mot) => nom.includes(mot)))
		.sort(
			(a, b) =>
				Number(b.nom.startsWith(debut)) - Number(a.nom.startsWith(debut)) ||
				a.nom.localeCompare(b.nom, "fr"),
		)
		.slice(0, 40)
		.map(({ choix }) => choix);
}

function detailChoix({ type, element }) {
	if (type === "recette") {
		return `Recette · ${nombre(element.parPortion.kcal, 0)} kcal la portion`;
	}
	return `${element.categorie || "Divers"} · ${nombre(element.pour100g.kcal, 0)} kcal pour 100 g`;
}

function rendreResultats() {
	const texte = $("#champ-recherche").value.trim();
	const choix = texte ? rechercher(texte) : recents();
	let titre = texte ? pluriel(choix.length, "résultat") : "Récemment";
	if (!choix.length) {
		titre = texte
			? "Rien dans les aliments ni les recettes : cherche un produit du commerce, ou crée l'aliment."
			: "Tape le nom d'un aliment ou d'une recette.";
	}
	$("#titre-resultats").textContent = titre;
	remplacerContenu(
		$("#resultats"),
		choix.map((c) =>
			el(
				"li",
				{},
				el(
					"button",
					{ type: "button", class: "resultat", onclick: () => choisir(c) },
					el("span", { class: "nom" }, c.nom),
					el(
						"span",
						{ class: "detail" },
						detailChoix(c),
						c.quantite
							? ` · dernière fois ${quantiteTexte(c.type, c.quantite)}`
							: "",
					),
				),
			),
		),
	);
}

function remplirRepas(select, choisi) {
	const repas = [...app.etat.options.repas];
	if (choisi && !repas.includes(choisi)) repas.push(choisi);
	remplacerContenu(
		select,
		repas.map((r) => el("option", { value: r, selected: r === choisi }, r)),
	);
}

function afficherEtapeAjout(etape) {
	$("#etape-recherche").hidden = etape !== "recherche";
	$("#etape-quantite").hidden = etape !== "quantite";
}

function ouvrirAjout(repas) {
	if (app.horsLigne) {
		notifier("Hors ligne : l'ajout reviendra avec la connexion.", true);
		return;
	}
	app.ajout = { repas, choix: null };
	$("#titre-dialogue-ajout").textContent = `Ajouter · ${repas}`;
	$("#champ-recherche").value = "";
	afficherEtapeAjout("recherche");
	rendreResultats();
	$("#dialogue-ajout").showModal();
	$("#champ-recherche").focus();
}

/** Quantités proposées d'un clic : portions de l'aliment, ou demi-portions de recette. */
function quantitesRapides({ type, element }) {
	if (type === "recette") {
		return [0.5, 1, 1.5, 2].map((q) => [quantiteTexte("recette", q), q]);
	}
	if (element.portion) {
		const nom = element.nomPortion || "portion";
		return [
			[`${nom} (${nombre(element.portion)} g)`, element.portion],
			[`2 × ${nom}`, element.portion * 2],
			["100 g", 100],
		];
	}
	return [50, 100, 150, 200].map((g) => [`${g} g`, g]);
}

function afficherApercuAjout() {
	const quantite = Number($("#champ-quantite").value);
	const choix = app.ajout?.choix;
	$("#apercu-ajout").textContent =
		choix && quantite > 0 ? resume(valeursDe(choix, quantite)) : "";
}

function choisir(choix) {
	app.ajout.choix = choix;
	const { type, element } = choix;
	$("#nom-choisi").textContent = choix.nom;
	$("#detail-choisi").textContent =
		type === "recette"
			? `${nombre(element.parPortion.kcal, 0)} kcal la portion (${nombre(element.poidsPortion, 0)} g)`
			: `${nombre(element.pour100g.kcal, 0)} kcal pour 100 g${element.portion ? ` · ${element.nomPortion || "1 portion"} : ${nombre(element.portion)} g` : ""}`;
	$("#libelle-quantite").textContent =
		type === "recette" ? "Portions" : "Quantité (g)";
	$("#champ-quantite").value = String(
		choix.quantite ?? (type === "recette" ? 1 : (element.portion ?? 100)),
	);
	remplirRepas($("#champ-repas"), app.ajout.repas);
	remplacerContenu(
		$("#quantites-rapides"),
		quantitesRapides(choix).map(([libelle, quantite]) =>
			el(
				"button",
				{
					type: "button",
					class: "puce",
					onclick: () => {
						$("#champ-quantite").value = String(quantite);
						afficherApercuAjout();
					},
				},
				libelle,
			),
		),
	);
	$("#etape-quantite").querySelector(".erreur").textContent = "";
	afficherEtapeAjout("quantite");
	afficherApercuAjout();
	if (!$("#dialogue-ajout").open) $("#dialogue-ajout").showModal();
}

async function enregistrerAjout(evenement) {
	evenement.preventDefault();
	const erreur = evenement.target.querySelector(".erreur");
	erreur.textContent = "";
	const { choix } = app.ajout;
	const resultat = await modifier(
		"ajouter-entree",
		{
			entree: {
				date: app.jour,
				profil: profilActif().nom,
				repas: $("#champ-repas").value,
				nom: choix.nom,
				type: choix.type,
				quantite: $("#champ-quantite").value,
			},
		},
		null,
		(message) => {
			erreur.textContent = message;
		},
	);
	if (resultat) {
		$("#dialogue-ajout").close();
		notifier(
			`${resultat.nom} : ${nombre(resultat.nutriments.kcal, 0)} kcal ajoutées.`,
		);
	}
}

// ---------------------------------------------------------------------------
// Modification d'une entrée du journal
// ---------------------------------------------------------------------------

function afficherApercuEntree() {
	const quantite = Number($("#champ-quantite-entree").value);
	const { entree } = app;
	$("#apercu-entree").textContent =
		entree && quantite > 0
			? resume(multiplier(entree.nutriments, quantite / entree.quantite))
			: "";
}

function ouvrirEntree(entree) {
	app.entree = entree;
	const form = $("#form-entree");
	form.querySelector(".erreur").textContent = "";
	$("#titre-dialogue-entree").textContent = entree.nom;
	$("#libelle-quantite-entree").textContent =
		entree.type === "recette" ? "Portions" : "Quantité (g)";
	$("#champ-quantite-entree").value = String(entree.quantite);
	remplirRepas($("#champ-repas-entree"), entree.repas);
	afficherApercuEntree();
	$("#dialogue-entree").showModal();
}

async function enregistrerEntree(evenement) {
	evenement.preventDefault();
	const erreur = evenement.target.querySelector(".erreur");
	erreur.textContent = "";
	const fait = await modifier(
		"modifier-entree",
		{
			entreeId: app.entree.id,
			entree: {
				quantite: $("#champ-quantite-entree").value,
				repas: $("#champ-repas-entree").value,
			},
		},
		`${app.entree.nom} modifié.`,
		(message) => {
			erreur.textContent = message;
		},
	);
	if (fait) $("#dialogue-entree").close();
}

async function supprimerEntree() {
	const { entree } = app;
	const fait = await modifier(
		"supprimer-entree",
		{ entreeId: entree.id },
		`${entree.nom} retiré du journal.`,
	);
	if (fait) $("#dialogue-entree").close();
}

// ---------------------------------------------------------------------------
// Produits du commerce (Open Food Facts), code-barres, nouvel aliment
// ---------------------------------------------------------------------------

const estCodeBarres = (texte) => /^\d{8,14}$/.test(texte.replace(/\s/g, ""));

function ouvrirOff(texte = "") {
	if (app.horsLigne) {
		notifier("Hors ligne : la recherche reviendra avec la connexion.", true);
		return;
	}
	const form = $("#form-off");
	form.querySelector(".erreur").textContent = "";
	$("#champ-off").value = texte;
	remplacerContenu($("#resultats-off"));
	$("#dialogue-off").showModal();
	if (texte) chercherOff();
	else $("#champ-off").focus();
}

async function chercherOff(evenement) {
	evenement?.preventDefault();
	const form = $("#form-off");
	const erreur = form.querySelector(".erreur");
	erreur.textContent = "";
	const texte = $("#champ-off").value.trim();
	if (!texte) return;
	const code = estCodeBarres(texte) ? texte.replace(/\s/g, "") : null;
	if (code && choisirAlimentDuCode(code)) return;
	remplacerContenu(
		$("#resultats-off"),
		el("li", { class: "aide" }, "Recherche…"),
	);
	const bouton = form.querySelector('[type="submit"]');
	bouton.disabled = true;
	let produits;
	try {
		produits = await appelerApi("chercher-produits", {
			recherche: code ? { code } : { texte },
		});
	} catch (e) {
		remplacerContenu($("#resultats-off"));
		if (estSessionRefusee(e) || estAccesRefuse(e)) signalerErreur(e);
		else erreur.textContent = e.message;
		return;
	} finally {
		bouton.disabled = false;
	}
	if (!produits.length) {
		remplacerContenu(
			$("#resultats-off"),
			el(
				"li",
				{ class: "aide" },
				code
					? "Produit inconnu d'Open Food Facts. "
					: "Aucun produit trouvé (essaie avec la marque, ou moins de mots). ",
				el(
					"button",
					{
						type: "button",
						onclick: () =>
							ouvrirFormulaireAliment({
								codeBarres: code ?? "",
								nom: code ? "" : texte,
							}),
					},
					"Le saisir à la main",
				),
			),
		);
		return;
	}
	remplacerContenu(
		$("#resultats-off"),
		produits.map((p) =>
			el(
				"li",
				{},
				el(
					"button",
					{
						type: "button",
						class: "resultat",
						onclick: () => ouvrirFormulaireAliment(p),
					},
					el("span", { class: "nom" }, p.nom),
					el(
						"span",
						{ class: "detail" },
						[p.marque, `${nombre(p.pour100g.kcal, 0)} kcal pour 100 g`]
							.filter(Boolean)
							.join(" · "),
					),
				),
			),
		),
	);
}

/** Code-barres déjà au catalogue : l'aliment est choisi directement. */
function choisirAlimentDuCode(code) {
	const aliment = app.etat.aliments.find((a) => a.codeBarres === code);
	if (!aliment) return false;
	if ($("#dialogue-off").open) $("#dialogue-off").close();
	if (app.ajout)
		choisir({ type: "aliment", nom: aliment.nom, element: aliment });
	else notifier(`${aliment.nom} est déjà dans les aliments.`);
	return true;
}

async function scanner() {
	let code;
	try {
		code = await scannerCodeBarres($("#video-scanner"), $("#dialogue-scanner"));
	} catch {
		notifier("Caméra indisponible : tape le code-barres.", true);
		ouvrirOff();
		return;
	}
	if (!code) return;
	if (choisirAlimentDuCode(code)) return;
	if ($("#dialogue-off").open) {
		$("#champ-off").value = code;
		chercherOff();
	} else {
		ouvrirOff(code);
	}
}

/**
 * Formulaire d'un nouvel aliment.
 * @param produit Valeurs de départ : produit d'Open Food Facts, ou { nom, codeBarres }
 */
function ouvrirFormulaireAliment(produit = {}) {
	const form = $("#form-aliment");
	form.reset();
	form.querySelector(".erreur").textContent = "";
	$("#aide-aliment").textContent = produit.pour100g
		? `Valeurs d'Open Food Facts${produit.marque ? ` (${produit.marque})` : ""} : vérifie-les avec l'étiquette.`
		: "Valeurs de l'étiquette, pour 100 g. Seules les kcal sont obligatoires.";
	$("#champ-nom-aliment").value = produit.nom ?? "";
	$("#champ-code-barres").value = produit.codeBarres ?? "";
	$("#champ-portion").value = produit.portion ?? "";
	$("#champ-nom-portion").value = produit.nomPortion ?? "";
	for (const n of NUTRIMENTS) {
		form.elements[n].value = produit.pour100g?.[n] ?? "";
	}
	$("#dialogue-aliment").showModal();
	$(produit.nom ? "#champ-categorie" : "#champ-nom-aliment").focus();
}

async function enregistrerAliment(evenement) {
	evenement.preventDefault();
	const form = evenement.target;
	const erreur = form.querySelector(".erreur");
	erreur.textContent = "";
	const aliment = {
		nom: $("#champ-nom-aliment").value,
		categorie: $("#champ-categorie").value,
		codeBarres: $("#champ-code-barres").value,
		portion: $("#champ-portion").value,
		nomPortion: $("#champ-nom-portion").value,
		pour100g: Object.fromEntries(
			NUTRIMENTS.map((n) => [n, form.elements[n].value]),
		),
	};
	const resultat = await modifier(
		"ajouter-aliment",
		{ aliment },
		null,
		(message) => {
			erreur.textContent = message;
		},
	);
	if (!resultat) return;
	$("#dialogue-aliment").close();
	if ($("#dialogue-off").open) $("#dialogue-off").close();
	notifier(`${resultat.nom} ajouté aux aliments.`);
	const choix = app.ajout && trouverChoix("aliment", resultat.nom);
	if (choix && $("#dialogue-ajout").open) choisir(choix);
}

// ---------------------------------------------------------------------------
// Vue Poids
// ---------------------------------------------------------------------------

const formatDateLongue = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	year: "numeric",
});

function variation(kg) {
	const signe = kg > 0 ? "+" : kg < 0 ? "−" : "";
	return `${signe}${nombre(Math.abs(kg))} kg`;
}

function rendrePoids(profil) {
	const pesees = app.etat.poids
		.filter((p) => p.profil === profil.nom)
		.map((p) => ({ ...p, date: versDate(p.date) }));
	const derniere = pesees.at(-1);
	const cible = profil.objectifs.poidsCible;
	let resumePoids = el("p", { class: "vide" }, "Aucune pesée pour l'instant.");
	if (derniere) {
		const ilYa30Jours = new Date(derniere.date);
		ilYa30Jours.setDate(ilYa30Jours.getDate() - 30);
		const reference =
			[...pesees].reverse().find((p) => p.date <= ilYa30Jours) ?? pesees[0];
		resumePoids = el(
			"div",
			{},
			el(
				"p",
				{ class: "kcal" },
				el("strong", {}, nombre(derniere.poids)),
				" kg",
			),
			el(
				"p",
				{ class: "aide" },
				`Le ${formatDateLongue.format(derniere.date)}`,
				reference !== derniere
					? ` · ${variation(derniere.poids - reference.poids)} depuis le ${formatDateCourte.format(reference.date)}`
					: "",
			),
			cible
				? el(
						"p",
						{ class: "aide" },
						`Objectif : ${nombre(cible)} kg${
							Math.abs(derniere.poids - cible) < 0.05
								? " · atteint !"
								: ` · encore ${nombre(Math.abs(cible - derniere.poids))} kg à ${cible < derniere.poids ? "perdre" : "prendre"}`
						}`,
					)
				: null,
		);
	}
	const recentes = pesees.filter(
		(p) => joursEntre(p.date, derniere?.date ?? p.date) <= 120,
	);
	const formulaire = el(
		"form",
		{ class: "carte formulaire form-poids", onsubmit: enregistrerPoids },
		el("h3", {}, "Nouvelle pesée"),
		el(
			"div",
			{ class: "dates" },
			el(
				"div",
				{},
				el("label", { for: "champ-date-poids" }, "Date"),
				el("input", {
					id: "champ-date-poids",
					type: "date",
					value: versChampDate(aujourdhui()),
					required: true,
				}),
			),
			el(
				"div",
				{},
				el("label", { for: "champ-poids" }, "Poids (kg)"),
				el("input", {
					id: "champ-poids",
					type: "number",
					inputmode: "decimal",
					min: "2",
					max: "400",
					step: "any",
					placeholder: derniere ? nombre(derniere.poids) : "",
					required: true,
				}),
			),
		),
		el("p", { class: "erreur", role: "alert" }),
		el("button", { type: "submit", class: "bouton-principal" }, "Enregistrer"),
	);
	remplacerContenu(
		$("#contenu-poids"),
		el("section", { class: "carte totaux" }, resumePoids),
		recentes.length >= 2
			? el(
					"section",
					{ class: "carte carte-courbe" },
					el("h3", {}, "Évolution"),
					courbePoids(recentes, cible, (d) => formatDateCourte.format(d)),
				)
			: null,
		formulaire,
		pesees.length
			? el(
					"section",
					{ class: "carte liste-pesees" },
					el("h3", {}, "Dernières pesées"),
					el(
						"ul",
						{},
						[...pesees]
							.reverse()
							.slice(0, 15)
							.map((p) =>
								el(
									"li",
									{},
									el("span", {}, formatDateLongue.format(p.date)),
									el("strong", {}, `${nombre(p.poids)} kg`),
									el(
										"button",
										{
											type: "button",
											class: "retirer",
											"aria-label": `Supprimer la pesée du ${formatDateLongue.format(p.date)}`,
											onclick: () => supprimerPoids(p),
										},
										"×",
									),
								),
							),
					),
				)
			: null,
	);
}

async function enregistrerPoids(evenement) {
	evenement.preventDefault();
	const erreur = evenement.target.querySelector(".erreur");
	erreur.textContent = "";
	await modifier(
		"enregistrer-poids",
		{
			pesee: {
				profil: profilActif().nom,
				date: $("#champ-date-poids").value,
				poids: $("#champ-poids").value,
			},
		},
		"Poids enregistré.",
		(message) => {
			erreur.textContent = message;
		},
	);
}

function supprimerPoids(pesee) {
	if (
		!confirm(`Supprimer la pesée du ${formatDateLongue.format(pesee.date)} ?`)
	) {
		return;
	}
	modifier("supprimer-poids", { peseeId: pesee.id }, "Pesée supprimée.");
}

// ---------------------------------------------------------------------------
// Vue Recettes
// ---------------------------------------------------------------------------

function carteRecette(recette) {
	return el(
		"button",
		{
			type: "button",
			class: "carte carte-recette",
			onclick: () => ouvrirRecette(recette),
		},
		el("h3", {}, recette.nom),
		el(
			"p",
			{ class: "aide" },
			`${pluriel(recette.portions, "portion")} de ${nombre(recette.poidsPortion, 0)} g`,
		),
		el("p", {}, `${resume(recette.parPortion)} la portion`),
		recette.inconnus.length
			? el(
					"p",
					{ class: "alerte" },
					`Pas dans les aliments (compté 0) : ${recette.inconnus.join(", ")}`,
				)
			: null,
	);
}

function rendreRecettes() {
	const { recettes } = app.etat;
	remplacerContenu(
		$("#contenu-recettes"),
		el(
			"button",
			{
				type: "button",
				class: "bouton-principal large",
				onclick: () => ouvrirRecette(),
			},
			"+ Nouvelle recette",
		),
		recettes.length
			? recettes.map(carteRecette)
			: el(
					"p",
					{ class: "vide" },
					"Aucune recette : crée tes plats habituels, puis ajoute-les au journal en portions.",
				),
	);
}

function ligneIngredient(ingredient = { aliment: "", quantite: "" }) {
	const ligne = el(
		"li",
		{},
		el("input", {
			class: "ingredient-aliment",
			list: "liste-aliments",
			maxlength: "80",
			value: ingredient.aliment,
			placeholder: "Aliment",
			"aria-label": "Aliment",
			autocomplete: "off",
			oninput: afficherApercuRecette,
		}),
		el("input", {
			class: "ingredient-quantite",
			type: "number",
			inputmode: "decimal",
			min: "0.1",
			step: "any",
			value: String(ingredient.quantite),
			placeholder: "g",
			"aria-label": "Quantité en grammes",
			oninput: afficherApercuRecette,
		}),
		el(
			"button",
			{
				type: "button",
				class: "retirer",
				"aria-label": "Retirer l'ingrédient",
				onclick: () => {
					ligne.remove();
					afficherApercuRecette();
				},
			},
			"×",
		),
	);
	return ligne;
}

function ingredientsSaisis() {
	return [...$("#ingredients").children]
		.map((ligne) => ({
			aliment: ligne.querySelector(".ingredient-aliment").value.trim(),
			quantite: ligne.querySelector(".ingredient-quantite").value,
		}))
		.filter((i) => i.aliment);
}

function afficherApercuRecette() {
	const portions = Number($("#champ-portions").value) || 1;
	const inconnus = [];
	const valeurs = ingredientsSaisis().map((i) => {
		const aliment = parNom(app.etat.aliments, i.aliment);
		if (!aliment) inconnus.push(i.aliment);
		return aliment
			? multiplier(aliment.pour100g, (Number(i.quantite) || 0) / 100)
			: vides();
	});
	remplacerContenu(
		$("#apercu-recette"),
		valeurs.length
			? `${resume(multiplier(additionner(valeurs), 1 / portions))} la portion`
			: "",
		inconnus.length
			? el(
					"span",
					{ class: "alerte" },
					` Pas dans les aliments : ${inconnus.join(", ")}.`,
				)
			: null,
	);
}

function ouvrirRecette(recette = null) {
	if (app.horsLigne) {
		notifier("Hors ligne : les recettes se modifient avec la connexion.", true);
		return;
	}
	app.recette = recette?.nom ?? null;
	const form = $("#form-recette");
	form.reset();
	form.querySelector(".erreur").textContent = "";
	$("#titre-dialogue-recette").textContent = recette
		? "Modifier la recette"
		: "Nouvelle recette";
	$("#champ-nom-recette").value = recette?.nom ?? "";
	$("#champ-portions").value = String(recette?.portions ?? 1);
	$("#bouton-supprimer-recette").hidden = !recette;
	remplacerContenu(
		$("#ingredients"),
		(recette?.ingredients ?? [undefined]).map((i) => ligneIngredient(i)),
	);
	afficherApercuRecette();
	$("#dialogue-recette").showModal();
	if (!recette) $("#champ-nom-recette").focus();
}

async function enregistrerRecette(evenement) {
	evenement.preventDefault();
	const erreur = evenement.target.querySelector(".erreur");
	erreur.textContent = "";
	const fait = await modifier(
		"enregistrer-recette",
		{
			recette: {
				nom: $("#champ-nom-recette").value,
				portions: $("#champ-portions").value,
				ingredients: ingredientsSaisis(),
				ancienNom: app.recette,
			},
		},
		"Recette enregistrée.",
		(message) => {
			erreur.textContent = message;
		},
	);
	if (fait) $("#dialogue-recette").close();
}

async function supprimerRecette() {
	if (
		!confirm(
			`Supprimer la recette ${app.recette} ? Ce qui en a été mangé reste dans le journal.`,
		)
	) {
		return;
	}
	const fait = await modifier(
		"supprimer-recette",
		{ nom: app.recette },
		"Recette supprimée.",
	);
	if (fait) $("#dialogue-recette").close();
}

// ---------------------------------------------------------------------------
// Profils
// ---------------------------------------------------------------------------

const CHAMPS_OBJECTIFS = [
	"kcal",
	"proteines",
	"glucides",
	"lipides",
	"fibres",
	"sucresMax",
	"selMax",
	"poidsCible",
];

/**
 * Formulaire d'un profil.
 * @param profil Le profil dont on change les objectifs, ou null pour en créer un
 * @param oblige Premier profil : le formulaire ne peut pas être annulé
 */
function ouvrirProfil(profil = null, oblige = false) {
	fermerMenu();
	const form = $("#form-profil");
	form.reset();
	form.querySelector(".erreur").textContent = "";
	$("#titre-dialogue-profil").textContent = profil
		? `Objectifs de ${profil.nom}`
		: oblige
			? "Qui utilise l'app ?"
			: "Nouvelle personne";
	$("#aide-profil").textContent = oblige
		? "Crée ton profil pour commencer (d'autres personnes pourront s'ajouter depuis le menu). Objectifs par jour ; laisser vide : pas d'objectif."
		: "Objectifs par jour ; laisser vide : pas d'objectif.";
	$("#champ-nom-profil").value = profil?.nom ?? "";
	$("#champ-nom-profil").disabled = Boolean(profil);
	for (const champ of CHAMPS_OBJECTIFS) {
		form.elements[champ].value = profil?.objectifs[champ] ?? "";
	}
	$("#bouton-annuler-profil").hidden = oblige;
	$("#dialogue-profil").dataset.oblige = oblige ? "oui" : "";
	$("#dialogue-profil").showModal();
	if (!profil) $("#champ-nom-profil").focus();
}

async function enregistrerProfil(evenement) {
	evenement.preventDefault();
	const form = evenement.target;
	const erreur = form.querySelector(".erreur");
	erreur.textContent = "";
	const resultat = await modifier(
		"enregistrer-profil",
		{
			profil: {
				nom: $("#champ-nom-profil").value,
				objectifs: Object.fromEntries(
					CHAMPS_OBJECTIFS.map((c) => [c, form.elements[c].value]),
				),
			},
		},
		null,
		(message) => {
			erreur.textContent = message;
		},
	);
	if (!resultat) return;
	$("#dialogue-profil").close();
	notifier(`Profil de ${resultat.nom} enregistré.`);
	choisirProfil(resultat.nom);
}

function rendreChoixProfil() {
	const { profils } = app.etat;
	const actif = profilActif();
	$("#choix-profil").hidden = profils.length < 2;
	remplacerContenu(
		$("#choix-profil"),
		profils.map((p) =>
			el(
				"button",
				{
					type: "button",
					class: "puce",
					"aria-pressed": String(p.nom === actif?.nom),
					onclick: () => choisirProfil(p.nom),
				},
				p.nom,
			),
		),
	);
}

// ---------------------------------------------------------------------------
// Rendu et navigation
// ---------------------------------------------------------------------------

function changerVue(vue) {
	app.vue = vue;
	ecrireStockage(CLES.vue, vue);
	rendre();
	window.scrollTo(0, 0);
}

/** Passe à la vue voisine (-1 : précédente, 1 : suivante) ; faux s'il n'y en a pas. */
function changerVueVoisine(sens) {
	const vue = voisin(VUES, app.vue, sens);
	if (vue) changerVue(vue);
	return Boolean(vue);
}

function rendre() {
	if (!app.etat) return;
	const profil = profilActif();
	rendreChoixProfil();
	for (const vue of VUES) $(`#vue-${vue}`).hidden = app.vue !== vue;
	for (const bouton of document.querySelectorAll("#onglets button")) {
		bouton.setAttribute("aria-pressed", String(bouton.dataset.vue === app.vue));
	}
	$("#titre").textContent = profil ? `Cuisine · ${profil.nom}` : "Cuisine";
	remplacerContenu(
		$("#liste-categories"),
		app.etat.options.categories.map((c) => el("option", { value: c })),
	);
	remplacerContenu(
		$("#liste-aliments"),
		app.etat.aliments.map((a) => el("option", { value: a.nom })),
	);
	if (!profil) {
		const vide = el(
			"div",
			{ class: "vide" },
			el("p", {}, "Aucun profil pour l'instant."),
			el(
				"button",
				{
					type: "button",
					class: "bouton-principal",
					onclick: () => ouvrirProfil(null, true),
				},
				"Créer mon profil",
			),
		);
		remplacerContenu($(`#vue-${app.vue} > div:last-child`), vide);
		if (app.vue === "journal") $(".navigation-jour").hidden = true;
		return;
	}
	$(".navigation-jour").hidden = false;
	if (app.vue === "journal") rendreJournal(profil);
	else if (app.vue === "poids") rendrePoids(profil);
	else rendreRecettes();
}

// ---------------------------------------------------------------------------
// Connexion : compte (shared/connexion.js, projet droits)
// ---------------------------------------------------------------------------

function afficherEcran(nom) {
	const connecte = nom === "app";
	$("#ecran-connexion").hidden = connecte;
	$("#ecran-app").hidden = !connecte;
	$("#onglets").hidden = !connecte;
	for (const id of ["#bouton-actualiser", "#bouton-menu"]) {
		$(id).hidden = !connecte;
	}
	if (connecte) {
		rendre();
		if (!app.etat.profils.length && !$("#dialogue-profil").open) {
			ouvrirProfil(null, true);
		}
	} else {
		$("#titre").textContent = "Cuisine";
	}
}

/**
 * Écran de connexion : nouveau compte (prénom), ou appareil à connecter à un compte existant.
 * @param message Message à afficher (ex : session expirée)
 * @param invitation Code d'un lien de connexion (QR code d'un autre appareil), utilisé aussitôt
 */
function afficherConnexion(message = "", invitation = null) {
	afficherEcran("connexion");
	$("#refus").hidden = true;
	$("#connexion").hidden = false;
	afficherFormulaireConnexion($("#connexion"), {
		nomApp: "Cuisine",
		message,
		invitation,
		surConnecte: (compte) => {
			notifier(`Bienvenue ${compte.prenom} !`);
			chargerApresConnexion();
		},
	});
}

/** Compte connecté sans accès à Cuisine : la session est gardée (elle sert aux autres apps). */
function afficherRefus(message) {
	app.etat = null;
	ecrireStockage(CLES.etat, null);
	afficherEcran("connexion");
	$("#connexion").hidden = true;
	$("#refus").hidden = false;
	$("#message-refus").textContent = message;
}

/** Premier chargement du journal, une fois l'appareil connecté. */
async function chargerApresConnexion() {
	app.etat = null;
	ecrireStockage(CLES.etat, null);
	try {
		appliquerEtat(await appelerApi("etat"));
		afficherEcran("app");
	} catch (erreur) {
		signalerErreur(erreur);
	}
}

/** Session refusée : oublie la connexion de l'appareil et ses données, puis affiche la connexion. */
function deconnecter(message = "") {
	fermerMenu();
	oublierConnexion();
	app.etat = null;
	app.joursAnciens.clear();
	ecrireStockage(CLES.etat, null);
	for (const dialogue of document.querySelectorAll("dialog[open]")) {
		dialogue.close();
	}
	afficherConnexion(message);
}

async function seDeconnecter() {
	fermerMenu();
	if (
		!confirm(
			"Te déconnecter de cet appareil ? Les autres apps le seront aussi (même compte).",
		)
	) {
		return;
	}
	await deconnecterAppareil();
	deconnecter();
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
	if (app.horsLigne) {
		afficherBandeau(
			"hors-ligne",
			"Hors ligne : derniers chiffres connus, en lecture seule.",
			{ libelle: "Réessayer", faire: () => actualiser() },
		);
	} else {
		masquerBandeau();
	}
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

/** Retour sur l'app un autre jour : le journal passe au nouveau jour s'il montrait « aujourd'hui ». */
function suivreLeJour() {
	const jour = versChampDate(aujourdhui());
	if (jour === app.aujourdhui) return;
	if (app.jour === app.aujourdhui) app.jour = jour;
	app.aujourdhui = jour;
}

function brancherEvenements() {
	for (const bouton of document.querySelectorAll("#onglets button")) {
		bouton.addEventListener("click", () => changerVue(bouton.dataset.vue));
	}
	// Balayer l'écran vers la gauche ou la droite passe à la vue suivante ou précédente
	brancherBalayage($("#ecran-app"), changerVueVoisine, {
		anime: () => $(`#vue-${app.vue}`),
	});
	$("#jour-precedent").addEventListener("click", () =>
		allerAuJour(decalerJour(app.jour, -1)),
	);
	$("#jour-suivant").addEventListener("click", () =>
		allerAuJour(decalerJour(app.jour, 1)),
	);
	$("#champ-jour").addEventListener("change", (e) => {
		if (e.target.value) allerAuJour(e.target.value);
	});

	$("#champ-recherche").addEventListener("input", rendreResultats);
	$("#champ-recherche").addEventListener("keydown", (e) => {
		if (e.key !== "Enter") return;
		e.preventDefault();
		$("#resultats .resultat")?.click();
	});
	$("#bouton-retour-recherche").addEventListener("click", () => {
		afficherEtapeAjout("recherche");
		$("#champ-recherche").focus();
	});
	$("#etape-quantite").addEventListener("submit", enregistrerAjout);
	$("#champ-quantite").addEventListener("input", afficherApercuAjout);
	$("#dialogue-ajout").addEventListener("close", () => {
		app.ajout = null;
	});
	$("#bouton-off").addEventListener("click", () => {
		const texte = $("#champ-recherche").value.trim();
		ouvrirOff(texte);
	});
	$("#bouton-creer-aliment").addEventListener("click", () =>
		ouvrirFormulaireAliment({ nom: $("#champ-recherche").value.trim() }),
	);
	const scan = scannerDisponible();
	for (const id of ["#bouton-scanner", "#bouton-scanner-off"]) {
		$(id).hidden = !scan;
		$(id).addEventListener("click", scanner);
	}
	$("#form-off").addEventListener("submit", chercherOff);
	$("#form-aliment").addEventListener("submit", enregistrerAliment);

	$("#form-entree").addEventListener("submit", enregistrerEntree);
	$("#champ-quantite-entree").addEventListener("input", afficherApercuEntree);
	$("#bouton-supprimer-entree").addEventListener("click", supprimerEntree);

	$("#form-recette").addEventListener("submit", enregistrerRecette);
	$("#champ-portions").addEventListener("input", afficherApercuRecette);
	$("#bouton-ajouter-ingredient").addEventListener("click", () => {
		const ligne = ligneIngredient();
		$("#ingredients").append(ligne);
		ligne.querySelector("input").focus();
	});
	$("#bouton-supprimer-recette").addEventListener("click", supprimerRecette);

	$("#form-profil").addEventListener("submit", enregistrerProfil);
	// Premier profil : Échap ne ferme pas le formulaire.
	$("#dialogue-profil").addEventListener("cancel", (e) => {
		if ($("#dialogue-profil").dataset.oblige) e.preventDefault();
	});
	$("#menu-objectifs").addEventListener("click", () =>
		ouvrirProfil(profilActif()),
	);
	$("#menu-nouveau-profil").addEventListener("click", () => ouvrirProfil());

	for (const bouton of document.querySelectorAll("[data-fermer]")) {
		bouton.addEventListener("click", () => bouton.closest("dialog").close());
	}
	$("#bouton-actualiser").addEventListener("click", () => actualiser());
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
		ouvrirInvitation("Cuisine");
	});
	$("#menu-autre-appareil").addEventListener("click", async () => {
		fermerMenu();
		try {
			await connecterUnAutreAppareil("Cuisine");
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	});
	brancherBiometrie($("#menu-biometrie"), "Cuisine");
	$("#bouton-autre-compte").addEventListener("click", async () => {
		await deconnecterAppareil();
		afficherConnexion();
	});
	$("#menu-installer").addEventListener("click", fermerMenu);
	brancherInstallation($("#menu-installer"), { connexion: true });
	$("#bouton-signalement").addEventListener("click", () => {
		fermerMenu();
		ouvrirSignalement({ app: "Cuisine", prenom: profilActif()?.nom });
	});
	$("#menu-deconnecter").addEventListener("click", seDeconnecter);
	// Retour sur l'app : un autre téléphone a peut-être ajouté des repas entre-temps.
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "visible") return;
		suivreLeJour();
		actualiser({ silencieux: true });
		chercherMiseAJour();
	});
	window.addEventListener("online", () => actualiser({ silencieux: true }));
}

function demarrer() {
	afficherVersions();
	brancherEvenements();
	enregistrerServiceWorker();
	// Ancienne connexion par clé (avant les comptes) : plus utilisée.
	ecrireStockage(CLES.ancienneCle, null);
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
	if (app.etat) afficherEcran("app");
	actualiser({ silencieux: true }).then(() => {
		if (app.etat) afficherEcran("app");
		else if (lireSession() && $("#refus").hidden) {
			afficherConnexion(
				"Impossible de charger le journal. Vérifie ta connexion.",
			);
		}
	});
}

demarrer();
