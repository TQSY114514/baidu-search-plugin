# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.2.x   | ✅        |
| < 1.2   | ❌        |

## Reporting a Vulnerability

**请不要直接提公开 issue**（尤其是带 PoC payload 的）。

点击仓库 **Security → Report a vulnerability** 走私密报告；如果该入口不可用，
给维护者发邮件并在标题注明 `[baidu-search-plugin security]`。

报告请尽量包含：影响版本、复现步骤（不含真实 API Key）、你认为的影响范围。

## Response

- 收到后 7 天内确认，评估 High/Critical 的问题优先修补并走 patch 版本发布；
- 修复发布前请不要公开细节；
- 本插件运行在用户本地 OpenClaw 实例中，不收集、不外传任何数据，
  唯一的敏感信息是用户自己的百度 API Key——请勿在 issue、日志、截图中粘贴 Key。

---

*English summary: supported range is 1.2.x. Report privately via
Security → Report a vulnerability, never in a public issue.
No data is collected by this plugin; never paste your Baidu API key
in issues, logs or screenshots.*
