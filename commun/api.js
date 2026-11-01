// Appel d'une API Apps Script (Web App, doPost) : corps JSON envoyé en text/plain, pour éviter la
// requête préalable CORS que les Web Apps ne savent pas traiter. Réponse : { ok, data, version }
// ou { ok: false, erreur, version }.

import { $ } from "./dom.js";

/** Pas de réseau, ou réponse illisible : l'app passe hors ligne (lecture seule). */
export class ErreurReseau extends Error {}

let appelsEnCours = 0;

/** Barre de chargement en haut de la page (#chargement), tant qu'un appel est en cours. */
function signalerChargement(delta) {
	appelsEnCours += delta;
	const barre = $("#chargement");
	if (barre) barre.hidden = appelsEnCours === 0;
}

/**
 * Client d'une API.
 * @param url Adresse /exec de la Web App
 * @param identifiants Paramètres ajoutés à chaque appel (ex : () => ({ cle })), relus à chaque appel
 * @param surVersion Appelée avec la version de l'API renvoyée par chaque réponse
 * @param surReponse Appelée avec chaque réponse réussie entière, pour ce qu'elle porte à côté des
 * données (ex : la nouvelle clé de connexion de cadeaux)
 * @return appeler(action, parametres) : les données de la réponse
 * @throws ErreurReseau sans réseau ou réponse illisible ; Error avec le message de l'API sinon
 */
export function creerApi({
	url,
	identifiants = () => ({}),
	surVersion,
	surReponse,
}) {
	return async function appeler(action, parametres = {}) {
		signalerChargement(1);
		try {
			let reponse;
			try {
				reponse = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "text/plain;charset=utf-8" },
					body: JSON.stringify({ action, ...identifiants(), ...parametres }),
				});
			} catch {
				throw new ErreurReseau(
					"Pas de connexion. Réessaie quand tu seras en ligne.",
				);
			}
			let donnees;
			try {
				donnees = await reponse.json();
			} catch {
				throw new ErreurReseau(
					"Le serveur ne répond pas correctement. Réessaie dans un instant.",
				);
			}
			if (donnees.version) surVersion?.(donnees.version);
			if (!donnees.ok) throw new Error(donnees.erreur || "Erreur inconnue.");
			surReponse?.(donnees);
			return donnees.data;
		} finally {
			signalerChargement(-1);
		}
	};
}
