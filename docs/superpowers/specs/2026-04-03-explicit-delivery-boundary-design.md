# Explicit Delivery Boundary Design

## Goal

为 Discord 文件回传链路定义一套稳定、可预测、对大模型友好的边界模型：

- 不约束 Claude Code 在工作区内的创造力和组织方式
- 不让网关或 hook 通过全局扫描去猜“这次到底该回什么”
- 用显式发布而不是隐式推断来定义交付物

这套设计的主线是：

- 自由工作
- 显式发布
- 协议回传

## Background

当前实现已经暴露出几个结构性问题：

- Claude 生成的文件位置不稳定，可能出现在 `workspace/`、`uploads/`，甚至 session 根目录。
- hook 和网关为了兜底，开始做越来越多路径猜测和 transcript 反推。
- 长会话中可能累积大量文件，靠“扫描最近文件”或“扫描整个工作区”会越来越不可靠。
- “这是不是一个新任务”“这算不算当前轮产物”这类判断，本质上都过度依赖模型临场推断，边界不稳。

这些问题说明，系统缺的不是更多路径兼容，而是一个明确的交付边界。

## Design Principles

### 1. Do Not Constrain Reasoning, Constrain Boundaries

Claude Code 应该在合理边界内自由发挥，而不是被复杂目录制度束缚。

系统不应规定：

- 中间文件必须如何命名
- 工作区内部必须如何分层
- 任务必须如何拆成 job、turn 或 current

系统应明确规定的只有：

- 输入源在哪
- 什么内容算已发布交付物
- 什么内容允许被回传给用户

### 2. Publish Is The Boundary

本设计不采用 `current`、`turn`、`job` 作为核心状态模型。

原因是这些概念都会要求 Claude 额外判断“当前到底在做哪一件事”，在长对话和插入新需求时容易失真。

系统真正需要的不是任务归类，而是一个明确动作：

- 某个文件或目录是否已经被发布为本次可交付内容

只有“发布”后的内容，才进入回传协议的作用域。

### 3. Hooks Enforce Protocol, Not Workflow

hook 的职责是确保文件回传协议始终生效，而不是替 Claude 规划工作过程。

因此 hook 应该：

- 在 Stop 时检查是否存在已发布交付物
- 如果存在，强制 Claude 输出文件桥接 marker

hook 不应该：

- 猜测哪一个 workspace 文件最重要
- 通过大段隐藏提示词主导每轮推理
- 承担目录治理逻辑

### 4. Scripts Do Deterministic Work

脚本适合做确定性工作，不适合承担语义判断。

因此脚本负责：

- 发布文件或目录
- 生成或更新交付 manifest
- 打包交付目录
- 校验路径和安全边界

Claude 负责判断：

- 当前是否应该发布
- 应该发布哪个文件或哪个目录
- 是否需要调用打包能力

## Core Concepts

系统只定义四个核心概念。

### Source

用户输入源，通常来自 Discord 上传。

特征：

- 只读
- 作为工作素材存在
- 不是交付目录

建议语义：

- `uploads/` 是 gateway 管理的数据源位置

### Workspace

Claude 的自由工作区。

特征：

- Claude 可以自由创建脚本、临时文件、结果文件和子目录
- 不强制规定内部结构
- 可以很乱，但不影响回传协议

建议语义：

- `workspace/` 是 Claude 的主要工作区域

### Publish

显式发布动作，是本设计的核心边界。

发布表示：

- 某个文件或目录已经被 Claude 明确选为用户可交付结果

发布不是“最近创建”
发布不是“可能有用”
发布不是“看起来像结果”

发布必须是显式动作，由 Claude 决定调用。

### Return

把已发布内容通过文件桥接协议返回给 Discord 用户。

Return 不负责判断业务语义，只消费发布结果。

## Target Model

### High-Level Structure

系统使用最小目录语义：

- `uploads/`
  - 只放用户上传原件
  - 由 gateway 写入
  - Claude 视为 source
- `workspace/`
  - Claude 自由工作区
  - 允许任意组织过程文件
- `workspace/.deliveries/`
  - 唯一合法交付区
  - 只放已发布内容和交付清单

这意味着：

- 不再需要 `workspace/current`
- 不再需要 `turn-id`
- 不再需要系统去猜某个 job 的生命周期

### Delivery Unit

交付单位不是“整个 workspace”，也不是“这一次会话的全部产物”，而是“被发布的内容”。

发布内容可以是：

- 单个文件
- 一个需要整体交付的目录
- 一个由脚本打包后的归档文件

### Delivery Manifest

`workspace/.deliveries/manifest.json` 作为交付协议的确定性事实来源。

它至少需要表达：

- 当前已发布内容列表
- 主交付物
- 每个交付物是文件还是目录
- 是否需要自动打包

manifest 的核心意义不是给用户看，而是给 hook 和网关一个无需猜测的事实来源。

## Responsibility Split

### Claude Code

Claude Code 负责：

- 理解用户意图
- 在 `workspace/` 中自由处理文件
- 判断是否需要交付文件
- 判断应该发布哪个文件或目录
- 决定何时调用发布或打包脚本

Claude Code 不负责：

- 自己实现路径校验规则
- 自己发明新的回传协议

### CLAUDE.md

`CLAUDE.md` 应该是行为契约的主要承载位置，而不是仅仅作为会话记忆占位文件。

会话级 `CLAUDE.md` 至少应明确：

- `uploads/` 是只读 source
- `workspace/` 是自由工作区
- 需要返回文件时，必须执行显式发布
- 只有发布到 `.deliveries/` 的内容会被返回给用户
- 需要返回一组内容时，应发布目录或调用打包能力，而不是让网关猜多个文件

也就是说，Claude 应首先从 `CLAUDE.md` 中学习规则，然后在这个规则内自主完成任务。

### Skills And Scripts

skills 的职责是提供“应该在什么时候调用哪种能力”的语义框架。

scripts 的职责是提供最小、稳定、确定性的能力集合。

推荐的最小能力集：

- `publish-file`
- `publish-dir`
- `package-delivery`

这些能力不负责理解用户需求，只负责可靠地更新 `.deliveries/` 状态。

### Stop Hook

Stop hook 只负责：

- 检查 `.deliveries/manifest.json`
- 如果存在有效主交付物，则阻断一次并要求 Claude 输出 `[[file:...]]`

Stop hook 不应：

- 扫描整个 `workspace/`
- 从 transcript 里猜文件
- 决定哪个文件更重要

### Gateway

gateway 只负责最终安全校验和 Discord 传输。

gateway 应该：

- 只允许发送 `.deliveries/` 中声明的内容
- 拒绝未发布路径
- 拒绝越界路径
- 拒绝直接发送 `uploads/` 原始输入，除非它被显式重新发布

## Why This Is Better Than Job Or Turn Models

本设计刻意避免把“任务边界识别”作为系统核心。

原因是：

- 用户可能随时插入新问题
- Claude 可能在一个长上下文里来回复用旧产物
- “这是同一个需求还是新需求”并没有稳定、可计算的答案

而“是否发布”为一个显式动作，边界天然清晰：

- 不需要猜需求是否切换
- 不需要事后搬运或重归类
- 不需要围绕 `current` 维护可变全局状态

## Performance And Context Strategy

该设计不依赖“记录全部文件”来工作。

性能和上下文控制来自两个点：

- Claude 在 `workspace/` 内自由工作，但只有已发布内容进入交付范围
- hook 和 gateway 只读取 `.deliveries/` 和 manifest，而不是扫描整个工作区

这使得即使长会话中累计上百个文件，系统仍然只需要关注极少数“已发布内容”。

## Safety Rules

- session 根目录文件不应作为正式交付物
- `uploads/` 默认是 source，不是返回目录
- 未发布内容不得直接回传
- 目录回传必须通过 manifest 明确声明，必要时走打包
- 多文件返回不依赖“逐个猜测”，而依赖显式发布目录或归档文件

## Migration Direction

本设计的迁移方向应是收敛，而不是继续增加兼容分支。

建议顺序：

1. 先把会话级 `CLAUDE.md` 升级成真正的文件工作契约
2. 引入最小发布脚本和 `.deliveries/manifest.json`
3. 让 Stop hook 改为只消费 manifest
4. 收紧 gateway，只允许发送已发布内容
5. 逐步删除 transcript 猜测、session root 兜底、workspace 全扫描等补丁逻辑

## Non-Goals

- 不试图在这次设计里规定 workspace 内部的全部目录规范
- 不试图让系统自动理解“需求切换”的语义
- 不试图保留所有历史兼容路径
- 不把 hook 扩展成工作流编排系统

## Open Questions

这些问题属于实现阶段决策，不影响当前核心设计成立：

- manifest 的最小字段集合如何定义
- 发布动作采用复制、移动还是链接策略
- 打包结果是否也进入 `.deliveries/`
- 会话级 `CLAUDE.md` 如何与仓库级 `CLAUDE.md` 协同生成

## Recommendation

采纳本设计作为后续文件回传能力的收敛方向。

一句话概括：

- Claude 在 `workspace/` 内自由工作
- 只有显式发布到 `.deliveries/` 的内容才算交付物
- hook 负责协议触发
- gateway 负责安全发送

## Implementation Notes

- 交付边界已经收敛为 `workspace/.deliveries/manifest.json`，Stop hook 只读取这个 manifest 作为可交付物来源。
- transcript 反推、session root 兜底、`uploads/` 回退和 workspace 全局候选推断不再是 hook 的输入路径。
- 当 manifest 的主交付物是目录时，返回流程会先打包，再要求 Claude 输出对应的 `[[file:...]]` marker。
