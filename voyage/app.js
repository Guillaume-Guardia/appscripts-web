import { creerApi, ErreurReseau } from "../commun/api.js";
import {
	afficherConnexion as afficherFormulaireConnexion,
	compteConnecte,
	connecterUnAutreAppareil,
	deconnecter as deconnecterAppareil,
	deconnecterPartout,
	estSessionRefusee,
	invitationDuLien,
	lireSession,
	modifierPrenom,
	oublierConnexion,
} from "../commun/connexion.js";
import { aujourdhui, joursEntre, pluriel, versDate } from "../commun/dates.js";
import {
	$,
	afficherBandeau,
	el,
	masquerBandeau,
	normaliser,
	notifier,
	remplacerContenu,
} from "../commun/dom.js";
import {
	brancherInstallation,
	chercherMiseAJour,
	enregistrerServiceWorker,
} from "../commun/pwa.js";
import { ouvrirQr } from "../commun/qr.js";
import { ouvrirSignalement } from "../commun/signalement.js";
import {
	ecrireStockage,
	lireStockage,
	lireStockageJson,
} from "../commun/stockage.js";

// ---------------------------------------------------------------------------
// État de l'app
// ---------------------------------------------------------------------------

const CLES = {
	etat: "voyage.etat",
	/** Lien de partage ouvert avant d'être connecté : { voyageId, code }. */
	rejoindre: "voyage.rejoindre",
	masquerPris: "voyage.masquerPris",
	versionApi: "voyage.versionApi",
};

const app = {
	/** { moi, voyages, options } renvoyé par l'API. */
	etat: null,
	/** Id du voyage affiché, ou null pour la liste des voyages. */
	voyageId: null,
	/** Voyage en cours de modification dans le formulaire (null : nouveau voyage). */
	edition: null,
	masquerPris: lireStockage(CLES.masquerPris) === "oui",
	horsLigne: false,
	occupe: false,
	/** Version de l'API, renvoyée avec chaque réponse (affichée avec celle de l'app). */
	versionApi: lireStockage(CLES.versionApi),
};

// État en cache : seulement celui du compte connecté sur l'appareil.
const etatEnCache = lireStockageJson(CLES.etat);
if (
	lireSession() &&
	etatEnCache?.moi?.id === compteConnecte()?.id &&
	Array.isArray(etatEnCache.voyages)
) {
	app.etat = etatEnCache;
}

// ---------------------------------------------------------------------------
// API (Web App Apps Script, projet voyage)
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

async function actualiser({ silencieux = false } = {}) {
	if (!lireSession()) return;
	const bouton = $("#bouton-actualiser");
	bouton.classList.add("tourne");
	try {
		appliquerEtat(await appelerApi("etat"));
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
		appliquerEtat(etat);
		if (messageSucces) notifier(messageSucces);
		return resultat ?? true;
	} catch (erreur) {
		if (estSessionRefusee(erreur)) {
			deconnecter(erreur.message);
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
// Affichage d'un voyage
// ---------------------------------------------------------------------------

const formatJour = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "short",
});
const formatJourAnnee = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "short",
	year: "numeric",
});

/** « 1 → 6 déc. 2026 · 6 jours » */
function periode(voyage) {
	const depart = versDate(voyage.depart);
	const retour = versDate(voyage.retour);
	const debut =
		depart.getFullYear() === retour.getFullYear()
			? formatJour.format(depart)
			: formatJourAnnee.format(depart);
	const dates =
		voyage.jours === 1
			? formatJourAnnee.format(depart)
			: `${debut} → ${formatJourAnnee.format(retour)}`;
	return `${dates} · ${pluriel(voyage.jours, "jour")}`;
}

/** Où en est le voyage : { libelle, classe } (« dans 12 jours », « en cours », « terminé »). */
function moment(voyage) {
	const jour = aujourdhui();
	const avant = joursEntre(jour, versDate(voyage.depart));
	if (joursEntre(jour, versDate(voyage.retour)) < 0) {
		return { libelle: "terminé", classe: "" };
	}
	if (avant <= 0) return { libelle: "en cours", classe: "en-cours" };
	if (avant === 1) return { libelle: "demain", classe: "" };
	return { libelle: `dans ${pluriel(avant, "jour")}`, classe: "" };
}

const estTermine = (voyage) =>
	joursEntre(aujourdhui(), versDate(voyage.retour)) < 0;

const ICONES = {
	chaud: "☀️",
	tempere: "⛅",
	froid: "❄️",
	avion: "✈️",
	train: "🚆",
	voiture: "🚗",
	bus: "🚌",
	bateau: "⛴️",
	velo: "🚲",
	moto: "🏍️",
};

function avecIcone(valeur) {
	const icone = ICONES[normaliser(valeur)];
	return icone ? `${icone} ${valeur}` : valeur;
}

const visibles = (voyage) =>
	voyage.bagages.filter((b) => b.statut !== "retiré");

function barreProgression(pris, total) {
	const pourcentage = total ? Math.round((pris / total) * 100) : 0;
	return el(
		"div",
		{ class: "progression" },
		el(
			"div",
			{
				class: `barre${total && pris === total ? " complete" : ""}`,
				role: "progressbar",
				"aria-valuemin": "0",
				"aria-valuemax": String(total),
				"aria-valuenow": String(pris),
			},
			el("span", { style: `width: ${pourcentage}%` }),
		),
		`${pris} / ${total}`,
	);
}

const voyageAffiche = () =>
	app.etat?.voyages.find((v) => v.id === app.voyageId) ?? null;

// ---------------------------------------------------------------------------
// Liste des voyages
// ---------------------------------------------------------------------------

function carteVoyage(voyage) {
	const liste = visibles(voyage);
	const { libelle, classe } = moment(voyage);
	return el(
		"button",
		{
			type: "button",
			class: "carte carte-voyage",
			onclick: () => ouvrirVoyage(voyage.id),
		},
		el(
			"h3",
			{},
			voyage.destination,
			el("span", { class: `etiquette ${classe}` }, libelle),
		),
		el("p", { class: "quand" }, periode(voyage)),
		voyage.participants.length > 1
			? el("p", { class: "avec" }, avecQui(voyage))
			: null,
		barreProgression(liste.filter((b) => b.pris).length, liste.length),
	);
}

function rendreVoyages() {
	const conteneur = $("#liste-voyages");
	const { voyages } = app.etat;
	if (voyages.length === 0) {
		remplacerContenu(
			conteneur,
			el(
				"div",
				{ class: "vide" },
				el("p", {}, "Aucun voyage pour l'instant."),
				el(
					"p",
					{},
					"Crée le premier : sa liste de bagages se remplit selon la destination, la durée et le transport.",
				),
			),
		);
		return;
	}
	const aVenir = voyages.filter((v) => !estTermine(v));
	const passes = voyages.filter(estTermine).reverse();
	remplacerContenu(
		conteneur,
		aVenir.length ? el("h2", { class: "titre-section" }, "À venir") : null,
		...aVenir.map(carteVoyage),
		passes.length ? el("h2", { class: "titre-section" }, "Passés") : null,
		...passes.map(carteVoyage),
	);
}

// ---------------------------------------------------------------------------
// Liste de bagages d'un voyage
// ---------------------------------------------------------------------------

/** Catégories dans l'ordre du catalogue ; celles qu'il ne connaît pas à la fin. */
function grouperParCategorie(bagages) {
	const ordre = app.etat.options.categories.map(normaliser);
	const groupes = new Map();
	for (const bagage of bagages) {
		const nom = bagage.categorie || "Divers";
		const cle = normaliser(nom);
		if (!groupes.has(cle)) groupes.set(cle, { nom, bagages: [] });
		groupes.get(cle).bagages.push(bagage);
	}
	const rang = (cle) => {
		const index = ordre.indexOf(cle);
		return index < 0 ? ordre.length : index;
	};
	return [...groupes.entries()]
		.sort(([a], [b]) => rang(a) - rang(b))
		.map(([, groupe]) => groupe);
}

function ligneObjet(bagage) {
	return el(
		"li",
		{ class: `objet${bagage.pris ? " pris" : ""}` },
		el(
			"label",
			{},
			el("input", {
				type: "checkbox",
				checked: bagage.pris,
				onchange: (e) => cocher(bagage, e.target.checked),
			}),
			el(
				"span",
				{ class: "texte" },
				el(
					"span",
					{},
					el("span", { class: "nom" }, bagage.objet),
					bagage.quantite > 1
						? el("span", { class: "quantite" }, `×${bagage.quantite}`)
						: null,
				),
				bagage.note ? el("span", { class: "note" }, bagage.note) : null,
				bagage.statut === "ajouté"
					? el("span", { class: "ajoute" }, "ajouté à la main")
					: null,
			),
		),
		el(
			"button",
			{
				type: "button",
				class: "retirer",
				"aria-label": `Retirer ${bagage.objet} de la liste`,
				title: "Retirer de la liste",
				onclick: () => retirer(bagage),
			},
			"×",
		),
	);
}

function rendreDetail() {
	const voyage = voyageAffiche();
	if (!voyage) {
		fermerVoyage();
		return;
	}
	$("#titre").textContent = voyage.destination;
	const liste = visibles(voyage);
	const pris = liste.filter((b) => b.pris).length;
	const retires = voyage.bagages.filter((b) => b.statut === "retiré");
	const criteres = [
		...voyage.climats,
		...voyage.transports,
		...voyage.activites,
		voyage.etranger ? "🌍 Étranger" : null,
	].filter(Boolean);
	const affiches = app.masquerPris ? liste.filter((b) => !b.pris) : liste;

	const resume = el(
		"section",
		{ class: "carte resume" },
		el(
			"p",
			{ class: "quand" },
			`${periode(voyage)} · ${moment(voyage).libelle}`,
		),
		criteres.length
			? el(
					"div",
					{ class: "criteres" },
					criteres.map((c) => el("span", { class: "critere" }, avecIcone(c))),
				)
			: null,
		el(
			"div",
			{ class: "participants-voyage" },
			el("span", {}, avecQui(voyage) || "Rien que toi"),
			voyage.estProprietaire
				? el(
						"button",
						{ type: "button", onclick: () => ouvrirPartage(voyage) },
						"Partager",
					)
				: null,
		),
		barreProgression(pris, liste.length),
		el(
			"label",
			{ class: "filtre" },
			el("input", {
				type: "checkbox",
				checked: app.masquerPris,
				onchange: (e) => {
					app.masquerPris = e.target.checked;
					ecrireStockage(CLES.masquerPris, app.masquerPris ? "oui" : null);
					rendre();
				},
			}),
			"Masquer ce qui est déjà pris",
		),
	);

	const categories = grouperParCategorie(affiches).map((groupe) => {
		const tous = liste.filter(
			(b) => normaliser(b.categorie || "Divers") === normaliser(groupe.nom),
		);
		const prisCategorie = tous.filter((b) => b.pris).length;
		const complete = prisCategorie === tous.length;
		return el(
			"section",
			{ class: `carte categorie${complete ? " complete" : ""}` },
			el(
				"h3",
				{},
				groupe.nom,
				el(
					"span",
					{ class: "compte" },
					complete ? "✓ tout est pris" : `${prisCategorie} / ${tous.length}`,
				),
			),
			el("ul", { class: "objets" }, groupe.bagages.map(ligneObjet)),
		);
	});

	const fini = liste.length > 0 && pris === liste.length;
	remplacerContenu(
		$("#detail-voyage"),
		resume,
		fini
			? el(
					"p",
					{ class: "toutes-prises" },
					"🎉 Tout est dans la valise. Bon voyage !",
				)
			: null,
		liste.length === 0
			? el(
					"p",
					{ class: "vide" },
					"Liste vide : ajoute des objets, ou complète le catalogue dans le classeur puis « Recalculer ».",
				)
			: null,
		...categories,
		retires.length
			? el(
					"details",
					{ class: "carte retires" },
					el("summary", {}, `Retirés de la liste (${retires.length})`),
					el(
						"ul",
						{ class: "objets" },
						retires.map((b) =>
							el(
								"li",
								{},
								el("span", {}, b.objet),
								el(
									"button",
									{ type: "button", onclick: () => remettre(b) },
									"Remettre",
								),
							),
						),
					),
				)
			: null,
		el(
			"div",
			{ class: "actions" },
			el(
				"button",
				{
					type: "button",
					class: "bouton-principal large",
					onclick: ouvrirFormulaireObjet,
				},
				"+ Ajouter un objet",
			),
			el(
				"button",
				{ type: "button", onclick: () => ouvrirFormulaireVoyage(voyage) },
				"Modifier le voyage",
			),
			el(
				"button",
				{ type: "button", onclick: () => recalculer(voyage) },
				"Recalculer la liste",
			),
			el(
				"button",
				{
					type: "button",
					onclick: () => toutDecocher(voyage),
					disabled: pris === 0,
				},
				"Tout décocher (retour)",
			),
			voyage.estProprietaire
				? el(
						"button",
						{
							type: "button",
							class: "danger",
							onclick: () => supprimerVoyage(voyage),
						},
						"Supprimer",
					)
				: el(
						"button",
						{
							type: "button",
							class: "danger",
							onclick: () => quitterVoyage(voyage),
						},
						"Quitter ce voyage",
					),
		),
	);
}

// ---------------------------------------------------------------------------
// Rendu et navigation
// ---------------------------------------------------------------------------

function rendre() {
	if (!app.etat) return;
	const detail = Boolean(app.voyageId);
	$("#ecran-voyages").hidden = detail;
	$("#ecran-voyage").hidden = !detail;
	$("#bouton-retour").hidden = !detail;
	if (detail) {
		rendreDetail();
	} else {
		$("#titre").textContent = "Voyages";
		rendreVoyages();
	}
	remplacerContenu(
		$("#liste-categories"),
		app.etat.options.categories.map((c) => el("option", { value: c })),
	);
}

function ouvrirVoyage(id) {
	app.voyageId = id;
	history.pushState({ voyageId: id }, "");
	rendre();
	window.scrollTo(0, 0);
}

/** Retour à la liste des voyages (bouton de l'app, ou voyage supprimé). */
function fermerVoyage() {
	if (history.state?.voyageId) {
		history.back();
		return;
	}
	app.voyageId = null;
	rendre();
}

window.addEventListener("popstate", (e) => {
	app.voyageId = e.state?.voyageId ?? null;
	if (app.voyageId && !voyageAffiche()) app.voyageId = null;
	rendre();
});

// ---------------------------------------------------------------------------
// Partage d'un voyage
// ---------------------------------------------------------------------------

/** Nom d'un participant. */
const nomDe = (participant) => participant.prenom || "Quelqu'un";

/** « Avec Tom, Zoé » (créateur) ou « Partagé par Léa » (participant) ; "" sans partage. */
function avecQui(voyage) {
	const moi = app.etat.moi.id;
	if (!voyage.estProprietaire) {
		return `Partagé par ${nomDe(voyage.participants[0])}`;
	}
	const autres = voyage.participants.filter((p) => p.id !== moi);
	return autres.length ? `Avec ${autres.map(nomDe).join(", ")}` : "";
}

/** Lien de partage : l'app, avec l'Id du voyage et son code après « # » (pas envoyés au site). */
const lienDePartage = (voyage, code) =>
	`${location.origin}${location.pathname}#rejoindre=${encodeURIComponent(voyage.id)}:${code}`;

/** Voyage et code d'un lien de partage (…#rejoindre=<Id>:<code>), ou null. */
function rejoindreDuLien(texte) {
	const trouve = /#rejoindre=([^:&]+):([0-9a-f]+)/i.exec(String(texte));
	return trouve
		? { voyageId: decodeURIComponent(trouve[1]), code: trouve[2] }
		: null;
}

/**
 * Fenêtre de partage (créateur) : QR code et lien qui font rejoindre le voyage, participants à
 * retirer, et « Changer le lien ».
 * @param nouveau Vrai pour changer le lien : l'ancien ne fait plus rejoindre le voyage
 */
async function ouvrirPartage(voyage, nouveau = false) {
	let code = voyage.codePartage;
	if (!code || nouveau) {
		code = await modifier(
			"lien-partage",
			{ voyageId: voyage.id, nouveau },
			nouveau
				? "Nouveau lien : l'ancien ne fait plus rejoindre le voyage."
				: null,
		);
		if (!code) return;
	}
	const actuel = voyageAffiche() ?? voyage;
	const autres = actuel.participants.slice(1);
	const dialogue = ouvrirQr({
		titre: `Partager ${actuel.destination}`,
		aide: "À scanner avec l'appareil photo, ou envoie le lien : la personne qui l'ouvre rejoint le voyage et coche la même liste (elle crée son compte si besoin).",
		lien: lienDePartage(actuel, code),
		texteEnvoi: `Rejoins le voyage ${actuel.destination} :`,
		enPlus: el(
			"ul",
			{ class: "participants" },
			autres.length
				? autres.map((p) =>
						el(
							"li",
							{},
							el("span", {}, nomDe(p)),
							el(
								"button",
								{
									type: "button",
									onclick: async () => {
										if (!(await retirerParticipant(actuel, p))) return;
										dialogue.close();
										ouvrirPartage(voyageAffiche() ?? actuel);
									},
								},
								"Retirer",
							),
						),
					)
				: el("li", { class: "aide" }, "Personne n'a encore rejoint ce voyage."),
		),
		actions: [
			{
				libelle: "Changer le lien",
				faire: () => {
					if (
						!confirm(
							"Changer le lien ? L'ancien ne fera plus rejoindre le voyage (les participants restent).",
						)
					) {
						return;
					}
					dialogue.close();
					ouvrirPartage(actuel, true);
				},
			},
		],
	});
}

/** @return Vrai si la personne a été retirée */
async function retirerParticipant(voyage, participant) {
	if (!confirm(`Retirer ${nomDe(participant)} de ce voyage ?`)) return false;
	return Boolean(
		await modifier(
			"retirer-partage",
			{ voyageId: voyage.id, compteId: participant.id },
			`${nomDe(participant)} ne voit plus ce voyage.`,
		),
	);
}

/**
 * Lien de partage ouvert avant d'être connecté : gardé jusqu'à la connexion, puis utilisé pour
 * rejoindre le voyage.
 */
async function rejoindreEnAttente() {
	const lien = lireStockageJson(CLES.rejoindre);
	if (!lien) return;
	ecrireStockage(CLES.rejoindre, null);
	const voyageId = await modifier(
		"rejoindre-voyage",
		lien,
		"Tu as rejoint le voyage.",
	);
	if (voyageId) ouvrirVoyage(voyageId);
}

async function quitterVoyage(voyage) {
	if (
		!confirm(`Quitter le voyage ${voyage.destination} ? Tu ne le verras plus.`)
	) {
		return;
	}
	const fait = await modifier(
		"retirer-partage",
		{ voyageId: voyage.id, compteId: app.etat.moi.id },
		"Tu as quitté le voyage.",
	);
	if (fait) fermerVoyage();
}

// ---------------------------------------------------------------------------
// Actions sur la liste
// ---------------------------------------------------------------------------

/**
 * Coche un objet : affiché tout de suite, envoyé ensuite. En cas d'échec, la case revient à son
 * état d'avant.
 */
async function cocher(bagage, pris) {
	if (app.horsLigne) {
		notifier("Hors ligne : les cases reviendront avec la connexion.", true);
		rendre();
		return;
	}
	// L'état a pu être rechargé pendant l'appel : l'objet est cherché dans l'état en cours.
	const changer = (valeur) => {
		const actuel = app.etat?.voyages
			.flatMap((v) => v.bagages)
			.find((b) => b.id === bagage.id);
		if (actuel) actuel.pris = valeur;
		enregistrerEtat();
		rendre();
	};
	changer(pris);
	try {
		await appelerApi("cocher", { bagageId: bagage.id, pris });
	} catch (erreur) {
		if (estSessionRefusee(erreur)) {
			deconnecter(erreur.message);
			return;
		}
		changer(!pris);
		notifier(erreur.message, true);
		if (erreur instanceof ErreurReseau) passerHorsLigne();
	}
}

function retirer(bagage) {
	const message =
		bagage.statut === "ajouté"
			? `${bagage.objet} supprimé.`
			: `${bagage.objet} retiré (à remettre en bas de la liste).`;
	modifier("retirer-bagage", { bagageId: bagage.id }, message);
}

function remettre(bagage) {
	modifier(
		"remettre-bagage",
		{ bagageId: bagage.id },
		`${bagage.objet} remis dans la liste.`,
	);
}

function recalculer(voyage) {
	modifier(
		"recalculer",
		{ voyageId: voyage.id },
		"Liste recalculée d'après le catalogue.",
	);
}

function toutDecocher(voyage) {
	if (!confirm("Tout décocher, pour refaire la valise au retour ?")) return;
	modifier("decocher-tout", { voyageId: voyage.id }, "Tout est décoché.");
}

async function supprimerVoyage(voyage) {
	if (!confirm(`Supprimer le voyage ${voyage.destination} et sa liste ?`)) {
		return;
	}
	if (
		await modifier(
			"supprimer-voyage",
			{ voyageId: voyage.id },
			"Voyage supprimé.",
		)
	) {
		fermerVoyage();
	}
}

function ouvrirFormulaireObjet() {
	const form = $("#form-objet");
	form.reset();
	form.querySelector(".erreur").textContent = "";
	$("#dialogue-objet").showModal();
	$("#champ-objet").focus();
}

async function enregistrerObjet(evenement) {
	evenement.preventDefault();
	const erreur = evenement.target.querySelector(".erreur");
	erreur.textContent = "";
	const catalogue = $("#champ-catalogue").checked;
	const bagage = {
		objet: $("#champ-objet").value,
		categorie: $("#champ-categorie").value,
		quantite: Number($("#champ-quantite").value),
	};
	const resultat = await modifier(
		"ajouter-bagage",
		{ voyageId: app.voyageId, bagage, catalogue },
		null,
		(message) => {
			erreur.textContent = message;
		},
	);
	if (resultat) {
		$("#dialogue-objet").close();
		notifier(
			`${resultat.objet} ajouté${catalogue ? " (et au catalogue)" : ""}.`,
		);
	}
}

// ---------------------------------------------------------------------------
// Formulaire d'un voyage
// ---------------------------------------------------------------------------

/** Puces à choix multiple ; `choisis` : valeurs déjà cochées. */
function remplirPuces(conteneur, options, choisis) {
	const coches = new Set(choisis.map(normaliser));
	const toutes = [...options];
	for (const valeur of choisis) {
		if (!toutes.some((o) => normaliser(o) === normaliser(valeur))) {
			toutes.push(valeur);
		}
	}
	remplacerContenu(
		conteneur,
		toutes.map((valeur) =>
			el(
				"button",
				{
					type: "button",
					class: "puce",
					"aria-pressed": String(coches.has(normaliser(valeur))),
					"data-valeur": valeur,
					onclick: (e) => {
						const bouton = e.currentTarget;
						bouton.setAttribute(
							"aria-pressed",
							String(bouton.getAttribute("aria-pressed") !== "true"),
						);
					},
				},
				avecIcone(valeur),
			),
		),
	);
}

const valeursCochees = (conteneur) =>
	[...conteneur.querySelectorAll('[aria-pressed="true"]')].map(
		(b) => b.dataset.valeur,
	);

function afficherDuree() {
	const depart = $("#champ-depart").value;
	const retour = $("#champ-retour").value;
	if (!depart || !retour) {
		$("#duree-voyage").textContent = "";
		return;
	}
	const jours = joursEntre(versDate(depart), versDate(retour)) + 1;
	$("#duree-voyage").textContent =
		jours < 1
			? "Le retour est avant le départ."
			: `${pluriel(jours, "jour")}, départ et retour compris.`;
}

function ouvrirFormulaireVoyage(voyage = null) {
	app.edition = voyage;
	const form = $("#form-voyage");
	form.reset();
	form.querySelector(".erreur").textContent = "";
	$("#titre-dialogue-voyage").textContent = voyage
		? "Modifier le voyage"
		: "Nouveau voyage";
	$("#champ-destination").value = voyage?.destination ?? "";
	$("#champ-depart").value = voyage?.depart ?? "";
	$("#champ-retour").value = voyage?.retour ?? "";
	$("#champ-etranger").checked = voyage?.etranger ?? false;
	const { options } = app.etat;
	remplirPuces($("#choix-climats"), options.climats, voyage?.climats ?? []);
	remplirPuces(
		$("#choix-transports"),
		options.transports,
		voyage?.transports ?? [],
	);
	remplirPuces(
		$("#choix-activites"),
		options.activites,
		voyage?.activites ?? [],
	);
	afficherDuree();
	$("#dialogue-voyage").showModal();
	if (!voyage) $("#champ-destination").focus();
}

/** Ajoute une activité qui n'est pas dans les options, déjà cochée. */
function ajouterActivite() {
	const champ = $("#champ-activite");
	const valeur = champ.value.trim();
	if (!valeur) return;
	const conteneur = $("#choix-activites");
	const existante = [...conteneur.children].find(
		(b) => normaliser(b.dataset.valeur) === normaliser(valeur),
	);
	if (existante) {
		existante.setAttribute("aria-pressed", "true");
	} else {
		const options = [...conteneur.children].map((b) => b.dataset.valeur);
		remplirPuces(
			conteneur,
			[...options, valeur],
			[...valeursCochees(conteneur), valeur],
		);
	}
	champ.value = "";
	champ.focus();
}

async function enregistrerVoyage(evenement) {
	evenement.preventDefault();
	const form = evenement.target;
	const erreur = form.querySelector(".erreur");
	erreur.textContent = "";
	if ($("#champ-activite").value.trim()) ajouterActivite();
	const voyage = {
		destination: $("#champ-destination").value,
		depart: $("#champ-depart").value,
		retour: $("#champ-retour").value,
		climats: valeursCochees($("#choix-climats")),
		transports: valeursCochees($("#choix-transports")),
		activites: valeursCochees($("#choix-activites")),
		etranger: $("#champ-etranger").checked,
	};
	const surErreur = (message) => {
		erreur.textContent = message;
	};
	const bouton = form.querySelector('[type="submit"]');
	bouton.disabled = true;
	try {
		if (app.edition) {
			const fait = await modifier(
				"modifier-voyage",
				{ voyageId: app.edition.id, voyage },
				"Voyage modifié, liste mise à jour.",
				surErreur,
			);
			if (fait) $("#dialogue-voyage").close();
			return;
		}
		const id = await modifier("creer-voyage", { voyage }, null, surErreur);
		if (id) {
			$("#dialogue-voyage").close();
			ouvrirVoyage(id);
			notifier("Voyage créé : voici sa liste.");
		}
	} finally {
		bouton.disabled = false;
	}
}

// ---------------------------------------------------------------------------
// Connexion : compte par e-mail (commun/connexion.js, projet droits)
// ---------------------------------------------------------------------------

function afficherEcran(nom) {
	const connecte = nom === "app";
	$("#ecran-connexion").hidden = connecte;
	for (const id of ["#bouton-actualiser", "#bouton-menu"]) {
		$(id).hidden = !connecte;
	}
	if (connecte) {
		afficherCompte();
		rendre();
	} else {
		$("#ecran-voyages").hidden = true;
		$("#ecran-voyage").hidden = true;
		$("#bouton-retour").hidden = true;
		$("#titre").textContent = "Voyage";
	}
}

/**
 * Écran de connexion : nouveau compte (prénom), ou appareil à connecter à un compte existant.
 * @param message Message à afficher (ex : session expirée)
 * @param invitation Code d'un lien de connexion (QR code d'un autre appareil), utilisé aussitôt
 */
function afficherConnexion(message = "", invitation = null) {
	afficherEcran("connexion");
	afficherFormulaireConnexion($("#connexion"), {
		nomApp: "Voyage",
		message,
		invitation,
		surConnecte: (compte) => {
			notifier(`Bienvenue ${compte.prenom} !`);
			chargerApresConnexion();
		},
	});
}

/** Premier chargement des voyages du compte qui vient de se connecter. */
async function chargerApresConnexion() {
	app.etat = null;
	ecrireStockage(CLES.etat, null);
	try {
		appliquerEtat(await appelerApi("etat"));
		afficherEcran("app");
	} catch (erreur) {
		deconnecter(erreur.message);
		return;
	}
	rejoindreEnAttente();
}

/** Prénom et e-mail du compte, en tête du menu. */
function afficherCompte() {
	const compte = app.etat?.moi ?? compteConnecte();
	$("#menu-compte").textContent = compte ? `Connecté : ${compte.prenom}` : "";
}

/** Oublie la connexion de l'appareil et ses données, puis affiche la connexion. */
function deconnecter(message = "") {
	fermerMenu();
	oublierConnexion();
	app.etat = null;
	app.voyageId = null;
	ecrireStockage(CLES.etat, null);
	afficherConnexion(message);
}

async function seDeconnecter() {
	fermerMenu();
	if (!confirm("Te déconnecter de cet appareil ?")) return;
	await deconnecterAppareil();
	deconnecter();
}

async function deconnecterTousLesAppareils() {
	fermerMenu();
	if (
		!confirm(
			"Déconnecter tous tes appareils, celui-ci compris (téléphone perdu) ? Il faudra se reconnecter avec un code par e-mail.",
		)
	) {
		return;
	}
	try {
		await deconnecterPartout();
		deconnecter("Tous tes appareils sont déconnectés.");
	} catch (erreur) {
		notifier(erreur.message, true);
	}
}

async function changerPrenom() {
	fermerMenu();
	const prenom = prompt("Ton prénom :", app.etat?.moi?.prenom ?? "");
	if (prenom === null) return;
	try {
		await modifierPrenom(prenom);
		await actualiser();
		afficherCompte();
		notifier("Prénom changé.");
	} catch (erreur) {
		notifier(erreur.message, true);
	}
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
			"Hors ligne : dernières listes connues, en lecture seule.",
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

function brancherEvenements() {
	$("#form-voyage").addEventListener("submit", enregistrerVoyage);
	$("#form-objet").addEventListener("submit", enregistrerObjet);
	$("#bouton-nouveau-voyage").addEventListener("click", () =>
		ouvrirFormulaireVoyage(),
	);
	$("#bouton-retour").addEventListener("click", fermerVoyage);
	$("#bouton-ajouter-activite").addEventListener("click", ajouterActivite);
	$("#champ-activite").addEventListener("keydown", (e) => {
		if (e.key !== "Enter") return;
		e.preventDefault();
		ajouterActivite();
	});
	$("#champ-depart").addEventListener("change", () => {
		const depart = $("#champ-depart").value;
		const retour = $("#champ-retour");
		if (depart && (!retour.value || retour.value < depart)) {
			retour.value = depart;
		}
		retour.min = depart;
		afficherDuree();
	});
	$("#champ-retour").addEventListener("change", afficherDuree);
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
	$("#menu-prenom").addEventListener("click", changerPrenom);
	$("#menu-autre-appareil").addEventListener("click", async () => {
		fermerMenu();
		try {
			await connecterUnAutreAppareil("Voyage");
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	});
	$("#menu-deconnecter-partout").addEventListener(
		"click",
		deconnecterTousLesAppareils,
	);
	$("#menu-installer").addEventListener("click", fermerMenu);
	brancherInstallation($("#menu-installer"), $("#dialogue-ios"));
	$("#menu-signalement").addEventListener("click", () => {
		fermerMenu();
		ouvrirSignalement({ app: "Voyage", prenom: compteConnecte()?.prenom });
	});
	$("#menu-maj").addEventListener("click", () => {
		fermerMenu();
		chercherMiseAJour();
	});
	$("#menu-deconnecter").addEventListener("click", seDeconnecter);
	// Retour sur l'app : l'autre téléphone a peut-être coché des objets entre-temps.
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "visible") return;
		actualiser({ silencieux: true });
		chercherMiseAJour({ silencieux: true });
	});
	window.addEventListener("online", () => actualiser({ silencieux: true }));
}

function demarrer() {
	afficherVersions();
	brancherEvenements();
	enregistrerServiceWorker();
	// Liens ouverts dans l'app, retirés aussitôt de l'adresse : connexion d'un appareil
	// (…#invitation=<code>), ou partage d'un voyage (…#rejoindre=<Id>:<code>), gardé jusqu'à la
	// connexion.
	const invitation = invitationDuLien(location.hash);
	const rejoindre = rejoindreDuLien(location.hash);
	if (rejoindre) ecrireStockage(CLES.rejoindre, JSON.stringify(rejoindre));
	history.replaceState(null, "", location.pathname);
	if (!window.API_URL) {
		afficherEcran("connexion");
		$("#connexion").textContent =
			"L'adresse de l'API n'est pas configurée (config.js).";
		return;
	}
	if (invitation || !lireSession()) {
		afficherConnexion(
			rejoindre ? "Connecte-toi pour rejoindre le voyage." : "",
			invitation,
		);
		return;
	}
	if (app.etat) afficherEcran("app");
	actualiser({ silencieux: true }).then(() => {
		if (app.etat) {
			afficherEcran("app");
			rejoindreEnAttente();
		} else if (lireSession()) {
			afficherConnexion(
				"Impossible de charger les voyages. Vérifie ta connexion.",
			);
		}
	});
}

demarrer();
