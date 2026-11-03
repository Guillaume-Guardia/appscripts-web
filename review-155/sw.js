// Service worker du portail : voir shared/sw-shared.js.
importScripts("version.js", "shared/sw-shared.js");

// Portée : tout le site, mais chaque app a son propre service worker (portée plus précise, qui
// l'emporte) : celui-ci ne répond que pour les fichiers du portail.
installerServiceWorker("portail", { seulementSesFichiers: true });
