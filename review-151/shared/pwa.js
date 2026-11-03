// Installation et mises à jour d'une app (PWA) : service worker (sw.js de l'app, qui s'appuie sur
// shared/sw-shared.js), bandeau « Nouvelle version disponible », bouton d'installation,
// proposition d'installer (arrivée par un lien d'invitation) et explications pour l'iPhone, avec
// le lien de connexion copié pour l'app installée.

import { afficherBandeau, el, notifier } from "./dom.js";

let enregistrement = null;

/**
 * Enregistre le service worker de l'app (sw.js, à côté de sa page). Une nouvelle version affiche
 * le bandeau de mise à jour ; l'accepter recharge la page.
 */
export function enregistrerServiceWorker() {
	if (!("serviceWorker" in navigator)) return;
	// updateViaCache "none" : sw.js et version.js sont relus sans le cache HTTP de Pages.
	navigator.serviceWorker
		.register("sw.js", { updateViaCache: "none" })
		.then((nouvel) => {
			enregistrement = nouvel;
			const proposerMiseAJour = (worker) => {
				afficherBandeau("maj", "Nouvelle version disponible.", {
					libelle: "Mettre à jour",
					faire: () => worker.postMessage("activer"),
				});
			};
			if (nouvel.waiting && navigator.serviceWorker.controller) {
				proposerMiseAJour(nouvel.waiting);
			}
			nouvel.addEventListener("updatefound", () => {
				const worker = nouvel.installing;
				worker?.addEventListener("statechange", () => {
					if (
						worker.state === "installed" &&
						navigator.serviceWorker.controller
					) {
						proposerMiseAJour(worker);
					}
				});
			});
		});
	// Première visite : le service worker prend la main (clients.claim) sans rien changer à l'app,
	// pas besoin de recharger. Ensuite, un changement est une mise à jour acceptée.
	const avaitUnServiceWorker = Boolean(navigator.serviceWorker.controller);
	let recharge = false;
	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (recharge || !avaitUnServiceWorker) return;
		recharge = true;
		window.location.reload();
	});
}

/**
 * Cherche une nouvelle version sans attendre le cache (menu, retour sur l'app).
 * @param silencieux Sans notification (retour sur l'app)
 */
export async function chercherMiseAJour({ silencieux = false } = {}) {
	if (!enregistrement) return;
	try {
		await enregistrement.update();
	} catch {
		if (!silencieux) {
			notifier("Impossible de vérifier : pas de connexion ?", true);
		}
		return;
	}
	if (silencieux) return;
	if (enregistrement.waiting || enregistrement.installing) {
		notifier("Nouvelle version en cours de chargement…");
	} else {
		notifier(`Tu as la dernière version (${window.VERSION_APP}).`);
	}
}

const estIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

/** L'app est ouverte depuis l'écran d'accueil (installée), pas dans le navigateur. */
export const estInstallee =
	window.matchMedia("(display-mode: standalone)").matches ||
	navigator.standalone === true;

/** Invitation du navigateur (Android, ordinateur), gardée pour le bouton « Installer l'app ». */
let invitation = null;
/** Boutons « Installer l'app », affichés seulement si l'installation est possible. */
const boutons = new Set();

const installationPossible = () => !estInstallee && (invitation || estIos);

function afficherBoutons() {
	for (const bouton of boutons) bouton.hidden = !installationPossible();
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
 * Fenêtre des explications pour l'iPhone : Safari n'a pas d'invitation, l'app s'ajoute à la main.
 * @param connexion L'app demande une connexion : l'app installée ne la partage pas avec Safari,
 * un lien de connexion est copié pour elle
 */
function ouvrirAideIos(connexion) {
	const remarque = el(
		"p",
		{ class: "aide" },
		"L'app installée ne partage pas la connexion de Safari : il faudra t'y reconnecter au premier lancement (biométrie, code par e-mail ou QR code depuis un appareil connecté).",
	);
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
			"Dans Safari : bouton ",
			el("strong", {}, "Partager"),
			", puis ",
			el("strong", {}, "Sur l'écran d'accueil"),
			".",
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
	afficherBoutons();
	bouton.addEventListener("click", () => installer(connexion));
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
