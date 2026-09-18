# START HERE｜AdGuard Agent Codex Handoff

这是给 Codex 的开发规格包。

## 文件说明

1. `PRD.md`：产品需求、MVP 边界、页面与验收条件。
2. `ARCHITECTURE.md`：Workflow、图片处理、Validator、Batch、API、安全和工程结构。
3. `rules.json`：A-01~A-10 业务规则 Source of Truth。不要让 Codex 擅自改规则。
4. `severity_policy.json`：Prototype 风险等级策略。它不是原题规则，必须和 rules 分开。
5. `output_schema.json`：Agent 内部/最终输出的 JSON Schema。
6. `eval_cases.json`：32 个初始评估用例（文本 + image fixture specification）。
7. `CODEX_TASK.md`：完整开发任务书和完成标准。
8. `PROMPT_TO_CODEX.md`：你真正复制到 Codex 对话框里的启动提示词。
9. `.env.example`：环境变量示例，不包含真实 API Key。

## 建议怎么用

把整个文件夹放进一个新的 GitHub/本地仓库根目录，然后在 Codex 中打开这个仓库。

第一条消息直接复制 `PROMPT_TO_CODEX.md` 的内容。

不要把真实 OpenAI API Key 写进这些文件。
本地开发使用 `.env.local`；部署时在 Vercel Environment Variables 配置。

## 当前已锁定的产品决策

- 公网 Web Demo；
- Next.js + TypeScript + Tailwind；
- OpenAI API；
- 图片 + 文本；
- 批量最多 10 个；
- V1 使用多模态模型做视觉文字提取，预留 OCR Adapter；
- deterministic workflow；
- 不做复杂 Multi-Agent；
- 不做法规 RAG；
- 无登录；
- 默认不持久化用户素材。
