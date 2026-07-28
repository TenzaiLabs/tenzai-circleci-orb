# Tenzai Incremental Test — CircleCI Orb

Trigger an AI-powered [Tenzai](https://tenzai.io) security test after a successful CircleCI deployment.

The orb is **fire-and-forget**. It compares the commit deployed by the previous successful run of the same workflow with the current commit, submits a `COMMIT_DIFF` test against an existing Tenzai application, and exits as soon as Tenzai accepts the request. It does not wait for the eventual verdict.

## Quick start

Create a restricted CircleCI context named `tenzai` with:

| Variable            | Purpose                                                                     |
| ------------------- | --------------------------------------------------------------------------- |
| `TENZAI_ACCESS_KEY` | Tenzai service-account access key with `app:read` and `scan:trigger` scopes |
| `TENZAI_APP_ID`     | ID of an existing Tenzai application                                        |
| `CIRCLECI_TOKEN`    | CircleCI personal API token used to read workflow and pipeline history      |

Then run the orb job after deployment with `requires`:

```yaml
version: 2.1

orbs:
  tenzai: tenzai/incremental-test@1.0.0

jobs:
  deploy:
    docker:
      - image: cimg/base:current
    steps:
      - checkout
      - run: ./deploy.sh

workflows:
  deploy-and-test:
    jobs:
      - deploy
      - tenzai/commit-diff-test:
          context: tenzai
          requires:
            - deploy
```

Create the Tenzai application first, including its deployed target, connected code source, and any credentials the test needs. The orb does not create or configure applications.

## Automatic commit discovery

The orb uses `CIRCLE_WORKFLOW_ID` and the CircleCI v2 API to:

1. Identify the current workflow and pipeline.
2. Read successful runs of the same workflow from CircleCI Insights.
3. Select the most recently completed run older than the current workflow.
4. Use that run's pipeline revision as `fromCommit` and the current pipeline revision as `toCommit`.

The first deployment skips successfully because no previous deployment exists. CircleCI Insights retains at most 90 days of workflow history, so a workflow with no successful run in that window is also treated as a first deployment.

Insights pages are returned newest-first. The orb stops reading history as soon as a page contains an eligible completed run and ignores incomplete rows for running or partially ingested workflows.

By default, history is searched across all branches to match workflow-level deployment history. Set `history-branch` when the same workflow maintains independent deployment histories per branch.

`CIRCLECI_TOKEN` must be a [CircleCI personal API token](https://circleci.com/docs/guides/toolkit/managing-api-tokens/) stored in a restricted context. CircleCI does not provide a job-scoped token that can read this API history.

## Explicit commit range

Set `from-commit` to bypass CircleCI history discovery. Explicit mode does not require `CIRCLECI_TOKEN`:

```yaml
- tenzai/commit-diff-test:
    context: tenzai-without-circleci-token
    from-commit: "1111111111111111111111111111111111111111"
    to-commit: "2222222222222222222222222222222222222222"
    repository: example/web-app
```

`to-commit` defaults to `CIRCLE_SHA1`, and `repository` defaults to the current CircleCI project. CircleCI's GitHub App integration does not provide the legacy `CIRCLE_PROJECT_USERNAME`, `CIRCLE_PROJECT_REPONAME`, or `CIRCLE_REPOSITORY_URL` variables. In explicit mode, set `repository` when those variables are unavailable.

## Parameters

The `commit-diff-test` job and `trigger` command share these parameters:

| Parameter                 | Default                 | Description                                                                     |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| `access-key-variable`     | `TENZAI_ACCESS_KEY`     | Name of the environment variable containing the Tenzai access key               |
| `app-id`                  | empty                   | Application ID; takes precedence over `app-id-variable`                         |
| `app-id-variable`         | `TENZAI_APP_ID`         | Name of the environment variable containing the application ID                  |
| `base-url`                | `https://api.tenzai.io` | Tenzai platform API base URL                                                    |
| `circleci-token-variable` | `CIRCLECI_TOKEN`        | Name of the environment variable containing the CircleCI personal API token     |
| `from-commit`             | empty                   | Explicit base commit; bypasses automatic history discovery                      |
| `to-commit`               | empty                   | Explicit target commit; otherwise the current CircleCI revision                 |
| `repository`              | empty                   | Repository in `owner/repo` form; otherwise the current project                  |
| `history-branch`          | empty                   | Restrict automatic history discovery to one branch                              |
| `dry-run`                 | `false`                 | Validate Tenzai authentication and application access without triggering a test |
| `ignore-errors`           | `false`                 | Report failures without failing the CircleCI step or job                        |

The job also accepts `node-version`, which defaults to `24.15.0` from the `cimg/node` image.

### Custom environment variable names

Parameters identify environment variable **names**, not secret values:

```yaml
- tenzai/commit-diff-test:
    context: security-testing
    access-key-variable: MY_TENZAI_ACCESS_KEY
    app-id-variable: MY_TENZAI_APP_ID
    circleci-token-variable: MY_CIRCLECI_TOKEN
```

## Reusable command

Use `trigger` inside an existing job when its executor already provides Node.js 24 or newer:

```yaml
jobs:
  deploy:
    docker:
      - image: cimg/node:24.15.0
    steps:
      - checkout
      - run: ./deploy.sh
      - tenzai/trigger
```

The command runs directly with Node, so it does not source CircleCI's `$BASH_ENV`. Values exported to `$BASH_ENV` by an earlier step are unavailable to the command. Put credentials in a context or job environment, and pass a known application ID through `app-id` when needed.

The standalone `commit-diff-test` job does not check out the repository.

## Dry run

`dry-run: true` sends only `GET /v1/applications/{app-id}` to the configured Tenzai API. It validates the access key and application access without reading CircleCI history or triggering a test, so `CIRCLECI_TOKEN` is not required. Use `base-url` to run this integration check against a non-production environment. Trailing slashes are removed; test links derive the matching app host when the API host starts with `api.`. Other host patterns omit the UI link rather than pointing it at the API.

## Failure handling

By default, malformed configuration, CircleCI API failures, and Tenzai API failures fail the step. Set `ignore-errors: true` when a transient trigger failure must not fail the deployment workflow. The error is still reported, but the step exits successfully so later successful deployments remain eligible as history anchors.

## Results

The orb succeeds after Tenzai accepts the test. Test execution continues asynchronously in Tenzai. For applications connected to GitHub, the Tenzai GitHub App posts the eventual **Tenzai Test** check run and findings report on the tested commit.

## Development and releases

```bash
npm ci --ignore-scripts
npm run check
circleci orb pack src > orb.yml
circleci orb validate orb.yml
```

The CircleCI pipeline uses the Orb Development Kit to lint, pack, review, and integration-test the orb. Tags matching `vX.Y.Z` publish immutable production versions to `tenzai/incremental-test`.

### Maintainer setup

Before the first pipeline runs:

1. Create the public registry entry with `circleci orb create tenzai/incremental-test`. Do not pass `--private`; an orb cannot later switch between public and private.
2. Create a restricted `tenzai-orb-testing` context containing a test-only `TENZAI_ACCESS_KEY` and `TENZAI_APP_ID`. The key needs `app:read`; the integration test only uses dry-run mode.
3. Create a restricted `orb-publishing` context containing the `CIRCLE_TOKEN` expected by `circleci/orb-tools`.

Production orb versions are immutable. Create a `vX.Y.Z` tag only after the injected development orb passes the integration test.
