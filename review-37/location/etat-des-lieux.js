// États des lieux, sur le téléphone du propriétaire : liste par logement, saisie pièce par pièce
// (état, quantité, commentaire et photos de chaque élément) et signature des locataires sur place.
// La saisie est envoyée à l'API à chaque pause ; tant qu'elle ne l'est pas, elle est gardée sur
// l'appareil (sans nom de locataire), pour ne rien perdre sans réseau. Les photos, réduites à 480 px
// pour le PDF, passent par une file sur l'appareil (file-attente.js) : envoyées au classeur dès
// qu'il y a du réseau, sans faire attendre la saisie. Elles ne sont gardées nulle part ailleurs.

import { ErreurReseau } from "../shared/api.js";
import { versDate } from "../shared/dates.js";
import { $, el, notifier, remplacerContenu } from "../shared/dom.js";
import { fileAttente } from "../shared/file-attente.js";
import { reduireImage } from "../shared/image.js";
import { creerPaveSignature } from "../shared/signature.js";
import { ecrireStockage, lireStockageJson } from "../shared/stockage.js";

const TYPE_ENTREE = "Entrée";
const STATUT_BROUILLON = "Brouillon";
const NATURE_SURFACE = "Surface";
const NATURE_OBJET = "Objet";
const NATURE_VUE = "Vue";
const NATURE_COMPTEUR = "Compteur";
const ELEMENT_VUE_GENERALE = "Vue générale";
const PIECE_COMPTEURS = "Compteurs";
// Le relevé de chaque compteur, dans les compteurs de l'état des lieux (le reste est dans son élément)
const RELEVES = { Électricité: "electricite", Eau: "eau", Gaz: "gaz" };
const ONGLET_GENERAL = "#general";
const DELAI_ENREGISTREMENT_MS = 4000;
// Balayage horizontal minimal du doigt pour changer de pièce, en pixels
const BALAYAGE_MIN_PX = 50;
const VIGNETTES_PAR_APPEL = 200;
// Photo pour le PDF (plus grand côté en pixels, qualité JPEG), gardée dans une cellule du classeur
// (45 000 caractères au plus) : 480 px, environ 20 Ko, comme les 400 photos d'un état des lieux
// d'agence en 6 Mo ; plus petite si elle ne tient pas
const TAILLES_PHOTO = [
	[480, 0.5],
	[400, 0.45],
	[320, 0.4],
];
const LONGUEUR_MAX_PHOTO = 45000;
const PHOTOS_PAR_ENVOI = 50;
const DELAI_NOUVEL_ESSAI_MS = 30000;

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
const photosEnAttente = fileAttente("location");
// Les photos de la file, gardées en mémoire pour l'affichage (voir rafraichirAttente)
let attente = [];
let pompe = null;

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
		constat.description,
		constat.etat || "État non constaté",
		constat.fonctionnement,
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
		(constat.fonctionnement &&
			constat.fonctionnement !== entree.fonctionnement) ||
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
/** Charge la liste en arrière-plan (depuis le suivi), pour l'afficher sans attendre à l'ouverture. */
export function prechargerListeEtatsDesLieux() {
	if (liste) return;
	api("etats-des-lieux", {}, { discret: true })
		.then((chargee) => {
			liste ??= chargee;
		})
		.catch(() => {});
}

function rendreListe() {
	remplacerContenu(
		$("#liste-etats-des-lieux"),
		liste.logements.length > 0
			? liste.logements.map(carteLogement)
			: el("p", { class: "aide vide" }, "Aucun logement loué."),
	);
}

/**
 * Écran de la liste des états des lieux, par logement. La liste déjà chargée s'affiche tout de
 * suite (retour depuis une saisie), puis se met à jour sans barre de chargement ; elle n'est
 * gardée qu'en mémoire, pas sur l'appareil (noms des locataires).
 */
export async function ouvrirListeEtatsDesLieux() {
	definirTitre("États des lieux");
	const dejaChargee = liste !== null;
	if (dejaChargee) {
		rendreListe();
		afficherEcran("etats-des-lieux");
	}
	try {
		liste = await api("etats-des-lieux", {}, { discret: dejaChargee });
	} catch (erreur) {
		if (!dejaChargee) throw erreur;
		return;
	}
	// Pas de retour à la liste si l'on en est parti pendant la mise à jour
	if (location.hash !== "#etats-des-lieux") return;
	rendreListe();
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
		observations: edl.observations,
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

/** Un élément dont on note l'état (pas une vue générale ni un compteur). */
function aConstater(constat) {
	return constat.nature === NATURE_SURFACE || constat.nature === NATURE_OBJET;
}

function nombreConstates(piece) {
	return piece.constats.filter((c) => aConstater(c) && c.etat).length;
}

/** Les pièces montrées en onglets : toutes, sauf celle des compteurs (dans l'onglet Général). */
function piecesAOnglet() {
	return edl.pieces.filter((piece) => piece.nom !== PIECE_COMPTEURS);
}

/** La pièce des compteurs, créée avec ses trois compteurs si elle manque (ancien brouillon). */
function pieceCompteurs() {
	let piece = edl.pieces.find((p) => p.nom === PIECE_COMPTEURS);
	if (!piece) {
		piece = { nom: PIECE_COMPTEURS, constats: [] };
		edl.pieces.unshift(piece);
	}
	for (const element of Object.keys(RELEVES)) {
		if (!piece.constats.some((c) => c.element === element)) {
			piece.constats.push(nouvelElement(element, NATURE_COMPTEUR, ""));
		}
	}
	return piece;
}

function nouvelElement(element, nature, quantite = "") {
	return {
		element,
		nature,
		description: "",
		quantite,
		etat: "",
		fonctionnement: "",
		commentaire: "",
		photos: [],
	};
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
		piecesAOnglet().map((piece) =>
			puce(
				piece.nom,
				`${piece.nom} ${nombreConstates(piece)}/${piece.constats.filter(aConstater).length}`,
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

/** Les onglets dans l'ordre : Général, puis les pièces. */
function ordreOnglets() {
	return [ONGLET_GENERAL, ...piecesAOnglet().map((piece) => piece.nom)];
}

/** Passe à l'onglet voisin (-1 : précédent, +1 : suivant), s'il y en a un. */
function changerOngletVoisin(sens) {
	const ordre = ordreOnglets();
	const voisin = ordre[ordre.indexOf(onglet) + sens];
	if (voisin) changerOnglet(voisin);
}

/** Fait défiler la barre des onglets jusqu'à l'onglet de la pièce affichée. */
function montrerOngletActif() {
	$("#edl-onglets .puce[aria-pressed='true']")?.scrollIntoView({
		block: "nearest",
		inline: "center",
	});
}

/**
 * Balayer l'écran de saisie vers la gauche passe à la pièce suivante, vers la droite à la
 * précédente ; la nouvelle pièce arrive en glissant du côté d'où elle vient. Un balayage surtout
 * vertical (défilement) ou trop court ne compte pas, ni un balayage qui part d'un champ de
 * saisie, de la barre des photos ou de la barre des onglets (qui défile elle-même).
 */
function brancherBalayage() {
	let depart = null;
	const zone = $("#ecran-saisie-edl");
	zone.addEventListener(
		"touchstart",
		(evenement) => {
			const cible = evenement.target;
			depart =
				evenement.touches.length === 1 &&
				!cible.closest("input, textarea, .edl-photos, .edl-onglets")
					? {
							x: evenement.touches[0].clientX,
							y: evenement.touches[0].clientY,
						}
					: null;
		},
		{ passive: true },
	);
	zone.addEventListener("touchend", (evenement) => {
		if (!depart) return;
		const fin = evenement.changedTouches[0];
		const dx = fin.clientX - depart.x;
		const dy = fin.clientY - depart.y;
		depart = null;
		if (Math.abs(dx) < BALAYAGE_MIN_PX || Math.abs(dx) < 1.5 * Math.abs(dy)) {
			return;
		}
		const sens = dx < 0 ? 1 : -1;
		const ordre = ordreOnglets();
		if (!ordre[ordre.indexOf(onglet) + sens]) return;
		changerOngletVoisin(sens);
		const contenu = $("#edl-contenu");
		contenu.classList.remove("arrive-droite", "arrive-gauche");
		void contenu.offsetWidth; // relance l'animation
		contenu.classList.add(sens > 0 ? "arrive-droite" : "arrive-gauche");
	});
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
		el("h3", {}, "Compteurs"),
		pieceCompteurs().constats.map((constat) =>
			carteCompteur(pieceCompteurs(), constat),
		),
		champ(
			"Clés remises",
			{ rows: "2", value: edl.cles, placeholder: "ex : 2 clés porte, 1 badge" },
			(valeur) => {
				edl.cles = valeur;
			},
		),
		champ(
			"Observations générales",
			{
				rows: "3",
				value: edl.observations,
				maxlength: "2000",
				placeholder: "ex : détecteur de fumée présent, non testé",
			},
			(valeur) => {
				edl.observations = valeur;
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

/** Un compteur : numéro, relevé, observations et photos (ex : l'afficheur, l'emplacement). */
function carteCompteur(piece, constat) {
	const cle = RELEVES[constat.element];
	const entree = reference(piece.nom, constat.element);
	const photos = el("div", { class: "edl-photos" });
	const commentaire = el("textarea", {
		rows: "1",
		placeholder: "Observations (emplacement, compteur coupé…)",
		maxlength: "500",
		oninput: (evenement) => {
			constat.commentaire = evenement.target.value;
			marquerModifie();
		},
	});
	commentaire.value = constat.commentaire;
	const carte = el(
		"div",
		{ class: "carte edl-element compteur" },
		el("strong", {}, constat.element),
		entree
			? el("span", { class: "aide" }, `Entrée : ${resumeConstat(entree)}`)
			: null,
		el(
			"div",
			{ class: "deux-champs" },
			champ(
				"Numéro de compteur",
				{ type: "text", value: constat.description, maxlength: "100" },
				(valeur) => {
					constat.description = valeur;
				},
			),
			cle
				? champ(
						"Relevé",
						{
							type: "text",
							inputmode: "decimal",
							value: edl.compteurs[cle],
							placeholder: "ex : 10569 kWh",
						},
						(valeur) => {
							edl.compteurs[cle] = valeur;
						},
					)
				: null,
		),
		commentaire,
		photos,
	);
	rendrePhotos(photos, piece, constat);
	return carte;
}

function ajouterPiece(nom) {
	if (!nom) return;
	if (edl.pieces.some((piece) => piece.nom === nom)) {
		notifier(`La pièce « ${nom} » existe déjà.`, true);
		return;
	}
	edl.pieces.push({
		nom,
		constats: [
			nouvelElement(ELEMENT_VUE_GENERALE, NATURE_VUE),
			...edl.surfaces.map((surface) => nouvelElement(surface, NATURE_SURFACE)),
		],
	});
	marquerModifie();
	changerOnglet(nom);
}

async function supprimerBrouillon() {
	if (!confirm("Supprimer cet état des lieux en cours, et ses photos ?"))
		return;
	clearTimeout(minuterie);
	modifie = false;
	try {
		await api("supprimer-etat-des-lieux", { id: edl.id });
		for (const photo of attente.filter((p) => p.edl === edl.id)) {
			await photosEnAttente.retirer(photo.cle);
		}
		ecrireStockage(cleBrouillon(edl.id), null);
		edl = null;
		location.hash = "#etats-des-lieux";
	} catch (erreur) {
		notifier(erreur.message, true);
	}
}

function imageVignette(id, surRetrait) {
	const image = el("img", { alt: "", "data-photo": id });
	const vignette = vignettes.get(id);
	if (vignette) image.src = `data:image/jpeg;base64,${vignette}`;
	return el(
		"div",
		{ class: "vignette" },
		image,
		surRetrait ? boutonRetirerPhoto(surRetrait) : null,
	);
}

function boutonRetirerPhoto(surRetrait) {
	return el(
		"button",
		{
			type: "button",
			class: "retirer-photo",
			"aria-label": "Retirer la photo",
			onclick: surRetrait,
		},
		"×",
	);
}

/** Les photos d'un élément encore dans la file (pas encore envoyées, ou pas encore rattachées). */
function enAttenteDe(piece, constat) {
	return attente.filter(
		(photo) =>
			photo.edl === edl?.id &&
			photo.piece === piece.nom &&
			photo.element === constat.element &&
			!constat.photos.includes(photo.cle),
	);
}

function rendrePhotos(zone, piece, constat) {
	remplacerContenu(
		zone,
		constat.photos.map((id) =>
			imageVignette(id, () => {
				constat.photos = constat.photos.filter((photo) => photo !== id);
				rendrePhotos(zone, piece, constat);
				marquerModifie();
			}),
		),
		enAttenteDe(piece, constat).map((photo) =>
			el(
				"div",
				{ class: "vignette en-attente", title: "En attente d'envoi" },
				el("img", {
					alt: "",
					src: `data:image/jpeg;base64,${photo.miniature}`,
				}),
				boutonRetirerPhoto(async () => {
					await photosEnAttente.retirer(photo.cle);
					await rafraichirAttente();
					rendrePhotos(zone, piece, constat);
				}),
			),
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

/** La photo réduite pour le PDF, assez petite pour une cellule du classeur. */
async function reduirePhoto(fichier) {
	for (const [taille, qualite] of TAILLES_PHOTO) {
		const photo = await reduireImage(fichier, taille, qualite);
		if (photo.length <= LONGUEUR_MAX_PHOTO) return photo;
	}
	throw new Error("Photo trop lourde : choisis-en une autre.");
}

/** Relit la file, et affiche le nombre de photos qui restent à envoyer. */
async function rafraichirAttente() {
	try {
		attente = await photosEnAttente.lister();
	} catch {
		attente = [];
	}
	const restantes = attente.filter((photo) => !photo.envoyee).length;
	const zone = $("#edl-photos-attente");
	if (zone) {
		zone.textContent = restantes > 0 ? `${restantes} photo(s) à envoyer` : "";
	}
}

/** Range les photos choisies dans la file : la saisie continue, elles partent en arrière-plan. */
async function envoyerPhotos(fichiers) {
	const cible = ciblePhoto;
	if (!cible || !edl) return;
	for (const fichier of fichiers) {
		try {
			await photosEnAttente.ajouter({
				cle: `photo-${crypto.randomUUID()}`,
				edl: edl.id,
				piece: cible.piece.nom,
				element: cible.constat.element,
				miniature: await reduirePhoto(fichier),
			});
		} catch (erreur) {
			notifier(erreur.message, true);
		}
	}
	await rafraichirAttente();
	rendrePhotos(cible.zone, cible.piece, cible.constat);
	pomperPhotos();
}

/**
 * Envoie au classeur les photos de la file, par paquets et par état des lieux. Les photos d'un
 * état des lieux signé ou supprimé entre-temps quittent la file.
 * @throws Sans réseau
 */
async function envoyerPaquets() {
	const aEnvoyer = attente.filter((photo) => !photo.envoyee);
	for (const id of new Set(aEnvoyer.map((photo) => photo.edl))) {
		const duMeme = aEnvoyer.filter((photo) => photo.edl === id);
		for (let i = 0; i < duMeme.length; i += PHOTOS_PAR_ENVOI) {
			const paquet = duMeme.slice(i, i + PHOTOS_PAR_ENVOI);
			try {
				await api(
					"photos-etat-des-lieux",
					{
						id,
						photos: paquet.map(({ cle, miniature }) => ({
							photo: cle,
							miniature,
						})),
					},
					{ discret: true },
				);
			} catch (erreur) {
				if (erreur instanceof ErreurReseau) throw erreur;
				for (const photo of duMeme) await photosEnAttente.retirer(photo.cle);
				notifier(`Photos non envoyées : ${erreur.message}`, true);
				break;
			}
			for (const photo of paquet) {
				await photosEnAttente.modifier(photo.cle, { envoyee: true });
			}
		}
	}
}

/**
 * Ajoute à leur élément les photos envoyées de l'état des lieux ouvert, puis les retire de la file
 * une fois la saisie enregistrée. Une photo dont l'élément a été retiré quitte la file.
 */
async function rattacherPhotos() {
	if (!edl) return;
	const envoyees = attente.filter(
		(photo) => photo.edl === edl.id && photo.envoyee,
	);
	if (envoyees.length === 0) return;
	for (const photo of envoyees) {
		vignettes.set(photo.cle, photo.miniature);
		const constat = edl.pieces
			.find((piece) => piece.nom === photo.piece)
			?.constats.find((c) => c.element === photo.element);
		if (constat && !constat.photos.includes(photo.cle)) {
			constat.photos.push(photo.cle);
		}
	}
	marquerModifie();
	await enregistrer();
	for (const photo of envoyees) await photosEnAttente.retirer(photo.cle);
}

/**
 * Vide la file des photos : envoi au classeur, puis rattachement à leur élément. Un seul passage à
 * la fois ; sans réseau, il s'arrête et repart plus tard (voir initialiserEtatsDesLieux).
 */
function pomperPhotos() {
	pompe ??= (async () => {
		try {
			await rafraichirAttente();
			await envoyerPaquets();
			await rafraichirAttente();
			await rattacherPhotos();
		} catch {
			// Pas de réseau, ou API indisponible : nouvel essai plus tard.
		} finally {
			pompe = null;
			await rafraichirAttente();
			// Les photos arrivées s'affichent, sans interrompre une saisie en cours
			const saisieEnCours = $("#edl-contenu").contains(document.activeElement);
			if (edl && !$("#ecran-saisie-edl").hidden && !saisieEnCours) {
				rendreContenu();
			}
		}
	})();
	return pompe;
}

/**
 * Les boutons d'un choix d'un élément (son état, son fonctionnement) : un appui choisit, un
 * second retire le choix ; rendre() les remet à jour après un changement venu d'ailleurs.
 */
function boutonsChoix(constat, champ, valeurs, classe, surChoix) {
	const zone = el("div", { class: `puces ${classe}` });
	const rendre = () =>
		remplacerContenu(
			zone,
			valeurs.map((valeur) =>
				el(
					"button",
					{
						type: "button",
						class: "puce",
						"aria-pressed": String(constat[champ] === valeur),
						onclick: () => {
							constat[champ] = constat[champ] === valeur ? "" : valeur;
							rendre();
							surChoix();
						},
					},
					valeur,
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
	const vue = constat.nature === NATURE_VUE;
	const etats = boutonsChoix(constat, "etat", edl.etats, "etats", () =>
		apresChangement(),
	);
	const fonctionnements = boutonsChoix(
		constat,
		"fonctionnement",
		edl.fonctionnements ?? [],
		"fonctionnements",
		() => apresChangement(),
	);
	const description = el("input", {
		type: "text",
		class: "description",
		value: constat.description ?? "",
		maxlength: "200",
		placeholder: "Description (matériau, couleur…)",
		oninput: (evenement) => {
			constat.description = evenement.target.value;
			marquerModifie();
		},
	});

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
		vue
			? el(
					"span",
					{ class: "aide" },
					"Photos d'ensemble de la pièce, prises depuis l'entrée et les angles",
				)
			: description,
		entree && !vue
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
								constat.fonctionnement = entree.fonctionnement;
								constat.quantite = entree.quantite;
								quantite.value =
									entree.quantite === "" ? "" : String(entree.quantite);
								etats.rendre();
								fonctionnements.rendre();
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
		vue ? null : etats.zone,
		vue ? null : fonctionnements.zone,
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
							piece.constats.push(nouvelElement(nom, NATURE_OBJET, 1));
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
	const piece = piecesAOnglet().find((p) => p.nom === onglet);
	if (!piece) onglet = ONGLET_GENERAL;
	remplacerContenu(
		$("#edl-contenu"),
		piece ? rendrePiece(piece) : rendreGeneral(),
	);
	montrerOngletActif();
	chargerVignettesManquantes();
}

/** Charge, par paquets, les vignettes des photos affichées qui ne sont pas encore connues. */
async function chargerVignettesManquantes() {
	const images = [...document.querySelectorAll("#edl-contenu img[data-photo]")];
	const manquantes = [
		...new Set(
			images
				.map((image) => image.dataset.photo)
				.filter((id) => !vignettes.has(id)),
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
			"#edl-contenu img[data-photo]",
		)) {
			const vignette = vignettes.get(image.dataset.photo);
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
			observations: garde.observations ?? edl.observations,
			pieces: garde.pieces,
		});
		modifie = true;
		notifier("Saisie non envoyée reprise sur ce téléphone.");
		enregistrer().catch(() => {});
	}
	await rafraichirAttente();
	pomperPhotos();
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
			.filter((constat) => aConstater(constat) && !constat.etat)
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
	await pomperPhotos();
	const restantes = attente.filter((photo) => photo.edl === id).length;
	if (restantes > 0) {
		notifier(
			`${restantes} photo(s) pas encore envoyée(s) : attends le réseau avant de signer.`,
			true,
		);
		location.hash = `#etat-des-lieux/${id}`;
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
	remplacerContenu(
		$("#edl-signatures"),
		el(
			"label",
			{ class: "carte edl-general champ" },
			el("span", {}, "Réserves des locataires (facultatif)"),
			el("textarea", {
				id: "edl-reserves",
				rows: "3",
				maxlength: "2000",
				placeholder:
					"Ce que les locataires veulent faire noter avant de signer",
			}),
		),
	);
	$("#edl-erreur-signature").textContent = "";
	afficherEcran("signature-edl");
	paves = edl.locataires.map(blocSignature);
	majBoutonSigner();
}

async function signer() {
	const sansEtat = edl.pieces.some((piece) =>
		piece.constats.some((constat) => aConstater(constat) && !constat.etat),
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
			reserves: $("#edl-reserves")?.value ?? "",
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
	brancherBalayage();
	$("#edl-vers-signature").addEventListener("click", () => {
		location.hash = `#signer-etat-des-lieux/${edl.id}`;
	});
	$("#edl-signer").addEventListener("click", signer);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") quitterSaisieEtatDesLieux();
	});
	window.addEventListener("beforeunload", (evenement) => {
		if (modifie || attente.some((photo) => !photo.envoyee))
			evenement.preventDefault();
	});
	window.addEventListener("online", () => pomperPhotos());
	setInterval(() => {
		if (attente.length > 0) pomperPhotos();
	}, DELAI_NOUVEL_ESSAI_MS);
	pomperPhotos();
}
