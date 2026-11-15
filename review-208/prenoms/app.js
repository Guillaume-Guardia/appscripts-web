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
} from "../shared/connexion.js";
import { pluriel } from "../shared/dates.js";
import {
	$,
	afficherBandeau,
	el,
	masquerBandeau,
	notifier,
	remplacerContenu,
} from "../shared/dom.js";
import { afficherProfil, brancherProfil } from "../shared/profil.js";
import {
	brancherInstallation,
	chercherMiseAJour,
	enregistrerServiceWorker,
} from "../shared/pwa.js";
import { ouvrirQr } from "../shared/qr.js";
import { ouvrirSignalement } from "../shared/signalement.js";
import {
	ecrireStockage,
	lireStockage,
	lireStockageJson,
} from "../shared/stockage.js";
import { brancherGlissement, lancerCarte } from "./carte.js";
import { choisirDuel, classer, DUELS_STABLES } from "./classement.js";
import {
	chargerPrenoms,
	chercherPrenoms,
	clePrenom,
	FILTRES_PAR_DEFAUT,
	melanger,
	passeLesFiltres,
	prenomAjoute,
} from "./donnees.js";
import { essai, remplirFiche, texteFete, texteTendance } from "./fiche.js";

// ---------------------------------------------------------------------------
// État de l'app
// ---------------------------------------------------------------------------

const CLES = {
	/** États reçus de l'API, un par projet : { <Id du projet>: état }. */
	etats: "prenoms.etats",
	/** Projet affiché (son Id) : le filtre de toute l'app. */
	projet: "prenoms.projet",
	versionApi: "prenoms.versionApi",
	/** Lien de l'autre parent ouvert avant d'être connecté : { projetId, code }. */
	rejoindre: "prenoms.rejoindre",
	/** Votes et duels pas encore enregistrés par l'API (voir envoyer). */
	votes: "prenoms.votesEnAttente",
	duels: "prenoms.duelsEnAttente",
	filtres: "prenoms.filtres",
	vue: "prenoms.vue",
	sexe: "prenoms.sexe",
};

const VUES = ["selection", "duels", "classement", "liste", "parametres"];
const TITRES = {
	selection: "Sélection",
	duels: "Duels",
	classement: "Classement",
	liste: "Ma sélection",
	parametres: "Paramètres",
};
/** Attente après un vote avant d'envoyer le lot, en millisecondes : les votes suivants s'y ajoutent. */
const DELAI_ENVOI_MS = 2000;
/** Au-delà, le lot part sans attendre. */
const VOTES_PAR_LOT = 25;
/** Nombre maximal d'éléments par appel (LOT_MAX de l'API). */
const LOT_MAX = 300;

/** Clé d'un vote en attente : son projet et son prénom. */
function cleAttente(projetId, prenom, sexe) {
	return `${projetId}|${clePrenom(prenom, sexe)}`;
}

const app = {
	/**
	 * État renvoyé par l'API pour le projet affiché : { moi, projets, projet, votes, matchs, duels,
	 * ajouts }.
	 */
	etat: null,
	/** Projet affiché : votes, matchs, duels et classement sont les siens. */
	projetId: lireStockage(CLES.projet),
	/** Prénoms de l'INSEE (donnees.js), null tant qu'ils ne sont pas chargés. */
	donnees: null,
	vue: VUES.includes(lireStockage(CLES.vue))
		? lireStockage(CLES.vue)
		: "selection",
	filtres: { ...FILTRES_PAR_DEFAUT, ...lireStockageJson(CLES.filtres) },
	/** Clés des cartes à voter, de la première à la dernière. */
	pile: [],
	/** Sexe affiché dans les duels et le classement, quand le projet ne le connaît pas. */
	sexe: lireStockage(CLES.sexe) === "m" ? "m" : "f",
	/** Duel affiché : [haut, bas], gardé jusqu'au choix. */
	duel: null,
	recherche: "",
	horsLigne: false,
	versionApi: lireStockage(CLES.versionApi),
	/**
	 * Votes pas encore enregistrés, de tous les projets : Map(cleAttente → { projetId, prenom, sexe,
	 * vote }), gardés sur l'appareil.
	 */
	votesEnAttente: new Map(
		(lireStockageJson(CLES.votes) ?? [])
			.filter((v) => v.projetId)
			.map((v) => [cleAttente(v.projetId, v.prenom, v.sexe), v]),
	),
	/** Duels pas encore enregistrés, dans l'ordre : [{ projetId, id, gagnant, perdant, sexe }]. */
	duelsEnAttente: (lireStockageJson(CLES.duels) ?? []).filter(
		(d) => d.projetId,
	),
	envoiEnCours: false,
};

// États en cache, un par projet : seulement ceux du compte connecté sur l'appareil.
const etatsEnCache = lireStockageJson(CLES.etats) ?? {};

/** L'état gardé d'un projet, ou null. */
function etatGarde(projetId) {
	const etat = etatsEnCache[projetId];
	return lireSession() && etat?.moi?.id === compteConnecte()?.id ? etat : null;
}

app.etat = etatGarde(app.projetId);

// ---------------------------------------------------------------------------
// API (Web App Apps Script, projet prenoms)
// ---------------------------------------------------------------------------

const appelerApi = creerApi({
	url: window.API_URL,
	// Le projet affiché, sauf pour les envois en arrière-plan qui précisent le leur.
	identifiants: () => ({ session: lireSession(), projetId: app.projetId }),
	surVersion: (version) => {
		if (version === app.versionApi) return;
		app.versionApi = version;
		ecrireStockage(CLES.versionApi, version);
		afficherVersions();
	},
});

function passerHorsLigne() {
	app.horsLigne = true;
	afficherBandeauHorsLigne();
}

/** Nouveaux matchs de l'état reçu : annoncés, sauf au premier chargement. */
function annoncerMatchs(avant, apres) {
	if (!avant?.projet || avant.projet.id !== apres.projet?.id) return;
	const connus = new Set(avant.matchs.map((m) => clePrenom(m.prenom, m.sexe)));
	const nouveaux = apres.matchs.filter(
		(m) => !connus.has(clePrenom(m.prenom, m.sexe)),
	);
	if (nouveaux.length === 0) return;
	const noms = nouveaux.map((m) => m.prenom).join(", ");
	notifier(
		nouveaux.length === 1
			? `❤ C'est un match : ${noms} !`
			: `❤ ${nouveaux.length} nouveaux matchs : ${noms} !`,
	);
}

/** Garde l'état d'un projet sur l'appareil ; les projets quittés sont oubliés. */
function garderEtat(etat) {
	if (etat.projet) etatsEnCache[etat.projet.id] = etat;
	for (const id of Object.keys(etatsEnCache)) {
		if (!etat.projets.some((p) => p.id === id)) delete etatsEnCache[id];
	}
	ecrireStockage(CLES.etats, JSON.stringify(etatsEnCache));
}

/** Affiche l'état reçu : son projet devient celui de l'app (création, lien rejoint, premier chargement). */
function appliquerEtat(etat) {
	const avant = app.etat;
	const projetId = etat.projet?.id ?? null;
	if (projetId !== app.projetId) {
		app.projetId = projetId;
		ecrireStockage(CLES.projet, projetId);
		app.pile = [];
		app.duel = null;
	}
	app.etat = etat;
	app.horsLigne = false;
	garderEtat(etat);
	afficherBandeauHorsLigne();
	annoncerMatchs(avant, etat);
	rendre();
}

/**
 * État reçu après un envoi en arrière-plan : affiché s'il est celui du projet affiché, sinon
 * seulement gardé (on a changé de projet entre-temps).
 */
function recevoirEtat(etat) {
	if (!app.etat) return;
	if (etat.projet && etat.projet.id === app.projetId) appliquerEtat(etat);
	else garderEtat(etat);
}

async function actualiser({ silencieux = false } = {}) {
	if (!lireSession()) return;
	const bouton = $("#bouton-actualiser");
	bouton.classList.add("tourne");
	const demande = app.projetId;
	try {
		const etat = await appelerApi(
			"etat",
			{},
			{ discret: silencieux && Boolean(app.etat) },
		);
		// On a changé de projet pendant l'appel : l'état est seulement gardé.
		if (app.projetId !== demande) garderEtat(etat);
		else appliquerEtat(etat);
		envoyer();
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
 * Modification dont l'app attend le résultat (créer ou rejoindre le projet) ; l'API renvoie
 * { resultat, etat }.
 * @return le résultat (true s'il n'y en a pas), ou null en cas d'échec
 */
async function modifier(
	action,
	parametres,
	surErreur = (m) => notifier(m, true),
) {
	if (app.horsLigne) {
		surErreur("Hors ligne : réessaie avec la connexion.");
		return null;
	}
	try {
		const { resultat, etat } = await appelerApi(action, parametres);
		appliquerEtat(etat);
		return resultat ?? true;
	} catch (erreur) {
		if (estSessionRefusee(erreur)) {
			deconnecter(erreur.message);
			return null;
		}
		if (erreur instanceof ErreurReseau) passerHorsLigne();
		surErreur(erreur.message);
		return null;
	}
}

// ---------------------------------------------------------------------------
// Votes et duels en arrière-plan
//
// Un glissement ou un duel s'affiche aussitôt. Il attend ensuite sur l'appareil (et survit à la
// fermeture de l'app), puis part avec les suivants, en un seul appel, quand on s'arrête deux
// secondes (ou dès VOTES_PAR_LOT votes). Sans réseau, il attend la connexion. Si l'API refuse,
// le lot disparaît et un message le dit (skill enregistrement-en-fond).
// ---------------------------------------------------------------------------

let minuteurEnvoi = null;

function garderEnAttente() {
	ecrireStockage(CLES.votes, JSON.stringify([...app.votesEnAttente.values()]));
	ecrireStockage(CLES.duels, JSON.stringify(app.duelsEnAttente));
}

function planifierEnvoi() {
	clearTimeout(minuteurEnvoi);
	const plein = app.votesEnAttente.size >= VOTES_PAR_LOT;
	minuteurEnvoi = setTimeout(envoyer, plein ? 0 : DELAI_ENVOI_MS);
}

/**
 * Envoie un lot ; retire ensuite de l'attente ce qui a été envoyé (sauf ce qui a changé depuis).
 * @param surRefus appelée avec le lot si l'API le refuse, pour remettre l'écran comme avant
 * @return Faux si l'envoi s'est arrêté (hors ligne, déconnecté)
 */
async function envoyerLot(
	action,
	parametre,
	projetId,
	lot,
	retirer,
	echec,
	surRefus,
) {
	try {
		const { etat } = await appelerApi(
			action,
			{ projetId, [parametre]: lot },
			{ discret: true },
		);
		retirer(lot);
		garderEnAttente();
		recevoirEtat(etat);
		return true;
	} catch (erreur) {
		if (erreur instanceof ErreurReseau) {
			passerHorsLigne();
			return false;
		}
		if (estSessionRefusee(erreur)) {
			deconnecter(erreur.message);
			return false;
		}
		retirer(lot);
		garderEnAttente();
		surRefus?.(lot);
		notifier(`${echec(lot.length)} ${erreur.message}`, true);
		rendre();
		return true;
	}
}

const retirerVotes = (lot) => {
	for (const vote of lot) {
		const cle = cleAttente(vote.projetId, vote.prenom, vote.sexe);
		if (app.votesEnAttente.get(cle) === vote) app.votesEnAttente.delete(cle);
	}
};

const retirerDuels = (lot) => {
	const ids = new Set(lot.map((d) => d.id));
	app.duelsEnAttente = app.duelsEnAttente.filter((d) => !ids.has(d.id));
};

/** Les éléments du même projet que le premier, LOT_MAX au plus : un appel par projet. */
function lotDuPremierProjet(elements) {
	const { projetId } = elements[0];
	return {
		projetId,
		lot: elements.filter((e) => e.projetId === projetId).slice(0, LOT_MAX),
	};
}

/**
 * Envoie ce qui attend, projet par projet : les votes d'abord (un duel porte sur des matchs), puis
 * les duels.
 */
async function envoyer() {
	clearTimeout(minuteurEnvoi);
	if (app.envoiEnCours || app.horsLigne || !lireSession()) return;
	app.envoiEnCours = true;
	try {
		while (app.votesEnAttente.size || app.duelsEnAttente.length) {
			let continuer;
			if (app.votesEnAttente.size) {
				const { projetId, lot } = lotDuPremierProjet([
					...app.votesEnAttente.values(),
				]);
				continuer = await envoyerLot(
					"voter",
					"votes",
					projetId,
					lot,
					retirerVotes,
					(n) => `${pluriel(n, "vote")} non enregistré(s) :`,
					// Les cartes refusées reviennent sur le dessus de la pile.
					(refuses) => {
						if (projetId !== app.projetId) return;
						app.pile.unshift(
							...refuses.map((v) => clePrenom(v.prenom, v.sexe)),
						);
					},
				);
			} else {
				const { projetId, lot } = lotDuPremierProjet(app.duelsEnAttente);
				continuer = await envoyerLot(
					"enregistrer-duels",
					"duels",
					projetId,
					lot,
					retirerDuels,
					(n) => `${pluriel(n, "duel")} non enregistré(s) :`,
				);
			}
			if (!continuer) break;
		}
	} finally {
		app.envoiEnCours = false;
	}
}

// ---------------------------------------------------------------------------
// Ce que voit le compte : l'état du serveur et ce qui attend d'être envoyé
// ---------------------------------------------------------------------------

/** Le prénom d'une clé : celui de l'INSEE, sinon un prénom ajouté à la main. */
function prenomDe(prenom, sexe) {
	return (
		app.donnees?.parCle.get(clePrenom(prenom, sexe)) ??
		prenomAjoute(prenom, sexe)
	);
}

/** Mes votes : Map(clé → { prenom, sexe, vote }), ceux en attente compris. */
function mesVotes() {
	const votes = new Map(
		(app.etat?.votes ?? []).map((v) => [clePrenom(v.prenom, v.sexe), v]),
	);
	for (const vote of app.votesEnAttente.values()) {
		if (vote.projetId === app.projetId) {
			votes.set(clePrenom(vote.prenom, vote.sexe), vote);
		}
	}
	return votes;
}

/** Les matchs, sans ceux que je viens de repasser à non. */
function matchs() {
	const votes = mesVotes();
	return (app.etat?.matchs ?? []).filter(
		(m) => votes.get(clePrenom(m.prenom, m.sexe))?.vote !== "non",
	);
}

/** Les duels, ceux en attente compris, dans l'ordre où ils ont été joués. */
function duels() {
	const connus = new Set((app.etat?.duels ?? []).map((d) => d.id));
	return [
		...(app.etat?.duels ?? []),
		...app.duelsEnAttente.filter(
			(d) => d.projetId === app.projetId && !connus.has(d.id),
		),
	];
}

const projet = () => app.etat?.projet ?? null;
const nomFamille = () => projet()?.nomFamille ?? "";
const projetComplet = () => (projet()?.parents.length ?? 0) >= 2;

/** Sexe des duels et du classement : celui du projet, sinon celui choisi à l'écran. */
const sexeAffiche = () => projet()?.sexe ?? app.sexe;

/** Enregistre mon vote sur un prénom, aussitôt affiché, puis envoyé en arrière-plan. */
function voter(prenom, sexe, vote) {
	const cle = clePrenom(prenom, sexe);
	app.votesEnAttente.set(cleAttente(app.projetId, prenom, sexe), {
		projetId: app.projetId,
		prenom,
		sexe,
		vote,
	});
	app.pile = app.pile.filter((c) => c !== cle);
	garderEnAttente();
	planifierEnvoi();
}

// ---------------------------------------------------------------------------
// Sélection : les cartes à glisser
// ---------------------------------------------------------------------------

/** Les prénoms à voter : ceux de la base qui passent les filtres et les ajouts, pas encore votés. */
function candidats() {
	const votes = mesVotes();
	const sexe = projet()?.sexe ?? null;
	const ajouts = (app.etat?.ajouts ?? []).map((a) =>
		prenomAjoute(a.prenom, a.sexe),
	);
	return [...ajouts, ...app.donnees.liste].filter(
		(p) => !votes.has(p.cle) && passeLesFiltres(p, app.filtres, sexe),
	);
}

/** Remet la pile à jour : retire ce qui est voté ou filtré, la remplit si elle est vide. */
function preparerPile() {
	const restants = candidats();
	const valides = new Set(restants.map((p) => p.cle));
	app.pile = app.pile.filter((cle) => valides.has(cle));
	// Un prénom ajouté par l'autre parent passe devant.
	const ajoutes = restants
		.filter((p) => p.ajoute && !app.pile.includes(p.cle))
		.map((p) => p.cle);
	app.pile.unshift(...ajoutes);
	if (app.pile.length === 0) app.pile = melanger(restants);
	return restants.length;
}

function prenomDeLaPile(cle) {
	if (app.donnees.parCle.has(cle)) return app.donnees.parCle.get(cle);
	const ajout = (app.etat?.ajouts ?? []).find(
		(a) => clePrenom(a.prenom, a.sexe) === cle,
	);
	return ajout ? prenomAjoute(ajout.prenom, ajout.sexe) : null;
}

function contenuCarte(prenom) {
	const nombre = new Intl.NumberFormat("fr-FR");
	// Sans naissance la dernière année : son total et son époque.
	const details = prenom.ajoute
		? "Ajouté à la main"
		: prenom.derniere
			? `${nombre.format(prenom.derniere)} en ${app.donnees.edition} · ${texteTendance(prenom).toLowerCase()}`
			: `${nombre.format(prenom.total)} depuis ${app.donnees.debut} · surtout vers ${prenom.anneePic}`;
	return [
		el("span", { class: "tampon tampon-oui", "aria-hidden": "true" }, "OUI"),
		el("span", { class: "tampon tampon-non", "aria-hidden": "true" }, "NON"),
		el("p", { class: "carte-sexe" }, prenom.sexe === "f" ? "Fille" : "Garçon"),
		el("h2", { class: "carte-prenom" }, prenom.prenom),
		nomFamille()
			? el("p", { class: "carte-essai" }, essai(prenom.prenom, nomFamille()))
			: null,
		el("p", { class: "carte-details" }, details),
		texteFete(prenom)
			? el("p", { class: "carte-details" }, texteFete(prenom))
			: null,
		el(
			"button",
			{
				type: "button",
				class: "bouton-info",
				"aria-label": `Fiche de ${prenom.prenom}`,
				onclick: () => ouvrirFiche(prenom),
			},
			"i",
		),
	];
}

function carte(prenom, active) {
	const element = el(
		"article",
		{
			class: `carte-prenom-pile sexe-${prenom.sexe}${active ? " active" : ""}`,
			"data-cle": prenom.cle,
			"aria-hidden": active ? null : "true",
		},
		contenuCarte(prenom),
	);
	if (active) {
		brancherGlissement(element, (vote) => apresGlissement(prenom, vote));
	}
	return element;
}

function apresGlissement(prenom, vote) {
	voter(prenom.prenom, prenom.sexe, vote);
	rendreSelection({ forcer: true });
}

/** Vote sur la carte du dessus avec un bouton ou une flèche : elle part du bon côté. */
function voterCarteDuDessus(vote) {
	const element = $("#pile .active");
	if (!element || element.classList.contains("part")) return;
	const prenom = prenomDeLaPile(element.dataset.cle);
	if (!prenom) return;
	element.classList.add("part");
	lancerCarte(element, vote === "oui" ? 1 : -1, () =>
		apresGlissement(prenom, vote),
	);
}

function rendreInvitationParent() {
	const conteneur = $("#invitation-parent");
	if (projetComplet()) {
		remplacerContenu(conteneur);
		return;
	}
	remplacerContenu(
		conteneur,
		el(
			"div",
			{ class: "carte invitation" },
			el(
				"p",
				{},
				"L'autre parent n'a pas encore rejoint le projet : vos matchs viendront ensuite.",
			),
			el(
				"button",
				{ type: "button", class: "bouton-principal", onclick: partagerProjet },
				"Inviter",
			),
		),
	);
}

/**
 * Affiche les deux premières cartes de la pile. La carte du dessus n'est pas recréée si elle n'a
 * pas changé (une réponse de l'API arrive pendant qu'on la glisse).
 */
function rendreSelection({ forcer = false } = {}) {
	rendreInvitationParent();
	const zone = $("#pile");
	if (!app.donnees) {
		remplacerContenu(
			zone,
			el("p", { class: "aide centre" }, "Chargement des prénoms…"),
		);
		return;
	}
	const restants = preparerPile();
	const votes = mesVotes();
	const oui = [...votes.values()].filter((v) => v.vote === "oui").length;
	$("#compteurs").textContent =
		`${pluriel(oui, "prénom")} gardé${oui > 1 ? "s" : ""} · ${pluriel(matchs().length, "match")} · ${restants} à voir`;
	const actifs = Object.entries(app.filtres).filter(([cle, valeur]) =>
		cle === "popularites" ? valeur.length : Boolean(valeur),
	).length;
	$("#bouton-filtres").textContent = actifs ? `Filtres (${actifs})` : "Filtres";
	$("#bouton-filtres").setAttribute("aria-pressed", String(actifs > 0));
	const [dessus, dessous] = app.pile.map(prenomDeLaPile).filter(Boolean);
	$("#bouton-oui").disabled = !dessus;
	$("#bouton-non").disabled = !dessus;
	const affichee = zone.querySelector(".active");
	if (!forcer && affichee && affichee.dataset.cle === dessus?.cle) return;
	if (affichee?.classList.contains("tenue")) return;
	if (!dessus) {
		remplacerContenu(
			zone,
			el(
				"div",
				{ class: "vide" },
				el("p", {}, "Plus aucun prénom à voir avec ces filtres."),
				el(
					"button",
					{ type: "button", onclick: () => $("#dialogue-filtres").showModal() },
					"Changer les filtres",
				),
			),
		);
		return;
	}
	remplacerContenu(
		zone,
		dessous ? carte(dessous, false) : null,
		carte(dessus, true),
	);
}

// ---------------------------------------------------------------------------
// Filtres
// ---------------------------------------------------------------------------

function remplirFormulaireFiltres() {
	const filtres = app.filtres;
	$("#filtre-sexe").hidden = Boolean(projet()?.sexe);
	for (const groupe of document.querySelectorAll(
		"#form-filtres [data-filtre]",
	)) {
		const valeur = filtres[groupe.dataset.filtre];
		for (const puce of groupe.querySelectorAll(".puce")) {
			const choisie = Array.isArray(valeur)
				? valeur.includes(puce.dataset.valeur)
				: (valeur ?? "") === puce.dataset.valeur;
			puce.setAttribute("aria-pressed", String(choisie));
		}
	}
	$("#champ-initiales").value = filtres.initiales ?? "";
	$("#champ-longueur-min").value = filtres.longueurMin ?? "";
	$("#champ-longueur-max").value = filtres.longueurMax ?? "";
	compterFiltres();
}

function lireFormulaireFiltres() {
	const filtres = { ...FILTRES_PAR_DEFAUT };
	for (const groupe of document.querySelectorAll(
		"#form-filtres [data-filtre]",
	)) {
		const choisies = [
			...groupe.querySelectorAll('.puce[aria-pressed="true"]'),
		].map((puce) => puce.dataset.valeur);
		filtres[groupe.dataset.filtre] =
			"plusieurs" in groupe.dataset ? choisies : (choisies[0] ?? "");
	}
	const nombre = (champ) => {
		const valeur = Number.parseInt($(champ).value, 10);
		return Number.isFinite(valeur) && valeur > 0 ? valeur : null;
	};
	filtres.initiales = $("#champ-initiales").value.trim();
	filtres.longueurMin = nombre("#champ-longueur-min");
	filtres.longueurMax = nombre("#champ-longueur-max");
	return filtres;
}

/** Nombre de prénoms (pas encore votés) que donneraient les filtres du formulaire. */
function compterFiltres() {
	if (!app.donnees) return;
	const filtres = lireFormulaireFiltres();
	const votes = mesVotes();
	const sexe = projet()?.sexe ?? null;
	const nombre = app.donnees.liste.filter(
		(p) => !votes.has(p.cle) && passeLesFiltres(p, filtres, sexe),
	).length;
	$("#nombre-filtres").textContent = `${pluriel(nombre, "prénom")} à voir.`;
}

function appliquerFiltres(filtres) {
	app.filtres = filtres;
	ecrireStockage(CLES.filtres, JSON.stringify(filtres));
	app.pile = [];
	rendreSelection({ forcer: true });
}

// ---------------------------------------------------------------------------
// Duels et classement
// ---------------------------------------------------------------------------

/** Classement des matchs d'un sexe, avec leurs duels (clés), et les duels joués. */
function classementDu(sexe) {
	const prenoms = matchs()
		.filter((m) => m.sexe === sexe)
		.map((m) => prenomDe(m.prenom, m.sexe));
	const joues = duels()
		.filter((d) => d.sexe === sexe)
		.map((d) => ({
			gagnant: clePrenom(d.gagnant, sexe),
			perdant: clePrenom(d.perdant, sexe),
		}));
	return { classement: classer(prenoms, joues), joues };
}

function rendreChoixSexe(conteneur) {
	if (projet()?.sexe) {
		remplacerContenu(conteneur);
		return;
	}
	const choix = (sexe, libelle) =>
		el(
			"button",
			{
				type: "button",
				class: "puce",
				"aria-pressed": String(app.sexe === sexe),
				onclick: () => {
					app.sexe = sexe;
					app.duel = null;
					ecrireStockage(CLES.sexe, sexe);
					rendre();
				},
			},
			`${libelle} (${matchs().filter((m) => m.sexe === sexe).length})`,
		);
	remplacerContenu(conteneur, choix("f", "Filles"), choix("m", "Garçons"));
}

function videDuels(message) {
	return el(
		"div",
		{ class: "vide" },
		el("p", {}, message),
		el(
			"button",
			{ type: "button", onclick: () => changerVue("selection") },
			"Continuer la sélection",
		),
	);
}

function carteDuel(prenom, adversaire, sexe) {
	return el(
		"div",
		{ class: `duel-carte sexe-${sexe}` },
		el(
			"button",
			{
				type: "button",
				class: "duel-choix",
				onclick: (e) => choisir(prenom, adversaire, sexe, e.currentTarget),
			},
			el("span", { class: "carte-prenom" }, prenom.prenom),
			nomFamille()
				? el(
						"span",
						{ class: "carte-essai" },
						essai(prenom.prenom, nomFamille()),
					)
				: null,
			texteFete(prenom)
				? el("span", { class: "carte-details" }, texteFete(prenom))
				: null,
		),
		el(
			"button",
			{
				type: "button",
				class: "bouton-info",
				"aria-label": `Fiche de ${prenom.prenom}`,
				onclick: () => ouvrirFiche(prenom),
			},
			"i",
		),
	);
}

/** Le duel affiché est-il toujours jouable (ses deux prénoms sont encore des matchs) ? */
function duelValide(classement, sexe) {
	if (!app.duel || app.duel.sexe !== sexe) return false;
	const cles = new Set(classement.map((m) => m.cle));
	return app.duel.paire.every((m) => cles.has(m.cle));
}

function rendreDuels() {
	rendreChoixSexe($("#choix-sexe-duels"));
	const zone = $("#contenu-duels");
	if (!projetComplet()) {
		remplacerContenu(
			zone,
			videDuels(
				"Les duels départagent vos matchs : invite d'abord l'autre parent.",
			),
		);
		return;
	}
	const sexe = sexeAffiche();
	const { classement, joues } = classementDu(sexe);
	if (classement.length < 2) {
		remplacerContenu(
			zone,
			videDuels(
				`Il faut au moins deux matchs pour un duel (${pluriel(classement.length, "match")} pour l'instant). Un prénom gardé par vous deux devient un match.`,
			),
		);
		return;
	}
	if (!duelValide(classement, sexe)) {
		app.duel = { sexe, paire: choisirDuel(classement, joues) };
	}
	const [haut, bas] = app.duel.paire;
	// Même duel déjà affiché (réponse de l'API pendant qu'on hésite) : rien ne bouge.
	const affiche = zone.querySelector(".duel:not(.choisi)");
	if (affiche?.dataset.paire === `${haut.cle}~${bas.cle}`) return;
	remplacerContenu(
		zone,
		el("h2", { class: "titre-duel" }, "Lequel préférez-vous ?"),
		el(
			"div",
			{ class: "duel", "data-paire": `${haut.cle}~${bas.cle}` },
			carteDuel(haut, bas, sexe),
			el("p", { class: "duel-ou", "aria-hidden": "true" }, "ou"),
			carteDuel(bas, haut, sexe),
		),
		el(
			"p",
			{ class: "aide centre" },
			`${pluriel(joues.length, "duel")} joué${joues.length > 1 ? "s" : ""} à vous deux · ${pluriel(classement.length, "match")}`,
		),
	);
}

/** Le prénom touché gagne le duel : enregistré aussitôt, puis envoyé en arrière-plan. */
function choisir(gagnant, perdant, sexe, bouton) {
	if (bouton.closest(".duel")?.classList.contains("choisi")) return;
	bouton.closest(".duel")?.classList.add("choisi");
	bouton.classList.add("gagnant");
	app.duelsEnAttente.push({
		projetId: app.projetId,
		id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
		gagnant: gagnant.prenom,
		perdant: perdant.prenom,
		sexe,
	});
	app.duel = null;
	garderEnAttente();
	planifierEnvoi();
	setTimeout(
		rendreDuels,
		matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250,
	);
}

function rendreClassement() {
	rendreChoixSexe($("#choix-sexe-classement"));
	const zone = $("#contenu-classement");
	const sexe = sexeAffiche();
	const { classement, joues } = classementDu(sexe);
	if (classement.length === 0) {
		remplacerContenu(
			zone,
			videDuels(
				projetComplet()
					? "Pas encore de match : les prénoms gardés par vous deux apparaîtront ici, classés par vos duels."
					: "Invite l'autre parent : vos matchs apparaîtront ici, classés par vos duels.",
			),
		);
		return;
	}
	remplacerContenu(
		zone,
		el(
			"p",
			{ class: "aide" },
			`${pluriel(joues.length, "duel")} joué${joues.length > 1 ? "s" : ""}. Plus vous jouez, plus le classement est sûr.`,
		),
		el(
			"ol",
			{ class: "classement" },
			classement.map((m) =>
				el(
					"li",
					{},
					el(
						"button",
						{ type: "button", onclick: () => ouvrirFiche(m) },
						el(
							"span",
							{ class: `rang rang-${Math.min(m.place, 4)}` },
							String(m.place),
						),
						el(
							"span",
							{ class: "nom" },
							el("strong", {}, m.prenom),
							el(
								"span",
								{ class: "aide" },
								m.duels < DUELS_STABLES
									? `${pluriel(m.duels, "duel")} · encore peu de duels`
									: `${pluriel(m.duels, "duel")} · ${pluriel(m.victoires, "victoire")}`,
							),
						),
						el("span", { class: "score" }, String(m.score)),
					),
				),
			),
		),
		el(
			"button",
			{
				type: "button",
				class: "bouton-principal large",
				onclick: () => changerVue("duels"),
			},
			"Jouer des duels",
		),
	);
}

// ---------------------------------------------------------------------------
// Ma sélection : mes votes, la recherche, les prénoms ajoutés
// ---------------------------------------------------------------------------

function boutonsVote(prenom, vote) {
	const bouton = (valeur, texte) =>
		el(
			"button",
			{
				type: "button",
				class: `petit-vote ${valeur}`,
				"aria-pressed": String(vote === valeur),
				"aria-label": `${texte} pour ${prenom.prenom}`,
				onclick: () => {
					if (vote === valeur) return;
					voter(prenom.prenom, prenom.sexe, valeur);
					rendre();
				},
			},
			valeur === "oui" ? "✓" : "✕",
		);
	return el(
		"span",
		{ class: "petits-votes" },
		bouton("non", "Non"),
		bouton("oui", "Oui"),
	);
}

function lignePrenom(prenom, vote, match = false) {
	return el(
		"li",
		{ class: `ligne-prenom sexe-${prenom.sexe}` },
		el(
			"button",
			{ type: "button", class: "nom", onclick: () => ouvrirFiche(prenom) },
			el("strong", {}, prenom.prenom),
			el(
				"span",
				{ class: "aide" },
				[prenom.sexe === "f" ? "Fille" : "Garçon", match ? "❤ match" : ""]
					.filter(Boolean)
					.join(" · "),
			),
		),
		boutonsVote(prenom, vote),
	);
}

/** Ajoute un prénom absent de la base : mon vote oui aussitôt, l'ajout en arrière-plan. */
async function ajouterPrenom(prenom, sexe) {
	if (app.horsLigne) {
		notifier("Hors ligne : réessaie avec la connexion.", true);
		return;
	}
	// Le projet de l'ajout, même si on en change pendant l'appel.
	const { projetId } = app;
	voter(prenom, sexe, "oui");
	app.recherche = "";
	$("#champ-recherche").value = "";
	rendre();
	try {
		const { etat } = await appelerApi(
			"ajouter-prenom",
			{ projetId, prenom: { prenom, sexe } },
			{ discret: true },
		);
		recevoirEtat(etat);
		notifier(`${prenom} est ajouté : l'autre parent le verra passer.`);
	} catch (erreur) {
		if (estSessionRefusee(erreur)) {
			deconnecter(erreur.message);
			return;
		}
		app.votesEnAttente.delete(cleAttente(projetId, prenom, sexe));
		garderEnAttente();
		if (erreur instanceof ErreurReseau) passerHorsLigne();
		notifier(`${prenom} n'a pas été ajouté : ${erreur.message}`, true);
		rendre();
	}
}

function rendreRecherche() {
	const zone = $("#resultats-recherche");
	const texte = app.recherche.trim();
	if (!texte || !app.donnees) {
		remplacerContenu(zone);
		return;
	}
	const votes = mesVotes();
	const sexe = projet()?.sexe;
	const trouves = chercherPrenoms(app.donnees.liste, texte).filter(
		(p) => !sexe || p.sexe === sexe,
	);
	const exact = trouves.some(
		(p) => p.prenom.toLowerCase() === texte.toLowerCase(),
	);
	const ajout =
		!exact && /^\p{L}+(?:[-' ]\p{L}+)*$/u.test(texte)
			? el(
					"div",
					{ class: "ajout" },
					el(
						"p",
						{ class: "aide" },
						`« ${texte} » n'est pas dans la base : l'ajouter ?`,
					),
					el(
						"div",
						{ class: "puces" },
						(sexe ? [sexe] : ["f", "m"]).map((s) =>
							el(
								"button",
								{
									type: "button",
									class: "puce",
									onclick: () =>
										ajouterPrenom(
											texte.charAt(0).toUpperCase() + texte.slice(1),
											s,
										),
								},
								`Ajouter ${s === "f" ? "en fille" : "en garçon"}`,
							),
						),
					),
				)
			: null;
	remplacerContenu(
		zone,
		trouves.length
			? el(
					"ul",
					{ class: "liste-prenoms" },
					trouves.map((p) => lignePrenom(p, votes.get(p.cle)?.vote ?? null)),
				)
			: null,
		ajout,
	);
}

function rendreListe() {
	rendreRecherche();
	const votes = [...mesVotes().values()].map((v) => ({
		prenom: prenomDe(v.prenom, v.sexe),
		vote: v.vote,
	}));
	const cles = new Set(matchs().map((m) => clePrenom(m.prenom, m.sexe)));
	const oui = votes.filter((v) => v.vote === "oui");
	const non = votes.filter((v) => v.vote === "non");
	const ligne = (v) => lignePrenom(v.prenom, v.vote, cles.has(v.prenom.cle));
	const parNom = (a, b) => a.prenom.prenom.localeCompare(b.prenom.prenom, "fr");
	remplacerContenu(
		$("#contenu-liste"),
		oui.length === 0 && non.length === 0
			? el(
					"div",
					{ class: "vide" },
					el("p", {}, "Tu n'as encore voté pour aucun prénom."),
					el(
						"button",
						{ type: "button", onclick: () => changerVue("selection") },
						"Commencer la sélection",
					),
				)
			: null,
		oui.length
			? [
					el("h2", { class: "titre-section" }, `Mes oui (${oui.length})`),
					el("ul", { class: "liste-prenoms" }, oui.sort(parNom).map(ligne)),
				]
			: null,
		non.length
			? el(
					"details",
					{ class: "mes-non" },
					el("summary", { class: "titre-section" }, `Mes non (${non.length})`),
					el("ul", { class: "liste-prenoms" }, non.sort(parNom).map(ligne)),
				)
			: null,
	);
}

// ---------------------------------------------------------------------------
// Fiche d'un prénom
// ---------------------------------------------------------------------------

function ouvrirFiche(prenom) {
	if (!app.donnees) return;
	const remplir = () => {
		const vote = mesVotes().get(prenom.cle)?.vote ?? null;
		const match = matchs().some(
			(m) => clePrenom(m.prenom, m.sexe) === prenom.cle,
		);
		remplirFiche($("#contenu-fiche"), prenom, {
			nomFamille: nomFamille(),
			donnees: app.donnees,
			vote,
			match,
			surVote: (valeur) => {
				if (valeur === vote) return;
				voter(prenom.prenom, prenom.sexe, valeur);
				rendre();
				remplir();
			},
		});
	};
	remplir();
	const dialogue = $("#dialogue-fiche");
	if (!dialogue.open) dialogue.showModal();
}

// ---------------------------------------------------------------------------
// Projet : création, modification, partage avec l'autre parent
// ---------------------------------------------------------------------------

/** Remplit les champs du projet d'un formulaire (modèle #champs-projet). */
function preparerChampsProjet(formulaire, valeurs = {}) {
	const zone = formulaire.querySelector("[data-champs-projet]");
	if (!zone.firstElementChild) {
		zone.append($("#champs-projet").content.cloneNode(true));
		for (const puce of zone.querySelectorAll("[data-sexe-projet] .puce")) {
			puce.addEventListener("click", () => {
				for (const autre of zone.querySelectorAll("[data-sexe-projet] .puce")) {
					autre.setAttribute("aria-pressed", String(autre === puce));
				}
			});
		}
	}
	zone.querySelector('[name="nom"]').value = valeurs.nom ?? "";
	zone.querySelector('[name="nomFamille"]').value =
		valeurs.nomFamille ?? compteConnecte()?.nom ?? "";
	for (const puce of zone.querySelectorAll("[data-sexe-projet] .puce")) {
		puce.setAttribute(
			"aria-pressed",
			String(puce.dataset.valeur === (valeurs.sexe ?? "")),
		);
	}
	formulaire.querySelector(".erreur").textContent = "";
}

function lireChampsProjet(formulaire) {
	return {
		nom: formulaire.querySelector('[name="nom"]').value.trim(),
		nomFamille: formulaire.querySelector('[name="nomFamille"]').value.trim(),
		sexe:
			formulaire.querySelector('[data-sexe-projet] .puce[aria-pressed="true"]')
				?.dataset.valeur ?? "",
	};
}

/**
 * Crée un projet (écran sans projet, ou « + » de l'en-tête) : il devient le projet affiché, et l'app
 * propose d'inviter l'autre parent.
 */
async function creerProjet(evenement) {
	evenement.preventDefault();
	const formulaire = evenement.currentTarget;
	const bouton = formulaire.querySelector('[type="submit"]');
	bouton.disabled = true;
	try {
		const cree = await modifier(
			"creer-projet",
			{ projet: lireChampsProjet(formulaire) },
			(message) => {
				formulaire.querySelector(".erreur").textContent = message;
			},
		);
		if (cree) {
			formulaire.closest("dialog")?.close();
			notifier("Projet créé : invite l'autre parent.");
			partagerProjet();
		}
	} finally {
		bouton.disabled = false;
	}
}

/** « + » des pastilles de l'en-tête : la fenêtre d'un nouveau projet. */
function ouvrirNouveauProjet() {
	fermerMenu();
	preparerChampsProjet($("#form-projet"));
	$("#dialogue-projet").showModal();
}

/** Enregistre le nom, le nom de famille et le sexe du projet affiché (onglet Paramètres). */
async function enregistrerProjet(evenement) {
	evenement.preventDefault();
	const formulaire = evenement.currentTarget;
	const bouton = formulaire.querySelector('[type="submit"]');
	bouton.disabled = true;
	try {
		const fait = await modifier(
			"modifier-projet",
			{ projet: lireChampsProjet(formulaire) },
			(message) => {
				formulaire.querySelector(".erreur").textContent = message;
			},
		);
		if (fait) {
			app.pile = [];
			app.duel = null;
			formulaire.dataset.projet = "";
			rendre();
			notifier("Projet enregistré.");
		}
	} finally {
		bouton.disabled = false;
	}
}

/** Lien qui fait rejoindre le projet : l'app, avec l'Id et le code après « # » (pas envoyés au site). */
const lienDuProjet = (p) =>
	`${location.origin}${location.pathname}#rejoindre=${encodeURIComponent(p.id)}:${p.code}`;

/** Projet et code d'un lien (…#rejoindre=<Id>:<code>), ou null. */
function rejoindreDuLien(texte) {
	const trouve = /#rejoindre=([^:&]+):([0-9a-f]+)/i.exec(String(texte));
	return trouve
		? { projetId: decodeURIComponent(trouve[1]), code: trouve[2] }
		: null;
}

function partagerProjet() {
	fermerMenu();
	const p = projet();
	if (!p) return;
	const autre = p.parents.find((parent) => parent.id !== app.etat.moi.id);
	ouvrirQr({
		titre: "Inviter l'autre parent",
		aide: autre
			? `${autre.prenom} a déjà rejoint votre projet.`
			: "À scanner avec l'appareil photo, ou envoie le lien : l'autre parent rejoint votre projet (et crée son compte si besoin). Vos votes restent secrets : seuls vos matchs sont communs.",
		lien: lienDuProjet(p),
		texteEnvoi: "Choisissons le prénom de bébé ensemble :",
	});
}

/** Lien de l'autre parent ouvert avant d'être connecté : utilisé une fois connecté. */
async function rejoindreEnAttente() {
	const lien = lireStockageJson(CLES.rejoindre);
	if (!lien) return;
	ecrireStockage(CLES.rejoindre, null);
	if (app.etat?.projets.some((p) => p.id === lien.projetId)) {
		changerProjet(lien.projetId);
		return;
	}
	if (await modifier("rejoindre-projet", lien)) {
		notifier("Tu as rejoint votre projet : à vous les prénoms !");
	}
}

/**
 * Affiche un autre projet (pastille de l'en-tête) : il filtre toute l'app (sélection, matchs,
 * duels, classement), dans l'onglet ouvert. Son état gardé s'affiche aussitôt, puis l'API le met
 * à jour.
 */
function changerProjet(projetId) {
	if (projetId === app.projetId) return;
	app.projetId = projetId;
	ecrireStockage(CLES.projet, projetId);
	app.pile = [];
	app.duel = null;
	const garde = etatGarde(projetId);
	if (garde) appliquerEtat(garde);
	else rendre();
	actualiser({ silencieux: Boolean(garde) });
}

/**
 * Les projets du compte en pastilles sous le titre, comme les familles de Cadeaux, suivies de « + »
 * pour en créer un. Une seule est choisie : le projet affiché.
 */
function rendreProjetsEntete() {
	remplacerContenu(
		$("#projets-entete"),
		app.etat.projets.map((p) =>
			el(
				"button",
				{
					type: "button",
					"aria-pressed": String(p.id === app.projetId),
					onclick: () => changerProjet(p.id),
				},
				p.nom,
			),
		),
		el("button", {
			type: "button",
			class: "puce-ajout",
			"aria-label": "Nouveau projet",
			title: "Nouveau projet",
			onclick: ouvrirNouveauProjet,
		}),
	);
}

// ---------------------------------------------------------------------------
// Paramètres : les projets du compte, celui affiché, l'autre parent
// ---------------------------------------------------------------------------

function rendreParametres() {
	const p = projet();
	const formulaire = $("#form-parametres-projet");
	if (formulaire.dataset.projet !== p.id) {
		preparerChampsProjet(formulaire, p);
		formulaire.dataset.projet = p.id;
	}
	const autre = p.parents.find((parent) => parent.id !== app.etat.moi.id);
	remplacerContenu(
		$("#parents-projet"),
		el(
			"p",
			{},
			autre
				? `Avec ${autre.prenom} : vos matchs sont communs, vos autres votes restent secrets.`
				: "L'autre parent n'a pas encore rejoint ce projet.",
		),
		el(
			"button",
			{
				type: "button",
				class: autre ? "" : "bouton-principal",
				onclick: partagerProjet,
			},
			autre ? "Revoir le lien d'invitation" : "Inviter l'autre parent",
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
	if (!app.etat || $("#ecran-connexion").hidden === false) return;
	const p = projet();
	// Projet choisi pas encore chargé (ni gardé sur l'appareil) : son nom, et l'attente.
	const enChargement = Boolean(p && app.projetId && p.id !== app.projetId);
	$("#ecran-projet").hidden = Boolean(p);
	$("#ecran-app").hidden = !p;
	$("#onglets").hidden = !p;
	$("#menu-projet").hidden = !p;
	$("#projets-entete").hidden = !p;
	if (!p) {
		$("#titre").textContent = "Prénoms";
		const formulaire = $("#form-creer-projet");
		if (!formulaire.querySelector("[data-champs-projet]").firstElementChild) {
			preparerChampsProjet(formulaire);
		}
		return;
	}
	$("#titre").textContent = TITRES[app.vue];
	rendreProjetsEntete();
	$("#chargement-projet").hidden = !enChargement;
	for (const vue of VUES) {
		$(`#vue-${vue}`).hidden = enChargement || app.vue !== vue;
	}
	for (const bouton of document.querySelectorAll("#onglets button")) {
		bouton.setAttribute("aria-pressed", String(bouton.dataset.vue === app.vue));
	}
	if (enChargement) return;
	if (app.vue === "selection") rendreSelection();
	if (app.vue === "duels") rendreDuels();
	if (app.vue === "classement") rendreClassement();
	if (app.vue === "liste") rendreListe();
	if (app.vue === "parametres") rendreParametres();
}

// ---------------------------------------------------------------------------
// Connexion : compte du projet droits (shared/connexion.js)
// ---------------------------------------------------------------------------

function afficherEcran(nom) {
	const connecte = nom === "app";
	$("#ecran-connexion").hidden = connecte;
	for (const id of ["#bouton-actualiser", "#bouton-menu"]) {
		$(id).hidden = !connecte;
	}
	if (connecte) {
		afficherProfil();
		rendre();
	} else {
		$("#ecran-projet").hidden = true;
		$("#ecran-app").hidden = true;
		$("#onglets").hidden = true;
		$("#titre").textContent = "Prénoms";
	}
}

/**
 * Écran de connexion.
 * @param message Message à afficher (ex : session expirée)
 * @param invitation Code d'un lien de connexion (QR code d'un autre appareil), utilisé aussitôt
 */
function afficherConnexion(message = "", invitation = null) {
	afficherEcran("connexion");
	afficherFormulaireConnexion($("#connexion"), {
		nomApp: "Prénoms",
		message,
		invitation,
		surConnecte: (compte) => {
			notifier(`Bienvenue ${compte.prenom} !`);
			chargerApresConnexion();
		},
	});
}

/** Premier chargement de l'état du compte qui vient de se connecter. */
async function chargerApresConnexion() {
	oublierEtats();
	try {
		const etat = await appelerApi("etat");
		afficherEcran("app");
		appliquerEtat(etat);
	} catch (erreur) {
		deconnecter(erreur.message);
		return;
	}
	await rejoindreEnAttente();
	envoyer();
}

/** Oublie la connexion de l'appareil et ses données (votes en attente compris). */
function deconnecter(message = "") {
	fermerMenu();
	oublierConnexion();
	app.etat = null;
	app.pile = [];
	app.duel = null;
	app.votesEnAttente.clear();
	app.duelsEnAttente = [];
	garderEnAttente();
	oublierEtats();
	afficherConnexion(message);
}

/** Oublie les états gardés et le projet affiché (autre compte, déconnexion). */
function oublierEtats() {
	app.etat = null;
	app.projetId = null;
	for (const id of Object.keys(etatsEnCache)) delete etatsEnCache[id];
	ecrireStockage(CLES.etats, null);
	ecrireStockage(CLES.projet, null);
}

async function seDeconnecter() {
	fermerMenu();
	const attente = app.votesEnAttente.size + app.duelsEnAttente.length;
	const avertissement = attente
		? ` ${attente} vote(s) ou duel(s) pas encore enregistré(s) seront perdus.`
		: "";
	if (!confirm(`Te déconnecter de cet appareil ?${avertissement}`)) return;
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
			"Hors ligne : tes votes attendent sur l'appareil.",
			{
				libelle: "Réessayer",
				faire: async () => {
					app.horsLigne = false;
					await actualiser();
				},
			},
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
	for (const bouton of document.querySelectorAll("#onglets button")) {
		bouton.addEventListener("click", () => changerVue(bouton.dataset.vue));
	}
	// Balayer l'écran passe à la vue voisine, sauf sur les cartes (data-sans-balayage).
	brancherBalayage($("#ecran-app"), changerVueVoisine, {
		anime: () => $(`#vue-${app.vue}`),
	});
	$("#bouton-oui").addEventListener("click", () => voterCarteDuDessus("oui"));
	$("#bouton-non").addEventListener("click", () => voterCarteDuDessus("non"));
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") fermerMenu();
		if (app.vue !== "selection" || document.querySelector("dialog[open]"))
			return;
		if (e.target.closest("input, textarea")) return;
		if (e.key === "ArrowRight") voterCarteDuDessus("oui");
		if (e.key === "ArrowLeft") voterCarteDuDessus("non");
	});
	$("#bouton-filtres").addEventListener("click", () => {
		remplirFormulaireFiltres();
		$("#dialogue-filtres").showModal();
	});
	for (const groupe of document.querySelectorAll(
		"#form-filtres [data-filtre]",
	)) {
		for (const puce of groupe.querySelectorAll(".puce")) {
			puce.addEventListener("click", () => {
				const plusieurs = "plusieurs" in groupe.dataset;
				const choisie = puce.getAttribute("aria-pressed") === "true";
				for (const autre of groupe.querySelectorAll(".puce")) {
					if (autre === puce)
						autre.setAttribute(
							"aria-pressed",
							String(plusieurs ? !choisie : true),
						);
					else if (!plusieurs) autre.setAttribute("aria-pressed", "false");
				}
				compterFiltres();
			});
		}
	}
	$("#form-filtres").addEventListener("input", compterFiltres);
	$("#form-filtres").addEventListener("submit", (e) => {
		e.preventDefault();
		appliquerFiltres(lireFormulaireFiltres());
		$("#dialogue-filtres").close();
	});
	$("#bouton-effacer-filtres").addEventListener("click", () => {
		app.filtres = { ...FILTRES_PAR_DEFAUT };
		remplirFormulaireFiltres();
	});
	$("#form-creer-projet").addEventListener("submit", creerProjet);
	$("#form-projet").addEventListener("submit", creerProjet);
	$("#form-parametres-projet").addEventListener("submit", enregistrerProjet);
	$("#form-recherche").addEventListener("submit", (e) => e.preventDefault());
	$("#champ-recherche").addEventListener("input", (e) => {
		app.recherche = e.target.value;
		rendreRecherche();
	});
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
	$("#menu-projet").addEventListener("click", () => {
		fermerMenu();
		changerVue("parametres");
	});
	$("#menu-autre-appareil").addEventListener("click", async () => {
		fermerMenu();
		try {
			await connecterUnAutreAppareil("Prénoms");
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	});
	brancherBiometrie($("#menu-biometrie"), "Prénoms");
	$("#menu-installer").addEventListener("click", fermerMenu);
	brancherInstallation($("#menu-installer"), { connexion: true });
	$("#bouton-signalement").addEventListener("click", () => {
		fermerMenu();
		ouvrirSignalement({ app: "Prénoms", prenom: compteConnecte()?.prenom });
	});
	$("#menu-deconnecter").addEventListener("click", seDeconnecter);
	// Retour sur l'app : l'autre parent a peut-être voté entre-temps (nouveaux matchs).
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") {
			envoyer();
			return;
		}
		actualiser({ silencieux: true });
		chercherMiseAJour();
	});
	window.addEventListener("online", () => {
		app.horsLigne = false;
		actualiser({ silencieux: true });
	});
}

function demarrer() {
	afficherVersions();
	brancherEvenements();
	enregistrerServiceWorker();
	brancherProfil({ apresEnregistrement: actualiser });
	brancherBoutonPortail();
	chargerPrenoms().then(
		(donnees) => {
			app.donnees = donnees;
			rendre();
		},
		(erreur) => notifier(erreur.message, true),
	);
	// Liens ouverts dans l'app, retirés aussitôt de l'adresse : connexion d'un appareil
	// (…#invitation=<code>), ou invitation de l'autre parent (…#rejoindre=<Id>:<code>), gardée
	// jusqu'à la connexion.
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
			rejoindre ? "Connecte-toi pour rejoindre votre projet." : "",
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
				"Impossible de charger votre projet. Vérifie ta connexion.",
			);
		}
	});
}

demarrer();
