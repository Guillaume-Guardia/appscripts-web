// Balayage horizontal du doigt pour passer d'un onglet (ou d'un mois, d'une pièce) au voisin, et
// glissement de la vue qui arrive.

// Balayage horizontal minimal du doigt, en pixels
const BALAYAGE_MIN_PX = 50;
// Un balayage doit être nettement plus horizontal que vertical (sinon c'est un défilement)
const RAPPORT_HORIZONTAL = 1.5;
// Ce qui se manipule au doigt sans changer de vue
const CIBLES_SANS_BALAYAGE =
	"input, textarea, select, canvas, [data-sans-balayage]";

/** Vrai si le doigt part d'un élément qui défile lui-même horizontalement (barre de puces…). */
function defileHorizontalement(cible, zone) {
	for (
		let noeud = cible;
		noeud && noeud !== zone;
		noeud = noeud.parentElement
	) {
		const { overflowX } = getComputedStyle(noeud);
		if (
			(overflowX === "auto" || overflowX === "scroll") &&
			noeud.scrollWidth > noeud.clientWidth
		) {
			return true;
		}
	}
	return false;
}

/**
 * Balayer `zone` vers la gauche appelle `changer(1)` (vue suivante), vers la droite `changer(-1)`
 * (précédente). `changer` renvoie vrai s'il a changé de vue : la vue qui arrive (`anime()`, la
 * zone par défaut) glisse alors du côté d'où elle vient. Un balayage court ou surtout vertical ne
 * compte pas, ni un balayage parti d'un champ, d'un élément qui défile horizontalement ou d'un
 * élément `[data-sans-balayage]`.
 */
export function brancherBalayage(zone, changer, { anime = () => zone } = {}) {
	let depart = null;
	zone.addEventListener(
		"touchstart",
		(evenement) => {
			const cible = evenement.target;
			depart =
				evenement.touches.length === 1 &&
				!cible.closest(CIBLES_SANS_BALAYAGE) &&
				!defileHorizontalement(cible, zone)
					? {
							x: evenement.touches[0].clientX,
							y: evenement.touches[0].clientY,
						}
					: null;
		},
		{ passive: true },
	);
	zone.addEventListener("touchend", (evenement) => {
		if (!depart) return;
		const fin = evenement.changedTouches[0];
		const dx = fin.clientX - depart.x;
		const dy = fin.clientY - depart.y;
		depart = null;
		if (
			Math.abs(dx) < BALAYAGE_MIN_PX ||
			Math.abs(dx) < RAPPORT_HORIZONTAL * Math.abs(dy)
		) {
			return;
		}
		const sens = dx < 0 ? 1 : -1;
		if (changer(sens)) animerArrivee(anime(), sens);
	});
}

/**
 * La vue qui arrive glisse depuis la droite (sens 1 : suivante) ou la gauche (-1 : précédente),
 * sauf si l'appareil demande moins d'animations.
 */
export function animerArrivee(element, sens) {
	if (!element?.animate) return;
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	element.animate(
		[
			{ transform: `translateX(${sens * 40}px)`, opacity: 0.4 },
			{ transform: "none", opacity: 1 },
		],
		{ duration: 200, easing: "ease-out" },
	);
}

/**
 * Le voisin (sens -1 ou 1) de `actuel` dans `ordre`, ou null au bout de la liste.
 */
export function voisin(ordre, actuel, sens) {
	const position = ordre.indexOf(actuel);
	return position < 0 ? null : (ordre[position + sens] ?? null);
}
