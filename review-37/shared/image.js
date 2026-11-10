// Réduction d'une photo dans le navigateur, avant de l'envoyer à une API.

/** Dessine l'image réduite dans un canvas (le navigateur applique l'orientation de l'appareil). */
function dessinerReduite(fichier, tailleMaxPx) {
	return new Promise((resoudre, rejeter) => {
		const url = URL.createObjectURL(fichier);
		const image = new Image();
		image.onload = () => {
			const echelle = Math.min(
				1,
				tailleMaxPx / Math.max(image.width, image.height),
			);
			const canvas = document.createElement("canvas");
			canvas.width = Math.round(image.width * echelle);
			canvas.height = Math.round(image.height * echelle);
			canvas
				.getContext("2d")
				.drawImage(image, 0, 0, canvas.width, canvas.height);
			URL.revokeObjectURL(url);
			resoudre(canvas);
		};
		image.onerror = () => {
			URL.revokeObjectURL(url);
			rejeter(new Error("Le navigateur n'arrive pas à lire cette photo."));
		};
		image.src = url;
	});
}

/**
 * Réduit une image.
 * @param tailleMaxPx Le plus grand côté, en pixels
 * @param qualite Qualité JPEG, de 0 à 1
 * @return Son JPEG en base64
 */
export async function reduireImage(fichier, tailleMaxPx, qualite = 0.9) {
	const canvas = await dessinerReduite(fichier, tailleMaxPx);
	return canvas.toDataURL("image/jpeg", qualite).split(",")[1];
}

/**
 * Réduit une image jusqu'à tenir dans une longueur donnée (ex : une cellule de classeur).
 * @param essais Les [plus grand côté en pixels, qualité JPEG] à essayer, du meilleur au plus léger
 * @param longueurMax Le nombre de caractères du base64 à ne pas dépasser
 * @return Son JPEG en base64
 * @throws Si aucun essai ne tient dans cette longueur
 */
export async function reduireImageSous(fichier, essais, longueurMax) {
	for (const [tailleMaxPx, qualite] of essais) {
		const base64 = await reduireImage(fichier, tailleMaxPx, qualite);
		if (base64.length <= longueurMax) return base64;
	}
	throw new Error("Photo trop lourde : choisis-en une autre.");
}
