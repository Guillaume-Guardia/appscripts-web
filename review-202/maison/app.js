import { creerApi, ErreurReseau } from "../shared/api.js";
import { brancherBalayage, voisin } from "../shared/balayage.js";
import {
	afficherConnexion as afficherFormulaireConnexion,
	brancherBiometrie,
	brancherBoutonPortail,
	compteConnecte,
	connecterUnAutreAppareil,
	deconnecter as deconnecterAppareil,
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
import { reduireImage } from "../shared/image.js";
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
import { calculerProchaineFois } from "./prochaine-fois.js";
import { calculerStats } from "./stats.js";
import { taillesDuProduit } from "./tailles.js";

// ---------------------------------------------------------------------------
// État de l'app
// ---------------------------------------------------------------------------

const CLES = {
	etat: "maison.etat",
	onglet: "maison.onglet",
	versionApi: "maison.versionApi",
	/** Vignettes des photos, par lien du fichier : une photo ne change jamais de lien. */
	miniatures: "maison.miniatures",
};

const ONGLETS = ["entretiens", "objets", "stats"];

const TAILLE_MAX_FACTURE = 10 * 1024 * 1024;
const TAILLE_PHOTO_PX = 1600;
const TAILLE_MINIATURE_PX = 160;

const app = {
	/** { moi, entretiens, objets, parametrageDecote, categories, categoriesDossiers } renvoyé par l'API. */
	etat: null,
	onglet: ONGLETS.includes(lireStockage(CLES.onglet))
		? lireStockage(CLES.onglet)
		: "entretiens",
	/** Ligne en cours de modification dans un formulaire (null : nouvel objet). */
	edition: null,
	/** Photo prise ou choisie dans le formulaire d'objet, pas encore envoyée. */
	photoSaisie: null,
	horsLigne: false,
	/**
	 * Modifications affichées avant la réponse de l'API (voir modifierEnFond) : chacune transforme
	 * l'état du serveur en l'état affiché.
	 */
	provisoires: [],
	versionApi: lireStockage(CLES.versionApi),
	miniatures: lireStockageJson(CLES.miniatures) ?? {},
	/** Liens déjà demandés à l'API : une photo sans vignette ne la redemande pas à chaque état. */
	miniaturesDemandees: new Set(),
};

const etatEnCache = lireStockageJson(CLES.etat);
if (
	lireSession() &&
	etatEnCache?.moi?.id === compteConnecte()?.id &&
	Array.isArray(etatEnCache.entretiens)
) {
	app.etat = etatEnCache;
}
/** État renvoyé par l'API, sans les modifications en attente (app.etat les ajoute). */
let etatServeur = app.etat;
/** Modifications en attente de l'API, envoyées une à une dans l'ordre (voir modifierEnFond). */
let fileModifications = Promise.resolve();

// ---------------------------------------------------------------------------
// API (Web App Apps Script, projet maison)
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

/** Plus d'état (déconnexion) : les modifications en attente ne s'affichent plus. */
function oublierEtat() {
	etatServeur = null;
	app.etat = null;
	app.provisoires = [];
}

function appliquerEtat(etat) {
	etatServeur = etat;
	app.etat = avecProvisoires(etat);
	app.horsLigne = false;
	ecrireStockage(CLES.etat, JSON.stringify(etat));
	afficherBandeauHorsLigne();
	rendre();
	chargerMiniatures();
}

/** Charge les vignettes qui manquent, sans gêner l'affichage ; l'API les renvoie toutes en un appel. */
async function chargerMiniatures() {
	const liens = app.etat.objets.flatMap((o) => o.photo?.url || []);
	const manquants = liens.filter(
		(lien) => !app.miniatures[lien] && !app.miniaturesDemandees.has(lien),
	);
	if (manquants.length === 0) return;
	for (const lien of manquants) app.miniaturesDemandees.add(lien);
	try {
		const recues = await appelerApi("miniatures", {}, { discret: true });
		app.miniatures = Object.fromEntries(
			liens.flatMap((lien) => {
				const miniature = recues[lien] ?? app.miniatures[lien];
				return miniature ? [[lien, miniature]] : [];
			}),
		);
		ecrireStockage(CLES.miniatures, JSON.stringify(app.miniatures));
		rendre();
	} catch {
		// Sans vignette, l'objet garde son emplacement vide : rien à signaler.
		for (const lien of manquants) app.miniaturesDemandees.delete(lien);
	}
}

function passerHorsLigne() {
	app.horsLigne = true;
	afficherBandeauHorsLigne();
}

async function actualiser({ silencieux = false } = {}) {
	if (!lireSession()) return;
	const bouton = $("#bouton-actualiser");
	bouton.classList.add("tourne");
	try {
		appliquerEtat(
			await appelerApi(
				"etat",
				{},
				{ discret: silencieux && Boolean(app.etat) },
			),
		);
	} catch (erreur) {
		if (erreur instanceof ErreurReseau) {
			passerHorsLigne();
			if (!silencieux) notifier(erreur.message, true);
		} else if (estSessionRefusee(erreur)) {
			deconnecter(erreur.message);
		} else {
			notifier(erreur.message, true);
		}
	} finally {
		bouton.classList.remove("tourne");
	}
}

const avecProvisoires = (etat) =>
	app.provisoires.reduce((affiche, provisoire) => provisoire(affiche), etat);

function afficherProvisoires() {
	if (!etatServeur) return;
	app.etat = avecProvisoires(etatServeur);
	rendre();
}

/** Transformation de l'état qui change une liste (entretiens, objets…). */
const avecListe = (cle, changer) => (etat) => ({
	...etat,
	[cle]: changer(etat[cle]),
});

/**
 * Ligne actuelle d'un entretien ou d'un objet, lue au moment de l'envoi dans le dernier état du
 * serveur : une suppression envoyée avant décale les lignes suivantes.
 * @param liste « entretiens » ou « objets » ; champ : « tache » ou « produit »
 */
function ligneActuelle(liste, champ, valeur, ligne) {
	const trouve = etatServeur?.[liste].find(
		(e) => normaliser(e[champ]) === normaliser(valeur),
	);
	return trouve?.ligne ?? ligne;
}

/**
 * Modification affichée aussitôt, puis envoyée à l'API en arrière-plan : l'app n'attend pas les
 * quelques secondes de la Web App. Les envois partent un à un, dans l'ordre ; chaque réponse
 * remplace l'affichage provisoire par l'état du serveur. En cas d'échec, la modification disparaît
 * et un message l'explique (skill enregistrement-en-fond).
 * @param parametres () => les paramètres de l'appel, calculés au moment de l'envoi (lignes à jour)
 * @param provisoire (etat) => l'état avec la modification, affiché en attendant
 * @param echec début du message d'erreur (ex : « « Vélo » n'a pas été enregistré : »)
 * @return Faux si l'app est hors ligne (rien n'est fait)
 */
function modifierEnFond(action, parametres, provisoire, echec) {
	if (app.horsLigne) {
		notifier("Hors ligne : réessaie avec la connexion.", true);
		return false;
	}
	app.provisoires.push(provisoire);
	afficherProvisoires();
	const retirer = () => {
		app.provisoires = app.provisoires.filter((p) => p !== provisoire);
	};
	fileModifications = fileModifications.then(async () => {
		try {
			const { etat } = await appelerApi(action, parametres(), {
				discret: true,
			});
			retirer();
			// Déconnecté entre-temps : rien à afficher.
			if (etatServeur) appliquerEtat(etat);
		} catch (erreur) {
			retirer();
			afficherProvisoires();
			if (estSessionRefusee(erreur)) {
				deconnecter(erreur.message);
				return;
			}
			notifier(`${echec} ${erreur.message}`, true);
			if (erreur instanceof ErreurReseau) passerHorsLigne();
		}
	});
	return true;
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

const euros = new Intl.NumberFormat("fr-FR", {
	style: "currency",
	currency: "EUR",
});
const eurosRonds = new Intl.NumberFormat("fr-FR", {
	style: "currency",
	currency: "EUR",
	maximumFractionDigits: 0,
});
const pourcent = new Intl.NumberFormat("fr-FR", {
	style: "percent",
	maximumFractionDigits: 0,
});
const nombreDecimal = (nombre) => String(nombre).replace(".", ",");

const dateCourte = (texte) => versDate(texte).toLocaleDateString("fr-FR");

/** « chaque semaine », « tous les 3 mois », « tous les 2 ans ». */
function decrireFrequence({ frequence, unite }) {
	if (frequence === null || unite === null) return "Fréquence à compléter";
	if (frequence === 1) {
		return unite === "an" ? "Chaque année" : `Chaque ${unite}`;
	}
	const nombre = nombreDecimal(frequence);
	if (unite === "semaine") return `Toutes les ${nombre} semaines`;
	if (unite === "mois") return `Tous les ${nombre} mois`;
	return `Tous les ${nombre} ${unite}s`;
}

/** Échéance en mots, et si elle est dépassée. */
function decrireEcheance(prochaineFois) {
	if (!prochaineFois) return { texte: "Date à venir", retard: false };
	const jours = joursEntre(aujourdhui(), versDate(prochaineFois));
	if (jours < 0) {
		return { texte: `En retard de ${pluriel(-jours, "jour")}`, retard: true };
	}
	if (jours === 0) return { texte: "Aujourd'hui", retard: false };
	if (jours === 1) return { texte: "Demain", retard: false };
	return {
		texte: `Le ${dateCourte(prochaineFois)} (dans ${pluriel(jours, "jour")})`,
		retard: false,
	};
}

// ---------------------------------------------------------------------------
// Onglet Entretiens
// ---------------------------------------------------------------------------

function carteEntretien(entretien) {
	const echeance = entretien.actif
		? decrireEcheance(entretien.prochaineFois)
		: { texte: "Désactivé : pas de tâche", retard: false };
	return el(
		"div",
		{ class: `carte ligne-carte${entretien.actif ? "" : " inactive"}` },
		el(
			"button",
			{
				type: "button",
				class: "contenu-carte",
				disabled: entretien.provisoire,
				onclick: () => ouvrirEntretien(entretien),
			},
			el("h3", {}, entretien.tache),
			el("p", { class: "detail" }, decrireFrequence(entretien)),
			el(
				"p",
				{ class: `echeance${echeance.retard ? " retard" : ""}` },
				echeance.texte,
			),
		),
		el(
			"label",
			{
				class: "interrupteur",
				title: entretien.actif ? "Désactiver" : "Activer",
			},
			el("input", {
				type: "checkbox",
				checked: entretien.actif,
				disabled: entretien.provisoire,
				"aria-label": `${entretien.tache} activé`,
				onchange: (e) => basculerEntretien(entretien, e.target.checked),
			}),
			el("span", { class: "curseur", "aria-hidden": "true" }),
		),
	);
}

function rendreEntretiens() {
	const entretiens = app.etat.entretiens;
	const parDate = (a, b) =>
		(a.prochaineFois ?? "9999").localeCompare(b.prochaineFois ?? "9999");
	const actifs = entretiens.filter((e) => e.actif).sort(parDate);
	const inactifs = entretiens.filter((e) => !e.actif);
	remplacerContenu(
		$("#liste-entretiens"),
		entretiens.length === 0
			? el("p", { class: "vide" }, "Aucun entretien pour l'instant.")
			: null,
		actifs.map(carteEntretien),
		inactifs.length > 0
			? el("h2", { class: "titre-section" }, "Désactivés")
			: null,
		inactifs.map(carteEntretien),
	);
}

/** Interrupteur d'un entretien : aussitôt, envoyé en arrière-plan. */
function basculerEntretien(entretien, actif) {
	const lance = modifierEnFond(
		"activer-entretien",
		() => ({
			ligne: ligneActuelle(
				"entretiens",
				"tache",
				entretien.tache,
				entretien.ligne,
			),
			attendu: entretien.tache,
			actif,
		}),
		avecListe("entretiens", (liste) =>
			liste.map((e) => (e.tache === entretien.tache ? { ...e, actif } : e)),
		),
		`« ${entretien.tache} » n'a pas été ${actif ? "activé" : "désactivé"} :`,
	);
	if (!lance) {
		rendre();
		return;
	}
	notifier(
		actif ? "Entretien activé." : "Entretien désactivé : tâche retirée.",
	);
}

function ouvrirEntretien(entretien = null) {
	app.edition = entretien;
	$("#titre-dialogue-entretien").textContent = entretien
		? "Modifier l'entretien"
		: "Ajouter un entretien";
	$("#champ-tache").value = entretien?.tache ?? "";
	$("#champ-frequence").value = entretien?.frequence ?? "";
	$("#champ-unite").value = entretien?.unite ?? "mois";
	$("#champ-derniere").value = entretien?.derniereFois ?? "";
	$("#champ-prochaine").value = entretien?.prochaineFois ?? "";
	$("#aide-entretien").textContent = entretien
		? "La tâche Google apparaît le jour de la prochaine fois."
		: "Sans aucune date, la tâche Google est créée aujourd'hui.";
	$("#bouton-supprimer-entretien").hidden = !entretien;
	$("#form-entretien .erreur").textContent = "";
	$("#dialogue-entretien").showModal();
}

/**
 * Recalcule Prochaine fois quand Dernière fois, la fréquence ou l'unité change. Tant qu'il manque
 * l'une d'elles, une date déjà enregistrée est gardée ; à l'ajout, le champ se vide.
 */
function actualiserProchaineFois() {
	const derniere = $("#champ-derniere").value;
	const frequence = Number($("#champ-frequence").value);
	if (derniere && frequence > 0) {
		$("#champ-prochaine").value = versChampDate(
			calculerProchaineFois(
				versDate(derniere),
				frequence,
				$("#champ-unite").value,
			),
		);
	} else if (!app.edition) {
		$("#champ-prochaine").value = "";
	}
}

/** Entretien ajouté ou modifié : affiché aussitôt, enregistré en arrière-plan. */
function enregistrerEntretien(e) {
	e.preventDefault();
	const entretien = {
		tache: $("#champ-tache").value,
		frequence: $("#champ-frequence").value,
		unite: $("#champ-unite").value,
		derniereFois: $("#champ-derniere").value,
		prochaineFois: $("#champ-prochaine").value,
	};
	const tache = entretien.tache.trim();
	if (!tache) {
		$("#form-entretien .erreur").textContent = "Indique la tâche.";
		return;
	}
	const edition = app.edition;
	const frequence =
		Number(String(entretien.frequence).replace(",", ".")) || null;
	const unite = entretien.unite || null;
	const prochaine =
		entretien.prochaineFois ||
		(entretien.derniereFois && frequence && unite
			? versChampDate(
					calculerProchaineFois(
						versDate(entretien.derniereFois),
						frequence,
						unite,
					),
				)
			: null);
	const affiche = {
		ligne: edition?.ligne ?? null,
		tache,
		actif: edition?.actif ?? true,
		frequence,
		unite,
		derniereFois: entretien.derniereFois || null,
		prochaineFois: prochaine,
		tacheOuverte: edition?.tacheOuverte ?? false,
		provisoire: !edition,
	};
	const lance = modifierEnFond(
		edition ? "modifier-entretien" : "creer-entretien",
		() =>
			edition
				? {
						ligne: ligneActuelle(
							"entretiens",
							"tache",
							edition.tache,
							edition.ligne,
						),
						attendu: edition.tache,
						entretien,
					}
				: { entretien },
		avecListe("entretiens", (liste) =>
			edition
				? liste.map((x) => (x.tache === edition.tache ? affiche : x))
				: [...liste, affiche],
		),
		`« ${tache} » n'a pas été enregistré :`,
	);
	if (!lance) return;
	$("#dialogue-entretien").close();
	notifier(edition ? "Entretien enregistré." : "Entretien ajouté.");
}

/** Suppression d'un entretien (et de sa tâche Google) : aussitôt, enregistrée en arrière-plan. */
function supprimerEntretien() {
	const { ligne, tache } = app.edition;
	if (!confirm(`Supprimer « ${tache} » et sa tâche Google ?`)) return;
	const lance = modifierEnFond(
		"supprimer-entretien",
		() => ({
			ligne: ligneActuelle("entretiens", "tache", tache, ligne),
			attendu: tache,
		}),
		avecListe("entretiens", (liste) => liste.filter((e) => e.tache !== tache)),
		`« ${tache} » n'a pas été supprimé :`,
	);
	if (!lance) return;
	$("#dialogue-entretien").close();
	notifier("Entretien supprimé.");
}

// ---------------------------------------------------------------------------
// Onglet Objets
// ---------------------------------------------------------------------------

function carteObjet(objet) {
	const details = [objet.marque, objet.taille].filter(Boolean).join(" · ");
	const sousGarantie =
		objet.finGarantie && versDate(objet.finGarantie) >= aujourdhui();
	const miniature = objet.photo?.url && app.miniatures[objet.photo.url];
	return el(
		"button",
		{
			type: "button",
			class: "carte carte-objet",
			disabled: objet.provisoire,
			onclick: () => ouvrirObjet(objet),
		},
		objet.photo
			? el(miniature ? "img" : "span", {
					class: "miniature",
					src: miniature ? `data:image/jpeg;base64,${miniature}` : null,
					alt: miniature ? "" : null,
				})
			: null,
		el(
			"div",
			{ class: "texte-objet" },
			el("h3", {}, objet.produit),
			details ? el("p", { class: "detail" }, details) : null,
			sousGarantie
				? el(
						"p",
						{ class: "garantie" },
						`Sous garantie jusqu'au ${dateCourte(objet.finGarantie)}`,
					)
				: null,
			objet.facture ? el("p", { class: "detail" }, "Facture jointe") : null,
			objet.prixActuel === null
				? el("p", { class: "a-completer" }, "À compléter")
				: null,
		),
		el(
			"div",
			{ class: "prix-objet" },
			el(
				"strong",
				{},
				objet.prixActuel === null ? "—" : euros.format(objet.prixActuel),
			),
			objet.prixAchat === null
				? null
				: el("small", {}, `Acheté ${euros.format(objet.prixAchat)}`),
		),
	);
}

function rendreObjets() {
	const filtre = $("#filtre-categorie");
	const choix = filtre.value;
	remplacerContenu(
		filtre,
		el("option", { value: "" }, "Toutes les catégories"),
		app.etat.categories.map((nom) => el("option", { value: nom }, nom)),
	);
	filtre.value = app.etat.categories.includes(choix) ? choix : "";
	rendreListeObjets();
}

function rendreListeObjets() {
	const recherche = normaliser($("#recherche-objets").value);
	const categorie = $("#filtre-categorie").value;
	const objets = app.etat.objets
		.filter(
			(objet) =>
				(!categorie || objet.categorie === categorie) &&
				normaliser(
					[objet.produit, objet.marque, objet.categorie].join(" "),
				).includes(recherche),
		)
		.sort(
			(a, b) =>
				a.categorie.localeCompare(b.categorie, "fr") ||
				a.produit.localeCompare(b.produit, "fr"),
		);
	const groupes = new Map();
	for (const objet of objets) {
		groupes.set(objet.categorie, [
			...(groupes.get(objet.categorie) ?? []),
			objet,
		]);
	}
	remplacerContenu(
		$("#liste-objets"),
		objets.length === 0 ? el("p", { class: "vide" }, "Aucun objet.") : null,
		[...groupes].flatMap(([nom, objetsDuGroupe]) => [
			el("h2", { class: "titre-section" }, nom || "Sans catégorie"),
			...objetsDuGroupe.map(carteObjet),
		]),
	);
}

/** Catégories du formulaire : les dossiers Drive, et celle de la ligne si elle n'en a pas. */
function remplirCategories(categorie) {
	const dossiers = app.etat.categoriesDossiers;
	const noms =
		categorie && !dossiers.includes(categorie)
			? [categorie, ...dossiers]
			: dossiers;
	remplacerContenu(
		$("#champ-categorie"),
		el("option", { value: "" }, "Choisir…"),
		noms.map((nom) => el("option", { value: nom }, nom)),
	);
	$("#champ-categorie").value = categorie;
}

/** Taille saisie, dans le champ affiché pour le produit. */
function tailleSaisie() {
	const liste = $("#champ-taille-liste");
	return liste.hidden ? $("#champ-taille").value : liste.value;
}

/** Liste des tailles du produit, ou champ libre ; une taille hors liste y reste proposée. */
function afficherChampTaille(taille) {
	const tailles = taillesDuProduit(
		$("#champ-categorie").value,
		$("#champ-produit").value,
		normaliser,
	);
	const liste = $("#champ-taille-liste");
	const libre = $("#champ-taille");
	liste.hidden = !tailles;
	libre.hidden = Boolean(tailles);
	libre.value = taille;
	if (!tailles) return;
	const options = taille && !tailles.includes(taille) ? [taille] : [];
	remplacerContenu(
		liste,
		el("option", { value: "" }, "Non précisée"),
		[...options, ...tailles].map((t) => el("option", { value: t }, t)),
	);
	liste.value = taille;
}

function afficherLienFichier(selecteur, libelle, fichier) {
	remplacerContenu(
		$(selecteur),
		fichier
			? [
					libelle,
					fichier.url
						? el(
								"a",
								{ href: fichier.url, target: "_blank", rel: "noopener" },
								fichier.nom,
							)
						: fichier.nom,
				]
			: null,
	);
}

function afficherApercuPhoto(source) {
	const apercu = $("#apercu-photo");
	apercu.hidden = !source;
	if (source) apercu.src = source;
	else apercu.removeAttribute("src");
}

function ouvrirObjet(objet = null) {
	app.edition = objet;
	$("#titre-dialogue-objet").textContent = objet
		? "Modifier l'objet"
		: "Ajouter un objet";
	$("#champ-produit").value = objet?.produit ?? "";
	remplirCategories(objet?.categorie ?? "");
	$("#champ-marque").value = objet?.marque ?? "";
	afficherChampTaille(objet?.taille ?? "");
	$("#champ-date-achat").value = objet?.dateAchat ?? "";
	$("#champ-prix-achat").value = objet?.prixAchat ?? "";
	$("#champ-facture").value = "";
	app.photoSaisie = null;
	afficherLienFichier("#lien-facture", "Facture actuelle : ", objet?.facture);
	afficherLienFichier("#lien-photo", "Photo actuelle : ", objet?.photo);
	const miniature = objet?.photo?.url && app.miniatures[objet.photo.url];
	afficherApercuPhoto(miniature ? `data:image/jpeg;base64,${miniature}` : null);
	$("#info-prix-actuel").textContent = !objet
		? ""
		: objet.prixActuel === null
			? "Valeur actuelle inconnue : il manque le prix, la date d'achat ou la décote de la catégorie."
			: `Valeur actuelle : ${euros.format(objet.prixActuel)}`;
	$("#bouton-supprimer-objet").hidden = !objet;
	$("#form-objet .erreur").textContent = "";
	$("#dialogue-objet").showModal();
}

/** Facture choisie dans le formulaire : { nom, type, base64 }, ou undefined. */
async function factureChoisie() {
	const fichier = $("#champ-facture").files[0];
	if (!fichier) return undefined;
	if (fichier.size > TAILLE_MAX_FACTURE) {
		throw new Error("Facture trop lourde (10 Mo au plus).");
	}
	const base64 = await new Promise((resoudre, rejeter) => {
		const lecteur = new FileReader();
		lecteur.onload = () => resoudre(String(lecteur.result).split(",")[1]);
		lecteur.onerror = () =>
			rejeter(new Error("Facture illisible : choisis-la de nouveau."));
		lecteur.readAsDataURL(fichier);
	});
	return { nom: fichier.name, type: fichier.type, base64 };
}

/** Photo choisie, réduite pour un envoi rapide, avec sa vignette ; undefined s'il n'y en a pas. */
async function photoChoisie() {
	const fichier = app.photoSaisie;
	if (!fichier) return undefined;
	const [base64, miniature] = await Promise.all([
		reduireImage(fichier, TAILLE_PHOTO_PX, 0.85),
		reduireImage(fichier, TAILLE_MINIATURE_PX, 0.6),
	]);
	return { nom: "photo.jpg", type: "image/jpeg", base64, miniature };
}

/**
 * Objet ajouté ou modifié : affiché aussitôt (avec la vignette de la photo choisie), enregistré en
 * arrière-plan avec ses fichiers. Prix actuel et fin de garantie, calculés par l'API, arrivent avec
 * sa réponse.
 */
async function enregistrerObjet(e) {
	e.preventDefault();
	let facture;
	let photo;
	try {
		[facture, photo] = await Promise.all([factureChoisie(), photoChoisie()]);
	} catch (erreur) {
		$("#form-objet .erreur").textContent = erreur.message;
		return;
	}
	const objet = {
		facture,
		photo,
		produit: $("#champ-produit").value,
		categorie: $("#champ-categorie").value,
		marque: $("#champ-marque").value,
		taille: tailleSaisie(),
		dateAchat: $("#champ-date-achat").value,
		prixAchat: $("#champ-prix-achat").value,
	};
	const produit = objet.produit.trim();
	if (!produit) {
		$("#form-objet .erreur").textContent = "Indique le produit.";
		return;
	}
	const edition = app.edition;
	const clePhoto = photo ? `provisoire-photo-${Date.now()}` : null;
	if (clePhoto) app.miniatures[clePhoto] = photo.miniature;
	const prix = Number(String(objet.prixAchat).replace(",", "."));
	const affiche = {
		ligne: edition?.ligne ?? null,
		categorie: objet.categorie,
		produit,
		marque: objet.marque.trim(),
		taille: objet.taille,
		dateAchat: objet.dateAchat || null,
		prixAchat:
			String(objet.prixAchat).trim() === "" || Number.isNaN(prix) ? null : prix,
		prixActuel: edition?.prixActuel ?? null,
		finGarantie: edition?.finGarantie ?? null,
		facture: facture
			? { nom: facture.nom, url: "" }
			: (edition?.facture ?? null),
		photo: clePhoto
			? { nom: "photo.jpg", url: clePhoto }
			: (edition?.photo ?? null),
		provisoire: !edition,
	};
	const lance = modifierEnFond(
		edition ? "modifier-objet" : "creer-objet",
		() =>
			edition
				? {
						ligne: ligneActuelle(
							"objets",
							"produit",
							edition.produit,
							edition.ligne,
						),
						attendu: edition.produit,
						objet,
					}
				: { objet },
		avecListe("objets", (liste) =>
			edition
				? liste.map((x) => (x.produit === edition.produit ? affiche : x))
				: [...liste, affiche],
		),
		`« ${produit} » n'a pas été enregistré :`,
	);
	if (!lance) return;
	$("#dialogue-objet").close();
	notifier(edition ? "Objet enregistré." : "Objet ajouté.");
}

/** Suppression d'un objet : aussitôt, enregistrée en arrière-plan. */
function supprimerObjet() {
	const { ligne, produit } = app.edition;
	if (!confirm(`Supprimer « ${produit} » ?`)) return;
	const lance = modifierEnFond(
		"supprimer-objet",
		() => ({
			ligne: ligneActuelle("objets", "produit", produit, ligne),
			attendu: produit,
		}),
		avecListe("objets", (liste) => liste.filter((o) => o.produit !== produit)),
		`« ${produit} » n'a pas été supprimé :`,
	);
	if (!lance) return;
	$("#dialogue-objet").close();
	notifier("Objet supprimé.");
}

// ---------------------------------------------------------------------------
// Onglet Stats
// ---------------------------------------------------------------------------

function tuile(libelle, valeur, precision) {
	return el(
		"div",
		{ class: "carte tuile" },
		el("p", { class: "libelle" }, libelle),
		el("p", { class: "valeur" }, valeur),
		precision ? el("p", { class: "precision" }, precision) : null,
	);
}

/** Barres horizontales d'une seule série, chaque valeur écrite à côté de sa barre. */
function barres(groupes) {
	const max = Math.max(...groupes.map(({ valeur }) => valeur), 1);
	return el(
		"div",
		{ class: "carte barres" },
		groupes.map(({ nom, valeur, nombre }) => {
			const detail = `${nom} : ${euros.format(valeur)}, ${pluriel(nombre, "objet")}`;
			return el(
				"div",
				{ class: "ligne-barre", title: detail },
				el("span", { class: "nom-barre" }, nom),
				el(
					"span",
					{ class: "piste", "aria-hidden": "true" },
					el("span", {
						class: "remplissage",
						style: `width: ${(valeur / max) * 100}%`,
					}),
				),
				el("span", { class: "valeur-barre" }, eurosRonds.format(valeur)),
			);
		}),
	);
}

function ligneParametrage(categorie) {
	const parametrage = app.etat.parametrageDecote.find(
		(p) => normaliser(p.categorie) === normaliser(categorie),
	) ?? { categorie, anneesGarantie: null, anneesDecoteTotale: null };
	const { anneesGarantie, anneesDecoteTotale } = parametrage;
	return el(
		"div",
		{ class: "carte ligne-carte" },
		el(
			"button",
			{
				type: "button",
				class: "contenu-carte",
				onclick: () => ouvrirParametrage(parametrage),
			},
			el("h3", {}, categorie),
			anneesDecoteTotale === null
				? el("p", { class: "a-completer" }, "À régler")
				: el(
						"p",
						{ class: "detail" },
						`Garantie : ${anneesGarantie ? `${nombreDecimal(anneesGarantie)} an(s)` : "aucune"} · décote totale à ${nombreDecimal(anneesDecoteTotale)} an(s)`,
					),
		),
		el(
			"button",
			{
				type: "button",
				class: "bouton-icone supprimer-categorie",
				title: "Supprimer la catégorie",
				"aria-label": `Supprimer la catégorie ${categorie}`,
				onclick: () => supprimerCategorie(categorie),
			},
			$("#icone-corbeille").content.cloneNode(true),
		),
	);
}

function rendreStats() {
	const stats = calculerStats(app.etat.objets);
	remplacerContenu(
		$("#contenu-stats"),
		el(
			"div",
			{ class: "tuiles" },
			tuile(
				"Objets",
				String(stats.nombre),
				stats.aCompleter > 0 ? `${stats.aCompleter} à compléter` : null,
			),
			tuile("Valeur d'achat", eurosRonds.format(stats.valeurAchat)),
			tuile("Valeur actuelle", eurosRonds.format(stats.valeurActuelle)),
			tuile(
				"Décote cumulée",
				eurosRonds.format(stats.decote),
				`${pourcent.format(stats.partDecote)} du prix d'achat`,
			),
		),
		stats.parCategorie.length > 0
			? [
					el("h2", { class: "titre-section" }, "Valeur actuelle par catégorie"),
					barres(stats.parCategorie),
				]
			: null,
		stats.plusChers.length > 0
			? [
					el("h2", { class: "titre-section" }, "Les plus chers aujourd'hui"),
					...stats.plusChers.map(carteObjet),
				]
			: null,
		stats.parAnnee.length > 0
			? [
					el("h2", { class: "titre-section" }, "Achats par année"),
					barres(stats.parAnnee),
				]
			: null,
		el("h2", { class: "titre-section" }, "Catégories et décote"),
		app.etat.categories.map(ligneParametrage),
	);
}

function ouvrirParametrage(parametrage) {
	app.edition = parametrage;
	$("#titre-dialogue-parametrage").textContent =
		`Décote : ${parametrage.categorie}`;
	$("#champ-garantie").value = parametrage.anneesGarantie ?? "";
	$("#champ-decote-totale").value = parametrage.anneesDecoteTotale ?? "";
	$("#form-parametrage .erreur").textContent = "";
	$("#dialogue-parametrage").showModal();
}

/** Décote d'une catégorie : affichée aussitôt, enregistrée en arrière-plan (prix actuels recalculés par l'API). */
function enregistrerParametrage(e) {
	e.preventDefault();
	const parametrage = {
		categorie: app.edition.categorie,
		anneesGarantie: $("#champ-garantie").value,
		anneesDecoteTotale: $("#champ-decote-totale").value,
	};
	const annees = (valeur) =>
		String(valeur).trim() === ""
			? null
			: Number(String(valeur).replace(",", "."));
	const affiche = {
		categorie: parametrage.categorie,
		anneesGarantie: annees(parametrage.anneesGarantie),
		anneesDecoteTotale: annees(parametrage.anneesDecoteTotale),
	};
	const lance = modifierEnFond(
		"modifier-parametrage-decote",
		() => ({ parametrage }),
		avecListe("parametrageDecote", (liste) =>
			liste.some((p) => p.categorie === affiche.categorie)
				? liste.map((p) => (p.categorie === affiche.categorie ? affiche : p))
				: [...liste, affiche],
		),
		`La décote de « ${parametrage.categorie} » n'a pas été enregistrée :`,
	);
	if (!lance) return;
	$("#dialogue-parametrage").close();
	notifier("Décote enregistrée.");
}

function ouvrirNouvelleCategorie() {
	$("#champ-nouvelle-categorie").value = "";
	$("#form-categorie .erreur").textContent = "";
	$("#dialogue-categorie").showModal();
}

/** Nouvelle catégorie : affichée aussitôt, créée en arrière-plan (avec son dossier Drive). */
function enregistrerCategorie(e) {
	e.preventDefault();
	const categorie = $("#champ-nouvelle-categorie").value.trim();
	if (!categorie) {
		$("#form-categorie .erreur").textContent = "Indique la catégorie.";
		return;
	}
	if (
		app.etat.categories.some((c) => normaliser(c) === normaliser(categorie))
	) {
		$("#form-categorie .erreur").textContent =
			`La catégorie « ${categorie} » existe déjà.`;
		return;
	}
	const ajouter = (liste) =>
		[...liste, categorie].sort((a, b) => a.localeCompare(b, "fr"));
	const lance = modifierEnFond(
		"creer-categorie",
		() => ({ categorie }),
		(etat) => ({
			...etat,
			categories: ajouter(etat.categories),
			categoriesDossiers: ajouter(etat.categoriesDossiers),
		}),
		`La catégorie « ${categorie} » n'a pas été créée :`,
	);
	if (!lance) return;
	$("#dialogue-categorie").close();
	notifier("Catégorie ajoutée.");
}

/** L'état sans une catégorie (ses objets déplacés dans `remplacement`, s'il y en a un). */
const sansCategorie = (categorie, remplacement) => (etat) => {
	const autre = (c) => normaliser(c) !== normaliser(categorie);
	return {
		...etat,
		categories: etat.categories.filter(autre),
		categoriesDossiers: etat.categoriesDossiers.filter(autre),
		objets: remplacement
			? etat.objets.map((o) =>
					autre(o.categorie) ? o : { ...o, categorie: remplacement },
				)
			: etat.objets,
	};
};

/** Suppression d'une catégorie : sans objet, aussitôt (enregistrée en arrière-plan) ; sinon, déplacement de ses objets. */
function supprimerCategorie(categorie) {
	const nombre = app.etat.objets.filter(
		(objet) => normaliser(objet.categorie) === normaliser(categorie),
	).length;
	if (nombre > 0) {
		ouvrirMigration(categorie, nombre);
		return;
	}
	if (
		!confirm(
			`Supprimer la catégorie « ${categorie} » ? Son dossier Drive part à la corbeille.`,
		)
	) {
		return;
	}
	const lance = modifierEnFond(
		"supprimer-categorie",
		() => ({ categorie }),
		sansCategorie(categorie),
		`La catégorie « ${categorie} » n'a pas été supprimée :`,
	);
	if (lance) notifier("Catégorie supprimée.");
}

/** Une catégorie qui a des objets : ils doivent d'abord passer dans une autre. */
function ouvrirMigration(categorie, nombre) {
	const autres = app.etat.categoriesDossiers.filter(
		(nom) => normaliser(nom) !== normaliser(categorie),
	);
	if (autres.length === 0) {
		notifier(
			"Ajoute d'abord une autre catégorie pour y déplacer ses objets.",
			true,
		);
		return;
	}
	app.edition = categorie;
	$("#titre-dialogue-migration").textContent = `Supprimer « ${categorie} »`;
	$("#info-migration").textContent =
		`${pluriel(nombre, "objet")} dans cette catégorie : choisis où les déplacer.`;
	remplacerContenu(
		$("#champ-categorie-migration"),
		el("option", { value: "" }, "Choisir…"),
		autres.map((nom) => el("option", { value: nom }, nom)),
	);
	$("#form-migration .erreur").textContent = "";
	$("#dialogue-migration").showModal();
}

/** Suppression d'une catégorie avec déplacement de ses objets : aussitôt, enregistrée en arrière-plan. */
function migrerCategorie(e) {
	e.preventDefault();
	const categorie = app.edition;
	const remplacement = $("#champ-categorie-migration").value;
	const lance = modifierEnFond(
		"supprimer-categorie",
		() => ({ categorie, remplacement }),
		sansCategorie(categorie, remplacement),
		`La catégorie « ${categorie} » n'a pas été supprimée :`,
	);
	if (!lance) return;
	$("#dialogue-migration").close();
	notifier(`Catégorie supprimée, objets déplacés dans « ${remplacement} ».`);
}

// ---------------------------------------------------------------------------
// Affichage général
// ---------------------------------------------------------------------------

function rendre() {
	if (!app.etat) return;
	for (const onglet of ONGLETS) {
		$(`#onglet-${onglet}`).hidden = onglet !== app.onglet;
	}
	for (const bouton of document.querySelectorAll("[data-onglet]")) {
		bouton.setAttribute(
			"aria-selected",
			String(bouton.dataset.onglet === app.onglet),
		);
	}
	if (app.onglet === "entretiens") rendreEntretiens();
	else if (app.onglet === "objets") rendreObjets();
	else rendreStats();
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
	const connecte = nom === "app";
	$("#ecran-connexion").hidden = connecte;
	$("#ecran-app").hidden = !connecte;
	for (const id of ["#bouton-actualiser", "#bouton-menu"]) {
		$(id).hidden = !connecte;
	}
	if (connecte) {
		afficherCompte();
		rendre();
	}
}

function afficherConnexion(message = "", invitation = null) {
	afficherEcran("connexion");
	afficherFormulaireConnexion($("#connexion"), {
		nomApp: "Maison",
		message,
		invitation,
		surConnecte: (compte) => {
			notifier(`Bienvenue ${compte.prenom} !`);
			chargerApresConnexion();
		},
	});
}

async function chargerApresConnexion() {
	oublierEtat();
	ecrireStockage(CLES.etat, null);
	try {
		appliquerEtat(await appelerApi("etat"));
		afficherEcran("app");
	} catch (erreur) {
		deconnecter(erreur.message);
	}
}

function deconnecter(message = "") {
	fermerMenu();
	oublierConnexion();
	oublierEtat();
	app.miniatures = {};
	ecrireStockage(CLES.etat, null);
	ecrireStockage(CLES.miniatures, null);
	afficherConnexion(message);
}

async function seDeconnecter() {
	fermerMenu();
	if (!confirm("Te déconnecter de cet appareil ?")) return;
	await deconnecterAppareil();
	deconnecter();
}

function afficherCompte() {
	afficherProfil();
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

function afficherBandeauHorsLigne() {
	if (app.horsLigne) {
		afficherBandeau("Hors ligne : données du dernier chargement.");
	} else {
		masquerBandeau();
	}
}

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
	for (const bouton of document.querySelectorAll("[data-onglet]")) {
		bouton.addEventListener("click", () =>
			choisirOnglet(bouton.dataset.onglet),
		);
	}
	// Balayer l'écran vers la gauche ou la droite passe à l'onglet suivant ou précédent
	brancherBalayage($("#ecran-app"), choisirOngletVoisin, {
		anime: () => $(`#onglet-${app.onglet}`),
	});
	$("#form-entretien").addEventListener("submit", enregistrerEntretien);
	for (const champ of ["#champ-derniere", "#champ-frequence", "#champ-unite"]) {
		$(champ).addEventListener("input", actualiserProchaineFois);
	}
	$("#form-objet").addEventListener("submit", enregistrerObjet);
	$("#form-parametrage").addEventListener("submit", enregistrerParametrage);
	$("#form-categorie").addEventListener("submit", enregistrerCategorie);
	$("#form-migration").addEventListener("submit", migrerCategorie);
	$("#bouton-nouvel-entretien").addEventListener("click", () =>
		ouvrirEntretien(),
	);
	$("#bouton-nouvelle-categorie").addEventListener(
		"click",
		ouvrirNouvelleCategorie,
	);
	$("#bouton-supprimer-entretien").addEventListener(
		"click",
		supprimerEntretien,
	);
	$("#bouton-supprimer-objet").addEventListener("click", supprimerObjet);
	$("#bouton-nouvel-objet").addEventListener("click", () => ouvrirObjet());
	for (const champ of ["#champ-categorie", "#champ-produit"]) {
		$(champ).addEventListener("input", () =>
			afficherChampTaille(tailleSaisie()),
		);
	}
	$("#bouton-camera").addEventListener("click", () =>
		$("#champ-camera").click(),
	);
	$("#bouton-galerie").addEventListener("click", () =>
		$("#champ-photo").click(),
	);
	for (const champ of ["#champ-camera", "#champ-photo"]) {
		$(champ).addEventListener("change", (e) => {
			const fichier = e.target.files[0];
			if (!fichier) return;
			app.photoSaisie = fichier;
			afficherApercuPhoto(URL.createObjectURL(fichier));
			// Vidé aussitôt : la même image peut être choisie de nouveau.
			e.target.value = "";
		});
	}
	$("#recherche-objets").addEventListener("input", rendreListeObjets);
	$("#filtre-categorie").addEventListener("change", rendreListeObjets);
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
		ouvrirInvitation("Maison");
	});
	$("#menu-autre-appareil").addEventListener("click", async () => {
		fermerMenu();
		try {
			await connecterUnAutreAppareil("Maison");
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	});
	brancherBiometrie($("#menu-biometrie"), "Maison");
	$("#menu-installer").addEventListener("click", fermerMenu);
	brancherInstallation($("#menu-installer"), { connexion: true });
	$("#bouton-signalement").addEventListener("click", () => {
		fermerMenu();
		ouvrirSignalement({ app: "Maison", prenom: compteConnecte()?.prenom });
	});
	$("#menu-deconnecter").addEventListener("click", seDeconnecter);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "visible") return;
		actualiser({ silencieux: true });
		chercherMiseAJour();
	});
	window.addEventListener("online", () => actualiser({ silencieux: true }));
}

function demarrer() {
	afficherVersions();
	brancherEvenements();
	enregistrerServiceWorker();
	brancherProfil({ apresEnregistrement: actualiser });
	brancherBoutonPortail();
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
		if (app.etat) {
			afficherEcran("app");
		} else if (lireSession()) {
			afficherConnexion(
				"Impossible de charger la maison. Vérifie ta connexion.",
			);
		}
	});
}

demarrer();
