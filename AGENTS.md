<!-- Update this file when changing orb contracts, CLI installation, tests, or release behavior. -->

# Tenzai Incremental Test CircleCI Orb

Public CircleCI registry orb (`tenzai/incremental-test`) that installs the Tenzai CLI and triggers a fire-and-forget commit-diff test after deployment.

## Structure

| Path                            | Purpose                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| `src/@orb.yml`                  | Registry metadata                                           |
| `src/commands/install.yml`      | Checksum-verified Tenzai CLI installer                      |
| `src/commands/trigger.yml`      | Reusable command for an already-installed CLI               |
| `src/jobs/commit_diff_test.yml` | Turnkey install-and-trigger job                              |
| `src/executors/default.yml`     | Default `cimg/base` Linux executor                           |
| `src/scripts/install.sh`        | Release selection, verification, extraction, and PATH setup |
| `src/scripts/trigger.sh`        | First-run skip and `tenzai test run` invocation              |
| `test/scripts_test.sh`          | Shell tests with mocked release downloads and CLI calls      |
| `.circleci/`                    | Orb Development Kit validation and release pipeline          |

## Development

```bash
shellcheck src/scripts/*.sh test/*.sh
bash test/scripts_test.sh
circleci orb pack src > orb.yml
circleci orb validate orb.yml
circleci config validate .circleci/config.yml
```

The orb delegates release selection, platform detection, and checksum verification to `TenzaiLabs/tenzai-cli/main/install.sh`. Keep the wrapper limited to choosing the install directory and persisting it through `$BASH_ENV`.

## Orb contract

- Primary job: `commit_diff_test`; reusable commands: `install` and `trigger`.
- The job uses `cimg/base`, installs the latest CLI release through the official installer, and does not check out source.
- The `trigger` command requires `tenzai` on `PATH`; it never installs implicitly.
- Authentication uses the CLI-native `TENZAI_SERVICE_ACCOUNT_TOKEN` environment variable.
- `app-id`, `repository`, `from-commit`, and `to-commit` are explicit orb parameters.
- Empty and `<nil>` base commits skip successfully.
- The intended caller values are `pipeline.git.repo_owner`, `pipeline.git.repo_name`, `pipeline.git.base_revision`, and `pipeline.git.revision`.
- `pipeline.git.base_revision` represents the previous pipeline, not necessarily a successful deployment, and is unavailable to GitHub App projects.
- Triggering delegates entirely to `tenzai test run --profile commit-diff` and never polls.
- The CLI defaults to production and accepts another SaaS origin or environment alias through `server` / `TENZAI_SERVER`.
- The service-account token needs `app:read` and `scan:trigger` permissions.

Do not log credentials or include real customer identifiers in source, examples, or fixtures.

## Releases

The installer intentionally follows the latest public CLI release. Test the real installer in `cimg/base` before each orb release.

The Orb Development Kit pipeline packs, lints, reviews, and tests the orb. The integration test installs the CLI through the development orb and invokes only `--version` and `test run --help`. Tags matching `vX.Y.Z` publish immutable production versions to `tenzai/incremental-test` through the restricted `orb-publishing` context.
