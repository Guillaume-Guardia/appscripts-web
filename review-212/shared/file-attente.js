// File d'attente sur l'appareil (IndexedDB) : des éléments, Blob compris (ex : photos à envoyer),
// qui survivent à la fermeture de l'app et attendent le réseau. Les fronts de review (REVIEW)
// ont leur propre base, comme pour stockage.js.

const BASE = `${globalThis.REVIEW ? "review:" : ""}appscripts.file-attente`;
const MAGASIN = "elements";

let ouverture = null;

function ouvrirBase() {
	ouverture ??= new Promise((resoudre, rejeter) => {
		const demande = indexedDB.open(BASE, 1);
		demande.onupgradeneeded = () =>
			demande.result.createObjectStore(MAGASIN, { keyPath: "cle" });
		demande.onsuccess = () => resoudre(demande.result);
		demande.onerror = () => rejeter(demande.error);
	});
	return ouverture;
}

async function transaction(mode, faire) {
	const base = await ouvrirBase();
	return new Promise((resoudre, rejeter) => {
		const tx = base.transaction(MAGASIN, mode);
		const demande = faire(tx.objectStore(MAGASIN));
		tx.oncomplete = () => resoudre(demande?.result);
		tx.onerror = () => rejeter(tx.error);
	});
}

/**
 * La file d'une app : chaque élément a une clé unique (`cle`), et la file est préfixée du nom de
 * l'app (une seule base pour tout le site).
 * @param app Le nom de l'app (ex : « location »)
 * @return { ajouter(element), modifier(cle, champs), retirer(cle), lister() }
 */
export function fileAttente(app) {
	return {
		ajouter: (element) =>
			transaction("readwrite", (magasin) => magasin.put({ ...element, app })),
		async modifier(cle, champs) {
			const element = await transaction("readonly", (magasin) =>
				magasin.get(cle),
			);
			if (!element) return;
			await transaction("readwrite", (magasin) =>
				magasin.put({ ...element, ...champs }),
			);
		},
		retirer: (cle) =>
			transaction("readwrite", (magasin) => magasin.delete(cle)),
		async lister() {
			const tous = await transaction("readonly", (magasin) => magasin.getAll());
			return (tous ?? []).filter((element) => element.app === app);
		},
	};
}
