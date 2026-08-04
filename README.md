# Baidu AI Search Plugin for OpenClaw

OpenClaw `web_search` 的百度 AI 搜索 Provider。调用百度千帆 `v2/ai_search`
接口，返回结构化搜索结果（标题、链接、摘要、发布时间、站点名）。

> 社区现有的百度搜索插件要么 API 版本过老装不上，要么被安全扫描标记风险。
> 本插件代码量小、完全可审查，key 只发送到百度官方端点
> `https://qianfan.baidubce.com`，绝不经过任何第三方中转。

## 安装

```bash
openclaw plugins install clawhub:@tqsy114514/baidu-search-plugin
```

## 配置

### 1. 获取百度千帆 AI 搜索 API Key

在 [百度智能云千帆控制台](https://console.bce.baidu.com/qianfan/)
开通「百度AI搜索」服务并创建应用，得到 `bce-v3/ALTAK-...` 格式的 API Key。

### 2. 写入配置

```bash
openclaw config set plugins.entries.baidu.config.webSearch.apiKey "bce-v3/ALTAK-..."
openclaw config set tools.web.search.provider baidu
openclaw gateway restart
```

也支持环境变量 `BAIDU_API_KEY`。

### 3. 使用

```bash
openclaw run "帮我搜一下 xxx"
```

或直接在任意会话中调用 `web_search` 工具，provider 显示为 `baidu`。

## 工作原理

- 端点：`POST https://qianfan.baidubce.com/v2/ai_search`
- 请求体：`{"messages":[{"role":"user","content":"<query>"}]}`
- 鉴权：`Authorization: Bearer <bce-v3/ALTAK-...>`
- 响应 `references[]` 映射为标准 `web_search` 结果，自带结果缓存

## 安全

- 复用 OpenClaw SDK 的 `withTrustedWebSearchEndpoint`（SSRF 防护）、
  搜索结果缓存、外部内容包裹（untrusted 标记）等机制
- 插件不含任何密钥，key 从配置或环境变量读取

## License

MIT
