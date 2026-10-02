// Built-in skill library: short, actionable methods and output formats. Skills are injected in the
// system prompt of every agent that has them, so each one stays compact (small local models).

export type LibrarySkill = { name: string; description: string; content: string; profiles: string[] };

export const SKILL_LIBRARY: LibrarySkill[] = [
  // ------------------------------------------------------------------ engineering
  {
    name: "ADR",
    description: "Rédiger une décision d'architecture au format ADR",
    profiles: ["Tech lead", "Architecte logiciel", "Architecte cloud"],
    content: `Quand on te demande de formaliser une décision, utilise ce format :
# ADR-<n> : <titre>
- **Statut** : proposé | accepté | remplacé
- **Contexte** : le problème et les contraintes
- **Décision** : ce qui est retenu
- **Alternatives** : options écartées et pourquoi
- **Conséquences** : impacts positifs et négatifs`,
  },
  {
    name: "Revue de code",
    description: "Relire du code avec une grille fixe et des remarques classées par gravité",
    profiles: ["Reviewer de code", "Tech lead", "Expert sécurité applicative"],
    content: `Pour relire du code :
1. Lis d'abord l'objectif du changement, puis les fichiers concernés (outil de lecture si disponible).
2. Vérifie dans cet ordre : exactitude (cas limites, erreurs, null), sécurité (entrées, secrets, injections), lisibilité (noms, taille des fonctions, duplication), tests (présents et pertinents), performance seulement si c'est un enjeu.
3. Rends une liste de remarques au format :
- **[bloquant | important | suggestion]** \`fichier:ligne\` : le problème, puis la correction proposée.
4. Termine par un verdict : « à corriger » s'il reste un bloquant, sinon « validé ».
Ne commente pas le style quand il suit les conventions du projet. Une remarque = un problème concret.`,
  },
  {
    name: "Débogage méthodique",
    description: "Trouver la cause d'un bug par reproduction, hypothèses et vérification",
    profiles: ["Développeur backend", "Développeur frontend", "Développeur full-stack", "Développeur mobile", "Ingénieur DevOps / SRE", "Ingénieur QA"],
    content: `Face à un bug, suis ces étapes et montre-les :
1. **Reproduire** : la commande ou les étapes exactes, le résultat attendu et le résultat obtenu (message d'erreur complet).
2. **Isoler** : réduis au plus petit cas qui échoue ; note ce qui a changé récemment.
3. **Hypothèses** : 2 ou 3 causes possibles, de la plus probable à la moins probable.
4. **Vérifier** : un test ou une trace par hypothèse ; élimine-les une à une.
5. **Corriger** la cause (pas le symptôme) et ajouter un test qui aurait détecté le bug.
6. **Compte rendu** : cause, correction, test ajouté, risques restants.
N'invente jamais un résultat d'exécution : si tu ne peux pas lancer la commande, dis-le.`,
  },
  {
    name: "Tests automatisés",
    description: "Écrire des tests utiles : cas nominal, limites et erreurs",
    profiles: ["Ingénieur QA", "Développeur backend", "Développeur frontend", "Développeur full-stack"],
    content: `Pour tester une fonctionnalité :
1. Liste les cas avant d'écrire du code : nominal, limites (vide, zéro, maximum, unicode), erreurs attendues, régression du bug corrigé le cas échéant.
2. Un test = un comportement, nommé comme une phrase (« refuse un e-mail sans @ »).
3. Structure Arrange / Act / Assert ; pas de logique conditionnelle dans les tests.
4. Utilise le framework déjà présent dans le projet ; isole le réseau, l'horloge et l'aléatoire.
5. Lance les tests et rapporte le résultat réel (nombre réussis / échoués, sortie des échecs).
Rends : la liste des cas couverts, les fichiers de test créés, la commande pour les lancer.`,
  },
  {
    name: "Conception d'API REST",
    description: "Concevoir des endpoints cohérents : ressources, codes HTTP, erreurs, pagination",
    profiles: ["Développeur backend", "Architecte logiciel", "Développeur full-stack"],
    content: `Règles pour concevoir une API REST :
- Ressources au pluriel et en noms (\`/projects/{id}/tasks\`), verbes HTTP pour l'action : GET lit, POST crée, PATCH modifie partiellement, DELETE supprime.
- Codes : 200 ok, 201 créé (avec l'objet), 204 sans contenu, 400 entrée invalide, 401 non authentifié, 403 interdit, 404 introuvable, 409 conflit, 422 validation, 500 erreur serveur.
- Erreurs au même format partout : \`{"error": {"code": "…", "message": "…", "details": […]}}\`.
- Listes paginées (\`?limit=&cursor=\`), filtres en paramètres de requête, tri explicite.
- Dates en ISO 8601 UTC, identifiants opaques, champs en camelCase ou snake_case mais jamais les deux.
- Versionne dès le départ (\`/v1\`) et documente chaque endpoint : méthode, chemin, corps, réponses, exemple.`,
  },
  {
    name: "Checklist sécurité",
    description: "Passer un code ou une architecture au crible des risques courants (OWASP)",
    profiles: ["Expert sécurité applicative", "Reviewer de code", "Développeur backend", "Ingénieur DevOps / SRE"],
    content: `Vérifie systématiquement :
- **Entrées** : validation côté serveur, requêtes paramétrées (pas de concaténation SQL), échappement à l'affichage (XSS), taille limitée des uploads.
- **Authentification et droits** : chaque endpoint vérifie l'identité ET le droit sur la ressource demandée (pas seulement l'identifiant dans l'URL).
- **Secrets** : aucun mot de passe, clé ou jeton dans le code ou les logs ; variables d'environnement ou coffre-fort.
- **Dépendances** : versions maintenues, pas de paquet inconnu.
- **Données personnelles** : minimisation, chiffrement en transit (HTTPS), durée de conservation.
- **Erreurs** : pas de trace technique renvoyée à l'utilisateur.
Rends chaque constat avec : risque, gravité (critique / élevée / moyenne / faible), emplacement, correction.`,
  },
  {
    name: "Commits et changelog",
    description: "Messages de commit Conventional Commits et entrées de changelog lisibles",
    profiles: ["Développeur backend", "Développeur frontend", "Développeur full-stack", "Développeur mobile", "Tech lead"],
    content: `Messages de commit au format Conventional Commits :
\`<type>(<portée>): <résumé à l'impératif, 72 caractères max>\`
Types : feat (fonctionnalité), fix (correction), docs, refactor (sans changement de comportement), test, chore (outillage), perf.
Corps facultatif : le pourquoi, pas le comment. Un commit = un changement cohérent.
Pour un changelog, regroupe par version puis par section « Ajouté », « Modifié », « Corrigé », « Supprimé », avec des phrases compréhensibles par un utilisateur (pas les messages de commit bruts).`,
  },
  {
    name: "README de projet",
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
Pas de secret réel, pas de chemin propre à une machine. Vérifie chaque commande dans le projet avant de l'écrire.`,
  },
  // ------------------------------------------------------------------ product & delivery
  {
    name: "User stories",
    description: "Écrire des user stories avec critères d'acceptation testables",
    profiles: ["Product owner", "Business analyst", "Chef de projet"],
    content: `Format d'une user story :
**En tant que** <utilisateur>, **je veux** <action> **afin de** <bénéfice>.
**Critères d'acceptation** (Gherkin, 2 à 5 par story) :
- Étant donné <contexte>, quand <action>, alors <résultat observable>.
Règles :
- Une story tient dans un sprint ; sinon découpe-la par parcours ou par règle métier, jamais par couche technique.
- Les critères sont vérifiables par un test (pas de « rapide », « intuitif » sans seuil).
- Ajoute « Hors périmètre » quand une attente voisine n'est volontairement pas couverte.`,
  },
  {
    name: "Spécification fonctionnelle",
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
N'invente pas de chiffre : marque « à confirmer » ce que tu ne sais pas.`,
  },
  {
    name: "Estimation et découpage",
    description: "Découper un travail en tâches estimées en points avec dépendances",
    profiles: ["Chef de projet", "Tech lead", "Product owner"],
    content: `Pour découper et estimer :
1. Liste les livrables, puis les tâches de chaque livrable (une tâche = un responsable, un résultat vérifiable).
2. Estime en points de complexité (1, 2, 3, 5, 8, 13) relativement à une tâche de référence ; au-delà de 8, redécoupe.
3. Note les dépendances (« après T3 ») et les tâches parallélisables.
4. Signale les inconnues : une tâche d'exploration courte vaut mieux qu'une estimation au hasard.
Rends un tableau : # | tâche | responsable | points | dépend de | risque.`,
  },
  {
    name: "Analyse de risques",
    description: "Identifier et prioriser les risques d'un projet avec plan de réponse",
    profiles: ["Chef de projet", "Architecte logiciel", "Juriste conformité", "Analyste financier"],
    content: `Pour analyser les risques :
1. Identifie-les par catégorie : technique, planning, ressources, sécurité / conformité, dépendances externes, adoption.
2. Pour chacun : probabilité (1 à 3) × impact (1 à 3) = criticité (1 à 9).
3. Réponse : éviter, réduire, transférer ou accepter — avec une action concrète, un responsable et un signal d'alerte.
Rends un tableau trié par criticité décroissante : risque | P | I | criticité | réponse | responsable | signal.
Commence par les 3 risques les plus critiques en une phrase chacun.`,
  },
  {
    name: "Compte rendu de réunion",
    description: "Transformer des notes en compte rendu : décisions, actions, points ouverts",
    profiles: ["Chef de projet", "Synthétiseur", "Product owner"],
    content: `Format du compte rendu :
**Objet, date, participants**
**Décisions** : liste, une décision par ligne, formulée au passé (« On a retenu… »).
**Actions** : tableau action | responsable | échéance.
**Points ouverts** : questions non tranchées et qui doit y répondre.
**Résumé** (3 lignes max) en tête pour ceux qui ne lisent que ça.
Ne retranscris pas la discussion ; ne garde que ce qui engage la suite. Si un responsable ou une date manque, écris « à définir ».`,
  },
  {
    name: "Rétrospective",
    description: "Animer et restituer une rétrospective de sprint orientée actions",
    profiles: ["Chef de projet", "Tech lead"],
    content: `Déroulé d'une rétrospective :
1. **Faits** : ce qui a été livré vs prévu, incidents, chiffres du sprint.
2. **Ce qui a bien marché** / **ce qui a freiné** : des constats concrets, pas des personnes.
3. **Causes** : pour les 2 freins principaux, demande « pourquoi » jusqu'à une cause actionnable.
4. **Actions** : 1 à 3 maximum, chacune avec un responsable et un critère de réussite vérifiable au prochain sprint.
5. **Suivi** : statut des actions de la rétrospective précédente.`,
  },
  // ------------------------------------------------------------------ data & AI
  {
    name: "Analyse exploratoire",
    description: "Explorer un jeu de données avec une checklist avant toute modélisation",
    profiles: ["Data analyst", "Data scientist", "Data engineer"],
    content: `Checklist d'exploration (montre le code et les résultats réels) :
1. **Forme** : nombre de lignes / colonnes, types, aperçu.
2. **Qualité** : valeurs manquantes par colonne (%), doublons, valeurs aberrantes, incohérences (dates futures, négatifs impossibles).
3. **Univarié** : distributions des variables clés, modalités rares.
4. **Bivarié** : relation de chaque variable avec la cible ; corrélations fortes entre variables.
5. **Temps** : tendance, saisonnalité, ruptures si les données sont datées.
6. **Constats** : 3 à 5 points, chacun avec le chiffre qui le prouve, et les traitements à prévoir.
N'interprète pas une corrélation comme une causalité.`,
  },
  {
    name: "Évaluation de modèle ML",
    description: "Évaluer un modèle sans fuite de données, contre une référence, avec les bonnes métriques",
    profiles: ["Data scientist", "Ingénieur IA / LLM"],
    content: `Pour évaluer un modèle :
1. **Découpage** : train / validation / test, séparés avant tout prétraitement ; découpage temporel si les données sont datées ; aucune information du test dans l'entraînement (fuite).
2. **Référence** : compare toujours à une baseline simple (moyenne, classe majoritaire, règle métier).
3. **Métriques** adaptées : régression → MAE, RMSE ; classification déséquilibrée → précision, rappel, F1, AUC-PR plutôt que l'accuracy ; ranking → NDCG, MAP.
4. **Robustesse** : validation croisée ou plusieurs graines, performance par segment.
5. **Erreurs** : analyse 10 à 20 cas mal prédits et cherche un motif.
Rends un tableau modèle | métriques | écart à la baseline, puis une recommandation.`,
  },
  {
    name: "Rédaction de prompt",
    description: "Écrire un prompt structuré et testable pour un LLM",
    profiles: ["Ingénieur IA / LLM", "Data scientist"],
    content: `Structure d'un prompt :
1. **Rôle et objectif** en une phrase.
2. **Contexte** nécessaire, et seulement lui (données, public, contraintes).
3. **Instructions** numérotées, à l'impératif ; ce qu'il faut faire plutôt que ce qu'il ne faut pas faire.
4. **Format de sortie** exact (JSON avec schéma, sections, longueur), idéalement avec un exemple.
5. **Cas limites** : quoi répondre si l'information manque (« je ne sais pas » autorisé).
Pour un petit modèle local : phrases courtes, peu d'outils, un seul objectif par appel, température basse pour les tâches factuelles.
Teste sur 5 à 10 entrées variées et garde ces cas pour vérifier chaque modification.`,
  },
  {
    name: "Recherche sourcée",
    description: "Chercher sur le web, croiser les sources et citer chaque affirmation",
    profiles: ["Chargé de veille", "Synthétiseur", "Business analyst", "Stratège marketing"],
    content: `Méthode de recherche :
1. Reformule la question et liste 2 à 4 requêtes précises (mots-clés, nom exact, année).
2. Lis les pages utiles (pas seulement les extraits) ; privilégie les sources primaires (documentation officielle, études, textes de loi) et récentes.
3. Croise : une affirmation importante doit être confirmée par deux sources indépendantes, sinon signale-la comme incertaine.
4. Rends une synthèse structurée où chaque affirmation est suivie de sa source [titre](url), puis une section « Limites » (contradictions, informations datées, manques).
N'invente jamais une source ni une URL ; si tu ne trouves pas, dis-le.`,
  },
  // ------------------------------------------------------------------ communication
  {
    name: "Synthèse exécutive",
    description: "Résumer un sujet pour un décideur : conclusion d'abord, preuves ensuite",
    profiles: ["Synthétiseur", "Analyste financier", "Chef de projet", "Avant-vente"],
    content: `Structure (pyramide inversée) :
1. **En bref** : la conclusion ou la recommandation en 1 à 2 phrases.
2. **Pourquoi** : 3 arguments maximum, chacun avec un chiffre ou un fait.
3. **Ce qu'il faut décider** : options, coût / bénéfice de chacune, ta recommandation.
4. **Prochaines étapes** : qui fait quoi, quand.
Une page maximum, des phrases courtes, pas de jargon non expliqué. Sépare clairement faits et hypothèses.`,
  },
  {
    name: "E-mail professionnel",
    description: "Rédiger un e-mail clair avec objet explicite et demande précise",
    profiles: ["Support client", "Avant-vente", "Recruteur", "Chef de projet", "Community manager"],
    content: `Pour rédiger un e-mail :
- **Objet** explicite qui résume la demande (« Validation du devis X avant vendredi »).
- **Première phrase** : la raison de l'e-mail ou la demande.
- **Corps** : le contexte utile en 2 ou 3 phrases, puis les détails en liste si nécessaire.
- **Demande** claire avec une échéance (« Peux-tu me confirmer d'ici jeudi ? »).
- Ton adapté au destinataire, phrases courtes, pas plus de 150 mots sauf nécessité.
Ne promets rien qui n'a pas été validé ; propose le brouillon à l'utilisateur, ne l'envoie pas.`,
  },
  {
    name: "Guide pas à pas",
    description: "Rédiger un tutoriel ou une procédure que l'on peut suivre sans aide",
    profiles: ["Rédacteur technique", "Support client", "Développeur full-stack"],
    content: `Structure d'un guide :
1. **Objectif** : ce que le lecteur saura faire à la fin, et le temps nécessaire.
2. **Prérequis** : accès, outils, versions.
3. **Étapes numérotées** : une action par étape, à l'impératif, avec le résultat attendu (« Vous voyez… »), les commandes dans des blocs de code.
4. **Vérification** : comment savoir que tout fonctionne.
5. **Problèmes fréquents** : symptôme → solution.
Utilise les libellés exacts de l'interface, entre guillemets. Teste chaque étape avant de l'écrire quand c'est possible.`,
  },
  {
    name: "Réponse support",
    description: "Répondre à un client : empathie, solution, prochaine étape",
    profiles: ["Support client", "Community manager"],
    content: `Structure d'une réponse au client :
1. **Reconnaître** le problème en une phrase, sans formule creuse.
2. **Solution** : les étapes concrètes, numérotées, ou ce qui est fait de notre côté.
3. **Si ce n'est pas résolu** : l'information à nous transmettre (capture, identifiant, heure) ou le délai de retour.
4. **Clôture** courte et personnelle.
Ne rejette pas la faute sur le client, n'invente pas de délai ni de geste commercial, et escalade (en le disant) si la demande dépasse ce que tu peux garantir.`,
  },
];
