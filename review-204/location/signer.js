// Page de signature d'un avenant, ouverte depuis le lien du mail : le locataire n'a pas de compte,
// le token du lien suffit (voir l'action « avenant » de l'API).

import { creerApi, ErreurReseau } from "../shared/api.js";
import { versDate } from "../shared/dates.js";
import { $, el, remplacerContenu } from "../shared/dom.js";

const MESSAGE_RESEAU =
	"Impossible de joindre le service. Vérifiez votre connexion, puis réessayez.";

const token = new URLSearchParams(location.search).get("token");
const appelerApi = creerApi({ url: window.API_URL });

function messageErreur(erreur) {
	return erreur instanceof ErreurReseau ? MESSAGE_RESEAU : erreur.message;
}

function afficherMessage(texte, ...suite) {
	remplacerContenu($("#signature"), el("p", {}, texte), ...suite);
}

function afficherDejaSigne({ locataire, dateSignature }) {
	const date = versDate(dateSignature).toLocaleDateString("fr-FR");
	afficherMessage(`Ce document a déjà été signé le ${date} par ${locataire}.`);
}

function afficherConfirmation({ locataire }) {
	afficherMessage(
		`Merci ${locataire}, votre signature a bien été enregistrée.`,
		el(
			"p",
			{ class: "aide" },
			"Aucune autre action n'est requise de votre part.",
		),
	);
}

function afficherFormulaire({ locataire, idPdf }) {
	const certification = el("input", {
		type: "checkbox",
		id: "certification",
		disabled: true,
	});
	const bouton = el(
		"button",
		{ type: "submit", class: "bouton-principal", disabled: true },
		"Signer",
	);
	const erreur = el("p", { class: "erreur", role: "alert" });
	// La case ne se débloque qu'une fois le document affiché.
	const apercu = el("iframe", {
		class: "apercu",
		title: "Avenant au contrat de bail",
		src: `https://drive.google.com/file/d/${encodeURIComponent(idPdf)}/preview`,
		onload: () => {
			certification.disabled = false;
			bouton.disabled = false;
		},
	});
	const formulaire = el(
		"form",
		{
			class: "formulaire",
			onsubmit: async (evenement) => {
				evenement.preventDefault();
				if (!certification.checked) {
					erreur.textContent =
						"Veuillez cocher la case pour signer le document.";
					return;
				}
				bouton.disabled = true;
				erreur.textContent = "";
				try {
					afficherConfirmation(
						await appelerApi("signer-avenant", {
							token,
							consentement: certification.checked,
						}),
					);
				} catch (probleme) {
					erreur.textContent = messageErreur(probleme);
					bouton.disabled = false;
				}
			},
		},
		el(
			"label",
			{ class: "certification" },
			certification,
			" Je certifie avoir pris connaissance du document ci-dessus et je le signe électroniquement.",
		),
		erreur,
		bouton,
	);
	remplacerContenu(
		$("#signature"),
		el("p", {}, el("strong", {}, "Locataire : "), locataire),
		apercu,
		formulaire,
	);
}

async function demarrer() {
	if (!token || !window.API_URL) {
		afficherMessage("Ce lien de signature n'est pas valide.");
		return;
	}
	try {
		const avenant = await appelerApi("avenant", { token });
		if (avenant.signe) {
			afficherDejaSigne(avenant);
		} else if (avenant.idPdf) {
			afficherFormulaire(avenant);
		} else {
			afficherMessage(
				"Le document n'est pas disponible pour le moment. Merci de contacter votre propriétaire.",
			);
		}
	} catch (erreur) {
		afficherMessage(
			messageErreur(erreur),
			el("button", { type: "button", onclick: demarrer }, "Réessayer"),
		);
	}
}

demarrer();
