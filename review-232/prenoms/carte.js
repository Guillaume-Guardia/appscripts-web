// Carte à glisser du doigt (ou de la souris), comme dans les applications de rencontre : vers la
// droite pour oui, vers la gauche pour non. La carte suit le doigt et penche ; lâchée au-delà du
// seuil, ou d'un geste vif, elle part hors de l'écran, sinon elle revient au centre.

/** Part de la largeur de la carte au-delà de laquelle elle part. */
const SEUIL = 0.3;
/** Vitesse (pixels par milliseconde) au-delà de laquelle un geste court suffit. */
const VITESSE_VIVE = 0.6;
/** Déplacement minimal avant de suivre le doigt : en deçà, c'est un toucher. */
const DEPLACEMENT_MIN = 6;
/** Inclinaison de la carte par pixel de déplacement, en degrés. */
const INCLINAISON = 0.06;

const moinsDAnimations = () =>
	matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Fait partir la carte d'un côté (bouton, clavier ou fin de glissement), puis appelle `apres`.
 * @param sens 1 vers la droite (oui), -1 vers la gauche (non)
 */
export function lancerCarte(carte, sens, apres) {
	carte.dataset.sens = sens > 0 ? "oui" : "non";
	carte.style.setProperty("--intensite", "1");
	if (moinsDAnimations() || !carte.animate) {
		apres();
		return;
	}
	const depart = carte.style.transform || "none";
	const largeur = carte.offsetWidth || 320;
	carte
		.animate(
			[
				{ transform: depart },
				{
					transform: `translateX(${sens * largeur * 1.5}px) rotate(${sens * 25}deg)`,
					opacity: 0,
				},
			],
			{ duration: 220, easing: "ease-in", fill: "forwards" },
		)
		.finished.then(apres, apres);
}

/**
 * Branche le glissement sur une carte.
 * @param surVote appelée avec "oui" ou "non" une fois la carte partie
 */
export function brancherGlissement(carte, surVote) {
	let depart = null;

	const deplacement = (evenement) => ({
		dx: evenement.clientX - depart.x,
		dy: evenement.clientY - depart.y,
	});

	function suivre(dx, dy) {
		const largeur = carte.offsetWidth || 320;
		carte.style.transform = `translate(${dx}px, ${dy * 0.2}px) rotate(${dx * INCLINAISON}deg)`;
		carte.dataset.sens = dx > 0 ? "oui" : dx < 0 ? "non" : "";
		carte.style.setProperty(
			"--intensite",
			String(Math.min(1, Math.abs(dx) / (largeur * SEUIL))),
		);
	}

	function revenir() {
		carte.classList.add("revient");
		carte.style.transform = "";
		carte.style.setProperty("--intensite", "0");
		carte.dataset.sens = "";
		setTimeout(() => carte.classList.remove("revient"), 200);
	}

	carte.addEventListener("pointerdown", (evenement) => {
		if (evenement.button !== 0 || evenement.target.closest("button")) return;
		depart = {
			x: evenement.clientX,
			y: evenement.clientY,
			temps: evenement.timeStamp,
			suivi: false,
		};
	});
	carte.addEventListener("pointermove", (evenement) => {
		if (!depart) return;
		const { dx, dy } = deplacement(evenement);
		if (!depart.suivi) {
			if (Math.hypot(dx, dy) < DEPLACEMENT_MIN) return;
			// Surtout vertical : c'est un défilement de la page, pas un vote.
			if (Math.abs(dy) > Math.abs(dx)) {
				depart = null;
				return;
			}
			depart.suivi = true;
			carte.setPointerCapture(evenement.pointerId);
			carte.classList.add("tenue");
		}
		suivre(dx, dy);
	});
	const lacher = (evenement) => {
		if (!depart?.suivi) {
			depart = null;
			return;
		}
		const { dx } = deplacement(evenement);
		const duree = Math.max(1, evenement.timeStamp - depart.temps);
		depart = null;
		carte.classList.remove("tenue");
		const largeur = carte.offsetWidth || 320;
		const vif = Math.abs(dx) / duree > VITESSE_VIVE && Math.abs(dx) > 40;
		if (
			evenement.type === "pointerup" &&
			(Math.abs(dx) > largeur * SEUIL || vif)
		) {
			const sens = dx > 0 ? 1 : -1;
			lancerCarte(carte, sens, () => surVote(sens > 0 ? "oui" : "non"));
		} else {
			revenir();
		}
	};
	carte.addEventListener("pointerup", lacher);
	carte.addEventListener("pointercancel", lacher);
}
