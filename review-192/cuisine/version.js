// Généré par scripts/publier-web.mjs : version de l'app, affichée dans le menu.
self.VERSION_APP = "1.36.0";
self.REVIEW = "PR #193 @ 7ac2286";
self.REVIEW_DOSSIER = "192";
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
self.EMPREINTE_APP = "eb6443bfecdf";
self.FICHIERS_APP = ["./","app.js","config.js","graphiques.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","icons/icon.svg","index.html","manifest.webmanifest","nutrition.js","scanner.js","style.css","version.js","../shared/api.js","../shared/balayage.js","../shared/base.css","../shared/biometrie.js","../shared/config.js","../shared/connexion.js","../shared/dates.js","../shared/dom.js","../shared/file-attente.js","../shared/image.js","../shared/pwa.js","../shared/qr.js","../shared/signalement.js","../shared/signature.js","../shared/stockage.js","../shared/vendor/qrcode.min.js"];
