# Discord 半自动集成测试指南

## 目标

这份文档用于验证 Discord attachment bridge MVP 的关键链路：

- 入站附件会被下载到网关 inbox，并在需要时复制到真实 session working directory
- Claude 能在同一轮对话里看到并使用该附件
- 出站 `[[file:...]]` 只在单独一行出现时才会被识别为附件
- 非法路径会被阻止，并在回复正文里显示可见错误

## 测试前提

1. `.env` 中存在有效的 `DISCORD_BOT_TOKEN`
2. bot 已加入目标 Discord 服务器
3. bot 对目标频道有读取、发送、读取历史、创建线程的权限
4. 本地依赖已经安装：

```bash
npm install
```

5. 网关已启动，且 Discord 主频道可正常进入 Claude 会话

## 场景 0：验证 Discord attachment bridge MVP

### 0.1 入站附件下载，Claude 能看到附件

在主频道发送一条带图片附件的消息，例如附上一张本地图片，并写一句提示：

```text
请先描述这张图片里有什么。
```

预期结果：

- Discord 附件会被下载到 `.claude-gateway/inbox/<MAIN_CHANNEL_ID>/...`
- 如果当前 session 的 working directory 不在网关工作目录内，网关会先把附件复制到真实 session working directory
- Claude 的回复会基于这张图片内容，而不是把它当成普通文本

建议检查：

```bash
find .claude-gateway/inbox -type f | sort
```

### 0.2 出站 `[[file:...]]` 正常发送附件

让 Claude 在回复里单独一行输出下面这个 marker：

```text
[[file:docs/assets/04-multi-agent.png]]
```

推荐提示词：

```text
请在回复末尾单独一行输出 [[file:docs/assets/04-multi-agent.png]]，不要把它放进代码块，也不要和其他文字写在同一行。
```

预期结果：

- `[[file:docs/assets/04-multi-agent.png]]` 会被当成出站附件 marker
- Discord 最终消息会带上对应文件
- marker 本身不会以原样保留在正文里

注意：

- 只有“单独一行”的 marker 才会被识别
- 如果 marker 混在 prose 里，或放进 fenced code block 里，不会被当成附件

### 0.3 阻止 unsafe path

让 Claude 输出下面这个 marker：

```text
[[file:../../secret.txt]]
```

预期结果：

- 该 marker 会被拒绝
- 最终回复正文里会出现可见错误说明，类似：

```text
Could not attach ../../secret.txt: Path escapes the working directory.
```

- 不会发送任何对应附件

## 执行建议

按这个顺序测最稳：

1. 先做 0.1，确认入站附件能被 Claude 读到
2. 再做 0.2，确认合法出站文件能被 Discord 发送
3. 最后做 0.3，确认越界路径会被阻止

如果其中一步失败，直接记录：

- 发送的 Discord 消息内容
- 相关附件文件名
- 网关日志
- `data/sessions/discord/*.json` 的变化

