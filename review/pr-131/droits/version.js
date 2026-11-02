// Généré par scripts/publier-web.mjs : version de l'app, affichée dans le menu.
self.VERSION_APP = "1.7.0";
self.REVIEW = "PR #131 @ 72ff53d";
self.REVIEW_DOSSIER = "pr-131";
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
self.EMPREINTE_APP = "1ebc3a07c7a1";
self.FICHIERS_APP = ["./","app.js","icons/icon.svg","index.html","manifest.webmanifest","style.css","version.js","../shared/api.js","../shared/base.css","../shared/config.js","../shared/connexion.js","../shared/dates.js","../shared/dom.js","../shared/pwa.js","../shared/qr.js","../shared/signalement.js","../shared/stockage.js","../shared/vendor/qrcode.min.js"];
