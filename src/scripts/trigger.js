"use strict";

const TENZAI_API_URL = "https://api.tenzai.io";
const CIRCLECI_API_URL = "https://circleci.com/api/v2";
const REQUEST_TIMEOUT_MS = 30_000;

/** @typedef {Record<string, string | undefined>} Environment */
/**
 * @typedef Workflow
 * @property {string} id
 * @property {string} name
 * @property {string} project_slug
 * @property {string} pipeline_id
 * @property {string} created_at
 */
/**
 * @typedef Pipeline
 * @property {{ revision: string, target_repository_url: string }} vcs
 */
/**
 * @typedef HistoryItem
 * @property {string} [id]
 * @property {string} [status]
 * @property {string | null} [created_at]
 * @property {string | null} [stopped_at]
 */
/**
 * @typedef HistoryPage
 * @property {(HistoryItem | null)[]} items
 * @property {string | null} [next_page_token]
 */
/**
 * @typedef Config
 * @property {string} accessKey
 * @property {string} apiUrl
 * @property {string} appId
 * @property {boolean} dryRun
 * @property {string} fromCommit
 * @property {string} historyBranch
 * @property {string} repository
 * @property {string} toCommit
 */
/**
 * @typedef CommitRange
 * @property {string} fromCommit
 * @property {string} repositoryUrl
 * @property {string} toCommit
 */

/** @param {string | undefined} value */
function clean(value) {
  return value?.trim() ?? "";
}

/** @param {string} name */
function environment(name) {
  return clean(process.env[name]);
}

/**
 * @param {string} selector
 * @param {string} fallback
 * @param {string} label
 */
function selectedEnvironment(selector, fallback, label) {
  const name = environment(selector) || fallback;
  const value = environment(name);
  if (!value) throw new Error(`${label} is required in ${name}.`);
  return value;
}

/** @param {string | undefined} value */
function enabled(value) {
  const normalized = clean(value).toLowerCase();
  return normalized === "true" || normalized === "orb-boolean-true";
}

/** @param {string} apiUrl */
function applicationUrl(apiUrl) {
  const url = new URL(apiUrl);
  if (!url.hostname.startsWith("api.")) return "";
  url.hostname = `app.${url.hostname.slice(4)}`;
  return url.toString().replace(/\/+$/, "");
}

/**
 * @param {unknown} body
 * @param {string} fallback
 */
function errorDetail(body, fallback) {
  let detail = fallback;
  if (body && typeof body === "object") {
    if ("detail" in body && typeof body.detail === "string") {
      detail = body.detail;
    } else if ("message" in body && typeof body.message === "string") {
      detail = body.message;
    }
  }
  const compact = detail.replace(/\s+/g, " ").trim();
  return compact ? `: ${compact.slice(0, 500)}` : "";
}

/**
 * @param {string} url
 * @param {RequestInit} options
 * @param {string} label
 */
async function requestJson(url, options, label) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (response.ok) throw new Error(`${label} returned invalid JSON.`);
    }
  }
  if (!response.ok) {
    throw new Error(
      `${label} (HTTP ${response.status})${errorDetail(body, text)}`,
    );
  }
  return body;
}

/** @param {string} token */
function circleciHeaders(token) {
  return { Accept: "application/json", "Circle-Token": token };
}

/** @param {string} accessKey */
function tenzaiHeaders(accessKey) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${accessKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * @param {string} path
 * @param {string} token
 */
async function circleciGet(path, token) {
  return requestJson(
    `${CIRCLECI_API_URL}${path}`,
    { headers: circleciHeaders(token) },
    "CircleCI request failed",
  );
}

/**
 * @param {string} id
 * @param {string} token
 * @returns {Promise<Workflow>}
 */
async function getWorkflow(id, token) {
  return /** @type {Workflow} */ (
    await circleciGet(`/workflow/${encodeURIComponent(id)}`, token)
  );
}

/**
 * @param {string} id
 * @param {string} token
 * @returns {Promise<Pipeline>}
 */
async function getPipeline(id, token) {
  return /** @type {Pipeline} */ (
    await circleciGet(`/pipeline/${encodeURIComponent(id)}`, token)
  );
}

/** @param {string} value */
function repositorySlug(value) {
  let path = clean(value);
  if (!path) throw new Error("Repository is unavailable.");

  const scpPath = path.match(/^[^@\s]+@[^:\s]+:(.+)$/)?.[1];
  if (scpPath) {
    path = scpPath;
  } else if (path.includes("://")) {
    path = new URL(path).pathname;
  }

  const parts = path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map(decodeURIComponent);
  if (parts.length !== 2 || parts.some((part) => !part || /\s/.test(part))) {
    throw new Error("Repository must use owner/repo form.");
  }
  parts[1] = parts[1].replace(/\.git$/, "");
  return `${parts[0]}/${parts[1]}`;
}

/**
 * @param {string} explicit
 * @param {string} pipelineUrl
 */
function resolveRepository(explicit, pipelineUrl) {
  if (explicit || pipelineUrl) return repositorySlug(explicit || pipelineUrl);
  const owner = environment("CIRCLE_PROJECT_USERNAME");
  const name = environment("CIRCLE_PROJECT_REPONAME");
  if (owner && name) return repositorySlug(`${owner}/${name}`);
  return repositorySlug(environment("CIRCLE_REPOSITORY_URL"));
}

/**
 * @param {(HistoryItem | null)[]} items
 * @param {Workflow} current
 */
function latestEligibleWorkflow(items, current) {
  const currentStarted = Date.parse(current.created_at);
  return items
    .filter((item) => {
      if (!item || item.id === current.id || item.status !== "success") {
        return false;
      }
      if (
        typeof item.created_at !== "string" ||
        typeof item.stopped_at !== "string"
      ) {
        return false;
      }
      return (
        Date.parse(item.created_at) < currentStarted &&
        Date.parse(item.stopped_at) < currentStarted
      );
    })
    .sort(
      (left, right) =>
        Date.parse(right?.stopped_at ?? "") -
        Date.parse(left?.stopped_at ?? ""),
    )[0];
}

/**
 * @param {Workflow} current
 * @param {string} token
 * @param {string} branch
 */
async function previousWorkflowId(current, token, branch) {
  let pageToken = "";
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const query = new URLSearchParams(
      branch ? { branch } : { "all-branches": "true" },
    );
    if (pageToken) query.set("page-token", pageToken);
    const path = `/insights/${encodeURIComponent(current.project_slug)}/workflows/${encodeURIComponent(current.name)}?${query}`;
    const page = /** @type {HistoryPage} */ (await circleciGet(path, token));
    const candidate = latestEligibleWorkflow(page.items ?? [], current);
    if (candidate?.id) return candidate.id;
    pageToken = page.next_page_token ?? "";
    if (!pageToken) return "";
  }
  throw new Error("CircleCI workflow history is too large.");
}

function loadConfig() {
  const apiUrl = (environment("TENZAI_ORB_BASE_URL") || TENZAI_API_URL).replace(
    /\/+$/,
    "",
  );
  return /** @type {Config} */ ({
    accessKey: selectedEnvironment(
      "TENZAI_ORB_ACCESS_KEY_VARIABLE",
      "TENZAI_ACCESS_KEY",
      "Tenzai access key",
    ),
    apiUrl,
    appId:
      environment("TENZAI_ORB_APP_ID") ||
      selectedEnvironment(
        "TENZAI_ORB_APP_ID_VARIABLE",
        "TENZAI_APP_ID",
        "Tenzai application ID",
      ),
    dryRun: enabled(process.env.TENZAI_ORB_DRY_RUN),
    fromCommit: environment("TENZAI_ORB_FROM_COMMIT"),
    historyBranch: environment("TENZAI_ORB_HISTORY_BRANCH"),
    repository: environment("TENZAI_ORB_REPOSITORY"),
    toCommit: environment("TENZAI_ORB_TO_COMMIT"),
  });
}

/** @param {Config} config */
async function validateApplication(config) {
  await requestJson(
    `${config.apiUrl}/v1/applications/${encodeURIComponent(config.appId)}`,
    { headers: tenzaiHeaders(config.accessKey) },
    "Tenzai application lookup failed",
  );
}

/**
 * @param {Config} config
 * @returns {Promise<CommitRange | null>}
 */
async function discoverCommitRange(config) {
  const workflowId = environment("CIRCLE_WORKFLOW_ID");
  if (!workflowId) throw new Error("CIRCLE_WORKFLOW_ID is required.");
  const token = selectedEnvironment(
    "TENZAI_ORB_CIRCLECI_TOKEN_VARIABLE",
    "CIRCLECI_TOKEN",
    "CircleCI API token",
  );
  const current = await getWorkflow(workflowId, token);
  const previousId = await previousWorkflowId(
    current,
    token,
    config.historyBranch,
  );
  if (!previousId) return null;

  const [previous, currentPipeline] = await Promise.all([
    getWorkflow(previousId, token),
    getPipeline(current.pipeline_id, token),
  ]);
  const previousPipeline = await getPipeline(previous.pipeline_id, token);
  return {
    fromCommit: previousPipeline.vcs.revision,
    repositoryUrl: currentPipeline.vcs.target_repository_url,
    toCommit: config.toCommit || currentPipeline.vcs.revision,
  };
}

/**
 * @param {Config} config
 * @param {string} repository
 * @param {string} fromCommit
 * @param {string} toCommit
 */
async function triggerTest(config, repository, fromCommit, toCommit) {
  const body = /** @type {{ id: string }} */ (
    await requestJson(
      `${config.apiUrl}/v1/applications/${encodeURIComponent(config.appId)}/tests`,
      {
        method: "POST",
        headers: tenzaiHeaders(config.accessKey),
        body: JSON.stringify({
          trigger: "MANUAL",
          profileConfig: {
            profile: "COMMIT_DIFF",
            repository,
            fromCommit,
            toCommit,
          },
        }),
      },
      "Tenzai test request failed",
    )
  );
  return body.id;
}

/**
 * @param {Config} config
 * @returns {Promise<CommitRange | null>}
 */
async function resolveCommitRange(config) {
  if (!config.fromCommit) return discoverCommitRange(config);
  return {
    fromCommit: config.fromCommit,
    repositoryUrl: "",
    toCommit: config.toCommit || environment("CIRCLE_SHA1"),
  };
}

/**
 * @param {Config} config
 * @param {string} testId
 */
function logTriggeredTest(config, testId) {
  const appUrl = applicationUrl(config.apiUrl);
  if (!appUrl) {
    console.info(`Triggered incremental test ${testId}.`);
    return;
  }
  const testUrl = `${appUrl}/apps/${encodeURIComponent(config.appId)}/tests/${encodeURIComponent(testId)}`;
  console.info(`Triggered incremental test ${testId}: ${testUrl}`);
}

async function run() {
  const config = loadConfig();
  if (config.dryRun) {
    await validateApplication(config);
    console.info("dry-run: authentication and application access validated.");
    return { status: "dry-run" };
  }

  const range = await resolveCommitRange(config);
  if (!range) {
    console.info("No previous successful run found; no test triggered.");
    return { status: "skipped" };
  }
  if (!range.toCommit) throw new Error("Target commit is unavailable.");
  const repository = resolveRepository(config.repository, range.repositoryUrl);
  const testId = await triggerTest(
    config,
    repository,
    range.fromCommit,
    range.toCommit,
  );
  logTriggeredTest(config, testId);
  return { status: "triggered", testId };
}

/**
 * @param {string} message
 * @param {string[]} secrets
 */
function redact(message, secrets) {
  return secrets.reduce(
    (result, secret) => (secret ? result.replaceAll(secret, "***") : result),
    message,
  );
}

async function main() {
  try {
    await run();
    return 0;
  } catch (error) {
    const accessKeyName =
      environment("TENZAI_ORB_ACCESS_KEY_VARIABLE") || "TENZAI_ACCESS_KEY";
    const circleciTokenName =
      environment("TENZAI_ORB_CIRCLECI_TOKEN_VARIABLE") || "CIRCLECI_TOKEN";
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      redact(message, [
        environment(accessKeyName),
        environment(circleciTokenName),
      ]),
    );
    return enabled(process.env.TENZAI_ORB_IGNORE_ERRORS) ? 0 : 1;
  }
}

if (require.main === module) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = { main, repositorySlug, run };
