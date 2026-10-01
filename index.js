// Baidu Qianfan AI Search provider for OpenClaw web_search.
// Calls POST https://qianfan.baidubce.com/v2/ai_search/web_search with Bearer auth
// (bce-v3/ALTAK-... key) and maps the structured references response into
// standard web-search results. Modeled on the official Brave plugin and the
// baidubce/skills search.py reference implementation.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  createWebSearchProviderContractFields,
  mergeScopedSearchConfig,
  resolveProviderWebSearchPluginConfig,
} from "openclaw/plugin-sdk/provider-web-search-config-contract";
import { isRecord } from "openclaw/plugin-sdk/string-coerce-runtime";
import {
  assertOkOrThrowProviderError,
  readProviderJsonResponse,
} from "openclaw/plugin-sdk/provider-http";
import {
  DEFAULT_SEARCH_COUNT,
  buildSearchCacheKey,
  parseWebSearchTimeFilters,
  readCachedSearchPayload,
  readConfiguredSecretString,
  readProviderEnvValue,
  readStringArrayParam,
  readStringParam,
  resolveSearchCacheTtlMs,
  resolveSearchCount,
  resolveSearchTimeoutSeconds,
  withTrustedWebSearchEndpoint,
  wrapWebContent,
  writeCachedSearchPayload,
} from "openclaw/plugin-sdk/provider-web-search";
import {
  buildBaiduRequestBody,
  isRetryableSearchError,
  mapBaiduReferences,
  normalizeSearchCount,
  normalizeSiteList,
  readRetryAfterMs,
  resolveBaiduErrorCode,
  resolveBaiduErrorHint,
  truncateByCodePoints,
} from "./lib/search-params.js";
import { createSingleFlight } from "./lib/single-flight.js";

const BAIDU_CREDENTIAL_PATH = "plugins.entries.baidu.config.webSearch.apiKey";
const BAIDU_SEARCH_ENDPOINT = "https://qianfan.baidubce.com/v2/ai_search/web_search";
const BAIDU_DOCS_URL = "https://docs.openclaw.ai/tools/web";
const MAX_QUERY_LENGTH = 500;
const RETRY_DELAYS_MS = [300, 800];
const searchFlight = createSingleFlight();

// Sleeps for the backoff delay, waking early (and throwing) on cancellation.
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveBaiduWebSearchPluginConfig(config) {
  if (!isRecord(config)) return;
  const plugins = isRecord(config.plugins) ? config.plugins : void 0;
  const entries = isRecord(plugins?.entries) ? plugins.entries : void 0;
  const entry = isRecord(entries?.baidu) ? entries.baidu : void 0;
  const pluginConfig = isRecord(entry?.config) ? entry.config : void 0;
  return isRecord(pluginConfig?.webSearch) ? pluginConfig.webSearch : void 0;
}

function resolveConfiguredBaiduCredential(config) {
  return resolveBaiduWebSearchPluginConfig(config)?.apiKey;
}

function buildBaiduWebSearchProviderBase() {
  return {
    id: "baidu",
    label: "Baidu AI Search",
    hint: "百度AI搜索 · 结构化结果（标题/链接/摘要）",
    onboardingScopes: ["text-inference"],
    credentialLabel: "Baidu Qianfan AI Search API key",
    envVars: ["BAIDU_API_KEY", "QIANFAN_API_KEY"],
    placeholder: "bce-v3/ALTAK-...",
    signupUrl: "https://console.bce.baidu.com/qianfan/",
    docsUrl: BAIDU_DOCS_URL,
    autoDetectOrder: 30,
    credentialPath: BAIDU_CREDENTIAL_PATH,
    ...createWebSearchProviderContractFields({
      credentialPath: BAIDU_CREDENTIAL_PATH,
      searchCredential: { type: "top-level" },
      configuredCredential: { pluginId: "baidu" },
    }),
    getConfiguredCredentialValue: resolveConfiguredBaiduCredential,
    getConfiguredCredentialFallback: () => void 0,
  };
}

const BaiduSearchSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "搜索关键词。请用简短关键词：百度只检索前 72 个字符（一个汉字算 2 个，约 36 个汉字）",
    },
    count: {
      type: "integer",
      minimum: 1,
      maximum: 10,
      description: "返回结果条数（1-10，默认 5）",
    },
    freshness: {
      type: "string",
      enum: ["pd", "pw", "pm", "py", "day", "week", "month", "year"],
      description:
        "时效过滤：pd（近一天）/ pw（近一周）/ pm（近一月）/ py（近一年），或 day/week/month/year，不可与 date_after/date_before 同时使用",
    },
    date_after: {
      type: "string",
      description: "起始日期（YYYY-MM-DD），与 date_before 搭配构成时间范围，不可与 freshness 同时使用",
    },
    date_before: {
      type: "string",
      description: "截止日期（YYYY-MM-DD），与 date_after 搭配构成时间范围，不可与 freshness 同时使用",
    },
    site: {
      anyOf: [{ type: "array", items: { type: "string" } }, { type: "string" }],
      description: "限定在此站点内搜索，如 [\"baidu.com\"]（也接受单个字符串）",
    },
    exclude_sites: {
      anyOf: [{ type: "array", items: { type: "string" } }, { type: "string" }],
      description: "屏蔽这些站点，如 [\"tieba.baidu.com\"]（也接受单个字符串）",
    },
  },
  required: ["query"],
};

export async function executeBaiduSearch(args, searchConfig, signal) {
  const apiKey =
    readConfiguredSecretString(searchConfig?.apiKey, BAIDU_CREDENTIAL_PATH) ??
    readProviderEnvValue(["BAIDU_API_KEY", "QIANFAN_API_KEY"]);
  if (!apiKey) {
    return {
      error: "missing_baidu_api_key",
      message:
        "web_search (baidu) needs a Baidu Qianfan AI Search API key. Run `openclaw configure --section web` to store it, or set BAIDU_API_KEY / QIANFAN_API_KEY in the Gateway environment.",
      docs: BAIDU_DOCS_URL,
    };
  }

  const rawQuery = readStringParam(args, "query", { required: true });
  const query = typeof rawQuery === "string" ? rawQuery.trim() : rawQuery;
  if (!query) {
    return {
      error: "empty_query",
      message: "web_search (baidu): query must be a non-empty string.",
      docs: BAIDU_DOCS_URL,
    };
  }
  const finalQuery = truncateByCodePoints(query, MAX_QUERY_LENGTH);
  const count = normalizeSearchCount(resolveSearchCount(args.count, DEFAULT_SEARCH_COUNT));
  const timeFilters = parseWebSearchTimeFilters({
    rawFreshness: args.freshness,
    rawDateAfter: args.date_after,
    rawDateBefore: args.date_before,
    freshnessProvider: "perplexity",
    invalidFreshnessMessage: "web_search (baidu): freshness must be one of pd/pw/pm/py or day/week/month/year",
    invalidDateAfterMessage: "web_search (baidu): date_after must be a valid YYYY-MM-DD date",
    invalidDateBeforeMessage: "web_search (baidu): date_before must be a valid YYYY-MM-DD date",
    invalidDateRangeMessage: "web_search (baidu): date_after must be earlier than or equal to date_before",
    conflictingTimeFiltersMessage: "web_search (baidu): freshness and date_after/date_before cannot be used together",
    docs: BAIDU_DOCS_URL,
  });
  if (timeFilters.error) return timeFilters;

  const sites = normalizeSiteList(readStringArrayParam(args, "site") ?? []);
  const excludedSites = normalizeSiteList(readStringArrayParam(args, "exclude_sites") ?? []);

  const cacheKey = buildSearchCacheKey([
    "baidu",
    finalQuery,
    String(count),
    timeFilters.freshness ?? "",
    timeFilters.dateAfter ?? "",
    timeFilters.dateBefore ?? "",
    sites.join(","),
    excludedSites.join(","),
  ]);
  signal?.throwIfAborted();
  const cached = readCachedSearchPayload(cacheKey);
  if (cached) return cached;

  // Concurrent identical searches share one request (and one quota unit).
  return searchFlight(
    cacheKey,
    (sharedSignal) =>
      fetchBaiduSearch({
        apiKey,
        searchConfig,
        cacheKey,
        query: finalQuery,
        body: buildBaiduRequestBody({ query: finalQuery, count, timeFilters, sites, excludedSites }),
        signal: sharedSignal,
      }),
    signal,
  );
}

async function fetchBaiduSearch({ apiKey, searchConfig, cacheKey, query, body, signal }) {
  const start = Date.now();
  let data;
  let attempt = 0;
  for (;;) {
    try {
      data = await withTrustedWebSearchEndpoint(
        {
          url: BAIDU_SEARCH_ENDPOINT,
          timeoutSeconds: resolveSearchTimeoutSeconds(searchConfig),
          signal,
          init: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Appbuilder-From": "openclaw",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
          },
        },
        async (response) => {
          await assertOkOrThrowProviderError(response, "Baidu AI Search error");
          return readProviderJsonResponse(response, "Baidu AI Search error");
        },
      );
      break;
    } catch (err) {
      // A cancelled tool call must not be retried.
      if (signal?.aborted) throw err;
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryableSearchError(err)) {
        const hint = err?.status !== undefined ? resolveBaiduErrorHint(err) : undefined;
        if (hint && typeof err.message === "string") err.message = `${err.message}（${hint}）`;
        throw err;
      }
      await sleep(readRetryAfterMs(err) ?? RETRY_DELAYS_MS[attempt], signal);
      attempt += 1;
    }
  }

  const baiduErrorCode = resolveBaiduErrorCode(data);
  if (baiduErrorCode !== undefined && baiduErrorCode !== 0) {
    const hint = resolveBaiduErrorHint({ code: baiduErrorCode, message: data.message });
    return {
      error: "baidu_search_error",
      code: baiduErrorCode,
      message: `Baidu AI Search error: ${data.message ?? `code ${baiduErrorCode}`}`,
      ...(hint ? { hint } : {}),
      requestId: data.request_id ?? data.requestId,
      docs: BAIDU_DOCS_URL,
    };
  }

  const results = mapBaiduReferences(data?.references, (value) =>
    wrapWebContent(value, "web_search"),
  );

  const payload = {
    query,
    provider: "baidu",
    count: results.length,
    tookMs: Date.now() - start,
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: "baidu",
      wrapped: true,
    },
    results,
  };
  writeCachedSearchPayload(cacheKey, payload, resolveSearchCacheTtlMs(searchConfig));
  return payload;
}

function createBaiduToolDefinition(searchConfig) {
  return {
    description:
      "使用百度AI搜索进行中文网络搜索，返回结构化结果（标题、链接、摘要、发布时间）。支持结果条数、时效/日期范围、站点限定与屏蔽。",
    parameters: BaiduSearchSchema,
    execute: async (args, executionContext) =>
      executeBaiduSearch(args, searchConfig, executionContext?.signal),
  };
}

export default definePluginEntry({
  id: "baidu",
  name: "Baidu AI Search",
  description: "Baidu Qianfan AI Search provider for OpenClaw web_search.",
  register(api) {
    api.registerWebSearchProvider({
      ...buildBaiduWebSearchProviderBase(),
      createTool: (ctx) =>
        createBaiduToolDefinition(
          mergeScopedSearchConfig(
            ctx.searchConfig,
            "baidu",
            resolveProviderWebSearchPluginConfig(ctx.config, "baidu"),
            { mirrorApiKeyToTopLevel: true },
          ),
        ),
    });
  },
});