# Discord Claude CLI Attachments MVP Design

## Summary

This spec defines an MVP that proves Discord can act as a bidirectional transport for a Claude Code CLI session, covering text plus a minimal file bridge for images and common documents.

The MVP intentionally avoids building a full OpenClaw-style multimodal runtime. Instead, it adds a small, explicit attachment protocol on top of the current text-first gateway:

- Discord inbound attachments are downloaded into a controlled local directory.
- Claude receives attachment context as prompt text plus local file paths.
- Claude can request outbound file delivery by emitting `[[file:relative/path]]`.
- The gateway validates the path and sends the referenced file back to Discord as an attachment.

## Goals

- Prove that Discord can be used as the primary conversation surface for Claude Code CLI, not just a text relay.
- Support inbound Discord images/files well enough for Claude to inspect or reason about them through local paths.
- Support outbound Discord file delivery from Claude responses with an explicit, deterministic protocol.
- Keep the implementation small, testable, and compatible with the existing architecture.

## Non-Goals

- No attempt to support arbitrary media types beyond a small allowlist for the MVP.
- No automatic semantic guessing of which file Claude wants to send.
- No deep parsing of `claude --output-format stream-json` events in the MVP.
- No background asset lifecycle management beyond simple controlled storage.
- No support for sending files outside the session working directory.
- No full OpenClaw compatibility layer or generic multimodal session protocol in this phase.

## User Experience

### Inbound Flow

1. A Discord user sends a message with optional attachments.
2. The gateway downloads supported attachments into a controlled directory under the current workspace.
3. The gateway augments the prompt sent to Claude with a short attachment manifest containing:
   - original file name
   - MIME type when available
   - file size when available
   - local relative path
4. Claude responds as usual in text.

Example prompt augmentation:

```text
User message:
Please describe this diagram.

Attached files:
- architecture.png (image/png, 182344 bytes) at .claude-gateway/inbox/<session-id>/architecture.png
```

### Outbound Flow

1. Claude includes one or more explicit file markers in the final response:

```text
Here is the image you asked for.
[[file:docs/assets/04-multi-agent.png]]
```

2. The gateway extracts and removes these markers from the visible response body.
3. The gateway validates each path against the session working directory.
4. Valid files are attached to the outgoing Discord message.
5. Invalid files are not sent, and the user receives a short explanatory message in the response body.

## Architecture

The MVP stays within the current architecture:

- `DiscordAdapter` remains responsible for Discord-specific message ingestion and message sending.
- `ClaudeCodeWorker` remains responsible for prompt construction and Claude CLI result parsing.
- A new attachment utility module handles download, path normalization, validation, and marker extraction.

This keeps channel-specific logic in the adapter while centralizing file safety rules in the core layer.

## Data Model

The existing `Attachment` type is retained as the shared transport model.

Inbound attachments will populate:

- `id`
- `name`
- `type`
- `size`
- `url`
- `localPath`

Outbound attachments will primarily require:

- `name`
- `localPath`
- `type` when known

No schema redesign is required for the MVP. Small type extensions are acceptable only if they support clearer intent.

## File Storage

Inbound downloaded files are stored under:

```text
.claude-gateway/inbox/<session-id>/
```

Design constraints:

- The path must be inside the project workspace.
- The directory must be created lazily when attachments are present.
- File names should be sanitized to avoid path traversal and shell-hostile characters.
- Collisions should be resolved deterministically, for example by prefixing with a timestamp or attachment ID.

This storage is intentionally simple for the MVP and may be cleaned manually.

## Prompting Contract

Claude Code CLI currently behaves as a text-oriented interface in this project. The MVP therefore uses a prompt contract rather than relying on native attachment semantics.

The worker prepends or appends a compact attachment manifest to the user message when `message.attachments` is present.

The worker also adds a short instruction such as:

```text
If you want Discord to receive a local file, include [[file:relative/path/from-working-directory]] on its own line in your final answer.
```

This contract is intentionally explicit to reduce ambiguity and avoid accidental file transmission.

## Outbound File Marker Rules

The file marker syntax is:

```text
[[file:relative/path]]
```

Rules:

- Paths must be relative, not absolute.
- Paths are resolved from the session working directory.
- Paths containing traversal that escape the working directory are rejected.
- Multiple markers are allowed.
- Duplicate markers should be de-duplicated before sending.
- If a referenced file does not exist, the gateway leaves the text response intact except for the removed marker and appends a short error note.

## Security Rules

The MVP must default to safety over convenience.

- Never send files outside `session.workingDirectory`.
- Never honor absolute paths.
- Never honor `..` traversal that escapes the working directory.
- Never auto-send files based on fuzzy filename matching.
- Never download or resend unsupported attachments silently; log and annotate failures.

This keeps the gateway from becoming an unintended local file exfiltration surface.

## Supported Media for MVP

Inbound supported file classes:

- Common images: `image/png`, `image/jpeg`, `image/webp`, `image/gif`
- Common text-ish documents: `text/plain`, `application/json`, `text/markdown`
- Optionally PDF if Discord metadata is available and downstream prompt usage is acceptable

Outbound supported file classes:

- Any existing file in the working directory that Discord can upload within its API limits

The MVP does not need MIME-perfect handling for outbound files; file existence and safe path validation are the main requirement.

## Error Handling

### Inbound Errors

- If attachment download fails, continue processing the text message.
- Add a short note to Claude's prompt manifest indicating which attachment failed.
- Log the failure with channel ID, session ID, source URL, and file name when available.

### Outbound Errors

- If marker parsing succeeds but the file does not exist, do not send the file and append a short note for the user.
- If path validation fails, do not send the file and append a short security-related note.
- If Discord upload fails, keep the text response and log the upload failure.

## Testing Strategy

The MVP should be delivered test-first.

### Unit Tests

- `message-formatter` maps inbound Discord attachments into `AgentMessage.attachments`.
- attachment utility sanitizes inbound file names and resolves safe local paths.
- worker prompt builder includes the attachment manifest when attachments exist.
- worker response parser extracts `[[file:...]]` markers into `AgentResponse.attachments`.
- worker response parser rejects absolute or escaping paths.
- Discord adapter sends files when `AgentResponse.attachments` contains valid local files.

### Integration-Style Manual Test

1. Start the gateway.
2. Send a Discord message with an image attachment.
3. Confirm the file is downloaded into `.claude-gateway/inbox/<session-id>/`.
4. Confirm Claude mentions or uses the attachment path in its reasoning.
5. Ask Claude to return a known workspace image with `[[file:...]]`.
6. Confirm Discord receives the image as an attachment.
7. Ask Claude to return `[[file:../../secret.txt]]`.
8. Confirm the request is blocked and the user receives an explanatory note.

## Implementation Scope

Expected code changes:

- Modify `src/adapters/discord/index.ts`
- Modify `src/adapters/discord/message-formatter.ts`
- Modify `src/core/worker.ts`
- Possibly adjust `src/core/types.ts`
- Add a new core utility module for attachment handling
- Add or update tests under `tests/adapters/discord/` and `tests/core/`

## Trade-Offs

### Why explicit markers

Explicit markers are less magical than semantic guessing, but they are:

- deterministic
- easy to test
- easy to explain to Claude
- safer for local file exposure

### Why not stream-json first

`stream-json` may become the better long-term protocol, especially if Claude Code exposes richer structured outputs later. It is not required to prove the MVP. The prompt contract plus marker extraction is enough to validate product direction with minimal engineering risk.

## Success Criteria

The MVP is successful if all of the following are true:

- A Discord user can send an image or file to the gateway.
- The file is stored locally and made visible to Claude through prompt context.
- Claude can request a local workspace file be sent back through Discord using `[[file:...]]`.
- The gateway sends that file successfully.
- Unsafe file paths are rejected.
- The behavior is covered by automated tests and one repeatable manual test document.

## Future Extensions

If the MVP works, the next phase can consider:

- switching to `stream-json` for richer structured output handling
- automatic artifact discovery from Claude tool usage
- attachment lifecycle cleanup and retention policies
- richer Discord message formatting for mixed text plus multiple files
- support for additional channel adapters using the same attachment utility layer
