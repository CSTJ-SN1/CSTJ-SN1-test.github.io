# Projet : persistance du code étudiant dans JupyterLite

## Contexte

- Site hébergé sur **GitHub Pages** (statique, aucun backend sur cette origine).
- Il donne accès à **JupyterLite** : Jupyter s'exécute entièrement dans le navigateur (Pyodide).
- **Problème** : JupyterLite stocke les fichiers dans l'IndexedDB du navigateur. Le code d'un étudiant reste donc sur l'ordinateur utilisé et n'est pas accessible ailleurs.
- **Objectif** : le code de chaque étudiant doit le suivre sur n'importe quel ordinateur.

## Solution retenue

Créer un **backend distinct** (serveur séparé de GitHub Pages) qui stocke les fichiers de chaque étudiant, et une **extension JupyterLab** qui remplace/complète le stockage local par ce backend.

```
[Navigateur étudiant]
  JupyterLite (GitHub Pages)
    └─ Extension JupyterLab : RemoteDrive (Contents.IDrive)
          │  HTTPS + jeton d'authentification
          ▼
[Serveur séparé] API REST Laravel 12 (PHP 8.2)
    └─ Stockage : un dossier (ou une table) par étudiant
```

### Principe technique

JupyterLab sépare l'interface du stockage grâce à l'interface `Contents.IDrive`
(méthodes `get`, `save`, `delete`, `rename`, `newUntitled`, `copy`, checkpoints, etc.).
JupyterLite utilise par défaut un drive IndexedDB. L'extension enregistre un drive
dont les méthodes appellent l'API distante. L'étudiant garde l'explorateur de fichiers normal.

## Stack

- Backend : **PHP 8.2 + Laravel 12** (stack déjà maîtrisée), auth via **Laravel Sanctum** (jetons API).
- Extension : **TypeScript**, gabarit officiel d'extension JupyterLab (`copier`), intégrée au build JupyterLite.
- Notebooks `.ipynb` = JSON, stockables tels quels (fichiers sur disque ou colonne texte/JSON en base).

## API minimale à implémenter

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/files?path=` | Lister un dossier ou lire un fichier (contenu + métadonnées) |
| PUT | `/api/files` | Créer ou mettre à jour un fichier |
| DELETE | `/api/files?path=` | Supprimer |
| POST | `/api/files/rename` | Renommer/déplacer |
| POST | `/api/files/directory` | Créer un dossier |

Les réponses doivent respecter le format attendu par `Contents.IModel`
(name, path, type, created, last_modified, content, format, mimetype, size, writable).

## Exigences de sécurité (non négociables)

1. **Isolation par étudiant** : l'identité vient du jeton, jamais d'un identifiant ou d'un chemin envoyé par le client.
2. **Protection contre le path traversal** : normaliser et valider chaque chemin (`..`, chemins absolus, caractères interdits).
3. **CORS** : n'autoriser que l'origine du site GitHub Pages.
4. **Limites** : taille maximale par fichier, nombre de fichiers et quota total par étudiant.
5. **Rate limiting** sur l'API (l'autosave génère beaucoup de requêtes).
6. HTTPS obligatoire.

## Points d'attention fonctionnels

- **Autosave / conflits** : deux onglets ou deux postes = dernière sauvegarde gagnante. Prévoir un champ `last_modified` / version pour détecter les conflits.
- **Réseau coupé** : gérer l'échec de sauvegarde avec un message clair ; option : copie locale IndexedDB comme filet de sécurité avec resynchronisation.
- **Confidentialité** : le code des étudiants est hébergé par nous. Vérifier les règles du collège (hébergement au Canada, durée de conservation).

## Questions ouvertes (à trancher au début)

1. **Authentification** : comptes locaux (Sanctum) ou connexion avec les comptes du collège (Microsoft/Google via OIDC) ?
2. **Stockage** : fichiers sur disque (un dossier par étudiant) ou base de données ?
3. **Hébergement du backend** : où, et sous quelles contraintes (région, coût, maintenance) ?
4. **Remplacer ou compléter** le drive local : l'étudiant voit-il uniquement son espace distant, ou les deux ?
5. **Version de JupyterLite** utilisée dans le projet actuel (le build existant doit être inspecté).

## Plan de travail proposé

1. Examiner le dépôt JupyterLite existant (version, config, `jupyter-lite.json`, extensions déjà présentes).
2. Backend Laravel : migrations, authentification Sanctum, contrôleur de fichiers, validation des chemins, CORS, tests (Pest/PHPUnit) en particulier pour l'isolation entre étudiants et le path traversal.
3. Extension JupyterLab : classe `RemoteDrive implements Contents.IDrive`, écran/flux de connexion, gestion des erreurs réseau.
4. Intégration : construire JupyterLite avec l'extension, tester en local contre l'API.
5. Durcissement : quotas, rate limiting, gestion des conflits, journalisation.
6. Déploiement : backend sur le serveur, build JupyterLite publié sur GitHub Pages.
