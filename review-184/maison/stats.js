// Statistiques des objets : calcul seul, l'affichage est dans app.js.

const somme = (valeurs) => valeurs.reduce((total, v) => total + v, 0);

/**
 * @param objets Les objets de l'état ; prixAchat et prixActuel peuvent être null
 * @return Totaux, valeur actuelle par catégorie (décroissante), objets les plus chers, achats par
 * année (croissante). La décote ne compte que les objets dont la valeur actuelle est connue.
 */
export function calculerStats(objets) {
	const valorises = objets.filter((objet) => objet.prixActuel !== null);
	const baseValorisee = somme(valorises.map((objet) => objet.prixAchat));
	const valeurActuelle = somme(valorises.map((objet) => objet.prixActuel));

	const categories = new Map();
	for (const { categorie, prixActuel } of valorises) {
		const nom = categorie || "Sans catégorie";
		const groupe = categories.get(nom) ?? { nom, valeur: 0, nombre: 0 };
		groupe.valeur += prixActuel;
		groupe.nombre += 1;
		categories.set(nom, groupe);
	}

	const annees = new Map();
	for (const { dateAchat, prixAchat } of objets) {
		if (!dateAchat || prixAchat === null) continue;
		const annee = dateAchat.slice(0, 4);
		const groupe = annees.get(annee) ?? { nom: annee, valeur: 0, nombre: 0 };
		groupe.valeur += prixAchat;
		groupe.nombre += 1;
		annees.set(annee, groupe);
	}

	return {
		nombre: objets.length,
		valeurAchat: somme(
			objets.filter((o) => o.prixAchat !== null).map((o) => o.prixAchat),
		),
		valeurActuelle,
		decote: baseValorisee - valeurActuelle,
		partDecote:
			baseValorisee > 0 ? (baseValorisee - valeurActuelle) / baseValorisee : 0,
		aCompleter: objets.length - valorises.length,
		parCategorie: [...categories.values()].sort((a, b) => b.valeur - a.valeur),
		plusChers: [...valorises]
			.sort((a, b) => b.prixActuel - a.prixActuel)
			.slice(0, 5),
		parAnnee: [...annees.values()].sort((a, b) => a.nom.localeCompare(b.nom)),
	};
}
