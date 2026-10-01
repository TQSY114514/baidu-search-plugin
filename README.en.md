# Baidu AI Search Plugin for OpenClaw

[中文](README.md) | English

![ClawHub downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FTQSY114514%2Fbaidu-search-plugin%2Fmaster%2Fdownloads.json&query=latest&label=ClawHub%20downloads&color=success&style=for-the-badge)

<img src="chart.svg" alt="ClawHub downloads trend" width="720">

> The trend chart is redrawn daily by GitHub Actions scraping the ClawHub plugin page
> (see `.github/workflows/track-downloads.yml`); history lives in [`downloads.json`](downloads.json).

Brings Baidu search to OpenClaw's `web_search` tool. Calls Baidu Qianfan's
"Baidu AI Search → Baidu Search" API (`v2/ai_search/web_search`) and returns
structured results: title, URL, snippet, publish date and site name, with
result count, recency / date-range filters and site include / exclude lists.

> Existing community Baidu search plugins either target outdated APIs or get
> flagged by security scans. This plugin is small, fully auditable, and sends
> your key only to the official Baidu endpoint `https://qianfan.baidubce.com` —
> never through any third-party proxy.

## Quick start

### 1. Install the plugin

```bash
openclaw plugins install clawhub:@tqsy114514/baidu-search-plugin
```

### 2. Get a Baidu AI Search API key

1. **Sign up and verify your identity**: log in to [Baidu AI Cloud](https://cloud.baidu.com)
   and complete real-name verification (实名认证) in the account center.
   Unverified accounts cannot activate Baidu AI Search, so calls will fail.
2. **Open the API key page**: go to the Baidu AI Search console's
   [API Key page](https://console.bce.baidu.com/ai-search/qianfan/ais/console/apiKey).
   Accept the service agreement on first visit; verified accounts get Baidu AI Search activated automatically.
3. **Create an API key**: click "创建 API Key" (Create API Key). If asked to choose services /
   permissions, make sure **Qianfan platform** is included (Baidu AI Search is part of it).
4. **Copy the whole key**: it looks like `bce-v3/ALTAK-xxxxxxxx/xxxxxxxxxxxx`.
   **The entire string is the key**, including the `bce-v3/` prefix and the `/` in the middle.
   Copy it as-is without changing case (it starts with lowercase `bce-v3`). Save it right away —
   the full plaintext may not be viewable again later.

> **Credentials that look similar but do not work:**
> - The **AK / SK** pair (Access Key ID + Secret Access Key) under Baidu AI Cloud "Security → Access Key"
> - The **App ID / app secret** of a legacy Qianfan AppBuilder "application"
> - The legacy Qianfan **API Key + Secret Key** pair used to exchange for an access_token
>
> This plugin only accepts `bce-v3/ALTAK-...` API keys, sent as `Authorization: Bearer <key>`.

**Cost**: Baidu Search includes **1500 free calls per month** (granted daily, about 50/day),
used before paid quota. After that you must [enable pay-as-you-go](https://console.bce.baidu.com/qianfan/studio/resource)
to keep calling; see Baidu's [pricing page](https://cloud.baidu.com/doc/qianfan/s/1mh4sv6c4) for current prices.
Check usage on the [resource quota page](https://console.bce.baidu.com/ai_apaas/resource).

### 3. (Optional) Check the key works

```bash
export BAIDU_API_KEY='bce-v3/ALTAK-...'
curl -s https://qianfan.baidubce.com/v2/ai_search/web_search \
  -H "Authorization: Bearer $BAIDU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"百度千帆"}],"search_source":"baidu_search_v2","resource_type_filter":[{"type":"web","top_k":1}]}'
```

A response containing `"references"` means the key works. `216003` / `InvalidHTTPAuthHeader`
means the key is wrong; see [Common errors](#common-errors).

### 4. Configure OpenClaw

Pick one:

**Option A: interactive wizard (recommended)**

```bash
openclaw configure --section web
```

Choose **Baidu AI Search** and paste the key when prompted (input is masked).

**Option B: command line**

```bash
openclaw config set plugins.entries.baidu.config.webSearch.apiKey 'bce-v3/ALTAK-...'
openclaw config set tools.web.search.provider baidu
openclaw gateway restart
```

**Option C: environment variable**

Set `BAIDU_API_KEY` (or `QIANFAN_API_KEY`) in the Gateway process environment.
For a gateway install, put it in `~/.openclaw/.env`:

```bash
BAIDU_API_KEY=bce-v3/ALTAK-...
```

Then run `openclaw config set tools.web.search.provider baidu` and `openclaw gateway restart`.

#### Safer: keep the key in OpenClaw's secret store

Option B writes the key to `openclaw.json` in plaintext. Prefer storing it in OpenClaw's
shared secret store and keeping only a reference (SecretRef) in config:

```bash
# Prompts without echo, so the key stays out of shell history
openclaw secrets store set BAIDU_API_KEY --kind secret

# Config only holds the reference
openclaw config set plugins.entries.baidu.config.webSearch.apiKey \
  '{"source":"store","provider":"default","id":"BAIDU_API_KEY"}' --strict-json
openclaw config set tools.web.search.provider baidu
openclaw secrets reload
```

See the OpenClaw docs: [Secrets CLI](https://docs.openclaw.ai/cli/secrets), [SecretRef](https://docs.openclaw.ai/gateway/secrets/secretref-contract).

### 5. Use it

Ask OpenClaw to search in any session, e.g. "search Baidu for today's tech news".
The `web_search` tool's provider shows up as `baidu`.

## Search parameters

Besides `query`, `web_search` accepts these optional parameters (exposed via the tool schema):

| Parameter | Description | Default |
|---|---|---|
| `query` | Keywords. Baidu only searches the first 72 chars (non-ASCII counts as 2, about 36 Chinese characters); longer queries turn on Baidu's query rewrite. Trimmed; empty strings return `empty_query`; truncated past 500 chars | required |
| `count` | Number of results, 1–10 | 5 |
| `freshness` | Recency: `pd`/`pw`/`pm`/`py` (past day / week / month / year) or `day`/`week`/`month`/`year`; cannot be combined with the date parameters | none |
| `date_after` | Only results published on or after this date, `YYYY-MM-DD` | none |
| `date_before` | Only results published on or before this date, `YYYY-MM-DD` | none |
| `site` | Only search these sites, string or array; `site:Baidu.com` and `https://baidu.com/x` both normalize to `baidu.com`; at most 20 (Baidu limit) | none |
| `exclude_sites` | Exclude these sites, string or array; normalized like `site` | none |

## Results

Each result has `title`, `url`, `description` (snippet), `published` (`YYYY-MM-DD`) and `siteName`.
When Baidu provides them, results also carry:

- `rerankScore`: relevance score, 0–1
- `authorityScore`: page authority score, 0–1
- `author`: author of a Baijiahao article

The plugin also:

- dedupes by URL (ignoring case, `#` fragments and trailing slashes)
- truncates snippets longer than 500 chars with `…`
- strips Baidu's embedded `\u0004`/`\u0005` highlight control characters from titles and snippets
- normalizes publish dates to `YYYY-MM-DD` (`2026-9-1`, `2026/9/1`, `2026年9月1日`, timestamps, …);
  timestamps use the Beijing calendar day regardless of server timezone; unparseable values are kept as-is
- marks titles and snippets as untrusted external content (OpenClaw's untrusted wrapping)

## Caching and timeouts

Both come from OpenClaw's shared `web_search` config:

| Setting | Description | Default |
|---|---|---|
| `tools.web.search.cacheTtlMinutes` | Result cache lifetime in minutes. The free tier is limited, so a longer TTL saves quota; `0` disables caching | 15 |
| `tools.web.search.timeoutSeconds` | Per-request timeout in seconds; each retry gets its own timeout | 30 |

```bash
openclaw config set tools.web.search.cacheTtlMinutes 60
```

Identical searches issued at the same time are also merged into one request and use one call of quota.

## Common errors

For these errors the plugin adds a fix-it hint (the `hint` field on structured errors,
or appended to the thrown error message).

| Symptom | Cause | Fix |
|---|---|---|
| `missing_baidu_api_key` | No key configured | Configure one as in [Quick start](#4-configure-openclaw), then restart the Gateway |
| 401, `216003`, `InvalidHTTPAuthHeader` | Invalid or malformed key | Use the whole `bce-v3/ALTAK-.../...` string, lowercase prefix, no extra spaces or quotes, and not an AK/SK |
| 403 | Key lacks Baidu AI Search permission | Check the key's services / permissions on the API Key page |
| `QUOTA_USER_DAILY_FREE` | Free quota used up | [Enable pay-as-you-go](https://console.bce.baidu.com/qianfan/studio/resource) or wait for quota to refresh |
| `BILLING_INSUFFICIENT_BALANCE` | Account balance overdue | [Top up](https://console.bce.baidu.com/finance/recharge) |
| 429, `RATE_LIMIT_*` | Too many requests (free tier: 1 QPS; pay-as-you-go: 3 QPS) | Retry later; the plugin retries automatically and honors `Retry-After` |

Network errors, timeouts and 502/503/504 are retried up to 2 times; exhausted quota and unpaid
balance are not. Cancelling the tool call stops the request and any retry wait immediately.

## How it works

- Endpoint: `POST https://qianfan.baidubce.com/v2/ai_search/web_search`
- Auth: `Authorization: Bearer <bce-v3/ALTAK-...>` with `X-Appbuilder-From: openclaw`
- Body: `{"messages":[{"role":"user","content":"<query>"}], "search_source":"baidu_search_v2", "resource_type_filter":[{"type":"web","top_k":<count>}]}` plus optional filters:
  - `freshness` → top-level `search_recency_filter` (`day`/`week`/`month`/`year`)
  - `date_after`/`date_before` → `search_filter.range.page_time {gte, lte}` (both inclusive).
    Live testing shows Baidu needs absolute dates on both sides (otherwise it ignores the filter or errors),
    so a missing side is filled with `2000-01-01` / `2099-12-31`
  - `site` → `search_filter.match.site`; `exclude_sites` → `block_websites`
  - queries over 72 chars → `query_policy.enable_rewrite: true`
- A Baidu `code != 0` response (numeric, or symbolic like `QUOTA_USER_DAILY_FREE`) returns a
  structured `baidu_search_error` (with `code`, `requestId`, `hint`) instead of throwing into the tool loop

## Security

- Requests go through the OpenClaw SDK's `withTrustedWebSearchEndpoint` (SSRF protection)
- The plugin ships no credentials; the key comes from plugin config (SecretRef supported) or env vars, and the config field is marked sensitive in the UI
- Search results are marked as untrusted external content

## Development

```bash
npm test            # unit tests + index.js behavior tests (SDK stand-in in test/fixtures; no openclaw install needed)
npm run typecheck   # JSDoc type check of lib/ (TypeScript checkJs)
BAIDU_API_KEY=bce-v3/ALTAK-... node .github/live-smoke.mjs   # live API smoke test, 4 calls
```

- CI: the `test` workflow runs tests on Node 22/24/26 plus the type check
- Live smoke: the `live-smoke` workflow runs daily at 01:00 UTC and on `lib/` / `index.js` changes;
  it needs `BAIDU_API_KEY` under **Settings → Secrets and variables → Actions → Secrets**
  (not Variables, which are plaintext) and skips without it
- Releasing: bump `package.json` version and push, then run **Package publish** from the Actions tab;
  it authenticates with ClawHub trusted publishing (GitHub OIDC), so no token is stored. Pull requests get a dry run

## License

MIT
