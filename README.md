# Baidu AI Search Plugin for OpenClaw

[English](README.en.md) | 中文

![ClawHub downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FTQSY114514%2Fbaidu-search-plugin%2Fmaster%2Fdownloads.json&query=latest&label=ClawHub%20downloads&color=success&style=for-the-badge)

<img src="chart.svg" alt="ClawHub downloads trend" width="720">

> 趋势图数据由 GitHub Actions 每天自动抓取 ClawHub 插件页面并重绘（见 `.github/workflows/track-downloads.yml`），
> 历史数据见 [`downloads.json`](downloads.json)。

把百度搜索接入 OpenClaw 的 `web_search` 工具。调用百度千帆「百度 AI 搜索 → 百度搜索」接口
（`v2/ai_search/web_search`），返回结构化结果：标题、链接、摘要、发布时间、站点名。
支持结果条数、时效 / 日期范围、站点限定与屏蔽。

> 社区现有的百度搜索插件要么 API 版本过老装不上，要么被安全扫描标记风险。
> 本插件代码量小、完全可审查，key 只发送到百度官方端点
> `https://qianfan.baidubce.com`，绝不经过任何第三方中转。

## 快速开始

### 1. 安装插件

```bash
openclaw plugins install clawhub:@tqsy114514/baidu-search-plugin
```

### 2. 获取百度 AI 搜索 API Key

1. **注册并实名认证**：登录 [百度智能云](https://cloud.baidu.com)，在「账号中心」完成实名认证。
   未实名的账号开通不了百度 AI 搜索资源，调用会失败。
2. **打开 API Key 页面**：进入百度 AI 搜索控制台的
   [API Key 管理页](https://console.bce.baidu.com/ai-search/qianfan/ais/console/apiKey)。
   第一次进入时按提示同意服务协议，实名账号会自动开通百度 AI 搜索。
3. **创建 API Key**：点「创建 API Key」。如果页面让你选择服务 / 权限范围，
   请确认包含**千帆平台**（百度 AI 搜索属于千帆平台）。
4. **复制完整的 Key**：Key 形如 `bce-v3/ALTAK-xxxxxxxx/xxxxxxxxxxxx`。
   **整串都是 Key**，包括开头的 `bce-v3/` 和中间的 `/`。直接从页面复制，不要改大小写
   （开头是小写 `bce-v3`）。创建后请立即复制并妥善保存，之后可能无法再查看完整明文。

> **容易拿错的几种凭证**（都不能用）：
> - 百度智能云「安全认证 → Access Key」里的 **AK / SK**（Access Key ID + Secret Access Key）
> - 旧版千帆 AppBuilder「应用」的 **App ID / 应用密钥**
> - 千帆大模型旧版的 **API Key + Secret Key** 组合（用来换 access_token 的那种）
>
> 本插件只认 `bce-v3/ALTAK-...` 这种 API Key，请求时以 `Authorization: Bearer <Key>` 发送。

**费用**：百度搜索每月免费 **1500 次**（按天发放，约每天 50 次），默认先用免费额度。
超出后需要先 [开通后付费](https://console.bce.baidu.com/qianfan/studio/resource) 才能继续调用，
价格以 [百度官方计费说明](https://cloud.baidu.com/doc/qianfan/s/1mh4sv6c4) 为准。
已用额度可以在 [资源额度](https://console.bce.baidu.com/ai_apaas/resource) 页面查看。

### 3. （可选）先验证 Key 能用

```bash
export BAIDU_API_KEY='bce-v3/ALTAK-...'
curl -s https://qianfan.baidubce.com/v2/ai_search/web_search \
  -H "Authorization: Bearer $BAIDU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"百度千帆"}],"search_source":"baidu_search_v2","resource_type_filter":[{"type":"web","top_k":1}]}'
```

返回里有 `"references"` 就说明 Key 可用。返回 `216003` / `InvalidHTTPAuthHeader`
说明 Key 不对，常见原因见下面的[常见错误](#常见错误)。

### 4. 在 OpenClaw 里配置

任选一种方式：

**方式 A：交互式向导（推荐）**

```bash
openclaw configure --section web
```

在列表里选择 **Baidu AI Search**，按提示粘贴 Key（输入会被隐藏）。

**方式 B：命令行**

```bash
openclaw config set plugins.entries.baidu.config.webSearch.apiKey 'bce-v3/ALTAK-...'
openclaw config set tools.web.search.provider baidu
openclaw gateway restart
```

**方式 C：环境变量**

在 Gateway 进程的环境里设置 `BAIDU_API_KEY`（也兼容 `QIANFAN_API_KEY`）。
用 gateway 方式安装的，写进 `~/.openclaw/.env`：

```bash
BAIDU_API_KEY=bce-v3/ALTAK-...
```

然后执行 `openclaw config set tools.web.search.provider baidu`，再执行 `openclaw gateway restart`。

#### 更安全：把 Key 放进 OpenClaw 的密钥库

方式 B 会把 Key 以明文写进 `openclaw.json`。更推荐把 Key 存进 OpenClaw 的共享密钥库，
配置里只保留一个引用（SecretRef）：

```bash
# 交互式输入，不回显，也不会留在 shell 历史里
openclaw secrets store set BAIDU_API_KEY --kind secret

# 配置里只写引用
openclaw config set plugins.entries.baidu.config.webSearch.apiKey \
  '{"source":"store","provider":"default","id":"BAIDU_API_KEY"}' --strict-json
openclaw config set tools.web.search.provider baidu
openclaw secrets reload
```

详见 OpenClaw 文档：[Secrets CLI](https://docs.openclaw.ai/cli/secrets)、[SecretRef](https://docs.openclaw.ai/gateway/secrets/secretref-contract)。

### 5. 使用

在任意 OpenClaw 会话里让它搜索即可，例如「用百度搜一下今天的科技新闻」。
`web_search` 工具的 provider 会显示为 `baidu`。

## 搜索参数

除 `query` 外，`web_search` 支持以下可选参数（均由工具 schema 暴露）：

| 参数 | 说明 | 默认 |
|---|---|---|
| `query` | 搜索关键词。百度只检索前 72 个字符（汉字算 2 个，约 36 个汉字），超出时自动开启百度的 query 改写；首尾空白自动去除，空字符串返回 `empty_query`，超过 500 字符截断 | 必填 |
| `count` | 返回结果条数，1–10 | 5 |
| `freshness` | 时效：`pd`/`pw`/`pm`/`py`（近一天 / 周 / 月 / 年），或 `day`/`week`/`month`/`year`；不能和日期参数同时用 | 无 |
| `date_after` | 只要这一天及之后发布的结果，`YYYY-MM-DD` | 无 |
| `date_before` | 只要这一天及之前发布的结果，`YYYY-MM-DD` | 无 |
| `site` | 只在这些站点里搜，字符串或数组；`site:Baidu.com`、`https://baidu.com/x` 都会归一化成 `baidu.com`；最多 20 个（百度上限） | 无 |
| `exclude_sites` | 屏蔽这些站点，字符串或数组；归一化规则同 `site` | 无 |

## 返回结果

每条结果包含 `title`、`url`、`description`（摘要）、`published`（`YYYY-MM-DD`）、`siteName`。
百度返回了对应信息时，还会带上：

- `rerankScore`：相关性评分，0–1
- `authorityScore`：网页权威性评分，0–1
- `author`：百家号文章的作者

插件对结果做了这些处理：

- 按网址去重（忽略大小写、`#` 锚点和末尾斜杠）
- 摘要超过 500 字符时截断，末尾加 `…`
- 去掉百度在标题、摘要里嵌入的 `\u0004`/`\u0005` 高亮控制符
- 发布时间统一成 `YYYY-MM-DD`，支持 `2026-9-1`、`2026/9/1`、`2026年9月1日`、时间戳等；
  时间戳按北京时间取日期，不受服务器时区影响；解析不了的保留原文
- 标题、摘要会标记为外部不可信内容（OpenClaw 的 untrusted 包裹）

## 缓存与超时

两项都读 OpenClaw 通用的 `web_search` 配置：

| 配置 | 说明 | 默认 |
|---|---|---|
| `tools.web.search.cacheTtlMinutes` | 结果缓存分钟数。免费额度有限，调大可以省配额；`0` 关闭缓存 | 15 |
| `tools.web.search.timeoutSeconds` | 单次请求超时（秒），每次重试单独计时 | 30 |

```bash
openclaw config set tools.web.search.cacheTtlMinutes 60
```

另外，同一时间发起的相同搜索会自动合并成一次请求，只消耗一次额度。

## 常见错误

插件遇到下面这些错误时，会在错误信息里附带中文处理建议
（结构化错误的 `hint` 字段，或追加在异常信息末尾）。

| 现象 | 原因 | 处理 |
|---|---|---|
| `missing_baidu_api_key` | 没配置 Key | 按[快速开始](#4-在-openclaw-里配置)配置，然后重启 Gateway |
| 401、`216003`、`InvalidHTTPAuthHeader` | Key 无效或格式不对 | 确认是完整的 `bce-v3/ALTAK-.../...` 整串、开头小写、没有多余空格或引号，并且不是 AK/SK |
| 403 | Key 没有百度 AI 搜索权限 | 在 API Key 页面检查这个 Key 的服务 / 权限范围 |
| `QUOTA_USER_DAILY_FREE` | 免费额度用完 | [开通后付费](https://console.bce.baidu.com/qianfan/studio/resource)，或等额度刷新 |
| `BILLING_INSUFFICIENT_BALANCE` | 账户欠费 | [充值](https://console.bce.baidu.com/finance/recharge) |
| 429、`RATE_LIMIT_*` | 请求太频繁（免费额度限 1 QPS，开通后付费为 3 QPS） | 稍后再试；插件会自动按 `Retry-After` 重试 |

网络错误、超时、502/503/504 等临时错误会自动重试最多 2 次；额度用完和欠费不会重试。
工具调用被取消时，请求和重试等待都会立即停止。

## 工作原理

- 端点：`POST https://qianfan.baidubce.com/v2/ai_search/web_search`
- 鉴权：`Authorization: Bearer <bce-v3/ALTAK-...>`，附 `X-Appbuilder-From: openclaw`
- 请求体：`{"messages":[{"role":"user","content":"<query>"}], "search_source":"baidu_search_v2", "resource_type_filter":[{"type":"web","top_k":<count>}]}`，再加上可选过滤条件：
  - `freshness` → 顶层 `search_recency_filter`（`day`/`week`/`month`/`year`）
  - `date_after`/`date_before` → `search_filter.range.page_time {gte, lte}`（两端都包含）。
    实测百度要求两端都是具体日期，否则会忽略过滤或报错，所以只给一侧时，另一侧补 `2000-01-01` / `2099-12-31`
  - `site` → `search_filter.match.site`；`exclude_sites` → `block_websites`
  - query 超过 72 个字符 → `query_policy.enable_rewrite: true`
- 百度返回 `code != 0`（数字码，或 `QUOTA_USER_DAILY_FREE` 这类字符串码）时，
  返回结构化的 `baidu_search_error`（带 `code`、`requestId`、`hint`），不会抛异常打断工具循环

## 安全

- 网络请求走 OpenClaw SDK 的 `withTrustedWebSearchEndpoint`（SSRF 防护）
- 插件不内置任何密钥；Key 从插件配置（支持 SecretRef）或环境变量读取，配置项在 UI 里按敏感字段显示
- 搜索结果标记为外部不可信内容

## 开发

```bash
npm test            # 单元测试 + index.js 行为测试（用 test/fixtures 里的 SDK 替身，不需要安装 openclaw）
npm run typecheck   # 对 lib/ 做 JSDoc 类型检查（TypeScript checkJs）
BAIDU_API_KEY=bce-v3/ALTAK-... node .github/live-smoke.mjs   # 真实接口冒烟测试，4 次调用
```

- CI：`test` workflow 在 Node 22/24/26 上跑测试并做类型检查
- 真实接口冒烟：`live-smoke` workflow 每天北京时间 09:00 运行，`lib/`、`index.js` 有改动时也会运行；
  需要在仓库的 **Settings → Secrets and variables → Actions → Secrets** 里添加 `BAIDU_API_KEY`
  （不要加在 Variables 里，那里是明文），没配置时自动跳过
- 发布：先升级 `package.json` 版本号并推送，然后在 Actions 里手动运行 **Package publish**；
  通过 ClawHub trusted publisher（GitHub OIDC）认证，不需要保存 token。PR 上会自动做一次 dry-run

## License

MIT
