# Tenzai Incremental Test — CircleCI Orb

Trigger a fire-and-forget [Tenzai](https://app.tenzai.io) commit-diff test after a successful CircleCI deployment.

The orb runs the official Tenzai CLI installer, which downloads the latest release and verifies its SHA-256 checksum, then submits a test from CircleCI's previous pipeline revision to the current revision. It exits as soon as Tenzai accepts the request.

## Quick start

In CircleCI, enable **Allow uncertified public orbs** under **Organization Settings → Security**. Public community orbs require this organization-wide setting until they receive a CircleCI partner or certified designation.

Create a restricted CircleCI context named `tenzai` containing:

| Variable                       | Purpose                                                                     |
| ------------------------------ | --------------------------------------------------------------------------- |
| `TENZAI_SERVICE_ACCOUNT_TOKEN` | Tenzai service-account token with `app:read` and `scan:trigger` permissions |

Then add the orb job after deployment:

```yaml
version: 2.1

orbs:
  tenzai: tenzai/incremental-test@2.0.0

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
      - tenzai/incremental_test:
          context: tenzai
          app_id: "98595651-fdd4-475f-a67c-3209d9b3ce3b"
          repository: << pipeline.git.repo_owner >>/<< pipeline.git.repo_name >>
          from_commit: << pipeline.git.base_revision >>
          to_commit: << pipeline.git.revision >>
          requires:
            - deploy
```

Create the Tenzai application first, including its deployed target, connected code source, and any credentials the test needs. The orb does not create or configure applications.

## Commit range behavior

`pipeline.git.base_revision` is CircleCI's previous pipeline revision on the branch. It is not limited to successful deployments. The orb skips successfully when CircleCI supplies no base revision or substitutes `<nil>`, such as on the first pipeline for a branch.

Automatic base revisions are available for GitHub OAuth and Bitbucket Cloud projects. CircleCI does not provide `pipeline.git.base_revision` to GitHub App projects; those projects must pass another commit value explicitly or the job will skip.

The repository and current commit come from pipeline values supported by CircleCI's GitHub and Bitbucket integrations:

```yaml
repository: << pipeline.git.repo_owner >>/<< pipeline.git.repo_name >>
to_commit: << pipeline.git.revision >>
```

## Job parameters

| Parameter     | Default                 | Description                                      |
| ------------- | ----------------------- | ------------------------------------------------ |
| `app_id`      | required                | Existing Tenzai application ID                   |
| `repository`  | required                | Repository in `owner/repo` form                  |
| `from_commit` | required                | Base commit; empty or `<nil>` skips the test     |
| `to_commit`   | required                | Target commit                                    |
| `server`      | `https://app.tenzai.io` | Tenzai SaaS URL or environment alias             |
| `image_tag`   | `current`               | Tag from the `cimg/base` Linux executor image    |

The standalone job does not check out the repository.

## Reusable commands

### `install`

Runs the official [`TenzaiLabs/tenzai-cli` installer](https://github.com/TenzaiLabs/tenzai-cli/blob/main/install.sh). The installer selects the latest release for the executor platform, verifies its adjacent `.sha256` file, and installs `tenzai` under `$HOME/.local/bin`. The orb persists that directory through `$BASH_ENV` for later steps.

```yaml
steps:
  - tenzai/install
```

### `trigger`

Requires `tenzai` on `PATH`, making it suitable for an existing job that installs the CLI itself:

```yaml
steps:
  - tenzai/trigger:
      app_id: "98595651-fdd4-475f-a67c-3209d9b3ce3b"
      repository: << pipeline.git.repo_owner >>/<< pipeline.git.repo_name >>
      from_commit: << pipeline.git.base_revision >>
      to_commit: << pipeline.git.revision >>
```

The command executes:

```bash
tenzai test run \
  --app-id "$APP_ID" \
  --profile commit-diff \
  --repository "$REPOSITORY" \
  --commit-from "$FROM_COMMIT" \
  --commit-to "$TO_COMMIT"
```

## Development

```bash
shellcheck src/scripts/*.sh test/*.sh
bash test/scripts_test.sh
circleci orb pack src > orb.yml
circleci orb validate orb.yml
circleci config validate .circleci/config.yml
```

The integration workflow installs the CLI through the packed development orb and runs `tenzai --version` plus `tenzai test run --help`. It does not require Tenzai credentials or submit a test.

## Publishing

Before the first release:

1. Register the `TenzaiLabs` organization on CircleCI's Free plan.
2. Enable uncertified public orbs under **Organization Settings → Security**.
3. Claim the `tenzai` namespace.
4. Create the public `tenzai/incremental-test` orb. Registry orbs cannot be deleted or change visibility.
5. Create a restricted `orb-publishing` context containing `CIRCLE_TOKEN` for a CircleCI organization owner.

Tags matching `vX.Y.Z` publish immutable production versions through the Orb Development Kit pipeline. Publish only after the development-orb installation test passes.
