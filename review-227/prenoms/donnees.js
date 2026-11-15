// Prénoms de l'INSEE (donnees/prenoms.json, préparé par scripts/preparer-prenoms.mjs) : lecture,
// filtres de la sélection et pile des cartes à voter.

import { normaliser } from "../shared/dom.js";

/** Naissances de la dernière année au-delà desquelles un prénom est courant, ou en deçà rare. */
const SEUILS_POPULARITE = { courant: 1000, rare: 100 };
/** Variation sur 5 ans (en %) au-delà de laquelle un prénom est en hausse ou en baisse. */
const SEUIL_TENDANCE = 20;
/** Année de pic à partir de laquelle un prénom est récent (sinon classique). */
const ANNEE_RECENTE = 2000;

/** Clé d'un prénom : son sexe et son texte sans accents ni casse (comme l'API). */
export const clePrenom = (prenom, sexe) => `${sexe}|${normaliser(prenom)}`;

/** Les filtres par défaut : tout. */
export const FILTRES_PAR_DEFAUT = {
	sexe: "",
	popularites: [],
	tendance: "",
	periode: "",
	initiales: "",
	longueurMin: null,
	longueurMax: null,
};

let chargement = null;

/**
 * Les prénoms, lus une fois : { edition, debut, pas, source, liste, parCle }. Chaque prénom :
 * { cle, prenom, sexe, total, derniere, rang, tendance (en %, null : nouveau), courbe, fetes,
 * popularite (« rare », « moyen », « courant »), sens (« hausse », « stable », « baisse »),
 * periode (« recent », « classique »), anneePic, longueur, initiale }.
 */
export function chargerPrenoms() {
	chargement ??= fetch("donnees/prenoms.json")
		.then((reponse) => {
			if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
			return reponse.json();
		})
		.then(({ prenoms, ...entete }) => {
			const liste = prenoms.map((ligne) => decrire(ligne, entete));
			return {
				...entete,
				liste,
				parCle: new Map(liste.map((p) => [p.cle, p])),
			};
		})
		.catch((erreur) => {
			chargement = null;
			throw new Error(
				`Les prénoms n'ont pas pu être chargés (${erreur.message}).`,
			);
		});
	return chargement;
}

function decrire(
	[prenom, sexe, total, derniere, rang, tendance, courbe, fetes],
	{ debut, pas },
) {
	const pic = courbe.indexOf(Math.max(...courbe));
	const anneePic = debut + pic * pas;
	const lettres = prenom.replace(/[^\p{L}]/gu, "");
	return {
		cle: clePrenom(prenom, sexe),
		prenom,
		sexe,
		total,
		derniere,
		rang,
		tendance,
		courbe,
		fetes,
		popularite:
			derniere >= SEUILS_POPULARITE.courant
				? "courant"
				: derniere >= SEUILS_POPULARITE.rare
					? "moyen"
					: "rare",
		sens:
			tendance === null || tendance >= SEUIL_TENDANCE
				? "hausse"
				: tendance <= -SEUIL_TENDANCE
					? "baisse"
					: "stable",
		periode: anneePic >= ANNEE_RECENTE ? "recent" : "classique",
		anneePic,
		longueur: lettres.length,
		initiale: normaliser(lettres[0] ?? ""),
	};
}

/**
 * Prénom ajouté à la main (absent de la base) : mêmes champs, sans statistiques.
 */
export function prenomAjoute(prenom, sexe) {
	const lettres = prenom.replace(/[^\p{L}]/gu, "");
	return {
		cle: clePrenom(prenom, sexe),
		prenom,
		sexe,
		total: 0,
		derniere: 0,
		rang: 0,
		tendance: null,
		courbe: [],
		fetes: [],
		popularite: "rare",
		sens: "",
		periode: "",
		anneePic: null,
		longueur: lettres.length,
		initiale: normaliser(lettres[0] ?? ""),
		ajoute: true,
	};
}

/** Initiales d'un filtre : « a, L é » → ["a", "l", "e"]. */
const lireInitiales = (texte) =>
	[...normaliser(texte ?? "")].filter((lettre) => /\p{L}/u.test(lettre));

/**
 * Le prénom passe-t-il les filtres ? Le sexe du projet, s'il est connu, prime sur celui du filtre.
 * Un prénom ajouté à la main n'est filtré que par son sexe, ses initiales et sa longueur.
 */
export function passeLesFiltres(prenom, filtres, sexeProjet) {
	const sexe = sexeProjet || filtres.sexe;
	if (sexe && prenom.sexe !== sexe) return false;
	const initiales = lireInitiales(filtres.initiales);
	if (initiales.length && !initiales.includes(prenom.initiale)) return false;
	if (filtres.longueurMin && prenom.longueur < filtres.longueurMin) {
		return false;
	}
	if (filtres.longueurMax && prenom.longueur > filtres.longueurMax) {
		return false;
	}
	if (prenom.ajoute) return true;
	if (
		filtres.popularites.length &&
		!filtres.popularites.includes(prenom.popularite)
	) {
		return false;
	}
	if (filtres.tendance && prenom.sens !== filtres.tendance) return false;
	if (filtres.periode && prenom.periode !== filtres.periode) return false;
	return true;
}

/**
 * Nouvelle pile de cartes : les prénoms ajoutés d'abord, puis ceux de la base au hasard, les plus
 * donnés plus souvent en haut (tirage pondéré par la racine des naissances : les prénoms courants,
 * d'aujourd'hui ou d'autrefois, sortent surtout au début, sans faire disparaître les rares).
 * @param candidats Les prénoms à voter (filtrés, pas encore votés)
 * @return Les clés, de la première carte à la dernière
 */
export function melanger(candidats, aleatoire = Math.random) {
	const poids = (p) => Math.sqrt(p.derniere + p.total / 200 + 5);
	return candidats
		.map((p) => ({
			cle: p.cle,
			ordre: p.ajoute ? 2 : aleatoire() ** (1 / poids(p)),
		}))
		.sort((a, b) => b.ordre - a.ordre)
		.map((p) => p.cle);
}

/**
 * Prénoms de la base qui commencent par la recherche (sans accents ni casse), les plus donnés
 * d'abord.
 */
export function chercherPrenoms(liste, recherche, max = 30) {
	const texte = normaliser(recherche);
	if (!texte) return [];
	return liste
		.filter((p) => normaliser(p.prenom).startsWith(texte))
		.slice(0, max);
}
