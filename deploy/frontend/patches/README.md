# Frontend API contract patches

The deployment watcher archives the upstream web revision and runs
scripts/apply-frontend-patches.py before building. The patch files and helper contribute
to its build fingerprint.

0001-api-contracts.patch was verified against AzizBokhidjonov/alishax commit 5d39744
(9 September 2026). It fixes medical response handling, draft file uploads, complete
attendance rosters, ad hoc pickup selection, supported notification channels and local
type/lint errors. See docs/project-fixes-2026-10-03.md for validation.

Apply manually to an archived checkout:

```bash
python scripts/apply-frontend-patches.py --source /path/to/archived-web --patches deploy/frontend/patches
```

A matching patch is applied. A fully applied patch is accepted using a reverse check.
A mismatch fails before source mutation. The watcher preserves the existing deployed
site when patching or building fails. Reconcile these fixes with upstream and update
the patch when newer source overlaps; do not bypass the check and deploy incompatible UI.

Keep patches independent: each must be checkable against the archived source. The helper
also checks the combined pending patches before applying them.
