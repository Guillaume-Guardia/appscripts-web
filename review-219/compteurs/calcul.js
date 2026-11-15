// Calculs des compteurs : fonctions pures, sans DOM. `maintenant` est toujours passé en paramètre.
// Les dates sont en heure locale ; les jours se comptent de minuit à minuit (calendrier), pour que
// les changements d'heure ne décalent rien.

const SECONDE = 1000;
const MINUTE = 60 * SECONDE;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;
/** Année et mois moyens (365,25 jours), pour exprimer une durée qui n'a pas de date de départ. */
const ANNEE = 365.25 * JOUR;
const MOIS = ANNEE / 12;

/** Date décalée de `n` années (un 29 février devient le 1er mars des années non bissextiles). */
export function ajouterAnnees(date, n) {
	const resultat = new Date(date);
	resultat.setFullYear(date.getFullYear() + n);
	return resultat;
}

/** Date décalée de `n` jours du calendrier, à la même heure. */
export function ajouterJours(date, n) {
	const resultat = new Date(date);
	resultat.setDate(date.getDate() + n);
	return resultat;
}

/** Date décalée de `n` mois du calendrier. */
function ajouterMois(date, n) {
	const resultat = new Date(date);
	resultat.setMonth(date.getMonth() + n);
	return resultat;
}

/** Minuit du jour de `date`. */
function minuit(date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Jours du calendrier de `debut` à `fin` (négatif si `fin` est avant). */
export function joursCalendrier(debut, fin) {
	return Math.round((minuit(fin) - minuit(debut)) / JOUR);
}

/** Âge en années révolues à `date`. */
export function age(naissance, date) {
	let annees = date.getFullYear() - naissance.getFullYear();
	if (ajouterAnnees(naissance, annees) > date) annees--;
	return annees;
}

/** Date de fin : la naissance plus l'espérance de vie (en années). */
export function dateDeFin(naissance, esperance) {
	return ajouterAnnees(naissance, esperance);
}

/**
 * Temps qui reste jusqu'à la date de fin, en années du calendrier puis jours, heures, minutes et
 * secondes. Une fois la date passée, `depasse` est vrai et le temps est celui écoulé depuis.
 */
export function vieRestante(naissance, esperance, maintenant) {
	const fin = dateDeFin(naissance, esperance);
	const depasse = maintenant >= fin;
	const [debut, arrivee] = depasse ? [fin, maintenant] : [maintenant, fin];
	let annees = arrivee.getFullYear() - debut.getFullYear();
	if (ajouterAnnees(debut, annees) > arrivee) annees--;
	// Jours du calendrier, puis l'heure : un changement d'heure ne décale pas l'heure affichée.
	const curseur = ajouterAnnees(debut, annees);
	let jours = joursCalendrier(curseur, arrivee);
	if (ajouterJours(curseur, jours) > arrivee) jours--;
	let reste = arrivee - ajouterJours(curseur, jours);
	const heures = Math.floor(reste / HEURE);
	reste -= heures * HEURE;
	const minutes = Math.floor(reste / MINUTE);
	reste -= minutes * MINUTE;
	return {
		fin,
		depasse,
		annees,
		jours,
		heures,
		minutes,
		secondes: Math.floor(reste / SECONDE),
		totalMs: arrivee - debut,
		joursTotal: Math.abs(joursCalendrier(maintenant, fin)),
		partVecue: Math.min(1, (maintenant - naissance) / (fin - naissance)),
	};
}

/**
 * Grille de la vie en semaines : une ligne par année d'âge, 52 semaines par ligne. `ageAnnees` et
 * `semaine` situent la semaine en cours (semaine 0 : celle de l'anniversaire, 51 au plus).
 */
export function semaines(naissance, esperance, maintenant) {
	const ageAnnees = age(naissance, maintenant);
	const anniversaire = ajouterAnnees(naissance, ageAnnees);
	const semaine = Math.min(
		51,
		Math.floor(joursCalendrier(anniversaire, maintenant) / 7),
	);
	return {
		lignes: esperance,
		ageAnnees,
		semaine,
		vecues: Math.floor(joursCalendrier(naissance, maintenant) / 7),
		total: esperance * 52,
	};
}

/**
 * Temps passé à une activité de `minutesParJour`, de l'âge `ageDebut` à `ageFin` (la fin de vie si
 * vide) : déjà passé, encore à passer d'ici la fin, et part de toute la vie.
 */
export function tempsActivite(
	{ minutesParJour, ageDebut = 0, ageFin = null },
	naissance,
	esperance,
	maintenant,
) {
	const finVie = dateDeFin(naissance, esperance);
	const debut = ajouterAnnees(naissance, Math.max(0, ageDebut));
	const fin =
		ageFin === null || ageFin === undefined || ageFin === ""
			? finVie
			: new Date(Math.min(ajouterAnnees(naissance, ageFin), finVie));
	if (fin <= debut) return { passeMs: 0, restantMs: 0, totalMs: 0, part: 0 };
	const parMs = minutesParJour / (24 * 60);
	const borne = (date) => new Date(Math.min(Math.max(date, debut), fin));
	const passeMs = (borne(maintenant) - debut) * parMs;
	const restantMs = (fin - borne(maintenant)) * parMs;
	return {
		passeMs,
		restantMs,
		totalMs: passeMs + restantMs,
		part: (passeMs + restantMs) / (finVie - naissance),
	};
}

/** Nombre de jours de la semaine `jour` (0 : dimanche, 6 : samedi) dans [debut, fin[. */
function compterJourSemaine(debut, fin, jour) {
	const jours = joursCalendrier(debut, fin);
	if (jours <= 0) return 0;
	const decalage = (jour - minuit(debut).getDay() + 7) % 7;
	return decalage >= jours ? 0 : Math.floor((jours - decalage - 1) / 7) + 1;
}

/** Nombre de dates annuelles (mois 0 à 11, jour) dans [debut, fin[. */
function compterDatesAnnuelles(debut, fin, mois, jour) {
	let nombre = 0;
	for (let annee = debut.getFullYear(); annee <= fin.getFullYear(); annee++) {
		const date = new Date(annee, mois, jour);
		if (date >= debut && date < fin) nombre++;
	}
	return nombre;
}

/** Nombre d'étés (21 juin au 22 septembre) entamés avant `fin` et pas encore finis à `debut`. */
function compterEtes(debut, fin) {
	let nombre = 0;
	for (let annee = debut.getFullYear(); annee <= fin.getFullYear(); annee++) {
		if (new Date(annee, 8, 23) > debut && new Date(annee, 5, 21) < fin) {
			nombre++;
		}
	}
	return nombre;
}

/**
 * Ce qui reste à vivre d'ici la fin, et ce qui est déjà vécu : week-ends (samedis), étés, Noëls,
 * anniversaires ; jours avant la retraite.
 */
export function restants(naissance, esperance, ageRetraite, maintenant) {
	const fin = dateDeFin(naissance, esperance);
	const aujourdhui = minuit(maintenant);
	const lendemainNaissance = ajouterJours(naissance, 1);
	const retraite = ajouterAnnees(naissance, ageRetraite);
	const compte = (compter) => ({
		vecus: compter(naissance, aujourdhui),
		restants: aujourdhui < fin ? compter(aujourdhui, fin) : 0,
	});
	return {
		jours: Math.max(0, joursCalendrier(aujourdhui, fin)),
		weekends: compte((debut, arrivee) => compterJourSemaine(debut, arrivee, 6)),
		etes: {
			vecus:
				compterEtes(naissance, aujourdhui) - (estEnEte(aujourdhui) ? 1 : 0),
			restants: aujourdhui < fin ? compterEtes(aujourdhui, fin) : 0,
		},
		noels: compte((debut, arrivee) =>
			compterDatesAnnuelles(debut, arrivee, 11, 25),
		),
		anniversaires: {
			vecus: compterDatesAnnuelles(
				lendemainNaissance,
				aujourdhui,
				naissance.getMonth(),
				naissance.getDate(),
			),
			restants:
				aujourdhui < fin
					? compterDatesAnnuelles(
							aujourdhui,
							fin,
							naissance.getMonth(),
							naissance.getDate(),
						)
					: 0,
		},
		retraite: {
			date: retraite,
			jours: joursCalendrier(aujourdhui, retraite),
		},
	};
}

/** L'été en cours compte dans les étés restants, pas dans les étés vécus. */
function estEnEte(date) {
	const annee = date.getFullYear();
	return date >= new Date(annee, 5, 21) && date < new Date(annee, 8, 23);
}

/**
 * Caps de la vie (âge en jours, semaines, mois ou secondes), triés par date, jusqu'à la fin de vie
 * prévue ; `passe` : déjà atteint.
 */
export function caps(naissance, esperance, maintenant) {
	const fin = dateDeFin(naissance, esperance);
	const liste = [
		...[5000, 10000, 15000, 20000, 25000, 30000].map((n) => ({
			nom: `${nombre(n)} jours`,
			date: ajouterJours(naissance, n),
		})),
		...[1000, 2000, 3000, 4000].map((n) => ({
			nom: `${nombre(n)} semaines`,
			date: ajouterJours(naissance, 7 * n),
		})),
		...[500, 1000].map((n) => ({
			nom: `${nombre(n)} mois`,
			date: ajouterMois(naissance, n),
		})),
		...[1, 2].map((n) => ({
			nom: `${n} milliard${n > 1 ? "s" : ""} de secondes`,
			date: new Date(naissance.getTime() + n * 1e9 * SECONDE),
		})),
	];
	return liste
		.filter((cap) => cap.date <= fin)
		.sort((a, b) => a.date - b.date)
		.map((cap) => ({ ...cap, passe: cap.date <= maintenant }));
}

/** Nombre avec les espaces des milliers (« 10 000 »). */
export function nombre(n, decimales = 0) {
	return new Intl.NumberFormat("fr-FR", {
		maximumFractionDigits: decimales,
	}).format(n);
}

/** Pourcentage (« 37,4 % ») d'une part de 0 à 1. */
export function pourcent(part, decimales = 1) {
	return new Intl.NumberFormat("fr-FR", {
		style: "percent",
		maximumFractionDigits: decimales,
	}).format(part);
}

const UNITES = [
	{ ms: ANNEE, un: "an", plusieurs: "ans" },
	{ ms: MOIS, un: "mois", plusieurs: "mois" },
	{ ms: JOUR, un: "jour", plusieurs: "jours" },
	{ ms: HEURE, un: "h", plusieurs: "h" },
	{ ms: MINUTE, un: "min", plusieurs: "min" },
];

/**
 * Durée en mots, sur ses `precision` plus grandes unités, sans les unités vides (« 1 an 2 mois »,
 * « 5 mois », « 3 h 20 min »). Moins d'une minute : « 0 min ».
 */
export function formaterDuree(ms, precision = 2) {
	let reste = Math.max(0, ms);
	const premiere = UNITES.findIndex((unite) => reste >= unite.ms);
	if (premiere === -1) return "0 min";
	const morceaux = [];
	for (const unite of UNITES.slice(premiere, premiere + precision)) {
		const valeur = Math.floor(reste / unite.ms);
		reste -= valeur * unite.ms;
		if (valeur > 0) {
			morceaux.push(`${valeur} ${valeur > 1 ? unite.plusieurs : unite.un}`);
		}
	}
	return morceaux.join(" ");
}

/** Durée d'une activité par jour, en minutes, en mots (« 20 min », « 1 h 30 », « 8 h »). */
export function formaterParJour(minutes) {
	const heures = Math.floor(minutes / 60);
	const reste = Math.round(minutes - heures * 60);
	if (heures === 0) return `${reste} min`;
	return reste
		? `${heures} h ${String(reste).padStart(2, "0")}`
		: `${heures} h`;
}
