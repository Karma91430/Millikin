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
];
