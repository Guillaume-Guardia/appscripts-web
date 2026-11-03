// Les apps du site, pour passer de l'une à l'autre : groupe « Apps » du menu de chaque app. Le
// portail (index.html) en a les cartes ; une nouvelle app s'ajoute aux deux.

import { accesDuCompte, lireSession } from "./connexion.js";
import { el, remplacerContenu } from "./dom.js";

/**
 * `dossier` : celui de l'app dans web/, et sa clé dans apps() du projet droits ; `acces` : ouverte
 * par l'onglet Droits (sinon à tous, sans compte).
 */
export const APPS = [
	{ dossier: "voyage", nom: "Voyage", acces: true },
	{ dossier: "cuisine", nom: "Cuisine", acces: true },
	{ dossier: "investissement", nom: "Investissement", acces: false },
	{ dossier: "cadeaux", nom: "Cadeaux", acces: true },
	{ dossier: "calendrier", nom: "Calendrier", acces: true },
	{ dossier: "perudo", nom: "Perudo", acces: false },
	{ dossier: "droits", nom: "Droits", acces: true },
];

/**
 * Remplit le groupe « Apps » du menu : le portail, puis les autres apps. Celles que le compte
 * connecté n'a pas (onglet Droits) sont retirées dès que l'API a répondu ; sans compte, ou hors
 * ligne, toutes restent. Liens dans la même fenêtre : dans le portail installé, on y reste.
 * @param conteneur Élément du menu qui reçoit les liens
 * @param dossier Dossier de l'app ouverte (pas de lien vers elle)
 */
export function brancherMenuApps(conteneur, dossier) {
	// Menu role="menu" (Cadeaux) : chaque lien est un menuitem.
	const role = conteneur.closest('[role="menu"]') ? "menuitem" : null;
	const rendre = (ouvertes) =>
		remplacerContenu(
			conteneur,
			el("a", { href: "../", role }, "Toutes mes apps"),
			APPS.filter(
				(app) =>
					app.dossier !== dossier &&
					(!app.acces || !ouvertes || ouvertes.includes(app.dossier)),
			).map((app) => el("a", { href: `../${app.dossier}/`, role }, app.nom)),
		);
	rendre(null);
	if (lireSession() && window.API_DROITS) {
		accesDuCompte()
			.then(({ apps }) => rendre(apps))
			.catch(() => {});
	}
}
