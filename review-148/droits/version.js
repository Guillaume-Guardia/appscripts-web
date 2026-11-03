// Généré par scripts/publier-web.mjs : version de l'app, affichée dans le menu.
self.VERSION_APP = "1.13.0";
self.REVIEW = "PR #149 @ 1136705";
self.REVIEW_DOSSIER = "148";
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
self.EMPREINTE_APP = "72ad1b6d9485";
self.FICHIERS_APP = ["./","app.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","icons/icon.svg","index.html","manifest.webmanifest","style.css","version.js","../shared/api.js","../shared/base.css","../shared/biometrie.js","../shared/config.js","../shared/connexion.js","../shared/dates.js","../shared/dom.js","../shared/pwa.js","../shared/qr.js","../shared/signalement.js","../shared/stockage.js","../shared/vendor/qrcode.min.js"];
