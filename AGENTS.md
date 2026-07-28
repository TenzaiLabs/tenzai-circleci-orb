<!-- Update this file when changing orb contracts, architecture, build tooling, tests, or release behavior. -->

# Tenzai Incremental Test CircleCI Orb

Public CircleCI registry orb (`tenzai/incremental-test`) that triggers a fire-and-forget Tenzai commit-diff security test after a successful deployment.

## Structure

| Path                            | Purpose                                                                |
| ------------------------------- | ---------------------------------------------------------------------- |
| `src/@orb.yml`                  | Registry metadata                                                      |
| `src/commands/trigger.yml`      | Reusable command for Node-compatible executors                         |
| `src/jobs/commit-diff-test.yml` | Turnkey post-deployment job                                            |
| `src/executors/default.yml`     | Default Node 24 executor                                               |
| `src/scripts/trigger.js`        | Provider-neutral CircleCI and Tenzai API runtime                       |
| `src/examples/deploy.yml`       | Registry usage example                                                 |
| `test/trigger.test.mjs`         | Node unit tests                                                        |
| `.circleci/`                    | Orb Development Kit validation, integration test, and release pipeline |

## Development

Use Node 24 and npm:

```bash
npm ci --ignore-scripts
npm run check
circleci orb pack src > orb.yml
circleci orb validate orb.yml
```

The runtime is CommonJS JavaScript with native `fetch`. It has no production dependencies and is included directly in the packed orb with `<<include(...)>>`; the run step dispatches it through Node with `shell: /usr/bin/env node`. Tests replace the process environment, native fetch, and console at the runtime boundary rather than adding production dependency-injection seams.

## Orb Contract

- Primary job: `commit-diff-test`; reusable command: `trigger`.
- Default context variables: `TENZAI_ACCESS_KEY`, `TENZAI_APP_ID`, and `CIRCLECI_TOKEN`. The application ID can instead be passed through `app-id`.
- The access key requires `app:read` and `scan:trigger` scopes.
- The Tenzai API defaults to `https://api.tenzai.io` and can be changed with `base-url`; the CircleCI endpoint is fixed at `https://circleci.com/api/v2`.
- API base URLs are normalized without trailing slashes. Result links are emitted only when an `api.*` host can be mapped to its `app.*` host.
- Automatic mode finds the previous successful run of the same CircleCI workflow through Insights. Insights retains at most 90 days of history.
- History pages are newest-first and fetched only until a page contains an eligible completed run. Incomplete Insights rows are skipped.
- `from-commit` bypasses CircleCI history discovery and does not require `CIRCLECI_TOKEN`.
- `dry-run` validates Tenzai authentication and application access, then stops. It does not require `CIRCLECI_TOKEN`.
- `ignore-errors` reports failures but exits successfully so an unavailable trigger cannot prevent deployment workflow history from advancing.
- Empty history skips successfully because the current run is treated as the first deployment.
- Triggering is fire-and-forget. Never poll for the eventual test result.
- The job does not check out repository contents.
- The reusable command executes with Node and does not source `$BASH_ENV`; context, job-environment, or static parameter values must provide its inputs.

Do not log credentials or include real customer identifiers in source, examples, or fixtures.

## Releases

The Orb Development Kit pipeline packs, lints, reviews, and tests the orb. Tags matching `vX.Y.Z` publish immutable production versions to `tenzai/incremental-test`; other builds test the injected development orb. The dry-run integration test uses a restricted `tenzai-orb-testing` context containing `TENZAI_ACCESS_KEY` and `TENZAI_APP_ID`. Production publishing uses the restricted `orb-publishing` CircleCI context.
