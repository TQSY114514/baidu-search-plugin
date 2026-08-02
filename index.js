// Baidu Qianfan AI Search provider for OpenClaw web_search.
// Calls POST https://qianfan.baidubce.com/v2/ai_search with Bearer auth
// (bce-v3/ALTAK-... key) and maps the structured references response into
// standard web-search results. Modeled on the official Brave plugin.
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
  buildSearchCacheKey,
  readCachedSearchPayload,
  readConfiguredSecretString,
  readProviderEnvValue,
  readStringParam,
  resolveSearchCacheTtlMs,
  resolveSearchTimeoutSeconds,
  withTrustedWebSearchEndpoint,
  wrapWebContent,
  writeCachedSearchPayload,
} from "openclaw/plugin-sdk/provider-web-search";

const BAIDU_CREDENTIAL_PATH = "plugins.entries.baidu.config.webSearch.apiKey";
const BAIDU_SEARCH_ENDPOINT = "https://qianfan.baidubce.com/v2/ai_search";

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

function resolveSiteName(url) {
  if (!url) return;
  try {
    return new URL(url).hostname;
  } catch {
    return;
  }
}

function buildBaiduWebSearchProviderBase() {
  return {
    id: "baidu",
    label: "Baidu AI Search",
    hint: "百度AI搜索 · 结构化结果（标题/链接/摘要）",
    onboardingScopes: ["text-inference"],
    credentialLabel: "Baidu Qianfan AI Search API key",
    envVars: ["BAIDU_API_KEY"],
    placeholder: "bce-v3/ALTAK-...",
    signupUrl: "https://console.bce.baidu.com/qianfan/",
    docsUrl: "https://docs.openclaw.ai/tools/web",
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
  },
  required: ["query"],
};

async function executeBaiduSearch(args, searchConfig) {
  const apiKey =
    readConfiguredSecretString(searchConfig?.apiKey, "tools.web.search.apiKey") ??
    readProviderEnvValue(["BAIDU_API_KEY"]);
  if (!apiKey) {
    return {
      error: "missing_baidu_api_key",
      message:
        "web_search (baidu) needs a Baidu Qianfan AI Search API key. Run `openclaw configure --section web` to store it, or set BAIDU_API_KEY in the Gateway environment.",
      docs: "https://docs.openclaw.ai/tools/web",
    };
  }

  const query = readStringParam(args, "query", { required: true });
  const cacheKey = buildSearchCacheKey(["baidu", query]);
  const cached = readCachedSearchPayload(cacheKey);
  if (cached) return cached;

  const start = Date.now();
  const body = JSON.stringify({
    messages: [{ role: "user", content: query }],
  });

  const data = await withTrustedWebSearchEndpoint(
    {
      url: BAIDU_SEARCH_ENDPOINT,
      timeoutSeconds: resolveSearchTimeoutSeconds(searchConfig),
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body,
      },
    },
    async (response) => {
      await assertOkOrThrowProviderError(response, "Baidu AI Search error");
      return readProviderJsonResponse(response, "Baidu AI Search error");
    },
  );

  const results = (Array.isArray(data?.references) ? data.references : []).map(
    (entry) => {
      const snippet = entry.snippet || entry.content || "";
      return {
        title: entry.title ? wrapWebContent(entry.title, "web_search") : "",
        url: entry.url ?? "",
        description: snippet
          ? wrapWebContent(snippet, "web_search")
          : "",
        published: entry.date || void 0,
        siteName: resolveSiteName(entry.url) || void 0,
      };
    },
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
      "使用百度AI搜索进行中文网络搜索，返回结构化结果（标题、链接、摘要、发布时间）。",
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
