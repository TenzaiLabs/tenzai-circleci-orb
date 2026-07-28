import assert from "node:assert/strict";
import { describe, test } from "node:test";

import runtime from "../src/scripts/trigger.js";

const { main, repositorySlug, run } = runtime;
const TENZAI_API = "https://api.tenzai.io";
const CIRCLECI_API = "https://circleci.com/api/v2";

/** @typedef {Record<string, string | undefined>} TestEnvironment */
/** @typedef {{ options: RequestInit, url: string }} FetchCall */

/** @param {unknown} body @param {number} [status] */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** @param {TestEnvironment} [overrides] */
function baseEnvironment(overrides = {}) {
  return {
    TENZAI_ACCESS_KEY: "tza_test-access-key",
    TENZAI_APP_ID: "11111111-1111-1111-1111-111111111111",
    CIRCLECI_TOKEN: "circleci-test-token",
    CIRCLE_WORKFLOW_ID: "current-workflow",
    CIRCLE_SHA1: "current-env-revision",
    CIRCLE_PROJECT_USERNAME: "example",
    CIRCLE_PROJECT_REPONAME: "web-app",
    ...overrides,
  };
}

/**
 * @param {TestEnvironment} env
 * @param {typeof fetch} fetchImpl
 * @param {() => Promise<unknown>} [operation]
 */
async function execute(env, fetchImpl, operation = run) {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const originalError = console.error;
  /** @type {string[]} */
  const info = [];
  /** @type {string[]} */
  const errors = [];
  process.env = Object.fromEntries(
    Object.entries(env).filter((entry) => entry[1] !== undefined),
  );
  globalThis.fetch = fetchImpl;
  console.info = (message) => info.push(String(message));
  console.error = (message) => errors.push(String(message));
  try {
    try {
      return { errors, info, result: await operation() };
    } catch (error) {
      return { error, errors, info };
    }
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    console.error = originalError;
  }
}

/** @param {Record<string, unknown>} [overrides] */
function currentWorkflow(overrides = {}) {
  return {
    id: "current-workflow",
    name: "deploy",
    project_slug: "gh/example/web-app",
    pipeline_id: "current-pipeline",
    created_at: "2026-07-24T10:00:00Z",
    ...overrides,
  };
}

/**
 * @param {string} id
 * @param {string | null} stoppedAt
 * @param {Record<string, unknown>} [overrides]
 */
function historyItem(id, stoppedAt, overrides = {}) {
  return {
    id,
    status: "success",
    created_at: "2026-07-24T08:00:00Z",
    stopped_at: stoppedAt,
    ...overrides,
  };
}

/** @param {string} revision @param {string} [repositoryUrl] */
function pipeline(
  revision,
  repositoryUrl = "https://github.com/example/web-app",
) {
  return { vcs: { revision, target_repository_url: repositoryUrl } };
}

describe("automatic discovery", () => {
  test("triggers the exact commit-diff request", async () => {
    /** @type {FetchCall[]} */
    const calls = [];
    const fetchImpl = async (
      /** @type {RequestInfo | URL} */ input,
      /** @type {RequestInit} */ options = {},
    ) => {
      const url = String(input);
      calls.push({ options, url });
      if (url.endsWith("/workflow/current-workflow")) {
        return jsonResponse(
          currentWorkflow({
            name: "deploy/prod",
            project_slug: "gh/example/web app",
          }),
        );
      }
      if (url.includes("/insights/")) {
        return jsonResponse({
          items: [historyItem("previous-workflow", "2026-07-24T09:30:00Z")],
          next_page_token: null,
        });
      }
      if (url.endsWith("/workflow/previous-workflow")) {
        return jsonResponse({ pipeline_id: "previous-pipeline" });
      }
      if (url.endsWith("/pipeline/previous-pipeline")) {
        return jsonResponse(pipeline("previous-revision"));
      }
      if (url.endsWith("/pipeline/current-pipeline")) {
        return jsonResponse(
          pipeline(
            "current-revision",
            "https://github.com/canonical/repository.git",
          ),
        );
      }
      if (url.endsWith("/tests")) return jsonResponse({ id: "test-id" }, 201);
      throw new Error(`Unexpected request: ${url}`);
    };

    const output = await execute(
      baseEnvironment({ TENZAI_ORB_HISTORY_BRANCH: "release / prod" }),
      fetchImpl,
    );

    assert.deepEqual(output.result, {
      status: "triggered",
      testId: "test-id",
    });
    assert.equal(
      calls[1].url,
      `${CIRCLECI_API}/insights/gh%2Fexample%2Fweb%20app/workflows/deploy%2Fprod?branch=release+%2F+prod`,
    );
    assert.equal(
      new Headers(calls[0].options.headers).get("Circle-Token"),
      "circleci-test-token",
    );
    assert.deepEqual(JSON.parse(String(calls.at(-1)?.options.body)), {
      trigger: "MANUAL",
      profileConfig: {
        profile: "COMMIT_DIFF",
        repository: "canonical/repository",
        fromCommit: "previous-revision",
        toCommit: "current-revision",
      },
    });
  });

  test("skips incomplete and concurrent rows, then stops on the first eligible page", async () => {
    let historyCalls = 0;
    const fetchImpl = async (/** @type {RequestInfo | URL} */ input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/workflow/current-workflow")) {
        return jsonResponse(currentWorkflow());
      }
      if (url.pathname.includes("/insights/")) {
        historyCalls += 1;
        if (historyCalls === 1) {
          return jsonResponse({
            items: [
              historyItem("running", null),
              historyItem("concurrent", "2026-07-24T10:05:00Z"),
            ],
            next_page_token: "second",
          });
        }
        if (historyCalls === 2) {
          return jsonResponse({
            items: [
              historyItem("older", "2026-07-24T08:30:00Z"),
              historyItem("selected", "2026-07-24T09:45:00Z"),
            ],
            next_page_token: "unused",
          });
        }
      }
      if (url.pathname.endsWith("/workflow/selected")) {
        return jsonResponse({ pipeline_id: "previous-pipeline" });
      }
      if (url.pathname.endsWith("/pipeline/previous-pipeline")) {
        return jsonResponse(pipeline("previous-revision"));
      }
      if (url.pathname.endsWith("/pipeline/current-pipeline")) {
        return jsonResponse(pipeline("current-revision"));
      }
      if (url.hostname === "api.tenzai.io") {
        return jsonResponse({ id: "test-id" }, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const output = await execute(baseEnvironment(), fetchImpl);

    assert.equal(output.error, undefined);
    assert.equal(historyCalls, 2);
  });

  test("treats empty history as the first deployment", async () => {
    const fetchImpl = async (/** @type {RequestInfo | URL} */ input) => {
      const url = String(input);
      if (url.endsWith("/workflow/current-workflow")) {
        return jsonResponse(currentWorkflow());
      }
      return jsonResponse({ items: [], next_page_token: null });
    };

    const output = await execute(baseEnvironment(), fetchImpl);

    assert.deepEqual(output.result, { status: "skipped" });
    assert.match(output.info[0], /No previous successful run/);
  });
});

describe("explicit and dry-run modes", () => {
  test("explicit mode needs no CircleCI token", async () => {
    /** @type {FetchCall[]} */
    const calls = [];
    const output = await execute(
      baseEnvironment({
        CIRCLECI_TOKEN: undefined,
        CIRCLE_PROJECT_REPONAME: undefined,
        CIRCLE_PROJECT_USERNAME: undefined,
        CIRCLE_WORKFLOW_ID: undefined,
        CIRCLE_REPOSITORY_URL: "git@github.com:explicit/project.git",
        TENZAI_ORB_FROM_COMMIT: "from",
        TENZAI_ORB_TO_COMMIT: "to",
      }),
      async (input, options = {}) => {
        calls.push({ options, url: String(input) });
        return jsonResponse({ id: "test-id" }, 201);
      },
    );

    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(String(calls[0].options.body)).profileConfig, {
      profile: "COMMIT_DIFF",
      repository: "explicit/project",
      fromCommit: "from",
      toCommit: "to",
    });
    assert.equal(output.error, undefined);
  });

  test("orb-prefixed dry-run validates only the application", async () => {
    /** @type {FetchCall[]} */
    const calls = [];
    const output = await execute(
      baseEnvironment({
        CIRCLECI_TOKEN: undefined,
        CIRCLE_WORKFLOW_ID: undefined,
        TENZAI_ORB_DRY_RUN: "orb-boolean-true",
      }),
      async (input, options = {}) => {
        calls.push({ options, url: String(input) });
        return jsonResponse({ id: "application-id" });
      },
    );

    assert.deepEqual(output.result, { status: "dry-run" });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      `${TENZAI_API}/v1/applications/11111111-1111-1111-1111-111111111111`,
    );
  });

  test("normalizes base-url and prefers direct app-id", async () => {
    /** @type {FetchCall[]} */
    const calls = [];
    const output = await execute(
      baseEnvironment({
        TENZAI_ORB_APP_ID: "parameter-app",
        TENZAI_ORB_BASE_URL: "https://api.staging.tenzai.io/",
        TENZAI_ORB_DRY_RUN: "orb-boolean-false",
        TENZAI_ORB_FROM_COMMIT: "from",
        TENZAI_ORB_REPOSITORY: "owner/repo",
      }),
      async (input, options = {}) => {
        calls.push({ options, url: String(input) });
        return jsonResponse({ id: "test-id" }, 201);
      },
    );

    assert.equal(
      calls[0].url,
      "https://api.staging.tenzai.io/v1/applications/parameter-app/tests",
    );
    assert.match(output.info[0], /app\.staging\.tenzai\.io/);
  });

  test("omits a UI link when base-url does not use an api host", async () => {
    const output = await execute(
      baseEnvironment({
        TENZAI_ORB_BASE_URL: "https://platform.example",
        TENZAI_ORB_FROM_COMMIT: "from",
        TENZAI_ORB_REPOSITORY: "owner/repo",
      }),
      async () => jsonResponse({ id: "test-id" }, 201),
    );

    assert.deepEqual(output.info, ["Triggered incremental test test-id."]);
  });

  test("supports custom credential variable names", async () => {
    const output = await execute(
      baseEnvironment({
        CUSTOM_ACCESS_KEY: "custom-key",
        CUSTOM_APP_ID: "custom-app",
        TENZAI_ACCESS_KEY: undefined,
        TENZAI_APP_ID: undefined,
        TENZAI_ORB_ACCESS_KEY_VARIABLE: "CUSTOM_ACCESS_KEY",
        TENZAI_ORB_APP_ID_VARIABLE: "CUSTOM_APP_ID",
        TENZAI_ORB_FROM_COMMIT: "from",
        TENZAI_ORB_REPOSITORY: "owner/repo",
      }),
      async (input, options = {}) => {
        assert.match(String(input), /custom-app/);
        assert.equal(
          new Headers(options.headers).get("Authorization"),
          "Bearer custom-key",
        );
        return jsonResponse({ id: "test-id" }, 201);
      },
    );

    assert.equal(output.error, undefined);
  });
});

describe("repository parsing", () => {
  for (const [input, expected] of [
    ["owner/repository", "owner/repository"],
    ["https://github.com/owner/repository.git", "owner/repository"],
    ["git@github.com:owner/repository.git", "owner/repository"],
    ["ssh://git@github.com/owner/repository.git", "owner/repository"],
  ]) {
    test(`parses ${input}`, () => {
      assert.equal(repositorySlug(input), expected);
    });
  }

  for (const input of ["", "repository", "owner/group/repository"]) {
    test(`rejects ${input || "an empty repository"}`, () => {
      assert.throws(() => repositorySlug(input), /Repository/);
    });
  }
});

describe("failures", () => {
  function explicitEnvironment(overrides = {}) {
    return baseEnvironment({
      TENZAI_ORB_FROM_COMMIT: "from",
      TENZAI_ORB_REPOSITORY: "owner/repo",
      ...overrides,
    });
  }

  test("reports API errors", async () => {
    const output = await execute(explicitEnvironment(), async () =>
      jsonResponse({ detail: "test rejected" }, 409),
    );

    assert.ok(output.error instanceof Error);
    assert.equal(
      output.error.message,
      "Tenzai test request failed (HTTP 409): test rejected",
    );
  });

  test("redacts secrets from entrypoint errors", async () => {
    const output = await execute(
      explicitEnvironment({
        CIRCLECI_TOKEN: "circle-secret",
        TENZAI_ACCESS_KEY: "access-secret",
      }),
      async () =>
        jsonResponse(
          { detail: "rejected access-secret and circle-secret" },
          500,
        ),
      main,
    );

    assert.equal(output.result, 1);
    assert.deepEqual(output.errors, [
      "Tenzai test request failed (HTTP 500): rejected *** and ***",
    ]);
  });

  test("orb-prefixed ignore-errors reports the error and succeeds", async () => {
    const output = await execute(
      explicitEnvironment({ TENZAI_ORB_IGNORE_ERRORS: "orb-boolean-true" }),
      async () => jsonResponse({ detail: "temporarily unavailable" }, 503),
      main,
    );

    assert.equal(output.result, 0);
    assert.deepEqual(output.errors, [
      "Tenzai test request failed (HTTP 503): temporarily unavailable",
    ]);
  });
});
