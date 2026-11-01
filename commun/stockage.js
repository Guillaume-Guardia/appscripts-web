// Stockage local du navigateur. Toutes les apps partagent l'origine guillaume-guardia.github.io,
// donc le même stockage : chaque app préfixe ses clés par son nom (ex : « voyage.etat »).

export function lireStockage(cle) {
	try {
		return localStorage.getItem(cle);
	} catch {
		return null;
	}
}

/** Écrit une valeur ; null ou undefined la supprime. */
export function ecrireStockage(cle, valeur) {
	try {
		if (valeur === null || valeur === undefined) localStorage.removeItem(cle);
		else localStorage.setItem(cle, valeur);
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
