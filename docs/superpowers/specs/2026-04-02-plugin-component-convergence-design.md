# Plugin Component Convergence Design

## Goal

把当前仓库从“正在插件化的 Agent Gateway 应用”收敛成“可按 Claude Code Plugin 目录结构安装和使用的完整组件”，同时删除已经偏离目标、没有继续维护价值的历史债务。

## Background

当前仓库已经完成一次大重构：`src/` 被扁平到根目录，并且开始引入 `.claude-plugin/`、`skills/`、`hooks/`、`agents/` 等插件化目录。问题在于，运行模型和文档仍然主要围绕独立网关服务展开，导致目录外形和实际职责不一致。

这种不一致已经带来两个直接问题：

- 结构上看像插件，但运行时仍默认启动 Discord 网关服务，安装和复用边界不清晰。
- 旧时代的配置、文档、命名和查询逻辑还在，已经产生测试失败和维护误导。

## Non-Goals

- 不继续扩展新的消息平台适配器。
- 不在这次收敛中设计新的大型功能。
- 不为兼容旧 `src/` 结构继续保留冗余桥接层。

## Target Shape

仓库以插件组件为中心组织，核心目录保持如下语义：

- `.claude-plugin/`：插件元数据和安装入口信息。
- `skills/`：可直接被 Claude Code 使用的技能定义和配套脚本。
- `agents/`：可复用的子代理定义。
- `hooks/`：插件随附的钩子配置。
- `commands/`：仅保留仍有现实用途的兼容命令；如果没有实际消费方，可逐步清退。
- `scripts/`：供 hooks、skills 或运维流程调用的独立脚本。
- `sessions/`：会话工作目录、上传目录和记忆文件。
- `docs/`、`tests/`：围绕插件组件而不是独立网关应用来组织。

## Architecture Decision

选择单一方向收敛：仓库身份统一为插件组件，而不是继续同时维护“独立网关服务”和“插件组件”两套心智模型。

保留的内容必须满足以下至少一条：

- 直接服务于插件安装或运行。
- 被现有 hooks、skills、scripts 或测试真实引用。
- 是当前目录结构下的核心领域模型，继续演进仍有价值。

删除的内容满足以下任一条件即可：

- 仅为了兼容旧结构存在。
- 已无引用且没有明确的近期用途。
- 文档、命名或配置已经与目标形态冲突。

## Runtime Model

运行时以插件配套能力为中心，而不是默认以一个长期运行的 Discord 服务为中心。

这意味着：

- `.claude-plugin/plugin.json` 应成为仓库身份的权威元数据来源。
- `settings.json`、`hooks/hooks.json`、`agents/`、`skills/` 需要和插件目录语义对齐。
- 如果 `index.ts` 继续存在，它必须被定义为插件配套运行入口，而不是误导性的“唯一主程序”。
- 任何仍保留的 gateway 能力，都应被明确标注为插件内部能力或可选运行组件，而不是仓库的默认身份。

## Data and Session Model

`sessions/<sessionId>/` 目录继续作为会话工作单元，保留以下约定：

- `session.json`：会话状态。
- `workspace/`：工作目录。
- `uploads/`：上传目录。
- `CLAUDE.md`：会话记忆。

会话恢复必须满足单一事实来源：

- 同一频道只能有一个当前有效 session。
- 归档 session 不能再被频道查询当作活跃 session 返回。
- 损坏恢复后新建的 replacement session 必须稳定地成为频道当前会话。

## Hook and Skill Integration

hook 配置需要收敛到插件目录约定，避免当前“`.claude/settings.json` 里真生效、`hooks/hooks.json` 里只是占位”的分裂状态。

设计要求：

- `hooks/hooks.json` 成为插件内可交付的 hook 配置来源。
- `.claude/settings.json` 只作为本地开发调试辅助，不再承担唯一真实配置职责。
- `skills/file-return/` 继续保留，并作为插件化收敛后的基准 skill。

## Documentation Strategy

所有对外说明统一改写为插件组件语义，至少包括：

- 仓库名称和描述。
- 安装和使用说明。
- 配置文件位置。
- agents、skills、hooks、sessions 的职责。

旧文档中出现的以下内容应被修正或删除：

- 已删除的 `config/gateway.json`
- 已迁移的 `profiles/`
- 仍然假设 `src/` 目录存在的描述

## Testing Strategy

本次收敛以“先修真实回归，再做结构清理”为顺序：

1. 先为 session 恢复/频道查询语义提供稳定测试保护。
2. 再做目录、配置、文档和身份收敛。
3. 最后删除无引用代码，并运行完整测试验证没有引入回归。

验收标准：

- `npm run build` 通过。
- `npm test` 全绿。
- 关键文档和元数据不再引用旧路径或旧身份。
- hooks/skills 的配置路径一致，不再存在双事实来源。

## Implementation Outline

实施分为四类工作：

### 1. Correctness Fixes

- 修复 session archive/replacement 查询不稳定的问题。
- 保证频道查询只返回当前活跃 session。

### 2. Plugin Identity Convergence

- 收敛 `package.json`、`README.md`、`.claude-plugin/plugin.json`、`settings.json` 的命名和描述。
- 明确入口文件和配置文件的职责。

### 3. Hook and Config Cleanup

- 让 `hooks/hooks.json` 承载真实插件 hook 配置。
- 清理仅用于旧本地开发路径的重复配置。

### 4. Debt Removal

- 删除未引用模块、空目录、失效路径和已经废弃的兼容内容。
- 清理文档中的历史命名和结构描述。

## Risks

- 如果一次性删除过多运行时代码，可能误删仍被 tests 或 hooks 隐式依赖的模块。
- hook 配置收敛时，如果没有保留开发态入口，可能影响本地调试体验。
- 文档和元数据更新不完整，会让仓库再次出现“结构像插件、说明像服务”的分裂状态。

## Mitigations

- 通过搜索引用和完整测试来决定删除范围。
- 保留最小必要的本地开发配置，但将其降级为辅助角色。
- 每次删除后立即运行相关测试，最后跑全量验证。
