// Généré par scripts/publier-web.mjs : adresse de l'API de connexion (projet droits).
window.API_DROITS = "https://script.google.com/macros/s/AKfycbwYlPLC6LTfWJJrQvnAszjxsactOUaTCkj0cVrzR-0avPOv_o-yQGkzVJ8NGX5xpAt7/exec";
self.REVIEW = "PR #185 @ 66149d2";
self.REVIEW_DOSSIER = "184";
if (self.document && !self.BANDEAU_REVIEW) {
	self.BANDEAU_REVIEW = true;
	document.addEventListener("DOMContentLoaded", () => {
		document.title = `[Review] ${document.title}`;
		const bandeau = document.createElement("div");
		const sonde = document.createElement("div");
		sonde.style.cssText = "position:fixed;padding-top:env(safe-area-inset-top)";
		document.body.append(sonde);
		const zone = getComputedStyle(sonde).paddingTop;
		sonde.remove();
		const mode = matchMedia("(display-mode: standalone)").matches || navigator.standalone ? "installée" : "navigateur";
		const repli = document.documentElement.hasAttribute("data-sous-barre-etat") ? "repli" : "sans repli";
		bandeau.textContent = `Review · ${self.REVIEW} · ${mode} · zone ${zone} · ${innerHeight}/${screen.height} · ${repli}`;
		bandeau.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:1000;padding:2px 8px;border-radius:6px;background:#b45309;color:#fff;font:12px system-ui,sans-serif;pointer-events:none";
		document.body.append(bandeau);
	});
}
