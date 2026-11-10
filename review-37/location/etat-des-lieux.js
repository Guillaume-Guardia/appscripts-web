// États des lieux, sur le téléphone du propriétaire : liste par logement, saisie pièce par pièce
// (état, quantité, commentaire et photos de chaque élément) et signature des locataires sur place.
// La saisie est envoyée à l'API à chaque pause ; tant qu'elle ne l'est pas, elle est gardée sur
// l'appareil (sans nom de locataire), pour ne rien perdre sans réseau.

import { versDate } from "../shared/dates.js";
import { $, el, notifier, remplacerContenu } from "../shared/dom.js";
import { reduireImage } from "../shared/image.js";
import { creerPaveSignature } from "../shared/signature.js";
import { ecrireStockage, lireStockageJson } from "../shared/stockage.js";

const TYPE_ENTREE = "Entrée";
const STATUT_BROUILLON = "Brouillon";
const NATURE_SURFACE = "Surface";
const NATURE_OBJET = "Objet";
const ONGLET_GENERAL = "#general";
const DELAI_ENREGISTREMENT_MS = 4000;
const VIGNETTES_PAR_APPEL = 20;
// Photo envoyée (plus grand côté en pixels, qualité JPEG), et sa vignette pour l'écran et le PDF
const PHOTO = [1600, 0.85];
const VIGNETTE = [480, 0.6];

let api;
let definirTitre;
let afficherEcran;

let liste = null;
let edl = null;
let onglet = ONGLET_GENERAL;
let modifie = false;
let enregistrement = null;
let minuterie = null;
let ciblePhoto = null;
let paves = [];
const vignettes = new Map();

function cleBrouillon(id) {
	return `location.etat-des-lieux.${id}`;
}

function dateFr(texte) {
	return versDate(texte).toLocaleDateString("fr-FR");
}

function libelleType(type) {
	return type === TYPE_ENTREE ? "Entrée" : "Sortie";
}

/** L'élément de l'entrée qui sert de référence à un élément de la sortie. */
function reference(piece, element) {
	if (!edl.reference) return null;
	const pieceEntree = edl.reference.find((p) => p.nom === piece);
	return pieceEntree?.constats.find((c) => c.element === element) ?? null;
}

function resumeConstat(constat) {
	return [
		constat.etat || "État non constaté",
		constat.quantite === "" ? "" : `× ${constat.quantite}`,
		constat.commentaire,
	]
		.filter(Boolean)
		.join(" · ");
}

function estEcart(piece, constat) {
	const entree = reference(piece, constat.element);
	if (!entree) return false;
	return (
		(constat.etat && constat.etat !== entree.etat) ||
		(constat.quantite !== "" &&
			entree.quantite !== "" &&
			Number(constat.quantite) !== Number(entree.quantite))
	);
}

// ——— Liste ———

function ligneEtatDesLieux(etat) {
	const brouillon = etat.statut === STATUT_BROUILLON;
	return el(
		"div",
		{ class: "ligne-suivi ligne-edl" },
		el(
			"div",
			{},
			el("strong", {}, `${libelleType(etat.type)} du ${dateFr(etat.date)}`),
			el(
				"span",
				{ class: brouillon ? "alerte" : "aide" },
				brouillon ? " · en cours" : " · signé",
			),
		),
		el("span", { class: "aide" }, etat.locataires.join(", ")),
		brouillon
			? el(
					"a",
					{ class: "bouton-lien", href: `#etat-des-lieux/${etat.id}` },
					"Reprendre",
				)
			: etat.lienPdf
				? el(
						"a",
						{
							class: "bouton-lien",
							href: etat.lienPdf,
							target: "_blank",
							rel: "noopener",
						},
						"Ouvrir le PDF",
					)
				: null,
	);
}

function carteLogement(logement) {
	const sansLocataire = logement.locataires.length === 0;
	return el(
		"div",
		{ class: "carte carte-logement" },
		el("h3", {}, logement.adresse),
		el(
			"p",
			{ class: "aide" },
			sansLocataire
				? "Aucun locataire en place."
				: `Locataires : ${logement.locataires.map((l) => l.nom).join(", ")}`,
		),
		el(
			"div",
			{ class: "boutons" },
			el(
				"button",
				{
					type: "button",
					disabled: sansLocataire,
					onclick: () => ouvrirNouvelEtatDesLieux(logement, TYPE_ENTREE),
				},
				"Démarrer l'entrée",
			),
			el(
				"button",
				{
					type: "button",
					disabled: sansLocataire,
					onclick: () => ouvrirNouvelEtatDesLieux(logement, "Sortie"),
				},
				"Démarrer la sortie",
			),
		),
		logement.etatsDesLieux.map(ligneEtatDesLieux),
	);
}

/** Écran de la liste des états des lieux, par logement. */
export async function ouvrirListeEtatsDesLieux() {
	definirTitre("États des lieux");
	liste = await api("etats-des-lieux");
	remplacerContenu(
		$("#liste-etats-des-lieux"),
		liste.logements.length > 0
			? liste.logements.map(carteLogement)
			: el("p", { class: "aide vide" }, "Aucun logement loué."),
	);
	afficherEcran("etats-des-lieux");
}

function ouvrirNouvelEtatDesLieux(logement, type) {
	const dialogue = $("#dialogue-nouvel-edl");
	$("#nouvel-edl-titre").textContent =
		type === TYPE_ENTREE
			? "État des lieux d'entrée"
			: "État des lieux de sortie";
	$("#nouvel-edl-logement").textContent = logement.adresse;
	$("#nouvel-edl-erreur").textContent = "";
	remplacerContenu(
		$("#nouvel-edl-locataires"),
		logement.locataires.map((locataire) =>
			el(
				"label",
				{ class: "case" },
				el("input", {
					type: "checkbox",
					value: locataire.nom,
					checked: true,
				}),
				`${locataire.nom} (${locataire.statut})`,
			),
		),
	);
	$("#nouvel-edl-demarrer").onclick = async (evenement) => {
		evenement.preventDefault();
		const locataires = [
			...$("#nouvel-edl-locataires").querySelectorAll("input:checked"),
		].map((caseCochee) => caseCochee.value);
		try {
			const { id } = await creerAvecRepli(logement.id, type, locataires);
			dialogue.close();
			location.hash = `#etat-des-lieux/${id}`;
		} catch (erreur) {
			$("#nouvel-edl-erreur").textContent = erreur.message;
		}
	};
	dialogue.showModal();
}

/** Crée l'état des lieux ; une sortie sans entrée signée peut partir de l'inventaire, sur confirmation. */
async function creerAvecRepli(logement, type, locataires) {
	try {
		return await api("creer-etat-des-lieux", { logement, type, locataires });
	} catch (erreur) {
		if (
			!erreur.message.includes("partir de l'inventaire") ||
			!confirm(`${erreur.message}\n\nPartir de l'inventaire ?`)
		) {
			throw erreur;
		}
		return api("creer-etat-des-lieux", {
			logement,
			type,
			locataires,
			depuisInventaire: true,
		});
	}
}

// ——— Saisie ———

function saisie() {
	return {
		date: edl.date,
		compteurs: edl.compteurs,
		cles: edl.cles,
		pieces: edl.pieces,
	};
}

function afficherEtatEnregistrement(texte, erreur = false) {
	const zone = $("#edl-enregistrement");
	zone.textContent = texte;
	zone.classList.toggle("alerte", erreur);
}

/** Envoie la saisie à l'API si elle a changé ; sans réseau, elle reste gardée sur l'appareil. */
async function enregistrer() {
	clearTimeout(minuterie);
	if (enregistrement) await enregistrement.catch(() => {});
	if (!modifie || !edl) return;
	const id = edl.id;
	modifie = false;
	afficherEtatEnregistrement("Enregistrement…");
	enregistrement = api(
		"enregistrer-etat-des-lieux",
		{ id, ...saisie() },
		{ discret: true },
	);
	try {
		await enregistrement;
		if (!modifie) ecrireStockage(cleBrouillon(id), null);
		afficherEtatEnregistrement("Enregistré");
	} catch (erreur) {
		modifie = true;
		afficherEtatEnregistrement(
			`Gardé sur ce téléphone : ${erreur.message}`,
			true,
		);
		throw erreur;
	} finally {
		enregistrement = null;
	}
}

function marquerModifie() {
	modifie = true;
	ecrireStockage(
		cleBrouillon(edl.id),
		JSON.stringify({ ...saisie(), garde: Date.now() }),
	);
	afficherEtatEnregistrement("Modifié");
	clearTimeout(minuterie);
	minuterie = setTimeout(
		() => enregistrer().catch(() => {}),
		DELAI_ENREGISTREMENT_MS,
	);
}

/** Enregistre avant de quitter la saisie (changement d'écran, app mise en arrière-plan). */
export async function quitterSaisieEtatDesLieux() {
	if (!modifie) return;
	try {
		await enregistrer();
	} catch {
		// Gardée sur l'appareil : la saisie sera envoyée à la prochaine ouverture.
	}
}

function nombreConstates(piece) {
	return piece.constats.filter((constat) => constat.etat).length;
}

function rendreOnglets() {
	const puce = (cle, libelle) =>
		el(
			"button",
			{
				type: "button",
				class: "puce",
				"aria-pressed": String(onglet === cle),
				onclick: () => changerOnglet(cle),
			},
			libelle,
		);
	remplacerContenu(
		$("#edl-onglets"),
		puce(ONGLET_GENERAL, "Général"),
		edl.pieces.map((piece) =>
			puce(
				piece.nom,
				`${piece.nom} ${nombreConstates(piece)}/${piece.constats.length}`,
			),
		),
	);
}

function changerOnglet(cle) {
	onglet = cle;
	rendreOnglets();
	rendreContenu();
	window.scrollTo({ top: 0 });
	enregistrer().catch(() => {});
}

function champ(libelle, attributs, surSaisie) {
	const input = el(attributs.rows ? "textarea" : "input", {
		...attributs,
		oninput: (evenement) => {
			surSaisie(evenement.target.value);
			marquerModifie();
		},
	});
	if (attributs.rows) input.value = attributs.value ?? "";
	return el("label", { class: "champ" }, el("span", {}, libelle), input);
}

function rendreGeneral() {
	const nomPiece = el("input", {
		type: "text",
		placeholder: "Nom de la pièce (ex : WC)",
		maxlength: "100",
	});
	return el(
		"div",
		{ class: "carte edl-general" },
		el("p", { class: "aide" }, `Locataires : ${edl.locataires.join(", ")}`),
		champ("Date", { type: "date", value: edl.date }, (valeur) => {
			edl.date = valeur;
		}),
		champ(
			"Compteur d'électricité",
			{ type: "text", inputmode: "decimal", value: edl.compteurs.electricite },
			(valeur) => {
				edl.compteurs.electricite = valeur;
			},
		),
		champ(
			"Compteur d'eau",
			{ type: "text", inputmode: "decimal", value: edl.compteurs.eau },
			(valeur) => {
				edl.compteurs.eau = valeur;
			},
		),
		champ(
			"Compteur de gaz",
			{ type: "text", inputmode: "decimal", value: edl.compteurs.gaz },
			(valeur) => {
				edl.compteurs.gaz = valeur;
			},
		),
		champ(
			"Clés remises",
			{ rows: "2", value: edl.cles, placeholder: "ex : 2 clés porte, 1 badge" },
			(valeur) => {
				edl.cles = valeur;
			},
		),
		el("h3", {}, "Ajouter une pièce"),
		el(
			"div",
			{ class: "ajout" },
			nomPiece,
			el(
				"button",
				{
					type: "button",
					onclick: () => ajouterPiece(nomPiece.value.trim()),
				},
				"Ajouter",
			),
		),
		el(
			"button",
			{
				type: "button",
				class: "danger supprimer-brouillon",
				onclick: supprimerBrouillon,
			},
			"Supprimer cet état des lieux",
		),
	);
}

function ajouterPiece(nom) {
	if (!nom) return;
	if (edl.pieces.some((piece) => piece.nom === nom)) {
		notifier(`La pièce « ${nom} » existe déjà.`, true);
		return;
	}
	edl.pieces.push({
		nom,
		constats: edl.surfaces.map((surface) => ({
			element: surface,
			nature: NATURE_SURFACE,
			quantite: "",
			etat: "",
			commentaire: "",
			photos: [],
		})),
	});
	marquerModifie();
	changerOnglet(nom);
}

async function supprimerBrouillon() {
	if (
		!confirm(
			"Supprimer cet état des lieux en cours ? Ses photos restent dans Drive.",
		)
	)
		return;
	clearTimeout(minuterie);
	modifie = false;
	try {
		await api("supprimer-etat-des-lieux", { id: edl.id });
		ecrireStockage(cleBrouillon(edl.id), null);
		edl = null;
		location.hash = "#etats-des-lieux";
	} catch (erreur) {
		notifier(erreur.message, true);
	}
}

function imageVignette(url, surRetrait) {
	const image = el("img", { alt: "", "data-url": url });
	const vignette = vignettes.get(url);
	if (vignette) image.src = `data:image/jpeg;base64,${vignette}`;
	return el(
		"div",
		{ class: "vignette" },
		el("a", { href: url, target: "_blank", rel: "noopener" }, image),
		surRetrait
			? el(
					"button",
					{
						type: "button",
						class: "retirer-photo",
						"aria-label": "Retirer la photo",
						onclick: surRetrait,
					},
					"×",
				)
			: null,
	);
}

function rendrePhotos(zone, piece, constat) {
	remplacerContenu(
		zone,
		constat.photos.map((url) =>
			imageVignette(url, () => {
				constat.photos = constat.photos.filter((photo) => photo !== url);
				rendrePhotos(zone, piece, constat);
				marquerModifie();
			}),
		),
		el(
			"button",
			{
				type: "button",
				class: "bouton-photo camera",
				onclick: () => choisirPhoto("#edl-camera", piece, constat, zone),
			},
			"Photo",
		),
		el(
			"button",
			{
				type: "button",
				class: "bouton-photo",
				onclick: () => choisirPhoto("#edl-galerie", piece, constat, zone),
			},
			"Galerie",
		),
	);
}

function choisirPhoto(selecteur, piece, constat, zone) {
	ciblePhoto = { piece, constat, zone };
	$(selecteur).click();
}

async function envoyerPhotos(fichiers) {
	const cible = ciblePhoto;
	if (!cible || !edl) return;
	for (const fichier of fichiers) {
		notifier("Envoi de la photo…");
		try {
			const [photo, vignette] = await Promise.all([
				reduireImage(fichier, ...PHOTO),
				reduireImage(fichier, ...VIGNETTE),
			]);
			const { url } = await api("photo-etat-des-lieux", {
				id: edl.id,
				piece: cible.piece.nom,
				element: cible.constat.element,
				photo,
				vignette,
			});
			vignettes.set(url, vignette);
			cible.constat.photos.push(url);
			rendrePhotos(cible.zone, cible.piece, cible.constat);
			marquerModifie();
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	}
	enregistrer().catch(() => {});
}

/** Les boutons des états d'un élément ; rendre() les remet à jour après un changement venu d'ailleurs. */
function boutonsEtats(constat, surChoix) {
	const zone = el("div", { class: "puces etats" });
	const rendre = () =>
		remplacerContenu(
			zone,
			edl.etats.map((etat) =>
				el(
					"button",
					{
						type: "button",
						class: "puce",
						"aria-pressed": String(constat.etat === etat),
						onclick: () => {
							constat.etat = constat.etat === etat ? "" : etat;
							rendre();
							surChoix();
						},
					},
					etat,
				),
			),
		);
	rendre();
	return { zone, rendre };
}

function carteElement(piece, constat) {
	const entree = reference(piece.nom, constat.element);
	const carte = el("div", { class: "carte edl-element" });
	const photos = el("div", { class: "edl-photos" });
	const quantite = el("input", {
		type: "number",
		inputmode: "numeric",
		min: "0",
		value: constat.quantite === "" ? "" : String(constat.quantite),
		oninput: (evenement) => {
			const valeur = evenement.target.value;
			constat.quantite = valeur === "" ? "" : Number(valeur);
			apresChangement();
		},
	});
	const commentaire = el("textarea", {
		rows: "1",
		placeholder: "Commentaire (rayure, éclat, ne fonctionne pas…)",
		maxlength: "500",
		oninput: (evenement) => {
			constat.commentaire = evenement.target.value;
			marquerModifie();
		},
	});
	commentaire.value = constat.commentaire;
	const etats = boutonsEtats(constat, () => apresChangement());

	function apresChangement() {
		carte.classList.toggle("ecart", estEcart(piece.nom, constat));
		rendreOnglets();
		marquerModifie();
	}

	remplacerContenu(
		carte,
		el(
			"div",
			{ class: "titre-element" },
			el("strong", {}, constat.element),
			el(
				"button",
				{
					type: "button",
					class: "retirer",
					"aria-label": `Retirer ${constat.element}`,
					onclick: () => retirerElement(piece, constat),
				},
				"Retirer",
			),
		),
		entree
			? el(
					"div",
					{ class: "reference" },
					el("span", { class: "aide" }, `Entrée : ${resumeConstat(entree)}`),
					entree.photos.length > 0
						? el(
								"div",
								{ class: "edl-photos" },
								entree.photos.map((url) => imageVignette(url)),
							)
						: null,
					el(
						"button",
						{
							type: "button",
							class: "puce",
							onclick: () => {
								constat.etat = entree.etat;
								constat.quantite = entree.quantite;
								quantite.value =
									entree.quantite === "" ? "" : String(entree.quantite);
								etats.rendre();
								apresChangement();
							},
						},
						"Comme à l'entrée",
					),
				)
			: null,
		constat.nature === NATURE_OBJET
			? el(
					"label",
					{ class: "champ quantite" },
					el("span", {}, "Quantité"),
					quantite,
				)
			: null,
		etats.zone,
		commentaire,
		photos,
	);
	carte.classList.toggle("ecart", estEcart(piece.nom, constat));
	rendrePhotos(photos, piece, constat);
	return carte;
}

function retirerElement(piece, constat) {
	const constate = constat.etat || constat.photos.length > 0;
	if (
		constate &&
		!confirm(`Retirer « ${constat.element} » et ce qui a été constaté ?`)
	)
		return;
	piece.constats = piece.constats.filter((c) => c !== constat);
	marquerModifie();
	rendreOnglets();
	rendreContenu();
}

function rendrePiece(piece) {
	const nomElement = el("input", {
		type: "text",
		placeholder: "Objet ou élément à ajouter",
		maxlength: "100",
	});
	return el(
		"div",
		{},
		piece.constats.map((constat) => carteElement(piece, constat)),
		el(
			"div",
			{ class: "carte edl-general" },
			el("h3", {}, "Ajouter un élément"),
			el(
				"div",
				{ class: "ajout" },
				nomElement,
				el(
					"button",
					{
						type: "button",
						onclick: () => {
							const nom = nomElement.value.trim();
							if (!nom) return;
							if (piece.constats.some((c) => c.element === nom)) {
								notifier(`« ${nom} » est déjà dans la pièce.`, true);
								return;
							}
							piece.constats.push({
								element: nom,
								nature: NATURE_OBJET,
								quantite: 1,
								etat: "",
								commentaire: "",
								photos: [],
							});
							marquerModifie();
							rendreOnglets();
							rendreContenu();
						},
					},
					"Ajouter",
				),
			),
			el(
				"button",
				{
					type: "button",
					class: "danger",
					onclick: () => {
						if (
							!confirm(
								`Retirer la pièce « ${piece.nom} » de l'état des lieux ?`,
							)
						)
							return;
						edl.pieces = edl.pieces.filter((p) => p !== piece);
						marquerModifie();
						changerOnglet(ONGLET_GENERAL);
					},
				},
				"Retirer la pièce",
			),
		),
	);
}

function rendreContenu() {
	const piece = edl.pieces.find((p) => p.nom === onglet);
	if (!piece) onglet = ONGLET_GENERAL;
	remplacerContenu(
		$("#edl-contenu"),
		piece ? rendrePiece(piece) : rendreGeneral(),
	);
	chargerVignettesManquantes();
}

/** Charge, par paquets, les vignettes des photos affichées qui ne sont pas encore connues. */
async function chargerVignettesManquantes() {
	const images = [...document.querySelectorAll("#edl-contenu img[data-url]")];
	const manquantes = [
		...new Set(
			images
				.map((image) => image.dataset.url)
				.filter((url) => !vignettes.has(url)),
		),
	];
	for (let i = 0; i < manquantes.length; i += VIGNETTES_PAR_APPEL) {
		try {
			const recues = await api(
				"vignettes-etat-des-lieux",
				{ photos: manquantes.slice(i, i + VIGNETTES_PAR_APPEL) },
				{ discret: true },
			);
			for (const [url, vignette] of Object.entries(recues)) {
				vignettes.set(url, vignette);
			}
		} catch {
			return;
		}
		for (const image of document.querySelectorAll(
			"#edl-contenu img[data-url]",
		)) {
			const vignette = vignettes.get(image.dataset.url);
			if (vignette && !image.src)
				image.src = `data:image/jpeg;base64,${vignette}`;
		}
	}
}

/** Charge un état des lieux, et reprend la saisie gardée sur l'appareil qui n'a pas été envoyée. */
async function chargerEtatDesLieux(id) {
	if (edl?.id === id) return;
	edl = await api("etat-des-lieux", { id });
	onglet = ONGLET_GENERAL;
	modifie = false;
	const garde = lireStockageJson(cleBrouillon(id));
	if (garde && edl.statut === STATUT_BROUILLON) {
		Object.assign(edl, {
			date: garde.date,
			compteurs: garde.compteurs,
			cles: garde.cles,
			pieces: garde.pieces,
		});
		modifie = true;
		notifier("Saisie non envoyée reprise sur ce téléphone.");
		enregistrer().catch(() => {});
	}
}

/** Écran de saisie d'un état des lieux. */
export async function ouvrirSaisieEtatDesLieux(id) {
	await chargerEtatDesLieux(id);
	if (edl.statut !== STATUT_BROUILLON) {
		notifier("Cet état des lieux est signé.");
		location.hash = "#etats-des-lieux";
		return;
	}
	definirTitre(`${libelleType(edl.type)} · ${edl.logement}`);
	$("#edl-adresse").textContent = edl.adresse;
	afficherEtatEnregistrement(modifie ? "Modifié" : "Enregistré");
	rendreOnglets();
	rendreContenu();
	afficherEcran("saisie-edl");
}

// ——— Signatures ———

function recapitulatif() {
	const sansEtat = edl.pieces.flatMap((piece) =>
		piece.constats
			.filter((constat) => !constat.etat)
			.map((constat) => `${piece.nom} : ${constat.element}`),
	);
	const ecarts = edl.pieces.flatMap((piece) =>
		piece.constats
			.filter((constat) => estEcart(piece.nom, constat))
			.map(
				(constat) =>
					`${piece.nom} : ${constat.element} (${resumeConstat(reference(piece.nom, constat.element))} → ${resumeConstat(constat)})`,
			),
	);
	return el(
		"div",
		{ class: "carte edl-general" },
		el("h3", {}, `${libelleType(edl.type)} du ${dateFr(edl.date)}`),
		el("p", { class: "aide" }, edl.adresse),
		sansEtat.length > 0
			? el(
					"p",
					{ class: "alerte" },
					`${sansEtat.length} élément(s) sans état : ${sansEtat.slice(0, 8).join(", ")}${sansEtat.length > 8 ? "…" : ""}`,
				)
			: el("p", { class: "aide" }, "Tous les éléments sont constatés."),
		ecarts.length > 0
			? el(
					"details",
					{},
					el("summary", {}, `${ecarts.length} différence(s) avec l'entrée`),
					el(
						"ul",
						{},
						ecarts.map((ecart) => el("li", {}, ecart)),
					),
				)
			: null,
		edl.pieces.map((piece) =>
			el(
				"details",
				{},
				el("summary", {}, `${piece.nom} (${piece.constats.length})`),
				el(
					"ul",
					{},
					piece.constats.map((constat) =>
						el("li", {}, `${constat.element} : ${resumeConstat(constat)}`),
					),
				),
			),
		),
		el(
			"p",
			{ class: "aide" },
			"Les propriétaires signent par leur cachet, apposé sur le PDF.",
		),
	);
}

function majBoutonSigner() {
	$("#edl-signer").disabled = !paves.every(
		({ caseRelu, pave }) => caseRelu.checked && !pave.estVide(),
	);
}

function blocSignature(nom) {
	const canvas = el("canvas", { class: "pave-signature" });
	const caseRelu = el("input", { type: "checkbox", onchange: majBoutonSigner });
	const bloc = el(
		"div",
		{ class: "carte bloc-signature" },
		el("h3", {}, nom),
		el(
			"label",
			{ class: "case" },
			caseRelu,
			"J'ai relu l'état des lieux et je l'approuve",
		),
		canvas,
		el(
			"div",
			{ class: "boutons" },
			el(
				"button",
				{ type: "button", onclick: () => pave.effacer() },
				"Effacer",
			),
		),
	);
	$("#edl-signatures").append(bloc);
	const pave = creerPaveSignature(canvas, majBoutonSigner);
	return { nom, caseRelu, pave };
}

/** Écran de relecture et de signature, sur le téléphone, avec les locataires. */
export async function ouvrirSignatureEtatDesLieux(id) {
	await chargerEtatDesLieux(id);
	if (edl.statut !== STATUT_BROUILLON) {
		location.hash = "#etats-des-lieux";
		return;
	}
	try {
		await enregistrer();
	} catch {
		notifier(
			"La saisie doit être enregistrée avant de signer : vérifie le réseau.",
			true,
		);
		location.hash = `#etat-des-lieux/${id}`;
		return;
	}
	definirTitre(`Signatures · ${edl.logement}`);
	remplacerContenu($("#edl-recapitulatif"), recapitulatif());
	remplacerContenu($("#edl-signatures"));
	$("#edl-erreur-signature").textContent = "";
	afficherEcran("signature-edl");
	paves = edl.locataires.map(blocSignature);
	majBoutonSigner();
}

async function signer() {
	const sansEtat = edl.pieces.some((piece) =>
		piece.constats.some((constat) => !constat.etat),
	);
	if (
		sansEtat &&
		!confirm("Des éléments n'ont pas d'état. Signer quand même ?")
	)
		return;
	const bouton = $("#edl-signer");
	bouton.disabled = true;
	$("#edl-erreur-signature").textContent = "";
	try {
		const { lienPdf, erreurMail } = await api("signer-etat-des-lieux", {
			id: edl.id,
			consentement: true,
			signatures: paves.map(({ nom, pave }) => ({
				nom,
				image: pave.versPng(),
			})),
		});
		ecrireStockage(cleBrouillon(edl.id), null);
		edl = null;
		paves = [];
		remplacerContenu(
			$("#edl-recapitulatif"),
			el(
				"div",
				{ class: "carte edl-general" },
				el("h3", {}, "État des lieux signé"),
				el(
					"p",
					{},
					erreurMail ||
						"Le PDF est rangé dans le dossier des locataires et leur a été envoyé par mail.",
				),
				el(
					"div",
					{ class: "boutons" },
					el(
						"a",
						{
							class: "bouton-lien",
							href: lienPdf,
							target: "_blank",
							rel: "noopener",
						},
						"Ouvrir le PDF",
					),
					el(
						"a",
						{ class: "bouton-lien", href: "#etats-des-lieux" },
						"Terminer",
					),
				),
			),
		);
		remplacerContenu($("#edl-signatures"));
		bouton.hidden = true;
	} catch (erreur) {
		$("#edl-erreur-signature").textContent = erreur.message;
		majBoutonSigner();
	}
}

/**
 * Branche les écrans des états des lieux.
 * @param appelerApi Le client de l'API Location (voir creerApi)
 * @param afficher Affiche un écran par son nom (section #ecran-<nom>)
 * @param titre Change le titre de l'en-tête
 */
export function initialiserEtatsDesLieux({ appelerApi, afficher, titre }) {
	api = appelerApi;
	afficherEcran = (nom) => {
		afficher(nom);
		$("#edl-signer").hidden = nom !== "signature-edl";
	};
	definirTitre = titre;
	for (const selecteur of ["#edl-camera", "#edl-galerie"]) {
		$(selecteur).addEventListener("change", (evenement) => {
			const fichiers = [...evenement.target.files];
			evenement.target.value = "";
			envoyerPhotos(fichiers);
		});
	}
	$("#edl-enregistrer").addEventListener("click", () =>
		enregistrer().catch(() => {}),
	);
	$("#edl-vers-signature").addEventListener("click", () => {
		location.hash = `#signer-etat-des-lieux/${edl.id}`;
	});
	$("#edl-signer").addEventListener("click", signer);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") quitterSaisieEtatDesLieux();
	});
	window.addEventListener("beforeunload", (evenement) => {
		if (modifie) evenement.preventDefault();
	});
}
