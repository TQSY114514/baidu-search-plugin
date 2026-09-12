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
  mapBaiduReferences,
} from "./lib/search-params.js";

const BAIDU_CREDENTIAL_PATH = "plugins.entries.baidu.config.webSearch.apiKey";
const BAIDU_SEARCH_ENDPOINT = "https://qianfan.baidubce.com/v2/ai_search/web_search";
const BAIDU_DOCS_URL = "https://docs.openclaw.ai/tools/web";

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
      description: "搜索关键词",
    },
    count: {
      type: "number",
      description: "返回结果条数（1-10，默认 5）",
    },
    freshness: {
      type: "string",
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
      type: "array",
      items: { type: "string" },
      description: "限定在此站点内搜索，如 [\"baidu.com\"]（也接受单个字符串）",
    },
    exclude_sites: {
      type: "array",
      items: { type: "string" },
      description: "屏蔽这些站点，如 [\"tieba.baidu.com\"]（也接受单个字符串）",
    },
  },
  required: ["query"],
};

export async function executeBaiduSearch(args, searchConfig) {
  const apiKey =
    readConfiguredSecretString(searchConfig?.apiKey, "tools.web.search.apiKey") ??
    readProviderEnvValue(["BAIDU_API_KEY", "QIANFAN_API_KEY"]);
  if (!apiKey) {
    return {
      error: "missing_baidu_api_key",
      message:
        "web_search (baidu) needs a Baidu Qianfan AI Search API key. Run `openclaw configure --section web` to store it, or set BAIDU_API_KEY / QIANFAN_API_KEY in the Gateway environment.",
      docs: BAIDU_DOCS_URL,
    };
  }

  const query = readStringParam(args, "query", { required: true });
  const count = resolveSearchCount(args.count, DEFAULT_SEARCH_COUNT);
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

  const sites = readStringArrayParam(args, "site") ?? [];
  const excludedSites = readStringArrayParam(args, "exclude_sites") ?? [];

  const cacheKey = buildSearchCacheKey([
    "baidu",
    query,
    String(count),
    timeFilters.freshness ?? "",
    timeFilters.dateAfter ?? "",
    timeFilters.dateBefore ?? "",
    sites.join(","),
    excludedSites.join(","),
  ]);
  const cached = readCachedSearchPayload(cacheKey);
  if (cached) return cached;

  const start = Date.now();
  const body = buildBaiduRequestBody({ query, count, timeFilters, sites, excludedSites });

  const data = await withTrustedWebSearchEndpoint(
    {
      url: BAIDU_SEARCH_ENDPOINT,
      timeoutSeconds: resolveSearchTimeoutSeconds(searchConfig),
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

  if (data && typeof data.code === "number" && data.code !== 0) {
    throw new Error(`Baidu AI Search error: ${data.message ?? `code ${data.code}`}`);
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

function createBaiduToolDefinition(searchConfig, config) {
  return {
    description:
      "使用百度AI搜索进行中文网络搜索，返回结构化结果（标题、链接、摘要、发布时间）。支持结果条数、时效/日期范围、站点限定与屏蔽。",
    parameters: BaiduSearchSchema,
    execute: async (args) => executeBaiduSearch(args, searchConfig),
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
          ctx.config,
        ),
    });
  },
});