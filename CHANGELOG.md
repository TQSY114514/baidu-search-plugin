# Changelog

每个版本的说明会作为 ClawHub 更新日志和 GitHub Release 内容发布（见 `.github/workflows/package-publish.yml`）。
还没发布的改动写在最上面的 `## Unreleased` 小节里；发版时把它改成 `## <版本号>`。

## 1.3.2 (2026-10-30)

- 无行为变化。查询与摘要的 Unicode 安全截断、百度 query 长度计算改为按码元游标扫描，不再分配中间数组；摘要截断到 500 字符即停止

## 1.3.1 (2026-10-01)

- 重写 README 安装与 API Key 获取说明（官方 AI 搜索 API Key 页、实名认证、常见错拿凭证、curl 自检、OpenClaw secrets 正确用法、错误排查表）
- 配置向导申请链接改为 API Key 页
- QPS 超限提示改正为免费 1 QPS / 后付费 3 QPS

## 1.3.0 (2026-10-01)

- 修复日期过滤：百度要求 `page_time` 两端都是具体日期，之前的 `date_after`/`date_before` 实际未生效（已用真实接口验证）
- 相同的并发搜索合并为一次请求，节省配额
- Key 无效、额度用完、欠费、QPS 超限时给出中文处理建议；额度用完与欠费不再重试
- 识别百度字符串错误码
- 结果新增 `rerankScore`、`authorityScore`、百家号 `author`；`siteName` 优先用百度返回的 `website`

## 1.2.1 (2026-10-01)

- 按百度官方文档修正：长 query 自动开启改写、单侧日期补齐为双端范围、清理摘要控制字符、`site` 上限 20、SecretRef 报错路径
- 429 正确遵循 Retry-After；支持取消；`date_before` 含当天；发布日期按北京时间；站点参数规范化

## 1.2.0 (2026-09-27)

- 429 时遵循 Retry-After 重试
- 透传百度错误码
- 新增英文 README

## 1.1.0

- 改用 `v2/ai_search/web_search` 接口，支持结果条数、时效、日期范围、站点限定与屏蔽
- 新增测试和 LICENSE
- 此版本未发布到 ClawHub

## 1.0.3 (2026-08-04)

- 移除被 ClawHub 校验器标记的 manifest `uiHints` 字段，保留 `contracts`

## 1.0.2 (2026-08-04)

- 为兼容 ClawHub 校验器，移除 manifest 的 `contracts` 字段

## 1.0.1 (2026-08-04)

- 修复 ClawHub 扫描警告：更正 README 安装命令中的发布者，移除不支持的 manifest 顶层字段（`activation`/`setup`）

## 1.0.0 (2026-08-02)

- 首个版本：百度千帆 AI 搜索作为 OpenClaw `web_search` provider
