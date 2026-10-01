# Baidu AI Search Plugin for OpenClaw

[中文](README.md) | English

![ClawHub downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FTQSY114514%2Fbaidu-search-plugin%2Fmaster%2Fdownloads.json&query=latest&label=ClawHub%20downloads&color=success&style=for-the-badge)

<img src="chart.svg" alt="ClawHub downloads trend" width="720">

> The trend chart is redrawn daily by GitHub Actions scraping the ClawHub plugin page
> (see `.github/workflows/track-downloads.yml`); history lives in [`downloads.json`](downloads.json).

A Baidu AI Search provider for OpenClaw `web_search`. Calls the Baidu Qianfan
`v2/ai_search/web_search` API and returns structured results
(title, URL, snippet, publish date, site name), with support for result count,
recency/date-range filters, and site include/exclude lists.

> Existing community Baidu search plugins either target outdated APIs or get
> flagged by security scans. This plugin is small, fully auditable, and sends
> your key only to the official Baidu endpoint `https://qianfan.baidubce.com` —
> never through any third-party proxy.

## Install

```bash
openclaw plugins install clawhub:@tqsy114514/baidu-search-plugin
```

## Setup

### 1. Get a Baidu Qianfan AI Search API key

Enable the "Baidu AI Search" service in the
[Baidu Qianfan console](https://console.bce.baidu.com/qianfan/) and create an
app to get a `bce-v3/ALTAK-...` key.

### 2. Store it

```bash
openclaw config set plugins.entries.baidu.config.webSearch.apiKey "bce-v3/ALTAK-..."
openclaw config set tools.web.search.provider baidu
openclaw gateway restart
```

`BAIDU_API_KEY` (falling back to `QIANFAN_API_KEY`) is also supported.

#### Recommended: SecretRef instead of a plaintext key

```bash
openclaw secret set baidu_api_key "bce-v3/ALTAK-..."
openclaw config set plugins.entries.baidu.config.webSearch.apiKey "secretRef:baidu_api_key"
openclaw gateway restart
```

The apiKey field is marked `sensitive: true` in uiHints, so host UIs mask it.

### 3. Use it

```bash
openclaw run "search for xxx"
```

Or call the `web_search` tool in any session; the provider shows up as `baidu`.

## Search parameters

Besides `query`, `web_search` accepts these optional parameters (exposed via the tool schema):

| Parameter | Description | Default |
|---|---|---|
| `query` | Keywords; trimmed, empty strings rejected (`empty_query`), truncated past 500 chars; Baidu only searches the first 72 chars (non-ASCII counts as 2), so longer queries turn on Baidu query rewrite (`query_policy.enable_rewrite`) | required |
| `count` | Result count, clamped to 1–10 (floats floored, non-numeric falls back) | 5 |
| `freshness` | Recency shortcut: `pd`/`pw`/`pm`/`py` (day/week/month/year) or `day`/`week`/`month`/`year`; mutually exclusive with date params | none |
| `date_after` | Only results published on or after this date, `YYYY-MM-DD` | none |
| `date_before` | Only results published on or before this date, `YYYY-MM-DD` | none |
| `site` | Restrict to sites (e.g. `site:baidu.com` style), string or array; normalized to bare lowercase hosts (strips `site:`, scheme and path) + deduped; at most 20 (Baidu limit) | none |
| `exclude_sites` | Block these sites, string or array; normalized like `site` | none |

## Result handling

- **Dedup**: results are deduped by normalized URL (case, fragment, trailing slash ignored), first wins
- **Snippet cap**: descriptions longer than 500 chars are truncated with `…`
- **Control-char cleanup**: strips Baidu's embedded `\u0004`/`\u0005` highlight markers from titles and snippets
- **Extra fields**: `siteName` prefers Baidu's `website`; when Baidu provides them, results also carry `rerankScore` (relevance), `authorityScore` (authority, both 0–1) and the Baijiahao `author`
- **Date normalization**: `YYYY-M-D`/`YYYY/M/D` zero-padded, `YYYY年M月D日`, timestamps and parseable dates unified to `YYYY-MM-DD` (instants use the Beijing calendar day, independent of host timezone); unparseable values kept as-is

## Fault tolerance

- Transient failures (429/502/503/504, timeouts, network errors) are retried up to 2 times (300ms/800ms backoff; honors `Retry-After` on 429, capped at 10s so a long sleep can't blow past the host tool-call timeout); 401/403-style errors throw immediately; exhausted free quota / unpaid balance (also sent as 429 by Baidu) is not retried
- A cancelled tool call aborts the request and any retry wait
- **Quota saving**: concurrent identical searches share one request; it is aborted only when every caller has cancelled
- A Baidu `code != 0` response (numeric, or symbolic like `QUOTA_USER_DAILY_FREE`) returns a structured `baidu_search_error` (with `code` and `requestId` so callers can branch on it) instead of throwing into the tool loop
- **Actionable hints**: invalid key, exhausted free quota, unpaid balance and QPS limits come with a fix-it hint (the `hint` field on structured errors, or appended to thrown error messages)

## Caching and timeouts

Both come from the host's shared `web_search` config:

| Setting | Description | Default |
|---|---|---|
| `tools.web.search.cacheTtlMinutes` | Result cache lifetime in minutes; Baidu's free tier is 1500 calls/month (~50/day), so a longer TTL saves quota; `0` disables caching | 15 |
| `tools.web.search.timeoutSeconds` | Per-request timeout in seconds; each retry gets its own timeout | 30 |

```bash
openclaw config set tools.web.search.cacheTtlMinutes 60
```

## How it works

- Endpoint: `POST https://qianfan.baidubce.com/v2/ai_search/web_search`
- Body: `{"messages":[{"role":"user","content":"<query>"}], "search_source":"baidu_search_v2", "resource_type_filter":[{"type":"web","top_k":<count>}]}` (+ optional filters)
- Auth: `Authorization: Bearer <bce-v3/ALTAK-...>` with `X-Appbuilder-From: openclaw`
- `freshness` maps to top-level `search_recency_filter` (`day`/`week`/`month`/`year`;
  `page_time` is ignored by Baidu, so it is not used), `date_after`/`date_before`
  map to `search_filter.range.page_time {gte, lte}` (both inclusive; Baidu requires both bounds, so a missing one is filled with `2000-01-01` / `2099-12-31`; live-tested: Baidu rejects mixing absolute dates with `now/d` and ignores a `1970-01-01` lower bound),
  `site` to `search_filter.match.site`, `exclude_sites` to `block_websites`
- `references[]` map to standard `web_search` results with result caching
  (cache key covers query/count/recency/sites and every other dimension)

## Security

- Reuses the OpenClaw SDK's `withTrustedWebSearchEndpoint` (SSRF protection),
  search-result caching, and external-content wrapping (untrusted marking)
- The plugin ships no credentials; the key comes from config (SecretRef supported) or env vars

## Development

```bash
npm test            # unit tests + index.js behavior tests (SDK stand-in in test/fixtures; no openclaw install needed)
npm run typecheck   # JSDoc type check of lib/ (TypeScript checkJs)
BAIDU_API_KEY=bce-v3/ALTAK-... node .github/live-smoke.mjs   # live API smoke test, 4 calls
```

- CI: the `test` workflow runs tests on Node 22/24/26 plus the type check
- Live smoke: the `live-smoke` workflow runs daily at 01:00 UTC and on lib/index.js changes; it needs a `BAIDU_API_KEY` repository secret and skips without one
- Releasing: bump `package.json` version and push, then run **Package publish** from the Actions tab; it authenticates with ClawHub trusted publishing (GitHub OIDC), so no token is stored. Pull requests get a dry run

## License

MIT
