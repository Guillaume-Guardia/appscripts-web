// Connexion aux apps : un compte par personne (projet droits), créé avec son prénom. Un appareil se
// connecte ensuite au même compte par la biométrie, un code ou un lien reçu par e-mail, ou le QR
// code (ou le lien) affiché par un appareil déjà connecté, selon les modes activés par l'admin
// (app Droits). Juste après une connexion, l'app propose d'activer la biométrie sur l'appareil.
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
	/** Modes de connexion activés, gardés pour afficher la connexion sans attendre l'API. */
	modes: "appscripts.modes",
	/** Biométrie de l'appareil : « oui » (activée), « non » (proposée et refusée). */
	biometrie: "appscripts.biometrie",
};

/** Modes de connexion d'un compte existant, tant que l'API ne les a pas donnés : tous. */
const MODES_PAR_DEFAUT = { code: true, lien: true, qr: true, biometrie: true };

/** Clé de session de l'appareil, ou null s'il n'est pas connecté. */
export const lireSession = () => lireStockage(CLES.session);

/** Compte connecté ({ id, prenom, email }), tel qu'à la dernière connexion, ou null. */
export const compteConnecte = () => lireStockageJson(CLES.compte);

function garderConnexion({ session, compte }) {
	ecrireStockage(CLES.session, session);
	ecrireStockage(CLES.compte, JSON.stringify(compte));
}

/** Oublie la connexion de l'appareil (sans prévenir l'API). */
export function oublierConnexion() {
	ecrireStockage(CLES.session, null);
	ecrireStockage(CLES.compte, null);
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
 * Ferme toutes les sessions du compte, y compris celle de l'appareil (appareil perdu), et
 * désactive sa biométrie partout. Les apps refusent les sessions au plus tard 10 minutes après.
 */
export async function deconnecterPartout() {
	await appelerDroits("deconnecter-partout");
	oublierConnexion();
	ecrireStockage(CLES.biometrie, null);
}

/**
 * Accès du compte connecté (onglet Droits du projet droits) : `apps`, les clés des apps qui lui
 * sont ouvertes (ex : « voyage ») ; `tableaux`, les liens des classeurs ({ projet, nom, url }),
 * vide s'il n'a pas le droit de les voir.
 * @throws Si l'API refuse (hors ligne, session fermée)
 */
export async function accesDuCompte() {
	const { apps, tableaux = [] } = await appelerDroits("moi");
	return { apps, tableaux };
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
 * Lien d'invitation d'une app (ex : Cadeaux) ouvert sur un appareil sans compte : le compte est
 * créé avec le prénom de la personne invitée et l'appareil connecté, puis l'app propose la
 * biométrie et l'installation.
 * @param prenom Prénom de la personne invitée (donné par l'API de l'app)
 * @param nomApp Nom de l'app, pour décrire l'appareil
 * @return Le compte créé
 * @throws Si l'API refuse (prénom déjà pris : l'app affiche alors la connexion)
 */
export async function creerCompteInvite(prenom, nomApp) {
	const connexion = await appelerDroits("creer-compte", {
		prenom,
		appareil: decrireAppareil(nomApp),
	});
	garderConnexionInvitee(connexion, nomApp);
	return connexion.compte;
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
 * Fenêtre « Mes connexions » : adresse e-mail du compte (pour se connecter par un code ou un lien)
 * et biométrie de cet appareil.
 * @param nomApp Nom de l'app, pour décrire l'appareil
 * @throws Si l'API refuse (hors ligne, session fermée)
 */
export async function ouvrirMesConnexions(nomApp) {
	const [moi, modes] = await Promise.all([
		appelerDroits("moi"),
		modesConnexion().frais,
	]);
	const disponible = modes.biometrie && (await biometrieDisponible());
	let preparation = null;
	const demanderPreparation = () =>
		appelerDroits("preparer-biometrie")
			.then((p) => {
				preparation = p;
			})
			.catch(() => {});
	if (disponible) demanderPreparation();

	const email = el("input", {
		id: "mes-connexions-email",
		type: "email",
		inputmode: "email",
		autocomplete: "email",
		maxlength: "120",
		value: moi.email ?? "",
	});
	const etatBiometrie = el("p", { class: "aide" });
	const boutonBiometrie = el(
		"button",
		{ type: "button" },
		"Activer sur cet appareil",
	);
	function afficherBiometrie() {
		const activee = lireStockage(CLES.biometrie) === "oui";
		etatBiometrie.textContent = !modes.biometrie
			? "Désactivée pour toutes les apps."
			: !disponible
				? "Pas disponible sur cet appareil."
				: activee
					? "Activée sur cet appareil."
					: "Pas encore activée sur cet appareil.";
		boutonBiometrie.hidden = !disponible || activee;
	}
	afficherBiometrie();
	boutonBiometrie.addEventListener("click", async () => {
		boutonBiometrie.disabled = true;
		try {
			await activerBiometrie(
				preparation ?? (await appelerDroits("preparer-biometrie")),
				nomApp,
			);
			notifier("Biométrie activée.");
		} catch (erreur) {
			notifier(erreur.message, true);
			// Le défi a pu servir : un neuf pour le prochain essai.
			preparation = null;
			demanderPreparation();
		} finally {
			boutonBiometrie.disabled = false;
			afficherBiometrie();
		}
	});

	const dialogue = el(
		"dialog",
		{ class: "dialogue", onclose: () => dialogue.remove() },
		el("h2", {}, "Mes connexions"),
		el(
			"form",
			{
				class: "formulaire",
				onsubmit: async (e) => {
					e.preventDefault();
					const bouton = e.submitter ?? e.target.querySelector("[type=submit]");
					bouton.disabled = true;
					try {
						const compte = await appelerDroits("modifier-profil", {
							email: email.value,
						});
						ecrireStockage(CLES.compte, JSON.stringify(compte));
						notifier(
							compte.email ? "Adresse enregistrée." : "Adresse retirée.",
						);
					} catch (erreur) {
						notifier(erreur.message, true);
					} finally {
						bouton.disabled = false;
					}
				},
			},
			el("label", { for: "mes-connexions-email" }, "Mon adresse e-mail"),
			el(
				"p",
				{ class: "aide" },
				"Pour recevoir un code ou un lien de connexion (nouvel appareil, appareil perdu).",
			),
			email,
			el("button", { type: "submit" }, "Enregistrer"),
		),
		el("h3", { class: "titre-section" }, "Biométrie"),
		etatBiometrie,
		el(
			"div",
			{ class: "boutons" },
			boutonBiometrie,
			el(
				"button",
				{
					type: "button",
					class: "bouton-principal",
					onclick: () => dialogue.close(),
				},
				"Fermer",
			),
		),
	);
	document.body.append(dialogue);
	dialogue.showModal();
}

/**
 * Affiche la connexion dans `conteneur` : compte existant (biométrie, code ou lien par e-mail,
 * lien d'un QR code collé, selon les modes activés), ou nouveau compte (prénom).
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
	/** Défi de connexion par la biométrie, demandé d'avance (le navigateur veut le geste aussitôt). */
	let defi = null;
	const demanderDefi = () => {
		defi = appelerDroits("defi-biometrie").catch(() => null);
	};
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

	/** App installée sur iPhone : coller le lien de connexion copié avant l'installation. */
	function carteInstallee() {
		return el(
			"div",
			{ class: "carte formulaire" },
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
								"Pas de lien de connexion copié : connecte-toi autrement ci-dessous.";
							return;
						}
						connecter(bouton, "utiliser-invitation", { invitation: code });
					},
				},
				"Coller mon lien de connexion",
			),
		);
	}

	async function connecterParBiometrie(e) {
		const bouton = e.currentTarget;
		bouton.disabled = true;
		erreur.textContent = "";
		try {
			const valeur = (await defi) ?? (await appelerDroits("defi-biometrie"));
			const signature = await signerDefiBiometrie(valeur);
			await terminer(
				await appelerDroits("connecter-biometrie", {
					...signature,
					appareil: decrireAppareil(nomApp),
				}),
				true,
			);
		} catch (erreurBiometrie) {
			erreur.textContent = erreurBiometrie.message;
			// Clé supprimée côté serveur : l'activation sera reproposée.
			if (/Biométrie inconnue/.test(erreurBiometrie.message)) {
				ecrireStockage(CLES.biometrie, null);
			}
			// Le défi a pu servir : un neuf pour le prochain essai.
			demanderDefi();
		} finally {
			bouton.disabled = false;
		}
	}

	function carteBiometrie() {
		return el(
			"div",
			{ class: "carte formulaire" },
			el(
				"button",
				{
					type: "button",
					class: "bouton-principal",
					onclick: connecterParBiometrie,
				},
				"Me connecter avec la biométrie",
			),
			el(
				"p",
				{ class: "aide" },
				"Empreinte, visage ou code de l'appareil, si tu l'as activée.",
			),
		);
	}

	/** Message une fois l'e-mail envoyé, selon ce qu'il contient. */
	function messageEnvoi({ code, lien }) {
		const suite =
			code && lien
				? "Touche son lien sur cet appareil, ou saisis son code :"
				: code
					? "Saisis son code :"
					: "Touche son lien sur cet appareil.";
		return `Si c'est l'adresse d'un compte, un e-mail vient de partir (regarde aussi dans les spams). ${suite}`;
	}

	function carteEmail() {
		const envoi =
			modes.code && modes.lien
				? "un code ou un lien"
				: modes.code
					? "un code"
					: "un lien";
		const email = el("input", {
			id: "connexion-email",
			type: "email",
			inputmode: "email",
			required: true,
			autocomplete: "email",
			maxlength: "120",
		});
		const code = el("input", {
			id: "connexion-code",
			inputmode: "numeric",
			autocomplete: "one-time-code",
			pattern: "[0-9 ]{6,7}",
			maxlength: "7",
			required: true,
		});
		const formulaireCode = el(
			"form",
			{
				class: "formulaire",
				hidden: true,
				onsubmit: (e) => {
					e.preventDefault();
					connecter(
						e.submitter ?? e.target.querySelector("[type=submit]"),
						"utiliser-code",
						{
							email: email.value,
							code: code.value,
						},
					);
				},
			},
			el("label", { for: "connexion-code" }, "Code reçu (6 chiffres)"),
			code,
			el(
				"button",
				{ type: "submit", class: "bouton-principal" },
				"Me connecter",
			),
		);
		const aide = el("p", { class: "aide", hidden: true });
		return el(
			"div",
			{ class: "carte formulaire" },
			el(
				"form",
				{
					class: "formulaire",
					onsubmit: async (e) => {
						e.preventDefault();
						const bouton =
							e.submitter ?? e.target.querySelector("[type=submit]");
						bouton.disabled = true;
						erreur.textContent = "";
						try {
							const envoye = await appelerDroits("envoyer-email", {
								email: email.value,
								retour: `${location.origin}${location.pathname}`,
							});
							aide.textContent = messageEnvoi(envoye);
							aide.hidden = false;
							formulaireCode.hidden = !envoye.code;
							bouton.textContent = "Renvoyer";
							if (envoye.code) code.focus();
						} catch (erreurEnvoi) {
							erreur.textContent = erreurEnvoi.message;
						} finally {
							bouton.disabled = false;
						}
					},
				},
				el("label", { for: "connexion-email" }, "Ton adresse e-mail"),
				email,
				el("button", { type: "submit" }, `Recevoir ${envoi}`),
			),
			aide,
			formulaireCode,
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
			el(
				"p",
				{ class: "aide" },
				modes.qr
					? "Connecté sur un autre appareil ? Sur celui-là : menu → « Connecter un autre appareil », puis scanne le QR code avec l'appareil photo. Ou colle ici le lien reçu :"
					: "Tu as reçu un lien de connexion ? Touche-le, ou colle-le ici :",
			),
			el("label", { for: "connexion-lien" }, "Lien de connexion"),
			lien,
			el("button", { type: "submit" }, "Connecter cet appareil"),
			scanner
				? el(
						"button",
						{ type: "button", onclick: scanner },
						"Scanner un QR code",
					)
				: null,
		);
	}

	function carteNouveauCompte() {
		const prenom = el("input", {
			id: "connexion-prenom",
			required: true,
			autocomplete: "given-name",
			maxlength: "40",
		});
		return el(
			"form",
			{
				class: "carte formulaire",
				onsubmit: (e) => {
					e.preventDefault();
					connecter(
						e.submitter ?? e.target.querySelector("[type=submit]"),
						"creer-compte",
						{ prenom: prenom.value },
					);
				},
			},
			el("p", { class: "aide" }, "Pas encore de compte ?"),
			el("label", { for: "connexion-prenom" }, "Ton prénom"),
			prenom,
			el("button", { type: "submit" }, "Créer mon compte"),
		);
	}

	async function afficher() {
		const biometrie = modes.biometrie && (await biometrieDisponible());
		if (biometrie && !defi) demanderDefi();
		remplacerContenu(
			conteneur,
			biometrie && carteBiometrie(),
			// App installée (iPhone) : elle ne partage pas la connexion du navigateur.
			estInstallee && !lireSession() && carteInstallee(),
			(modes.code || modes.lien) && carteEmail(),
			carteLien(),
			carteNouveauCompte(),
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
		erreur.textContent = "Connexion…";
		connecter(null, "utiliser-invitation", { invitation });
	}
}
