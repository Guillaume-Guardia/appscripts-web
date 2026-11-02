// Service worker commun aux apps : chargé par le sw.js de chaque app avec importScripts, après son
// version.js. Les fichiers de l'app restent disponibles hors ligne.
//
// version.js, généré à la publication (scripts/publier-web.mjs), donne VERSION_APP (version des
// fronts, web/package.json), EMPREINTE_APP (empreinte des fichiers de l'app et de shared/) et
// FICHIERS_APP (fichiers à mettre en cache dès l'installation). Toute modification change donc
// version.js : le navigateur, qui compare aussi les scripts importés par sw.js, propose la mise à
// jour aux téléphones.

/**
 * Installe les gestionnaires du service worker.
 * @param nomApp Préfixe des caches de l'app : les apps partagent l'origine, donc le stockage des
 * caches, et chacune ne supprime que les siens (ceux d'un front de review, REVIEW défini par
 * version.js, sont préfixés à part, par dossier de review)
 */
// biome-ignore lint/correctness/noUnusedVariables: appelée par le sw.js de chaque app.
function installerServiceWorker(nomApp) {
	const prefixe = `${self.REVIEW ? `review-${self.REVIEW_DOSSIER || ""}-` : ""}${nomApp}-`;
	const version = `${prefixe}${self.VERSION_APP}-${self.EMPREINTE_APP || "dev"}`;
	const fichiers = self.FICHIERS_APP || ["./"];

	self.addEventListener("install", (evenement) => {
		// cache: "reload" : les fichiers de la nouvelle version, pas ceux du cache HTTP (10 min sur Pages).
		evenement.waitUntil(
			caches
				.open(version)
				.then((cache) =>
					cache.addAll(
						fichiers.map((f) => new Request(f, { cache: "reload" })),
					),
				),
		);
	});

	self.addEventListener("activate", (evenement) => {
		evenement.waitUntil(
			caches
				.keys()
				.then((cles) =>
					Promise.all(
						cles
							.filter((cle) => cle.startsWith(prefixe) && cle !== version)
							.map((cle) => caches.delete(cle)),
					),
				)
				.then(() => self.clients.claim()),
		);
	});

	// L'app demande l'activation quand l'utilisateur accepte la mise à jour.
	self.addEventListener("message", (evenement) => {
		if (evenement.data === "activer") self.skipWaiting();
	});

	// Fichiers du site : depuis le cache, rafraîchi en arrière-plan. L'API (autre origine, POST)
	// n'est jamais mise en cache : les données hors ligne sont gardées par l'app elle-même.
	self.addEventListener("fetch", (evenement) => {
		const requete = evenement.request;
		if (
			requete.method !== "GET" ||
			new URL(requete.url).origin !== self.location.origin
		) {
			return;
		}
		evenement.respondWith(
			caches.open(version).then(async (cache) => {
				const enCache = await cache.match(requete, { ignoreSearch: true });
				const reseau = fetch(requete)
					.then((reponse) => {
						if (reponse.ok) cache.put(requete, reponse.clone());
						return reponse;
					})
					.catch(() => enCache || cache.match("./"));
				if (enCache) {
					evenement.waitUntil(reseau);
					return enCache;
				}
				return reseau;
			}),
		);
	});
}
