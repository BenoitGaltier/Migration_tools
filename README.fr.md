# Assistant de migration Altium 365

[English](README.md) | Français

Application web locale pour migrer les symboles, empreintes, composants et projets
entre workspaces Altium 365. Elle permet aussi la reprise assistée des documents
BOM Portal associés aux projets. L'interface existe en français, anglais et espagnol.

Ce dépôt contient l'application. Son extension Altium Designer est maintenue dans
[Altium_Bridge](https://github.com/BenoitGaltier/Altium_Bridge), référencé comme
sous-module dans `altium-extension/Fluidra.DxpBridge`.

## Prérequis

- Windows 10 ou 11, Git et Node.js **24.19.0**.
- Tokens Altium 365 : lecture du workspace source et permissions de création et de
  publication des éléments dans la destination.
- SDK .NET 10 pour compiler le moteur de prévisualisation des bibliothèques.
- Pour publier les projets : Altium Designer avec une licence active, connecté au
  workspace cible, et le bridge DXP. Sa compilation nécessite le SDK Altium ; voir
  les [instructions du bridge](altium-extension/Fluidra.DxpBridge/README.md).

## Installation

```powershell
git clone --recurse-submodules https://github.com/BenoitGaltier/Migration_tools.git
Set-Location Migration_tools
npm ci
Copy-Item .env.example .env
```

Renseigner `.env` en suivant [.env.example](.env.example) :

- `ALTIUM_SOURCE_WORKSPACES_JSON` : workspaces sources et tokens API.
- `ALTIUM_TARGET_WORKSPACE_JSON` : workspace cible et token API.
- `ACTIVE_SOURCE_WORKSPACE` : source sélectionnée au démarrage.
- `ALTIUM_DESIGNER_BRIDGE_TOKEN` : token local partagé, au moins 24 caractères aléatoires.

Compiler le moteur de prévisualisation selon [renderer/README.md](renderer/README.md).
Pour migrer des projets, fermer Designer puis installer le bridge depuis une
fenêtre PowerShell administrateur :

```powershell
.\altium-extension\Fluidra.DxpBridge\install-local.ps1
```

Rouvrir Designer, le connecter au workspace cible, puis démarrer l'application :

```powershell
npm start
```

Ouvrir [http://localhost:4173](http://localhost:4173). Les ports restent **4173** pour
l'application et **4174** pour le bridge. Le bouton **Configuration** permet aussi
de modifier les paramètres des workspaces.

## Parcours de migration

### Symboles, empreintes et composants

Migrer les symboles et empreintes avant leurs composants. Choisir le dossier cible,
puis associer les templates, paramètres et révisions de modèles nécessaires.
Un composant nécessite au moins une empreinte et peut en utiliser plusieurs.

Les listes distinguent **Name**, **Revision ID** et GUID internes. Les choix de
révisions des symboles et empreintes incluent la source et la destination. Le filtre
des composants inclut Production et tous les états Prototype. Actualiser les listes
après une modification des révisions dans Designer. Le suivi des migrations et les
avertissements sur les modèles restent visibles.

### Projets

Sélectionner un projet source et un dossier cible : l'analyse est automatique.
Garder Designer connecté à la destination et confirmer ses fenêtres natives si
nécessaire. Les projets PCB (`.PrjPcb`), harnais (`.PrjHar`) et multiboard (`.PrjMbd`)
sont pris en charge. Les projets enfants d'un multiboard doivent déjà avoir des
destinations vérifiées.

La migration conserve l'historique Git et vérifie le rattachement au dossier cible,
les fichiers et la publication cloud. Si le traitement cloud est en attente,
valider le transfert existant avant toute relance. **Les releases existantes
restent dans le workspace source.**

### BOM Portal

Après migration et vérification du projet, copier une Managed BOM associée au design
courant depuis la page du projet. Les champs éditables et paramètres pris en charge
sont repris ; les lignes alternatives, écarts de composants et autres données non
prises en charge nécessitent une revue. Cette reprise est distincte des fichiers
`.BomDoc` déjà inclus dans l'historique Git du projet. Voir le
[périmètre de reprise des BOM](docs/managed-bom-migration.md).

## Développement et mise à jour

```powershell
npm test
# Contrôles natifs lors d'une modification du bridge :
.\altium-extension\Fluidra.DxpBridge\test.ps1
```

Travailler sur une branche et exécuter la suite automatisée complète avant chaque
commit. Le hook facultatif s'active avec `git config core.hooksPath .githooks`.
La validation connectée à Altium reste distincte des tests automatisés ; voir la
[validation des projets](docs/project-migration-validation.md) et des
[types de projets](docs/project-types-validation.md).

Pour mettre à jour un clone, arrêter l'application, exécuter `git pull --ff-only`,
`git submodule update --init --recursive` et `npm ci`, puis redémarrer sur le port
4173. Une mise à jour du bridge nécessite de fermer Designer pour remplacer sa DLL.

## Données locales et dépannage

Ne pas versionner `.env`, tokens, fichiers CAO, caches, journaux de transfert ni
fichiers SDK compilés. Conserver `migration_state/` lors des mises à jour : il garde
la provenance des transferts et permet leur reprise sans créer de doublons.

En cas d'erreur d'authentification, vérifier les tokens et permissions de chaque
workspace. La publication native des projets nécessite aussi la session Designer
cible. Pour les erreurs TLS d'entreprise, conserver `ALTIUM_USE_SYSTEM_CA=true` et
vérifier les certificats de confiance Windows. Si les prévisualisations manquent,
vérifier la compilation du moteur et le runtime .NET installé.
