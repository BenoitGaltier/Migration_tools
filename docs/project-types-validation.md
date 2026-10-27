# Qualification des types de projets

Branche `support-harness-multiboard`, bridge 1.1.38, Node 24.19.0.
Les ports de production restent 4173 et 4174.

## Automatisation

Les 98 tests applicatifs passent sous Windows. Ils incluent les tests existants
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

Les 19 controles natifs de chemins et 15 controles de dossiers passent. La
compilation Release avec le SDK installe reussit. Les doubles du SDK et le faux
bridge des essais HTTP ne qualifient pas a eux seuls la commande Designer reelle.

## Inspection connectee en lecture seule

Les trois depots de harnais et le depot multiboard source ont ete inspectes sans
modification. Leurs documents primaires existent et le detachement de la seule
liaison parent est verifie. Le format multiboard reel contient cinq modules pour
quatre projets enfants distincts. La reconnexion a des GUID fictifs, uniquement
en memoire, preserve les autres flux de l'archive. Aucun projet multiboard reel
n'a ete publie pendant ce controle.

Les quatre enfants du multiboard inspecte n'ont pas encore de transfert Global
verifie. Le pre-controle doit les afficher comme dependances a migrer et bloquer
le parent. Ce cas reel ne valide pas encore une publication multiboard native.

Les quatre projets source retournent une liste GraphQL de variantes vide. Le
service de generation fournit pourtant Metadata et Preview au commit courant.
Cette observation motive la verification cloud specifique aux nouveaux types ;
elle ne remplace pas le controle visuel du harnais pilote apres publication.

## Essai reel et deploiement

La validation en lecture seule du PCB de reference deja migre retourne encore
`migrated` avec historique et generation cloud verifies au meme commit cible,
en utilisant le serveur de cette branche. Elle ne relance aucune publication.

Le harnais pilote est autorise vers le catalogue White Space. Sa publication,
son historique, ses fichiers, son dossier natif et son rendu cloud restent a
qualifier avant le deploiement de cette branche. L'application principale
conserve la version precedente pendant cette qualification.

Les anciennes releases restent dans la source. Aucun telechargement de release
ni branche d'archive n'est reintroduit. Les rapports connectes, projets CAO,
sessions et journaux restent locaux et ignores par Git.
