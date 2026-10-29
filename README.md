# Altium 365 Migration Assistant

English | [Français](README.fr.md)

A local web application for migrating symbols, footprints, components and design
projects between Altium 365 workspaces. It also supports assisted transfer of
project-associated BOM Portal documents. The interface is available in English,
French and Spanish.

The application lives in this repository. Its Altium Designer extension is maintained
in [Altium_Bridge](https://github.com/BenoitGaltier/Altium_Bridge), included as a Git
submodule under `altium-extension/Fluidra.DxpBridge`.

## Requirements

- Windows 10 or 11, Git and Node.js **24.19.0**.
- Altium 365 workspace tokens: read access to the source and the permissions required
  to create and release items in the destination.
- .NET 10 SDK to build the library preview renderer.
- For project publication: a licensed Altium Designer session connected to the
  destination workspace, plus the DXP Bridge. Building it requires the Altium SDK;
  see the [bridge instructions](altium-extension/Fluidra.DxpBridge/README.md).

## Getting started

```powershell
git clone --recurse-submodules https://github.com/BenoitGaltier/Migration_tools.git
Set-Location Migration_tools
npm ci
Copy-Item .env.example .env
```

Edit `.env` using the documented fields in [.env.example](.env.example):

- `ALTIUM_SOURCE_WORKSPACES_JSON`: source workspaces and their API tokens.
- `ALTIUM_TARGET_WORKSPACE_JSON`: destination workspace and its API token.
- `ACTIVE_SOURCE_WORKSPACE`: source selected at startup.
- `ALTIUM_DESIGNER_BRIDGE_TOKEN`: shared local token, at least 24 random characters.

Build the preview renderer by following [renderer/README.md](renderer/README.md).
For project migration, close Designer and run the bridge installer from an
administrator PowerShell window:

```powershell
.\altium-extension\Fluidra.DxpBridge\install-local.ps1
```

Reopen Designer, connect it to the destination workspace, then start the app:

```powershell
npm start
```

Open [http://localhost:4173](http://localhost:4173). The app uses port **4173** and
the Designer bridge uses **4174**. Workspace settings are also available through
the app's **Configuration** button.

## Migration workflows

### Symbols, footprints and components

Migrate symbols and footprints before their components. Select a destination
folder, then map component templates, parameters and model revisions as needed.
Components require at least one footprint and can use multiple footprints.

The lists distinguish **Name**, **Revision ID** and internal GUIDs. Symbol and
footprint revision choices include source and destination revisions; the component
filter includes Production and all Prototype states. Refresh lists after changing
revisions in Designer. Existing migration records and model warnings remain visible.

### Projects

Select one source project and a destination folder; analysis runs automatically.
Keep Designer connected to the destination and confirm its native migration dialogs
when prompted. PCB (`.PrjPcb`), harness (`.PrjHar`) and multiboard (`.PrjMbd`) projects
are supported. Multiboard children must already have verified destination projects.

Migration preserves Git history and checks the destination folder binding, design
files and cloud publication. Cloud processing can remain pending: validate the
existing transfer before retrying. **Existing releases stay in the source workspace.**

### BOM Portal

After a project is migrated and verified, copy an associated current-design Managed
BOM from the project page. Supported editable fields and settings are transferred;
alternate rows, part differences and other unsupported data require review.
This is separate from `.BomDoc` files already included in the project's Git history.
See [Managed BOM transfer](docs/managed-bom-migration.md) for the supported scope.

## Development and updates

```powershell
npm test
# Run native checks when working on the bridge:
.\altium-extension\Fluidra.DxpBridge\test.ps1
```

Use a branch for changes and run the complete automated suite before committing.
The optional pre-commit hook can be enabled with
`git config core.hooksPath .githooks`. Live Altium validation is separate from
automated tests; see [project validation](docs/project-migration-validation.md) and
[project-type validation](docs/project-types-validation.md).

To update an existing checkout, stop the app, run `git pull --ff-only`,
`git submodule update --init --recursive` and `npm ci`, then restart it on port 4173.
Bridge updates require closing Designer before replacing its loaded extension.

## Local data and troubleshooting

Keep `.env`, tokens, CAD files, caches, transfer journals and compiled SDK files out
of Git. Preserve `migration_state/` when updating: it records transfer provenance
and supports recovery without creating duplicate targets.

For authentication errors, check each workspace token and its permissions. Native
project publication also requires Designer's destination session. For corporate TLS
errors, keep `ALTIUM_USE_SYSTEM_CA=true` and verify the Windows certificate trust.
If previews are unavailable, check the renderer build and installed .NET runtime.
