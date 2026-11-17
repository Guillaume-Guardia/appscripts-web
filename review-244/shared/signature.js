// Pavé de signature : la personne signe au doigt (ou à la souris) dans un canvas, exporté en PNG
// transparent. Le trait est noir quel que soit le thème, pour un document imprimé sur fond blanc.

const EPAISSEUR_TRAIT = 2.5;
const RESOLUTION_MAX = 2;

/**
 * Branche un pavé de signature sur un canvas. Le canvas garde sa taille CSS : sa résolution suit
 * celle de l'écran (2 au plus, pour une image légère), et il est vidé quand sa taille change.
 * @param canvas Le canvas, dont la page fixe la largeur et la hauteur en CSS
 * @param surChangement Appelée après chaque trait et chaque effacement
 * @return { effacer, estVide, versPng } ; versPng : le PNG en base64, sans le préfixe data:
 */
export function creerPaveSignature(canvas, surChangement = () => {}) {
	const contexte = canvas.getContext("2d");
	let vide = true;
	let precedent = null;

	function dimensionner() {
		const echelle = Math.min(window.devicePixelRatio || 1, RESOLUTION_MAX);
		const { width, height } = canvas.getBoundingClientRect();
		canvas.width = Math.round(width * echelle);
		canvas.height = Math.round(height * echelle);
		contexte.setTransform(echelle, 0, 0, echelle, 0, 0);
		contexte.lineWidth = EPAISSEUR_TRAIT;
		contexte.lineCap = "round";
		contexte.lineJoin = "round";
		contexte.strokeStyle = "#000";
		vide = true;
	}

	function point(evenement) {
		const cadre = canvas.getBoundingClientRect();
		return {
			x: evenement.clientX - cadre.left,
			y: evenement.clientY - cadre.top,
		};
	}

	canvas.style.touchAction = "none";
	canvas.addEventListener("pointerdown", (evenement) => {
		canvas.setPointerCapture(evenement.pointerId);
		precedent = point(evenement);
		contexte.beginPath();
		contexte.arc(precedent.x, precedent.y, EPAISSEUR_TRAIT / 2, 0, 2 * Math.PI);
		contexte.fillStyle = "#000";
		contexte.fill();
	});
	canvas.addEventListener("pointermove", (evenement) => {
		if (!precedent) return;
		const actuel = point(evenement);
		contexte.beginPath();
		contexte.moveTo(precedent.x, precedent.y);
		contexte.lineTo(actuel.x, actuel.y);
		contexte.stroke();
		precedent = actuel;
	});
	const terminer = () => {
		if (!precedent) return;
		precedent = null;
		vide = false;
		surChangement();
	};
	canvas.addEventListener("pointerup", terminer);
	canvas.addEventListener("pointercancel", terminer);
	new ResizeObserver(() => {
		const etaitVide = vide;
		dimensionner();
		if (!etaitVide) surChangement();
	}).observe(canvas);
	dimensionner();

	return {
		effacer() {
			contexte.clearRect(0, 0, canvas.width, canvas.height);
			vide = true;
			surChangement();
		},
		estVide: () => vide,
		versPng: () => canvas.toDataURL("image/png").split(",")[1],
	};
}
