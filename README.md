# AdGuard Agent｜广告宣传材料合规检查助手

一个面向广告/品牌团队的发布前第一轮预审工具。它依据题目给定的 A-01～A-10 规则检查广告文案和海报，定位风险原文、给出可执行修改建议，并在材料不完整时明确转人工复核。

> 本项目只依据题目提供的规则进行预审；结果不构成最终法律意见。风险等级是本 Prototype 的实现策略，不是题目原始规则。

## 功能

- B 端工作台：新建审核支持一段文案与最多 5 张配图作为一个审核单元；批量最多 10 张独立图片，并逐项提交审核。单个内容项的配图总大小不超过 3.5MB。
- 审核任务、待人工复核和近期记录仅保存在当前浏览器；任务元数据使用 localStorage，上传图片 Blob 使用 IndexedDB，以便从任务列表重新进入详情时恢复原图；不提供多人协作、账号或云端持久化。
- 全量返回 A-01～A-10；每条风险证据必须可在 Canonical Content 中定位。
- `PASS / RISK / UNCERTAIN`；模糊、裁切或无法验证时不强行判定合规。
- `status`（PASS / RISK / UNCERTAIN）、`severity`（HIGH / MEDIUM / LOW / null）和 `needHumanReview` 是三套独立字段；等级只用于已确认问题的处理优先级。
- A-06 受控敏感词库命中后，代码强制拦截、标为高风险并要求人工复核；A-09 真实性无法验证时进入人工复核；A-10 材料不足进入补充确认。
- A-05 先区分效果主张与品牌/情绪/抽象表达；明确健康、美容、性能或收益效果主张须在同一审核单元内存在可识别依据，否则标为风险。
- 主界面只呈现“哪里有问题、为什么、怎么改”；规则编号和运行信息放在折叠技术详情。
- 图片解析有可靠坐标时显示问题编号；没有可靠坐标时自动降级为文字证据，不伪造高亮。
- 审核完成后，对明确风险自动生成推荐修改稿；缺失日期、条件或数据来源时保留占位符，绝不编造事实。
- 审核结果支持受控的“询问审核助手”：解释结论、改写建议、引导补充材料；不能直接改变原审核结论，补充材料后须重新审核。
- `Generate → Validate → Repair once → Safe fallback`，第二次仍无法验证时进入人工复核。
- API 的 `review` 字段保持题目规格中的 snake_case Structured Output；UI 专用的证据定位和 Canonical Content 位于独立 `presentation` 字段，不改变核心审核契约。
- `/eval` 为隐藏的 Eval 演示路由，不出现在正式工作台导航。

## 架构

```text
Text / image input
  → server-side input validation
  → Vision Parser (image only)
  → Canonical Content
  → deterministic sensitive-term intercept + one structured rule review
  → evidence / coverage / invariant validator
  → repair once or safe fallback
  → user-friendly report + optional copy rewrite
```

模型负责图文理解、语义判断与修改建议；代码负责文件校验、规则覆盖、证据定位、A-06 强制拦截、风险等级、人工复核、重试次数和批量隔离。人工处理以业务问题为单位记录，不会改写不可变的 AI 预审结论，也不会因处理一个问题而关闭同一素材的其他待办。

## 本地运行

1. 复制环境变量：

   ```powershell
   Copy-Item .env.example .env.local
   ```

2. 在 `.env.local` 中仅配置服务端变量：

   ```text
   OPENAI_API_KEY=...
   OPENAI_MODEL=gpt-5.6-terra
   ```

3. 安装并启动：

   ```powershell
   npm install
   npm run dev
   ```

4. 打开 `http://localhost:3000`。

## 校验与测试

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

确定性测试覆盖：A-01～A-10 覆盖、重复规则、证据幻觉、A-02 来源/口径/时间三要素、A-06 人工复核、A-08 不臆测隐藏收费、A-09 真实性不被页面文案自行证明，以及 A-10 不能返回完整 PASS。真实模型链路需要你自己的 API Key 后才能运行；测试不伪造模型准确率。

`src/lib/eval/metrics.ts` 提供 Risk Recall、Rule Accuracy、Evidence Accuracy、False Positive Rate、Abstention Accuracy 与 Schema Pass Rate 的计算工具。图片 Eval 在没有真实运行模型前只保留 fixture 规格，不宣称准确率。

36 条 Eval 集由外部目录中的 `expected_results.json` 唯一维护，运行时显式传入根目录，避免仓库内旧样例与实际测试集漂移：

```powershell
npm run eval -- "C:\Users\admin\Downloads\AdGuard_Eval_Set_V1\adguard_eval_v1"
```

当前 Eval manifest 记录“命中规则”，但尚未记录每条规则的 PASS / RISK / UNCERTAIN 期望状态；脚本会将该项标为未指定，不把 RISK 与 UNCERTAIN 混作同一种命中。待测试集补充 `expected_rule_statuses`（如 `A-01:RISK,A-09:UNCERTAIN`）后才统计该指标。

## 部署到 Vercel

1. 将仓库推送到 GitHub 并导入 Vercel。
2. 在 Vercel Project Environment Variables 设置 `OPENAI_API_KEY` 和 `OPENAI_MODEL`。
3. 不要创建 `NEXT_PUBLIC_OPENAI_API_KEY`，也不要提交 `.env.local`。
4. 部署后可用首页演示样例，也可让面试官现场上传自己的广告素材。

## 隐私与限制

- 审核任务元数据与素材仅保存在当前浏览器（localStorage / IndexedDB），服务端不持久化保存；请求会在服务端转发给模型服务。
- API 调用设置 `store: false`；仍应在实际使用时向用户说明素材会被发送至模型服务处理。
- V1 不支持 PDF、视频、登录、审批流、RAG 或外部法规检索。
- 图片高亮依赖视觉解析坐标，不能可靠定位时仅展示文字证据。
