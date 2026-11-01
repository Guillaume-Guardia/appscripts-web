// Installation et mises à jour d'une app (PWA) : service worker (sw.js de l'app, qui s'appuie sur
// shared/sw-shared.js), bandeau « Nouvelle version disponible », bouton d'installation.

import { afficherBandeau, notifier } from "./dom.js";

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
 * Bouton « Installer l'app » : invitation du navigateur (Android, ordinateur), ou explications
 * pour l'iPhone (Safari n'a pas d'invitation).
 * @param bouton Le bouton, masqué tant que l'installation n'est pas possible
 * @param dialogueIos La fenêtre des explications pour l'iPhone
 */
export function brancherInstallation(bouton, dialogueIos) {
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
			dialogueIos.showModal();
		}
	});
}
