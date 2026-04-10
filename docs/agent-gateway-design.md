# Agent Gateway - 智能体工作流框架设计文档

> **版本**: 1.0.0
> **创建日期**: 2026-03-30
> **状态**: 设计阶段

## 1. 概述

### 1.1 背景

基于 Claude Code CLI 构建一个轻量、可扩展的智能体工作流框架，支持：

- 多渠道接入（Discord、微信、Slack 等）
- 会话隔离与持久化
- 灵活配置（模型、权限、工作目录）
- 自动化触发（定时任务、事件触发）
- 完整的 Claude Code 能力（Skills、Hooks、MCP、工具调用）

### 1.2 设计原则

1. **不重复造轮子** - 充分利用 Claude Code 已有能力
2. **简单可控** - 预估代码量 3000-5000 行
3. **可扩展** - 通过 Adapter 接口支持多渠道
4. **实用主义** - 只实现真正有用的功能

### 1.3 与 OpenClaw 对比

| 功能 | OpenClaw | Agent Gateway |
|------|----------|---------------|
| 多渠道接入 | 复杂的插件系统 | 简单的 Adapter 接口 |
| 定时任务 | 支持 | 支持（Trigger Engine） |
| 事件触发 | 支持 | 支持 |
| 工作流编排 | 复杂的 DAG | 无（保持简单） |
| 记忆系统 | 复杂的记忆管理 | 依赖 Claude Code 原生能力 |
| 代码量 | 几十万行 | 3000-5000 行 |

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Agent Gateway                                   │
│                     (统一入口，协议转换)                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐         ┌───────────────┐         ┌───────────────┐
│ Channel       │         │ Trigger       │         │ Command       │
│ Adapters      │         │ Engine        │         │ Handler       │
│ (Discord/...) │         │ (定时/事件)   │         │ (斜杠命令)    │
└───────────────┘         └───────────────┘         └───────────────┘
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       Session Orchestrator                               │
│  - 会话生命周期管理                                                       │
│  - 会话配置分发（模型、权限、working directory）                          │
│  - 会话持久化与恢复                                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       Agent Worker Pool                                  │
│  - Claude Code 实例管理                                                  │
│  - 按需创建/销毁/复用                                                     │
│  - 资源隔离                                                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       Claude Code CLI                                    │
│  claude -p "消息" --resume <uuid> --model <model> --settings <config>    │
│                                                                         │
│  能力支持:                                                               │
│  ✅ Skills (斜杠命令)                                                   │
│  ✅ Hooks (PreToolUse/PostToolUse/Stop)                                 │
│  ✅ MCP (Model Context Protocol)                                        │
│  ✅ 工具调用 (Bash/Read/Edit/Write/Glob/Grep...)                         │
│  ✅ 会话上下文 (--resume/--session-id)                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件说明

| 组件 | 职责 | 依赖 |
|------|------|------|
| **Agent Gateway** | 统一入口，协议转换，路由分发 | 所有组件 |
| **Channel Adapters** | 接入各消息渠道，统一消息格式 | Gateway |
| **Trigger Engine** | 定时任务、事件触发、延迟任务 | Orchestrator |
| **Command Handler** | 斜杠命令解析与执行 | Orchestrator |
| **Session Orchestrator** | 会话生命周期管理、配置分发 | Worker Pool |
| **Agent Worker Pool** | Claude Code 实例管理 | Claude CLI |

---

## 3. 核心抽象层设计

### 3.1 统一消息格式

```typescript
/**
 * 跨渠道统一消息结构
 */
interface AgentMessage {
  id: string;                  // 消息唯一 ID
  channelId: string;           // 渠道内的频道 ID
  channelType: string;         // 渠道类型: "discord" | "wechat" | "slack" | ...
  userId: string;              // 发送者 ID
  content: string;             // 消息内容
  attachments?: Attachment[];  // 附件列表
  replyTo?: string;            // 回复的消息 ID
  metadata?: Record<string, any>;  // 渠道特定元数据
  timestamp: Date;             // 消息时间
}

interface Attachment {
  id: string;
  name: string;
  type: string;                // MIME type
  size: number;
  url: string;
  localPath?: string;          // 下载后的本地路径
}
```

### 3.2 统一响应格式

```typescript
/**
 * 跨渠道统一响应结构
 */
interface AgentResponse {
  content: string;             // 响应内容
  attachments?: Attachment[];  // 附件列表
  replyTo?: string;            // 回复的消息 ID
  metadata?: Record<string, any>;  // 渠道特定元数据
}
```

### 3.3 Channel Adapter 接口

```typescript
/**
 * 渠道适配器接口 - 所有渠道必须实现此接口
 */
interface ChannelAdapter {
  // 基本信息
  readonly name: string;       // 适配器名称
  readonly type: string;       // 渠道类型标识

  // 生命周期
  initialize(config: AdapterConfig): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // 消息处理
  onMessage(callback: (msg: AgentMessage) => void): void;
  send(channelId: string, response: AgentResponse): Promise<MessageResult>;

  // 可选功能
  typing?(channelId: string): Promise<void>;      // 显示"正在输入"
  react?(messageId: string, emoji: string): Promise<void>;  // 添加反应
  edit?(messageId: string, response: AgentResponse): Promise<void>;  // 编辑消息
}

interface AdapterConfig {
  enabled: boolean;
  [key: string]: any;          // 渠道特定配置
}

interface MessageResult {
  messageId: string;
  success: boolean;
  error?: string;
}
```

### 3.4 入站回合聚合（Inbound Turn Aggregation）

> 这部分描述的是统一消息入口的设计原则，不是某个渠道的临时补丁。

#### 3.4.1 背景

在真实聊天渠道里，用户的一次意图不一定以“一条完整消息”到达系统。

- 文本和图片可能被拆成两条独立消息
- 附件上传通常比纯文本慢
- 不同渠道的 SDK 或长轮询接口可能按不同顺序交付消息
- 如果 Gateway 在第一条消息到达时就立刻调用 Claude Code，模型看到的上下文可能是不完整的

典型表现是：

- 先收到文本，Claude 先回答文本
- 几秒后才收到图片，Claude 再补做第二轮
- 最终结果虽然可能正确，但交互体验不接近原生 Claude 的“图文一起提交”

因此，Gateway 需要承担一个统一职责：

**先把同一轮用户意图尽量聚合，再调用一次 Claude。**

#### 3.4.2 为什么放在 Gateway 层

这项能力放在 Gateway，而不是分散在每个 Adapter，原因是：

1. 它解决的是“统一入口的消息时序问题”，不是某个渠道专属业务。
2. 渠道适配器的职责应该是“尽快、尽原始地上报消息”，而不是自行决定如何拼接用户意图。
3. 如果每个渠道各写一套文本/附件重排逻辑，后续很难保证行为一致。
4. Claude Code 的调用时机属于编排层决策，天然应由 Gateway 控制。

对应的分层边界是：

- **Adapter**：负责把原始消息尽快变成 `AgentMessage`
- **Gateway**：负责聚合、排队、调用 Claude
- **Orchestrator / Worker**：负责会话执行，不关心这一轮消息是如何被聚合出来的

#### 3.4.3 Turn 的定义

Gateway 不再把每条入站消息直接视为一次 Claude 调用，而是先把它们归入一个 turn。

当前 turn 的主键是：

```typescript
turnKey = `${channelType}:${channelId}:${userId}`
```

含义：

- 同一频道
- 同一用户
- 在一个尚未 flush 的缓冲窗口内

都会被视为“同一轮用户输入”。

这样设计有两个直接收益：

1. 同一用户连续发文本、图片、补充说明时，可以被合并到同一轮。
2. 不同用户在同一频道发消息时，不会互相污染 turn。

#### 3.4.4 时序模型

每个 turn 同时维护两个计时器：

- `quietWindowMs`
- `maxWindowMs`

语义如下：

- `quietWindowMs`：从“最后一条消息进入 turn”开始计时，只要安静满这个时间，就立即 flush。
- `maxWindowMs`：从“turn 第一条消息进入”开始计时，无论期间是否持续有新消息，达到上限必须 flush。

默认配置：

```json
{
  "aggregation": {
    "quietWindowMs": 5000,
    "maxWindowMs": 30000
  }
}
```

它们解决的是两个不同问题：

- `quietWindowMs` 解决“给文本和附件一点时间汇合”
- `maxWindowMs` 解决“不能为了等后续消息而无限阻塞”

因此实际优先级是：

1. 如果 turn 安静了 `quietWindowMs`，立刻调用 Claude
2. 如果 turn 一直有新消息，直到超过 `maxWindowMs`，强制调用 Claude

#### 3.4.5 为什么不是固定等待 30 秒

这里故意没有采用“每条消息固定等 30 秒再发”的策略。

原因是那样会带来明显的首响延迟，而且会把大多数普通纯文本消息都拖慢。

`quiet window + max window` 的组合，本质上是在两件事之间做平衡：

- 尽量把同一轮图文聚齐
- 尽量避免不必要的等待

所以在正常场景里，大多数普通消息只会多等待一个较短的安静窗口，而不是每次都等到最大上限。

#### 3.4.6 Flush 后的消息如何处理

一旦 turn 被 flush，Claude 调用就已经开始。

此时后续再到达的新消息，不会再被塞回已经发出的那次调用里，而是会进入下一个 turn。

这是一个刻意保留的约束：

- Gateway 可以控制“调用前聚合”
- 但不会试图做“调用后撤回并重组”

这样可以保证实现简单、行为稳定，也不会把 Claude 会话状态机变得过于复杂。

#### 3.4.7 消息合并规则

同一 turn 内的原始消息会按 `timestamp` 排序后再合并。

合并结果遵循以下规则：

- 文本内容按时间顺序拼接
- 附件按时间顺序展开
- 最后一条消息的基础元数据作为主消息壳
- `metadata.coalescedMessageIds` 记录被合并的原始消息 ID
- `metadata.coalescedCount` 记录本轮合并的消息数

这样做的目标不是“保留原始渠道格式”，而是给 Claude 一个更完整、更接近用户真实输入顺序的统一 prompt。

#### 3.4.8 命令消息为什么直通

像 `/new`、`/status` 这类命令不参与 turn 聚合，而是直接执行。

理由是：

- 命令语义明确，不依赖后续附件补全
- 用户对命令的预期是即时响应
- 命令若被延迟聚合，会让控制面和对话面混在一起

因此命令消息会：

1. 先清掉同频道尚未 flush 的 turn
2. 再直接进入命令执行路径

#### 3.4.9 与频道串行队列的关系

Gateway 还有一层频道串行队列，用来保证同一频道不会并发执行多个 Claude 调用。

两者职责不同：

- **Turn Aggregation**：决定“哪些消息应合并成一次调用”
- **Channel Queue**：决定“这些调用按什么顺序执行”

这两个机制叠加后，可以同时满足：

- 同一轮消息尽量一次性进入 Claude
- 同一频道内的多轮请求保持顺序一致

#### 3.4.10 适配器为什么仍然要求“尽快上报”

虽然聚合逻辑放在 Gateway，但 Adapter 仍然必须遵守一个关键约束：

**不能等待 Gateway 完成整轮处理后，才继续读取后续入站消息。**

原因很简单：

- Gateway 的窗口是“为消息汇合创造机会”
- 如果 Adapter 自己把后续消息阻塞住，Gateway 再长的窗口也没有意义

因此当前设计要求 Adapter：

- 尽快拉取消息
- 尽快完成附件提取
- 尽快异步投递到 Gateway
- 不把 Gateway 回调当作轮询循环的阻塞点

这不是把聚合逻辑下放到 Adapter，而是保证 Gateway 真的有机会看到完整的入站序列。

#### 3.4.11 这套设计解决什么，不解决什么

它主要解决：

- 文本和附件存在轻微到中度抖动时，避免拆成两轮 Claude 调用
- 不同渠道共享同一套统一消息聚合策略
- 在不显著放大延迟的前提下，提升图文混合输入的一致性

它不解决：

- 渠道上游长时间不交付附件
- 已经发出的 Claude 调用被“回滚重做”
- 跨用户、跨频道的意图合并

换句话说，Gateway 聚合解决的是“编排层的时序问题”，不是“渠道基础设施的全部不确定性”。

#### 3.4.12 当前实现映射

当前代码中的主要落点如下：

- [core/gateway.ts](/Users/zhoudi/Projects/GitHub/ClaudeAssistant-migrate-weixin/core/gateway.ts)
  turn 建模、`quietWindowMs`、`maxWindowMs`、flush 和消息合并逻辑
- [config/gateway-config.ts](/Users/zhoudi/Projects/GitHub/ClaudeAssistant-migrate-weixin/config/gateway-config.ts)
  聚合配置解析
- [settings.json](/Users/zhoudi/Projects/GitHub/ClaudeAssistant-migrate-weixin/settings.json)
  当前默认聚合参数
- [adapters/weixin/index.ts](/Users/zhoudi/Projects/GitHub/ClaudeAssistant-migrate-weixin/adapters/weixin/index.ts)
  适配器异步投递入站消息，避免阻塞后续轮询

从架构角度看，这套方案的核心思想可以概括成一句话：

**Adapter 负责尽快把消息送进来，Gateway 负责把一轮消息尽量攒完整，再调用 Claude。**

### 3.5 Session Profile（会话配置）

```typescript
/**
 * 会话配置 - 每个会话可以独立配置
 */
interface SessionProfile {
  // 基本信息
  id: string;                  // 会话 UUID
  channelId: string;           // 关联的频道 ID
  channelType: string;         // 渠道类型

  // Claude Code 配置
  model: 'sonnet' | 'opus' | 'haiku' | string;  // 模型选择
  workingDirectory: string;    // 工作目录
  settingsPath?: string;       // 自定义 settings 文件路径
  customSystemPrompt?: string; // 自定义系统提示

  // 权限配置
  permissionMode: 'default' | 'auto' | 'plan' | 'bypassPermissions';
  allowedTools?: string[];     // 允许的工具列表
  deniedTools?: string[];      // 禁用的工具列表

  // Profile 模板
  profile?: string;            // 使用的配置模板名称

  // 生命周期
  createdAt: Date;
  lastActiveAt: Date;
  status: 'active' | 'idle' | 'archived';

  // 统计
  messageCount: number;
  totalTokens?: number;
}
```

### 3.6 Session Orchestrator 接口

```typescript
/**
 * 会话编排器 - 管理会话生命周期和执行
 */
interface SessionOrchestrator {
  // 会话管理
  getOrCreateSession(channelId: string, channelType: string): SessionProfile;
  getSession(sessionId: string): SessionProfile | null;
  getSessionByChannel(channelId: string, channelType: string): SessionProfile | null;
  archiveSession(sessionId: string): void;
  listSessions(filter?: SessionFilter): SessionProfile[];

  // 配置管理
  updateSessionConfig(sessionId: string, config: Partial<SessionProfile>): void;
  loadProfile(profileName: string): Partial<SessionProfile>;

  // 执行
  execute(sessionId: string, message: AgentMessage): Promise<AgentResponse>;

  // 事件
  onSessionCreated?: (session: SessionProfile) => void;
  onSessionArchived?: (session: SessionProfile) => void;
}
```

---

## 4. Trigger Engine 设计

### 4.1 触发器类型

```typescript
type TriggerType = 'delay' | 'schedule' | 'event';

interface Trigger {
  // 基本信息
  id: string;
  type: TriggerType;

  // 关联会话
  sessionId: string;
  channelId: string;
  channelType: string;

  // 触发配置
  config: DelayConfig | ScheduleConfig | EventConfig;

  // 执行任务
  task: TriggerTask;

  // 元数据
  createdAt: Date;
  createdBy: string;           // 创建者用户 ID
  nextRunAt?: Date;
  lastRunAt?: Date;
  status: TriggerStatus;
  runCount: number;
  maxRuns?: number;            // 最大执行次数（可选）
}

type TriggerStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

interface TriggerTask {
  prompt: string;              // 发送给 Claude 的提示
  profile?: string;            // 使用的配置模板
  model?: string;              // 覆盖模型
}
```

### 4.2 触发器配置

```typescript
/**
 * 延迟触发配置
 */
interface DelayConfig {
  delayMs: number;             // 延迟毫秒数
}

/**
 * 定时触发配置
 */
interface ScheduleConfig {
  cron: string;                // Cron 表达式
  timezone?: string;           // 时区，默认系统时区
  startDate?: Date;            // 开始日期
  endDate?: Date;              // 结束日期
}

/**
 * 事件触发配置
 */
interface EventConfig {
  eventType: string;           // 事件类型
  condition?: string;          // 触发条件（JSONPath 或简单表达式）
  webhookPath?: string;        // Webhook 路径（自动生成或自定义）
}
```

### 4.3 Trigger Engine 接口

```typescript
/**
 * 触发器引擎接口
 */
interface TriggerEngine {
  // 触发器管理
  createTrigger(trigger: Omit<Trigger, 'id' | 'createdAt' | 'status' | 'runCount'>): Trigger;
  getTrigger(id: string): Trigger | null;
  cancelTrigger(id: string): void;
  pauseTrigger(id: string): void;
  resumeTrigger(id: string): void;
  listTriggers(filter?: TriggerFilter): Trigger[];

  // 引擎生命周期
  start(): void;
  stop(): void;

  // 事件
  onTriggerExecuted?: (trigger: Trigger, result: AgentResponse) => void;
  onTriggerFailed?: (trigger: Trigger, error: Error) => void;
}
```

### 4.4 预定义事件类型

| 事件类型 | 说明 | 触发条件示例 |
|---------|------|-------------|
| `webhook` | 通用 Webhook | 外部服务调用 |
| `ci.failed` | CI 构建失败 | GitHub Actions 失败 |
| `pr.created` | PR 创建 | 新 PR 通知 |
| `issue.assigned` | Issue 分配 | 被分配 Issue |
| `file.changed` | 文件变更 | 监控文件变化 |

---

## 5. Command Handler 设计

### 5.1 内置命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `/model <name>` | 切换模型 | `/model opus` |
| `/cd <path>` | 切换工作目录 | `/cd ~/projects/myapp` |
| `/profile <name>` | 加载配置模板 | `/profile code-review` |
| `/triggers` | 列出触发器 | `/triggers` |
| `/trigger cancel <id>` | 取消触发器 | `/trigger cancel abc123` |
| `/help` | 显示帮助 | `/help` |
| `/status` | 显示会话状态 | `/status` |

### 5.2 命令处理接口

```typescript
interface CommandHandler {
  register(command: CommandDefinition): void;
  execute(commandName: string, args: string[], context: CommandContext): Promise<CommandResult>;
  list(): CommandDefinition[];
}

interface CommandDefinition {
  name: string;
  description: string;
  usage: string;
  aliases?: string[];
  handler: (args: string[], context: CommandContext) => Promise<CommandResult>;
}

interface CommandContext {
  session: SessionProfile;
  message: AgentMessage;
  orchestrator: SessionOrchestrator;
  triggerEngine: TriggerEngine;
}

interface CommandResult {
  success: boolean;
  message?: string;
  data?: any;
}
```

---

## 6. 文件结构

```
agent-gateway/
├── src/
│   ├── index.ts                    # 应用入口
│   │
│   ├── core/                       # 核心抽象层
│   │   ├── types.ts                # 统一类型定义
│   │   ├── adapter.ts              # ChannelAdapter 接口
│   │   ├── orchestrator.ts         # SessionOrchestrator 实现
│   │   ├── worker.ts               # Claude Code Worker
│   │   ├── profile-manager.ts      # 配置模板管理
│   │   └── gateway.ts              # Gateway 主类
│   │
│   ├── adapters/                   # 渠道适配器
│   │   ├── index.ts                # 适配器注册
│   │   ├── discord/
│   │   │   ├── index.ts            # Discord 适配器
│   │   │   ├── types.ts            # Discord 特定类型
│   │   │   └── message-formatter.ts
│   │   ├── wechat/                 # 微信适配器（未来）
│   │   ├── slack/                  # Slack 适配器（未来）
│   │   └── telegram/               # Telegram 适配器（未来）
│   │
│   ├── trigger/                    # 触发器系统
│   │   ├── index.ts                # Trigger Engine 主类
│   │   ├── types.ts                # 触发器类型定义
│   │   ├── delay-handler.ts        # 延迟任务处理
│   │   ├── schedule-handler.ts     # 定时任务处理（Cron）
│   │   ├── event-handler.ts        # 事件触发处理
│   │   └── store.ts                # 触发器持久化
│   │
│   ├── commands/                   # 命令处理
│   │   ├── index.ts                # Command Handler
│   │   ├──                # 内置命令
│   │   │   ├── model.ts
│   │   │   ├── cd.ts
│   │   │   ├── profile.ts
│   │   │   ├── triggers.ts
│   │   │   ├── help.ts
│   │   │   └── status.ts
│   │   └── types.ts
│   │
│   └── utils/                      # 工具函数
│       ├── logger.ts
│       ├── uuid.ts
│       └── formatter.ts
│
├── config/                         # 配置文件
│   ├── gateway.json                # Gateway 主配置
│   └── adapters/                   # 各适配器配置
│       └── discord.json
│
├── profiles/                       # 会话配置模板
│   ├── default.json                # 默认配置
│   ├── code-review.json            # 代码审查
│   ├── research.json               # 研究助手
│   └── writing.json                # 写作助手
│
├── data/                           # 运行时数据
│   ├── sessions/                   # 会话数据
│   │   └── <channel-type>/
│   │       └── <channel-id>.json
│   └── triggers/                   # 触发器数据
│       ├── delays/
│       ├── schedules/
│       └── events/
│
├── .claude/                        # Claude Code 配置（示例）
│   ├── settings.local.json         # Hooks、权限等
│   └── CLAUDE.md                   # 项目指令
│
├── docs/                           # 文档
│   ├── architecture.md             # 架构设计（本文档）
│   ├── adapter-development.md      # 适配器开发指南
│   └── configuration.md            # 配置说明
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## 7. 配置文件格式

### 7.1 gateway.json

```json
{
  "name": "agent-gateway",
  "version": "1.0.0",

  "defaults": {
    "model": "sonnet",
    "permissionMode": "auto",
    "workingDirectory": "~"
  },

  "limits": {
    "maxConcurrentSessions": 10,
    "sessionTimeout": 3600000,
    "maxTriggersPerSession": 50
  },

  "enabledAdapters": ["discord"],

  "logging": {
    "level": "info",
    "file": "logs/gateway.log"
  }
}
```

### 7.2 adapters/discord.json

```json
{
  "enabled": true,
  "token": "${DISCORD_BOT_TOKEN}",

  "accessControl": {
    "mode": "allowlist",
    "allowedGuilds": [],
    "allowedChannels": [],
    "allowedUsers": []
  },

  "features": {
    "typingIndicator": true,
    "reactions": true,
    "threadSupport": true
  },

  "messageLimits": {
    "maxLength": 2000,
    "chunkMode": "paragraph"
  }
}
```

### 7.3 profiles/code-review.json

```json
{
  "name": "code-review",
  "description": "代码审查专用配置",

  "model": "opus",
  "permissionMode": "auto",

  "allowedTools": [
    "Read",
    "Glob",
    "Grep",
    "Bash(git:*)",
    "Bash(npm:*)",
    "Edit"
  ],

  "customSystemPrompt": "你是一个专业的代码审查助手。你的职责是:\n1. 发现潜在的 bug 和安全问题\n2. 检查代码风格和最佳实践\n3. 提出改进建议\n\n审查时请保持客观和专业。"
}
```

---

## 8. 实现优先级

### Phase 1: 核心框架 (MVP)

| 优先级 | 功能 | 复杂度 | 预估工作量 |
|--------|------|--------|-----------|
| P0 | 项目初始化、基础结构 | 低 | 0.5 天 |
| P0 | Core 类型定义 | 低 | 0.5 天 |
| P0 | Session Orchestrator | 中 | 1 天 |
| P0 | Claude Code Executor | 低 | 0.5 天 |
| P0 | Discord Adapter | 中 | 1 天 |
| P0 | 基础命令处理 | 低 | 0.5 天 |

**MVP 总计：约 4 天**

### Phase 2: 触发器系统

| 优先级 | 功能 | 复杂度 | 预估工作量 |
|--------|------|--------|-----------|
| P1 | Delay Trigger | 低 | 0.5 天 |
| P1 | Schedule Trigger (Cron) | 中 | 1 天 |
| P1 | 触发器管理命令 | 低 | 0.5 天 |

**Phase 2 总计：约 2 天**

### Phase 3: 扩展能力

| 优先级 | 功能 | 复杂度 | 预估工作量 |
|--------|------|--------|-----------|
| P2 | Event Trigger (Webhook) | 中 | 1 天 |
| P2 | Profile 模板系统 | 低 | 0.5 天 |
| P2 | 更多内置命令 | 低 | 0.5 天 |

**Phase 3 总计：约 2 天**

### Phase 4: 多渠道扩展

| 优先级 | 功能 | 复杂度 | 预估工作量 |
|--------|------|--------|-----------|
| P3 | 微信 Adapter | 中 | 1-2 天 |
| P3 | Slack Adapter | 低 | 1 天 |
| P3 | Telegram Adapter | 低 | 1 天 |

---

## 9. 扩展指南

### 9.1 添加新渠道适配器

1. 在 `src/adapters/` 下创建新目录
2. 实现 `ChannelAdapter` 接口
3. 在 `src/adapters/index.ts` 注册适配器
4. 在 `config/adapters/` 添加配置文件

### 9.2 添加新命令

1. 在 `src/commands/` 创建命令文件
2. 实现 `CommandDefinition` 接口
3. 在 `src/commands/index.ts` 注册命令

### 9.3 添加新的触发器类型

1. 在 `src/trigger/types.ts` 添加类型定义
2. 在 `src/trigger/` 创建对应的 handler
3. 在 `TriggerEngine` 中注册 handler

---

## 10. 技术选型

| 领域 | 技术选择 | 理由 |
|------|---------|------|
| 运行时 | Node.js 18+ | Claude Code 原生支持 |
| 语言 | TypeScript | 类型安全、开发体验 |
| Discord SDK | discord.js | 成熟稳定 |
| 定时任务 | node-cron | Cron 表达式支持 |
| 配置管理 | JSON + 环境变量 | 简单直接 |
| 日志 | pino | 轻量高性能 |
| 进程管理 | pm2（可选） | 生产环境部署 |

---

## 11. 部署方案

### 开发环境
```bash
npm run dev
```

### 生产环境
```bash
npm run build
npm start

# 或使用 pm2
pm2 start dist/index.js --name agent-gateway
```

### Docker（可选）
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
CMD ["node", "dist/index.js"]
```

---

## 12. 后续规划

### 短期 (1-2 周)
- [ ] 完成 MVP
- [ ] Discord 渠道稳定运行
- [ ] 基础触发器功能

### 中期 (1-2 月)
- [ ] 事件触发器
- [ ] 更多配置模板
- [ ] Webhook 支持

### 长期 (3+ 月)
- [ ] 多渠道扩展（微信、Slack）
- [ ] Web UI 管理界面
- [ ] 多租户支持

---

## 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| 1.0.0 | 2026-03-30 | 初始设计文档 |
