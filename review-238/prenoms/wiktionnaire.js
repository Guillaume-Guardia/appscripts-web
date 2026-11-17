// Origine d'un prénom lue dans une page du Wiktionnaire (HTML de son API REST, format Parsoid).
// Sans DOM : testé par projets/prenoms/test/web/wiktionnaire.test.ts.

/** @type {Record<string, string>} */
const ENTITES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * Texte d'un morceau de HTML : sans balises, entités décodées, sans renvois de notes « [1] ».
 * @param {string} html
 */
function texteHtml(html) {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&#(x?)([0-9a-f]+);/gi, (_, hexa, code) =>
			String.fromCodePoint(Number.parseInt(code, hexa ? 16 : 10)),
		)
		.replace(/&([a-z]+);/gi, (entite, nom) => ENTITES[nom] ?? entite)
		.replace(/\[\d+\]/g, "")
		.replace(/\s+/g, " ")
		.replace(/ ([.,])/g, "$1")
		.trim();
}

/**
 * Étymologie du prénom dans une page du Wiktionnaire (HTML de son API REST), si la page a un sens
 * « Prénom » en français : les lignes de la section « Étymologie » marquées « (Prénom) », sinon la
 * première, sans ses étiquettes de sens ou de date (« (Mythologie) (1847) »). Les suivantes sont
 * d'autres sens ou des attestations anciennes. Une étymologie encore manquante est ignorée.
 * @param {string} html
 * @return {string[]} Les paragraphes, vide sans étymologie du prénom
 */
export function etymologieWiktionnaire(html) {
	const debut = html.search(/<h2[^>]*id="Français"/);
	if (debut < 0) return [];
	const suite = html.slice(debut + 1);
	const fin = suite.search(/<h2[\s>]/);
	const francais = fin < 0 ? suite : suite.slice(0, fin);
	const titre = francais.search(/<h3[^>]*id="Étymologie/);
	if (titre < 0 || !/<h3[^>]*id="Prénom/.test(francais)) return [];
	const apres = francais.slice(francais.indexOf("</h3>", titre));
	const bloc = apres.slice(0, apres.search(/<h3[\s>]|$/));
	const lignes = [...bloc.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)]
		.map(([, contenu]) => {
			// Sans la liste imbriquée d'une ligne (exemples, attestations).
			const texte = texteHtml(contenu.split(/<dl[\s>]/)[0]);
			const etiquettes = texte.match(/^(\([^)]*\)\s*)*/)?.[0] ?? "";
			return { etiquettes, texte: texte.slice(etiquettes.length) };
		})
		.filter(({ texte }) => texte && !/^étymologie manquante/i.test(texte));
	const duPrenom = lignes.filter(({ etiquettes }) =>
		/\(prénom/i.test(etiquettes),
	);
	return (duPrenom.length ? duPrenom : lignes.slice(0, 1)).map(
		({ texte }) => texte,
	);
}
