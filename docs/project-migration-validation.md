# Validation de la migration de projets — 27 octobre 2026

## Versions et controles automatiques

- Application : branche `stabilize-project-migration`, commit initial `7328023`.
- Bridge : version `1.1.37`, commit fonctionnel `b42a6eb`, puis `7d96301`
  pour conserver les fins de ligne des hooks Git sous Windows.
- Node : `24.19.0`. Ports conserves : app `4173`, bridge `4174`.
- 65 tests applicatifs passent sous Windows. La CI de l'app passe sous Linux.
- Un clone recursif neuf des deux branches GitHub passe aussi les 65 tests sous
  Windows, avec le commit du bridge fixe par le sous-module.
- 7 controles de chemins et 15 controles de rattachement natif passent pour le
  bridge, localement et dans sa CI Windows. Compilation Release avec le SDK Altium
  installe reussie. Les doubles du SDK ne remplacent pas un essai connecte.
- Le bloc de migration des composants, symboles et empreintes est identique a la
  reference `d1a662c` apres normalisation des fins de ligne. Leurs tests existants
  restent dans la suite complete.

[CI application](https://github.com/BenoitGaltier/Migration_tools/actions/runs/40522502740)
et [CI bridge](https://github.com/BenoitGaltier/Altium_Bridge/actions/runs/40522369911).

## Pannes reproduites et couvertes

Les tests HTTP executent les vraies routes de l'app avec de vrais depots Git
temporaires, un bridge factice et des donnees fictives. Ils verifient :

- projet a la racine et projet imbrique relocalise par la publication native ;
- historique original dans la branche principale cible, branches et tags ;
- identite des fichiers binaires, espaces, accents et encodages de projet ;
- refus des documents CAO absents avant toute publication ;
- refus d'une collision de catalogue et d'une modification de workspace en cours ;
- prevention des commandes simultanees et d'une seconde publication apres une
  reponse perdue, meme quand la liste des projets n'est pas encore indexee ;
- conservation du resultat lorsque le journal de messages est indisponible ;
- ecriture atomique du journal de transfert malgre un verrou Windows transitoire ;
- attente cloud distincte d'un echec de transfert et verification ulterieure sans
  Designer ni commande de publication ;
- marqueur cloud historique indisponible distingue des donnees de vues disponibles ;
- conservation des releases dans la source, sans requete de telechargement.

## Audit connecte en lecture seule des references White Space

Les depots source et cible ont ete clones integralement. Dans les six cas,
le commit source est ancetre de la branche principale cible. Tous les fichiers
d'origine hors fichiers de rattachement ont les memes objets Git et modes.
Les six dossiers natifs et leurs associations au catalogue sont verifies par API.

| Projet | Commits source | Commits cible | Fichiers d'origine compares |
| --- | ---: | ---: | ---: |
| WS_FLOWMETER | 135 | 141 | 24 |
| Turbidity Sensor | 13 | 19 | 28 |
| MTI-1_SOCKET | 6 | 10 | 8 |
| INNO_MEGATRON_MKIII_MAIN | 26 | 30 | 20 |
| INNO_IMU_9X_AHRS | 7 | 11 | 14 |
| IMU_9X | 7 | 10 | 15 |

Les trois dernieres references ont des variantes de design disponibles alors que
l'ancien service de generation indique encore zero et aucune source Metadata.
Ce seul indicateur ne permet pas de conclure a une perte de fichiers ou d'historique.
Ces projets de reference n'ont ete modifies par aucun audit.

## Essai reel autorise

Projet : **IMU_TEST** de ZPCE vers Global Fluidra,
`Projects/France Team/Legacy/White Space`.

Controle initial : 64 commits, 42 fichiers, 18 documents schema/PCB lies,
aucune release. Commit source : `ec7798e6ae52455cf4d61dda923fd90b1698e64e`.
La source reste en lecture seule. Resultat de publication a completer apres
verification native, Git et ouverture web.

## Perimetre et limites

L'inventaire courant contient 123 projets source : 119 PCB, 3 faisceaux et un
systeme multi-cartes. Le parcours natif de cette app accepte les projets PCB.
Les quatre autres types restent bloques avant publication et ne sont pas
qualifies par l'essai PCB. Les projets source sans homonyme cible sont 108 ;
ce rapprochement par nom n'est pas une preuve de migration. Les 123 depots Git
sont lisibles ; leurs HEAD correspondent a ceux annonces par l'API lors du
controle. Ce controle de references ne valide pas le contenu de tous ces projets.

Les tests automatises ne garantissent pas l'absence de panne externe, de probleme
de droits ou de projet source incomplet. Les controles d'integrite et les reprises
sur le meme GUID servent a les detecter sans recreation ni ecrasement aveugle.
Les rapports detailles, depots CAO, caches et identifiants restent dans les fichiers
locaux ignores ; aucun n'est publie dans les depots GitHub.
