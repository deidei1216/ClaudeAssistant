---
title: feat: 简历筛选 Agent
type: feat
status: completed
date: 2026-04-10
origin: agents/docs/brainstorms/resume-screening-agent-requirements.md
---

# feat: 简历筛选 Agent

## Overview

构建一个简历筛选 Agent，用于人力外包公司的简历初筛流程。Agent 接收 Word/PDF 简历，根据岗位要求进行多维度评估，输出筛选报告（Markdown/PDF）和汇总表。

## Problem Frame

人力外包公司的简历初筛流程存在以下痛点：
- 人工初筛耗时，需快速过滤不合适候选人
- 简历交付给客户时，客户需要花费时间定位关键信息
- 缺乏标准化的筛选依据记录，难以追溯决策原因

**业务流程**：简历池 → 初筛(Agent) → 人工复核 → 交付给客户 → 客户决策 → 面试安排

## Requirements Trace

**[输入输出]**
- **R1**: 支持单份/批量处理 Word/PDF 简历（上限 20 份/批次）
- **R3**: 输出筛选报告（Markdown/PDF），包含筛选结论、维度评分、核心依据
- **R4**: 批量处理输出汇总表（候选人名单、筛选结论、评分概览）

**[评估逻辑]**
- **R2**: 多维度评估：技能匹配、经验年限、学历证书、项目经历、软技能
- **R6**: 准确率 ≥ 80%（Agent 结论与人工复核一致率）

**[功能特性]**
- **R5**: 支持岗位模板库，快速选择岗位要求

**[性能]**
- **R7**: 单份处理 ≤ 3 分钟，并发处理（最多 5 个并行）

## Scope Boundaries

**非目标**：
- 自动发送简历给客户
- 面试安排或后续流程管理
- 与外部招聘平台集成
- 简历库管理或候选人档案存储
- PDF 批注/视觉标记功能

## Context & Research

### Relevant Code and Patterns

- **Agent 定义模式**：`agents/*.json` + `agents/*.md` 双文件模式
- **Skill 定义模式**：`skills/*/SKILL.md` + TypeScript 实现
- **文件交付边界**：`workspace/.deliveries/` 目录 + manifest 系统
- **附件处理**：`core/attachments.ts` 下载、保存、sanitization
- **Session 存储**：`sessions/<UUID>/uploads/` 用户上传文件
- **微信适配器**：`adapters/weixin/` 消息处理

### Technology Stack

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥18.18.0 | 运行时 |
| TypeScript | 5.9.2 | 语言 |
| discord.js | 14.22.1 | 适配器模式参考 |
| docx | 9.6.1 | Word 文档处理（已安装） |
| pdf-parse | 待添加 | PDF 文本提取 |
| pino | 9.9.0 | 日志 |

### Key Technical Decision

**输出格式**：Markdown 优先
- 主要输出 Markdown 格式筛选报告
- 可选转换为 PDF（使用简单库如 marked + pdfkit）
- 不修改原始简历文件

## Key Technical Decisions

| 决策 | 选择 | 理由 |
|------|------|------|
| 输入渠道 | 微信上传 | 用户主要使用微信进行日常沟通 |
| PDF 文本提取 | pdf-parse | pdf-lib 不支持文本提取 |
| 输出格式 | Markdown 优先 | 简化实现，避免 PDF 批注复杂度 |
| 模板库位置 | `skills/resume-screening/templates/` | 作为 Skill 的一部分，符合现有模式 |
| 并发策略 | 最多 5 个并行 | 平衡效率与资源消耗 |

## Open Questions

### Resolved During Planning

- **PDF 文本提取**：使用 pdf-parse（pdf-lib 不支持文本提取）
- **输出格式**：Markdown 优先，避免 PDF 批注复杂度
- **输入渠道**：微信上传
- **模板库位置**：`skills/resume-screening/templates/`
- **并发策略**：最多 5 个并行处理

### Deferred to Implementation

- **评分算法具体设计**：加权评分 vs 阈值判定，实现时根据测试效果调整
- **并发错误隔离策略**：单份失败时的处理方式（记录错误继续 vs 中断批次）

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

```
┌─────────────────────────────────────────────────────────────────┐
│                    Resume Screening Agent                        │
├─────────────────────────────────────────────────────────────────┤
│  Input Layer                                                     │
│  ├── WeChat Adapter → 接收简历文件                               │
│  ├── File Handler → 保存到 sessions/<id>/uploads/                │
│  └── Format Detector → Word/PDF 识别                             │
├─────────────────────────────────────────────────────────────────┤
│  Processing Layer                                                │
│  ├── Resume Parser → 提取文本内容                                 │
│  ├── Template Loader → 加载岗位要求模板                          │
│  ├── Screening Engine → 多维度评估                               │
│  └── Batch Processor → 并发控制（max 5）                          │
├─────────────────────────────────────────────────────────────────┤
│  Output Layer                                                    │
│  ├── Report Generator → Markdown 报告生成                        │
│  ├── Summary Generator → 汇总表生成                               │
│  └── Delivery Publisher → 发布到 .deliveries/                    │
└─────────────────────────────────────────────────────────────────┘
```

**数据流**：
1. 微信接收简历 → 保存到 session uploads
2. 解析简历内容（Word 用 docx，PDF 用 pdf-parse）
3. 加载岗位模板或使用手动输入的要求
4. Claude Sonnet 评估五个维度
5. 生成 Markdown 报告 + 汇总表
6. 发布到 `.deliveries/` 边界

## Implementation Units

- [ ] **Unit 1: Agent 定义与配置**

**Goal:** 创建 resume-screening Agent 的定义文件

**Requirements:** R1, R5

**Dependencies:** None

**Files:**
- Create: `agents/resume-screening.json`
- Create: `agents/resume-screening.md`

**Approach:**
- 定义 Agent 配置：model=sonnet, permissionMode=auto
- 配置 allowedTools：Read, Write, Glob, Grep, Bash(pdf-lib:*)
- 编写 customSystemPrompt：简历筛选任务提示词
- 创建 Markdown 文档说明 Agent 用途

**Patterns to follow:**
- `agents/code-review.json` 配置格式
- `agents/code-review.md` 文档格式

**Test scenarios:**
- Happy path: Agent 配置文件被正确解析
- Edge case: 缺失字段时的默认值处理

**Verification:**
- Agent 可通过 `/profile resume-screening` 加载
- 配置字段符合 AgentConfig 类型定义

---

- [ ] **Unit 2: Skill 基础结构**

**Goal:** 创建 resume-screening Skill 的目录结构和元数据

**Requirements:** R3

**Dependencies:** Unit 1

**Files:**
- Create: `skills/resume-screening/SKILL.md`
- Create: `skills/resume-screening/index.ts`
- Create: `skills/resume-screening/lib/types.ts`
- Create: `skills/resume-screening/templates/.gitkeep`

**Approach:**
- 定义 Skill 元数据（name, description, when to use）
- 创建类型定义：Resume, ScreeningResult, Annotation
- 创建模板目录占位

**Patterns to follow:**
- `skills/file-return/SKILL.md` 格式
- `skills/file-return/lib/contracts.ts` 类型定义模式

**Test scenarios:**
- Happy path: Skill 元数据被正确加载
- Integration: 类型定义与 Agent 配置兼容

**Verification:**
- Skill 目录结构完整
- 类型定义编译通过

---

- [ ] **Unit 3: 简历解析模块**

**Goal:** 实现 Word/PDF 简历文本提取

**Requirements:** R1, R2

**Dependencies:** Unit 2

**Files:**
- Create: `skills/resume-screening/lib/resume-parser.ts`
- Modify: `package.json` (add pdf-parse dependency)
- Test: `tests/skills/resume-screening/resume-parser.test.ts`

**Approach:**
- PDF 解析：使用 pdf-parse 提取文本内容（pdf-lib 不支持文本提取）
- Word 解析：使用现有 docx 库提取文本
- 返回结构化的 ResumeData 对象

**Patterns to follow:**
- `core/attachments.ts` 文件处理模式
- 异步处理模式

**Test scenarios:**
- Happy path: 解析标准 PDF 简历提取关键信息
- Happy path: 解析标准 Word 简历提取关键信息
- Edge case: 处理加密/损坏的 PDF
- Edge case: 处理空文档
- Error path: 不支持的文件格式

**Verification:**
- 测试用例覆盖 PDF 和 Word 解析
- 能从示例简历中提取技能、经验、学历等字段

---

- [ ] **Unit 4: 岗位模板库**

**Goal:** 实现岗位要求模板的加载和管理

**Requirements:** R5

**Dependencies:** Unit 2

**Files:**
- Create: `skills/resume-screening/lib/template-manager.ts`
- Create: `skills/resume-screening/templates/java-developer.yaml`
- Create: `skills/resume-screening/templates/frontend-developer.yaml`
- Test: `tests/skills/resume-screening/template-manager.test.ts`

**Approach:**
- YAML 格式存储模板
- 提供 loadTemplate() 和 listTemplates() 方法
- 支持模板热重载

**Patterns to follow:**
- 需求文档附录的 YAML 格式示例
- 配置文件加载模式

**Test scenarios:**
- Happy path: 加载 Java 开发工程师模板
- Happy path: 列出所有可用模板
- Edge case: 模板文件不存在时的 fallback
- Edge case: 模板格式错误时的解析

**Verification:**
- 至少包含 2 个示例模板
- 模板加载函数返回正确的 JobTemplate 对象

---

- [ ] **Unit 5: 筛选评估引擎**

**Goal:** 实现简历多维度评估逻辑

**Requirements:** R2, R6

**Dependencies:** Unit 3, Unit 4

**Files:**
- Create: `skills/resume-screening/lib/screening-engine.ts`
- Test: `tests/skills/resume-screening/screening-engine.test.ts`

**Approach:**
- 接收 ResumeData 和 JobTemplate
- 构建 Claude prompt 进行多维度评估
- 解析 Claude 响应为 ScreeningResult
- 实现评分算法（1-5 分制）

**Patterns to follow:**
- Claude API 调用模式
- 结构化输出解析

**Test scenarios:**
- Happy path: 评估匹配的候选人返回高分
- Happy path: 评估不匹配的候选人返回低分
- Edge case: 简历信息不完整时的处理
- Integration: 与模板管理器协作

**Verification:**
- 评估结果包含五个维度的评分
- 输出格式符合 ScreeningResult 类型

---

- [ ] **Unit 6: 报告生成器**

**Goal:** 生成 Markdown 格式的筛选报告

**Requirements:** R3

**Dependencies:** Unit 5

**Files:**
- Create: `skills/resume-screening/lib/report-generator.ts`
- Test: `tests/skills/resume-screening/report-generator.test.ts`

**Approach:**
- 接收 ScreeningResult 生成 Markdown 报告
- 报告结构：筛选结论、维度评分表格、核心依据列表
- 可选：转换为 PDF（使用简单方案如 marked + html-pdf）

**Patterns to follow:**
- Markdown 模板生成模式
- 交付边界验证模式

**Test scenarios:**
- Happy path: 生成完整的 Markdown 报告
- Happy path: 报告包含所有必需字段
- Edge case: 空评分时的处理
- Integration: 输出到 .deliveries/ 目录

**Verification:**
- 生成的 Markdown 可被正确渲染
- 报告包含筛选结论、评分、依据

---

- [ ] **Unit 7: 批量处理器**

**Goal:** 实现并发处理多份简历

**Requirements:** R1, R4, R7

**Dependencies:** Unit 3, Unit 5, Unit 6

**Files:**
- Create: `skills/resume-screening/lib/batch-processor.ts`
- Create: `skills/resume-screening/lib/summary-generator.ts`
- Test: `tests/skills/resume-screening/batch-processor.test.ts`

**Approach:**
- 实现 Promise 并发控制（max 5）
- 错误隔离：单份失败记录错误，继续处理其他
- 生成 Excel/Markdown 汇总表

**Patterns to follow:**
- 异步并发模式
- 错误处理模式

**Test scenarios:**
- Happy path: 并发处理 10 份简历
- Happy path: 生成汇总表
- Edge case: 部分简历处理失败
- Edge case: 达到批量上限 20 份
- Error path: 超过上限时的拒绝处理

**Verification:**
- 并发处理时间明显低于顺序处理
- 汇总表包含所有候选人的评分概览

---

- [ ] **Unit 8: 微信适配器集成**

**Goal:** 在微信适配器中支持简历文件上传和处理

**Requirements:** R1

**Dependencies:** Unit 1, Unit 7

**Files:**
- Modify: `adapters/weixin/index.ts`
- Create: `adapters/weixin/resume-handler.ts`
- Test: `tests/adapters/weixin/resume-handler.test.ts`

**Approach:**
- **新增文件附件处理**：实现微信消息类型 4（文件）的下载和保存
- 检测上传文件类型（Word/PDF）
- 触发 resume-screening Agent
- 返回处理结果

**Patterns to follow:**
- `adapters/discord/index.ts` 附件处理模式
- `core/attachments.ts` 文件处理

**Test scenarios:**
- Happy path: 微信接收 PDF 文件并保存到 uploads 目录
- Happy path: 上传 PDF 简历触发筛选
- Happy path: 上传 Word 简历触发筛选
- Edge case: 上传非简历文件时的忽略
- Integration: 与 session 存储协作

**Verification:**
- 微信上传简历后收到筛选结果
- 文件保存到正确的 session 目录

---

- [ ] **Unit 9: 文档与示例**

**Goal:** 编写使用文档和示例模板

**Requirements:** R5

**Dependencies:** Unit 4

**Files:**
- Create: `skills/resume-screening/README.md`
- Create: `skills/resume-screening/templates/README.md`
- Update: `agents/resume-screening.md` (添加使用说明)

**Approach:**
- 编写 Skill 使用指南
- 说明如何创建自定义岗位模板
- 提供完整的使用示例

**Test scenarios:**
- Test expectation: none -- 文档类单元

**Verification:**
- 文档完整描述所有功能
- 示例可直接复制使用

## System-Wide Impact

- **Interaction graph**:
  - 微信适配器接收文件 → resume-handler（Unit 8 实现）处理 → Agent 执行筛选 → Markdown 报告输出到 .deliveries
- **Error propagation**:
  - 文件解析失败 → 返回错误消息给用户
  - 筛选超时 → 记录日志，返回超时提示
- **State lifecycle risks**:
  - Session 目录清理策略需考虑简历文件保留时间
  - 并发处理时需确保 session 状态一致性
- **API surface parity**: N/A（无外部 API）
- **Integration coverage**:
  - 微信适配器 + 简历处理
  - Agent 执行 + 文件交付
- **Unchanged invariants**:
  - 现有的 `.deliveries/` 交付边界不变
  - Session 存储结构不变

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PDF 文本提取质量不稳定 | Medium | Medium | 测试多种 PDF 格式，添加错误提示 |
| 筛选准确率未达标 | Medium | High | 迭代优化 prompt，增加示例样本 |
| 微信文件大小限制 | Low | Medium | 文档说明支持的文件大小范围 |
| 并发处理内存溢出 | Low | High | 实现内存监控，限制并发数 |

## Documentation / Operational Notes

- **用户文档**：Skill README 中说明使用方式
- **模板创建**：提供 YAML 格式指南和示例
- **监控建议**：记录筛选耗时、准确率统计
- **错误处理**：定义常见错误码和解决方案

## Sources & References

- **Origin document**: [agents/docs/brainstorms/resume-screening-agent-requirements.md](agents/docs/brainstorms/resume-screening-agent-requirements.md)
- **Agent pattern**: `agents/code-review.json`
- **Skill pattern**: `skills/file-return/SKILL.md`
- **File handling**: `core/attachments.ts`