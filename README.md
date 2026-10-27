# Assistant de migration Altium 365

## Depots GitHub et installation depuis les sources

- Application : [BenoitGaltier/Migration_tools](https://github.com/BenoitGaltier/Migration_tools).
- Bridge Designer : [BenoitGaltier/Altium_Bridge](https://github.com/BenoitGaltier/Altium_Bridge).

Le bridge est un sous-module dans `altium-extension/Fluidra.DxpBridge`. Son commit
est fixe par le depot de l'application pour conserver une paire app/bridge coherente.
Pour recuperer les deux depots :

```powershell
git clone --recurse-submodules https://github.com/BenoitGaltier/Migration_tools.git
Set-Location Migration_tools
npm ci
Copy-Item .env.example .env
```

Renseigner ensuite les tokens dans le fichier local `.env`, puis reconstruire le
renderer selon [renderer/README.md](renderer/README.md) avant de lancer
`node server.mjs`. La version de Node utilisee pour cet import est `24.19.0`.
Les ports restent **4173** pour l'app et **4174** pour le bridge.

Les depots contiennent les sources, tests, exemples de configuration et scripts de
compilation. Les tokens, sessions, journaux, caches, projets CAO et binaires locaux
restent exclus. Les instructions d'extraction de release plus bas concernent les
archives precompilees, qui ne sont pas versionnees dans Git.

Pour mettre a jour un clone existant :

```powershell
git pull --ff-only
git submodule update --init --recursive
```

Pour executer les tests depuis PowerShell :

```powershell
npm test
./altium-extension/Fluidra.DxpBridge/test.ps1
```

Pour installer le controle automatique avant les commits dans ce clone :
`git config core.hooksPath .githooks`. La CI GitHub execute aussi les tests a
chaque push et pull request. Le bridge possede son propre workflow Windows.
Les tests HTTP utilisent des depots temporaires, un faux bridge et des tokens
fictifs ; ils ne publient aucun projet dans Altium 365.

Application locale de migration de bibliotheques Altium 365. Elle accepte plusieurs
workspaces sources selectionnables et un workspace cible unique. L'ordre de migration
reste impose : symboles, empreintes, puis composants.

L'interface est disponible en francais, espagnol et anglais. Le choix de langue est
conserve dans le navigateur.

## Fonctions principales

- listes restaurees depuis un cache local persistant ;
- toutes les revisions des symboles, et les revisions disponibles des empreintes ;
- toutes les revisions dont l'etat commence par `Prototype` (par exemple `Prototype Open_Indus` ou `Prototype_Viveris`) ainsi que `Production` pour les composants ;
- rendu natif des `.SchLib` et `.PcbLib`, avec vue 2D et vue 3D des empreintes ;
- selection manuelle du repertoire cible et respect de son Item Naming Scheme ;
- historique persistant des migrations avec Revision ID source et cible ;
- mapping des templates, parametres, dictionnaires, symboles et empreintes ;
- migration semi-automatique par categorie ;
- enrichissement optionnel par Altium Designer, Manufacturer Part Search et SiliconExpert.
- application `Projects_migration` pour inventorier les projets, choisir le repertoire
  cible et conserver l'historique Git ; les releases existantes restent dans le workspace source.

Dans les listes **A migrer** et **Deja migre**, les colonnes suivent Explorer :
**Name** provient du champ API `comment`, tandis que **Revision ID** provient du champ
API `name` (par exemple `CMP-012-00013-2`). Le champ API `revisionId` est un GUID
technique, affiche separement comme **GUID interne**.

Lors de la copie d'un `.PcbLib` ou `.SchLib`, l'application neutralise les GUID de
rattachement `ITEMGUID`, `REVISIONGUID`, `VAULTGUID` et `FOLDERGUID` du workspace
source avant la creation de la revision cible, sans modifier les autres octets du fichier.
Les anciennes empreintes copiees avant ce correctif sont inspectees individuellement :
une icone d'avertissement apparait dans **Deja migre** seulement si leur fichier cible
contient encore le GUID d'une revision source. Elles restent dans **Deja migre** ; aucune
revision cible n'est supprimee ni automatiquement reclassée. Le dossier d'empreintes
correspondant au composant reste applique, mais toutes ses revisions sont proposees.

## Migration de projets

La page [http://localhost:4173/projects-migration.html](http://localhost:4173/projects-migration.html)
liste tous les projets du workspace source actif avec leur nombre de commits et de
releases. Elle permet de choisir un repertoire `PROJECT_CATALOG` du workspace cible et
d'executer automatiquement un pre-controle en lecture seule des qu'un projet et un
repertoire cible sont selectionnes. Les resultats sont conserves dans
`cache/project-migration-analyses.json` selon la duree de cache configuree.

Le pre-controle verifie la presence d'un depot Git interne, l'acces au workspace cible
et les doublons. Les releases existantes restent dans le workspace source ; leurs liens
de telechargement ne sont pas utilises par le transfert.

Avant publication, les documents lies sont controles dans le depot source. Apres
publication, l'app compare les objets Git de tous les fichiers d'origine hors
fichiers de rattachement du projet, verifies separement.
Les branches et tags sont preserves sans remplacer des references cibles existantes.
Le GUID et la phase du transfert sont journalises avant chaque commande native.
Une reponse perdue ne permet pas de recreer aveuglement un projet du meme nom.

Le statut `awaiting-cloud` signifie que le depot et les fichiers sont verifies,
mais que la generation cloud au commit cible reste a confirmer. Le bouton
**Verifier la publication cloud** effectue uniquement des lectures ; Designer
peut etre ferme. Il ne republie pas le projet. Des vues GraphQL disponibles avec
un ancien indicateur de generation a zero restent distinguees d'une generation
explicitement verifiee au commit courant.

Les audits `scripts/audit-projects.mjs` et `scripts/audit-project-git.mjs` sont en
lecture seule. Leur option `--env-file` permet d'utiliser la configuration locale
sans la copier dans une branche de test. Les rapports et depots d'audit restent
dans `.diagnostics`, ignore par Git.

Le pre-controle verifie l'acces API cible et, a chaque analyse meme mise en cache,
la connexion de Designer au workspace de destination. Le bridge 1.1.38 ou suivant
est requis pour la publication native et le rattachement du dossier. L'app clone l'historique complet, cree un
depot local temporaire et une copie de travail, puis vide uniquement
`Design/ManagedProjectGUID`. Elle ne modifie ni ne pousse jamais le depot source.
Le fichier `.PrjPcb` peut etre a la racine ou dans un sous-dossier du depot. Designer
peut le deplacer a la racine pendant la migration native et adapter ses chemins de
documents. L'app retrouve alors le fichier publie par son GUID cible, au lieu de
continuer a verifier uniquement l'ancien chemin. Les documents CAO sont conserves. Le bridge
1.1.36 est requis pour les projets imbriques : il valide le projet dans la copie Git
explicitement fournie par l'app. Les cas ambigus sont refuses avec la liste des fichiers
candidats ; une reprise conserve le fichier selectionne dans son journal.
La publication passe par `WorkspaceManager:ConvertToManagedObject` en mode silencieux
(parametres du service Altium `ConvertToManagedProjectSilent`, `UseSimpleSync=False`).
Designer doit rester ouvert sur la destination. Aucun projet vide ni template n'est
a creer manuellement. Une commande interrompue n'est jamais relancee automatiquement.
Attention : l'enregistrement silencieux peut conserver le depot EXTERNAL. L'app
execute alors explicitement `WorkspaceManager:MigrateToInternalVCS` sur la copie
locale liee au nouveau projet. Si Designer affiche sa confirmation native, valider
**Migrate**, puis **OK**. Le dernier commit porte sur le depot temporaire, jamais
sur le depot source. Seul un depot cible INTERNAL verifie peut etre declare migre.
Les requetes natives restent ouvertes au-dela de la limite de cinq minutes des
en-tetes de fetch ; une interruption conserve un etat en attente et n'envoie aucune
seconde commande automatiquement.

Chaque transfert est journalise dans `migration_state/project-transfers/` avant
publication. Une cible inachevee creee par l'app est reconnue par son identifiant,
le rattachement local, le dossier cible et le depot source ; l'app reprend cette
meme cible sans en creer une autre. Une source ayant change ou une cible sans cette
provenance reste bloquee. Les erreurs de journalisation ne masquent jamais l'erreur
native d'origine. `VaultFolder` designe le dossier propre au projet : l'app ajoute
donc le nom du projet au catalogue selectionne (par exemple
`Projects\\France Team\\Legacy\\USB_TO_LIN`). La liste cible utilise le listing
reel du catalogue Altium 365. La validation exige aussi un dossier de type `PROJECT`
avec le bon parent et le bon chemin ; une entite directe affichant un chemin
plausible ne suffit pas. Ce controle est egalement refait pour une migration deja
terminee, meme si son analyse est en cache. Une structure incoherente bloque toute
nouvelle creation et doit etre reparee sur le projet existant.

Le projet cible est cree automatiquement par Designer. En cas d'interruption,
l'application retrouve le transfert et reprend le meme projet cible apres verification ;
elle refuse de creer un doublon. Le choix de reutilisation manuelle d'un projet vide
n'est plus expose dans l'interface.

Apres publication native, l'application controle le dossier, l'identifiant de projet
dans le PrjPcb publie et la presence des commits originaux dans l'ascendance de la
branche principale cible. Elle conserve les branches/tags supplementaires sans
ecraser de reference existante. Elle ne remplace pas le nouveau commit de rattachement
par l'ancien fichier source. Le rattachement natif de l'item a son propre dossier
PROJECT et sa presence dans le catalogue Altium 365 sont verifies avant tout succes.
Les sources actuelles controlent aussi les donnees de visualisation SCH/PCB generees
par Altium 365 pour le commit publie. Un depot Git rempli ne suffit pas a valider
l'ouverture du projet dans le navigateur.
Les releases ne sont ni telechargees ni archivees dans le depot cible : elles restent
dans le workspace source. Les erreurs de leurs liens de telechargement ne bloquent
donc plus le transfert Git. Le resultat conserve l'URL du projet source pour y acceder.
Les tags doivent conserver leur identifiant exact ; les branches peuvent avancer
avec les commits de rattachement de Designer, mais doivent conserver leurs commits
source dans leur ascendance. Un echec interrompt la migration sans annoncer de succes.
Les copies locales restent disponibles pour inspection tant que Designer peut les
tenir ouvertes ; aucun nettoyage automatique n'est effectue apres une publication native.

### Harnais et multiboard

Le parcours accepte `PCB_PROJECT` (`.PrjPcb`), `HARNESS_DESIGN` (`.PrjHar`) et
`SYSTEM_DESIGN` (`.PrjMbd`), a la racine ou dans un sous-dossier du depot. Les
documents primaires lies sont controles selon le type : SCH/PCB, WirDoc/LdrDoc,
ou MbsDoc/MbaDoc. Les autres fichiers versionnes, dont les plans, BOM et OutJob,
sont aussi compares apres publication. Le type du projet cree doit correspondre
au type source. Le detachement porte uniquement sur `Design/ManagedProjectGUID` ;
il conserve les GUID des projets enfants dans les sections `DocumentN`.

Pour un multiboard, le pre-controle affiche ses dependances. Chaque enfant doit
avoir un transfert termine et journalise vers le workspace cible, avec dossier
natif, historique actuel et publication cloud verifies a nouveau. Un homonyme
n'est jamais utilise comme correspondance. Une dependance absente, ambigue,
modifiee sans historique cible correspondant ou epinglee a une revision publiee
bloque la publication du parent. L'app ne migre pas les enfants automatiquement.

Les enfants verifies sont clones dans la copie temporaire selon les chemins
attendus par le parent. Seuls leurs liens dans le `.PrjMbd` et les champs source
des modules du `.MbsDoc` sont reconnectes aux GUID Global verifies. Les connexions,
pages et autres flux du MbsDoc restent identiques ; le MbaDoc et les depots enfants
ne sont pas modifies. Les empreintes des transformations autorisees sont conservees
dans le journal et comparees apres publication.

L'API GraphQL peut retourner une liste de variantes vide pour un harnais ou un
multiboard. Leur controle cloud exige donc une generation terminee, avec les
sources `Metadata` **et** `Preview` au commit cible verifie, en plus du manifeste
Git des documents lies. Le controle PCB conserve ses exigences SCH/PCB existantes.
Une generation incomplete reste `awaiting-cloud`, sans nouvelle publication.

La portee des controles et de l'essai connecte est detaillee dans
[docs/project-types-validation.md](docs/project-types-validation.md).

## Prerequis

- Windows 10 ou 11 ;
- Node.js 24 (version verifiee : 24.19.0) ;
- .NET 10 Runtime ;
- acces reseau aux domaines Altium 365 utilises ;
- un token distinct pour chaque workspace source, avec droits de lecture ;
- un token pour le workspace cible, avec droits de lecture, ecriture et release ;
- Altium Designer et le Fluidra DXP Bridge pour la publication native des projets et l'enrichissement Designer.

Verifier les runtimes :

```powershell
node --version
dotnet --list-runtimes
```

## Installation de l'application

1. Extraire la release dans un repertoire local accessible en ecriture.
2. Ouvrir PowerShell dans ce repertoire.
3. Creer la configuration locale :

```powershell
Copy-Item .env.example .env
```

4. Renseigner les workspaces et tokens dans `.env`, ou demarrer l'application puis
   utiliser le menu **Configuration**.
5. Lancer le serveur :

```powershell
node server.mjs
```

6. Ouvrir [http://localhost:4173](http://localhost:4173).

Les bibliotheques Three.js et le moteur .NET publie sont inclus dans la release. Un
`npm install` ou une compilation du renderer ne sont donc pas necessaires pour utiliser
l'application.

## Configuration des workspaces

Le menu **Configuration** est la methode recommandee. Il permet :

- d'ajouter ou supprimer des workspaces sources ;
- de choisir la source active au demarrage ;
- de configurer l'unique workspace cible ;
- de modifier les URLs GraphQL et Files Service ;
- de remplacer les tokens ;
- de regler le cache, les certificats Windows, le port et le bridge Designer.

Les tokens existants ne sont jamais renvoyes au navigateur. Un champ token laisse vide
conserve la valeur enregistree. L'application reecrit `.env` de facon atomique et recharge
sa configuration. Le selecteur du bandeau permet ensuite de changer de source sans ouvrir
le menu.

### Variables `.env`

```dotenv
ALTIUM_SOURCE_WORKSPACES_JSON=[{"id":"ZPCE","name":"ZPCE","apiUrl":"https://source.example.altium.com/api/graphql","filesUploadUrl":"","accessToken":"token_source"}]
ACTIVE_SOURCE_WORKSPACE=ZPCE
ALTIUM_TARGET_WORKSPACE_JSON={"id":"GLOBAL_FLUIDRA","name":"Global Fluidra","apiUrl":"https://target.example.altium.com/api/graphql","filesUploadUrl":"","accessToken":"token_cible"}
ALTIUM_USE_SYSTEM_CA=true
ALTIUM_CACHE_TTL_HOURS=168
ALTIUM_DESIGNER_BRIDGE_URL=http://127.0.0.1:4174
ALTIUM_DESIGNER_BRIDGE_TOKEN=token_local_aleatoire_de_24_caracteres_minimum
```

Signification :

| Variable | Description |
|---|---|
| `ALTIUM_SOURCE_WORKSPACES_JSON` | Tableau JSON des sources. Chaque entree contient `id`, `name`, `apiUrl`, `filesUploadUrl` et `accessToken`. |
| `ACTIVE_SOURCE_WORKSPACE` | Identifiant de la source chargee au demarrage. |
| `ALTIUM_TARGET_WORKSPACE_JSON` | Objet JSON de l'unique cible, avec les memes champs. |
| `ALTIUM_USE_SYSTEM_CA` | Ajoute les certificats de confiance Windows aux certificats Node.js. |
| `ALTIUM_CACHE_TTL_HOURS` | Duree de validite des listes en cache. |
| `ALTIUM_DESIGNER_BRIDGE_URL` | Adresse HTTP locale du bridge Designer. |
| `ALTIUM_DESIGNER_BRIDGE_TOKEN` | Secret partage entre l'application et l'extension. |

Les anciennes variables `ZPCE_*`, `GLOBAL_FLUIDRA_*` et `ALTIUM_ACCESS_TOKEN`
restent lues pour faciliter la mise a niveau. Le premier enregistrement depuis le menu
les convertit automatiquement vers le nouveau format.

## Utilisation

1. Choisir le workspace source dans le bandeau.
2. Tester les connexions source et cible.
3. Migrer les symboles vers un repertoire cible compatible.
4. Migrer les empreintes et verifier leurs rendus 2D/3D.
5. Migrer les composants apres validation du template, du symbole, des empreintes et des parametres.
6. Desactiver le `Dry-run` uniquement lorsque la preparation est correcte.

Un clic sur une ligne affiche directement le rendu. Pour un composant, le symbole et
toutes les empreintes associees sont presentes ensemble. Les elements termines passent
dans **Deja migres**. Remettre un composant a migrer retire seulement son marqueur local ;
aucun objet du workspace cible n'est supprime.

Si un composant cible existe deja, l'application publie une nouvelle revision au lieu de
creer un nouvel Item. Les parametres numeriques sont normalises vers l'unite de base du
template cible (`210k` devient `210000`, `-55 degC` devient `-55`). L'empreinte IPC Medium
Density est placee en premiere position lorsqu'elle est disponible.

## Cache et fichiers locaux

- `cache/` : listes, definitions de templates, dictionnaires et rendus ;
- `migration_state/` : correspondances de modeles, mappings et migrations terminees ;
- `migration_logs/` : compte rendu JSON de chaque tentative ;
- `schema_cache/` : schemas GraphQL de diagnostic historiques.

Le cache d'une source est isole par son identifiant. Le bouton **Actualiser** ignore le
cache de la vue courante. Changer de source recharge les listes correspondantes.

## Rendu des bibliotheques

`renderer/Fluidra.AltiumRenderer` lit directement les fichiers `.SchLib` et `.PcbLib`.
Le serveur produit des SVG 2D et une scene Three.js interactive pour les empreintes 3D.
Les champs techniques `.Designator` et `.Comment` ne perturbent pas le cadrage des
empreintes. Le correctif de lecture des coordonnees SchLib est documente dans
`renderer/README.md`.

## Installation du bridge Altium Designer

Le bridge est optionnel pour la migration et obligatoire uniquement pour piloter les
services Designer. Fermer completement Altium Designer, puis executer PowerShell en mode
administrateur :

```powershell
.\altium-extension\Fluidra.DxpBridge\install-local.ps1
```

Dans la livraison composee des dossiers separes `App` et `Bridge`, lancer plutot :

```powershell
..\Bridge\Fluidra.DxpBridge\install-local.ps1
```

Le script compile la DLL, detecte l'installation Altium la plus recente, copie l'extension
dans `ProgramData` et cree `bridge.settings.json` avec le token de `.env`. Redemarrer ensuite
Altium Designer et utiliser **Tester le bridge** dans l'application.

La procedure detaillee, les commandes DXP, les routes HTTP et le depannage se trouvent dans
`altium-extension/Fluidra.DxpBridge/README.md`.

## Securite

- ne jamais publier `.env` ou `bridge.settings.json` ;
- utiliser un token distinct par workspace ;
- limiter les droits des sources a la lecture ;
- conserver le bridge sur `127.0.0.1` ;
- renouveler un token des qu'il a ete copie dans un journal, une capture ou un ticket.

## Depannage rapide

- `HTTP 401/403` : verifier que le token appartient au workspace concerne et ses permissions ;
- erreur TLS : conserver `ALTIUM_USE_SYSTEM_CA=true`, verifier VPN et proxy ;
- listes vides : utiliser **Actualiser**, puis verifier le lifecycle des revisions ;
- rendu absent : verifier .NET 10 et la presence de `renderer/runtime` ;
- bridge indisponible : verifier qu'Altium Designer est ouvert et que `/health` repond sur le port 4174 ;
- l'application ecoute toujours sur `http://localhost:4173` afin de conserver une URL stable entre les mises a jour.
