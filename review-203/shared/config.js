// Généré par scripts/publier-web.mjs : adresse de l'API de connexion (projet droits).
window.API_DROITS = "https://script.google.com/macros/s/AKfycbwYlPLC6LTfWJJrQvnAszjxsactOUaTCkj0cVrzR-0avPOv_o-yQGkzVJ8NGX5xpAt7/exec";
self.REVIEW = "PR #205 @ f18f578";
self.REVIEW_DOSSIER = "203";
if (self.document && !self.BANDEAU_REVIEW) {
	self.BANDEAU_REVIEW = true;
	document.addEventListener("DOMContentLoaded", () => {
		document.title = `[Review] ${document.title}`;
		const bandeau = document.createElement("div");
		// Mesures de l'écran (replis de l'iPhone, voir shared/pwa.js), refaites comme les replis.
		const decrire = () => {
			const sonde = document.createElement("div");
			sonde.style.cssText = "position:fixed;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
			document.body.append(sonde);
			const { paddingTop: zone, paddingBottom: zoneBas } = getComputedStyle(sonde);
			sonde.remove();
			const racine = document.documentElement;
			const mode = matchMedia("(display-mode: standalone)").matches || navigator.standalone ? "installée" : "navigateur";
			const repli = racine.hasAttribute("data-sous-barre-etat") ? "repli" : "sans repli";
			const bas = racine.style.getPropertyValue("--bas-manquant") || "0";
			bandeau.textContent = `Review · ${self.REVIEW} · ${mode} · zone ${zone}/${zoneBas} · ${innerHeight}/${screen.height} · ${repli} · bas ${bas}`;
		};
		decrire();
		for (const evenement of ["load", "pageshow", "resize"]) addEventListener(evenement, decrire);
		setInterval(decrire, 2000);
		bandeau.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:1000;padding:2px 8px;border-radius:6px;background:#b45309;color:#fff;font:12px system-ui,sans-serif;pointer-events:none";
		document.body.append(bandeau);
	});
}
