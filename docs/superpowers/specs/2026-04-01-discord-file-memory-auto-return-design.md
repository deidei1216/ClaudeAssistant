# Claude Code Native File Return Design

## Summary

This design treats the gateway workspace itself as a Claude Code project and lets Claude Code's native mechanisms carry the decision-making for file return.

The previous direction was still too gateway-centric:

- it moved rules out of per-turn prompt injection, but still kept the main delivery policy inside our application code
- it made the gateway act like the primary decision layer for whether files should be sent

That is not the architecture we want.

The corrected direction is:

- `CLAUDE.md` defines project-level delivery principles
- native Claude Code hooks are the intended final trigger layer, but only after their real lifecycle wiring is validated in this project
- skills and scripts implement the concrete artifact-selection, bundling, and packaging behavior
- the gateway remains a bridge and execution assistant, not the primary decision-maker

The gateway should help Claude Code operate across chat channels. It should not try to replace Claude Code's native project model.

## Goals

- Make file return feel like a natural Claude Code project behavior rather than a gateway-specific trick.
- Let Claude Code own artifact-return decisions, including whether to send, bundle, compress, or ask for clarification.
- Keep the gateway focused on channel delivery concerns such as upload, retry, status sync, and adapter behavior.
- Preserve natural cross-turn references to prior artifacts through workspace memory rather than language-specific prompt examples.
- Keep the design extensible across Discord, WeChat, Feishu, and similar chat-channel integrations.

## Non-Goals

- No full security model in this iteration.
- No path-access restriction layer beyond Claude Code's own execution environment and existing runtime behavior.
- No gateway-owned delivery policy engine as the primary architecture.
- No language-specific intent parser.
- No hardcoded prompt examples to teach artifact references.

## Architectural Principle

For this project family, architecture should begin with one question:

**Can Claude Code's native project mechanisms solve this first?**

If the answer is yes, we should prefer:

- `CLAUDE.md`
- hooks
- skills
- scripts
- workspace memory files

and only then add gateway behavior for things Claude Code cannot reliably do on its own, such as:

- channel upload and retry
- adapter-specific formatting
- message delivery bookkeeping
- bridging between Claude output and external chat platforms

This is the primary design principle that should guide future features in this project.

## Core Model

The system should separate four concerns:

1. **Project-level decision rules**
   What kinds of artifacts should normally be returned, bundled, summarized, or skipped.

2. **Project-level execution hooks**
   When the artifact-return process should run.

3. **Project-level implementation logic**
   How candidate artifacts are discovered, filtered, packaged, compressed, and prepared.

4. **Gateway/channel delivery**
   How prepared artifacts are uploaded and retried through Discord or other adapters.

The first three should primarily live in the Claude Code project model.

The fourth should remain in the gateway.

## Native Claude Code First

### `CLAUDE.md`

`CLAUDE.md` should be the stable home for project-wide delivery principles.

It should express ideas like:

- the workspace is a Claude Code project, not just a transient prompt context
- artifact return is decided semantically based on user intent and project state
- default behavior should favor useful final deliverables, not every generated file
- when result sets are large, Claude should prefer bundling, packaging, or summarizing
- users may explicitly request paths outside the default workspace, and that is allowed for now
- `[[file:...]]` remains an internal bridge marker for the gateway handoff

These rules belong at the project level because they are not turn-specific.

### Hooks

Native Claude Code hooks are still the intended final trigger layer.

However, this project should not claim hook integration is complete unless the real hook lifecycle event names, config format, and `claude --print` behavior are validated end-to-end in this repository.

Until that validation exists:

- skill-local scripts may be staged in the repository
- `CLAUDE.md` may describe the intended final behavior
- but bridge code must not manually invoke those scripts
- and this repository should not ship a simulated hook entrypoint as a substitute for validated native hook wiring

### Skills And Scripts

Skills and scripts should implement the actual artifact-return workflow.

Responsibilities include:

- inspect recent files and current outputs
- decide whether the result is a single file, a set, or an archive candidate
- compress large result sets into a zip when appropriate
- generate a clean outbox artifact when multiple outputs should be bundled
- choose whether to send an existing file directly or package it first

The skill layer is the right place for concrete logic because it is:

- reusable
- inspectable
- explicit
- closer to Claude Code's operating model than gateway-owned policy code

## Workspace And Memory Model

### Default Workspace Behavior

The default behavior is still that Claude Code works inside the current session workspace.

That remains the normal path because it keeps project state coherent and predictable.

### Access Outside The Workspace

This iteration does not impose additional gateway-owned path restrictions.

If the user explicitly wants Claude Code to read or produce artifacts outside the default workspace, that should be treated as valid project behavior for now.

Examples:

- desktop files
- downloads
- another local project path

Security hardening for path restrictions is deferred to a separate future security-specific design.

### Session Memory

Dynamic state should still be mirrored into workspace-visible memory files under `.claude-gateway/`.

The most important file remains:

- `.claude-gateway/memory/recent-files.json`

This is supporting context for Claude Code, future native hooks, and skill-local scripts.

It should help with:

- resolving prior-artifact references
- remembering inbound files
- remembering prior outbound deliverables
- choosing whether to reuse, regenerate, or bundle artifacts

## File Return Flow

The intended flow becomes:

1. User sends a request through a chat channel.
2. Gateway normalizes inbound files and updates workspace-visible memory.
3. Claude Code works as if it is inside a normal project.
4. Validated native Claude Code hooks should eventually decide whether artifact-return logic should run.
5. Skills/scripts inspect outputs and prepare the deliverable:
   - direct file
   - bundled archive
   - packaged output
   - or no attachment
6. Claude emits the bridge handoff marker for the prepared deliverable.
7. Gateway uploads the prepared file through the adapter and handles retry/platform concerns.

In this model, the gateway does not primarily decide the delivery policy. It executes the transport.

## Role Of The Gateway

The gateway should remain responsible for:

- inbound attachment normalization
- session working-directory setup
- workspace memory mirroring
- adapter-specific upload
- message send retry and delivery failure handling
- channel/platform bookkeeping

The gateway should not be the primary home for:

- deciding whether a file is worth sending
- deciding whether to zip a large result set
- deciding whether to compress, package, or bundle artifacts
- teaching Claude how to reason about artifact return

Those belong to Claude Code project mechanisms.

## Role Of The Worker

The worker should stay minimal.

It should:

- pass through the actual user message
- include current-turn attachment manifest when needed
- preserve support for the internal file handoff marker
- avoid embedding repeated delivery-policy rules into prompt content

The worker should not become a policy engine.

## Packaging And Bundling

Large result sets should be handled by Claude Code logic, not primarily by gateway policy code.

Examples:

- many HTML files -> package them into a zip if that is the best deliverable
- multiple related exports -> create a single archive or clean output folder artifact
- mixed outputs -> choose one user-facing bundle rather than spamming attachments

This is a strong example of why project hooks and scripts are more appropriate than a narrow gateway-side policy module.

## Transport Marker

`[[file:...]]` remains useful, but only as an internal bridge transport marker.

It should be treated as:

- an implementation detail between Claude Code and the gateway
- not the place where delivery policy is defined
- not something users need to know or type

The marker is the handoff, not the architecture.

## Design Principles

### 1. Claude Code Decides, Gateway Delivers

When possible, Claude Code should decide artifact-return behavior through project rules, hooks, and scripts.

The gateway should deliver what Claude prepared.

### 2. Native Mechanisms Beat Simulated Mechanisms

If Claude Code already has a native mechanism for project behavior, we should use that before inventing a gateway-owned substitute.

### 3. Keep The Bridge Thin

The bridge layer should stay focused on integration concerns, not expand into the primary product logic.

### 4. Defer Security Specialization

Path restrictions and other security-hardening rules should be designed in a dedicated security pass, not prematurely mixed into this workflow design.

## Testing Strategy

### Project Behavior Tests

- `CLAUDE.md` and hook behavior produce the expected artifact-return decisions
- scripts correctly select, bundle, or compress artifacts
- recent-file memory remains useful for semantic follow-ups
- explicit path requests outside the default workspace continue to work

### Gateway Tests

- inbound files are normalized correctly
- prepared outbound artifacts are uploaded correctly
- retry and adapter failure behavior remains correct
- internal file markers still bridge artifacts to adapters

## Success Criteria

This redesign is successful if:

- artifact-return decisions primarily live in Claude Code project mechanisms
- the gateway becomes a delivery assistant rather than a policy owner
- `CLAUDE.md`, validated native hooks, and skills/scripts form the main decision stack
- large or multi-file results can be bundled or zipped by project logic
- users can explicitly work outside the default workspace when needed
- the design is extensible across multiple chat-channel adapters without cloning policy logic into each one
