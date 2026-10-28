# Managed BOM transfer

The project page discovers BOM Portal Managed BOMs associated with the selected
source project's GUID. This is independent of `.BomDoc`, which remains a normal
versioned project file. An unavailable procurement API is displayed as an analysis
error and is never interpreted as an empty inventory or a failed Git transfer.

## Operation

1. Migrate the design project using the existing project workflow.
2. Require completed provenance, native folder binding, original Git history,
   original source files and current cloud publication. Re-read these proofs
   before any BOM publication; an unrelated same-name project is not sufficient.
   This BOM-specific qualification follows the current destination HEAD, so later
   documentation additions do not invalidate it. All original source blobs still
   have to match and all source references must remain in its history. The selected
   variant's primary PCB and schematics require current cloud processing; auxiliary
   panelization PCBs are verified in Git rather than required as BOM source views.
   The original project migration journal and its validation rules are unchanged.
3. Select **Copy this BOM** for a current-design BOM. Verify the selected variant
   exists in the destination. Native creation uses the target project GUID and
   the parent's selected catalog, without changing project files or Git refs.
4. Restore supported scalar columns and production/procurement settings. Match
   rows by their complete, unambiguous designator set and manufacturer/part
   identity. Never map rows by position or models/components by their names.
5. Re-read the same BOM to verify project, variant, folder, copied values and
   remaining differences. A review-required result is distinct from verified
   supported data. The source and target links remain accessible in the UI.
   Compare source/target values in the expandable differences table, or download
   the transfer report and complete source grid for controlled review.

## Scope

| Data | Handling |
| --- | --- |
| Native project association | Created from the verified target design; checked after every content update. |
| Name, description, extra quantity, target price | Replayed through editable scalar columns and verified. |
| Custom string/numeric columns | Matched by semantic name and type; missing columns created. |
| Country, currency, production quantity/date, supplier selection/priorities, packaging and target-price settings | Supported native settings restored and compared. |
| Design quantities/MPNs and alternate/extra rows | Compared; differences require review, without rewriting the design or inventing rows. |
| Selected supplier offers | Differences reported; not silently replaced or represented as preserved. |
| Technical workspace/item/revision identifiers | Fresh destination design data retained; source identifiers are never replayed as bindings. |
| Native history, releases, comments, costed BOMs, waivers, display preferences | Remain in the source workspace. No claim of full object/history migration. |
| Release-based, pinned-revision or consolidated BOM | Listed with an explicit unsupported-source state. Never regenerated from the latest design as a substitute for the original snapshot. |

The complete source details are saved locally under ignored
`migration_state/project-boms/`, in immutable files identified by a source-data
hash. These are review/recovery snapshots, not Git commits, release downloads or
an archive branch. Credentials are never included in these files. The inventory
cache is workspace scoped, expires according to the configured cache duration,
and is bypassed before each transfer and by **Refresh BOMs**.

Creation and each subsequent mutation have durable provenance written before the
request. Unknown creation outcomes are blocked from automatic replay. Lost data
update replies are reconciled by reading the recorded target; no second mutation
is issued. Already verified or review-required BOMs are only re-checked, preserving
any later user edits. Workspace settings/source switches/restarts are blocked
during an active transfer. Existing project migration and library APIs are kept
independent of the BOM workflow.

## API and qualification

Public GraphQL `bomBoms` provides discovery and project GUID associations. Current
public `BomCreateBomInput` has no source-project field, so this workflow deliberately
does not use it to create a detached BOM or patch the Project parameter afterwards.
Native `import/design`, `boms/{id}/details`, `grid/columns` and `grid/batch/cells`
contracts were inspected in Altium's web client (webui 2.296.0, BOM 2.305.0).
These native routes are internal to the product and may evolve. The BOM service
is discovered through workspace configuration; only HTTPS on that same origin is
accepted, with the workspace's existing API token and without following redirects.

Connected qualification covers source discovery, native creation from the target
design, asynchronous initialization, project association, scalar replay and
read-only reconciliation of the same BOM. Automated tests additionally cover lost
replies, workspace boundaries, source drift and isolated HTTP/Git transfer.
Source Portal choices may differ from today's design; unavailable suppliers,
alternate rows and part/quantity differences remain explicit review items. This
is an assisted transfer of supported data, not a guarantee of a lossless native
Managed BOM migration. Live qualification reports and CAD identifiers stay in
ignored local diagnostics and transfer journals.

References:

- [BOM Portal](https://www.altium.com/documentation/altium-365/bom-portal)
- [Project association and synchronization](https://www.altium.com/documentation/altium-365/workspace-projects)
- [Public BOM creation input](https://docs.developer.altium.com/platform-api-docs/reference/procurement/types/inputs/bom-create-bom-input/)
