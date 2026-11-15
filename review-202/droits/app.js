import { creerApi, ErreurReseau } from "../shared/api.js";
import {
	afficherConnexion as afficherFormulaireConnexion,
	brancherBiometrie,
	brancherBoutonPortail,
	compteConnecte,
	connecterUnAutreAppareil,
	deconnecter as deconnecterAppareil,
	estSessionRefusee,
	invitationDuLien,
	inviterPersonne,
	lienInvitation,
	lireSession,
} from "../shared/connexion.js";
import {
	$,
	el,
	normaliser,
	notifier,
	remplacerContenu,
} from "../shared/dom.js";
import { afficherProfil, brancherProfil } from "../shared/profil.js";
import {
	brancherInstallation,
	enregistrerServiceWorker,
} from "../shared/pwa.js";
import { ouvrirQr } from "../shared/qr.js";
import { ouvrirSignalement } from "../shared/signalement.js";

// ---------------------------------------------------------------------------
// État de l'app
// ---------------------------------------------------------------------------

const app = {
	/** { apps, comptes } renvoyé par l'API (action administration). */
	administration: null,
	/**
	 * Modifications envoyées une à une, dans l'ordre des clics : `file` (la dernière promesse) et
	 * `restantes` (envoyées ou en attente).
	 */
	modifications: { file: Promise.resolve(), restantes: 0 },
	/** Version de l'API, renvoyée avec chaque réponse (affichée avec celle de l'app). */
	versionApi: null,
	/** Onglet affiché, et liste des comptes : recherche, filtre, tri, comptes dépliés (Ids). */
	vue: {
		onglet: "comptes",
		recherche: "",
		filtre: "tous",
		tri: "prenom",
		ouverts: new Set(),
	},
};

/** Prénom et nom d'un compte (« Max Rolland », ou « Max » sans nom). */
const nomComplet = ({ prenom, nom }) => [prenom, nom].filter(Boolean).join(" ");

/** Filtres de la liste des comptes (puces sous la recherche). */
const FILTRES = [
	{ cle: "tous", nom: "Tous", garde: () => true },
	{ cle: "bloques", nom: "Bloqués", garde: (compte) => compte.bloque },
	{
		cle: "sans-app",
		nom: "Sans app",
		garde: (compte) => !compte.toutes && !compte.apps.length,
	},
	{
		cle: "sans-appareil",
		nom: "Sans appareil",
		garde: (compte) => compte.appareils === 0,
	},
];

const pluriel = (nombre, mot) => `${nombre} ${mot}${nombre > 1 ? "s" : ""}`;

/** Compte connecté sans accès à l'app droits (MESSAGE_ACCES_REFUSE du projet shared). */
const estAccesRefuse = (erreur) =>
	/Pas encore accès/.test(erreur?.message ?? "");

// ---------------------------------------------------------------------------
// API (Web App Apps Script, projet droits)
// ---------------------------------------------------------------------------

const appelerApi = creerApi({
	url: window.API_DROITS,
	identifiants: () => ({ session: lireSession() }),
	surVersion: (version) => {
		app.versionApi = version;
		afficherVersions();
	},
});

/** Erreur d'un appel : retour à la connexion, écran de refus, ou notification. */
function traiterErreur(erreur) {
	if (estSessionRefusee(erreur)) afficherConnexion(erreur.message);
	else if (estAccesRefuse(erreur)) afficherRefus(erreur.message);
	else notifier(erreur.message, true);
}

async function actualiser() {
	const bouton = $("#bouton-actualiser");
	bouton.classList.add("tourne");
	try {
		// Après les modifications en attente : la liste les montre toutes.
		await app.modifications.file;
		app.administration = await appelerApi("administration");
		afficherEcran("comptes");
	} catch (erreur) {
		traiterErreur(erreur);
	} finally {
		bouton.classList.remove("tourne");
	}
}

/**
 * Ajoute une modification à la file : elle part après les précédentes, sans en perdre aucune
 * (plusieurs cases cochées vite, pendant qu'un appel est en cours). L'API renvoie à chaque fois la
 * liste à jour ; elle n'est redessinée qu'une fois la file vide, pour ne pas décocher les cases
 * encore en attente.
 */
function modifier(action, parametres, messageSucces) {
	const modifications = app.modifications;
	modifications.restantes++;
	modifications.file = modifications.file.then(async () => {
		try {
			app.administration = await appelerApi(action, parametres);
			notifier(messageSucces);
		} catch (erreur) {
			if (erreur instanceof ErreurReseau) notifier(erreur.message, true);
			else traiterErreur(erreur);
		} finally {
			modifications.restantes--;
			// Liste à jour, ou remise des cases comme avant pour celles qui ont échoué.
			if (!modifications.restantes && app.administration) rendreComptes();
		}
	});
	return modifications.file;
}

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

function casesDesApps(compte, apps, moi) {
	return apps.map(({ cle, nom }) =>
		el(
			"label",
			{ class: "case" },
			el("input", {
				type: "checkbox",
				checked: compte.apps.includes(cle),
				// « * » et son propre compte ne se changent que dans l'onglet Droits.
				disabled: compte.toutes || moi,
				onchange: (e) =>
					modifier(
						"changer-droit",
						{ compteId: compte.id, app: cle, acces: e.target.checked },
						`${nom} ${e.target.checked ? "ouvert" : "fermé"} à ${compte.prenom}.`,
					),
			}),
			nom,
		),
	);
}

/** Droit de voir le bouton « Mes apps » (lien vers le portail) dans les apps (« portail »). */
function casePortail(compte, moi) {
	return el(
		"label",
		{ class: "case" },
		el("input", {
			type: "checkbox",
			checked: compte.portail,
			disabled: compte.toutes || moi,
			onchange: (e) =>
				modifier(
					"changer-droit",
					{ compteId: compte.id, app: "portail", acces: e.target.checked },
					`Portail ${e.target.checked ? "visible" : "masqué"} pour ${compte.prenom}.`,
				),
		}),
		"Voir le portail",
	);
}

/** Droit de voir les liens des classeurs dans le portail (« tableaux » dans l'onglet Droits). */
function caseTableaux(compte, moi) {
	return el(
		"label",
		{ class: "case" },
		el("input", {
			type: "checkbox",
			checked: compte.tableaux,
			disabled: compte.toutes || moi,
			onchange: (e) =>
				modifier(
					"changer-droit",
					{ compteId: compte.id, app: "tableaux", acces: e.target.checked },
					`Tableaux ${e.target.checked ? "visibles" : "masqués"} pour ${compte.prenom}.`,
				),
		}),
		"Voir les tableaux",
	);
}

function deconnecterSesAppareils(compte) {
	if (
		!confirm(
			`Déconnecter tous les appareils de ${compte.prenom} ? Sa biométrie est aussi désactivée.`,
		)
	) {
		return;
	}
	modifier(
		"deconnecter-compte",
		{ compteId: compte.id },
		`Appareils de ${compte.prenom} déconnectés.`,
	);
}

function basculerBlocage(compte) {
	if (
		!compte.bloque &&
		!confirm(`Bloquer ${compte.prenom} sur toutes les apps ?`)
	) {
		return;
	}
	modifier(
		"changer-blocage",
		{ compteId: compte.id, bloque: !compte.bloque },
		`${compte.prenom} ${compte.bloque ? "débloqué" : "bloqué"}.`,
	);
}

function supprimerCompte(compte) {
	if (
		!confirm(
			`Supprimer le compte de ${compte.prenom} ? Ses appareils sont déconnectés (biométrie comprise) et ses droits retirés. Ce que les apps ont gardé de lui (ex : sa liste dans Cadeaux) reste.`,
		)
	) {
		return;
	}
	modifier(
		"supprimer-compte",
		{ compteId: compte.id },
		`Compte de ${compte.prenom} supprimé.`,
	);
}

/**
 * Nouveau lien de connexion d'un compte : QR code, ou lien à copier, qui ouvre l'app choisie ;
 * collé ou scanné dans une app installée, il connecte cette app.
 * @param appChoisie Clé et nom de l'app que le lien ouvre
 */
async function afficherLienConnexion(compte, appChoisie) {
	try {
		const code = await appelerApi("lien-connexion", { compteId: compte.id });
		// Le site vu d'ici (front de review compris).
		const page = new URL(`../${appChoisie.cle}/`, location.href).href;
		const lien = lienInvitation(code, page);
		ouvrirQr({
			titre: `Connecter ${compte.prenom} à ${appChoisie.nom}`,
			aide: `À scanner ou à coller dans l'app (sur iPhone, dans l'app installée : toucher le lien ouvre Safari). Il reste valable jusqu'à ce qu'un nouveau le remplace ou que ses appareils soient déconnectés. Il donne accès à son compte : à ${compte.prenom} seulement.`,
			lien,
			texteEnvoi: `${compte.prenom}, voici ton lien de connexion à ${appChoisie.nom} (il est personnel, ne le transfère pas) :`,
			actions: [
				{
					libelle: "Copier le lien",
					faire: async () => {
						try {
							await navigator.clipboard.writeText(lien);
							notifier("Lien copié.");
						} catch {
							notifier("Impossible de copier le lien.", true);
						}
					},
				},
			],
		});
	} catch (erreur) {
		traiterErreur(erreur);
	}
}

/** Fenêtre « Lien de connexion » : choix de l'app ouverte, parmi celles du compte, puis QR code. */
function choisirAppDuLien(compte) {
	const appsDuCompte = app.administration.apps.filter(({ cle }) =>
		compte.apps.includes(cle),
	);
	if (!appsDuCompte.length) {
		notifier(`Ouvre d'abord une app à ${compte.prenom}.`, true);
		return;
	}
	const choix = el(
		"select",
		{ id: "lien-connexion-app" },
		appsDuCompte.map(({ cle, nom }) => el("option", { value: cle }, nom)),
	);
	const dialogue = el(
		"dialog",
		{ class: "dialogue", onclose: () => dialogue.remove() },
		el("h2", {}, `Lien de connexion de ${compte.prenom}`),
		el(
			"form",
			{
				class: "formulaire",
				onsubmit: (e) => {
					e.preventDefault();
					const appChoisie = appsDuCompte.find((a) => a.cle === choix.value);
					dialogue.close();
					afficherLienConnexion(compte, appChoisie);
				},
			},
			el("label", { for: "lien-connexion-app" }, "App à ouvrir"),
			choix,
			el(
				"p",
				{ class: "aide" },
				`Le nouveau lien remplace le précédent. Une fois connecté, ${compte.prenom} a accès à toutes ses apps.`,
			),
			el(
				"div",
				{ class: "boutons" },
				el(
					"button",
					{ type: "button", onclick: () => dialogue.close() },
					"Annuler",
				),
				el(
					"button",
					{ type: "submit", class: "bouton-principal" },
					"Créer le lien",
				),
			),
		),
	);
	document.body.append(dialogue);
	dialogue.showModal();
}

/** Modes de connexion d'un compte existant, activés ou non pour tous (onglet Modes). */
function rendreModes() {
	const { modes } = app.administration;
	remplacerContenu(
		$("#modes-connexion"),
		el("h2", { class: "titre-section" }, "Modes de connexion"),
		el(
			"div",
			{ class: "carte carte-modes" },
			modes.map(({ cle, nom, actif }) =>
				el(
					"label",
					{ class: "case" },
					el("input", {
						type: "checkbox",
						checked: actif,
						onchange: (e) =>
							modifier(
								"changer-mode",
								{ mode: cle, actif: e.target.checked },
								`${nom} ${e.target.checked ? "activé" : "désactivé"}.`,
							),
					}),
					nom,
				),
			),
			el(
				"p",
				{ class: "aide" },
				"Pour tous les comptes, aussitôt. Un appareil déjà connecté le reste ; les invitations, les liens de connexion des comptes et le QR code du classeur restent possibles.",
			),
		),
	);
}

/** Onglet Inviter ; rendu à l'ouverture et à l'actualisation seulement, pour garder la saisie. */
function rendreInvitation() {
	remplacerContenu(
		$("#invitation"),
		el("h2", { class: "titre-section" }, "Inviter une personne"),
		formulaireInvitation(),
	);
}

/**
 * Invitation d'une nouvelle personne : prénom et apps, puis QR code (ou lien) qui crée son compte
 * en s'ouvrant (shared/connexion.js), sur la page de la première app cochée.
 */
function formulaireInvitation() {
	const { apps } = app.administration;
	const prenom = el("input", {
		id: "invitation-prenom",
		required: true,
		autocomplete: "off",
		maxlength: "40",
	});
	const nom = el("input", {
		id: "invitation-nom",
		autocomplete: "off",
		maxlength: "60",
	});
	const cases = apps.map(({ cle, nom }) => ({
		cle,
		element: el("input", { type: "checkbox", value: cle }),
		nom,
	}));
	return el(
		"form",
		{
			class: "carte formulaire carte-modes",
			onsubmit: async (e) => {
				e.preventDefault();
				const choisies = cases.filter((c) => c.element.checked);
				if (!choisies.length) {
					notifier("Choisis au moins une app.", true);
					return;
				}
				const bouton = e.submitter ?? e.target.querySelector("[type=submit]");
				bouton.disabled = true;
				try {
					await inviterPersonne({
						prenom: prenom.value,
						nom: nom.value,
						apps: choisies.map((c) => c.cle),
						// Le site vu d'ici (front de review compris).
						page: new URL(`../${choisies[0].cle}/`, location.href).href,
						nomApp: choisies[0].nom,
					});
					e.target.reset();
				} catch (erreur) {
					traiterErreur(erreur);
				} finally {
					bouton.disabled = false;
				}
			},
		},
		el("label", { for: "invitation-prenom" }, "Son prénom"),
		prenom,
		el("label", { for: "invitation-nom" }, "Son nom (facultatif)"),
		nom,
		el(
			"div",
			{ class: "grille-cases" },
			cases.map(({ element, nom }) =>
				el("label", { class: "case" }, element, nom),
			),
		),
		el(
			"p",
			{ class: "aide" },
			"Son lien (QR code, ou à envoyer) lui crée un compte avec ces apps et le connecte. Valable 7 jours, une fois.",
		),
		el("button", { type: "submit" }, "Créer l'invitation"),
	);
}

/**
 * Un compte : une ligne (prénom, nombre d'apps et d'appareils), qui se déplie sur ses droits et
 * ses actions.
 * @param seul Seul compte affiché (recherche) : déplié d'office
 */
function carteCompte(compte, apps, seul) {
	const moi = compte.id === compteConnecte()?.id;
	const resume = [
		compte.bloque
			? "bloqué"
			: compte.toutes
				? "toutes les apps"
				: pluriel(compte.apps.length, "app"),
		pluriel(compte.appareils, "appareil"),
		moi ? "toi" : "",
	]
		.filter(Boolean)
		.join(" · ");
	const detail = [
		`Appareils connectés : ${compte.appareils}`,
		compte.biometrie ? `biométrie : ${compte.biometrie}` : "",
		compte.bloque ? "bloqué" : "",
		compte.toutes ? "toutes les apps (onglet Droits)" : "",
		moi ? "toi" : "",
	]
		.filter(Boolean)
		.join(" · ");
	return el(
		"details",
		{
			class: `carte carte-compte${compte.bloque ? " bloque" : ""}`,
			open: seul || app.vue.ouverts.has(compte.id),
		},
		el(
			"summary",
			{
				// Au clic, avant que le compte se déplie ou se replie : gardé déplié d'un rendu à l'autre.
				onclick: (e) => {
					if (e.currentTarget.parentElement.open) {
						app.vue.ouverts.delete(compte.id);
					} else {
						app.vue.ouverts.add(compte.id);
					}
				},
			},
			el("span", { class: "prenom" }, nomComplet(compte) || "Sans prénom"),
			el("span", { class: "resume" }, resume),
		),
		el(
			"div",
			{ class: "contenu-compte" },
			el("p", { class: "detail" }, detail),
			el(
				"div",
				{ class: "grille-cases" },
				casesDesApps(compte, apps, moi),
				casePortail(compte, moi),
				caseTableaux(compte, moi),
			),
			boutonsDuCompte(compte, moi),
		),
	);
}

function boutonsDuCompte(compte, moi) {
	return [
		!moi &&
			!compte.bloque &&
			el(
				"div",
				{ class: "boutons" },
				el(
					"button",
					{ type: "button", onclick: () => choisirAppDuLien(compte) },
					"Lien de connexion (QR code)",
				),
			),
		!moi &&
			el(
				"div",
				{ class: "boutons" },
				el(
					"button",
					{
						type: "button",
						disabled: compte.appareils === 0,
						onclick: () => deconnecterSesAppareils(compte),
					},
					"Déconnecter ses appareils",
				),
				el(
					"button",
					{
						type: "button",
						class: compte.bloque ? "" : "danger",
						onclick: () => basculerBlocage(compte),
					},
					compte.bloque ? "Débloquer" : "Bloquer",
				),
				el(
					"button",
					{
						type: "button",
						class: "danger",
						onclick: () => supprimerCompte(compte),
					},
					"Supprimer",
				),
			),
	];
}

/**
 * Comptes du filtre choisi dont le prénom, ou le nom d'une app ouverte, contient la recherche
 * (accents et casse ignorés), triés par prénom ou du plus récent au plus ancien (l'API les donne
 * dans l'ordre de l'onglet Comptes, où chaque compte créé s'ajoute en bas).
 */
function comptesVisibles() {
	const { apps, comptes } = app.administration;
	const { recherche, filtre, tri } = app.vue;
	const texte = normaliser(recherche);
	const { garde } = FILTRES.find((f) => f.cle === filtre);
	const correspond = (compte) =>
		[
			compte.prenom,
			compte.nom,
			nomComplet(compte),
			...apps
				.filter(({ cle }) => compte.toutes || compte.apps.includes(cle))
				.map(({ nom }) => nom),
		].some((mot) => normaliser(mot).includes(texte));
	const visibles = comptes.filter(
		(compte) => garde(compte) && (!texte || correspond(compte)),
	);
	return tri === "recents"
		? visibles.reverse()
		: visibles.sort((a, b) =>
				nomComplet(a).localeCompare(nomComplet(b), "fr", {
					sensitivity: "base",
				}),
			);
}

/** Puces des filtres, avec le nombre de comptes de chacun. */
function rendreFiltres() {
	const { comptes } = app.administration;
	remplacerContenu(
		$("#filtres-comptes"),
		FILTRES.map(({ cle, nom, garde }) =>
			el(
				"button",
				{
					type: "button",
					class: "puce",
					"aria-pressed": String(app.vue.filtre === cle),
					onclick: () => {
						app.vue.filtre = cle;
						rendreListe();
					},
				},
				`${nom} (${comptes.filter(garde).length})`,
			),
		),
	);
}

/** Liste des comptes (onglet Comptes), selon la recherche, le filtre et le tri. */
function rendreListe() {
	const { apps, comptes } = app.administration;
	const visibles = comptesVisibles();
	rendreFiltres();
	$("#nombre-comptes").textContent =
		visibles.length === comptes.length
			? pluriel(comptes.length, "compte")
			: `${visibles.length} sur ${pluriel(comptes.length, "compte")}`;
	remplacerContenu(
		$("#liste-comptes"),
		visibles.length
			? visibles.map((compte) =>
					carteCompte(compte, apps, visibles.length === 1),
				)
			: el(
					"p",
					{ class: "vide" },
					comptes.length ? "Aucun compte ne correspond." : "Aucun compte.",
				),
	);
}

/** Modes et liste des comptes, après chaque modification (l'onglet Inviter garde sa saisie). */
function rendreComptes() {
	rendreModes();
	rendreListe();
}

function afficherOnglet(nom) {
	app.vue.onglet = nom;
	for (const bouton of document.querySelectorAll("#onglets-droits button")) {
		bouton.setAttribute("aria-selected", String(bouton.dataset.onglet === nom));
	}
	for (const onglet of ["comptes", "inviter", "modes"]) {
		$(`#onglet-${onglet}`).hidden = onglet !== nom;
	}
}

// ---------------------------------------------------------------------------
// Écrans et connexion (shared/connexion.js)
// ---------------------------------------------------------------------------

function afficherEcran(nom) {
	$("#ecran-connexion").hidden = nom !== "connexion";
	$("#ecran-refus").hidden = nom !== "refus";
	$("#ecran-comptes").hidden = nom !== "comptes";
	$("#bouton-actualiser").hidden = nom !== "comptes";
	$("#bouton-menu").hidden = nom === "connexion";
	afficherProfil();
	if (nom === "comptes") {
		rendreComptes();
		rendreInvitation();
		afficherOnglet(app.vue.onglet);
	}
}

/**
 * Écran de connexion : appareil à connecter à un compte existant.
 * @param message Message à afficher (ex : session expirée)
 * @param invitation Code d'un lien de connexion (QR code d'un autre appareil), utilisé aussitôt
 */
function afficherConnexion(message = "", invitation = null) {
	app.administration = null;
	afficherEcran("connexion");
	afficherFormulaireConnexion($("#connexion"), {
		nomApp: "Droits",
		message,
		invitation,
		surConnecte: () => actualiser(),
	});
}

/** Compte connecté qui ne gère pas les droits. */
function afficherRefus(message) {
	app.administration = null;
	$("#message-refus").textContent = message;
	afficherEcran("refus");
}

async function seDeconnecter() {
	fermerMenu();
	await deconnecterAppareil();
	afficherConnexion();
}

// ---------------------------------------------------------------------------
// Menu
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
	$("#bouton-actualiser").addEventListener("click", actualiser);
	for (const bouton of document.querySelectorAll("#onglets-droits button")) {
		bouton.addEventListener("click", () =>
			afficherOnglet(bouton.dataset.onglet),
		);
	}
	$("#recherche-comptes").addEventListener("input", (e) => {
		app.vue.recherche = e.target.value;
		if (app.administration) rendreListe();
	});
	$("#tri-comptes").addEventListener("change", (e) => {
		app.vue.tri = e.target.value;
		if (app.administration) rendreListe();
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
	$("#menu-autre-appareil").addEventListener("click", async () => {
		fermerMenu();
		try {
			await connecterUnAutreAppareil("Droits");
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	});
	brancherBiometrie($("#menu-biometrie"), "Droits");
	$("#menu-installer").addEventListener("click", fermerMenu);
	brancherInstallation($("#menu-installer"), { connexion: true });
	$("#bouton-signalement").addEventListener("click", () => {
		fermerMenu();
		ouvrirSignalement({ app: "Droits", prenom: compteConnecte()?.prenom });
	});
	$("#menu-deconnecter").addEventListener("click", seDeconnecter);
	$("#bouton-deconnecter-refus").addEventListener("click", seDeconnecter);
}

function demarrer() {
	afficherVersions();
	brancherEvenements();
	enregistrerServiceWorker();
	brancherProfil();
	brancherBoutonPortail();
	// Lien de connexion d'un appareil (…#invitation=<code>), retiré aussitôt de l'adresse.
	const invitation = invitationDuLien(location.hash);
	history.replaceState(null, "", location.pathname);
	if (!window.API_DROITS) {
		afficherEcran("connexion");
		$("#connexion").textContent =
			"L'adresse de l'API n'est pas configurée (shared/config.js).";
		return;
	}
	if (invitation || !lireSession()) {
		afficherConnexion("", invitation);
		return;
	}
	actualiser();
}

demarrer();
