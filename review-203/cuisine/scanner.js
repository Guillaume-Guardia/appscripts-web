// Lecture d'un code-barres avec la caméra (BarcodeDetector : Chrome et Edge sur Android, pas
// Safari). Sans lui, l'app propose de taper le code.

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

/** Le navigateur sait-il lire un code-barres ? */
export const scannerDisponible = () =>
	"BarcodeDetector" in window && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Filme avec la caméra arrière jusqu'à lire un code-barres, ou jusqu'à la fermeture du dialogue.
 * @param video L'élément qui montre la caméra
 * @param dialogue Le dialogue qui le contient : il est ouvert, puis fermé à la lecture
 * @return Le code lu, ou null (dialogue fermé)
 * @throws Si la caméra est refusée ou absente
 */
export async function scannerCodeBarres(video, dialogue) {
	const formats = (await window.BarcodeDetector.getSupportedFormats()).filter(
		(f) => FORMATS.includes(f),
	);
	const detecteur = new window.BarcodeDetector({ formats });
	const flux = await navigator.mediaDevices.getUserMedia({
		video: { facingMode: "environment" },
		audio: false,
	});
	video.srcObject = flux;
	dialogue.showModal();
	let ouvert = true;
	try {
		await video.play();
		return await new Promise((resoudre) => {
			dialogue.addEventListener(
				"close",
				() => {
					ouvert = false;
					resoudre(null);
				},
				{ once: true },
			);
			const chercher = async () => {
				if (!ouvert) return;
				try {
					const [code] = await detecteur.detect(video);
					if (code?.rawValue) {
						resoudre(code.rawValue);
						return;
					}
				} catch {
					// Image pas encore prête : on réessaie.
				}
				setTimeout(chercher, 250);
			};
			chercher();
		});
	} finally {
		ouvert = false;
		for (const piste of flux.getTracks()) piste.stop();
		video.srcObject = null;
		if (dialogue.open) dialogue.close();
	}
}
