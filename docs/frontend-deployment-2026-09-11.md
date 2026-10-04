# Frontend deployment integration — 2026-09-11

Source: [AzizBokhidjonov/alishax](https://github.com/AzizBokhidjonov/alishax),
`main`, tested revision `5d39744`. Frontend development remains in that repository.

The backend checkout now includes an SSR Docker recipe, a Compose web service on
port 3000, Caddy routes, and an installer for the deploy user's crontab (or an
optional systemd timer when run with sudo). The watcher fetches
the frontend branch every two minutes, builds changed commits, checks startup,
and restores the previous image if replacement startup fails. Backend CI updates
only the API container. Frontend deployment does not run backend migrations.

See [DEPLOYMENT.md §8](../DEPLOYMENT.md#8-alishax-frontend-and-automatic-updates)
for server installation, public build configuration, logs, pause and rollback.

## Verification completed locally

- Frontend Vite/Nitro production build succeeded.
- Linux production Docker image built successfully from the upstream commit.
- Production Compose configuration and Caddy configuration validated.
- Through isolated Caddy containers: `/`, `/kirish`, `/bolalar` and their built
  assets returned successful HTML/asset responses. The protected route check
  covers its unauthenticated shell, not logged-in business operations.
- Both API host routing and `/api/v1/health` on the UI host passed against a local
  test API. Cookie, Authorization, and Set-Cookie attributes were preserved.
- Six Linux updater regression tests passed: initial deployment, unchanged
  revision skip, new revision deployment, build failure, candidate health failure,
  rollback after replacement failure, and rejection of relative API URLs. The
  initial deployment and unchanged revision checks share one test.
- These updater tests are included in backend CI.
- Three additional non-root installer tests passed: preserve existing cron jobs
  across repeated installs, leave them unchanged after a failed build, and reject
  malformed frontend cron markers. Total deployment tests: nine.

## Remaining upstream frontend checks

The supplied frontend builds, but its quality checks are not all clean:

- `bun install --frozen-lockfile` fails because the lockfile is out of sync with
  the package manifest. The deployment recipe uses Bun 1.3.10 to reconcile it.
  Commit a synchronized `bun.lock` in the frontend repo before switching to
  frozen installs. The local review checkout contains a regenerated lockfile.
- TypeScript reports one overload error at
  `src/hooks/use-entity-form.ts:58`: the generic `ZodType<T>` definition passed to
  `zodResolver` lacks the required `typeName` in its type definition.
- ESLint reports five Prettier formatting errors in `src/api/http.ts`,
  `src/api/types/attendance.ts`, `src/api/types/people.ts`,
  `src/api/types/system.ts`, and `src/features/guardians/duplicate.ts`.

These findings have not been pushed to the frontend repository. The checks above
do not establish that every frontend form matches the current backend contract.

## Remote status — updated 2026-09-12

Installed on `deploy@alishaxkids.uz` (`189.74.97.132`) in `/home/deploy/app`.
The public frontend and login page are live at `https://alishaxkids.uz/` and
`https://alishaxkids.uz/kirish`. Deployed frontend revision:
`5d39744effd53b5f5e53ae61218cd137f84ed226`.

The deploy user's crontab checks frontend `main` every two minutes. No sudo or
root SSH access was needed. The web container is healthy, and a manual repeat
check correctly skipped the unchanged commit. The timestamp and revision of the
latest successful check are in `data/frontend-deploy/last-successful-check`.
An unattended cron check was confirmed at `2026-09-12T14:44:03Z` for the deployed
revision. Nine isolated deployment tests also passed on the server as `deploy`.

Live HTTPS verification passed for the landing page, login page, protected-page
shell, static assets, API health on both hostnames, credentialed CORS preflight,
and rejection of unauthenticated access. No browser was connected in this session,
so interactive login and authenticated frontend workflows were not verified.

The API was already in a restart loop before installation: its image contained
`dist/src/main.js`, while its startup command referenced `dist/main`. A recovery
image changes only that command; the API is now healthy. `tsconfig.build.json`
now explicitly compiles `src/` to `dist/`, and the local build verifies that future
images will contain the expected `dist/main.js`. The Compose startup command
supports both entry-point layouts during this transition, so older
published images also start correctly. Docker and CI builds now assert the expected
entry-point file exists. The existing production CORS
escape hatch was disabled; the frontend origin remains explicitly allowed.

Pre-install configuration backups are in
`/home/deploy/app/data/frontend-install-20260912/`, with restricted directory access.
The original API image is retained as `kindergarten-api:before-frontend-20260912`.
No new database migrations or business-data edits were applied. Earlier local
backend feature/integrity changes remain undeployed. Deployment files and the
build configuration correction are local/server changes, not a GitHub push.
