// Biométrie (WebAuthn, passkeys) : l'appareil crée une clé pour le compte, débloquée par
// l'empreinte, le visage ou le code de l'appareil, et signe avec elle les défis de l'API droits.
// La clé est liée au domaine des apps (toutes les apps de l'origine), et souvent synchronisée par
// le téléphone (trousseau iCloud, gestionnaire de mots de passe Google) : elle sert aussi dans une
// app installée sur iPhone, qui n'a pas la session des autres. Octets envoyés en base64 URL.

/** Octets d'un ArrayBuffer en base64 URL. */
function versBase64Url(buffer) {
	let texte = "";
	for (const octet of new Uint8Array(buffer))
		texte += String.fromCharCode(octet);
	return btoa(texte).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Octets d'un texte en base64 URL. */
function depuisBase64Url(texte) {
	const binaire = atob(texte.replace(/-/g, "+").replace(/_/g, "/"));
	return Uint8Array.from(binaire, (caractere) => caractere.charCodeAt(0));
}

const encoder = (texte) => new TextEncoder().encode(texte);

/** Vrai si l'appareil sait déverrouiller une clé par la biométrie (ou son code). */
export async function biometrieDisponible() {
	try {
		return Boolean(
			window.PublicKeyCredential &&
				(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()),
		);
	} catch {
		return false;
	}
}

/** Erreur du navigateur en message lisible (annulation, délai dépassé). */
function erreurBiometrie(erreur) {
	if (erreur?.name === "NotAllowedError" || erreur?.name === "AbortError") {
		return new Error("Biométrie annulée.");
	}
	if (erreur?.name === "InvalidStateError") {
		return new Error("La biométrie est déjà activée sur cet appareil.");
	}
	return new Error(`Biométrie impossible : ${erreur?.message ?? erreur}`);
}

/**
 * Crée la clé de l'appareil (activation), à appeler juste après un geste (toucher un bouton).
 * @param preparation Réponse de preparer-biometrie : defi, compte, existantes
 * @return Ce qu'attend activer-biometrie : defi, identifiant, cle, algorithme, donneesClient
 */
export async function creerCleBiometrie({ defi, compte, existantes }) {
	let credential;
	try {
		credential = await navigator.credentials.create({
			publicKey: {
				challenge: encoder(defi),
				rp: { name: "Apps" },
				user: {
					id: encoder(compte.id),
					name: compte.prenom,
					displayName: compte.prenom,
				},
				pubKeyCredParams: [
					{ type: "public-key", alg: -7 },
					{ type: "public-key", alg: -257 },
				],
				excludeCredentials: existantes.map((id) => ({
					type: "public-key",
					id: depuisBase64Url(id),
				})),
				authenticatorSelection: {
					authenticatorAttachment: "platform",
					residentKey: "required",
					requireResidentKey: true,
					userVerification: "required",
				},
				attestation: "none",
				timeout: 120000,
			},
		});
	} catch (erreur) {
		throw erreurBiometrie(erreur);
	}
	const reponse = credential.response;
	const cle = reponse.getPublicKey?.();
	if (!cle) {
		throw new Error(
			"Navigateur trop ancien pour la biométrie : mets-le à jour.",
		);
	}
	return {
		defi,
		identifiant: versBase64Url(credential.rawId),
		cle: versBase64Url(cle),
		algorithme: reponse.getPublicKeyAlgorithm(),
		donneesClient: versBase64Url(reponse.clientDataJSON),
	};
}

/**
 * Signe un défi de connexion avec la clé de l'appareil (le navigateur propose les clés du site).
 * @return Ce qu'attend connecter-biometrie : defi, identifiant, donneesClient,
 * donneesAuthentificateur, signature
 */
export async function signerDefiBiometrie(defi) {
	let credential;
	try {
		credential = await navigator.credentials.get({
			publicKey: {
				challenge: encoder(defi),
				userVerification: "required",
				timeout: 120000,
			},
		});
	} catch (erreur) {
		throw erreurBiometrie(erreur);
	}
	const reponse = credential.response;
	return {
		defi,
		identifiant: versBase64Url(credential.rawId),
		donneesClient: versBase64Url(reponse.clientDataJSON),
		donneesAuthentificateur: versBase64Url(reponse.authenticatorData),
		signature: versBase64Url(reponse.signature),
	};
}
