import { creerApi, ErreurReseau } from "../shared/api.js";
import {
	afficherConnexion as afficherFormulaireConnexion,
	compteConnecte,
	connecterUnAutreAppareil,
	deconnecter as deconnecterAppareil,
	estSessionRefusee,
	invitationDuLien,
	inviterPersonne,
	lireSession,
	ouvrirMesConnexions,
} from "../shared/connexion.js";
import { $, el, notifier, remplacerContenu } from "../shared/dom.js";
import {
	brancherInstallation,
	chercherMiseAJour,
	enregistrerServiceWorker,
} from "../shared/pwa.js";
import { ouvrirSignalement } from "../shared/signalement.js";

// ---------------------------------------------------------------------------
// État de l'app
// ---------------------------------------------------------------------------

const app = {
	/** { apps, comptes } renvoyé par l'API (action administration). */
	administration: null,
	occupe: false,
	/** Version de l'API, renvoyée avec chaque réponse (affichée avec celle de l'app). */
	versionApi: null,
};

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
		app.administration = await appelerApi("administration");
		afficherEcran("comptes");
	} catch (erreur) {
		traiterErreur(erreur);
	} finally {
		bouton.classList.remove("tourne");
	}
}

/** Lance une modification ; l'API renvoie la liste à jour. */
async function modifier(action, parametres, messageSucces) {
	if (app.occupe) return;
	app.occupe = true;
	try {
		app.administration = await appelerApi(action, parametres);
		notifier(messageSucces);
	} catch (erreur) {
		if (erreur instanceof ErreurReseau) notifier(erreur.message, true);
		else traiterErreur(erreur);
	} finally {
		app.occupe = false;
		// Liste à jour, ou remise des cases comme avant en cas d'échec.
		if (app.administration) rendreComptes();
	}
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

function changerEmail(compte) {
	const email = prompt(
		`Adresse e-mail de ${compte.prenom} (vide : aucune), pour se connecter par un code ou un lien :`,
		compte.email,
	);
	if (email === null) return;
	modifier(
		"changer-email",
		{ compteId: compte.id, email },
		`Adresse de ${compte.prenom} ${email.trim() ? "enregistrée" : "retirée"}.`,
	);
}

function envoyerLien(compte) {
	if (
		!confirm(
			`Envoyer à ${compte.email} un lien qui connecte un appareil au compte de ${compte.prenom} (10 minutes, une fois) ?`,
		)
	) {
		return;
	}
	modifier(
		"envoyer-lien",
		// Le site vu d'ici (front de review compris) : le lien ouvre une app du même site.
		{ compteId: compte.id, site: new URL("../", location.href).href },
		`Lien envoyé à ${compte.prenom}.`,
	);
}

/** Modes de connexion d'un compte existant, activés ou non pour tous. */
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
				"Pour tous les comptes, aussitôt. Un appareil déjà connecté le reste ; créer un compte (prénom) et le QR code du classeur restent possibles.",
			),
		),
		el("h2", { class: "titre-section" }, "Inviter une personne"),
		formulaireInvitation(),
		el("h2", { class: "titre-section" }, "Comptes"),
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
		cases.map(({ element, nom }) =>
			el("label", { class: "case" }, element, nom),
		),
		el(
			"p",
			{ class: "aide" },
			"Son lien (QR code, ou à envoyer) lui crée un compte avec ces apps et le connecte. Valable 7 jours, une fois.",
		),
		el("button", { type: "submit" }, "Créer l'invitation"),
	);
}

function carteCompte(compte, apps) {
	const moi = compte.id === compteConnecte()?.id;
	const lienActif = app.administration.modes.some(
		(mode) => mode.cle === "lien" && mode.actif,
	);
	const detail = [
		`Appareils connectés : ${compte.appareils}`,
		compte.biometrie ? `biométrie : ${compte.biometrie}` : "",
		compte.email || "sans e-mail",
		compte.bloque ? "bloqué" : "",
		compte.toutes ? "toutes les apps (onglet Droits)" : "",
		moi ? "toi" : "",
	]
		.filter(Boolean)
		.join(" · ");
	return el(
		"article",
		{ class: `carte carte-compte${compte.bloque ? " bloque" : ""}` },
		el("h3", {}, compte.prenom || "Sans prénom"),
		el("p", { class: "detail" }, detail),
		casesDesApps(compte, apps, moi),
		el(
			"div",
			{ class: "boutons" },
			el(
				"button",
				{ type: "button", onclick: () => changerEmail(compte) },
				compte.email ? "Changer l'e-mail" : "Ajouter un e-mail",
			),
			!moi &&
				compte.email &&
				lienActif &&
				!compte.bloque &&
				el(
					"button",
					{ type: "button", onclick: () => envoyerLien(compte) },
					"Envoyer un lien de connexion",
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
	);
}

function rendreComptes() {
	const { apps, comptes } = app.administration;
	rendreModes();
	remplacerContenu(
		$("#liste-comptes"),
		comptes.length
			? comptes.map((compte) => carteCompte(compte, apps))
			: el("p", { class: "vide" }, "Aucun compte."),
	);
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
	const compte = compteConnecte();
	$("#menu-compte").textContent = compte ? `Connecté : ${compte.prenom}` : "";
	if (nom === "comptes") rendreComptes();
}

/**
 * Écran de connexion : nouveau compte (prénom), ou appareil à connecter à un compte existant.
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
	$("#menu-connexions").addEventListener("click", async () => {
		fermerMenu();
		try {
			await ouvrirMesConnexions("Droits");
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	});
	$("#menu-installer").addEventListener("click", fermerMenu);
	brancherInstallation($("#menu-installer"), { connexion: true });
	$("#menu-signalement").addEventListener("click", () => {
		fermerMenu();
		ouvrirSignalement({ app: "Droits", prenom: compteConnecte()?.prenom });
	});
	$("#menu-maj").addEventListener("click", () => {
		fermerMenu();
		chercherMiseAJour();
	});
	$("#menu-deconnecter").addEventListener("click", seDeconnecter);
	$("#bouton-deconnecter-refus").addEventListener("click", seDeconnecter);
}

function demarrer() {
	afficherVersions();
	brancherEvenements();
	enregistrerServiceWorker();
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
