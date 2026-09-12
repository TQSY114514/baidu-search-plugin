// Pure helpers for the Baidu Qianfan AI Search provider.
// Kept free of openclaw SDK imports so they can be unit-tested directly.

export const FRESHNESS_DAYS = {
  pd: 1, // past day
  pw: 6, // past week
  pm: 30, // past month
  py: 364, // past year
};

export function resolveSiteName(url) {
  if (!url) return;
  try {
    return new URL(url).hostname;
  } catch {
    return;
  }
}

export function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Maps a normalized freshness shortcut (pd/pw/pm/py) to a Baidu page_time range
// like the official search.py reference: gte = today-minus-N days, lt = tomorrow.
export function freshnessToPageTimeRange(freshness) {
  const days = FRESHNESS_DAYS[freshness];
  if (!days) return;
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  const end = new Date(now);
  end.setDate(end.getDate() + 1);
  return { gte: toIsoDate(start), lt: toIsoDate(end) };
}

// Builds the POST body for /v2/ai_search/web_search.
// timeFilters is the shape returned by parseWebSearchTimeFilters:
//   { freshness?, dateAfter?, dateBefore? }
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
  const pageTime = timeFilters?.freshness
    ? freshnessToPageTimeRange(timeFilters.freshness)
    : timeFilters?.dateAfter || timeFilters?.dateBefore
      ? { gte: timeFilters.dateAfter, lt: timeFilters.dateBefore }
      : void 0;
  if (pageTime) {
    body.search_filter = body.search_filter ?? {};
    body.search_filter.range = { page_time: pageTime };
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