# Millikin

Plateforme d'agents IA **100 % locale** sur Ollama : profils d'agents générés par le modèle, équipes avec délégation visualisée en graphe, RAG interne, skills, MCP, tableau de tâches et passerelle LLM (proxy compatible OpenAI, suivi des appels).

## Démarrer

Prérequis : Node 22+ et [Ollama](https://ollama.com) lancé avec au moins un modèle qui gère les outils (ex. `qwen3:8b`) et un modèle d'embedding (ex. `nomic-embed-text`).

```bash
npm install
npm run dev        # http://127.0.0.1:3210
```

Au premier lancement, Millikin crée la base `data/millikin.db`, détecte les modèles Ollama installés et installe un modèle d'équipe de démo (chef d'équipe, architecte, développeur, testeur).

## Concepts

- **Agent** : un profil (prompt, modèle local, outils, skills, RAG, MCP). 37 profils prédéfinis + les tiens.
- **Modèle d'équipe** : des agents reliés par des liens « peut déléguer à », avec un ou plusieurs **premiers contacts** (★). Se construit visuellement.
- **Projet** : créé à partir d'un modèle d'équipe (sa composition est copiée et reste ajustable), avec son propre **dossier**, son **tableau de tâches** et ses conversations.
- **Conversation** : rattachée soit à un **projet**, soit à un **agent seul**.

Déroulé d'un projet : les premiers contacts se **concertent** et **cadrent** (analyse, approche, questions) sans rien déléguer ; quand tu cliques **Valider et lancer**, ils répartissent le travail selon les liens, **contrôlent** les résultats (et font corriger si besoin), puis font un compte rendu. Les réponses tournent **en arrière-plan** : tu peux changer d'écran, une notification t'avertit quand c'est prêt.

## Écrans

| Écran | Rôle |
|---|---|
| Espace de travail | Chat avec un projet ou un agent. Graphe de l'équipe avec bulles en direct, liens animés pendant les délégations, bouton « Agrandir » sur chaque réponse. |
| Projets | Sous-menu des projets ; chemin du dossier (Copier / Finder / VS Code) ; vue d'ensemble ; Kanban avec **▶ Lancer** (l'agent assigné réalise, un premier contact évalue et met à jour le statut) ; fichiers ; équipe du projet. |
| Agents | Mes agents + bibliothèque de profils (galerie, recherche, profils personnels, génération IA). |
| Équipes | Modèles d'équipe : constructeur visuel (liens, premiers contacts, cadrage, concertation), génération IA. |
| Skills | Méthodes réutilisables (Markdown), import `SKILL.md`, génération IA. |
| Connaissances | Bases RAG : import txt/md/pdf/code, embeddings locaux, recherche de test. |
| MCP | Serveurs stdio ou HTTP, test de connexion, modèles prêts. |
| Modèles | Console Ollama (installés, chargés, téléchargement), utilisation, hôtes, proxy. |
| Réglages | Modèle par défaut, embedding, `num_ctx`, réflexion et son plafond, SearXNG, dossiers… |

## Outils des agents

| Outil | Détail |
|---|---|
| `web_search`, `fetch_url` | Recherche via SearXNG local (`http://127.0.0.1:8888` par défaut) et lecture de pages. |
| `list_files`, `read_file` / `write_file`, `edit_file` | Limités au dossier de travail de l'équipe (sortie du dossier refusée, liens symboliques compris). |
| `run_command` | Shell dans le dossier de travail, avec délai max. **Désactivé par défaut.** |
| `board_list`, `board_add_card`, `board_update_card` | Tableau Kanban de suivi. |
| `search_knowledge` | RAG ; les meilleurs extraits sont aussi injectés automatiquement. |
| `ask_agent` | Délégation, donné automatiquement au chef d'une équipe. |
| MCP | Chaque serveur attaché ajoute ses outils (`<serveur>__<outil>`). |

Conseil : peu d'outils par agent. Les petits modèles locaux choisissent mieux parmi 3 à 5 outils.

## Proxy API (façon LiteLLM)

`http://127.0.0.1:3210/api/v1` expose `/chat/completions`, `/embeddings` et `/models` au format OpenAI. Nom de modèle : `ollama/qwen3:8b`. Clé optionnelle dans Réglages. Chaque appel est journalisé (onglet Modèles → Utilisation).

## Architecture

- `src/lib/gateway.ts` : appels Ollama natifs (`/api/chat`, `/api/embed`), `num_ctx`, `think`, journal d'usage.
- `src/lib/orchestrator.ts` : boucle agent + outils, délégation imbriquée, événements de trace.
- `src/lib/tools.ts` : outils intégrés. `src/lib/mcp.ts` : client MCP. `src/lib/rag.ts` : découpage, embeddings, recherche cosinus.
- `src/lib/trace.ts` : format de trace partagé serveur/interface (un nœud par appel d'agent).
- `src/components/chat/AgentGraph.tsx` : graphe React Flow avec bulles et particules.

Sécurité : le serveur n'écoute que sur `127.0.0.1` (les serveurs MCP stdio et `run_command` exécutent des commandes locales). Les données restent dans `data/` et `workspace/`.
