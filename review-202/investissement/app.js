import {
	brancherBiometrie,
	compteConnecte,
	connecterUnAutreAppareil,
	exigerAccesApp,
} from "../shared/connexion.js";
import { $, el, notifier, remplacerContenu } from "../shared/dom.js";
import { afficherProfil, brancherProfil } from "../shared/profil.js";
import {
	brancherInstallation,
	chercherMiseAJour,
	enregistrerServiceWorker,
} from "../shared/pwa.js";
import { ouvrirSignalement } from "../shared/signalement.js";
import { ecrireStockage, lireStockageJson } from "../shared/stockage.js";
import { PARAMETRES_DEFAUT, simuler } from "./calcul.js";

// ---------------------------------------------------------------------------
// État de l'app : tout est calculé sur le téléphone, rien n'est envoyé.
// ---------------------------------------------------------------------------

const CLES = {
	simulation: "investissement.simulation",
	parametres: "investissement.parametres",
};

/** Champs numériques de la simulation (attribut name des champs du formulaire). */
const CHAMPS = [
	"prix",
	"superficie",
	"fraisAgence",
	"travaux",
	"apport",
	"taux",
	"duree",
	"loyer",
];

/** Simulation de départ : taux et durée de la ligne « Exemple » du classeur. */
const SIMULATION_VIDE = { neuf: false, taux: 3.6, duree: 20 };

const app = {
	/** Saisie en cours : nombres ou null, et `neuf`. */
	saisie: { ...SIMULATION_VIDE, ...lireStockageJson(CLES.simulation) },
	parametres: {
		...PARAMETRES_DEFAUT,
		...lireStockageJson(CLES.parametres),
	},
};

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------

const euros = new Intl.NumberFormat("fr-FR", {
	style: "currency",
	currency: "EUR",
	maximumFractionDigits: 0,
});
const pourcents = new Intl.NumberFormat("fr-FR", {
	style: "percent",
	minimumFractionDigits: 1,
	maximumFractionDigits: 2,
});
const nombres = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

const enEuros = (valeur) => euros.format(Math.round(valeur));
const enPourcents = (valeur) =>
	valeur === null ? "—" : pourcents.format(valeur);
/** Montant signé : « +120 € » ou « −80 € ». */
const signe = (valeur) =>
	`${Math.round(valeur) > 0 ? "+" : ""}${enEuros(valeur)}`;

/** Classe d'un montant : positif (vert), négatif (rouge) ou nul. */
function classeSigne(valeur) {
	if (Math.round(valeur) > 0) return "positif";
	if (Math.round(valeur) < 0) return "negatif";
	return "";
}

/** Écrit un chiffre clé, coloré selon son signe s'il le faut. */
function afficherCle(id, texte, valeurSignee = null) {
	const element = $(id);
	element.textContent = texte;
	element.className = valeurSignee === null ? "" : classeSigne(valeurSignee);
}

/** Ligne du détail : libellé, montant, précision facultative. */
function ligne(libelle, valeur, { precision, classe, total } = {}) {
	return [
		el("dt", { class: total ? "total" : null }, libelle),
		el(
			"dd",
			{ class: [total ? "total" : "", classe ?? ""].join(" ").trim() || null },
			valeur,
			precision ? el("span", { class: "precision" }, precision) : null,
		),
	];
}

const titre = (texte) => el("dt", { class: "titre-detail" }, texte);

/** Recalcule et affiche la simulation. */
function afficher() {
	const r = simuler(app.saisie, app.parametres);
	const p = app.parametres;
	const aUnPrix = r.coutTotal > 0;

	afficherCle(
		"#cle-cash-flow",
		aUnPrix ? signe(r.cashFlow) : "—",
		aUnPrix ? r.cashFlow : null,
	);
	afficherCle("#cle-rendement", aUnPrix ? enPourcents(r.rendementNet) : "—");
	afficherCle("#cle-mensualite", aUnPrix ? enEuros(r.mensualite) : "—");

	// Estimations proposées dans les champs laissés vides (le détail en donne le calcul).
	const prix = app.saisie.prix ?? 0;
	$("#champ-frais-agence").placeholder = prix
		? `≈ ${enEuros((prix * p.agence) / 100)}`
		: `${nombres.format(p.agence)} % du prix`;
	const superficie = app.saisie.superficie ?? 0;
	$("#champ-loyer").placeholder = superficie
		? `≈ ${enEuros(superficie * p.loyerM2)} (${nombres.format(p.loyerM2)} €/m²)`
		: `${nombres.format(p.loyerM2)} € par m²`;

	if (!aUnPrix) {
		remplacerContenu(
			$("#detail"),
			el("p", { class: "aide" }, "Saisis au moins le prix du bien."),
		);
		return;
	}
	const notaire = app.saisie.neuf ? p.notaireNeuf : p.notaireAncien;
	remplacerContenu(
		$("#detail"),
		titre("Achat"),
		ligne("Prix", enEuros(prix), {
			precision: r.prixM2 === null ? null : `${enEuros(r.prixM2)} / m²`,
		}),
		ligne("Frais de notaire", enEuros(r.fraisNotaire), {
			precision: `${nombres.format(notaire)} %`,
		}),
		ligne("Frais d'agence", enEuros(r.fraisAgence), {
			precision: r.fraisAgenceEstimes
				? `estimés : ${nombres.format(p.agence)} % du prix`
				: null,
		}),
		r.travaux ? ligne("Travaux", enEuros(r.travaux)) : null,
		ligne("Coût total", enEuros(r.coutTotal), { total: true }),

		titre("Crédit"),
		ligne("Apport", enEuros(r.apport)),
		ligne("Montant emprunté", enEuros(r.emprunt)),
		ligne("Intérêts", enEuros(r.interets)),
		ligne("Coût du crédit", enEuros(r.coutCredit), {
			precision: "capital + intérêts",
		}),
		ligne("Mensualité", enEuros(r.mensualite), { total: true }),
		ligne("Revenu conseillé", enEuros(r.revenuMini), {
			precision: "3 × la mensualité",
		}),

		titre("Location, par mois"),
		ligne("Loyer", enEuros(r.loyer), {
			precision: r.loyerEstime ? "estimé" : null,
		}),
		ligne("Taxe foncière", `−${enEuros(r.taxeFonciere)}`),
		ligne("Charges", `−${enEuros(r.charges)}`, {
			precision: `${nombres.format(p.charges)} % du loyer`,
		}),
		ligne("Assurance PNO", `−${enEuros(r.assurance)}`),
		ligne("Loyer net", enEuros(r.loyerNet), { total: true }),

		titre("Bilan"),
		ligne("Cash-flow par mois", signe(r.cashFlow), {
			classe: classeSigne(r.cashFlow),
			precision: "loyer net − mensualité",
		}),
		ligne("Cash-flow par an", signe(r.cashFlow * 12), {
			classe: classeSigne(r.cashFlow),
		}),
		ligne("Rendement brut", enPourcents(r.rendementBrut), {
			precision: "loyer × 12 / coût total",
		}),
		ligne("Rendement net", enPourcents(r.rendementNet), {
			total: true,
			precision: "loyer net × 12 / coût total",
		}),
	);
}

// ---------------------------------------------------------------------------
// Saisie
// ---------------------------------------------------------------------------

/** Nombre d'un champ, ou null s'il est vide (ou invalide). */
function lireChamp(champ) {
	return champ.value === "" || Number.isNaN(champ.valueAsNumber)
		? null
		: champ.valueAsNumber;
}

function remplirFormulaire() {
	const form = $("#form-simulation");
	for (const nom of CHAMPS) {
		const valeur = app.saisie[nom];
		form.elements[nom].value = typeof valeur === "number" ? valeur : "";
	}
	for (const puce of document.querySelectorAll("[data-neuf]")) {
		puce.setAttribute(
			"aria-pressed",
			String((puce.dataset.neuf === "oui") === Boolean(app.saisie.neuf)),
		);
	}
}

function enregistrerSaisie() {
	ecrireStockage(CLES.simulation, JSON.stringify(app.saisie));
	afficher();
}

function effacerSimulation() {
	fermerMenu();
	if (!confirm("Effacer la simulation en cours ?")) return;
	app.saisie = { ...SIMULATION_VIDE };
	remplirFormulaire();
	enregistrerSaisie();
}

// ---------------------------------------------------------------------------
// Paramètres du calcul
// ---------------------------------------------------------------------------

function remplirParametres() {
	const form = $("#form-parametres");
	for (const [nom, valeur] of Object.entries(app.parametres)) {
		form.elements[nom].value = valeur;
	}
}

function ouvrirParametres() {
	fermerMenu();
	remplirParametres();
	$("#dialogue-parametres").showModal();
}

/** Un paramètre modifié compte aussitôt ; un champ vidé ou invalide garde la valeur d'avant. */
function modifierParametre(champ) {
	const valeur = lireChamp(champ);
	if (valeur === null || valeur < 0) return;
	app.parametres[champ.name] = valeur;
	ecrireStockage(CLES.parametres, JSON.stringify(app.parametres));
	afficher();
}

function retablirParametres() {
	app.parametres = { ...PARAMETRES_DEFAUT };
	ecrireStockage(CLES.parametres, null);
	remplirParametres();
	afficher();
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function fermerMenu() {
	$("#menu").hidden = true;
	$("#bouton-menu").setAttribute("aria-expanded", "false");
}

function basculerMenu() {
	const ouvert = $("#menu").hidden;
	$("#menu").hidden = !ouvert;
	$("#bouton-menu").setAttribute("aria-expanded", String(ouvert));
}

function afficherVersion() {
	for (const element of document.querySelectorAll(".version")) {
		element.textContent = `Version ${window.VERSION_APP ?? "?"}`;
	}
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

function brancherEvenements() {
	$("#form-simulation").addEventListener("input", (e) => {
		if (!CHAMPS.includes(e.target.name)) return;
		app.saisie[e.target.name] = lireChamp(e.target);
		enregistrerSaisie();
	});
	for (const puce of document.querySelectorAll("[data-neuf]")) {
		puce.addEventListener("click", () => {
			app.saisie.neuf = puce.dataset.neuf === "oui";
			remplirFormulaire();
			enregistrerSaisie();
		});
	}
	$("#form-parametres").addEventListener("input", (e) =>
		modifierParametre(e.target),
	);
	$("#bouton-parametres-defaut").addEventListener("click", retablirParametres);
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
	$("#menu-parametres").addEventListener("click", ouvrirParametres);
	$("#menu-effacer").addEventListener("click", effacerSimulation);
	$("#menu-installer").addEventListener("click", fermerMenu);
	brancherInstallation($("#menu-installer"), { connexion: true });
	brancherBiometrie($("#menu-biometrie"), "Investissement");
	$("#menu-autre-appareil").addEventListener("click", async () => {
		fermerMenu();
		try {
			await connecterUnAutreAppareil("Investissement");
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	});
	$("#menu-deconnecter").addEventListener("click", () => {
		fermerMenu();
		acces.seDeconnecter();
	});
	$("#bouton-signalement").addEventListener("click", () => {
		fermerMenu();
		ouvrirSignalement({
			app: "Investissement",
			prenom: compteConnecte()?.prenom,
		});
	});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") {
			chercherMiseAJour();
		}
	});
}

remplirFormulaire();
afficherVersion();
afficher();
enregistrerServiceWorker();
// Réservée aux comptes qui ont accès à Investissement (onglet Droits du projet droits).
brancherProfil();
const acces = exigerAccesApp({
	cle: "investissement",
	nomApp: "Investissement",
	surOuverte: () => afficherProfil(),
});
brancherEvenements();
