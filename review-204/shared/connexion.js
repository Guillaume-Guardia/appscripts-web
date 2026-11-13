// Connexion aux apps : un compte par personne (projet droits), créé par un lien d'invitation. Un
// appareil se connecte par un QR code ou un lien (affiché par un appareil déjà connecté, ou généré
// dans l'app Droits), ou par la biométrie une fois activée. Juste après une connexion, l'app
// propose d'activer la biométrie sur l'appareil.
// Un lien d'invitation (QR code) ouvert sur l'appareil le connecte aussitôt, en créant le compte
// d'une nouvelle personne invitée, puis l'app propose la biométrie et l'installation.
// La clé de session est gardée par le navigateur, dans le stockage que partagent les apps de
// l'origine (une seule connexion pour toutes, sauf les apps installées sur iPhone, qui ont chacune
// leur stockage : un lien de connexion est copié avant l'installation, à coller dans l'app
// installée), et envoyée à chaque API, qui retrouve le compte dans le classeur Droits.

import { creerApi } from "./api.js";
import {
	biometrieDisponible,
	creerCleBiometrie,
	signerDefiBiometrie,
} from "./biometrie.js";
import { el, notifier, remplacerContenu } from "./dom.js";
import {
	boutonInstallation,
	definirLienConnexion,
	estInstallee,
	proposerInstallation,
} from "./pwa.js";
import { ouvrirQr } from "./qr.js";
import { ouvrirSignalement } from "./signalement.js";
import { ecrireStockage, lireStockage, lireStockageJson } from "./stockage.js";

const CLES = {
	session: "appscripts.session",
	compte: "appscripts.compte",
	/** Accès du compte (apps ouvertes, liens des classeurs), gardés pour ne pas attendre l'API. */
	acces: "appscripts.acces",
	/** Modes de connexion activés, gardés pour afficher la connexion sans attendre l'API. */
	modes: "appscripts.modes",
	/** Biométrie de l'appareil : « oui » (activée), « non » (proposée et refusée). */
	biometrie: "appscripts.biometrie",
	/** Identifiant de la clé biométrique qui a marché ici : la seule proposée à la connexion. */
	cleBiometrie: "appscripts.cleBiometrie",
};

/** Modes de connexion d'un compte existant, tant que l'API ne les a pas donnés : tous. */
const MODES_PAR_DEFAUT = { qr: true, biometrie: true };

/** Le défi de la biométrie vit 5 minutes sur le serveur : renouvelé avant, écran resté ouvert. */
const DELAI_RENOUVELLEMENT_DEFI_MS = 4 * 60 * 1000;
let renouvellementDefi = null;
/** Renouvelle le défi au retour sur l'app, pour le dernier écran de connexion affiché. */
let surRetourApp = null;

/** Clé de session de l'appareil, ou null s'il n'est pas connecté. */
export const lireSession = () => lireStockage(CLES.session);

/** Compte connecté ({ id, prenom }), tel qu'à la dernière connexion, ou null. */
export const compteConnecte = () => lireStockageJson(CLES.compte);

/** Fonctions appelées quand les accès gardés changent (voir brancherBoutonPortail). */
const ecouteursAcces = new Set();
const annoncerAcces = () => {
	for (const ecouteur of ecouteursAcces) ecouteur(accesGardes());
};

function garderConnexion({ session, compte }) {
	ecrireStockage(CLES.session, session);
	ecrireStockage(CLES.compte, JSON.stringify(compte));
	ecrireStockage(CLES.acces, null);
	annoncerAcces();
}

/** Oublie la connexion de l'appareil (sans prévenir l'API). */
export function oublierConnexion() {
	ecrireStockage(CLES.session, null);
	ecrireStockage(CLES.compte, null);
	ecrireStockage(CLES.acces, null);
	annoncerAcces();
}

/** L'API a refusé la session (fermée, compte bloqué) : il faut reconnecter l'appareil. */
export const estSessionRefusee = (erreur) =>
	/Session expirée/.test(erreur?.message ?? "");

/**
 * Le compte connecté n'a pas accès à l'app (onglet Droits du projet droits) : l'app le dit, sans
 * déconnecter l'appareil (la session sert aux autres apps).
 */
export const estAccesRefuse = (erreur) =>
	/Pas encore accès/.test(erreur?.message ?? "");

/** API du projet droits (adresse dans shared/config.js). */
const appelerDroits = creerApi({
	url: window.API_DROITS,
	identifiants: () => ({ session: lireSession() }),
});

/** Déconnecte l'appareil : sa session est fermée (si le réseau le permet) puis oubliée. */
export async function deconnecter() {
	try {
		await appelerDroits("deconnecter");
	} catch {
		// Hors ligne : la session reste ouverte côté serveur, mais l'appareil l'oublie.
	}
	oublierConnexion();
}

/**
 * Accès du compte connecté (onglet Droits du projet droits) : `apps`, les clés des apps qui lui
 * sont ouvertes (ex : « voyage ») ; `tableaux`, les liens des classeurs ({ projet, nom, url }),
 * vide s'il n'a pas le droit de les voir ; `portail`, vrai s'il voit le bouton « Mes apps ». Appel
 * discret, gardé sur l'appareil pour accesGardes.
 * @throws Si l'API refuse (hors ligne, session fermée)
 */
export async function accesDuCompte() {
	const {
		apps,
		tableaux = [],
		portail = false,
	} = await appelerDroits("moi", {}, { discret: true });
	const acces = { apps, tableaux, portail };
	// Déconnecté pendant l'appel : rien à garder.
	if (lireSession()) {
		ecrireStockage(CLES.acces, JSON.stringify(acces));
		annoncerAcces();
	}
	return acces;
}

/** Accès du compte à la dernière réponse de l'API (voir accesDuCompte), ou null. */
export const accesGardes = () => lireStockageJson(CLES.acces);

/**
 * Bouton « Mes apps » de l'en-tête (lien vers le portail, `a[href="../"]`) : seulement pour les
 * comptes qui ont le droit Portail (onglet Droits du projet droits). Masqué tant que ce droit n'est
 * pas connu : les accès gardés l'affichent aussitôt, puis la réponse de l'API (appel discret, en
 * fond) les confirme. Suit les connexions et déconnexions.
 * @param rafraichir Faux si l'app demande déjà les accès elle-même (voir exigerAccesApp)
 */
export function brancherBoutonPortail({ rafraichir = true } = {}) {
	const afficher = (acces) => {
		for (const lien of document.querySelectorAll('a[href="../"]')) {
			lien.hidden = !acces?.portail;
		}
	};
	afficher(accesGardes());
	ecouteursAcces.add(afficher);
	if (rafraichir && lireSession()) accesDuCompte().catch(() => {});
}

/** Change le prénom du compte connecté. @return Le compte à jour */
export async function modifierPrenom(prenom) {
	const compte = await appelerDroits("modifier-profil", { prenom });
	ecrireStockage(CLES.compte, JSON.stringify(compte));
	return compte;
}

/** Code d'invitation d'un lien de connexion (…#invitation=<code>), ou null. */
export function invitationDuLien(texte) {
	const trouve = /#invitation=([0-9a-f]+)/i.exec(String(texte));
	return trouve ? trouve[1] : null;
}

/** Lien de connexion de l'app pour une invitation (le code après « # » n'est pas envoyé au site). */
export const lienInvitation = (
	code,
	page = `${location.origin}${location.pathname}`,
) => `${page}#invitation=${code}`;

// Avant d'installer l'app sur iPhone : lien de connexion pour l'app installée (shared/pwa.js).
definirLienConnexion(async () =>
	lireSession()
		? lienInvitation(await appelerDroits("lien-installation"))
		: null,
);

/** Clé de l'app ouverte (dossier de sa page, ex : « voyage »), comme dans l'onglet Droits. */
const cleApp = () =>
	location.pathname
		.replace(/\/[^/]*\.html$/, "")
		.split("/")
		.filter(Boolean)
		.at(-1);

/**
 * Invite une nouvelle personne : QR code (ou lien à envoyer) qui crée son compte avec ce prénom,
 * lui ouvre les apps et connecte son appareil. Valable 7 jours, une fois.
 * @param prenom Prénom de la personne invitée
 * @param apps Clés des apps à lui ouvrir (le compte connecté doit les avoir, sauf l'admin)
 * @param page Page où mène le lien (par défaut, celle de l'app ouverte)
 * @param nomApp Nom de l'app, pour le message qui accompagne le lien envoyé
 * @throws Si l'API refuse (prénom déjà pris, app qui ne peut pas être ouverte, hors ligne)
 */
export async function inviterPersonne({ prenom, apps, page, nomApp }) {
	const code = await appelerDroits("inviter-personne", { prenom, apps });
	const nom = prenom.trim();
	ouvrirQr({
		titre: `Inviter ${nom}`,
		aide: `Fais scanner ce QR code à ${nom}, ou envoie-lui le lien : l'app s'ouvre sur son téléphone, son compte est créé et connecté. Valable 7 jours, une seule fois ; envoie-le à ${nom} seulement.`,
		lien: lienInvitation(code, page),
		texteEnvoi: `${nom}, voici ton invitation à l'app ${nomApp} : ouvre ce lien sur ton téléphone (il est personnel, ne le transfère pas).`,
	});
}

/**
 * Menu « Inviter quelqu'un » : prénom de la personne, puis QR code qui lui crée un compte avec
 * accès à l'app ouverte (inviterPersonne).
 * @param nomApp Nom de l'app
 */
export function ouvrirInvitation(nomApp) {
	const prenom = el("input", {
		id: "invitation-prenom",
		required: true,
		autocomplete: "off",
		maxlength: "40",
	});
	const dialogue = el(
		"dialog",
		{ class: "dialogue", onclose: () => dialogue.remove() },
		el("h2", {}, "Inviter quelqu'un"),
		el(
			"form",
			{
				class: "formulaire",
				onsubmit: async (e) => {
					e.preventDefault();
					const bouton = e.submitter ?? e.target.querySelector("[type=submit]");
					bouton.disabled = true;
					try {
						await inviterPersonne({
							prenom: prenom.value,
							apps: [cleApp()],
							nomApp,
						});
						dialogue.close();
					} catch (erreur) {
						notifier(erreur.message, true);
					} finally {
						bouton.disabled = false;
					}
				},
			},
			el(
				"p",
				{ class: "aide" },
				`Pour quelqu'un qui n'a pas encore de compte : son lien lui crée un compte, avec accès à ${nomApp}.`,
			),
			el("label", { for: "invitation-prenom" }, "Son prénom"),
			prenom,
			el(
				"div",
				{ class: "boutons" },
				el(
					"button",
					{ type: "button", onclick: () => dialogue.close() },
					"Annuler",
				),
				el(
					"button",
					{ type: "submit", class: "bouton-principal" },
					"Créer l'invitation",
				),
			),
		),
	);
	document.body.append(dialogue);
	dialogue.showModal();
}

/**
 * Affiche le QR code qui connecte un autre appareil au compte (valable 15 minutes, une fois).
 * @param nomApp Nom de l'app, pour le message qui accompagne le lien envoyé
 * @throws Si l'API refuse (hors ligne, session fermée, QR code désactivé)
 */
export async function connecterUnAutreAppareil(nomApp) {
	const code = await appelerDroits("inviter-appareil");
	ouvrirQr({
		titre: "Connecter un autre appareil",
		aide: "À scanner avec l'appareil photo de l'autre téléphone : l'app s'y ouvre, connectée à ton compte. Valable 15 minutes, une seule fois. Ne le montre qu'à toi-même : il donne accès à ton compte.",
		lien: lienInvitation(code),
		texteEnvoi: `Pour connecter cet appareil à ton compte ${nomApp} :`,
	});
}

/** Description de l'appareil, pour s'y retrouver dans les onglets Sessions et Biométrie. */
export function decrireAppareil(nomApp) {
	const plateforme =
		navigator.userAgentData?.platform || navigator.platform || "appareil";
	return `${nomApp} · ${plateforme}`;
}

/**
 * Modes de connexion activés ({ code, lien, qr, biometrie }) : ceux gardés de la dernière réponse
 * de l'API (ou tous), et une promesse de ceux de l'API.
 */
function modesConnexion() {
	const garde = lireStockageJson(CLES.modes) ?? MODES_PAR_DEFAUT;
	const frais = appelerDroits("modes-connexion")
		.then((modes) => {
			ecrireStockage(CLES.modes, JSON.stringify(modes));
			return modes;
		})
		.catch(() => garde);
	return { garde, frais };
}

/**
 * Active la biométrie sur l'appareil connecté : à appeler au toucher d'un bouton (le navigateur
 * l'exige), avec la réponse de preparer-biometrie demandée avant.
 * @throws Si l'appareil ou l'API refuse
 */
async function activerBiometrie(preparation, nomApp) {
	const cle = await creerCleBiometrie(preparation);
	await appelerDroits("activer-biometrie", {
		...cle,
		appareil: decrireAppareil(nomApp),
	});
	ecrireStockage(CLES.biometrie, "oui");
	ecrireStockage(CLES.cleBiometrie, cle.identifiant);
}

/**
 * Juste après une connexion : propose d'activer la biométrie sur l'appareil (un geste), si elle
 * est activée par l'admin, possible sur l'appareil, et ni activée ni refusée ici.
 * @return Promesse résolue une fois la fenêtre fermée (ou aussitôt, sans fenêtre)
 */
async function proposerBiometrie(nomApp, modes) {
	if (!modes.biometrie || lireStockage(CLES.biometrie)) return;
	if (!(await biometrieDisponible())) return;
	let preparation;
	try {
		// Demandé avant le toucher : le navigateur veut la biométrie aussitôt après le geste.
		preparation = await appelerDroits("preparer-biometrie");
	} catch {
		return;
	}
	const dialogue = el(
		"dialog",
		{ class: "dialogue", onclose: () => dialogue.remove() },
		el("h2", {}, "Activer la biométrie ?"),
		el(
			"p",
			{ class: "aide" },
			"La prochaine fois, connecte-toi d'un geste : empreinte, visage ou code de cet appareil. Ils ne quittent pas l'appareil.",
		),
		el(
			"div",
			{ class: "boutons" },
			el(
				"button",
				{
					type: "button",
					onclick: () => {
						ecrireStockage(CLES.biometrie, "non");
						dialogue.close();
					},
				},
				"Plus tard",
			),
			el(
				"button",
				{
					type: "button",
					class: "bouton-principal",
					onclick: async (e) => {
						const bouton = e.currentTarget;
						bouton.disabled = true;
						try {
							await activerBiometrie(preparation, nomApp);
							notifier("Biométrie activée.");
							dialogue.close();
						} catch (erreur) {
							notifier(erreur.message, true);
							bouton.disabled = false;
						}
					},
				},
				"Activer",
			),
		),
	);
	document.body.append(dialogue);
	dialogue.showModal();
	await new Promise((resolve) => {
		dialogue.addEventListener("close", resolve);
	});
}

/**
 * Juste après une connexion par un lien d'invitation (QR code) : biométrie, puis installation de
 * l'app (sur iPhone, l'app installée aura un lien de connexion copié, ou la biométrie).
 */
async function accueillir(nomApp, modes) {
	await proposerBiometrie(nomApp, modes);
	await proposerInstallation({ connexion: true });
}

/**
 * Connexion obtenue par le lien d'invitation d'une app (compte créé, ou retrouvé sur un appareil
 * sans session) : gardée sur l'appareil, puis l'app propose la biométrie et l'installation.
 * @param connexion Session et compte ({ session, compte })
 * @param nomApp Nom de l'app, pour décrire l'appareil
 */
export function garderConnexionInvitee(connexion, nomApp) {
	garderConnexion(connexion);
	accueillir(nomApp, lireStockageJson(CLES.modes) ?? MODES_PAR_DEFAUT);
}

/**
 * Interrupteur « Biométrie » du menu d'une app : active ou désactive la biométrie sur cet appareil.
 * Masqué si l'admin l'a désactivée pour toutes les apps, ou si l'appareil n'en est pas capable.
 * Rien n'est demandé à l'API à l'ouverture de l'app : les modes de connexion et le défi de
 * l'activation (à avoir avant le toucher, le navigateur veut la biométrie aussitôt après le geste)
 * sont demandés quand le menu s'ouvre.
 * @param bouton Bouton du menu (aria-checked : activée ou non)
 * @param nomApp Nom de l'app, pour décrire l'appareil
 */
export function brancherBiometrie(bouton, nomApp) {
	let preparation = null;
	let preparationObtenueLe = 0;
	let enCours = false;
	const activee = () => lireStockage(CLES.biometrie) === "oui";
	const afficher = () => {
		bouton.setAttribute("aria-checked", String(activee()));
	};
	const montrer = async (modes) => {
		bouton.hidden = !(modes.biometrie && (await biometrieDisponible()));
	};
	const preparer = async () => {
		const fraiche =
			preparation &&
			Date.now() - preparationObtenueLe < DELAI_RENOUVELLEMENT_DEFI_MS;
		if (bouton.hidden || activee() || fraiche) return;
		preparation = null;
		try {
			preparation = await appelerDroits("preparer-biometrie");
			preparationObtenueLe = Date.now();
		} catch {
			// Sans défi (hors ligne) : il sera redemandé au toucher.
		}
	};

	afficher();
	montrer(lireStockageJson(CLES.modes) ?? MODES_PAR_DEFAUT);
	const menu = bouton.closest(".menu") ?? bouton.parentElement;
	new MutationObserver(async () => {
		if (menu.hidden) return;
		afficher();
		await montrer(await modesConnexion().frais);
		preparer();
	}).observe(menu, { attributes: true, attributeFilter: ["hidden"] });

	bouton.addEventListener("click", async () => {
		if (enCours) return;
		enCours = true;
		try {
			if (activee()) {
				await appelerDroits("desactiver-biometrie", {
					identifiant: lireStockage(CLES.cleBiometrie),
				});
				ecrireStockage(CLES.biometrie, "non");
				ecrireStockage(CLES.cleBiometrie, null);
				notifier("Biométrie désactivée sur cet appareil.");
			} else {
				const defi = preparation ?? (await appelerDroits("preparer-biometrie"));
				// Un défi ne sert qu'une fois.
				preparation = null;
				await activerBiometrie(defi, nomApp);
				notifier("Biométrie activée.");
			}
		} catch (erreur) {
			// La clé de l'appareil est déjà celle du compte : la biométrie y est bien activée.
			if (/déjà activée/.test(erreur.message)) {
				ecrireStockage(CLES.biometrie, "oui");
			}
			notifier(erreur.message, true);
		} finally {
			enCours = false;
			afficher();
			preparer();
		}
	});
}

/**
 * Affiche la connexion dans `conteneur` : biométrie (si le mode est activé), ou lien d'un QR code
 * collé. Un compte ne se crée que par un lien d'invitation (paramètre invitation).
 * @param nomApp Nom de l'app, pour décrire l'appareil
 * @param surConnecte Appelée avec le compte, une fois connecté
 * @param message Message à afficher (ex : session expirée)
 * @param invitation Code d'un lien de connexion ouvert sur l'appareil (invitationDuLien) : utilisé
 * aussitôt (celui d'une nouvelle personne crée son compte), puis l'app propose de s'installer
 * @param ouvrirLienApp Reçoit un lien collé dans un format propre à l'app (ex : « #cle= » de
 * Cadeaux) et rend vrai s'il l'a pris en charge
 * @param scanner Ouvre le lecteur de QR code de l'app (bouton absent sans lui)
 */
export function afficherConnexion(
	conteneur,
	{
		nomApp,
		surConnecte,
		message = "",
		invitation = null,
		ouvrirLienApp = null,
		scanner = null,
	},
) {
	const erreur = el("p", { class: "erreur", role: "alert" }, message);
	const { garde, frais } = modesConnexion();
	let modes = garde;
	/**
	 * Défi de connexion par la biométrie, demandé d'avance : l'iPhone refuse la clé si elle n'est
	 * pas demandée aussitôt après le toucher. Le bouton reste inactif tant que le défi n'est pas là.
	 */
	let defi = null;
	let defiObtenuLe = 0;
	let defiEnCours = false;
	let boutonBiometrie = null;

	function actualiserBoutonBiometrie() {
		if (!boutonBiometrie) return;
		boutonBiometrie.disabled = defiEnCours;
		boutonBiometrie.textContent = defi
			? "Me connecter avec la biométrie"
			: defiEnCours
				? "Préparation de la biométrie…"
				: "Réessayer la biométrie";
	}

	async function demanderDefi() {
		clearTimeout(renouvellementDefi);
		defi = null;
		defiEnCours = true;
		actualiserBoutonBiometrie();
		try {
			defi = await appelerDroits("defi-biometrie", {}, { discret: true });
			defiObtenuLe = Date.now();
			renouvellementDefi = setTimeout(() => {
				if (conteneur.isConnected && !lireSession()) demanderDefi();
			}, DELAI_RENOUVELLEMENT_DEFI_MS);
		} catch {
			// Le bouton propose de réessayer.
		}
		defiEnCours = false;
		actualiserBoutonBiometrie();
	}

	// App mise en arrière-plan : le téléphone suspend le minuteur, et le défi expire sans être
	// renouvelé. Au retour, il est redemandé avant que le bouton ne redevienne actif.
	document.removeEventListener("visibilitychange", surRetourApp);
	surRetourApp = () => {
		if (document.hidden || !defi || lireSession()) return;
		if (Date.now() - defiObtenuLe >= DELAI_RENOUVELLEMENT_DEFI_MS) {
			demanderDefi();
		}
	};
	document.addEventListener("visibilitychange", surRetourApp);
	/**
	 * Invitation d'une nouvelle personne dont le prénom est déjà pris : une fois l'appareil connecté
	 * (à son compte, ou à un nouveau), elle ouvre ses apps à ce compte.
	 */
	let invitationEnAttente = null;

	/**
	 * Garde la connexion, la signale à l'app, puis propose la biométrie (et l'installation, après
	 * un lien d'invitation).
	 */
	async function terminer(connexion, parBiometrie = false) {
		garderConnexion(connexion);
		if (parBiometrie) ecrireStockage(CLES.biometrie, "oui");
		if (invitationEnAttente) {
			try {
				await appelerDroits("utiliser-invitation", {
					invitation: invitationEnAttente,
					pourMonCompte: true,
				});
			} catch {
				// Expirée entre-temps : le compte est connecté, sans ces apps.
			}
			invitationEnAttente = null;
		}
		surConnecte(connexion.compte);
		accesDuCompte().catch(() => {});
		if (invitation) accueillir(nomApp, parBiometrie ? {} : modes);
		else if (!parBiometrie) proposerBiometrie(nomApp, modes);
	}

	/** Lance une connexion : bouton désactivé et erreur effacée pendant l'appel. */
	async function connecter(bouton, action, parametres) {
		if (bouton) bouton.disabled = true;
		erreur.textContent = "";
		try {
			await terminer(
				await appelerDroits(action, {
					...parametres,
					appareil: decrireAppareil(nomApp),
				}),
			);
		} catch (e) {
			erreur.textContent = e.message;
			if (
				action === "utiliser-invitation" &&
				/Il y a déjà un compte/.test(e.message)
			) {
				invitationEnAttente = parametres.invitation;
			}
		} finally {
			if (bouton) bouton.disabled = false;
		}
	}

	/**
	 * App installée sur iPhone : elle ne partage pas la connexion du navigateur. Le lien de connexion
	 * a été copié avant l'installation : un bouton le colle.
	 */
	function collerLienCopie() {
		if (!estInstallee || lireSession()) return [];
		return [
			el(
				"p",
				{ class: "aide" },
				"Tu viens d'installer l'app ? Ton lien de connexion a été copié avant l'installation.",
			),
			el(
				"button",
				{
					type: "button",
					class: "bouton-principal",
					onclick: async (e) => {
						const bouton = e.currentTarget;
						erreur.textContent = "";
						let texte = "";
						try {
							texte = await navigator.clipboard.readText();
						} catch {
							// Collage refusé : le message ci-dessous.
						}
						if (ouvrirLienApp?.(texte)) return;
						const code = invitationDuLien(texte);
						if (!code) {
							erreur.textContent =
								"Pas de lien de connexion copié : colle-le dans le champ ci-dessous, ou scanne le QR code.";
							return;
						}
						connecter(bouton, "utiliser-invitation", { invitation: code });
					},
				},
				"Coller mon lien de connexion",
			),
		];
	}

	async function connecterParBiometrie(e) {
		erreur.textContent = "";
		if (!defi) {
			demanderDefi();
			return;
		}
		const valeur = defi;
		defi = null;
		e.currentTarget.disabled = true;
		try {
			// Rien à attendre avant cet appel : il doit suivre le toucher (voir defi).
			const signature = await signerDefiBiometrie(
				valeur,
				lireStockage(CLES.cleBiometrie),
			);
			const connexion = await appelerDroits("connecter-biometrie", {
				...signature,
				appareil: decrireAppareil(nomApp),
			});
			ecrireStockage(CLES.cleBiometrie, signature.identifiant);
			await terminer(connexion, true);
		} catch (erreurBiometrie) {
			erreur.textContent = erreurBiometrie.message;
			// Clé supprimée côté serveur : l'activation sera reproposée.
			if (/Biométrie inconnue/.test(erreurBiometrie.message)) {
				ecrireStockage(CLES.biometrie, null);
			}
			// Clé refusée, absente de l'appareil ou geste annulé : toutes les clés au prochain essai.
			if (/Biométrie (inconnue|annulée)/.test(erreurBiometrie.message)) {
				ecrireStockage(CLES.cleBiometrie, null);
			}
			// Le défi a pu servir : un neuf pour le prochain essai.
			demanderDefi();
		}
	}

	function carteBiometrie() {
		boutonBiometrie = el("button", {
			type: "button",
			class: "bouton-principal",
			onclick: connecterParBiometrie,
		});
		actualiserBoutonBiometrie();
		return el(
			"div",
			{ class: "carte formulaire" },
			boutonBiometrie,
			el(
				"p",
				{ class: "aide" },
				"Empreinte, visage ou code de l'appareil, si tu l'as activée.",
			),
		);
	}

	function carteLien() {
		const lien = el("input", {
			id: "connexion-lien",
			type: "url",
			inputmode: "url",
			required: true,
			autocomplete: "off",
			placeholder: "https://…",
		});
		return el(
			"form",
			{
				class: "carte formulaire",
				onsubmit: (e) => {
					e.preventDefault();
					if (ouvrirLienApp?.(lien.value)) return;
					const code = invitationDuLien(lien.value);
					if (!code) {
						erreur.textContent = "Ce n'est pas un lien de connexion.";
						return;
					}
					connecter(
						e.submitter ?? e.target.querySelector("[type=submit]"),
						"utiliser-invitation",
						{ invitation: code },
					);
				},
			},
			el("h3", { class: "titre-carte" }, "Lien de connexion"),
			...collerLienCopie(),
			el(
				"p",
				{ class: "aide" },
				modes.qr
					? "Scanne le QR code reçu avec l'appareil photo, ou touche le lien reçu. Connecté sur un autre appareil ? Sur celui-là : menu → « Connecter un autre appareil »."
					: "Scanne le QR code reçu avec l'appareil photo, ou touche le lien reçu.",
			),
			el(
				"label",
				{ for: "connexion-lien" },
				"Le lien n'ouvre pas cette app ? Colle-le ici",
			),
			lien,
			el("button", { type: "submit" }, "Connecter cet appareil"),
			scanner
				? el(
						"button",
						{ type: "button", onclick: scanner },
						"Scanner un QR code",
					)
				: null,
			el(
				"p",
				{ class: "aide" },
				"Pas de QR code ni de lien ? Demande-le à Guillaume.",
			),
		);
	}

	async function afficher() {
		const biometrie = modes.biometrie && (await biometrieDisponible());
		if (biometrie && !defi && !defiEnCours) demanderDefi();
		remplacerContenu(
			conteneur,
			biometrie && carteBiometrie(),
			carteLien(),
			erreur,
			// Le menu (et son « Installer l'app ») n'est pas affiché avant la connexion.
			boutonInstallation({ connexion: true }),
			// Pas encore de compte, ou la connexion ne marche pas : le dire quand même.
			el(
				"button",
				{
					type: "button",
					class: "lien-signalement",
					onclick: () => ouvrirSignalement({ app: nomApp }),
				},
				"Une suggestion ou un bug ?",
			),
		);
	}

	afficher();
	if (!window.API_DROITS) {
		erreur.textContent =
			"L'adresse de l'API de connexion n'est pas configurée (shared/config.js).";
		return;
	}
	// Modes changés par l'admin depuis la dernière fois : l'écran est refait, sauf pendant une
	// saisie (rare).
	frais.then((recus) => {
		if (JSON.stringify(recus) === JSON.stringify(modes)) return;
		modes = recus;
		if (conteneur.isConnected && !conteneur.contains(document.activeElement)) {
			afficher();
		}
	});
	if (invitation) {
		if (lireSession()) confirmerLienSurAppareilConnecte(invitation);
		else utiliserLien(invitation);
	}

	function utiliserLien(code) {
		erreur.textContent = "Connexion…";
		connecter(null, "utiliser-invitation", { invitation: code });
	}

	/**
	 * Lien ouvert sur un appareil déjà connecté : il remplacerait sa connexion, et l'invitation d'une
	 * autre personne serait consommée. L'appareil ne l'utilise que si on le confirme.
	 */
	function confirmerLienSurAppareilConnecte(code) {
		let utiliser = false;
		const prenom = compteConnecte()?.prenom ?? "ton compte";
		const dialogue = el(
			"dialog",
			{
				class: "dialogue",
				onclose: () => {
					dialogue.remove();
					if (utiliser) utiliserLien(code);
					else location.reload();
				},
			},
			el("h2", {}, "Cet appareil est déjà connecté"),
			el(
				"p",
				{ class: "aide" },
				`Ce lien remplacerait la connexion de ${prenom}. S'il est pour quelqu'un d'autre, garde ce compte : le lien restera valable.`,
			),
			el(
				"div",
				{ class: "boutons" },
				el(
					"button",
					{
						type: "button",
						onclick: () => {
							utiliser = true;
							dialogue.close();
						},
					},
					"Utiliser ce lien",
				),
				el(
					"button",
					{
						type: "button",
						class: "bouton-principal",
						onclick: () => dialogue.close(),
					},
					"Garder ce compte",
				),
			),
		);
		document.body.append(dialogue);
		dialogue.showModal();
	}
}

/**
 * App sans API à elle (Investissement, Perudo) : réservée aux comptes qui y ont accès (onglet
 * Droits du projet droits). Ses calculs se font sur l'appareil : ce contrôle range les apps de
 * chacun, il ne protège pas de données. La page a `#ecran-connexion` (avec `#connexion`),
 * `#ecran-refus` (avec `#message-refus` et `#bouton-deconnecter-refus`) et `#ecran-app`. Les accès
 * gardés sur l'appareil ouvrent l'app aussitôt, puis la réponse de l'API confirme ; hors ligne, ils
 * suffisent.
 * @param cle Clé de l'app dans l'onglet Droits (ex : « perudo »)
 * @param nomApp Nom de l'app (écran de connexion, description de l'appareil)
 * @param surOuverte Appelée avec le compte quand l'app s'ouvre (carte du menu…)
 * @return seDeconnecter : déconnecte l'appareil et revient à la connexion
 */
export function exigerAccesApp({ cle, nomApp, surOuverte = () => {} }) {
	const $ = (selecteur) => document.querySelector(selecteur);
	const afficher = (nom) => {
		for (const ecran of ["connexion", "refus", "app"]) {
			$(`#ecran-${ecran}`).hidden = ecran !== nom;
		}
		$("#bouton-menu").hidden = nom !== "app";
	};
	const ouvrir = () => {
		afficher("app");
		surOuverte(compteConnecte());
	};
	const refuser = () => {
		$("#message-refus").textContent =
			`Pas encore accès à ${nomApp} : demande-le à Guillaume.`;
		afficher("refus");
	};
	const proposerConnexion = (message = "", invitation = null) => {
		afficher("connexion");
		afficherConnexion($("#connexion"), {
			nomApp,
			message,
			invitation,
			surConnecte: verifier,
		});
	};
	async function verifier() {
		const permise = Boolean(accesGardes()?.apps?.includes(cle));
		if (permise) ouvrir();
		try {
			const { apps } = await accesDuCompte();
			if (apps.includes(cle)) ouvrir();
			else refuser();
		} catch (erreur) {
			if (estSessionRefusee(erreur)) {
				oublierConnexion();
				proposerConnexion(erreur.message);
			} else if (!permise) {
				afficher("connexion");
				$("#connexion").textContent =
					"Impossible de vérifier ton accès. Vérifie ta connexion, puis rouvre l'app.";
			}
		}
	}
	const seDeconnecter = async () => {
		await deconnecter();
		proposerConnexion();
	};

	brancherBoutonPortail({ rafraichir: false });
	$("#bouton-deconnecter-refus").addEventListener("click", seDeconnecter);
	// Lien de connexion d'un appareil (…#invitation=<code>), retiré aussitôt de l'adresse.
	const invitation = invitationDuLien(location.hash);
	if (invitation) history.replaceState(null, "", location.pathname);
	if (invitation || !lireSession()) proposerConnexion("", invitation);
	else verifier();
	return { seDeconnecter };
}
