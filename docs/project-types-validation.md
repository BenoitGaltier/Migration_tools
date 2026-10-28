# Qualification des types de projets

Branche `support-harness-multiboard`, bridge 1.1.39, Node 24.19.0.
Les ports de production restent 4173 et 4174.

## Automatisation

Les 99 tests applicatifs passent sous Windows. Ils incluent les tests existants
de composants, symboles et empreintes, ainsi que des essais HTTP utilisant les
routes de production et de vrais depots Git temporaires. Aucun de ces essais
n'appelle un workspace Altium reel.

Les scenarios couvrent les trois types PCB, harnais et multiboard, les projets
imbriques, les fichiers Unicode et binaires, les historiques, les reponses natives
perdues, les attentes cloud et la reprise du meme GUID. Un type cible incorrect,
un ancien bridge, un document absent ou une dependance non verifiee bloque le
transfert. Les essais multiboard verifient les correspondances par GUID, le
changement de nom d'un enfant cible, les liens des modules, la preservation des
connexions, pages et fichiers d'assemblage, et l'absence d'ecriture dans les
depots enfants. Les archives corrompues et les references ambigues sont refusees.

L'essai connecte a aussi reproduit le refus Nexar `unsupported URL protocol`
si une requete demande la derniere revision Git du depot local EXTERNAL avant
la conversion native. Le test HTTP reproduit ce refus pour toute lecture
prematuree de revision. L'app lit uniquement l'identite, le type et le depot a
cette etape ; les revisions et donnees cloud sont verifiees apres conversion.

Un autre essai HTTP perd la reponse apres conversion native et ecriture du
marqueur de fin. La reprise verifie le meme depot INTERNAL, sans seconde
publication ni seconde commande de conversion.

Les 19 controles natifs de chemins, 15 controles de dossiers et 17 controles
de transport passent. Les pertes de connexion avant et apres les en-tetes,
les sockets abandonnees et les connexions fermees ne provoquent aucune nouvelle
tentative d'ecriture. Les erreurs de programmation restent distinctes.
La
compilation Release avec le SDK installe reussit. Les doubles du SDK et le faux
bridge des essais HTTP ne qualifient pas a eux seuls la commande Designer reelle.

## Inspection connectee en lecture seule

Les trois depots de harnais et le depot multiboard source ont ete inspectes sans
modification. Leurs documents primaires existent et le detachement de la seule
liaison parent est verifie. Le format multiboard reel contient cinq modules pour
quatre projets enfants distincts. La reconnexion a des GUID fictifs, uniquement
en memoire, preserve les autres flux de l'archive. Aucun projet multiboard reel
n'a ete publie pendant ce controle.

Lors de l'inspection, les quatre enfants du multiboard n'ont pas encore de transfert
Global verifie. Le pre-controle les affiche comme dependances a migrer et bloque
le parent. Ce cas reel ne valide pas encore une publication multiboard native.

Les quatre projets source retournent une liste GraphQL de variantes vide. Le
service de generation fournit pourtant Metadata et Preview au commit courant.
Cette observation motive la verification cloud specifique aux nouveaux types ;
elle ne remplace pas le controle visuel du harnais pilote apres publication.

## Essai reel et deploiement

La validation en lecture seule du PCB de reference deja migre retourne encore
`migrated` avec historique et generation cloud verifies au meme commit cible,
en utilisant le serveur de cette branche. Elle ne relance aucune publication.

Le harnais pilote a ete migre vers le catalogue White Space. Les six commits
source sont tous presents dans les dix commits de la branche principale cible.
Les six fichiers d'origine hors fichier de rattachement ont les memes objets Git
et modes ; le HEAD distant source reste inchange. Le dossier PROJECT propre au
projet et son rattachement au catalogue choisi sont verifies par les API natives.

La generation fournit Metadata et Preview au commit cible verifie. Les vues
Wiring et Layout affichent les documents dans Altium 365. Une seconde validation
en lecture seule retourne `migrated`, sans autre commande de conversion.

La confirmation native a pris plus de temps que le delai HTTP de l'app. Le
script et le depot indiquaient pourtant une conversion terminee. La reprise a
complete les controles sur le meme GUID, sans recreer de cible. Le bridge 1.1.39
corrige l'ecriture d'une erreur sur la connexion fermee apres ce retour tardif.
L'application principale conserve la version precedente pendant la qualification
et la preparation du deploiement.

Les anciennes releases restent dans la source. Aucun telechargement de release
ni branche d'archive n'est reintroduit. Les rapports connectes, projets CAO,
sessions et journaux restent locaux et ignores par Git.
