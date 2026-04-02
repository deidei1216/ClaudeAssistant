# File Return Stop Hook E2E 验证

## 目标

这份文档用于验证原生 Claude Code `Stop` hook 的文件回传链路已经真正跑通。

脚本会自动完成以下步骤：

- 创建隔离临时工作目录
- 写入 `.claude-gateway/memory/recent-files.json`
- 准备一个可回传的 outbox 文件
- 用真实 `claude --print` 调用当前项目的原生 `Stop` hook
- 断言最终输出包含 `[[file:...]]`

## 前提

1. 本地已经安装依赖：

```bash
npm install
```

2. 本机 `claude` CLI 可用并且已经登录
3. 当前仓库在 `feature/discord-file-memory-auto-return` worktree 下

## 执行命令

```bash
npm run test:e2e:file-return
```

默认会最多重试 3 次。

如果你想保留失败现场目录，可以直接运行脚本：

```bash
npx tsx scripts/e2e/file-return-stop-hook.ts --keep-temp
```

如果你想改重试次数：

```bash
npx tsx scripts/e2e/file-return-stop-hook.ts --attempts 5
```

## 成功结果

成功时命令返回 `0`，并输出类似：

```json
{
  "ok": true,
  "attempt": 1,
  "workingDirectory": "/tmp/...",
  "expectedMarker": "[[file:.claude-gateway/outbox/demo.txt]]",
  "sessionId": "...",
  "numTurns": 4,
  "result": "[[file:.claude-gateway/outbox/demo.txt]]"
}
```

关键判断点：

- `ok` 为 `true`
- `result` 中包含 `[[file:.claude-gateway/outbox/demo.txt]]`

## 失败排查

失败时命令返回非 `0`，并输出类似：

```json
{
  "ok": false,
  "attempts": 3,
  "workingDirectory": "/tmp/...",
  "error": "Expected Claude result to include [[file:...]], got: ..."
}
```

优先检查：

1. `claude` CLI 是否还能正常执行
2. 当前分支里的 [settings.json](/Users/zhoudi/Projects/GitHub/ClaudeAssistant/.worktrees/discord-file-memory-auto-return/.claude/settings.json) 是否仍然注册了 `Stop` hook
3. [file-return-stop.ts](/Users/zhoudi/Projects/GitHub/ClaudeAssistant/.worktrees/discord-file-memory-auto-return/src/hooks/file-return-stop.ts) 是否还能从 stdin 正常读取 hook payload
4. 输出里的 `workingDirectory` 是否保留了临时目录

如果需要看脚本逻辑：

- 脚本入口在 [file-return-stop-hook.ts](/Users/zhoudi/Projects/GitHub/ClaudeAssistant/.worktrees/discord-file-memory-auto-return/scripts/e2e/file-return-stop-hook.ts)
- 轻量测试在 [file-return-stop-hook-script.test.ts](/Users/zhoudi/Projects/GitHub/ClaudeAssistant/.worktrees/discord-file-memory-auto-return/tests/e2e/file-return-stop-hook-script.test.ts)
