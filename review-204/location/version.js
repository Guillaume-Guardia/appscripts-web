// Généré par scripts/publier-web.mjs : version de l'app, affichée dans le menu.
self.VERSION_APP = "1.41.0";
self.REVIEW = "PR #207 @ e4fcfc1";
self.REVIEW_DOSSIER = "204";
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
self.EMPREINTE_APP = "90e6bfed04f5";
self.FICHIERS_APP = ["./","app.js","config.js","etat-des-lieux.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","icons/icon.svg","index.html","manifest.webmanifest","signer.html","signer.js","style.css","version.js","../shared/api.js","../shared/balayage.js","../shared/base.css","../shared/biometrie.js","../shared/config.js","../shared/connexion.js","../shared/dates.js","../shared/dom.js","../shared/file-attente.js","../shared/image.js","../shared/profil.js","../shared/pwa.js","../shared/qr.js","../shared/signalement.js","../shared/signature.js","../shared/stockage.js","../shared/vendor/qrcode.min.js","../shared/visite.js"];
