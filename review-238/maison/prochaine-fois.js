// Date du prochain entretien, affichée dans le formulaire pendant la saisie. Même calcul que l'API
// (projets/maison, calculer-prochaine-fois.ts) : une fréquence décimale est arrondie au jour
// (jours et semaines) ou au mois (mois et années).

function ajouterJours(date, jours) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + jours);
}

/** Le jour est ramené au dernier du mois d'arrivée s'il n'existe pas (31 janvier → 28 février). */
function ajouterMois(date, mois) {
	const arrivee = new Date(date.getFullYear(), date.getMonth() + mois, 1);
	const dernierJour = new Date(
		arrivee.getFullYear(),
		arrivee.getMonth() + 1,
		0,
	).getDate();
	arrivee.setDate(Math.min(date.getDate(), dernierJour));
	return arrivee;
}

/** La date une fréquence après `derniereFois`. */
export function calculerProchaineFois(derniereFois, frequence, unite) {
	if (unite === "jour") {
		return ajouterJours(derniereFois, Math.round(frequence));
	}
	if (unite === "semaine") {
		return ajouterJours(derniereFois, Math.round(frequence * 7));
	}
	if (unite === "mois") return ajouterMois(derniereFois, Math.round(frequence));
	return ajouterMois(derniereFois, Math.round(frequence * 12));
}
