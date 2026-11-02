// Dates des API : textes « aaaa-mm-jj », lus et écrits en heure locale.

/** Date d'un texte « aaaa-mm-jj », à minuit (heure locale). */
export function versDate(texte) {
	const [annee, mois, jour] = String(texte).split("-").map(Number);
	return new Date(annee, mois - 1, jour);
}

/** « aaaa-mm-jj » d'une date, pour un champ date ou l'API. */
export function versChampDate(date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Aujourd'hui, à minuit. */
export function aujourdhui() {
	const maintenant = new Date();
	return new Date(
		maintenant.getFullYear(),
		maintenant.getMonth(),
		maintenant.getDate(),
	);
}

/** Jours entre deux dates à minuit (arrondi : les changements d'heure ne comptent pas). */
export const joursEntre = (debut, fin) => Math.round((fin - debut) / 86400000);

/** « 1 jour », « 3 jours » */
export const pluriel = (nombre, mot) =>
	`${nombre} ${mot}${nombre > 1 ? "s" : ""}`;
