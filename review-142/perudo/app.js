import { $ } from "../shared/dom.js";
import {
	brancherInstallation,
	chercherMiseAJour,
	enregistrerServiceWorker,
} from "../shared/pwa.js";
import { ouvrirSignalement } from "../shared/signalement.js";
import { ecrireStockage, lireStockageJson } from "../shared/stockage.js";
import {
	auMoins,
	bascule,
	chanceFace,
	compterChezMoi,
	desCaches,
	exactement,
	loiBinomiale,
	surencheres,
} from "./calcul.js";

// ---------------------------------------------------------------------------
// État de l'app : tout est calculé sur le téléphone, rien n'est envoyé.
// ---------------------------------------------------------------------------

const CLE = "perudo.partie";
/** Clé de l'ancienne app (guillaume-guardia.github.io/perudo/, même origine) : sa partie est reprise. */
const ANCIENNE_CLE = "arbre-perudo-v1";
const MAX_DES = 60;
const MES_DES_MAX = 5;

const PARTIE_DEPART = {
	total: 20,
	mesDes: [4, 4, 1, 6, 2],
	quantite: 6,
	face: 4,
	palifico: false,
	/** Plus que 2 joueurs : calza interdite. */
	duel: false,
};

function lirePartie() {
	const partie = lireStockageJson(CLE);
	if (partie && Array.isArray(partie.mesDes)) {
		return { ...PARTIE_DEPART, ...partie };
	}
	const ancienne = lireStockageJson(ANCIENNE_CLE);
	if (ancienne && Array.isArray(ancienne.mine)) {
		return {
			...PARTIE_DEPART,
			total: ancienne.total,
			mesDes: ancienne.mine,
			quantite: ancienne.q,
			face: ancienne.f,
			palifico: ancienne.pal,
			duel: ancienne.duel,
		};
	}
	return { ...PARTIE_DEPART };
}

const partie = lirePartie();

// ---------------------------------------------------------------------------
// Affichage (HTML construit à partir de nombres seulement, rien de saisi)
// ---------------------------------------------------------------------------

/** Points allumés de chaque face, dans une grille de 3 × 3. */
const POINTS = {
	1: [4],
	2: [2, 6],
	3: [2, 4, 6],
	4: [0, 2, 6, 8],
	5: [0, 2, 4, 6, 8],
	6: [0, 2, 3, 5, 6, 8],
};

const nomFace = (face) => (face === 1 ? "paco" : String(face));

function de(face, classe = "") {
	const points = Array.from(
		{ length: 9 },
		(_, i) => `<i class="${POINTS[face].includes(i) ? "point" : ""}"></i>`,
	).join("");
	return `<span class="de ${face === 1 ? "paco" : ""} ${classe}" role="img" aria-label="${nomFace(face)}">${points}</span>`;
}

const enchere = (quantite, face) =>
	`<span class="enchere">${quantite} ×&nbsp;${de(face, "petit")}</span>`;

function pourcent(p) {
	if (p <= 0) return "0 %";
	if (p >= 1) return "100 %";
	if (p < 0.005) return "< 1 %";
	if (p > 0.995) return "> 99 %";
	return `${Math.round(p * 100)} %`;
}

const crans = (n) => `${n} cran${n > 1 ? "s" : ""}`;
const pastilleMeilleur = `<span class="pastille">meilleur coup</span>`;

function noeud({ quoi, proba, pourquoi, classe = "", couleur, pastille = "" }) {
	const sansProba = proba === undefined;
	return `<div class="noeud ${classe}"><div class="quoi">${quoi}${pastille}</div>${
		sansProba
			? "<span></span>"
			: `<span class="proba">${pourcent(proba)}</span>`
	}${pourquoi ? `<div class="pourquoi">${pourquoi}</div>` : ""}${
		sansProba
			? ""
			: `<div class="jauge-proba"><span style="width:${(proba * 100).toFixed(1)}%;background:${couleur}"></span></div>`
	}</div>`;
}

/** Ramène la partie dans les bornes : assez de dés pour les miens, enchère possible. */
function borner() {
	partie.total = Math.max(partie.total, partie.mesDes.length, 1);
	partie.quantite = Math.min(Math.max(partie.quantite, 1), partie.total);
}

function afficherTable() {
	const caches = desCaches(partie);
	$("#total").textContent = partie.total;
	$("#caches").textContent =
		`${caches} caché${caches > 1 ? "s" : ""} chez les autres`;
	$("#palifico").checked = partie.palifico;
	$("#duel").checked = partie.duel;
	$("#quantite").textContent = partie.quantite;
	$("#mes-des").innerHTML = Array.from({ length: MES_DES_MAX }, (_, i) =>
		partie.mesDes[i]
			? `<button type="button" class="emplacement rempli" data-retrait="${i}" aria-label="Retirer ce dé">${de(partie.mesDes[i], "grand")}</button>`
			: `<span class="emplacement"></span>`,
	).join("");
	$("#ajout-des").innerHTML = [1, 2, 3, 4, 5, 6]
		.map(
			(g) =>
				`<button type="button" data-ajout="${g}" aria-label="Ajouter un ${nomFace(g)}">${de(g)}</button>`,
		)
		.join("");
	$("#choix-face").innerHTML = [1, 2, 3, 4, 5, 6]
		.map(
			(g) =>
				`<button type="button" data-face="${g}" aria-pressed="${g === partie.face}" aria-label="Face ${nomFace(g)}">${de(g)}</button>`,
		)
		.join("");
}

/** Meilleur coup : Dudo, Calza (sauf à 2 joueurs) ou la surenchère la plus sûre. */
function meilleurCoup(pDudo, pPile, meilleureSurenchere) {
	const options = [
		{ coup: "dudo", proba: pDudo },
		...(partie.duel ? [] : [{ coup: "calza", proba: pPile }]),
		...(meilleureSurenchere
			? [{ coup: "surenchere", proba: meilleureSurenchere.proba }]
			: []),
	].sort((a, b) => b.proba - a.proba);
	return options[0];
}

function afficherVerdict(meilleur, pVraie, pDudo, pPile, meilleureSurenchere) {
	const titres = {
		dudo: "Dudo !",
		calza: "Calza !",
		surenchere: "Surenchéris",
	};
	const couleur = meilleur.coup === "dudo" ? "var(--mauvais)" : "var(--bon)";
	$("#annonce").innerHTML =
		`<span class="coup" style="color:${couleur}">${titres[meilleur.coup]}</span>${
			meilleur.coup === "surenchere"
				? `${enchere(meilleureSurenchere.quantite, meilleureSurenchere.face)}<span class="aide">tient à ${pourcent(meilleureSurenchere.proba)}</span>`
				: `<span class="aide">réussit à ${pourcent(meilleur.proba)}</span>`
		}`;
	$("#stats").innerHTML = [
		["Enchère vraie", pourcent(pVraie)],
		["Dudo gagne", pourcent(pDudo)],
		["Pile (calza)", partie.duel ? "interdite" : pourcent(pPile)],
	]
		.map(
			([libelle, valeur]) =>
				`<div class="stat"><div class="libelle">${libelle}</div><div class="valeur">${valeur}</div></div>`,
		)
		.join("");
}

function texteBascule(limite) {
	const { quantite, face } = partie;
	const ecart = limite - quantite;
	if (limite === 0) {
		return `Aucune enchère sur cette face ne tient une fois sur deux : Dudo dès ${enchere(1, face)}.`;
	}
	if (ecart > 0) {
		return `L'enchère tient encore. Il reste ${crans(ecart)} avant ${enchere(limite + 1, face)}, où Dudo devient favorable.`;
	}
	if (ecart === 0) {
		return `Tu es pile sur la bascule : la prochaine sur cette face, ${enchere(limite + 1, face)}, est à Dudo.`;
	}
	return `Bascule dépassée de ${crans(-ecart)} : Dudo est favorable depuis ${enchere(limite + 1, face)}.`;
}

function afficherBascule(limite) {
	const { quantite, face } = partie;
	const longueur = Math.min(partie.total, Math.max(quantite, limite + 1) + 2);
	const jauge = Array.from(
		{ length: longueur },
		(_, i) =>
			`<span class="${i + 1 > limite ? "depasse" : ""} ${i + 1 === quantite ? "actuel" : ""}" title="${i + 1}"></span>`,
	).join("");
	$("#bascule").innerHTML = `<span class="etiquette">Point de bascule</span>${
		limite ? enchere(limite, face) : ""
	}<span>${texteBascule(limite)}</span><div class="jauge" aria-hidden="true">${jauge}</div>`;
}

function afficherArbre(meilleur, pDudo, pPile, liste) {
	const { quantite, face } = partie;
	const chezMoi = compterChezMoi(partie, face);
	const caches = desCaches(partie);
	const manquants = Math.max(quantite - chezMoi, 0);
	const nomPluriel = face === 1 ? "pacos" : String(face);
	const indexBascule = liste.findIndex((s) => s.proba < 0.5);
	const separateur = `<li class="separateur"><div class="ligne-bascule">Point de bascule : en dessous, Dudo devient favorable</div></li>`;
	const surenchereEnTete = meilleur.coup === "surenchere";
	const items = liste.length
		? liste
				.map((s, i) => {
					const enTete = surenchereEnTete && i === 0;
					const moyenne =
						compterChezMoi(partie, s.face) +
						caches * chanceFace(partie, s.face);
					return `${i === indexBascule ? separateur : ""}<li>${noeud({
						quoi: enchere(s.quantite, s.face),
						proba: s.proba,
						couleur: s.proba >= 0.5 ? "var(--bon)" : "var(--mauvais)",
						pourquoi: `j'en ai ${compterChezMoi(partie, s.face)}, moyenne attendue ${moyenne.toFixed(1)}`,
						classe: enTete ? "meilleur" : "",
						pastille: enTete ? pastilleMeilleur : "",
					})}</li>`;
				})
				.join("")
		: `<li>${noeud({ quoi: "Aucune surenchère possible" })}</li>`;
	const dudo = noeud({
		quoi: "<b>Dudo</b>",
		proba: pDudo,
		couleur: "var(--mauvais)",
		pourquoi: `gagne s'il y a moins de ${quantite} ${nomPluriel}`,
		classe: meilleur.coup === "dudo" ? "meilleur" : "",
		pastille: meilleur.coup === "dudo" ? pastilleMeilleur : "",
	});
	const calza = partie.duel
		? noeud({
				quoi: "<b>Calza</b>",
				classe: "interdit",
				pastille: `<span class="pastille mauvaise">interdite à 2</span>`,
				pourquoi: `il n'y aurait eu exactement ${quantite} qu'à ${pourcent(pPile)}`,
			})
		: noeud({
				quoi: "<b>Calza</b>",
				proba: pPile,
				couleur: "var(--accent)",
				pourquoi: `gagne s'il y en a exactement ${quantite} (on récupère un dé)`,
				classe: meilleur.coup === "calza" ? "meilleur" : "",
				pastille: meilleur.coup === "calza" ? pastilleMeilleur : "",
			});
	const groupe = noeud({
		quoi: "Surenchérir",
		classe: "groupe",
		pourquoi: partie.palifico
			? "en palifico, seule la quantité monte"
			: "plus petites surenchères légales, de la plus sûre à la plus risquée",
	});
	$("#arbre").innerHTML = `${noeud({
		quoi: `Enchère : ${enchere(quantite, face)}`,
		pourquoi: `J'en ai ${chezMoi}. Il en faut ${manquants} de plus parmi ${caches} dés cachés.`,
		classe: "racine",
	})}<ul><li>${dudo}</li><li>${calza}</li><li>${groupe}<ul>${items}</ul></li></ul>`;
}

function afficherDistribution(limite) {
	const { quantite, face } = partie;
	const chezMoi = compterChezMoi(partie, face);
	const caches = desCaches(partie);
	const loi = loiBinomiale(caches, chanceFace(partie, face));
	// Les quantités presque impossibles au-delà de l'enchère ne sont pas affichées.
	let kMax = chezMoi + caches;
	while (kMax > quantite && kMax > chezMoi && loi[kMax - chezMoi] < 0.002) {
		kMax--;
	}
	const quantites = [];
	for (let k = chezMoi; k <= kMax; k++) quantites.push(k);
	const pic = Math.max(...quantites.map((k) => loi[k - chezMoi]));
	$("#face-distribution").innerHTML = de(face, "petit");
	$("#graphique").innerHTML = quantites
		.map((k) => {
			const p = loi[k - chezMoi];
			const hauteur = ((p / pic) * 100).toFixed(1);
			const classes = [
				k >= quantite ? "tient" : "",
				k === quantite ? "pile" : "",
				k === limite ? "limite" : "",
			].join(" ");
			return `<div class="colonne ${classes}" title="${k} : ${pourcent(p)}">${
				p / pic > 0.12
					? `<span class="valeur-colonne" style="bottom:calc(${hauteur}% + 3px)">${Math.round(p * 100)}</span>`
					: ""
			}<div class="remplissage" style="height:${hauteur}%"></div></div>`;
		})
		.join("");
	const pas = quantites.length > 18 ? 2 : 1;
	$("#axe").innerHTML = quantites
		.map(
			(k, i) =>
				`<span class="${k === quantite ? "actuelle" : ""}">${k === quantite || i % pas === 0 ? k : ""}</span>`,
		)
		.join("");
}

function afficherReperes() {
	const caches = desCaches(partie);
	$("#reperes").innerHTML = [1, 2, 3, 4, 5, 6]
		.map((g) => {
			let sur70 = 0;
			let sur50 = 0;
			for (let k = 1; k <= partie.total; k++) {
				const p = auMoins(partie, k, g);
				if (p >= 0.7) sur70 = k;
				if (p >= 0.5) sur50 = k;
			}
			const chezMoi = compterChezMoi(partie, g);
			const moyenne = chezMoi + caches * chanceFace(partie, g);
			return `<tr class="${g === partie.face ? "actuelle" : ""}"><td>${de(g, "petit")}</td><td>${chezMoi}</td><td>${moyenne.toFixed(1)}</td><td>${sur70 || "–"}</td><td>${sur50 || "–"}</td></tr>`;
		})
		.join("");
}

function afficher() {
	borner();
	const { quantite, face } = partie;
	const pVraie = auMoins(partie, quantite, face);
	const pPile = exactement(partie, quantite, face);
	const pDudo = 1 - pVraie;
	const liste = surencheres(partie, quantite, face);
	const meilleur = meilleurCoup(pDudo, pPile, liste[0]);
	const limite = bascule(partie, face);

	afficherTable();
	afficherVerdict(meilleur, pVraie, pDudo, pPile, liste[0]);
	afficherBascule(limite);
	afficherArbre(meilleur, pDudo, pPile, liste);
	afficherDistribution(limite);
	afficherReperes();
	ecrireStockage(CLE, JSON.stringify(partie));
}

function afficherVersion() {
	for (const element of document.querySelectorAll(".version")) {
		element.textContent = `Version ${window.VERSION_APP ?? "?"}`;
	}
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function basculerMenu() {
	const menu = $("#menu");
	menu.hidden = !menu.hidden;
	$("#bouton-menu").setAttribute("aria-expanded", String(!menu.hidden));
}

function fermerMenu() {
	$("#menu").hidden = true;
	$("#bouton-menu").setAttribute("aria-expanded", "false");
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

/** Action d'un bouton de la partie ; false si le bouton n'en est pas un. */
function jouer(bouton) {
	const { ajout, retrait, face } = bouton.dataset;
	if (bouton.id === "total-moins") partie.total--;
	else if (bouton.id === "total-plus") {
		partie.total = Math.min(partie.total + 1, MAX_DES);
	} else if (bouton.id === "quantite-moins") partie.quantite--;
	else if (bouton.id === "quantite-plus") partie.quantite++;
	else if (bouton.id === "vider") partie.mesDes = [];
	else if (ajout) {
		if (partie.mesDes.length < MES_DES_MAX) partie.mesDes.push(Number(ajout));
	} else if (retrait) partie.mesDes.splice(Number(retrait), 1);
	else if (face) partie.face = Number(face);
	else return false;
	return true;
}

function brancherEvenements() {
	$("main").addEventListener("click", (e) => {
		const bouton = e.target.closest("button");
		if (bouton && jouer(bouton)) afficher();
	});
	$("#palifico").addEventListener("change", (e) => {
		partie.palifico = e.target.checked;
		afficher();
	});
	$("#duel").addEventListener("change", (e) => {
		partie.duel = e.target.checked;
		afficher();
	});
	for (const bouton of document.querySelectorAll("[data-fermer]")) {
		bouton.addEventListener("click", () => bouton.closest("dialog").close());
	}

	$("#bouton-menu").addEventListener("click", (e) => {
		e.stopPropagation();
		basculerMenu();
	});
	document.addEventListener("click", (e) => {
		if (!$("#menu").hidden && !$("#menu").contains(e.target)) fermerMenu();
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") fermerMenu();
	});
	$("#menu-installer").addEventListener("click", fermerMenu);
	brancherInstallation($("#menu-installer"));
	$("#bouton-signalement").addEventListener("click", () => {
		fermerMenu();
		ouvrirSignalement({ app: "Perudo" });
	});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") {
			chercherMiseAJour();
		}
	});
}

$("#logo").innerHTML = de(5) + de(1);
afficherVersion();
afficher();
brancherEvenements();
enregistrerServiceWorker();
