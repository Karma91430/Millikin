// Test bench scenarios: small reference projects with a precise brief and hidden checks that Millikin runs
// itself once the team is done (the agents never see them). Offline and dependency-free (Python 3 standard
// library), so a result only reflects the team and the engine, not the network.

export type BenchCheck = {
  name: string;
  /** Shell command run in the project folder (or in a scratch copy when `scratch` is set). */
  run: string;
  /** Expected: exit code 0, and these strings in the output. */
  expect?: { includes?: string[] };
  /** Run in an empty scratch folder (for tools that write files in the current folder); $PROJECT is the project path. */
  scratch?: boolean;
};

export type BenchScenario = {
  id: string;
  name: string;
  summary: string;
  /** Brief given to the team as the project description. */
  brief: string;
  /** Files placed in the project folder before the team starts. */
  files?: Record<string, string>;
  /** Team by agent name: the first contacts plan and review, the others build. */
  leads: string[];
  builders: string[];
  checks: BenchCheck[];
};

const py = (code: string) => `python3 - <<'PY'\n${code.trim()}\nPY`;

export const BENCH_SCENARIOS: BenchScenario[] = [
  {
    id: "stats-lib",
    name: "Bibliothèque de statistiques",
    summary: "Un module Python avec 4 fonctions et ses tests.",
    brief: `Écrire une petite bibliothèque Python sans dépendance, dans le fichier stats_utils.py à la racine du projet, avec ses tests unitaires.
Fonctions attendues :
- mean(values) : moyenne arithmétique.
- median(values) : médiane (moyenne des deux valeurs centrales pour un nombre pair d'éléments).
- mode(values) : valeur la plus fréquente ; en cas d'égalité, la plus petite.
- stdev(values) : écart type d'échantillon (diviseur n - 1) ; ValueError s'il y a moins de 2 valeurs.
Chaque fonction lève ValueError sur une liste vide. Tests avec unittest ou pytest dans un dossier tests/.`,
    leads: ["Tech lead"],
    builders: ["Développeur full-stack"],
    checks: [
      { name: "stats_utils.py existe", run: "test -f stats_utils.py" },
      { name: "mean et median", run: py(`import stats_utils as s\nassert s.mean([1, 2, 3, 4]) == 2.5\nassert s.median([3, 1, 2]) == 2\nassert s.median([4, 1, 3, 2]) == 2.5\nprint("ok")`) },
      { name: "mode (égalité → plus petite valeur)", run: py(`import stats_utils as s\nassert s.mode([3, 1, 3, 1, 2]) == 1\nassert s.mode([5, 5, 2]) == 5\nprint("ok")`) },
      { name: "stdev d'échantillon", run: py(`import stats_utils as s\nassert abs(s.stdev([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138089935) < 1e-6\nprint("ok")`) },
      {
        name: "ValueError sur liste vide",
        run: py(`import stats_utils as s\nfor f in (s.mean, s.median, s.mode, s.stdev):\n    try:\n        f([])\n    except ValueError:\n        continue\n    raise SystemExit(f"{f.__name__} n'a pas levé ValueError")\ntry:\n    s.stdev([1])\nexcept ValueError:\n    print("ok")\nelse:\n    raise SystemExit("stdev([1]) doit lever ValueError")`),
      },
      { name: "tests présents", run: "ls tests/test_*.py tests/*_test.py 2>/dev/null | grep -q ." },
    ],
  },
  {
    id: "todo-cli",
    name: "Gestionnaire de tâches en ligne de commande",
    summary: "Un outil CLI qui garde ses données dans un fichier JSON.",
    brief: `Écrire un outil en ligne de commande Python sans dépendance : todo.py à la racine du projet.
Les tâches sont stockées dans le fichier todo.json du dossier courant (créé au besoin).
Commandes :
- python3 todo.py add "texte" : ajoute une tâche.
- python3 todo.py list : affiche une ligne par tâche, au format exact « 1. [ ] texte » ou « 2. [x] texte » (numérotation à partir de 1).
- python3 todo.py done N : marque la tâche N comme faite ; message d'erreur et code de sortie 1 si N n'existe pas.
Ajouter des tests et un README court.`,
    leads: ["Tech lead"],
    builders: ["Développeur full-stack"],
    checks: [
      { name: "todo.py existe", run: "test -f todo.py" },
      {
        name: "ajout, fait et liste",
        scratch: true,
        run: `python3 "$PROJECT/todo.py" add "acheter du pain" && python3 "$PROJECT/todo.py" add "appeler Paul" && python3 "$PROJECT/todo.py" done 1 && python3 "$PROJECT/todo.py" list`,
        expect: { includes: ["1. [x] acheter du pain", "2. [ ] appeler Paul"] },
      },
      { name: "données dans todo.json", scratch: true, run: `python3 "$PROJECT/todo.py" add "x" && test -f todo.json` },
      { name: "done N inexistant → code 1", scratch: true, run: `python3 "$PROJECT/todo.py" add "x" >/dev/null; python3 "$PROJECT/todo.py" done 42; test $? -eq 1` },
      { name: "tests présents", run: "ls tests/test_*.py test_*.py 2>/dev/null | grep -q ." },
    ],
  },
  {
    id: "csv-report",
    name: "Rapport de ventes depuis un CSV",
    summary: "Un script qui lit un CSV fourni et produit un résumé JSON.",
    files: {
      "ventes.csv": "date,produit,quantite,prix_unitaire\n2026-01-03,stylo,10,1.5\n2026-01-03,cahier,4,3.2\n2026-01-04,stylo,5,1.5\n2026-01-05,gomme,7,0.8\n",
    },
    brief: `Écrire un script Python sans dépendance : report.py à la racine du projet.
Usage : python3 report.py <fichier.csv>. Le CSV a les colonnes date, produit, quantite, prix_unitaire (exemple fourni : ventes.csv).
Le script affiche sur la sortie standard un objet JSON avec :
- "nb_lignes" : nombre de lignes de données ;
- "total_ventes" : somme de quantite × prix_unitaire, arrondie à 2 décimales ;
- "ventes_par_produit" : objet produit → total des ventes de ce produit (arrondi à 2 décimales) ;
- "produit_top" : le produit au plus gros total.
Un fichier inexistant donne un message d'erreur et le code de sortie 1. Ajouter des tests.`,
    leads: ["Tech lead"],
    builders: ["Développeur full-stack"],
    checks: [
      { name: "report.py existe", run: "test -f report.py" },
      {
        name: "résumé du CSV fourni",
        run: py(`import json, subprocess\nout = subprocess.run(["python3", "report.py", "ventes.csv"], capture_output=True, text=True, check=True).stdout\nj = json.loads(out)\nassert j["nb_lignes"] == 4, j\nassert abs(j["total_ventes"] - 40.9) < 1e-9, j\nassert j["produit_top"] == "stylo", j\nassert abs(j["ventes_par_produit"]["cahier"] - 12.8) < 1e-9, j\nprint("ok")`),
      },
      {
        name: "autre CSV (données cachées)",
        run: py(`import json, subprocess, tempfile, os\nd = tempfile.mkdtemp()\np = os.path.join(d, "v.csv")\nopen(p, "w").write("date,produit,quantite,prix_unitaire\\n2026-02-01,a,1,10\\n2026-02-01,b,3,5\\n2026-02-02,a,2,10\\n")\nj = json.loads(subprocess.run(["python3", "report.py", p], capture_output=True, text=True, check=True).stdout)\nassert j["nb_lignes"] == 3 and abs(j["total_ventes"] - 45) < 1e-9 and j["produit_top"] == "a", j\nprint("ok")`),
      },
      { name: "fichier absent → code 1", run: "python3 report.py /nonexistent.csv; test $? -eq 1" },
      { name: "tests présents", run: "ls tests/test_*.py test_*.py 2>/dev/null | grep -q ." },
    ],
  },
  {
    id: "library",
    name: "Gestion de bibliothèque (projet moyen)",
    summary: "Un paquet Python complet : modèle, persistance JSON, règles d'emprunt, recherche, statistiques, CLI et tests.",
    brief: `Construire une petite application Python sans dépendance de gestion de bibliothèque, dans un paquet biblio/ à la racine du projet.

API attendue (exactement ces noms), dans biblio/store.py : une classe Bibliotheque(chemin_json) qui charge le fichier s'il existe et le réécrit après chaque modification.
- ajouter_livre(isbn, titre, auteur, annee, exemplaires=1) : ValueError si l'isbn est vide ou existe déjà.
- inscrire_membre(nom) : retourne l'identifiant du membre (entier, à partir de 1).
- emprunter(isbn, membre_id) : ValueError si le livre ou le membre est inconnu, s'il ne reste aucun exemplaire, ou si le membre a déjà 3 emprunts en cours.
- rendre(isbn, membre_id) : ValueError si cet emprunt n'existe pas.
- disponibles(isbn) : nombre d'exemplaires disponibles.
- emprunts_de(membre_id) : liste des isbn empruntés par le membre.
- rechercher(texte) : liste des isbn dont le titre ou l'auteur contient le texte, sans tenir compte de la casse ni des accents, triée par titre.
- statistiques() : dictionnaire {"livres": nombre de titres, "exemplaires": total des exemplaires, "empruntes": emprunts en cours, "top_auteur": auteur qui a le plus de titres}.

Ligne de commande : python3 -m biblio --data FICHIER.json COMMANDE
- ajouter ISBN "Titre" "Auteur" ANNEE [EXEMPLAIRES]
- membre "Nom" : affiche l'identifiant créé
- emprunter ISBN ID et rendre ISBN ID
- chercher TEXTE : une ligne par livre au format « ISBN | Titre | Auteur | disponibles/total »
- stats : affiche statistiques() en JSON
Toute erreur affiche un message sur la sortie d'erreur et termine avec le code 2.

Ajouter des tests (dossier tests/) et un README.`,
    leads: ["Tech lead"],
    builders: ["Développeur full-stack", "Ingénieur QA"],
    checks: [
      { name: "paquet biblio importable", run: py(`from biblio.store import Bibliotheque\nprint("ok")`) },
      {
        name: "ajout et doublon refusé",
        run: py(`import tempfile, os\nfrom biblio.store import Bibliotheque\nb = Bibliotheque(os.path.join(tempfile.mkdtemp(), "d.json"))\nb.ajouter_livre("1", "Dune", "Herbert", 1965, 2)\nfor bad in (("1", "X", "Y", 2000), ("", "X", "Y", 2000)):\n    try:\n        b.ajouter_livre(*bad)\n    except ValueError:\n        continue\n    raise SystemExit(f"pas de ValueError pour {bad}")\nprint("ok")`),
      },
      {
        name: "emprunt, retour et disponibilités",
        run: py(`import tempfile, os\nfrom biblio.store import Bibliotheque\nb = Bibliotheque(os.path.join(tempfile.mkdtemp(), "d.json"))\nb.ajouter_livre("1", "Dune", "Herbert", 1965, 2)\nm = b.inscrire_membre("Ana")\nassert m == 1, m\nb.emprunter("1", m)\nassert b.disponibles("1") == 1\nassert b.emprunts_de(m) == ["1"]\nb.rendre("1", m)\nassert b.disponibles("1") == 2 and b.emprunts_de(m) == []\ntry:\n    b.rendre("1", m)\nexcept ValueError:\n    print("ok")\nelse:\n    raise SystemExit("rendre sans emprunt doit lever ValueError")`),
      },
      {
        name: "règles : stock épuisé et 3 emprunts maximum",
        run: py(`import tempfile, os\nfrom biblio.store import Bibliotheque\nb = Bibliotheque(os.path.join(tempfile.mkdtemp(), "d.json"))\nfor i in range(1, 6):\n    b.ajouter_livre(str(i), f"Livre {i}", "A", 2000, 1)\nm1 = b.inscrire_membre("Ana"); m2 = b.inscrire_membre("Bo")\nb.emprunter("1", m1)\ntry:\n    b.emprunter("1", m2)\nexcept ValueError:\n    pass\nelse:\n    raise SystemExit("stock épuisé non détecté")\nb.emprunter("2", m1); b.emprunter("3", m1)\ntry:\n    b.emprunter("4", m1)\nexcept ValueError:\n    print("ok")\nelse:\n    raise SystemExit("4e emprunt accepté")`),
      },
      {
        name: "persistance JSON entre deux instances",
        run: py(`import tempfile, os\nfrom biblio.store import Bibliotheque\np = os.path.join(tempfile.mkdtemp(), "d.json")\nb = Bibliotheque(p)\nb.ajouter_livre("9", "Fondation", "Asimov", 1951, 3)\nm = b.inscrire_membre("Ana")\nb.emprunter("9", m)\nc = Bibliotheque(p)\nassert c.disponibles("9") == 2 and c.emprunts_de(m) == ["9"]\nprint("ok")`),
      },
      {
        name: "recherche sans casse ni accents, triée par titre",
        run: py(`import tempfile, os\nfrom biblio.store import Bibliotheque\nb = Bibliotheque(os.path.join(tempfile.mkdtemp(), "d.json"))\nb.ajouter_livre("a", "Zéro et l'infini", "Koestler", 1940)\nb.ajouter_livre("b", "Les Misérables", "Hugo", 1862)\nb.ajouter_livre("c", "Notre-Dame", "Victor Hugo", 1831)\nassert b.rechercher("hugo") == ["b", "c"], b.rechercher("hugo")\nassert b.rechercher("ZERO") == ["a"], b.rechercher("ZERO")\nassert b.rechercher("miserables") == ["b"]\nprint("ok")`),
      },
      {
        name: "statistiques",
        run: py(`import tempfile, os\nfrom biblio.store import Bibliotheque\nb = Bibliotheque(os.path.join(tempfile.mkdtemp(), "d.json"))\nb.ajouter_livre("1", "A", "Hugo", 1, 2)\nb.ajouter_livre("2", "B", "Hugo", 1, 1)\nb.ajouter_livre("3", "C", "Zola", 1, 4)\nm = b.inscrire_membre("Ana")\nb.emprunter("3", m)\ns = b.statistiques()\nassert s == {"livres": 3, "exemplaires": 7, "empruntes": 1, "top_auteur": "Hugo"}, s\nprint("ok")`),
      },
      {
        name: "ligne de commande : ajout, membre, emprunt, recherche, stats",
        scratch: true,
        run: `cd "$PROJECT" && D=$(mktemp -d)/d.json && python3 -m biblio --data "$D" ajouter 42 "Dune" "Herbert" 1965 1 >/dev/null && python3 -m biblio --data "$D" membre "Ana" | grep -q 1 && python3 -m biblio --data "$D" emprunter 42 1 >/dev/null && python3 -m biblio --data "$D" chercher dune && python3 -m biblio --data "$D" stats`,
        expect: { includes: ["42 | Dune | Herbert | 0/1", '"empruntes": 1'] },
      },
      { name: "ligne de commande : erreur → code 2", scratch: true, run: `cd "$PROJECT" && D=$(mktemp -d)/d.json && python3 -m biblio --data "$D" emprunter 404 1 2>/dev/null; test $? -eq 2` },
      { name: "tests présents", run: "ls tests/test_*.py 2>/dev/null | grep -q ." },
    ],
  },
];
