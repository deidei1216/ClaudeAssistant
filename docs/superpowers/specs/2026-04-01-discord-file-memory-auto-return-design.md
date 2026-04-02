# Discord Auto-Delivery And File Memory Design

## Summary

This design extends the current Discord attachment bridge so file delivery becomes a natural result of the task instead of a user-visible protocol.

The core shift is:

- **primary decision:** should this turn automatically deliver a file result?
- **secondary decision:** if yes, which file should be delivered?
- **transport detail:** Claude still uses the hidden `[[file:...]]` marker internally, but the user never needs to see or type it

This makes the system behave more like a real assistant:

- edit an Excel file -> send back the edited Excel
- generate a PPT or Word report -> send back the generated file
- create an HTML deliverable -> send back the HTML

Recent file memory remains important, but as a supporting mechanism for file selection, not the main trigger for delivery.

## Goals

- Let file-producing tasks automatically deliver their result back to Discord without requiring the user to explicitly say "发给我".
- Keep the hidden marker protocol internal to the Claude-to-gateway handoff.
- Preserve support for natural references like "刚才那个文件" or "再发一遍".
- Keep the implementation small and aligned with the existing attachment bridge MVP.

## Non-Goals

- No attempt to turn the gateway into a full asset management system.
- No full-repository semantic indexing.
- No deep Office-document understanding beyond file-level delivery logic.
- No automatic delivery for every created file by default.
- No change to outbound file safety rules.

## User Experience

### Desired Experience

Users should be able to say things like:

- "帮我改下这个 Excel"
- "搜集这些信息，整理成 PPT"
- "把结果导出成 Word"
- "做一个 html 报告"

and, if the task clearly implies a file deliverable, the assistant should return that file automatically when the work is done.

Users should also be able to say:

- "把刚才那个再发一遍"
- "把刚才那个 html 给我"
- "把那张图再发我一下"

without needing to know anything about internal markers or gateway mechanics.

### Clarification Behavior

If there is not enough confidence about which file should be delivered, Claude should ask a short clarification question rather than guessing.

Example:

```text
我这里有两个刚生成的 html：report.html 和 dashboard.html。你想要哪一个？
```

## Decision Model

The system should make delivery decisions in this order:

1. **Auto-delivery intent**
   Determine whether the task naturally implies that a file should be returned.
2. **Artifact resolution**
   Determine which file best matches the task result.
3. **Hidden transport**
   Use the internal `[[file:...]]` marker to hand the chosen file to the gateway for Discord delivery.

This ordering is important.

The system should not begin with "what recent file exists?" because that over-weights conversational references and under-weights task outcome.

## Auto-Delivery Intent

### High-Confidence Auto-Delivery Cases

The assistant should default toward returning a file when the task itself is obviously file-oriented.

Examples:

- the user uploads an Excel, Word, PPT, PDF, image, or similar file and asks for edits, fixes, cleanup, conversion, or enrichment
- the user explicitly asks to generate a file deliverable such as:
  - html
  - docx / word
  - xlsx / excel
  - pptx / ppt
  - pdf
  - csv
  - markdown report
- Claude clearly creates a single user-facing output artifact during the current turn

In these cases, returning the resulting file should be treated as the default expected behavior.

### Low-Confidence Or No Auto-Delivery Cases

The assistant should not auto-deliver when the task is primarily:

- pure Q&A
- explanation or analysis only
- code discussion with no user-facing output file
- an ambiguous multi-output turn with no clear primary artifact

In these cases, no file is sent unless the user clearly asks for one.

## Artifact Resolution

Once auto-delivery intent is established, the system needs to resolve the target artifact.

Priority order:

1. single newly created or modified file from the current turn that clearly matches the requested deliverable type
2. single inbound file that was just edited or transformed
3. recent file memory candidates that strongly match the user request
4. clarification when multiple candidates remain plausible

This means the first-class path is:

- task result drives file resolution

and only then:

- recent-file memory helps disambiguate or recover conversational references

## Recent File Memory

Recent file memory remains part of the design, but its role changes.

It is now a support layer for:

- "刚才那个文件"
- "再发一遍"
- "那个 html"
- "你刚改好的 Excel"

It should not be the primary reason a file is sent.

### Remembered File Record

Each file record should contain:

- `id`
- `displayName`
- `relativePath`
- `absolutePath`
- `source`
  - `discord_inbound`
  - `claude_outbound`
  - `workspace_detected`
- `mediaType`
- `lastSeenAt`
- `summary`

The memory should be capped to a small recent window such as the latest 10 files per session.

### Sources Of Remembered Files

#### 1. Discord Inbound

Any successfully downloaded inbound attachment should be remembered.

#### 2. Successful Outbound Delivery

Any file successfully sent to Discord should be refreshed in memory.

This supports:

- "再发一遍"
- "把上一个文件再给我"

#### 3. Workspace-Detected Outputs

This should remain conservative.

Only remember workspace files when both are true:

- the file was newly created or modified during the current turn
- the file is clearly the intended result artifact or is explicitly referenced in Claude's visible response

This covers natural outputs like:

- `report.html`
- `slides.pptx`
- `budget.xlsx`
- `summary.docx`

without scanning the whole repository indiscriminately.

## Prompt Contract

The worker should inject a hidden return instruction on every turn, not only when the current user message has attachments.

That instruction should tell Claude:

- when a file result should be returned to the user, emit `[[file:relative/path]]` on its own line
- treat file-return as the default for clearly file-producing tasks
- use recent file memory to resolve references like "刚才那个" or "再发一遍"
- avoid asking the user for a path when a high-confidence file candidate already exists
- ask for clarification rather than guessing if multiple plausible files exist

The worker should also inject a compact recent-files summary when any remembered files exist.

Example:

```text
Recent files in this session:
- inbound image: .claude-gateway/inbox/1488.../image.png
- generated html: outputs/report.html
- last sent excel: exports/budget.xlsx
```

## Safety Rules

The current outbound safety model remains in force:

- only files inside `session.workingDirectory` may be sent
- inline markers and markers inside code fences remain ignored
- malformed or unsafe paths remain blocked

Additional guardrails:

- auto-delivery should only happen when there is high confidence that the file is the natural task result
- recent file memory must not trigger delivery unless the task or user intent supports it
- if multiple plausible artifacts exist, the assistant must clarify
- if the user explicitly says not to send or export a file, auto-delivery is disabled for that turn

## Storage Strategy

Do not introduce a new database.

The first implementation should reuse session persistence by extending the session state with a compact `recentFiles` field, or a closely adjacent persisted state file if that yields cleaner boundaries.

The recommended path is to extend session persistence because the project already stores per-channel session state there.

## Component Changes

### `src/core/types.ts`

Add a recent-file type and attach it to persisted session state.

### Session persistence layer

Persist and load recent file memory with session state.

### `src/core/gateway.ts`

Register inbound attachments after they are normalized into the true session working directory.

### `src/core/worker.ts`

Always inject the hidden file-return instruction.

When recent files exist, inject a compact recent-files summary block.

The worker should also be the place where result-artifact context is passed to Claude in a minimal, structured way.

### Artifact detection path

Add a small mechanism to register newly created or modified files from the current turn when they are clearly the intended result artifact.

This should stay conservative and avoid whole-directory noise.

### Discord send path

Refresh recent-file metadata after successful outbound sends.

## Testing Strategy

### Unit Tests

- worker injects hidden return instructions every turn, even with no current attachments
- worker injects recent-file summaries when memory exists
- session persistence includes recent file memory
- inbound attachments register into recent-file memory
- successful outbound deliveries refresh recent-file memory

### Behavioral Tests

- after uploading an Excel and asking for edits, the resulting Excel is automatically returned without the user explicitly saying "发给我"
- after asking for an HTML report, the generated HTML is automatically returned
- after asking for a PPT or Word deliverable, the produced file is automatically returned
- after a prior successful send, "再发一遍" resolves to the last delivered file
- when two candidate output files exist, Claude asks for clarification instead of guessing

## Trade-Offs

### Why keep the hidden marker

The hidden marker remains the safest deterministic handoff from Claude to the gateway.

The product problem is not the existence of the marker. The product problem is forcing the user to type it.

This design solves that by hiding the marker behind prompt and memory logic.

### Why not auto-send every created file

That would feel convenient at first, but it would quickly create noise and accidental deliveries.

The better rule is:

- automatically deliver when the task clearly implies a file result
- otherwise require explicit or contextually clear intent

## Success Criteria

This enhancement is successful if:

- users no longer need to type `[[file:...]]`
- file-producing tasks automatically return their natural output artifacts
- recent file memory supports conversational references like "刚才那个文件" and "再发一遍"
- ambiguous cases result in clarification rather than guessing
- existing safety protections still hold
- the behavior is covered by automated tests and a short manual validation flow

## Implementation Scope

The first implementation should stay focused:

- automatic hidden return instruction on every turn
- recent file memory for the latest few files per session
- registration of inbound attachments and successful outbound deliveries
- conservative registration of current-turn output artifacts
- auto-delivery only for high-confidence file-result tasks

This is enough to validate the product direction without overbuilding a general asset orchestration system.
