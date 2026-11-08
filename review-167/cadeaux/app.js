import { creerApi, ErreurReseau } from "../shared/api.js";
import {
	afficherConnexion as afficherFormulaireConnexion,
	compteConnecte,
	connecterUnAutreAppareil,
	creerCompteInvite,
	deconnecter as deconnecterAppareil,
	decrireAppareil,
	estAccesRefuse,
	estSessionRefusee,
	garderConnexionInvitee,
	invitationDuLien,
	lireSession,
	oublierConnexion,
	ouvrirMesConnexions,
} from "../shared/connexion.js";
import { aujourdhui, joursEntre, versChampDate } from "../shared/dates.js";
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
	proposerInstallation,
} from "../shared/pwa.js";
import { ouvrirSignalement } from "../shared/signalement.js";
import {
	ecrireStockage,
	lireStockage,
	lireStockageJson,
} from "../shared/stockage.js";

// ---------------------------------------------------------------------------
// Stockage local (préférences de ce navigateur : invitation, dernier état)
// ---------------------------------------------------------------------------

const CLES = {
	/** Clé d'un lien d'invitation (ou d'avant les comptes), envoyée jusqu'à ce qu'elle serve. */
	cle: "cadeaux.cle",
	/** Compte dont l'état est en cache. */
	compte: "cadeaux.compte",
	etat: "cadeaux.etat",
	onglet: "cadeaux.onglet",
	familles: "cadeaux.familles",
	versionApi: "cadeaux.versionApi",
};

function lireFamillesActives() {
	const ids = lireStockageJson(CLES.familles);
	return new Set(Array.isArray(ids) ? ids : []);
}

// ---------------------------------------------------------------------------
// État de l'app
// ---------------------------------------------------------------------------

const app = {
	/** Clé d'un lien d'invitation pas encore utilisée : elle lie le compte à sa personne. */
	cle: lireStockage(CLES.cle),
	/** Code famille saisi à l'inscription. */
	code: null,
	/** { moi, familles, personnes, cadeaux, historique } renvoyé par l'API. */
	etat: null,
	/** Familles affichées (Famille, Disponibles) ; vide = toutes. */
	famillesActives: lireFamillesActives(),
	horsLigne: false,
	onglet: lireStockage(CLES.onglet) || "ma-liste",
	/** Personnes sélectionnées dans l'onglet Famille (une ou plusieurs). */
	personnesFamille: new Set(),
	filtreDisponibles: "",
	triDisponibles: "priorite",
	filtreHistorique: "",
	selection: new Set(),
	/** Idée en cours d'édition : { cadeau, pourIds }. */
	edition: null,
	/** Secret Santa dont le membre a affiché le tirage (masqué par défaut). */
	revele: new Set(),
	occupe: false,
	/** Version de l'API, renvoyée avec chaque réponse (affichée avec celle de l'app). */
	versionApi: lireStockage(CLES.versionApi),
};

const etatEnCache = lireStockageJson(CLES.etat);
if (
	etatEnCache?.moi &&
	lireSession() &&
	lireStockage(CLES.compte) === compteConnecte()?.id &&
	Array.isArray(etatEnCache.secretSantas)
) {
	app.etat = etatEnCache;
}

// ---------------------------------------------------------------------------
// API (Web App Apps Script, projet cadeaux)
// ---------------------------------------------------------------------------

const appelerApi = creerApi({
	url: window.API_URL,
	// La session du compte ; et la clé d'une invitation, tant qu'elle n'a pas servi.
	identifiants: () =>
		app.cle
			? { session: lireSession(), cle: app.cle }
			: { session: lireSession() },
	surVersion: (version) => {
		if (version === app.versionApi) return;
		app.versionApi = version;
		ecrireStockage(CLES.versionApi, version);
		afficherVersions();
	},
});

/** Garde la clé d'un lien d'invitation, envoyée jusqu'à ce qu'elle serve (null : l'oublier). */
function garderCle(cle) {
	app.cle = cle;
	ecrireStockage(CLES.cle, cle);
}

const estConnecte = () => Boolean(lireSession());

/** Le compte n'est encore personne de Cadeaux (MESSAGE_A_LIER du projet cadeaux). */
const estALier = (erreur) => /Rejoins ta famille/.test(erreur?.message ?? "");

/** La clé d'invitation envoyée n'a pas pu lier le compte (voir lierAvecCle du projet cadeaux). */
const estInvitationRefusee = (erreur) =>
	/Lien d'invitation plus valable|Ton compte est déjà celui|utilise déjà l'app avec un autre compte|n'existe plus/.test(
		erreur?.message ?? "",
	);

/**
 * Erreur de connexion d'un appel : écran qui convient (connexion, accès refusé, famille à
 * rejoindre).
 * @return Vrai si l'erreur a été traitée
 */
function traiterErreurConnexion(erreur) {
	if (estSessionRefusee(erreur)) deconnecter(erreur.message);
	else if (estAccesRefuse(erreur)) afficherRefus(erreur.message);
	else if (estALier(erreur)) afficherAccueil();
	else if (estInvitationRefusee(erreur)) {
		garderCle(null);
		afficherAccueil(erreur.message);
	} else return false;
	return true;
}

function appliquerEtat(etat) {
	app.etat = etat;
	app.horsLigne = false;
	ecrireStockage(CLES.etat, JSON.stringify(etat));
	ecrireStockage(CLES.compte, compteConnecte()?.id ?? null);
	// La clé d'invitation a servi (ou le compte était déjà lié) : plus besoin de l'envoyer.
	if (app.cle) garderCle(null);
	const ids = new Set(etat.cadeaux.map((c) => c.id));
	for (const id of app.selection) if (!ids.has(id)) app.selection.delete(id);
	afficherBandeauHorsLigne();
	rendre();
}

async function actualiser({ silencieux = false } = {}) {
	if (!estConnecte()) return;
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
			app.horsLigne = true;
			afficherBandeauHorsLigne();
			rendre();
			if (!silencieux) notifier(erreur.message, true);
		} else if (!traiterErreurConnexion(erreur)) {
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
		if (traiterErreurConnexion(erreur)) return null;
		surErreur(erreur.message);
		if (erreur instanceof ErreurReseau) {
			app.horsLigne = true;
			afficherBandeauHorsLigne();
		}
		return null;
	} finally {
		app.occupe = false;
		document.body.style.cursor = "";
	}
}

// ---------------------------------------------------------------------------
// Outils d'affichage
// ---------------------------------------------------------------------------

const formatEuro = new Intl.NumberFormat("fr-FR", {
	style: "currency",
	currency: "EUR",
});
const prix = (valeur) =>
	typeof valeur === "number" ? formatEuro.format(valeur) : "";
const formatDate = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	year: "numeric",
});
const ENVIES = { 1: "Très envie", 2: "Envie", 3: "Si possible" };
const formatAnniversaire = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
});

/** « aaaa-mm-jj » d'une date de l'API (naissance), pour un champ date ; "" sans date. */
const versChamp = (date) => (date ? versChampDate(new Date(date)) : "");

/**
 * Prochain anniversaire, avec l'âge que la personne aura ce jour-là (celui qui compte pour le
 * cadeau) : « 🎂 35 ans le 20 avril », « … (dans 12 jours) », « 🎂 35 ans aujourd'hui ! ».
 */
function anniversaire(naissance) {
	if (!naissance) return null;
	const date = new Date(naissance);
	const jour = aujourdhui();
	let prochain = new Date(jour.getFullYear(), date.getMonth(), date.getDate());
	if (prochain < jour)
		prochain = new Date(
			jour.getFullYear() + 1,
			date.getMonth(),
			date.getDate(),
		);
	const age = prochain.getFullYear() - date.getFullYear();
	const ans = `${age} an${age > 1 ? "s" : ""}`;
	const jours = joursEntre(jour, prochain);
	if (jours === 0) return `🎂 ${ans} aujourd'hui !`;
	return `🎂 ${ans} le ${formatAnniversaire.format(prochain)}${jours <= 30 ? ` (dans ${jours} jour${jours > 1 ? "s" : ""})` : ""}`;
}

const moi = () => app.etat.moi.id;
const personne = (id) => app.etat?.personnes.find((p) => p.id === id);
const prenomDe = (id) =>
	id === app.etat?.moi.id ? "toi" : (personne(id)?.prenom ?? "quelqu'un");

/** Familles affichées : celles activées, ou toutes si aucune ne l'est. */
function famillesActives() {
	const { familles } = app.etat;
	const actives = familles.filter((f) => app.famillesActives.has(f.id));
	return actives.length ? actives : familles;
}

const nomsFamilles = (familles) => familles.map((f) => f.nom).join(" + ");

/** Vrai quand une partie seulement des familles est affichée : chaque onglet est alors filtré. */
const filtreFamilles = () =>
	famillesActives().length < app.etat.familles.length;

/**
 * Vrai si l'une de ces personnes (autre que soi) est dans les familles affichées ; toujours vrai
 * sans filtre, même pour quelqu'un qui n'est plus dans aucune de ses familles.
 */
function dansFamillesAffichees(ids) {
	if (!filtreFamilles()) return true;
	const membres = new Set(famillesActives().flatMap((f) => f.membreIds));
	return ids.some((id) => id !== moi() && membres.has(id));
}

/**
 * Vrai pour une idée que son auteur a limitée à des familles dont aucune n'est affichée ; jamais
 * sans filtre.
 */
function horsFamillesAffichees(cadeau) {
	if (!filtreFamilles() || !cadeau.familleIds?.length) return false;
	return !famillesActives().some((f) => cadeau.familleIds.includes(f.id));
}

/** Ses familles qui peuvent voir une idée pour ces personnes : celles qui comptent l'une d'elles. */
const famillesPossibles = (pourIds) =>
	app.etat.familles.filter((f) =>
		f.membreIds.some((id) => pourIds.includes(id)),
	);

/** Secret Santa d'au moins une des familles affichées. */
function secretSantasAffiches() {
	const actives = new Set(famillesActives().map((f) => f.id));
	return app.etat.secretSantas.filter(
		(s) => !filtreFamilles() || s.familleIds.some((id) => actives.has(id)),
	);
}

/** Cadeaux que le membre offre, à des personnes des familles affichées. */
const mesReservations = () =>
	app.etat.cadeaux.filter(
		(c) => offreurs(c).includes(moi()) && dansFamillesAffichees(c.pourIds),
	);

/** Personnes des familles affichées (sans doublon), sans le membre connecté. */
function autresDeLaFamille() {
	const ids = new Set(famillesActives().flatMap((f) => f.membreIds));
	ids.delete(moi());
	return [...ids]
		.map(personne)
		.filter(Boolean)
		.sort((a, b) => a.prenom.localeCompare(b.prenom, "fr"));
}

/** « Léa », « Léa et Tom », « Léa, Tom et Zoé ». */
function prenoms(ids) {
	const noms = ids.map(prenomDe);
	return noms.length > 1
		? `${noms.slice(0, -1).join(", ")} et ${noms.at(-1)}`
		: (noms[0] ?? "");
}

const estPourMoi = (cadeau) => cadeau.pourIds.includes(moi());
const offreurs = (cadeau) => cadeau.reserveParIds ?? [];

/**
 * Même règle que le serveur : ses idées et suggestions, les souhaits communs dont on est
 * destinataire, et les idées des proches sans compte.
 */
function peutModifier(cadeau) {
	if (cadeau.ajouteParId === moi()) return true;
	if (estPourMoi(cadeau)) return cadeau.pourIds.includes(cadeau.ajouteParId);
	return cadeau.pourIds.every((id) => personne(id)?.compte === false);
}

function parPriorite(a, b) {
	return a.priorite - b.priorite || a.titre.localeCompare(b.titre, "fr");
}

// ---------------------------------------------------------------------------
// Cartes de cadeau
// ---------------------------------------------------------------------------

function lienCadeau(cadeau) {
	if (!/^https?:\/\//i.test(cadeau.lien)) return null;
	let hote = cadeau.lien;
	try {
		hote = new URL(cadeau.lien).hostname.replace(/^www\./, "");
	} catch {
		// Lien affiché tel quel.
	}
	return el(
		"a",
		{
			class: "carte-lien",
			href: cadeau.lien,
			target: "_blank",
			rel: "noopener noreferrer",
		},
		`Voir sur ${hote} ↗`,
	);
}

/**
 * @param options.pour "moi" (ma liste), "autre" (liste d'un autre) ou "reservation"
 * @param options.selectionnable case à cocher pour la réservation multiple
 */
function carteCadeau(cadeau, { pour, selectionnable = false }) {
	const selectionne = app.selection.has(cadeau.id);
	const retire = cadeau.statut === "retiré";
	const actions = el("div", { class: "carte-actions" });
	let partage = null;
	let etiquette = el(
		"span",
		{ class: `badge envie-${cadeau.priorite}` },
		ENVIES[cadeau.priorite] ?? "",
	);

	if (pour === "moi") {
		actions.append(
			el(
				"button",
				{
					type: "button",
					class: "bouton petit",
					onclick: () => ouvrirFormulaireCadeau(cadeau),
				},
				"Modifier",
			),
			el(
				"button",
				{
					type: "button",
					class: "bouton petit danger",
					onclick: () => supprimer(cadeau),
				},
				"Supprimer",
			),
		);
	} else if (retire) {
		etiquette = el("span", { class: "badge pris" }, "Retiré de la liste");
		actions.append(
			el(
				"button",
				{
					type: "button",
					class: "bouton petit",
					onclick: () => annuler([cadeau.id], "Effacé de tes réservations."),
				},
				"Effacer",
			),
		);
	} else {
		// Ses suggestions et les idées des proches sans compte : modifiables et supprimables ici.
		if (pour === "autre" && peutModifier(cadeau)) {
			actions.append(
				el(
					"button",
					{
						type: "button",
						class: "bouton petit",
						onclick: () => ouvrirFormulaireCadeau(cadeau),
					},
					"Modifier",
				),
				el(
					"button",
					{
						type: "button",
						class: "bouton petit danger",
						onclick: () => supprimer(cadeau),
					},
					"Supprimer",
				),
			);
		}
		const autres = offreurs(cadeau).filter((id) => id !== moi());
		if (offreurs(cadeau).includes(moi())) {
			const avec = autres.length ? ` avec ${prenoms(autres)}` : "";
			if (pour !== "reservation")
				etiquette = el("span", { class: "badge moi" }, `Tu l'offres${avec}`);
			else if (autres.length)
				etiquette = el(
					"span",
					{ class: "badge moi" },
					`Avec ${prenoms(autres)}`,
				);
			actions.append(
				el(
					"button",
					{
						type: "button",
						class: "bouton petit",
						onclick: () =>
							annuler(
								[cadeau.id],
								autres.length
									? "Tu ne participes plus."
									: "Réservation annulée.",
							),
					},
					autres.length ? "Me retirer" : "Annuler",
				),
			);
			// Cadeau groupé : d'autres ne peuvent participer que si l'un de ceux qui l'offrent le partage.
			partage = el(
				"label",
				{ class: "case-partage" },
				el("input", {
					type: "checkbox",
					checked: Boolean(cadeau.partage),
					onchange: (e) => partager(cadeau, e.target.checked),
				}),
				"Partager : d'autres peuvent participer",
			);
		} else if (autres.length) {
			etiquette = el(
				"span",
				{ class: "badge pris" },
				`Réservé par ${prenoms(autres)}${cadeau.partage ? " · partagé" : ""}`,
			);
			if (cadeau.partage) {
				actions.append(
					el(
						"button",
						{
							type: "button",
							class: "bouton petit",
							onclick: () => participer([cadeau.id]),
						},
						"Participer",
					),
				);
			}
		} else {
			etiquette = el("span", { class: "badge libre" }, "Disponible");
			actions.append(
				el(
					"button",
					{
						type: "button",
						class: "bouton petit principal",
						onclick: () => reserver([cadeau.id]),
					},
					"Je l'offre",
				),
			);
		}
	}

	const suggestion =
		pour !== "moi" &&
		cadeau.ajouteParId &&
		!cadeau.pourIds.includes(cadeau.ajouteParId)
			? el(
					"p",
					{ class: "carte-note" },
					cadeau.ajouteParId === moi()
						? "Ta suggestion"
						: `Suggéré par ${prenomDe(cadeau.ajouteParId)}`,
				)
			: null;
	const commun =
		cadeau.pourIds.length > 1
			? el(
					"p",
					{ class: "carte-note commun" },
					pour === "moi"
						? `Cadeau commun avec ${prenoms(cadeau.pourIds.filter((id) => id !== moi()))}`
						: `Pour ${prenoms(cadeau.pourIds)}`,
				)
			: null;
	const famillesVisibles = app.etat.familles.filter((f) =>
		cadeau.familleIds?.includes(f.id),
	);
	const visiblePar = famillesVisibles.length
		? el(
				"p",
				{ class: "carte-note" },
				`Visible par ${nomsFamilles(famillesVisibles)}`,
			)
		: null;
	const part =
		pour === "reservation" &&
		offreurs(cadeau).length > 1 &&
		typeof cadeau.prix === "number"
			? el(
					"p",
					{ class: "carte-note" },
					`Ta part ≈ ${prix(cadeau.prix / offreurs(cadeau).length)}`,
				)
			: null;
	const libre = pour !== "moi" && !retire && offreurs(cadeau).length === 0;
	return el(
		"article",
		{
			class: `carte${selectionne ? " selectionnee" : ""}${retire ? " retire" : ""}`,
		},
		selectionnable && libre
			? el(
					"label",
					{ class: "case" },
					el("input", {
						type: "checkbox",
						checked: selectionne,
						"aria-label": `Sélectionner ${cadeau.titre}`,
						onchange: (e) => basculerSelection(cadeau.id, e.target.checked),
					}),
				)
			: null,
		el(
			"div",
			{ class: "carte-corps" },
			el(
				"div",
				{ class: "carte-haut" },
				el("h3", { class: "carte-titre" }, cadeau.titre),
				el("span", { class: "carte-prix" }, prix(cadeau.prix)),
			),
			cadeau.description
				? el("p", { class: "carte-description" }, cadeau.description)
				: null,
			lienCadeau(cadeau),
			commun,
			suggestion,
			visiblePar,
			part,
			el("div", { class: "carte-bas" }, etiquette, actions),
			partage,
		),
	);
}

function vide(message, ...enfants) {
	return el("div", { class: "vide" }, el("p", {}, message), ...enfants);
}

// ---------------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------------

const TITRES = {
	"ma-liste": "Ma liste",
	famille: "La famille",
	disponibles: "Disponibles",
	reservations: "Ce que j'offre",
	historique: "Déjà offert",
};

function rendreMaListe() {
	const tous = app.etat.cadeaux.filter(estPourMoi);
	// Ses idées à soi seul sont vues de toutes ses familles (sauf celles qu'on a limitées à
	// certaines) ; une idée commune suit le filtre.
	const miens = tous
		.filter(
			(c) =>
				(c.pourIds.length === 1 || dansFamillesAffichees(c.pourIds)) &&
				!horsFamillesAffichees(c),
		)
		.sort(parPriorite);
	const masques = tous.length - miens.length;
	const ajouter = el(
		"button",
		{
			type: "button",
			class: "bouton principal",
			onclick: () => ouvrirFormulaireCadeau(null, [moi()]),
		},
		"+ Ajouter une idée",
	);
	if (miens.length === 0 && masques === 0) {
		return [
			vide(
				"Ta liste est vide pour l'instant. Ajoute tes idées de cadeaux, tes proches pourront s'en inspirer !",
				ajouter,
			),
		];
	}
	return [
		el(
			"p",
			{ class: "discret" },
			`${miens.length} idée(s). Tu ne vois ni ce qui est réservé, ni ce que les autres te suggèrent : surprise !`,
		),
		masques
			? el(
					"p",
					{ class: "discret" },
					`${masques} idée(s) pour d'autres familles, masquée(s) par le filtre.`,
				)
			: null,
		...miens.map((c) => carteCadeau(c, { pour: "moi" })),
		el("div", {}, ajouter),
	];
}

function dejaOffertA(id, prenom = null) {
	const entrees = app.etat.historique.filter((e) =>
		e.destinataires.some((d) => d.id === id),
	);
	if (entrees.length === 0) return null;
	return el(
		"details",
		{ class: "deja-offert" },
		el(
			"summary",
			{},
			prenom
				? `Déjà offert à ${prenom} (${entrees.length})`
				: `Tu lui as déjà offert (${entrees.length})`,
		),
		el(
			"ul",
			{},
			entrees.map((e) =>
				el(
					"li",
					{},
					el(
						"span",
						{ class: "discret" },
						`${e.date ? new Date(e.date).getFullYear() : "?"} · ${e.occasion}`,
					),
					" ",
					e.details,
				),
			),
		),
	);
}

function rendreFamille() {
	const autres = autresDeLaFamille();
	if (autres.length === 0) {
		return [
			vide(
				`Personne d'autre dans ${nomsFamilles(famillesActives())} pour l'instant. Partage le code (menu en haut à droite, Mon profil), ou ajoute un proche qui n'utilisera pas l'app (enfant, grands-parents…).`,
				el(
					"button",
					{ type: "button", class: "bouton", onclick: ouvrirAjoutPersonne },
					"Ajouter une personne",
				),
			),
		];
	}
	// Une ou plusieurs personnes : leurs listes réunies, et une idée commune possible.
	const selection = new Set(
		[...app.personnesFamille].filter((id) => autres.some((p) => p.id === id)),
	);
	if (selection.size === 0) selection.add(autres[0].id);
	app.personnesFamille = selection;
	const choisies = autres.filter((p) => selection.has(p.id));
	const ids = choisies.map((p) => p.id);
	const basculer = (id) => {
		if (selection.has(id)) {
			if (selection.size > 1) selection.delete(id);
		} else {
			selection.add(id);
		}
		rendre();
	};
	const puces = el(
		"div",
		{
			class: "puces",
			role: "group",
			"aria-label": "Personnes (une ou plusieurs)",
		},
		autres.map((p) =>
			el(
				"button",
				{
					type: "button",
					"aria-pressed": String(selection.has(p.id)),
					onclick: () => basculer(p.id),
				},
				p.prenom,
			),
		),
		el(
			"button",
			{
				type: "button",
				class: "puce-ajout",
				onclick: ouvrirAjoutPersonne,
				"aria-label": "Ajouter une personne sans compte",
			},
			"+ Personne",
		),
	);
	const leursCadeaux = app.etat.cadeaux
		.filter(
			(c) =>
				c.pourIds.some((id) => selection.has(id)) &&
				!estPourMoi(c) &&
				c.statut !== "retiré" &&
				!horsFamillesAffichees(c),
		)
		.sort(parPriorite);
	const libres = leursCadeaux.filter((c) => offreurs(c).length === 0).length;
	const seule = choisies.length === 1 ? choisies[0] : null;
	const avecCompte = choisies.filter((p) => p.compte);
	const ajouter = el(
		"button",
		{
			type: "button",
			class: "bouton",
			onclick: () => ouvrirFormulaireCadeau(null, ids),
		},
		seule
			? seule.compte
				? `+ Suggérer une idée pour ${seule.prenom}`
				: `+ Ajouter une idée pour ${seule.prenom}`
			: `+ Idée commune pour ${prenoms(ids)}`,
	);
	return [
		puces,
		choisies.length === 1
			? null
			: el(
					"p",
					{ class: "discret" },
					"Touche un prénom pour l'ajouter ou le retirer : leurs listes sont réunies.",
				),
		el(
			"div",
			{ class: "groupe-titre" },
			el("h2", {}, seule?.nom ? `${seule.prenom} ${seule.nom}` : prenoms(ids)),
			el(
				"span",
				{ class: "discret" },
				leursCadeaux.length
					? `${libres} disponible(s) sur ${leursCadeaux.length}`
					: "",
			),
		),
		choisies
			.filter((p) => p.naissance)
			.map((p) =>
				el(
					"p",
					{ class: "anniversaire" },
					seule
						? anniversaire(p.naissance)
						: `${p.prenom} : ${anniversaire(p.naissance)}`,
				),
			),
		choisies
			.filter((p) => !p.compte)
			.map((p) =>
				el(
					"div",
					{ class: "sans-compte" },
					el(
						"p",
						{ class: "discret" },
						`${p.prenom} n'a pas encore de compte : la famille tient sa liste.`,
					),
					el(
						"button",
						{ type: "button", class: "lien-bouton", onclick: () => inviter(p) },
						`Inviter ${p.prenom} (QR code)`,
					),
				),
			),
		leursCadeaux.length === 0
			? vide(
					seule
						? `${seule.prenom} n'a encore rien demandé.`
						: "Rien de demandé pour l'instant.",
				)
			: el(
					"div",
					{ class: "groupe" },
					leursCadeaux.map((c) =>
						carteCadeau(c, { pour: "autre", selectionnable: true }),
					),
				),
		el(
			"div",
			{ class: "pile" },
			ajouter,
			avecCompte.length
				? el(
						"p",
						{ class: "discret" },
						`${prenoms(avecCompte.map((p) => p.id))} ne ${avecCompte.length > 1 ? "verront" : "verra"} pas tes suggestions.`,
					)
				: null,
		),
		choisies.map((p) => dejaOffertA(p.id, seule ? null : p.prenom)),
	];
}

function rendreDisponibles() {
	const autres = autresDeLaFamille();
	const ids = new Set(autres.map((p) => p.id));
	let libres = app.etat.cadeaux.filter(
		(c) =>
			c.pourIds.some((id) => ids.has(id)) &&
			!estPourMoi(c) &&
			c.statut !== "retiré" &&
			!horsFamillesAffichees(c) &&
			offreurs(c).length === 0,
	);
	if (app.filtreDisponibles)
		libres = libres.filter((c) => c.pourIds.includes(app.filtreDisponibles));
	const tris = {
		priorite: parPriorite,
		"prix-croissant": (a, b) => (a.prix ?? Infinity) - (b.prix ?? Infinity),
		"prix-decroissant": (a, b) => (b.prix ?? -1) - (a.prix ?? -1),
	};
	libres.sort(tris[app.triDisponibles]);

	const filtres = el(
		"div",
		{ class: "barre-outils" },
		el(
			"select",
			{
				"aria-label": "Pour qui",
				onchange: (e) => {
					app.filtreDisponibles = e.target.value;
					rendre();
				},
			},
			el("option", { value: "" }, "Tout le monde"),
			autres.map((p) =>
				el(
					"option",
					{ value: p.id, selected: p.id === app.filtreDisponibles },
					`Pour ${p.prenom}`,
				),
			),
		),
		el(
			"select",
			{
				"aria-label": "Trier",
				onchange: (e) => {
					app.triDisponibles = e.target.value;
					rendre();
				},
			},
			el(
				"option",
				{ value: "priorite", selected: app.triDisponibles === "priorite" },
				"Les plus attendus",
			),
			el(
				"option",
				{
					value: "prix-croissant",
					selected: app.triDisponibles === "prix-croissant",
				},
				"Prix croissant",
			),
			el(
				"option",
				{
					value: "prix-decroissant",
					selected: app.triDisponibles === "prix-decroissant",
				},
				"Prix décroissant",
			),
		),
	);
	// Cadeaux réservés par d'autres mais partagés : on peut encore y participer.
	let aPartager = app.etat.cadeaux.filter(
		(c) =>
			c.pourIds.some((id) => ids.has(id)) &&
			!estPourMoi(c) &&
			c.statut !== "retiré" &&
			!horsFamillesAffichees(c) &&
			c.partage &&
			offreurs(c).length > 0 &&
			!offreurs(c).includes(moi()),
	);
	if (app.filtreDisponibles)
		aPartager = aPartager.filter((c) =>
			c.pourIds.includes(app.filtreDisponibles),
		);
	const sectionPartage = aPartager.length
		? el(
				"section",
				{ class: "groupe" },
				el(
					"div",
					{ class: "groupe-titre" },
					el("h2", {}, "À partager"),
					el("span", { class: "discret" }, `${aPartager.length}`),
				),
				el(
					"p",
					{ class: "discret" },
					"Déjà réservés, mais ceux qui les offrent acceptent que tu participes.",
				),
				aPartager
					.sort(parPriorite)
					.map((c) => carteCadeau(c, { pour: "autre" })),
			)
		: null;
	if (libres.length === 0)
		return [
			filtres,
			sectionPartage ??
				vide("Plus aucun cadeau disponible ici. Tout est déjà réservé !"),
		];

	// Un groupe par destinataire, ou par groupe de destinataires pour un cadeau commun.
	const groupes = new Map();
	for (const c of libres) {
		const cle = [...c.pourIds].sort().join(",");
		if (!groupes.has(cle))
			groupes.set(cle, { titre: `Pour ${prenoms(c.pourIds)}`, cadeaux: [] });
		groupes.get(cle).cadeaux.push(c);
	}
	return [
		filtres,
		el(
			"p",
			{ class: "discret" },
			"Coche plusieurs cadeaux pour les réserver d'un coup.",
		),
		sectionPartage,
		[...groupes.values()]
			.sort((a, b) => a.titre.localeCompare(b.titre, "fr"))
			.map((g) =>
				el(
					"section",
					{ class: "groupe" },
					el(
						"div",
						{ class: "groupe-titre" },
						el("h2", {}, g.titre),
						el("span", { class: "discret" }, `${g.cadeaux.length}`),
					),
					g.cadeaux.map((c) =>
						carteCadeau(c, { pour: "autre", selectionnable: true }),
					),
				),
			),
	];
}

function carteSecretSanta(s) {
	const familles = app.etat.familles.filter((f) => s.familleIds.includes(f.id));
	const organisateur = s.organisateurId === moi();
	const revele = app.revele.has(s.id);
	const receveur = s.monReceveurId ? personne(s.monReceveurId) : null;
	const basculer = () => {
		if (revele) app.revele.delete(s.id);
		else app.revele.add(s.id);
		rendre();
	};
	return el(
		"article",
		{ class: "carte secret-santa" },
		el(
			"div",
			{ class: "carte-corps" },
			el(
				"div",
				{ class: "carte-haut" },
				el("h3", { class: "carte-titre" }, `🎅 ${s.nom}`),
				el(
					"span",
					{ class: "carte-prix" },
					s.budget ? `${prix(s.budget)} max` : "",
				),
			),
			el(
				"p",
				{ class: "carte-description" },
				[
					familles.length
						? `${familles.length > 1 ? "Familles" : "Famille"} ${nomsFamilles(familles)}`
						: "",
					`${s.participantIds.length} participants`,
					organisateur
						? "organisé par toi"
						: `organisé par ${prenomDe(s.organisateurId)}`,
				]
					.filter(Boolean)
					.join(" · "),
			),
			s.monReceveurId
				? el(
						"div",
						{ class: "tirage" },
						el("span", {}, "Tu offres à "),
						el(
							"strong",
							{ class: revele ? "" : "masque" },
							revele ? (receveur?.prenom ?? "?") : "••••••",
						),
						el(
							"button",
							{ type: "button", class: "lien-bouton", onclick: basculer },
							revele ? "Masquer" : "Afficher",
						),
					)
				: el(
						"p",
						{ class: "discret" },
						"Tu ne participes pas : tu ne vois aucun tirage.",
					),
			el(
				"div",
				{ class: "carte-actions" },
				s.monReceveurId && revele && receveur
					? el(
							"button",
							{
								type: "button",
								class: "bouton petit principal",
								onclick: () => voirListe(s.familleIds, receveur.id),
							},
							"Voir sa liste",
						)
					: null,
				organisateur
					? el(
							"button",
							{
								type: "button",
								class: "bouton petit",
								onclick: () => relancerTirage(s),
							},
							"Relancer le tirage",
						)
					: null,
				organisateur
					? el(
							"button",
							{
								type: "button",
								class: "bouton petit danger",
								onclick: () => supprimerSecretSanta(s),
							},
							"Supprimer",
						)
					: null,
			),
		),
	);
}

function rendreSecretSantas() {
	return el(
		"section",
		{ class: "groupe" },
		el(
			"div",
			{ class: "groupe-titre" },
			el("h2", {}, "Secret Santa"),
			el(
				"button",
				{
					type: "button",
					class: "lien-bouton",
					onclick: ouvrirFormulaireSecretSanta,
				},
				"+ Organiser",
			),
		),
		secretSantasAffiches().map(carteSecretSanta),
	);
}

function rendreReservations() {
	const miennes = mesReservations();
	if (miennes.length === 0) {
		const ailleurs = app.etat.cadeaux.some((c) => offreurs(c).includes(moi()));
		return [
			rendreSecretSantas(),
			vide(
				ailleurs
					? `Tu n'offres rien dans ${nomsFamilles(famillesActives())}.`
					: "Tu n'offres encore rien.",
				el(
					"button",
					{
						type: "button",
						class: "bouton principal",
						onclick: () => changerOnglet("disponibles"),
					},
					"Voir les cadeaux disponibles",
				),
			),
		];
	}
	const actifs = miennes.filter((c) => c.statut !== "retiré");
	// Cadeau groupé : seule sa part compte dans le total.
	const total = actifs.reduce(
		(somme, c) => somme + (c.prix ?? 0) / offreurs(c).length,
		0,
	);
	const groupes = new Map();
	for (const c of miennes) {
		const cle = [...c.pourIds].sort().join(",");
		if (!groupes.has(cle))
			groupes.set(cle, { titre: `Pour ${prenoms(c.pourIds)}`, cadeaux: [] });
		groupes.get(cle).cadeaux.push(c);
	}
	return [
		rendreSecretSantas(),
		el(
			"div",
			{ class: "total" },
			el("span", {}, `${actifs.length} cadeau(x)`),
			el("span", {}, `≈ ${prix(total)}`),
		),
		[...groupes.values()].map((g) =>
			el(
				"section",
				{ class: "groupe" },
				el("div", { class: "groupe-titre" }, el("h2", {}, g.titre)),
				g.cadeaux
					.sort(parPriorite)
					.map((c) => carteCadeau(c, { pour: "reservation" })),
			),
		),
		el("p", { class: "discret" }, "Le 26 décembre, ces cadeaux sont archivés."),
	];
}

function rendreHistorique() {
	const ajouter = el(
		"button",
		{
			type: "button",
			class: "bouton principal",
			onclick: ouvrirFormulaireHistorique,
		},
		"+ Ajouter",
	);
	if (app.etat.historique.length === 0) {
		return [
			vide(
				"Aucun cadeau archivé pour l'instant. Chaque 26 décembre, les cadeaux que tu offres sont archivés ici ; tu peux aussi en ajouter.",
				ajouter,
			),
		];
	}
	// Filtre des familles : les cadeaux offerts à l'un de leurs membres (pas aux destinataires en texte).
	const toutes = app.etat.historique.filter((e) =>
		dansFamillesAffichees(e.destinataires.map((d) => d.id).filter(Boolean)),
	);
	if (toutes.length === 0) {
		return [
			vide(
				`Aucun cadeau archivé pour ${nomsFamilles(famillesActives())}.`,
				ajouter,
			),
		];
	}
	const cle = (d) => d.id ?? `texte:${d.nom}`;
	const destinataires = new Map();
	for (const e of toutes)
		for (const d of e.destinataires) destinataires.set(cle(d), d.nom);
	const entrees = app.filtreHistorique
		? toutes.filter((e) =>
				e.destinataires.some((d) => cle(d) === app.filtreHistorique),
			)
		: toutes;
	const annees = new Map();
	for (const e of entrees) {
		const annee = e.date ? String(new Date(e.date).getFullYear()) : "Sans date";
		if (!annees.has(annee)) annees.set(annee, []);
		annees.get(annee).push(e);
	}
	return [
		el(
			"div",
			{ class: "barre-outils" },
			el(
				"select",
				{
					"aria-label": "Pour qui",
					onchange: (e) => {
						app.filtreHistorique = e.target.value;
						rendre();
					},
				},
				el("option", { value: "" }, "Tout le monde"),
				[...destinataires]
					.sort((a, b) => a[1].localeCompare(b[1], "fr"))
					.map(([valeur, nom]) =>
						el(
							"option",
							{ value: valeur, selected: valeur === app.filtreHistorique },
							`Pour ${nom}`,
						),
					),
			),
			ajouter,
		),
		el("p", { class: "discret" }, "Visible de toi seul."),
		[...annees].map(([annee, liste]) =>
			el(
				"section",
				{ class: "groupe" },
				el(
					"div",
					{ class: "groupe-titre" },
					el("h2", {}, annee),
					el("span", { class: "discret" }, `${liste.length}`),
				),
				liste.map((e) =>
					el(
						"article",
						{ class: "carte compacte" },
						el(
							"div",
							{ class: "carte-corps" },
							el(
								"div",
								{ class: "carte-haut" },
								el("h3", { class: "carte-titre" }, e.details),
								el("span", { class: "carte-prix" }, prix(e.prix)),
							),
							el(
								"p",
								{ class: "carte-description" },
								[
									e.occasion,
									`pour ${e.destinataires.map((d) => d.nom).join(", ")}`,
									e.avec.length ? `avec ${e.avec.join(", ")}` : "",
									e.date ? formatDate.format(new Date(e.date)) : "",
								]
									.filter(Boolean)
									.join(" · "),
							),
						),
						el(
							"button",
							{
								type: "button",
								class: "icone-supprimer",
								"aria-label": `Supprimer ${e.details}`,
								onclick: () => supprimerEntree(e),
							},
							"×",
						),
					),
				),
			),
		),
	];
}

const RENDUS = {
	"ma-liste": rendreMaListe,
	famille: rendreFamille,
	disponibles: rendreDisponibles,
	reservations: rendreReservations,
	historique: rendreHistorique,
};

function rendreEntete() {
	const { moi: membre, familles } = app.etat;
	$("#titre-onglet").textContent = TITRES[app.onglet];
	$("#menu-nom").textContent = `Connecté en tant que ${membre.prenom}`;

	// Plusieurs familles : des pastilles dans l'en-tête, chacune s'active ou se désactive (plusieurs
	// à la fois). Une seule : son nom au-dessus du titre. Dans tous les cas, « + » pour en rejoindre
	// ou en créer une.
	const actives = new Set(famillesActives().map((f) => f.id));
	const plusieurs = familles.length > 1;
	$("#libelle-famille").textContent = plusieurs
		? "Cadeaux de Noël"
		: familles[0]
			? `Famille ${familles[0].nom}`
			: "Cadeaux de Noël";
	$("#familles-entete").replaceChildren(
		...(plusieurs
			? familles.map((f) =>
					el(
						"button",
						{
							type: "button",
							"aria-pressed": String(actives.has(f.id)),
							onclick: () => basculerFamille(f.id),
						},
						f.nom,
					),
				)
			: []),
		el(
			"button",
			{
				type: "button",
				class: "puce-ajout",
				"aria-label": "Rejoindre ou créer une famille",
				onclick: () => $("#dialogue-ajout-famille").showModal(),
			},
			"+",
		),
	);
}

function rendre() {
	if (!app.etat) return;
	rendreEntete();
	for (const bouton of document.querySelectorAll(".onglets button")) {
		if (bouton.dataset.onglet === app.onglet)
			bouton.setAttribute("aria-current", "page");
		else bouton.removeAttribute("aria-current");
	}
	const nbReservations = mesReservations().length;
	const pastille = $("#compteur-reservations");
	pastille.hidden = nbReservations === 0;
	pastille.textContent = String(nbReservations);

	remplacerContenu($("#contenu"), ...RENDUS[app.onglet]());
	rendreSelection();
}

function changerOnglet(onglet) {
	app.onglet = onglet;
	ecrireStockage(CLES.onglet, onglet);
	rendre();
	window.scrollTo({ top: 0 });
}

function enregistrerFamillesActives(ids) {
	app.famillesActives = new Set(ids);
	app.personnesFamille = new Set();
	app.filtreDisponibles = "";
	app.filtreHistorique = "";
	app.selection.clear();
	ecrireStockage(CLES.familles, JSON.stringify([...ids]));
	rendre();
}

/** Active ou désactive une famille ; la dernière active le reste. */
function basculerFamille(id) {
	const actives = new Set(famillesActives().map((f) => f.id));
	if (actives.has(id)) {
		if (actives.size === 1) return;
		actives.delete(id);
	} else {
		actives.add(id);
	}
	enregistrerFamillesActives(actives);
}

/** Affiche aussi ces familles (famille rejointe ou créée, liste d'un Secret Santa). */
function activerFamille(...ids) {
	enregistrerFamillesActives(
		new Set([...famillesActives().map((f) => f.id), ...ids]),
	);
}

// ---------------------------------------------------------------------------
// Réservations (une ou plusieurs)
// ---------------------------------------------------------------------------

function basculerSelection(id, coche) {
	if (coche) app.selection.add(id);
	else app.selection.delete(id);
	rendre();
}

function rendreSelection() {
	const visible =
		app.selection.size > 0 &&
		(app.onglet === "disponibles" || app.onglet === "famille");
	$("#barre-selection").hidden = !visible;
	$("#ecran-app").classList.toggle("avec-selection", visible);
	if (!visible) return;
	const choisis = app.etat.cadeaux.filter((c) => app.selection.has(c.id));
	const total = choisis.reduce((somme, c) => somme + (c.prix ?? 0), 0);
	$("#resume-selection").textContent =
		`${choisis.length} sélectionné(s)${total ? ` · ${prix(total)}` : ""}`;
	$("#bouton-offrir-selection").textContent =
		choisis.length > 1 ? "Je les offre" : "Je l'offre";
}

function messageRefus(resultat) {
	const titre = (id) =>
		app.etat.cadeaux.find((c) => c.id === id)?.titre ?? "Un cadeau";
	return resultat.refuses.map((r) => `${titre(r.id)} : ${r.raison}`).join("\n");
}

async function reserver(ids) {
	const resultat = await modifier("reserver", { cadeauIds: ids });
	if (!resultat) return;
	for (const id of ids) app.selection.delete(id);
	rendre();
	if (resultat.faits.length)
		notifier(
			resultat.faits.length > 1
				? `${resultat.faits.length} cadeaux réservés. 🎁`
				: "Cadeau réservé. 🎁",
		);
	if (resultat.refuses.length) notifier(messageRefus(resultat), true);
}

/** Rejoindre ceux qui offrent déjà un cadeau (cadeau groupé). */
async function participer(ids) {
	const resultat = await modifier("reserver", {
		cadeauIds: ids,
		participer: true,
	});
	if (!resultat) return;
	if (resultat.faits.length) notifier("Tu participes à ce cadeau. 🎁");
	if (resultat.refuses.length) notifier(messageRefus(resultat), true);
}

async function partager(cadeau, partage) {
	const reussi = await modifier(
		"partager-cadeau",
		{ cadeauId: cadeau.id, partage },
		partage
			? "Cadeau partagé : d'autres peuvent participer."
			: "Cadeau plus partagé.",
	);
	if (!reussi) rendre();
}

async function annuler(ids, message) {
	const resultat = await modifier("annuler-reservation", { cadeauIds: ids });
	if (!resultat) return;
	if (resultat.faits.length) notifier(message);
	if (resultat.refuses.length) notifier(messageRefus(resultat), true);
}

// ---------------------------------------------------------------------------
// Idées : ajout (pour soi ou pour un proche), modification, suppression
// ---------------------------------------------------------------------------

/** @param pourIds destinataires de l'idée (plusieurs : idée commune) */
function ouvrirFormulaireCadeau(cadeau, pourIds = cadeau?.pourIds ?? [moi()]) {
	app.edition = { cadeau, pourIds };
	const form = $("#form-cadeau");
	form.reset();
	const pourMoi = pourIds.includes(moi());
	const comptes = pourIds.filter((id) => id !== moi() && personne(id)?.compte);
	$("#titre-dialogue").textContent = cadeau
		? "Modifier l'idée"
		: pourIds.length === 1 && pourMoi
			? "Nouvelle idée"
			: `Idée pour ${prenoms(pourIds)}`;
	$("#aide-dialogue").textContent =
		cadeau || pourMoi
			? ""
			: comptes.length
				? `${prenoms(comptes)} ne ${comptes.length > 1 ? "verront" : "verra"} pas cette idée ; les autres pourront la réserver.`
				: "Personne sans compte : l'idée rejoint sa liste.";
	$("#erreur-cadeau").textContent = "";
	$("#bouton-supprimer-cadeau").hidden = !cadeau;
	// Seul l'auteur choisit les familles qui voient l'idée, parmi les siennes qui comptent un
	// destinataire (toutes cochées quand il n'en a limité aucune).
	const possibles =
		!cadeau || cadeau.ajouteParId === moi() ? famillesPossibles(pourIds) : [];
	const choisies = cadeau?.familleIds ?? [];
	$("#champ-visible-par").hidden = possibles.length < 2;
	$("#cadeau-familles").replaceChildren(
		...possibles.map((f) =>
			el(
				"label",
				{ class: "case-texte" },
				el("input", {
					type: "checkbox",
					name: "famille-cadeau",
					value: f.id,
					checked: choisies.length === 0 || choisies.includes(f.id),
				}),
				f.nom,
			),
		),
	);
	if (cadeau) {
		form.titre.value = cadeau.titre;
		form.description.value = cadeau.description;
		form.lien.value = cadeau.lien;
		form.prix.value = cadeau.prix ?? "";
		form.priorite.value = String(cadeau.priorite);
	}
	$("#dialogue-cadeau").showModal();
	form.titre.focus();
}

async function enregistrerCadeau(evenement) {
	evenement.preventDefault();
	const form = evenement.target;
	const cadeau = {
		titre: form.titre.value,
		description: form.description.value,
		lien: form.lien.value,
		prix: form.prix.value,
		priorite: Number(form.priorite.value),
	};
	if (!$("#champ-visible-par").hidden) {
		cadeau.familleIds = [
			...form.querySelectorAll("input[name=famille-cadeau]:checked"),
		].map((c) => c.value);
		if (cadeau.familleIds.length === 0) {
			$("#erreur-cadeau").textContent = "Choisis au moins une famille.";
			return;
		}
	}
	const { cadeau: existant, pourIds } = app.edition;
	$("#erreur-cadeau").textContent = "";
	const reussi = await modifier(
		existant ? "modifier-cadeau" : "ajouter-cadeau",
		existant ? { cadeauId: existant.id, cadeau } : { cadeau, pourIds },
		existant
			? "Idée modifiée."
			: pourIds.length === 1 && pourIds[0] === moi()
				? "Idée ajoutée à ta liste."
				: `Idée ajoutée pour ${prenoms(pourIds)}.`,
		(message) => {
			$("#erreur-cadeau").textContent = message;
		},
	);
	if (reussi) $("#dialogue-cadeau").close();
}

async function supprimer(cadeau) {
	if (!confirm(`Supprimer « ${cadeau.titre} » ?`)) return false;
	return Boolean(
		await modifier(
			"supprimer-cadeau",
			{ cadeauId: cadeau.id },
			"Idée supprimée.",
		),
	);
}

async function supprimerDepuisFormulaire() {
	const { cadeau } = app.edition;
	if (cadeau && (await supprimer(cadeau))) $("#dialogue-cadeau").close();
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

function ouvrirFormulaireHistorique() {
	const form = $("#form-historique");
	form.reset();
	$("#erreur-historique").textContent = "";
	form.date.value = versChampDate(aujourdhui());
	const proches = app.etat.personnes
		.filter((p) => p.id !== moi())
		.sort((a, b) => a.prenom.localeCompare(b.prenom, "fr"));
	$("#historique-personnes").replaceChildren(
		...proches.map((p) =>
			el(
				"label",
				{ class: "case-texte" },
				el("input", { type: "checkbox", name: "destinataire", value: p.id }),
				p.prenom,
			),
		),
	);
	$("#dialogue-historique").showModal();
	form.details.focus();
}

async function enregistrerHistorique(evenement) {
	evenement.preventDefault();
	const form = evenement.target;
	const entree = {
		details: form.details.value,
		date: form.date.value,
		occasion: form.occasion.value,
		destinataireIds: [
			...form.querySelectorAll("input[name=destinataire]:checked"),
		].map((c) => c.value),
		autresDestinataires: form.autres.value,
		prix: form.prix.value,
	};
	const reussi = await modifier(
		"ajouter-historique",
		{ entree },
		"Ajouté à ton historique.",
		(message) => {
			$("#erreur-historique").textContent = message;
		},
	);
	if (reussi) $("#dialogue-historique").close();
}

async function supprimerEntree(entree) {
	if (!confirm(`Retirer « ${entree.details} » de ton historique ?`)) return;
	await modifier(
		"supprimer-historique",
		{ entreeId: entree.id },
		"Retiré de ton historique.",
	);
}

// ---------------------------------------------------------------------------
// Secret Santa
// ---------------------------------------------------------------------------

function voirListe(familleIds, personneId) {
	activerFamille(...familleIds);
	app.personnesFamille = new Set([personneId]);
	changerOnglet("famille");
}

function ajouterLigneExclusion(participants) {
	const options = () =>
		participants.map((p) => el("option", { value: p.id }, p.prenom));
	const ligne = el(
		"div",
		{ class: "ligne exclusion" },
		el("select", { "aria-label": "Personne" }, options()),
		el("span", { class: "discret" }, "↔"),
		el("select", { "aria-label": "Ne tire pas" }, options()),
		el(
			"button",
			{
				type: "button",
				class: "icone-supprimer",
				"aria-label": "Retirer l'exclusion",
				onclick: () => ligne.remove(),
			},
			"×",
		),
	);
	$("#secret-santa-exclusions").append(ligne);
}

/** Participants (tous cochés) et exclusions du formulaire, pour les familles cochées. */
function remplirParticipants() {
	const familleIds = [
		...document.querySelectorAll("input[name=famille-secret-santa]:checked"),
	].map((c) => c.value);
	const ids = new Set(
		app.etat.familles
			.filter((f) => familleIds.includes(f.id))
			.flatMap((f) => f.membreIds),
	);
	const participants = [...ids]
		.map(personne)
		.filter(Boolean)
		.sort((a, b) => a.prenom.localeCompare(b.prenom, "fr"));
	$("#secret-santa-participants").replaceChildren(
		...participants.map((p) =>
			el(
				"label",
				{ class: "case-texte" },
				el("input", {
					type: "checkbox",
					name: "participant",
					value: p.id,
					checked: true,
				}),
				p.prenom,
			),
		),
	);
	$("#secret-santa-exclusions").replaceChildren();
	$("#bouton-ajouter-exclusion").onclick = () =>
		ajouterLigneExclusion(participants);
	app.edition = { familleIds };
}

function ouvrirFormulaireSecretSanta() {
	const { familles } = app.etat;
	if (familles.length === 0) return;
	const actives = new Set(famillesActives().map((f) => f.id));
	const form = $("#form-secret-santa");
	form.reset();
	$("#erreur-secret-santa").textContent = "";
	form.nom.value = `Secret Santa Noël ${new Date().getFullYear()}`;
	// Toutes ses familles au choix (les familles affichées cochées) : les participants viennent de chacune.
	$("#champ-famille-secret-santa").hidden = familles.length < 2;
	$("#secret-santa-familles").replaceChildren(
		...familles.map((f) =>
			el(
				"label",
				{ class: "case-texte" },
				el("input", {
					type: "checkbox",
					name: "famille-secret-santa",
					value: f.id,
					checked: actives.has(f.id),
					onchange: remplirParticipants,
				}),
				f.nom,
			),
		),
	);
	remplirParticipants();
	$("#dialogue-secret-santa").showModal();
}

async function enregistrerSecretSanta(evenement) {
	evenement.preventDefault();
	const form = evenement.target;
	const secretSanta = {
		familleIds: app.edition.familleIds,
		nom: form.nom.value,
		budget: form.budget.value,
		participantIds: [
			...form.querySelectorAll("input[name=participant]:checked"),
		].map((c) => c.value),
		exclusions: [
			...$("#secret-santa-exclusions").querySelectorAll(".exclusion"),
		]
			.map((ligne) => [...ligne.querySelectorAll("select")].map((s) => s.value))
			.filter(([a, b]) => a !== b),
	};
	if (secretSanta.familleIds.length === 0) {
		$("#erreur-secret-santa").textContent = "Choisis au moins une famille.";
		return;
	}
	if (secretSanta.participantIds.length < 3) {
		$("#erreur-secret-santa").textContent = "Il faut au moins 3 participants.";
		return;
	}
	const cree = await modifier(
		"creer-secret-santa",
		{ secretSanta },
		"Tirage fait ! Chacun découvre sa personne dans « J'offre ».",
		(message) => {
			$("#erreur-secret-santa").textContent = message;
		},
	);
	if (cree) $("#dialogue-secret-santa").close();
}

async function relancerTirage(s) {
	if (
		!confirm(
			`Refaire le tirage de « ${s.nom} » ? Chacun aura une nouvelle personne : préviens les participants.`,
		)
	)
		return;
	app.revele.delete(s.id);
	await modifier(
		"relancer-tirage",
		{ secretSantaId: s.id },
		"Nouveau tirage fait.",
	);
}

async function supprimerSecretSanta(s) {
	if (!confirm(`Supprimer « ${s.nom} » et son tirage ?`)) return;
	await modifier(
		"supprimer-secret-santa",
		{ secretSantaId: s.id },
		"Secret Santa supprimé.",
	);
}

// ---------------------------------------------------------------------------
// Familles : rejoindre, créer, ajouter une personne sans compte
// ---------------------------------------------------------------------------

/**
 * Ouvre le petit formulaire générique.
 * @param champs [{ nom, libelle, type?, valeur?, maxlength?, requis?, options? }] : avec `options`
 * ([{ valeur, libelle }]), une liste de choix au lieu d'un texte
 * @param valider (valeurs, afficherErreur) => Promise<boolean> : vrai pour fermer
 * @param bas éléments affichés sous les champs
 */
function ouvrirDialogueSimple({
	titre,
	aide = "",
	champs,
	bas = [],
	bouton = "Valider",
	valider,
}) {
	fermerMenu();
	$("#simple-titre").textContent = titre;
	$("#simple-aide").textContent = aide;
	$("#simple-valider").textContent = bouton;
	$("#erreur-simple").textContent = "";
	$("#simple-champs").replaceChildren(
		...champs.flatMap((c) => [
			el("label", { for: `simple-${c.nom}` }, c.libelle),
			c.options
				? el(
						"select",
						{ id: `simple-${c.nom}`, name: c.nom },
						c.options.map((o) => el("option", { value: o.valeur }, o.libelle)),
					)
				: el("input", {
						id: `simple-${c.nom}`,
						name: c.nom,
						type: c.type ?? "text",
						value: c.valeur ?? "",
						max: c.type === "date" ? versChampDate(aujourdhui()) : null,
						maxlength: c.type === "date" ? null : (c.maxlength ?? 60),
						required: c.requis !== false,
						autocomplete: "off",
					}),
		]),
		...bas,
	);
	const form = $("#form-simple");
	form.onsubmit = async (evenement) => {
		evenement.preventDefault();
		const valeurs = Object.fromEntries(
			champs.map((c) => [c.nom, form.elements[c.nom].value]),
		);
		const reussi = await valider(valeurs, (message) => {
			$("#erreur-simple").textContent = message;
		});
		if (reussi) $("#dialogue-simple").close();
	};
	$("#dialogue-simple").showModal();
	form.querySelector("input")?.focus();
}

function ouvrirRejoindre() {
	ouvrirDialogueSimple({
		titre: "Rejoindre une famille",
		aide: "Demande son code à un membre de la famille. Ta liste y sera visible et tu verras celles de ses membres.",
		champs: [{ nom: "code", libelle: "Code de la famille", maxlength: 40 }],
		bouton: "Rejoindre",
		valider: async ({ code }, erreur) => {
			const famille = await modifier(
				"rejoindre-famille",
				{ nouveauCode: code },
				null,
				erreur,
			);
			if (!famille) return false;
			notifier(`Bienvenue dans la famille ${famille.nom} !`);
			activerFamille(famille.id);
			return true;
		},
	});
}

function ouvrirCreer() {
	ouvrirDialogueSimple({
		titre: "Créer une famille",
		aide: "Tu en feras partie. Donne ensuite le code aux autres membres.",
		champs: [
			{ nom: "nom", libelle: "Nom de la famille", maxlength: 60 },
			{ nom: "code", libelle: "Code (4 caractères au moins)", maxlength: 40 },
		],
		bouton: "Créer",
		valider: async ({ nom, code }, erreur) => {
			const famille = await modifier(
				"creer-famille",
				{ nom, nouveauCode: code },
				null,
				erreur,
			);
			if (!famille) return false;
			notifier(`Famille ${famille.nom} créée.`);
			activerFamille(famille.id);
			return true;
		},
	});
}

function ouvrirAjoutPersonne() {
	const familles = famillesActives();
	if (familles.length === 0) return;
	ouvrirDialogueSimple({
		titre:
			familles.length > 1
				? "Ajouter une personne"
				: `Ajouter à la famille ${familles[0].nom}`,
		aide: "Pour un proche qui n'utilisera pas l'app (enfant, grands-parents…) : toute la famille pourra tenir sa liste. S'il s'y met plus tard, il choisira son prénom à la connexion.",
		champs: [
			{ nom: "prenom", libelle: "Prénom", maxlength: 40 },
			{ nom: "nom", libelle: "Nom (facultatif)", maxlength: 60, requis: false },
			{
				nom: "naissance",
				libelle: "Anniversaire (facultatif)",
				type: "date",
				requis: false,
			},
			...(familles.length > 1
				? [
						{
							nom: "familleId",
							libelle: "Famille",
							options: familles.map((f) => ({ valeur: f.id, libelle: f.nom })),
						},
					]
				: []),
		],
		bouton: "Ajouter",
		valider: async (
			{ prenom, nom, naissance, familleId = familles[0].id },
			erreur,
		) => {
			const ajoutee = await modifier(
				"ajouter-personne",
				{ familleId, prenom, nom, naissance },
				`${prenom.trim()} ajouté(e).`,
				erreur,
			);
			if (!ajoutee) return false;
			app.personnesFamille = new Set([ajoutee.id]);
			changerOnglet("famille");
			return true;
		},
	});
}

function ouvrirProfil() {
	const membre = app.etat.moi;
	// Ferme le profil avant une autre action : le petit formulaire ne s'ouvre pas deux fois, et la
	// notification du code copié serait cachée derrière.
	const puis = (action) => () => {
		$("#dialogue-simple").close();
		action();
	};
	ouvrirDialogueSimple({
		titre: `Mon profil : ${membre.prenom}`,
		aide: "Ton anniversaire s'affiche sur ta fiche, pour les membres de tes familles.",
		champs: [
			{
				nom: "nom",
				libelle: "Nom (facultatif)",
				maxlength: 60,
				requis: false,
				valeur: membre.nom,
			},
			{
				nom: "naissance",
				libelle: "Anniversaire",
				type: "date",
				requis: false,
				valeur: versChamp(membre.naissance),
			},
		],
		bas: [
			el("p", { class: "sous-titre" }, "Mes familles"),
			...app.etat.familles.map((f) =>
				el(
					"button",
					{
						type: "button",
						class: "code-famille",
						"aria-label": `Copier le code de la famille ${f.nom}`,
						onclick: puis(() => copierCode(f)),
					},
					el("span", {}, f.nom),
					el("strong", {}, f.code),
				),
			),
			el(
				"div",
				{ class: "ligne deux" },
				el(
					"button",
					{ type: "button", class: "bouton", onclick: puis(ouvrirRejoindre) },
					"Rejoindre",
				),
				el(
					"button",
					{ type: "button", class: "bouton", onclick: puis(ouvrirCreer) },
					"Créer",
				),
			),
		],
		bouton: "Enregistrer",
		valider: async (profil, erreur) =>
			Boolean(
				await modifier(
					"modifier-profil",
					{ profil },
					"Profil enregistré.",
					erreur,
				),
			),
	});
}

async function copierCode(famille) {
	fermerMenu();
	try {
		await navigator.clipboard.writeText(famille.code);
		notifier(`Code de la famille ${famille.nom} copié : ${famille.code}`);
	} catch {
		notifier(`Code de la famille ${famille.nom} : ${famille.code}`);
	}
}

// ---------------------------------------------------------------------------
// Connexion : compte (shared/connexion.js, projet droits), puis sa personne dans Cadeaux (code
// famille, ou lien d'invitation d'un proche)
// ---------------------------------------------------------------------------

function afficherEcran(nom) {
	$("#ecran-connexion").hidden = nom !== "connexion";
	$("#ecran-app").hidden = nom !== "app";
}

/** Affiche une des parties de l'écran de connexion (compte, refus, accueil, choix-membre). */
function afficherPartieConnexion(partie, message = "") {
	afficherEcran("connexion");
	$("#connexion-compte").hidden = partie !== "compte";
	$("#refus").hidden = partie !== "refus";
	$("#accueil-connexion").hidden = partie !== "accueil";
	$("#choix-membre").hidden = partie !== "choix-membre";
	$("#erreur-connexion").textContent = message;
}

/**
 * Pas de compte sur l'appareil : prénom, ou lien de connexion d'un autre appareil.
 * @param invitation Code d'un lien de connexion (QR code d'un autre appareil), utilisé aussitôt
 */
function afficherConnexionCompte(message = "", invitation = null) {
	afficherPartieConnexion("compte");
	afficherFormulaireConnexion($("#connexion-compte"), {
		nomApp: "Cadeaux",
		message,
		invitation,
		ouvrirLienApp: ouvrirCleDuLien,
		scanner: ouvrirScanner,
		surConnecte: () => chargerApresConnexion(),
	});
}

/** Compte sans accès à Cadeaux : la session est gardée (elle sert aux autres apps). */
function afficherRefus(message) {
	app.etat = null;
	ecrireStockage(CLES.etat, null);
	afficherPartieConnexion("refus");
	$("#message-refus").textContent = message;
}

/** Compte qui n'est encore personne de Cadeaux : code famille, ou lien d'invitation. */
function afficherAccueil(message = "") {
	afficherPartieConnexion("accueil", message);
}

/** Code famille d'un nouveau venu : on vérifie le code, puis il s'ajoute. */
async function validerCode(evenement) {
	evenement.preventDefault();
	const bouton = evenement.submitter;
	if (bouton) bouton.disabled = true;
	$("#erreur-connexion").textContent = "";
	app.code = $("#champ-code").value.trim();
	try {
		const famille = await appelerApi("famille", { code: app.code });
		afficherPartieConnexion("choix-membre");
		$("#titre-choix").textContent = `Famille ${famille.nom} : ajoute-toi`;
		$("#champ-prenom").value ||= compteConnecte()?.prenom ?? "";
		$("#champ-prenom").focus();
	} catch (erreur) {
		if (!traiterErreurConnexion(erreur)) {
			$("#erreur-connexion").textContent = erreur.message;
		}
	} finally {
		if (bouton) bouton.disabled = false;
	}
}

/** Ouvre l'app avec l'état reçu (inscription, invitation, connexion). */
function ouvrirApp(etat) {
	app.selection.clear();
	appliquerEtat(etat);
	afficherEcran("app");
	if (!app.etat.cadeaux.some(estPourMoi)) {
		changerOnglet("ma-liste");
		notifier(
			`Bienvenue ${app.etat.moi.prenom} ! Commence par ajouter tes idées.`,
		);
	}
}

async function ajouterMoi(evenement) {
	evenement.preventDefault();
	const bouton = evenement.submitter;
	if (bouton) bouton.disabled = true;
	$("#erreur-connexion").textContent = "";
	try {
		ouvrirApp(
			await appelerApi("ajouter-moi", {
				code: app.code,
				prenom: $("#champ-prenom").value,
				naissance: $("#champ-naissance").value,
			}),
		);
	} catch (erreur) {
		if (!traiterErreurConnexion(erreur)) {
			$("#erreur-connexion").textContent = erreur.message;
		}
	} finally {
		if (bouton) bouton.disabled = false;
	}
}

/** Premier chargement, une fois l'appareil connecté (ou une invitation reçue). */
async function chargerApresConnexion() {
	app.etat = null;
	ecrireStockage(CLES.etat, null);
	afficherAccueil("Connexion…");
	try {
		ouvrirApp(await appelerApi("etat"));
	} catch (erreur) {
		if (!traiterErreurConnexion(erreur)) afficherAccueil(erreur.message);
	}
}

/**
 * Lien d'invitation (QR code d'un proche, ou du classeur), valable tant qu'il n'est pas remplacé :
 * la clé est gardée, puis envoyée jusqu'à ce que le compte soit lié à sa personne. Si cette
 * personne a déjà un compte, l'appareil y est connecté (app installée, nouveau téléphone). Sinon,
 * sans compte sur l'appareil, il est créé avec son prénom (shared/connexion.js propose ensuite la
 * biométrie et l'installation) ; si ce prénom est déjà pris, la personne se connecte au sien.
 */
async function accepterInvitation(cle) {
	garderCle(cle);
	afficherAccueil("Connexion…");
	try {
		const { prenom, connexion } = await appelerApi("invitation", {
			appareil: decrireAppareil("Cadeaux"),
		});
		if (connexion) garderConnexionInvitee(connexion, "Cadeaux");
		else if (prenom && !estConnecte()) {
			await creerCompteInvite(prenom, "Cadeaux");
		} else proposerInstallation({ connexion: true });
	} catch (erreur) {
		if (estInvitationRefusee(erreur)) garderCle(null);
		if (!estConnecte()) {
			afficherConnexionCompte(erreur.message);
			return;
		}
		notifier(erreur.message, true);
	}
	chargerApresConnexion();
}

/** Ouvre un lien d'invitation de Cadeaux (…#cle=…). @return Vrai si c'en est un */
function ouvrirCleDuLien(texte) {
	const cle = cleDuLien(texte);
	if (cle) accepterInvitation(cle);
	return Boolean(cle);
}

/**
 * Ouvre un lien reçu ou scanné : invitation de Cadeaux (…#cle=…), ou connexion d'un appareil à un
 * compte (…#invitation=…).
 * @return Vrai si c'est l'un des deux
 */
function ouvrirLienRecu(texte) {
	if (ouvrirCleDuLien(texte)) return true;
	const invitation = invitationDuLien(texte);
	if (invitation) afficherConnexionCompte("", invitation);
	return Boolean(invitation);
}

/** Lien reçu à distance, collé à la connexion (ex : app installée sur iPhone, hors de Safari). */
function validerLien(evenement) {
	evenement.preventDefault();
	if (!ouvrirLienRecu($("#champ-lien").value)) {
		$("#erreur-connexion").textContent =
			"Ce n'est pas un lien de connexion à l'app Cadeaux.";
		return;
	}
	$("#champ-lien").value = "";
}

/** Clé contenue dans un lien d'invitation (…/#cle=…), ou null. */
function cleDuLien(texte) {
	const trouve = /[#&]cle=([A-Za-z0-9]+)/.exec(String(texte));
	return trouve ? trouve[1] : null;
}

/** Lien à mettre dans un QR code : l'app, avec la clé après « # » (jamais envoyée au serveur web). */
function lienDInvitation(cle) {
	return `${location.origin}${location.pathname}#cle=${cle}`;
}

/** Lien du QR code affiché et message qui l'accompagne, pour l'envoyer à distance. */
let envoiQr = null;

/** @param message texte du message qui accompagne le lien envoyé (« Envoyer le lien ») */
function afficherQr(titre, aide, cle, message) {
	fermerMenu();
	envoiQr = { lien: lienDInvitation(cle), message };
	const qr = window.qrcode(0, "M");
	qr.addData(envoiQr.lien);
	qr.make();
	$("#qr-titre").textContent = titre;
	$("#qr-aide").textContent = aide;
	$("#qr-image").innerHTML = qr.createSvgTag({
		cellSize: 6,
		margin: 4,
		scalable: true,
	});
	$("#dialogue-qr").showModal();
}

/**
 * Envoie le lien du QR code à distance : partage du téléphone (SMS, messagerie, mail…), sinon
 * copie dans le presse-papiers.
 */
async function envoyerLienQr() {
	if (!envoiQr) return;
	const { lien, message } = envoiQr;
	if (navigator.share) {
		try {
			await navigator.share({
				title: "Cadeaux de Noël",
				text: message,
				url: lien,
			});
			return;
		} catch (erreur) {
			if (erreur?.name === "AbortError") return;
		}
	}
	try {
		await navigator.clipboard.writeText(`${message}\n${lien}`);
		notifier("Lien copié : colle-le dans un message.");
	} catch {
		prompt("Copie ce lien et envoie-le :", lien);
	}
}

async function inviter(personneInvitee) {
	const cle = await modifier("inviter", { personneId: personneInvitee.id });
	if (!cle) return;
	const { prenom } = personneInvitee;
	afficherQr(
		`Inviter ${prenom}`,
		`Fais scanner ce QR code à ${prenom}, ou envoie-lui le lien s'il est loin : l'app s'ouvre sur son téléphone, et ${prenom} y entre avec son compte. Il reste valable pour se reconnecter (app installée, nouveau téléphone) : envoie-le à ${prenom} seulement. Un nouveau QR code (ou lien) remplace le précédent.`,
		cle,
		`${prenom}, voici ton invitation aux listes de cadeaux de Noël de la famille : ouvre ce lien sur ton téléphone (il est personnel, ne le transfère pas).`,
	);
}

// Lecture d'un QR code : BarcodeDetector quand le navigateur l'a, sinon jsQR (chargé au besoin).
let scanner = null;

function chargerJsQr() {
	if (window.jsQR) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const script = el("script", { src: "vendor/jsQR.min.js" });
		script.onload = resolve;
		script.onerror = () =>
			reject(new Error("Lecteur de QR code indisponible."));
		document.head.append(script);
	});
}

function arreterScanner() {
	if (scanner) {
		cancelAnimationFrame(scanner.boucle);
		for (const piste of scanner.flux.getTracks()) piste.stop();
		scanner = null;
	}
	if ($("#dialogue-scanner").open) $("#dialogue-scanner").close();
}

async function ouvrirScanner() {
	$("#erreur-connexion").textContent = "";
	$("#scanner-message").textContent = "Vise le QR code avec la caméra.";
	$("#dialogue-scanner").showModal();
	try {
		const flux = await navigator.mediaDevices.getUserMedia({
			video: { facingMode: "environment" },
		});
		const video = $("#scanner-video");
		video.srcObject = flux;
		await video.play();
		const detecteur =
			"BarcodeDetector" in window
				? new BarcodeDetector({ formats: ["qr_code"] })
				: null;
		if (!detecteur) await chargerJsQr();
		const toile = document.createElement("canvas");
		const contexte = toile.getContext("2d", { willReadFrequently: true });
		scanner = { flux, boucle: 0 };
		const lire = async () => {
			if (!scanner) return;
			let texte = null;
			if (video.readyState >= 2) {
				if (detecteur) {
					texte = (await detecteur.detect(video))[0]?.rawValue ?? null;
				} else {
					toile.width = video.videoWidth;
					toile.height = video.videoHeight;
					contexte.drawImage(video, 0, 0);
					texte =
						window.jsQR(
							contexte.getImageData(0, 0, toile.width, toile.height).data,
							toile.width,
							toile.height,
						)?.data ?? null;
				}
			}
			if (texte && (cleDuLien(texte) || invitationDuLien(texte))) {
				arreterScanner();
				ouvrirLienRecu(texte);
			} else {
				if (texte)
					$("#scanner-message").textContent =
						"Ce n'est pas un QR code de l'app Cadeaux.";
				if (scanner) scanner.boucle = requestAnimationFrame(lire);
			}
		};
		lire();
	} catch (erreur) {
		arreterScanner();
		$("#erreur-connexion").textContent =
			erreur?.name === "NotAllowedError"
				? "Autorise la caméra pour scanner le QR code."
				: (erreur?.message ?? "Caméra indisponible.");
	}
}

/** Session refusée : oublie la connexion de l'appareil et ses données, puis affiche la connexion. */
function deconnecter(message = "") {
	fermerMenu();
	oublierConnexion();
	app.etat = null;
	// La version de l'API reste : elle ne dit rien du membre.
	for (const cle of Object.values(CLES))
		if (cle !== CLES.versionApi) ecrireStockage(cle, null);
	app.cle = null;
	$("#champ-code").value = "";
	afficherConnexionCompte(message);
}

async function seDeconnecter() {
	fermerMenu();
	if (
		!confirm(
			"Te déconnecter de cet appareil ? Les autres apps le seront aussi (même compte).",
		)
	)
		return;
	await deconnecterAppareil();
	deconnecter();
}

// ---------------------------------------------------------------------------
// Menu, bandeaux, PWA
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
			"Hors ligne : dernières données connues, en lecture seule.",
			{ libelle: "Réessayer", faire: () => actualiser() },
		);
	} else {
		masquerBandeau();
	}
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

function brancherEvenements() {
	$("#form-code").addEventListener("submit", validerCode);
	$("#form-lien").addEventListener("submit", validerLien);
	$("#bouton-envoyer-lien").addEventListener("click", envoyerLienQr);
	$("#form-nouveau-membre").addEventListener("submit", ajouterMoi);
	$("#bouton-autre-code").addEventListener("click", () => afficherAccueil());
	$("#bouton-autre-compte").addEventListener("click", async () => {
		await deconnecterAppareil();
		deconnecter();
	});
	$("#bouton-scanner").addEventListener("click", ouvrirScanner);
	$("#bouton-fermer-scanner").addEventListener("click", arreterScanner);
	$("#dialogue-scanner").addEventListener("cancel", arreterScanner);
	$("#bouton-supprimer-cadeau").addEventListener(
		"click",
		supprimerDepuisFormulaire,
	);
	$("#form-cadeau").addEventListener("submit", enregistrerCadeau);
	$("#form-historique").addEventListener("submit", enregistrerHistorique);
	$("#form-secret-santa").addEventListener("submit", enregistrerSecretSanta);
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
	$("#menu-profil").addEventListener("click", ouvrirProfil);
	$("#ajout-rejoindre").addEventListener("click", () => {
		$("#dialogue-ajout-famille").close();
		ouvrirRejoindre();
	});
	$("#ajout-creer").addEventListener("click", () => {
		$("#dialogue-ajout-famille").close();
		ouvrirCreer();
	});
	// L'installation elle-même est branchée par brancherInstallation (shared/pwa.js).
	$("#menu-installer").addEventListener("click", fermerMenu);
	$("#menu-autre-appareil").addEventListener("click", async () => {
		fermerMenu();
		try {
			await connecterUnAutreAppareil("Cadeaux");
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	});
	$("#menu-connexions").addEventListener("click", async () => {
		fermerMenu();
		try {
			await ouvrirMesConnexions("Cadeaux");
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	});
	$("#menu-deconnecter").addEventListener("click", seDeconnecter);
	$("#bouton-offrir-selection").addEventListener("click", () =>
		reserver([...app.selection]),
	);
	for (const bouton of document.querySelectorAll(".onglets button")) {
		bouton.addEventListener("click", () =>
			changerOnglet(bouton.dataset.onglet),
		);
	}
	// Retour sur l'app (onglet ou téléphone) : les autres ont peut-être réservé entre-temps.
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "visible") return;
		actualiser({ silencieux: true });
		chercherMiseAJour();
	});
	$("#bouton-signalement").addEventListener("click", () => {
		fermerMenu();
		ouvrirSignalement({ app: "Cadeaux", prenom: app.etat?.moi.prenom });
	});
	window.addEventListener("online", () => actualiser({ silencieux: true }));
}

/** Versions de l'app et de l'API, en bas du menu et de l'écran de connexion. */
function afficherVersions() {
	const texte = `Version ${window.VERSION_APP ?? "?"}${app.versionApi ? ` · API ${app.versionApi}` : ""}`;
	for (const element of document.querySelectorAll(".version"))
		element.textContent = texte;
}

function demarrer() {
	afficherVersions();
	$("#champ-naissance").max = versChampDate(aujourdhui());
	if (!RENDUS[app.onglet]) app.onglet = "ma-liste";
	brancherEvenements();
	enregistrerServiceWorker();
	brancherInstallation($("#menu-installer"), { connexion: true });
	// Ancienne connexion par code famille et Id (avant les clés) : plus utilisée.
	ecrireStockage("cadeaux.code", null);
	ecrireStockage("cadeaux.membre", null);
	if (!window.API_URL) {
		afficherAccueil("L'adresse de l'API n'est pas configurée (config.js).");
		return;
	}
	// Liens ouverts dans l'app, retirés aussitôt de l'adresse : invitation d'un proche
	// (…#cle=<clé>), ou connexion d'un appareil à un compte (…#invitation=<code>).
	const cleLien = cleDuLien(location.hash);
	const invitation = invitationDuLien(location.hash);
	history.replaceState(null, "", location.pathname);
	if (cleLien) {
		accepterInvitation(cleLien);
		return;
	}
	if (invitation || !estConnecte()) {
		afficherConnexionCompte(
			app.cle
				? "Pour accepter l'invitation, crée ton compte (ou connecte cet appareil au tien)."
				: "",
			invitation,
		);
		return;
	}
	if (app.etat) {
		afficherEcran("app");
		rendre();
	}
	actualiser({ silencieux: true }).then(() => {
		if (app.etat) afficherEcran("app");
		else if (estConnecte() && $("#ecran-connexion").hidden)
			afficherAccueil(
				"Impossible de charger les listes. Vérifie ta connexion.",
			);
	});
}

demarrer();
