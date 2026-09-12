// Pure helpers for the Baidu Qianfan AI Search provider.
// Kept free of openclaw SDK imports so they can be unit-tested directly.

export function resolveSiteName(url) {
  if (!url) return;
  try {
    return new URL(url).hostname;
  } catch {
    return;
  }
}

// Builds the POST body for /v2/ai_search/web_search.
// timeFilters is the shape returned by parseWebSearchTimeFilters:
//   { freshness?, dateAfter?, dateBefore? }
// freshness maps to Baidu's documented top-level search_recency_filter
// (day | week | month | year).
export function buildBaiduRequestBody({ query, count, timeFilters, sites, excludedSites }) {
  const body = {
    messages: [{ role: "user", content: query }],
    search_source: "baidu_search_v2",
    resource_type_filter: [{ type: "web", top_k: count }],
  };
  if (Array.isArray(sites) && sites.length > 0) {
    body.search_filter = body.search_filter ?? {};
    body.search_filter.match = { site: sites };
  }
  if (Array.isArray(excludedSites) && excludedSites.length > 0) {
    body.block_websites = excludedSites;
  }
  if (timeFilters?.freshness) {
    body.search_recency_filter = timeFilters.freshness;
  } else if (timeFilters?.dateAfter || timeFilters?.dateBefore) {
    // Explicit date ranges are not covered by Baidu's published schema; kept as
    // a best-effort page_time range pending live verification.
    body.search_filter = body.search_filter ?? {};
    body.search_filter.range = {
      page_time: { gte: timeFilters.dateAfter, lt: timeFilters.dateBefore },
    };
  }
  return body;
}

// Maps a Baidu `references[]` entry into a standard web-search result.
// `wrap` defaults to identity so the pure mapping stays SDK-free; the plugin
// injects the SDK's wrapWebContent to mark external content.
export function mapBaiduReferences(references, wrap = (value) => value) {
  if (!Array.isArray(references)) return [];
  return references.map((entry) => {
    const snippet = entry.snippet || entry.content || "";
    return {
      title: entry.title ? wrap(entry.title) : "",
      url: entry.url ?? "",
      description: snippet ? wrap(snippet) : "",
      published: entry.date || void 0,
      siteName: resolveSiteName(entry.url) || void 0,
    };
  });
}