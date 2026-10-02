// Built-in skill library: actionable methods and output formats. Skills are injected in the system
// prompt of every agent that has them, so each one stays compact (≈ 200–300 words) for small
// local models: a method, an output format, the usual pitfalls and a final check.

export const SKILL_CATEGORIES = ["Développement", "Produit & gestion", "Data & IA", "Communication"] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export type LibrarySkill = { name: string; category: SkillCategory; description: string; content: string; profiles: string[] };

export const SKILL_LIBRARY: LibrarySkill[] = [
  // ------------------------------------------------------------------ development
  {
    name: "ADR",
    category: "Développement",
    description: "Rédiger une décision d'architecture au format ADR, avec alternatives et conséquences",
    profiles: ["Tech lead", "Architecte logiciel", "Architecte cloud"],
    content: `Quand une décision technique engage la suite (choix de base de données, de framework, d'architecture, de convention), formalise-la en ADR.

**Format**
# ADR-<n> : <décision formulée comme un choix>
- **Statut** : proposé | accepté | remplacé par ADR-<m>
- **Date**
- **Contexte** : le besoin, les contraintes (volumétrie, équipe, budget, délais) et ce qui force à décider maintenant.
- **Options étudiées** : 2 à 4 options, chacune avec ses avantages et ses inconvénients.
- **Décision** : l'option retenue et la raison principale, en une ou deux phrases.
- **Conséquences** : ce qui devient plus simple, ce qui devient plus difficile, les risques et comment on les surveille.
- **Révision** : le signal qui ferait reconsidérer la décision.

**Exemple de décision** : « ADR-3 : Utiliser SQLite plutôt que PostgreSQL pour la V1 », avec en conséquence « migration à prévoir au-delà d'un utilisateur concurrent ».

**Pièges** : justifier après coup sans vraies alternatives ; oublier les conséquences négatives ; mélanger plusieurs décisions dans un même ADR.

**Avant de répondre** : chaque option a au moins un inconvénient, la décision cite le critère qui a tranché.`,
  },
  {
    name: "Revue de code",
    category: "Développement",
    description: "Relire du code avec une grille fixe et des remarques classées par gravité",
    profiles: ["Reviewer de code", "Tech lead", "Expert sécurité applicative"],
    content: `Pour relire du code :
1. Lis d'abord l'objectif du changement, puis les fichiers concernés (outil de lecture si disponible).
2. Vérifie dans cet ordre : exactitude (cas limites, erreurs, null), sécurité (entrées, secrets, injections), lisibilité (noms, taille des fonctions, duplication), tests (présents et pertinents), performance seulement si c'est un enjeu.
3. Rends une liste de remarques au format :
- **[bloquant | important | suggestion]** \`fichier:ligne\` : le problème, puis la correction proposée.
4. Termine par un verdict : « à corriger » s'il reste un bloquant, sinon « validé ».

**Exemple** : **[bloquant]** \`api/users.ts:42\` : l'identifiant vient de l'URL sans vérifier que l'utilisateur y a droit ; ajouter un contrôle de propriété avant la lecture.

**Pièges** : commenter le style quand il suit les conventions du projet ; regrouper plusieurs problèmes dans une remarque ; signaler un problème sans proposer de correction.`,
  },
  {
    name: "Débogage méthodique",
    category: "Développement",
    description: "Trouver la cause d'un bug par reproduction, hypothèses et vérification",
    profiles: ["Développeur backend", "Développeur frontend", "Développeur full-stack", "Développeur mobile", "Ingénieur DevOps / SRE", "Ingénieur QA"],
    content: `Face à un bug, suis ces étapes et montre-les :
1. **Reproduire** : la commande ou les étapes exactes, le résultat attendu et le résultat obtenu (message d'erreur complet).
2. **Isoler** : réduis au plus petit cas qui échoue ; note ce qui a changé récemment.
3. **Hypothèses** : 2 ou 3 causes possibles, de la plus probable à la moins probable.
4. **Vérifier** : un test ou une trace par hypothèse ; élimine-les une à une.
5. **Corriger** la cause (pas le symptôme) et ajouter un test qui aurait détecté le bug.
6. **Compte rendu** : cause, correction, test ajouté, risques restants.

**Pièges** : modifier plusieurs choses à la fois ; conclure sans avoir reproduit ; masquer l'erreur (try/catch vide) au lieu de la corriger.
N'invente jamais un résultat d'exécution : si tu ne peux pas lancer la commande, dis-le.`,
  },
  {
    name: "Tests automatisés",
    category: "Développement",
    description: "Écrire des tests utiles : cas nominal, limites et erreurs",
    profiles: ["Ingénieur QA", "Développeur backend", "Développeur frontend", "Développeur full-stack"],
    content: `Pour tester une fonctionnalité :
1. Liste les cas avant d'écrire du code : nominal, limites (vide, zéro, maximum, unicode), erreurs attendues, régression du bug corrigé le cas échéant.
2. Un test = un comportement, nommé comme une phrase (« refuse un e-mail sans @ »).
3. Structure Arrange / Act / Assert ; pas de logique conditionnelle dans les tests.
4. Utilise le framework déjà présent dans le projet ; isole le réseau, l'horloge et l'aléatoire.
5. Lance les tests et rapporte le résultat réel (nombre réussis / échoués, sortie des échecs).

Rends : la liste des cas couverts, les fichiers de test créés, la commande pour les lancer.

**Pièges** : tester l'implémentation plutôt que le comportement ; des tests qui dépendent de leur ordre ; viser un pourcentage de couverture au lieu des cas à risque.`,
  },
  {
    name: "Conception d'API REST",
    category: "Développement",
    description: "Concevoir des endpoints cohérents : ressources, codes HTTP, erreurs, pagination",
    profiles: ["Développeur backend", "Architecte logiciel", "Développeur full-stack"],
    content: `Règles pour concevoir une API REST :
- Ressources au pluriel et en noms (\`/projects/{id}/tasks\`), verbes HTTP pour l'action : GET lit, POST crée, PATCH modifie partiellement, DELETE supprime.
- Codes : 200 ok, 201 créé (avec l'objet), 204 sans contenu, 400 entrée invalide, 401 non authentifié, 403 interdit, 404 introuvable, 409 conflit, 422 validation, 500 erreur serveur.
- Erreurs au même format partout : \`{"error": {"code": "…", "message": "…", "details": […]}}\`.
- Listes paginées (\`?limit=&cursor=\`), filtres en paramètres de requête, tri explicite.
- Dates en ISO 8601 UTC, identifiants opaques, une seule convention de nommage des champs.
- Versionne dès le départ (\`/v1\`).

**Documentation de chaque endpoint** : méthode, chemin, paramètres, corps, réponses possibles, un exemple de requête et de réponse.

**Pièges** : des verbes dans les URL (\`/getUser\`) ; renvoyer 200 avec une erreur dans le corps ; exposer les identifiants internes ou les traces techniques.`,
  },
  {
    name: "Checklist sécurité",
    category: "Développement",
    description: "Passer un code ou une architecture au crible des risques courants (OWASP)",
    profiles: ["Expert sécurité applicative", "Reviewer de code", "Développeur backend", "Ingénieur DevOps / SRE"],
    content: `Vérifie systématiquement :
- **Entrées** : validation côté serveur, requêtes paramétrées (pas de concaténation SQL), échappement à l'affichage (XSS), taille limitée des uploads.
- **Authentification et droits** : chaque endpoint vérifie l'identité ET le droit sur la ressource demandée (pas seulement l'identifiant dans l'URL).
- **Secrets** : aucun mot de passe, clé ou jeton dans le code ou les logs ; variables d'environnement ou coffre-fort.
- **Dépendances** : versions maintenues, pas de paquet inconnu.
- **Données personnelles** : minimisation, chiffrement en transit (HTTPS), durée de conservation.
- **Erreurs** : pas de trace technique renvoyée à l'utilisateur.

Rends chaque constat avec : risque, gravité (critique / élevée / moyenne / faible), emplacement, correction.

**Pièges** : se fier à la validation côté client ; considérer un réseau interne comme sûr ; signaler des risques théoriques sans emplacement précis.`,
  },
  {
    name: "Commits et changelog",
    category: "Développement",
    description: "Messages de commit Conventional Commits et entrées de changelog lisibles",
    profiles: ["Développeur backend", "Développeur frontend", "Développeur full-stack", "Développeur mobile", "Tech lead"],
    content: `**Messages de commit** au format Conventional Commits :
\`<type>(<portée>): <résumé à l'impératif, 72 caractères max>\`
- Types : feat (fonctionnalité), fix (correction), docs, refactor (sans changement de comportement), test, perf, chore (outillage), ci.
- Corps facultatif, séparé par une ligne vide : le pourquoi et l'impact, pas le comment.
- Pied : \`BREAKING CHANGE: …\` si la compatibilité est rompue, \`Closes #42\` pour un ticket.
- Un commit = un changement cohérent qui compile et passe les tests.

**Exemples**
- \`feat(auth): ajouter la connexion par lien magique\`
- \`fix(kanban): garder la colonne lors du glisser-déposer sur mobile\`

**Changelog** : par version (\`## 1.4.0 — 2026-10-02\`), puis sections « Ajouté », « Modifié », « Corrigé », « Supprimé », avec des phrases compréhensibles par un utilisateur.

**Pièges** : « fix stuff », « wip » ; mélanger refactor et fonctionnalité ; copier les messages de commit bruts dans le changelog.`,
  },
  {
    name: "README de projet",
    category: "Développement",
    description: "Rédiger un README qui permet de lancer le projet en 5 minutes",
    profiles: ["Rédacteur technique", "Tech lead", "Développeur full-stack"],
    content: `Structure d'un README :
1. **Titre et une phrase** : ce que fait le projet et pour qui.
2. **Démarrage rapide** : prérequis (versions), installation, lancement — des commandes copiables, testées.
3. **Configuration** : variables d'environnement (nom, rôle, exemple factice), fichiers à créer.
4. **Utilisation** : 2 ou 3 exemples concrets.
5. **Architecture** : les dossiers principaux et leur rôle, en quelques lignes.
6. **Développement** : tests, lint, conventions, comment contribuer.
7. **Licence**.

**Pièges** : des commandes jamais testées ; un vrai secret ou un chemin propre à une machine ; un historique du projet à la place du démarrage rapide.

**Avant de répondre** : vérifie chaque commande dans le projet (fichiers de configuration, scripts du gestionnaire de paquets) avant de l'écrire.`,
  },
  // ------------------------------------------------------------------ product & delivery
  {
    name: "User stories",
    category: "Produit & gestion",
    description: "Écrire des user stories avec critères d'acceptation testables",
    profiles: ["Product owner", "Business analyst", "Chef de projet"],
    content: `**Format d'une user story**
**En tant que** <utilisateur précis>, **je veux** <action> **afin de** <bénéfice>.
**Critères d'acceptation** (Gherkin, 2 à 5 par story) :
- Étant donné <contexte>, quand <action>, alors <résultat observable>.
**Hors périmètre** : ce qui est volontairement exclu.

**Exemple**
En tant qu'organisateur, je veux dupliquer un événement passé afin de ne pas tout ressaisir.
- Étant donné un événement passé, quand je clique sur « Dupliquer », alors un brouillon est créé avec les mêmes informations sauf la date.
- Étant donné le brouillon dupliqué, quand je l'ouvre, alors la date est vide et obligatoire.
Hors périmètre : duplication en masse.

**Règles (INVEST)** : indépendante, négociable, apporte de la valeur, estimable, petite (tient dans un sprint), testable. Découpe par parcours ou par règle métier, jamais par couche technique.

**Pièges** : « l'utilisateur » trop vague ; des critères non mesurables (« rapide », « intuitif ») ; une story qui décrit la solution technique.`,
  },
  {
    name: "Spécification fonctionnelle",
    category: "Produit & gestion",
    description: "Une spec courte : problème, objectifs, périmètre, parcours, règles, questions ouvertes",
    profiles: ["Product owner", "Business analyst", "Chef de projet", "UX designer"],
    content: `Rédige la spécification avec ces sections, une page si possible :
1. **Problème** : qui le rencontre et comment on le sait.
2. **Objectifs et mesure du succès** : 1 à 3 indicateurs chiffrés.
3. **Périmètre** : ce qui est inclus / ce qui ne l'est pas (MVP d'abord).
4. **Parcours principaux** : étapes numérotées du point de vue de l'utilisateur.
5. **Règles métier** : liste numérotée, une règle par ligne, avec les cas d'erreur.
6. **Contraintes** : techniques, légales, délais.
7. **Questions ouvertes** : ce qui reste à décider et par qui.

**Pièges** : décrire l'interface pixel par pixel au lieu du besoin ; oublier les cas d'erreur et les droits ; des objectifs sans chiffre.
N'invente pas de chiffre : marque « à confirmer » ce que tu ne sais pas.`,
  },
  {
    name: "Estimation et découpage",
    category: "Produit & gestion",
    description: "Découper un travail en tâches estimées en points avec dépendances",
    profiles: ["Chef de projet", "Tech lead", "Product owner"],
    content: `Pour découper et estimer :
1. Liste les livrables, puis les tâches de chaque livrable (une tâche = un responsable, un résultat vérifiable).
2. Estime en points de complexité (1, 2, 3, 5, 8, 13) relativement à une tâche de référence ; au-delà de 8, redécoupe.
3. Note les dépendances (« après T3 ») et les tâches parallélisables.
4. Signale les inconnues : une tâche d'exploration courte (« spike ») vaut mieux qu'une estimation au hasard.

Rends un tableau : # | tâche | responsable | points | dépend de | risque.

**Repères** : 1 point = changement trivial et connu ; 3 = une demi-journée sans surprise ; 8 = plusieurs jours avec des inconnues.

**Pièges** : estimer en heures déguisées ; oublier les tests, la revue et la documentation ; une tâche « finir le projet ».`,
  },
  {
    name: "Analyse de risques",
    category: "Produit & gestion",
    description: "Identifier et prioriser les risques d'un projet avec plan de réponse",
    profiles: ["Chef de projet", "Architecte logiciel", "Juriste conformité", "Analyste financier"],
    content: `Pour analyser les risques :
1. Identifie-les par catégorie : technique, planning, ressources, sécurité / conformité, dépendances externes, adoption.
2. Pour chacun : probabilité (1 à 3) × impact (1 à 3) = criticité (1 à 9).
3. Réponse : éviter, réduire, transférer ou accepter — avec une action concrète, un responsable et un signal d'alerte.

Rends un tableau trié par criticité décroissante : risque | P | I | criticité | réponse | responsable | signal.
Commence par les 3 risques les plus critiques en une phrase chacun.

**Exemple** : « Le fournisseur de paiement ne livre pas son API à temps » — P2 × I3 = 6 — réduire : maquette du service et date butoir de bascule — signal : pas d'environnement de test au jalon 2.

**Pièges** : des risques vagues (« problèmes techniques ») ; confondre risque et problème déjà présent ; une réponse sans responsable.`,
  },
  {
    name: "Compte rendu de réunion",
    category: "Produit & gestion",
    description: "Transformer des notes en compte rendu : décisions, actions, points ouverts",
    profiles: ["Chef de projet", "Synthétiseur", "Product owner"],
    content: `**Format du compte rendu**
**Objet — date — participants**
**Résumé** (3 lignes max) pour ceux qui ne lisent que ça.
**Décisions** : une par ligne, formulée au passé (« On a retenu… »).
**Actions** :
| Action | Responsable | Échéance |
**Points ouverts** : questions non tranchées et qui doit y répondre.
**Prochaine réunion** : date et objectif, si prévue.

**Exemple d'action** : | Envoyer le devis révisé au client | Camille | 08/10 |

**Méthode** : parcours les notes une fois pour repérer les décisions, une deuxième fois pour les engagements (« je m'en occupe », « on doit… ») qui deviennent des actions.

**Pièges** : retranscrire la discussion ; une action sans responsable ni date (écris alors « à définir ») ; présenter comme décidé ce qui n'a été qu'évoqué.`,
  },
  {
    name: "Rétrospective",
    category: "Produit & gestion",
    description: "Animer et restituer une rétrospective de sprint orientée actions",
    profiles: ["Chef de projet", "Tech lead"],
    content: `**Déroulé** (45 à 60 minutes pour un sprint de deux semaines)
1. **Suivi** : statut des actions de la rétrospective précédente (faite, en cours, abandonnée et pourquoi).
2. **Faits** : livré vs prévu, points terminés, incidents, tâches rejetées en revue.
3. **Ce qui a bien marché** / **ce qui a freiné** : des constats concrets et datés, jamais des personnes.
4. **Causes** : pour les 2 freins principaux, demande « pourquoi » jusqu'à une cause sur laquelle l'équipe peut agir.
5. **Actions** : 1 à 3 maximum, chacune avec un responsable et un critère de réussite vérifiable au prochain sprint.

**Restitution**
- Chiffres du sprint en une ligne.
- 3 réussites, 3 freins (avec leur cause).
- Tableau des actions : action | responsable | critère de réussite.

**Exemple d'action** : « Découper toute tâche estimée à plus de 8 points avant le début du sprint » — critère : aucune tâche > 8 points au prochain planning.

**Pièges** : dix actions qui ne seront jamais faites ; des causes hors de portée de l'équipe ; une rétrospective qui tourne au procès.`,
  },
  // ------------------------------------------------------------------ data & AI
  {
    name: "Analyse exploratoire",
    category: "Data & IA",
    description: "Explorer un jeu de données avec une checklist avant toute modélisation",
    profiles: ["Data analyst", "Data scientist", "Data engineer"],
    content: `Checklist d'exploration (montre le code et les résultats réels) :
1. **Forme** : nombre de lignes / colonnes, types, aperçu.
2. **Qualité** : valeurs manquantes par colonne (%), doublons, valeurs aberrantes, incohérences (dates futures, négatifs impossibles).
3. **Univarié** : distributions des variables clés, modalités rares.
4. **Bivarié** : relation de chaque variable avec la cible ; corrélations fortes entre variables.
5. **Temps** : tendance, saisonnalité, ruptures si les données sont datées.
6. **Constats** : 3 à 5 points, chacun avec le chiffre qui le prouve, et les traitements à prévoir.

**Pièges** : interpréter une corrélation comme une causalité ; supprimer les valeurs manquantes sans regarder si elles ont un sens ; calculer des statistiques sur des identifiants.`,
  },
  {
    name: "Évaluation de modèle ML",
    category: "Data & IA",
    description: "Évaluer un modèle sans fuite de données, contre une référence, avec les bonnes métriques",
    profiles: ["Data scientist", "Ingénieur IA / LLM"],
    content: `Pour évaluer un modèle :
1. **Découpage** : train / validation / test, séparés avant tout prétraitement ; découpage temporel si les données sont datées ; aucune information du test dans l'entraînement (fuite).
2. **Référence** : compare toujours à une baseline simple (moyenne, classe majoritaire, règle métier).
3. **Métriques** adaptées : régression → MAE, RMSE ; classification déséquilibrée → précision, rappel, F1, AUC-PR plutôt que l'accuracy ; ranking → NDCG, MAP.
4. **Robustesse** : validation croisée ou plusieurs graines, performance par segment.
5. **Erreurs** : analyse 10 à 20 cas mal prédits et cherche un motif.

Rends un tableau modèle | métriques | écart à la baseline, puis une recommandation.

**Pièges** : ajuster le scaler sur tout le jeu ; choisir le modèle sur le jeu de test ; une variable qui n'existera pas au moment de la prédiction.`,
  },
  {
    name: "Rédaction de prompt",
    category: "Data & IA",
    description: "Écrire un prompt structuré et testable pour un LLM",
    profiles: ["Ingénieur IA / LLM", "Data scientist"],
    content: `Structure d'un prompt :
1. **Rôle et objectif** en une phrase.
2. **Contexte** nécessaire, et seulement lui (données, public, contraintes).
3. **Instructions** numérotées, à l'impératif ; ce qu'il faut faire plutôt que ce qu'il ne faut pas faire.
4. **Format de sortie** exact (JSON avec schéma, sections, longueur), idéalement avec un exemple.
5. **Cas limites** : quoi répondre si l'information manque (« je ne sais pas » autorisé).

**Pour un petit modèle local** : phrases courtes, peu d'outils, un seul objectif par appel, température basse pour les tâches factuelles, sortie structurée (schéma JSON) quand un programme lit la réponse.

**Tester** : 5 à 10 entrées variées, dont des cas difficiles ; garde-les pour vérifier chaque modification.

**Pièges** : un exemple unique que le modèle recopie ; des consignes contradictoires ; tout mettre dans un seul appel au lieu d'enchaîner des étapes courtes.`,
  },
  {
    name: "Recherche sourcée",
    category: "Data & IA",
    description: "Chercher sur le web, croiser les sources et citer chaque affirmation",
    profiles: ["Chargé de veille", "Synthétiseur", "Business analyst", "Stratège marketing"],
    content: `Méthode de recherche :
1. Reformule la question et liste 2 à 4 requêtes précises (mots-clés, nom exact, année).
2. Lis les pages utiles (pas seulement les extraits) ; privilégie les sources primaires (documentation officielle, études, textes de loi) et récentes.
3. Croise : une affirmation importante doit être confirmée par deux sources indépendantes, sinon signale-la comme incertaine.
4. Rends une synthèse structurée où chaque affirmation est suivie de sa source [titre](url), puis une section « Limites » (contradictions, informations datées, manques).

**Pièges** : se contenter du premier résultat ; citer un agrégateur au lieu de la source d'origine ; présenter une opinion comme un fait.
N'invente jamais une source ni une URL ; si tu ne trouves pas, dis-le.`,
  },
  // ------------------------------------------------------------------ communication
  {
    name: "Synthèse exécutive",
    category: "Communication",
    description: "Résumer un sujet pour un décideur : conclusion d'abord, preuves ensuite",
    profiles: ["Synthétiseur", "Analyste financier", "Chef de projet", "Avant-vente"],
    content: `**Structure (pyramide inversée)**
1. **En bref** : la conclusion ou la recommandation en 1 à 2 phrases.
2. **Pourquoi** : 3 arguments maximum, chacun avec un chiffre ou un fait vérifiable.
3. **Options et décision attendue** : 2 ou 3 options avec coût, bénéfice et risque, puis ta recommandation.
4. **Prochaines étapes** : qui fait quoi, quand.

**Exemple d'ouverture** : « Recommandation : reporter le lancement de deux semaines. Les tests de charge échouent au-delà de 300 utilisateurs, alors que la campagne en vise 1 000. »

**Règles** : une page maximum, phrases courtes, chiffres arrondis, jargon expliqué ; sépare clairement faits, estimations et hypothèses.

**Pièges** : commencer par l'historique du sujet ; dix arguments au lieu de trois ; une recommandation implicite que le lecteur doit deviner.

**Avant de répondre** : relis la première phrase seule — un décideur pressé doit savoir quoi décider.`,
  },
  {
    name: "E-mail professionnel",
    category: "Communication",
    description: "Rédiger un e-mail clair avec objet explicite et demande précise",
    profiles: ["Support client", "Avant-vente", "Recruteur", "Chef de projet", "Community manager"],
    content: `**Structure**
- **Objet** explicite qui résume la demande et l'échéance.
- **Première phrase** : la raison de l'e-mail ou la demande.
- **Contexte** utile en 2 ou 3 phrases, puis les détails en liste si nécessaire.
- **Demande** claire avec une échéance.
- **Formule de fin** adaptée au destinataire.

**Exemple**
Objet : Validation du devis Refonte site avant vendredi 10/10
Bonjour Sophie,
Pouvez-vous valider le devis joint d'ici vendredi ? Sans retour, le démarrage glissera au mois prochain.
Par rapport à la version précédente : la page blog est retirée et le budget passe de 12 000 à 10 500 €.
Je reste disponible pour en parler demain matin.
Bien cordialement,

**Règles** : 150 mots maximum sauf nécessité, un sujet par e-mail, ton adapté (tutoiement seulement si la relation l'autorise).

**Pièges** : la demande cachée au milieu ; une pièce jointe annoncée mais absente ; promettre ce qui n'a pas été validé.
Propose le brouillon à l'utilisateur : ne l'envoie jamais toi-même.`,
  },
  {
    name: "Guide pas à pas",
    category: "Communication",
    description: "Rédiger un tutoriel ou une procédure que l'on peut suivre sans aide",
    profiles: ["Rédacteur technique", "Support client", "Développeur full-stack"],
    content: `Structure d'un guide :
1. **Objectif** : ce que le lecteur saura faire à la fin, et le temps nécessaire.
2. **Prérequis** : accès, outils, versions.
3. **Étapes numérotées** : une action par étape, à l'impératif, avec le résultat attendu (« Vous voyez… »), les commandes dans des blocs de code.
4. **Vérification** : comment savoir que tout fonctionne.
5. **Problèmes fréquents** : symptôme → solution.

**Exemple d'étape** : « 3. Cliquez sur « Nouveau projet ». La fenêtre de création s'ouvre avec le champ « Nom » sélectionné. »

**Pièges** : plusieurs actions dans une étape ; des libellés d'interface approximatifs (utilise les libellés exacts, entre guillemets) ; sauter une étape « évidente ».
Teste chaque étape avant de l'écrire quand c'est possible.`,
  },
  {
    name: "Réponse support",
    category: "Communication",
    description: "Répondre à un client : empathie, solution, prochaine étape",
    profiles: ["Support client", "Community manager"],
    content: `**Structure**
1. **Reconnaître** le problème en une phrase, sans formule creuse.
2. **Solution** : les étapes concrètes, numérotées, ou ce qui est fait de notre côté et quand.
3. **Si ce n'est pas résolu** : l'information à nous transmettre (capture, identifiant, heure) ou le délai de retour.
4. **Clôture** courte et personnelle.

**Exemple**
Bonjour Karim,
Votre facture d'octobre a bien été prélevée deux fois, c'est une erreur de notre côté.
Le second prélèvement de 29 € est remboursé aujourd'hui ; il apparaîtra sur votre compte sous 3 à 5 jours ouvrés.
Si ce n'est pas le cas le 10/10, répondez simplement à ce message et je m'en occupe en priorité.
Bonne journée,

**Ton** : direct, poli, sans jargon ; adapte le registre au message du client.

**Pièges** : rejeter la faute sur le client ; promettre un délai ou un geste commercial non validé ; une réponse générique qui ignore la question posée. Escalade (en le disant) si la demande dépasse ce que tu peux garantir.`,
  },
];
