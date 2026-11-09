// Réduction d'une photo dans le navigateur, avant de l'envoyer à une API.

/**
 * Réduit une image (le navigateur applique l'orientation de l'appareil).
 * @param tailleMaxPx Le plus grand côté, en pixels
 * @param qualite Qualité JPEG, de 0 à 1
 * @return Son JPEG en base64
 */
export function reduireImage(fichier, tailleMaxPx, qualite = 0.9) {
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
			resoudre(canvas.toDataURL("image/jpeg", qualite).split(",")[1]);
		};
		image.onerror = () => {
			URL.revokeObjectURL(url);
			rejeter(new Error("Le navigateur n'arrive pas à lire cette photo."));
		};
		image.src = url;
	});
}
