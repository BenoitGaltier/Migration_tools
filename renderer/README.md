# Moteur de rendu Altium

`Fluidra.AltiumRenderer` lit directement les fichiers `.SchLib` et `.PcbLib` téléchargés depuis
Altium 365. Le serveur met en cache le SVG 2D et la scène 3D JSON de chaque révision.

Les archives precompilees fournissent le runtime dans `runtime/` ; ce dossier est
ignore par Git et doit etre reconstruit dans un clone des sources.
Le code s'appuie sur OriginalCircuit AltiumSharp v2,
sous licence Apache-2.0. La source utilisée pour la compilation est disponible à
https://github.com/issus/AltiumSharp.

Le runtime livre est directement utilisable avec .NET 10. Pour reconstruire le moteur depuis les
sources, clonez d'abord AltiumSharp et ses sous-modules a l'emplacement attendu par le projet :

```powershell
git clone --recurse-submodules https://github.com/issus/AltiumSharp .diagnostics/AltiumSharp-src
git -C .diagnostics/AltiumSharp-src checkout ce72437f30cd54f549601d4e0ca5846d21272150
git -C .diagnostics/AltiumSharp-src submodule update --init --recursive
git -C .diagnostics/AltiumSharp-src apply ../../renderer/AltiumSharp-local.patch
dotnet publish renderer/Fluidra.AltiumRenderer/Fluidra.AltiumRenderer.csproj `
  -c Release -p:NuGetAudit=false -o renderer/runtime
```

Executer ces commandes depuis la racine de l'application avec le SDK .NET 10.
Le correctif combine la conversion des coordonnees SchLib et le traitement des
couches implicites des empreintes utilises par le runtime local actuel. Il remplace
l'application separee de l'ancien correctif `AltiumSharp-SchLib-vertex-scale.patch`.
Le code AltiumSharp complet reste dans son depot amont ; seuls les ajustements
locaux et sa reference exacte sont conserves ici.
