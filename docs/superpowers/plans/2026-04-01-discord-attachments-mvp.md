# Discord Attachments MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal, safe bidirectional attachment bridge between Discord and Claude Code CLI so Discord users can send files into a session and Claude can explicitly send workspace files back to Discord with `[[file:relative/path]]`.

**Architecture:** Keep the current text-first gateway intact and add a narrow attachment protocol. Discord inbound attachments are downloaded into a controlled workspace directory and injected into the Claude prompt as a manifest. Claude outbound file delivery is explicit: the worker parses `[[file:...]]` markers, validates each path against the working directory, and returns attachments for the Discord adapter to upload.

**Tech Stack:** TypeScript, Node.js `fs/path`, built-in `fetch`, `discord.js`, Vitest

---

### Task 1: Add Attachment Utility Module

**Files:**
- Create: `src/core/attachments.ts`
- Test: `tests/core/attachments.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { resolveOutboundAttachment, extractFileMarkers, sanitizeAttachmentName } from '../../src/core/attachments';

describe('attachments utility', () => {
  it('sanitizes inbound file names', () => {
    expect(sanitizeAttachmentName('../diagram.png')).toBe('diagram.png');
    expect(sanitizeAttachmentName('team plan?.md')).toBe('team-plan-.md');
  });

  it('extracts file markers from response text', () => {
    const result = extractFileMarkers('Here you go\\n[[file:docs/assets/a.png]]\\n[[file:docs/assets/b.png]]');

    expect(result.content).toBe('Here you go');
    expect(result.markers).toEqual(['docs/assets/a.png', 'docs/assets/b.png']);
  });

  it('resolves a safe outbound attachment path inside the working directory', () => {
    const result = resolveOutboundAttachment('/tmp/project', 'docs/assets/a.png');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relativePath).toBe('docs/assets/a.png');
      expect(result.absolutePath).toBe('/tmp/project/docs/assets/a.png');
    }
  });

  it('rejects outbound traversal outside the working directory', () => {
    const result = resolveOutboundAttachment('/tmp/project', '../../secret.txt');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('outside');
    }
  });

  it('rejects absolute outbound paths', () => {
    const result = resolveOutboundAttachment('/tmp/project', '/etc/passwd');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('relative');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/attachments.test.ts`
Expected: FAIL with module-not-found or missing export errors for `src/core/attachments.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
import { basename, normalize, resolve, sep } from 'node:path';

const FILE_MARKER_PATTERN = /\[\[file:([^\]]+)\]\]/g;

export function sanitizeAttachmentName(name: string): string {
  return basename(name).replace(/[^a-zA-Z0-9._-]/g, '-');
}

export function extractFileMarkers(content: string): { content: string; markers: string[] } {
  const markers = Array.from(content.matchAll(FILE_MARKER_PATTERN), (match) => match[1].trim())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);

  const stripped = content.replace(FILE_MARKER_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
  return { content: stripped, markers };
}

export function resolveOutboundAttachment(
  workingDirectory: string,
  relativePath: string
): { ok: true; relativePath: string; absolutePath: string } | { ok: false; reason: string } {
  if (!relativePath || relativePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relativePath)) {
    return { ok: false, reason: 'Outbound attachment path must be relative.' };
  }

  const normalizedRelativePath = normalize(relativePath);
  const absolutePath = resolve(workingDirectory, normalizedRelativePath);
  const normalizedWorkingDirectory = resolve(workingDirectory);
  const prefix = normalizedWorkingDirectory.endsWith(sep) ? normalizedWorkingDirectory : `${normalizedWorkingDirectory}${sep}`;

  if (absolutePath !== normalizedWorkingDirectory && !absolutePath.startsWith(prefix)) {
    return { ok: false, reason: 'Outbound attachment path resolves outside the working directory.' };
  }

  return {
    ok: true,
    relativePath: normalizedRelativePath.replace(/\\/g, '/'),
    absolutePath
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/attachments.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/attachments.ts tests/core/attachments.test.ts
git commit -m "feat: add attachment path utilities"
```

### Task 2: Map Inbound Discord Attachments Into Gateway Messages

**Files:**
- Modify: `src/adapters/discord/message-formatter.ts`
- Test: `tests/adapters/discord/message-formatter.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { fromDiscordMessage } from '../../../src/adapters/discord/message-formatter';

describe('discord message formatter', () => {
  it('converts Discord attachments into gateway attachments', () => {
    const result = fromDiscordMessage({
      id: 'msg-1',
      channelId: 'channel-1',
      author: { id: 'user-1', bot: false },
      content: 'see attachment',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      attachments: [
        {
          id: 'att-1',
          name: 'diagram.png',
          contentType: 'image/png',
          size: 128,
          url: 'https://cdn.discordapp.com/example.png'
        }
      ]
    });

    expect(result.attachments).toEqual([
      {
        id: 'att-1',
        name: 'diagram.png',
        type: 'image/png',
        size: 128,
        url: 'https://cdn.discordapp.com/example.png'
      }
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/discord/message-formatter.test.ts`
Expected: FAIL because `attachments` is ignored or the input type does not allow it yet

- [ ] **Step 3: Write minimal implementation**

```ts
import type { AgentMessage, Attachment } from '../../core/types';

interface DiscordMessageLike {
  id: string;
  channelId: string;
  author: { id: string; bot: boolean };
  content: string;
  createdAt: Date;
  attachments?: Array<{
    id: string;
    name: string;
    contentType?: string | null;
    size?: number;
    url: string;
  }>;
}

function mapAttachments(attachments: DiscordMessageLike['attachments']): Attachment[] | undefined {
  if (!attachments?.length) {
    return undefined;
  }

  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    type: attachment.contentType ?? 'application/octet-stream',
    size: attachment.size ?? 0,
    url: attachment.url
  }));
}

export function fromDiscordMessage(message: DiscordMessageLike): AgentMessage {
  return {
    id: message.id,
    channelId: message.channelId,
    channelType: 'discord',
    userId: message.author.id,
    content: message.content,
    attachments: mapAttachments(message.attachments),
    timestamp: message.createdAt
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/discord/message-formatter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/discord/message-formatter.ts tests/adapters/discord/message-formatter.test.ts
git commit -m "feat: map Discord attachments into gateway messages"
```

### Task 3: Download Inbound Attachments Into a Controlled Workspace Directory

**Files:**
- Modify: `src/adapters/discord/index.ts`
- Modify: `src/core/attachments.ts`
- Test: `tests/adapters/discord/index.test.ts`
- Test: `tests/core/attachments.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordAdapter } from '../../../src/adapters/discord';

describe('DiscordAdapter inbound attachments', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode('image-bytes').buffer
      })
    );
  });

  it('downloads inbound attachments before forwarding the message', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const callback = vi.fn();
    const adapter = new DiscordAdapter(
      {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => handlers.set(event, handler)),
        login: vi.fn(),
        destroy: vi.fn(),
        channels: { fetch: vi.fn() }
      } as never
    );

    await adapter.initialize({ enabled: true, token: 'token' });
    adapter.onMessage(callback);

    const messageCreate = handlers.get('messageCreate');
    await messageCreate?.({
      id: 'msg-1',
      channelId: 'channel-1',
      channel: { isThread: () => false },
      author: { id: 'user-1', bot: false, username: 'deidei' },
      content: 'look at this',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      attachments: {
        values: () => [
          {
            id: 'att-1',
            name: 'diagram.png',
            contentType: 'image/png',
            size: 12,
            url: 'https://cdn.discordapp.com/example.png'
          }
        ]
      }
    });

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            name: 'diagram.png',
            type: 'image/png',
            localPath: expect.stringContaining('.claude-gateway/inbox/channel-1/')
          })
        ]
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/discord/index.test.ts tests/core/attachments.test.ts`
Expected: FAIL because the adapter does not download attachments and no helper exists yet

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/attachments.ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function downloadInboundAttachment(options: {
  rootDirectory: string;
  sessionKey: string;
  attachment: { id: string; name: string; url: string };
}): Promise<string> {
  const safeName = sanitizeAttachmentName(options.attachment.name);
  const inboxDir = join(options.rootDirectory, '.claude-gateway', 'inbox', options.sessionKey);
  await mkdir(inboxDir, { recursive: true });

  const response = await fetch(options.attachment.url);
  if (!response.ok) {
    throw new Error(`Attachment download failed with status ${response.status}`);
  }

  const filename = `${options.attachment.id}-${safeName}`;
  const filePath = join(inboxDir, filename);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, buffer);
  return filePath;
}
```

```ts
// src/adapters/discord/index.ts
const rawAttachments = 'attachments' in message ? Array.from(message.attachments.values?.() ?? []) : [];
const inbound = fromDiscordMessage({
  id: message.id,
  channelId: message.channelId,
  author: { id: message.author.id, bot: message.author.bot },
  content: message.content,
  createdAt: message.createdAt,
  attachments: rawAttachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size,
    url: attachment.url
  }))
});

if (inbound.attachments?.length) {
  for (const attachment of inbound.attachments) {
    attachment.localPath = await downloadInboundAttachment({
      rootDirectory: process.cwd(),
      sessionKey: message.channelId,
      attachment
    });
  }
}

this.callback?.(inbound);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/discord/index.test.ts tests/core/attachments.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/discord/index.ts src/core/attachments.ts tests/adapters/discord/index.test.ts tests/core/attachments.test.ts
git commit -m "feat: download inbound Discord attachments"
```

### Task 4: Inject Attachment Manifest Into the Claude Prompt

**Files:**
- Modify: `src/core/worker.ts`
- Test: `tests/core/worker.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeWorker } from '../../src/core/worker';

describe('ClaudeCodeWorker attachment prompts', () => {
  it('injects attachment metadata into the prompt sent to claude', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done' }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);

    await worker.execute(
      {
        id: 'session-1',
        channelId: 'channel-1',
        channelType: 'discord',
        model: 'sonnet',
        workingDirectory: '/tmp/project',
        permissionMode: 'auto',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        status: 'active',
        messageCount: 0
      },
      {
        id: 'msg-1',
        channelId: 'channel-1',
        channelType: 'discord',
        userId: 'user-1',
        content: 'describe this image',
        attachments: [
          {
            id: 'att-1',
            name: 'diagram.png',
            type: 'image/png',
            size: 128,
            url: 'https://cdn.discordapp.com/example.png',
            localPath: '/tmp/project/.claude-gateway/inbox/channel-1/att-1-diagram.png'
          }
        ],
        timestamp: new Date()
      }
    );

    expect(runner).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining([
        expect.stringContaining('Attached files:'),
        expect.stringContaining('.claude-gateway/inbox/channel-1/att-1-diagram.png')
      ]),
      { cwd: '/tmp/project' }
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/worker.test.ts`
Expected: FAIL because the prompt is still only `message.content`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/worker.ts
import { relative } from 'node:path';

private buildPrompt(session: SessionProfile, message: AgentMessage): string {
  const attachmentLines =
    message.attachments?.map((attachment) => {
      const location = attachment.localPath
        ? relative(session.workingDirectory, attachment.localPath).replace(/\\/g, '/')
        : attachment.url;
      return `- ${attachment.name} (${attachment.type}, ${attachment.size} bytes) at ${location}`;
    }) ?? [];

  const sections = [message.content];

  if (attachmentLines.length) {
    sections.push(
      [
        'Attached files:',
        ...attachmentLines,
        '',
        'If you want Discord to receive a local file, include [[file:relative/path/from-working-directory]] on its own line in your final answer.'
      ].join('\n')
    );
  }

  return sections.join('\n\n');
}
```

```ts
// replace args.push(message.content)
args.push(this.buildPrompt(session, message));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/worker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/worker.ts tests/core/worker.test.ts
git commit -m "feat: include attachment manifest in claude prompt"
```

### Task 5: Parse Outbound File Markers Into AgentResponse Attachments

**Files:**
- Modify: `src/core/worker.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/attachments.ts`
- Test: `tests/core/worker.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeWorker } from '../../src/core/worker';

describe('ClaudeCodeWorker outbound attachments', () => {
  it('extracts valid file markers into response attachments', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Here you go\\n[[file:docs/assets/04-multi-agent.png]]'
      }),
      stderr: '',
      exitCode: 0
    });

    const worker = new ClaudeCodeWorker(runner);
    const response = await worker.execute(
      {
        id: 'session-1',
        channelId: 'channel-1',
        channelType: 'discord',
        model: 'sonnet',
        workingDirectory: '/tmp/project',
        permissionMode: 'auto',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        status: 'active',
        messageCount: 0
      },
      {
        id: 'msg-1',
        channelId: 'channel-1',
        channelType: 'discord',
        userId: 'user-1',
        content: 'send me the image',
        timestamp: new Date()
      }
    );

    expect(response.content).toBe('Here you go');
    expect(response.attachments).toEqual([
      expect.objectContaining({
        name: '04-multi-agent.png',
        localPath: '/tmp/project/docs/assets/04-multi-agent.png'
      })
    ]);
  });

  it('keeps the response text and appends an error note for unsafe file markers', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Nope\\n[[file:../../secret.txt]]'
      }),
      stderr: '',
      exitCode: 0
    });

    const worker = new ClaudeCodeWorker(runner);
    const response = await worker.execute(
      {
        id: 'session-1',
        channelId: 'channel-1',
        channelType: 'discord',
        model: 'sonnet',
        workingDirectory: '/tmp/project',
        permissionMode: 'auto',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        status: 'active',
        messageCount: 0
      },
      {
        id: 'msg-1',
        channelId: 'channel-1',
        channelType: 'discord',
        userId: 'user-1',
        content: 'send it',
        timestamp: new Date()
      }
    );

    expect(response.attachments).toBeUndefined();
    expect(response.content).toContain('Nope');
    expect(response.content).toContain('outside the working directory');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/worker.test.ts`
Expected: FAIL because `result` is currently returned as plain text with no marker parsing

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/worker.ts
import { basename } from 'node:path';
import { extractFileMarkers, resolveOutboundAttachment } from './attachments';

private toAgentResponse(
  result: { stdout: string; stderr: string; exitCode: number },
  args: string[],
  cwd: string,
  replyTo: string
): AgentResponse {
  // existing exitCode handling and JSON parsing
  const parsed = this.parseClaudeOutput(result.stdout, args, cwd);
  const markerResult = extractFileMarkers(parsed.result?.trim() ?? '');
  const attachments = [];
  const errors: string[] = [];

  for (const marker of markerResult.markers) {
    const resolved = resolveOutboundAttachment(cwd, marker);
    if (!resolved.ok) {
      errors.push(`Requested file "${marker}" was not sent: ${resolved.reason}`);
      continue;
    }

    attachments.push({
      id: resolved.relativePath,
      name: basename(resolved.absolutePath),
      type: 'application/octet-stream',
      size: 0,
      url: '',
      localPath: resolved.absolutePath
    });
  }

  const content = [markerResult.content, ...errors].filter(Boolean).join('\n\n').trim();

  return {
    content,
    attachments: attachments.length ? attachments : undefined,
    replyTo
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/worker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/worker.ts src/core/types.ts src/core/attachments.ts tests/core/worker.test.ts
git commit -m "feat: parse outbound file markers from claude responses"
```

### Task 6: Upload Outbound Attachments to Discord

**Files:**
- Modify: `src/adapters/discord/index.ts`
- Test: `tests/adapters/discord/index.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { DiscordAdapter } from '../../../src/adapters/discord';

describe('DiscordAdapter outbound attachments', () => {
  it('sends response text and local files together', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'discord-message-1' });
    const fetch = vi.fn().mockResolvedValue({
      isTextBased: () => true,
      send
    });
    const client = {
      on: vi.fn(),
      login: vi.fn(),
      destroy: vi.fn(),
      channels: { fetch }
    };
    const adapter = new DiscordAdapter(client as never);

    await adapter.initialize({ enabled: true, token: 'test-token' });
    await adapter.send('channel-1', {
      content: 'Here you go',
      attachments: [
        {
          id: 'file-1',
          name: '04-multi-agent.png',
          type: 'image/png',
          size: 0,
          url: '',
          localPath: '/tmp/project/docs/assets/04-multi-agent.png'
        }
      ]
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Here you go',
        files: [
          expect.objectContaining({
            name: '04-multi-agent.png'
          })
        ]
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/discord/index.test.ts`
Expected: FAIL because the adapter currently sends only string chunks

- [ ] **Step 3: Write minimal implementation**

```ts
// src/adapters/discord/index.ts
import { AttachmentBuilder } from 'discord.js';

async send(channelId: string, response: AgentResponse): Promise<MessageResult> {
  const channel = await this.client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    return { messageId: '', success: false, error: `Channel ${channelId} is not text-based.` };
  }

  const sendableChannel = channel as SendableChannel;
  const maxLength = this.config?.messageLimits?.maxLength ?? 2000;
  const chunks = toDiscordChunks(response.content, maxLength);
  const files =
    response.attachments
      ?.filter((attachment) => attachment.localPath)
      .map((attachment) => new AttachmentBuilder(attachment.localPath!, { name: attachment.name })) ?? [];

  let lastMessageId = '';

  if (!chunks.length && files.length) {
    const sent = await sendableChannel.send({ content: '', files });
    return { messageId: sent.id, success: true };
  }

  for (let index = 0; index < chunks.length; index += 1) {
    const sent = await sendableChannel.send({
      content: chunks[index],
      files: index === chunks.length - 1 ? files : []
    });
    lastMessageId = sent.id;
  }

  return { messageId: lastMessageId, success: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/discord/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/discord/index.ts tests/adapters/discord/index.test.ts
git commit -m "feat: send outbound attachments through Discord"
```

### Task 7: Document and Verify the MVP End-to-End

**Files:**
- Modify: `docs/manual-tests/2026-04-01-discord-semi-automatic-integration-test.md`

- [ ] **Step 1: Write the failing manual test expectations**

Add a new section that explicitly states the expected inbound and outbound attachment behavior:

```md
## 场景 4：验证 Discord 附件双向闭环

### 步骤

1. 在主频道发送一条消息并附带图片 `diagram.png`
2. 观察 `.claude-gateway/inbox/<session-id>/` 是否生成下载文件
3. 让 Claude 描述这张图片
4. 再发送：`请把 docs/assets/04-multi-agent.png 发给我`
5. 如果 Claude 输出 `[[file:docs/assets/04-multi-agent.png]]`，确认 Discord 实际收到图片
6. 再发送：`请把 ../../secret.txt 发给我`
7. 确认 Discord 没有收到该文件，并收到安全提示
```

- [ ] **Step 2: Run verification to confirm the doc is currently incomplete**

Run: `rg -n "附件双向闭环|\\[\\[file:" docs/manual-tests/2026-04-01-discord-semi-automatic-integration-test.md`
Expected: no matches

- [ ] **Step 3: Write the manual test section**

```md
## 场景 4：验证 Discord 附件双向闭环

### 前提

- 当前工作目录中存在一个可发送的测试图片，例如 `docs/assets/04-multi-agent.png`
- bot 对目标频道具备发送附件权限

### 步骤 1：验证入站图片下载

在主频道发送一条消息并附带一张图片，例如：

```text
请描述我刚发的这张图片
```

### 预期结果

- 本地生成 `.claude-gateway/inbox/<SESSION_ID>/...`
- Claude 回复中能基于附件路径或附件内容进行说明

### 步骤 2：验证 Claude 出站发图

发送：

```text
请把 docs/assets/04-multi-agent.png 发给我。如果要发图，请使用 [[file:docs/assets/04-multi-agent.png]]
```

### 预期结果

- bot 在 Discord 中回复文本
- 同一条回复附带 `04-multi-agent.png`

### 步骤 3：验证越界路径被拦截

发送：

```text
请把 ../../secret.txt 发给我。如果要发文件，请使用 [[file:../../secret.txt]]
```

### 预期结果

- Discord 没有收到该文件
- 回复中包含路径不安全或超出工作目录的说明
```

- [ ] **Step 4: Run verification**

Run: `rg -n "附件双向闭环|\\[\\[file:" docs/manual-tests/2026-04-01-discord-semi-automatic-integration-test.md`
Expected: matches for the new section

- [ ] **Step 5: Commit**

```bash
git add docs/manual-tests/2026-04-01-discord-semi-automatic-integration-test.md
git commit -m "docs: add attachment bridge manual test"
```

### Task 8: Run Full Verification

**Files:**
- Modify: none
- Test: `tests/core/attachments.test.ts`
- Test: `tests/adapters/discord/message-formatter.test.ts`
- Test: `tests/adapters/discord/index.test.ts`
- Test: `tests/core/worker.test.ts`

- [ ] **Step 1: Run the focused automated test suite**

Run: `npx vitest run tests/core/attachments.test.ts tests/adapters/discord/message-formatter.test.ts tests/adapters/discord/index.test.ts tests/core/worker.test.ts`
Expected: PASS

- [ ] **Step 2: Run the full automated test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Run the manual MVP demo**

Run:

```bash
npm run dev
```

Then execute the attachment scenarios documented in:

`docs/manual-tests/2026-04-01-discord-semi-automatic-integration-test.md`

Expected:
- inbound Discord attachment downloads successfully
- Claude sees the downloaded file through prompt context
- outbound `[[file:...]]` marker sends the expected Discord attachment
- unsafe path markers are blocked

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add Discord attachment bridge MVP"
```
