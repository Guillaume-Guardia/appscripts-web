// Stockage local du navigateur. Toutes les apps partagent l'origine guillaume-guardia.github.io,
// donc le même stockage : chaque app préfixe ses clés par son nom (ex : « voyage.etat »). Les fronts
// de review (sous review/, REVIEW défini par version.js ou shared/config.js) préfixent en plus
// toutes leurs clés : ni la session ni les données de la production ne sont touchées.

const PREFIXE = globalThis.REVIEW ? "review:" : "";

export function lireStockage(cle) {
	try {
		return localStorage.getItem(PREFIXE + cle);
	} catch {
		return null;
	}
}

/** Écrit une valeur ; null ou undefined la supprime. */
export function ecrireStockage(cle, valeur) {
	try {
		if (valeur === null || valeur === undefined)
			localStorage.removeItem(PREFIXE + cle);
		else localStorage.setItem(PREFIXE + cle, valeur);
	} catch {
		// Stockage indisponible (navigation privée) : l'app marche, sans se souvenir.
	}
}

/** Valeur JSON, ou null si elle manque ou est illisible. */
export function lireStockageJson(cle) {
	try {
		return JSON.parse(lireStockage(cle) || "null");
	} catch {
		return null;
	}
}
