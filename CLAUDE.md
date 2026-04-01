# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Gateway MVP - 将 Discord 等消息平台连接到 Claude Code CLI 的服务。每个频道保持一个独立会话，支持模型切换、工作目录变更、配置模板加载等。

## Commands

```bash
npm run dev      # 开发模式 (tsx watch)
npm run build    # TypeScript 编译
npm start        # 运行编译后的代码
npm test         # 运行测试 (vitest)
npm run test:watch  # 监听模式测试
```

## Architecture

核心组件层次：

```
AgentGateway (入口层)
    ├── ChannelAdapter (渠道适配器，如 DiscordAdapter)
    ├── CommandHandler (斜杠命令解析)
    └── SessionOrchestrator (会话编排)
            ├── SessionStore (会话持久化)
            ├── ProfileManager (配置模板)
            └── ClaudeCodeWorker (CLI 执行器)
```

### 关键模块

- **src/core/gateway.ts** - 统一入口，处理消息队列和错误恢复
- **src/core/orchestrator.ts** - 会话生命周期管理，配置分发
- **src/core/worker.ts** - 调用 `claude` CLI，构造命令参数
- **src/core/adapter.ts** - `ChannelAdapter` 接口定义
- **src/core/types.ts** - 核心类型 (`AgentMessage`, `SessionProfile` 等)

### 内置命令

位于 `src/commands/built-in/`:
- `/model <name>` - 切换模型
- `/cd <path>` - 叇换工作目录
- `/profile <name>` - 加载配置模板
- `/status` - 显示会话状态
- `/help` - 命令帮助

## Configuration

- `config/gateway.json` - 默认模型、权限模式、工作目录
- `config/adapters/discord.json` - Discord 配置（token 从环境变量读取）
- `profiles/*.json` - 会话配置模板（model、allowedTools、customSystemPrompt 等）

会话数据存储在 `data/sessions/<channelType>/<channelId>.json`

## Testing

测试位于 `tests/` 目录，结构与 `src/` 对应：
```
tests/
├── adapters/discord/
├── commands/
├── config/
└── core/
```

运行单个测试文件：
```bash
npx vitest run tests/core/orchestrator.test.ts
```

## Environment

必需环境变量（见 `.env.example`）：
- `DISCORD_BOT_TOKEN` - Discord 机器人 token

运行要求：
- Node.js 18.18+
- `claude` CLI 已安装并认证
- Discord bot 启用 message-content intent