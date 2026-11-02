// Généré par scripts/publier-web.mjs : adresse de l'API de connexion (projet droits).
window.API_DROITS = "https://script.google.com/macros/s/AKfycbwYlPLC6LTfWJJrQvnAszjxsactOUaTCkj0cVrzR-0avPOv_o-yQGkzVJ8NGX5xpAt7/exec";
self.REVIEW = "PR #129 @ 3aa5d1e";
if (self.document && !self.BANDEAU_REVIEW) {
	self.BANDEAU_REVIEW = true;
	document.addEventListener("DOMContentLoaded", () => {
		document.title = `[Review] ${document.title}`;
		const bandeau = document.createElement("div");
		bandeau.textContent = `Review · ${self.REVIEW}`;
		bandeau.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:1000;padding:2px 8px;border-radius:6px;background:#b45309;color:#fff;font:12px system-ui,sans-serif;pointer-events:none";
		document.body.append(bandeau);
	});
}
