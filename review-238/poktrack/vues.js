// Vue de plusieurs pseudos réunis, à partir de la vue de chacun (voir Vue dans l'API) : l'app
// l'affiche aussitôt qu'on coche un pseudo, sans attendre l'API.

const centimes = (montant) => Math.round(montant * 100) / 100;
const rapport = (numerateur, denominateur) =>
	denominateur > 0 ? numerateur / denominateur : 0;

/** Les champs qui s'additionnent d'un pseudo à l'autre ; les parts sont recalculées. */
const SOMMES = [
	"sessions",
	"dureeSec",
	"parties",
	"tablesFinales",
	"podiums",
	"cout",
	"resultat",
];

/** Indicateurs de plusieurs résumés réunis (voir resumerSessions dans l'API). */
function reunirResumes(resumes) {
	const total = (lire) => resumes.reduce((somme, r) => somme + lire(r), 0);
	const t = Object.fromEntries(
		SOMMES.map((champ) => [champ, total((r) => r[champ])]),
	);
	// Un état gardé d'une version de l'API sans ces nombres : ils sont déduits des parts.
	const positives = total(
		(r) => r.positives ?? Math.round(r.partPositives * r.sessions),
	);
	const payes = total((r) => r.payes ?? Math.round(r.itm * r.parties));
	const cout = centimes(t.cout);
	const resultat = centimes(t.resultat);
	return {
		...t,
		cout,
		resultat,
		positives,
		partPositives: rapport(positives, t.sessions),
		dureeMoyenneSec: Math.round(rapport(t.dureeSec, t.sessions)),
		partiesParSession: rapport(t.parties, t.sessions),
		partTablesFinales: rapport(t.tablesFinales, t.parties),
		partPodiums: rapport(t.podiums, t.parties),
		abi: centimes(rapport(cout, t.parties)),
		netParHeure: centimes(rapport(resultat, t.dureeSec / 3600)),
		roi: rapport(resultat, cout),
		payes,
		itm: rapport(payes, t.parties),
	};
}

/** Les statistiques d'un type de partie réunies : au total, et mois par mois. */
function reunirStatistiques(statistiques) {
	const parMois = new Map();
	for (const { parMois: mois } of statistiques) {
		for (const resume of mois) {
			parMois.set(resume.mois, [...(parMois.get(resume.mois) ?? []), resume]);
		}
	}
	return {
		resume: reunirResumes(statistiques.map((s) => s.resume)),
		parMois: [...parMois]
			.sort(([a], [b]) => b.localeCompare(a))
			.map(([mois, resumes]) => ({ mois, ...reunirResumes(resumes) })),
	};
}

/**
 * Les courbes réunies : le résultat de chaque session est l'écart de cumul avec la précédente du
 * même pseudo ; les sessions sont remises dans l'ordre des dates et le cumul recalculé.
 */
function reunirCourbes(courbes) {
	const points = courbes.flatMap((courbe) =>
		courbe.map((point, index) => ({
			...point,
			resultat: point.cumul - (index > 0 ? courbe[index - 1].cumul : 0),
		})),
	);
	points.sort((a, b) => a.date.localeCompare(b.date));
	let cumul = 0;
	return points.map(({ date, resultat, bankroll }) => {
		cumul = centimes(cumul + resultat);
		return { date, cumul, bankroll };
	});
}

/** La vue de plusieurs pseudos, à partir de leurs vues : comme l'API la calculerait. */
export function reunirVues(vues) {
	const courbe = reunirCourbes(vues.map((vue) => vue.courbe));
	const nbSessions = Math.max(0, ...vues.map((vue) => vue.sessions.length));
	return {
		bankroll: courbe.findLast((p) => p.bankroll !== null)?.bankroll ?? null,
		courbe,
		sessions: vues
			.flatMap((vue) => vue.sessions)
			.sort((a, b) => b.debut.localeCompare(a.debut))
			.slice(0, nbSessions),
		mtt: reunirStatistiques(vues.map((vue) => vue.mtt)),
		expresso: reunirStatistiques(vues.map((vue) => vue.expresso)),
	};
}
