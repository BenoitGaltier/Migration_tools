# Repository workflow

- Work from `BenoitGaltier/Migration_tools`; the bridge is the separate
  `BenoitGaltier/Altium_Bridge` repository referenced by the submodule at
  `altium-extension/Fluidra.DxpBridge`.
- Make behavioral changes on a Git branch. Add a regression case for the observed
  failure, run the relevant tests after each change, and run the complete automated
  suite before each commit. Build the bridge before committing bridge changes.
- Push bridge commits before updating the app's submodule pointer. Verify a clean
  recursive clone before delivering a change that affects the repository layout.
- Keep the user-facing app on port 4173 and the Designer bridge on port 4174.
  Isolated tests may allocate temporary loopback fixture ports.
- Preserve component, symbol and footprint migration behavior when changing the
  project workflow. Run their existing tests as part of the regression suite.
- Keep credentials, CAD projects, live audit reports, caches, migration journals
  and compiled SDK files out of Git. Live audit tools must be read-only by default.
- Persist transfer provenance before any native publication command. Never
  automatically repeat a command whose result is unknown. Reuse the same target
  GUID only after checking its recorded provenance and current state.
- Project creation alone is not migration success. Verify native project-folder
  binding, Git history and source design files, and the published design state.
  Treat delayed cloud generation as pending validation, not as a reason to create
  another project or alter unchanged design files.
- Existing releases remain in the source workspace, as requested by the user.
  Do not reintroduce release downloads or an archive branch.
