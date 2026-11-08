// Installation et mises à jour d'une app (PWA) : service worker (sw.js de l'app, qui s'appuie sur
// shared/sw-shared.js), mise à jour automatique de toutes les apps, bouton d'installation,
// proposition d'installer (arrivée par un lien d'invitation) et explications pour l'iPhone, avec
// le lien de connexion copié pour l'app installée.

import { $, el, notifier } from "./dom.js";
import { ecrireStockage, lireStockage } from "./stockage.js";

let enregistrement = null;
let rechargementDemande = false;

/** Dernière version ouverte sur l'appareil, commune aux apps : une mise à jour s'annonce une fois. */
const CLE_VERSION_VUE = "appscripts.versionVue";
/** Racine du site (ce fichier est dans shared/) : la production, ou un front de review. */
const RACINE_SITE = new URL("../", import.meta.url).href;
/** Délai après lequel la page est rechargée si le navigateur n'a rien annoncé (iPhone). */
const DELAI_MISE_A_JOUR_MS = 5000;
/** Attente entre deux essais de rechargement, tant que la personne est occupée. */
const DELAI_SI_OCCUPE_MS = 2000;

/** Une saisie, une fenêtre ou un envoi en cours : recharger ferait perdre quelque chose. */
function estOccupe() {
	return (
		document.querySelector("dialog[open]") !== null ||
		document.activeElement?.matches(
			"input:not([type=checkbox], [type=radio], [type=button], [type=submit]), textarea, select",
		) === true ||
		$("#chargement")?.hidden === false
	);
}

/** Recharge la page dès que la personne n'est plus occupée. */
function recharger() {
	if (rechargementDemande) return;
	rechargementDemande = true;
	const essayer = () => {
		if (estOccupe()) setTimeout(essayer, DELAI_SI_OCCUPE_MS);
		else window.location.reload();
	};
	essayer();
}

/** Après une mise à jour, dit une seule fois « ancienne version → nouvelle version ». */
function annoncerMiseAJour() {
	const actuelle = window.VERSION_APP;
	if (!actuelle) return;
	const vue = lireStockage(CLE_VERSION_VUE);
	// Une app pas encore à jour ne ramène pas la version vue en arrière.
	if (vue && actuelle.localeCompare(vue, undefined, { numeric: true }) <= 0) {
		return;
	}
	ecrireStockage(CLE_VERSION_VUE, actuelle);
	if (vue) notifier(`Mise à jour : ${vue} → ${actuelle}`);
}

/**
 * Demande aux autres apps du site de chercher la nouvelle version : elle est commune à toutes.
 * La production ne touche pas aux fronts de review (review-<numéro>/, sous sa racine).
 */
function mettreAJourLesAutresApps() {
	navigator.serviceWorker
		.getRegistrations()
		.then((enregistrements) => {
			for (const autre of enregistrements) {
				if (
					autre.scope !== enregistrement?.scope &&
					autre.scope.startsWith(RACINE_SITE) &&
					!autre.scope.slice(RACINE_SITE.length).startsWith("review-")
				) {
					autre.update().catch(() => {});
				}
			}
		})
		.catch(() => {});
}

/** Une nouvelle version est installée : les autres apps suivent, puis la page se recharge. */
function appliquerMiseAJour(worker) {
	mettreAJourLesAutresApps();
	// Recharger dès l'activation, sans attendre controllerchange, que l'iPhone n'envoie pas toujours.
	worker.addEventListener("statechange", () => {
		if (worker.state === "activated") recharger();
	});
	// Un service worker d'avant la mise à jour automatique, resté en attente, attend ce message.
	worker.postMessage("activer");
	setTimeout(recharger, DELAI_MISE_A_JOUR_MS);
}

/**
 * Enregistre le service worker de l'app (sw.js, à côté de sa page). Une nouvelle version s'installe
 * seule et recharge la page, puis s'annonce (voir annoncerMiseAJour).
 */
export function enregistrerServiceWorker() {
	annoncerMiseAJour();
	// Sur iPhone, :active (infobulles à l'appui maintenu) demande un écouteur tactile.
	document.addEventListener("touchstart", () => {}, { passive: true });
	if (!("serviceWorker" in navigator)) return;
	// updateViaCache "none" : sw.js et version.js sont relus sans le cache HTTP de Pages.
	navigator.serviceWorker
		.register("sw.js", { updateViaCache: "none" })
		.then((nouvel) => {
			enregistrement = nouvel;
			if (nouvel.waiting && navigator.serviceWorker.controller) {
				appliquerMiseAJour(nouvel.waiting);
			}
			nouvel.addEventListener("updatefound", () => {
				const worker = nouvel.installing;
				worker?.addEventListener("statechange", () => {
					if (
						worker.state === "installed" &&
						navigator.serviceWorker.controller
					) {
						appliquerMiseAJour(worker);
					}
				});
			});
		});
	// Première visite : le service worker prend la main (clients.claim) sans rien changer à l'app,
	// pas besoin de recharger ; de même quand il la prend à celui du portail (première visite d'une
	// app dans le portail installé, dont la portée couvre les apps). Ensuite, un changement du même
	// service worker est une mise à jour.
	const avant = navigator.serviceWorker.controller?.scriptURL;
	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (navigator.serviceWorker.controller?.scriptURL === avant) recharger();
	});
}

/** Cherche une nouvelle version sans attendre le cache (retour sur l'app). */
export async function chercherMiseAJour() {
	try {
		await enregistrement?.update();
	} catch {
		// Hors ligne : la recherche se refera au prochain retour sur l'app.
	}
}

const estIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

/** Navigateur de l'iPhone : les autres que Safari ont leur bouton Partager dans la barre d'adresse. */
const navigateurIos =
	[
		["Chrome", /CriOS/],
		["Firefox", /FxiOS/],
		["Edge", /EdgiOS/],
	].find(([, motif]) => motif.test(navigator.userAgent))?.[0] ?? "Safari";

/** L'app est ouverte depuis l'écran d'accueil (installée), pas dans le navigateur. */
export const estInstallee =
	window.matchMedia("(display-mode: standalone)").matches ||
	navigator.standalone === true;

/** Invitation du navigateur (Android, ordinateur), gardée pour le bouton « Installer l'app ». */
let invitation = null;
/** Boutons « Installer l'app » (ou leur groupe), affichés si l'installation est possible. */
const boutons = new Set();

const installationPossible = () => !estInstallee && (invitation || estIos);

function afficherBoutons() {
	for (const bouton of boutons) {
		// Bouton retiré de la page (écran de connexion refait) : oublié.
		if (!bouton.isConnected) boutons.delete(bouton);
		else bouton.hidden = !installationPossible();
	}
}

window.addEventListener("beforeinstallprompt", (evenement) => {
	evenement.preventDefault();
	invitation = evenement;
	afficherBoutons();
});
window.addEventListener("appinstalled", () => {
	invitation = null;
	afficherBoutons();
	notifier("App installée.");
});

/** Donne le lien de connexion à copier avant d'installer sur iPhone (shared/connexion.js). */
let fournirLienConnexion = null;

/**
 * Sur iPhone, l'app installée ne partage pas la connexion de Safari : avant de l'installer, un
 * lien de connexion à usage unique est copié, que l'app installée propose de coller.
 * @param fournir Promesse du lien, ou de null si l'appareil n'est pas connecté
 */
export function definirLienConnexion(fournir) {
	fournirLienConnexion = fournir;
}

/**
 * Copie le lien de connexion : à appeler pendant le toucher (Safari n'autorise la copie qu'à ce
 * moment), le lien arrivant ensuite de l'API.
 * @return Promesse : vrai si le lien est copié
 */
function copierLienConnexion() {
	if (!fournirLienConnexion) return Promise.resolve(false);
	try {
		const texte = fournirLienConnexion().then((lien) => {
			if (!lien) throw new Error("Pas connecté");
			return new Blob([lien], { type: "text/plain" });
		});
		return navigator.clipboard
			.write([new ClipboardItem({ "text/plain": texte })])
			.then(
				() => true,
				() => false,
			);
	} catch {
		return Promise.resolve(false);
	}
}

/**
 * Fenêtre des explications pour l'iPhone : ses navigateurs n'ont pas d'invitation, l'app s'ajoute
 * à la main (Safari, ou Chrome, Firefox et Edge depuis iOS 16.4).
 * @param connexion L'app demande une connexion : l'app installée ne la partage pas avec le
 * navigateur, un lien de connexion est copié pour elle
 */
function ouvrirAideIos(connexion) {
	const remarque = el(
		"p",
		{ class: "aide" },
		`L'app installée ne partage pas la connexion de ${navigateurIos} : il faudra t'y reconnecter au premier lancement (biométrie, code par e-mail ou QR code depuis un appareil connecté).`,
	);
	const safari = navigateurIos === "Safari";
	if (connexion) {
		copierLienConnexion().then((copie) => {
			if (copie) {
				remarque.textContent =
					"Ton lien de connexion est copié (valable 1 heure, une fois) : au premier lancement de l'app installée, touche « Coller mon lien de connexion », ou connecte-toi par la biométrie si tu l'as activée.";
			}
		});
	}
	const dialogue = el(
		"dialog",
		{ class: "dialogue", onclose: () => dialogue.remove() },
		el("h2", {}, "Installer l'app"),
		el(
			"p",
			{},
			`Dans ${navigateurIos} : bouton `,
			el("strong", {}, "Partager"),
			safari ? "" : " (dans la barre d'adresse, en haut à droite)",
			", puis ",
			el("strong", {}, "Sur l'écran d'accueil"),
			".",
		),
		el(
			"p",
			{ class: "aide" },
			safari
				? "Pas dans la liste ? Tout en bas, « Modifier les actions » pour l'ajouter."
				: "Pas dans la liste ? Tout en bas, « Modifier les actions » pour l'ajouter. Sinon (iOS trop ancien), ouvre cette page dans Safari.",
		),
		connexion ? remarque : null,
		el(
			"div",
			{ class: "boutons" },
			el(
				"button",
				{
					type: "button",
					class: "bouton-principal",
					onclick: () => dialogue.close(),
				},
				"Compris",
			),
		),
	);
	document.body.append(dialogue);
	dialogue.showModal();
}

/**
 * Installe l'app : invitation du navigateur, ou explications pour l'iPhone. À appeler pendant un
 * toucher (le navigateur l'exige), sans attendre avant.
 */
async function installer(connexion) {
	if (invitation) {
		const choix = invitation;
		invitation = null;
		choix.prompt();
		await choix.userChoice;
		afficherBoutons();
	} else if (estIos) {
		ouvrirAideIos(connexion);
	}
}

/**
 * Bouton « Installer l'app » du menu : invitation du navigateur (Android, ordinateur), ou
 * explications pour l'iPhone. Le bouton est dans la page, masqué (hidden) : il n'apparaît que
 * si l'installation est possible.
 * @param bouton Le bouton du menu
 * @param connexion L'app demande une connexion (sur iPhone, un lien de connexion est copié pour
 * l'app installée)
 */
export function brancherInstallation(bouton, { connexion = false } = {}) {
	boutons.add(bouton);
	bouton.hidden = !installationPossible();
	bouton.addEventListener("click", () => installer(connexion));
}

/**
 * Bouton « Installer l'app » hors du menu (écran de connexion, où le menu n'est pas affiché), dans
 * un groupe .boutons masqué tant que l'installation n'est pas possible.
 * @param connexion Voir brancherInstallation
 */
export function boutonInstallation({ connexion = false } = {}) {
	const groupe = el(
		"div",
		{ class: "boutons" },
		el(
			"button",
			{ type: "button", onclick: () => installer(connexion) },
			"Installer l'app",
		),
	);
	boutons.add(groupe);
	groupe.hidden = !installationPossible();
	return groupe;
}

/**
 * Propose d'installer l'app (arrivée par un lien d'invitation ou un QR code), si c'est possible et
 * qu'elle ne l'est pas déjà.
 * @param connexion L'app demande une connexion (voir brancherInstallation)
 * @return Promesse résolue quand la fenêtre est fermée
 */
export function proposerInstallation({ connexion = false } = {}) {
	if (!installationPossible()) return Promise.resolve();
	const dialogue = el(
		"dialog",
		{ class: "dialogue", onclose: () => dialogue.remove() },
		el("h2", {}, "Installer l'app ?"),
		el(
			"p",
			{ class: "aide" },
			"Elle s'ouvrira depuis l'écran d'accueil, comme une app du téléphone, même sans réseau.",
		),
		el(
			"div",
			{ class: "boutons" },
			el(
				"button",
				{ type: "button", onclick: () => dialogue.close() },
				"Plus tard",
			),
			el(
				"button",
				{
					type: "button",
					class: "bouton-principal",
					onclick: () => {
						dialogue.close();
						installer(connexion);
					},
				},
				"Installer",
			),
		),
	);
	document.body.append(dialogue);
	dialogue.showModal();
	return new Promise((resolve) => {
		dialogue.addEventListener("close", resolve);
	});
}
