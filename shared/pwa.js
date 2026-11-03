// Installation et mises à jour d'une app (PWA) : service worker (sw.js de l'app, qui s'appuie sur
// shared/sw-shared.js), bandeau « Nouvelle version disponible », bouton d'installation et
// explications pour l'iPhone.

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
const estInstallee =
	window.matchMedia("(display-mode: standalone)").matches ||
	navigator.standalone === true;

/**
 * Fenêtre des explications pour l'iPhone : Safari n'a pas d'invitation, l'app s'ajoute à la main.
 * @param connexion L'app demande une connexion : l'app installée ne la partage pas avec Safari
 */
function ouvrirAideIos(connexion) {
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
		connexion
			? el(
					"p",
					{ class: "aide" },
					"L'app installée ne partage pas la connexion de Safari : il faudra t'y reconnecter au premier lancement (biométrie, code par e-mail ou QR code depuis un appareil connecté).",
				)
			: null,
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
 * Bouton « Installer l'app » du menu : invitation du navigateur (Android, ordinateur), ou
 * explications pour l'iPhone. Le bouton est dans la page, masqué (hidden) : il n'apparaît que
 * si l'installation est possible.
 * @param bouton Le bouton du menu
 * @param connexion L'app demande une connexion (ajoute une remarque aux explications pour l'iPhone)
 */
export function brancherInstallation(bouton, { connexion = false } = {}) {
	let invitation = null;
	if (estIos && !estInstallee) bouton.hidden = false;
	window.addEventListener("beforeinstallprompt", (evenement) => {
		evenement.preventDefault();
		invitation = evenement;
		bouton.hidden = false;
	});
	window.addEventListener("appinstalled", () => {
		invitation = null;
		bouton.hidden = true;
		notifier("App installée.");
	});
	bouton.addEventListener("click", async () => {
		if (invitation) {
			invitation.prompt();
			await invitation.userChoice;
			invitation = null;
			bouton.hidden = true;
		} else if (estIos) {
			ouvrirAideIos(connexion);
		}
	});
}
