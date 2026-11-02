// Calcul d'un investissement locatif, comme le classeur FINANCE_InvestissementImmobilier (onglets
// Achat, Financement, Location ; paramètres de l'onglet DATA). Sans dépendance au navigateur.

/** Paramètres par défaut : ceux de l'onglet DATA du classeur (Brest). */
export const PARAMETRES_DEFAUT = {
	/** Frais de notaire, en % du prix : ancien et neuf. */
	notaireAncien: 7.8,
	notaireNeuf: 4,
	/** Frais d'agence, en % du prix, quand ils ne sont pas saisis. */
	agence: 7.5,
	/** Loyer au m² par mois, quand le loyer n'est pas saisi. */
	loyerM2: 11,
	/** Taxe foncière, en € par m² et par an. */
	taxeFonciereM2: 12,
	/** Charges non récupérables (gestion, copropriété…), en % du loyer. */
	charges: 10,
	/** Assurance propriétaire non occupant, en € par mois. */
	assurancePno: 20,
};

/** Nombre saisi, ou null si le champ est vide ou invalide. */
function nombre(valeur) {
	return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null;
}

/**
 * Mensualité d'un prêt à taux fixe (sans assurance emprunteur).
 * @param capital Montant emprunté
 * @param tauxAnnuel Taux annuel, en %
 * @param mois Nombre de mensualités
 */
export function mensualite(capital, tauxAnnuel, mois) {
	if (capital <= 0 || mois <= 0) return 0;
	const t = tauxAnnuel / 100 / 12;
	if (t === 0) return capital / mois;
	return (capital * t) / (1 - (1 + t) ** -mois);
}

/**
 * Simule un bien.
 * @param saisie { prix, superficie, neuf, fraisAgence, travaux, apport, taux, duree, loyer } :
 * nombres (null si non saisis) ; `fraisAgence` et `loyer` non saisis sont estimés avec les
 * paramètres ; `taux` en %, `duree` en années
 * @param parametres Voir PARAMETRES_DEFAUT
 * @return Montants en € (par mois pour la location et le crédit), rendements en fraction (0,05 =
 * 5 %), null quand ils ne peuvent pas être calculés
 */
export function simuler(saisie, parametres = PARAMETRES_DEFAUT) {
	const p = { ...PARAMETRES_DEFAUT, ...parametres };
	const prix = nombre(saisie.prix) ?? 0;
	const superficie = nombre(saisie.superficie) ?? 0;

	// Achat
	const fraisNotaire =
		(prix * (saisie.neuf ? p.notaireNeuf : p.notaireAncien)) / 100;
	const fraisAgenceSaisis = nombre(saisie.fraisAgence);
	const fraisAgence = fraisAgenceSaisis ?? (prix * p.agence) / 100;
	const travaux = nombre(saisie.travaux) ?? 0;
	const coutTotal = prix + fraisNotaire + fraisAgence + travaux;

	// Financement
	const apport = Math.min(nombre(saisie.apport) ?? 0, coutTotal);
	const emprunt = coutTotal - apport;
	const mois = Math.round((nombre(saisie.duree) ?? 0) * 12);
	const echeance = mensualite(emprunt, nombre(saisie.taux) ?? 0, mois);
	const interets = mois > 0 ? echeance * mois - emprunt : 0;

	// Location (par mois)
	const loyerSaisi = nombre(saisie.loyer);
	const loyer = loyerSaisi ?? superficie * p.loyerM2;
	const taxeFonciere = (superficie * p.taxeFonciereM2) / 12;
	const charges = (loyer * p.charges) / 100;
	const assurance = loyer > 0 ? p.assurancePno : 0;
	const loyerNet = loyer - taxeFonciere - charges - assurance;

	const ratio = (valeur, base) => (base > 0 ? valeur / base : null);
	return {
		prixM2: ratio(prix, superficie),
		fraisNotaire,
		fraisAgence,
		fraisAgenceEstimes: fraisAgenceSaisis === null,
		travaux,
		coutTotal,
		apport,
		emprunt,
		mensualite: echeance,
		interets,
		coutCredit: emprunt + interets,
		// Le classeur demande un revenu de 3 fois la mensualité (taux d'endettement d'un tiers).
		revenuMini: echeance * 3,
		loyer,
		loyerEstime: loyerSaisi === null,
		taxeFonciere,
		charges,
		assurance,
		loyerNet,
		cashFlow: loyerNet - echeance,
		rendementBrut: ratio(loyer * 12, coutTotal),
		rendementNet: ratio(loyerNet * 12, coutTotal),
	};
}
