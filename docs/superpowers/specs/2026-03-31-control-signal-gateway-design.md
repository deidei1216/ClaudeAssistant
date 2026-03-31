# Channel-Agnostic Control Signal Gateway Design

> **Date:** 2026-03-31
> **Status:** Ready for review
> **Scope:** Extend the existing gateway so channels can display agent/subagent progress and send lightweight control signals without turning this repository into a workflow engine.

## 1. Goal

Keep the gateway as a lightweight messaging and presentation layer while adding a reusable control-signal abstraction that works across Discord and future channels.

The gateway should:

- continue to route normal user conversation into Claude sessions
- expose agent and subagent progress to external channels
- accept lightweight operator control actions such as approve, reject, hold, adjust, and resume
- avoid polluting Claude conversation history with low-signal control chatter
- remain channel-agnostic so Discord is only the first adapter, not the only supported UX

The gateway should not:

- define a full workflow engine
- own stage routing or business workflow semantics
- replace Claude Code subagent orchestration
- encode channel-specific behavior into the core control model

## 2. Design Principles

1. **Control is not chat**
   Control actions are operational events, not ordinary conversation messages.

2. **Channels are views, not the source of truth**
   Discord threads, replies, buttons, or reactions are only UI affordances. The canonical meaning is a normalized control signal in the gateway.

3. **Claude owns execution**
   Claude Code, its hooks, and its skills remain responsible for when to pause, what to summarize, and when to resume. The gateway only reflects and relays.

4. **Cross-channel first**
   Discord may use reactions today, but the model must also support text-only channels where users reply with words instead of reactions.

5. **Minimal first version**
   Start with enough structure to support subagent display and approval/resume flows, without adding a workflow DSL or permission system.

## 3. Problem Statement

The current codebase models one conversation stream per channel and only handles plain messages plus built-in slash-like text commands. That is enough for direct chat with Claude, but not enough for the emerging usage pattern where:

- Claude Code creates multiple subagents in parallel
- operators want to observe those subagents from a channel-based UI
- a subagent may need explicit human approval before continuing
- the approval should be visible in the channel UI but should not become noisy chat context
- the same control flow should work across channels that may not support the same interaction primitives

The design therefore adds a separate control plane beside the existing message plane.

## 4. Proposed Architecture

The system will have two parallel paths:

### 4.1 Conversation Path

This is the existing path:

- channel adapter receives a normal message
- gateway resolves the session for that channel
- orchestrator sends the message to Claude
- adapter delivers Claude's response back to the channel

This remains the default path for ordinary chat.

### 4.2 Control Path

This is new:

- Claude-side hook or skill creates or updates an `AgentRun`
- when human intervention is needed, Claude-side logic creates a `ControlRequest`
- the gateway projects that pending request into the external channel UI
- the user responds via a channel-native interaction such as a reaction, reply, button, or command
- the adapter translates that interaction into a normalized `ControlSignal`
- the control layer resolves the pending request
- Claude-side bridge logic resumes or adjusts execution based on the normalized signal

The gateway remains a broker and state projector, not the entity that invents workflow semantics.

## 5. Core Domain Model

### 5.1 AgentRun

`AgentRun` represents one running unit of work, either a main agent session or a child/subagent execution.

Required fields:

- `id`
- `parentRunId?`
- `sessionId`
- `role?`
- `title`
- `status`
- `channelBinding?`
- `createdAt`
- `updatedAt`

Suggested status values:

- `running`
- `waiting_control`
- `paused`
- `completed`
- `failed`
- `cancelled`

Purpose:

- track which execution unit exists
- show its current lifecycle state
- bind it to one or more channel projections

### 5.2 ControlRequest

`ControlRequest` represents a pending request for external operator input.

Required fields:

- `id`
- `runId`
- `kind`
- `status`
- `summary`
- `details?`
- `requestedAt`
- `resolvedAt?`
- `sourceMessage?`

Suggested `kind` values:

- `approval`
- `decision`
- `input`

Suggested `status` values:

- `pending`
- `resolved`
- `expired`
- `cancelled`

Purpose:

- capture what the run is waiting on
- provide structured text for projection into channels
- give adapters a stable object to attach interactions to

### 5.3 ControlSignal

`ControlSignal` is the channel-agnostic meaning of a user action.

Required fields:

- `id`
- `requestId`
- `runId`
- `signal`
- `comment?`
- `actor`
- `source`
- `createdAt`

Suggested `signal` values:

- `approve`
- `reject`
- `hold`
- `adjust`
- `resume`

Purpose:

- give all adapters a shared target format
- separate UX-specific interactions from control semantics
- allow pure text channels and reaction-capable channels to behave consistently

### 5.4 ChannelProjection

`ChannelProjection` describes how a run is represented in a concrete channel.

Required fields:

- `runId`
- `channelType`
- `channelId`
- `threadId?`
- `rootMessageId?`
- `lastStatusMessageId?`
- `title`

Purpose:

- keep the projection layer reusable across adapters
- let the gateway update an existing thread/message instead of re-posting blindly

## 6. Control Semantics

The first version will normalize user actions into the following meanings:

- `approve`: continue execution as proposed
- `reject`: refuse the current direction and stop or return failure state
- `hold`: keep the run paused and visible, with no continuation yet
- `adjust`: continue, but with a textual constraint or correction
- `resume`: continue from a paused state without redefining the previous decision

These are intentionally generic. They describe control intent, not workflow policy.

Policy stays outside the gateway:

- Claude-side skills decide when a request must be raised
- Claude-side scripts decide what `approve` or `adjust` means for the running task
- the gateway only stores and relays the signal

## 7. Channel-Agnostic Interaction Mapping

The gateway should define a per-adapter translation layer:

### 7.1 Discord

Recommended first-version mapping:

- `👍` -> `approve`
- `👎` -> `reject`
- `👀` -> `hold`
- reply text to a control message -> `adjust` or `resume` depending on whether the reply contains an instruction

Recommended projection model:

- one main channel remains the primary entry point
- each subagent or child run gets its own thread
- the thread contains status updates and pending control prompts

Threads are a better first fit than top-level channels because they preserve project-level grouping while still isolating each subagent's visible activity.

### 7.2 Text-Only Channels

Recommended mapping:

- `"继续"` or equivalent -> `approve`
- `"驳回"` or equivalent -> `reject`
- `"暂停"` or equivalent -> `hold`
- instruction-bearing reply such as `"继续，但先补测试"` -> `adjust`

Text-only channels should rely on reply context plus lightweight parsing, not on Discord-specific assumptions.

### 7.3 Future Button-Based Channels

Channels that support buttons or cards can map button clicks directly to the same `ControlSignal` values. No core model changes are needed.

## 8. Claude Code Integration Model

The preferred first version is `hooks + skills + local scripts`.

### 8.1 Skills

Skills define behavior at the Claude level:

- when a run must request approval
- how to summarize current progress
- how to phrase the request shown in external channels
- when to continue once the request is resolved

Skills should not hold durable state themselves. They should call local scripts or commands to read/write the state that the gateway can observe.

### 8.2 Hooks

Hooks observe runtime events such as subagent lifecycle changes and can synchronize those changes into the local control store. They are well suited for:

- `SubagentStart`
- `SubagentStop`
- `Notification`
- `Stop`

Hooks are not the business workflow engine. They are event taps used to keep external presentation synchronized.

### 8.3 Local Scripts

Local scripts act as the bridge between Claude runtime events and the gateway control plane. They should:

- create or update `AgentRun`
- create `ControlRequest`
- persist `ControlSignal` resolution results
- wake or re-invoke Claude-side continuation logic when a request resolves

This keeps state and execution logic in code and files rather than embedding everything into prompts.

## 9. Runtime Sequence

### 9.1 Subagent Display Flow

1. Claude Code starts a subagent.
2. A hook or script records a new `AgentRun`.
3. The gateway creates or updates a `ChannelProjection`.
4. The adapter creates a thread or equivalent channel view.
5. Status updates continue to sync into that projection until completion.

### 9.2 Approval Flow

1. A skill determines that the run needs operator approval.
2. A local script creates a `ControlRequest(status=pending)` and updates the run to `waiting_control`.
3. The gateway projects that request into the adapter-specific UI.
4. The user reacts or replies.
5. The adapter translates the interaction into a `ControlSignal`.
6. The control layer resolves the request.
7. A local script resumes or adjusts Claude execution based on the normalized signal.
8. The adapter updates the visible thread/status message.

### 9.3 Failure Handling Flow

1. If channel projection fails, the control request remains pending in storage.
2. The gateway retries projection on the next sync cycle or explicit update.
3. If a duplicate control action arrives, idempotency checks ignore or coalesce it.
4. If a run finishes before the control request resolves, the request is cancelled and the projection is marked stale.

## 10. Persistence Strategy

The gateway already persists sessions to JSON files. The first version should follow the same pattern for control-state persistence.

Recommended storage families:

- `data/runs/`
- `data/control-requests/`
- `data/control-signals/`
- `data/projections/`

Benefits:

- matches the codebase's current persistence approach
- easy to inspect manually during early development
- simple to evolve before a database is justified

Important constraints:

- writes must be atomic enough to survive process restarts
- identifiers must let the gateway map one channel interaction to one pending request
- records must be easy for local scripts to read without requiring direct process integration

## 11. Changes to This Repository

### 11.1 Core Types

Extend [`src/core/types.ts`](/Users/zhoudi/Projects/GitHub/ClaudeAssistant/src/core/types.ts) with:

- `AgentRun`
- `ControlRequest`
- `ControlSignal`
- `ChannelProjection`

### 11.2 New Core Modules

Add focused modules under `src/core/`:

- `control-store.ts` for persistence of runs, requests, signals, and projections
- `control-router.ts` for applying a `ControlSignal` to pending control requests and run state
- optionally `control-types.ts` if `src/core/types.ts` becomes unwieldy

### 11.3 Adapter Interface

Extend [`src/core/adapter.ts`](/Users/zhoudi/Projects/GitHub/ClaudeAssistant/src/core/adapter.ts) so adapters can:

- emit channel interaction events, not just plain messages
- create/update thread-like views where supported
- update an existing status message or thread projection

These new capabilities should remain optional so non-supporting adapters can still implement the base interface.

### 11.4 Discord Adapter

Extend [`src/adapters/discord/index.ts`](/Users/zhoudi/Projects/GitHub/ClaudeAssistant/src/adapters/discord/index.ts) to:

- listen for reaction and reply events
- create/update threads for child runs
- translate Discord-native interactions into normalized `ControlSignal` values
- keep regular message handling behavior intact

### 11.5 Gateway Layer

Extend [`src/core/gateway.ts`](/Users/zhoudi/Projects/GitHub/ClaudeAssistant/src/core/gateway.ts) with:

- a control-event intake path beside the message path
- projection updates for control requests and run status
- error reporting for failed interaction handling

The gateway should remain a broker, not a workflow decision engine.

## 12. Error Handling

The design must explicitly support these cases:

- duplicate reactions or repeated replies on the same pending request
- projection target deleted externally
- stale control actions on already-resolved requests
- subagent finishes while the operator UI still shows a pending state
- adapter supports messages but not thread creation
- text channel lacks reactions, forcing reply-based control only

Recommended behavior:

- resolve requests idempotently
- surface stale or invalid control attempts as status updates, not silent failures
- fall back to root-channel messages if a thread cannot be created
- keep storage as the source of truth so UI can be re-projected after restart

## 13. Testing Strategy

The implementation plan should cover tests for:

- control signal normalization
- request resolution rules
- storage persistence and reload behavior
- Discord reaction/reply translation
- projection creation/update behavior
- stale or duplicate signal handling
- gateway behavior when message flow and control flow coexist

The first version does not require end-to-end automation against the live Discord API, but it should include deterministic unit tests and focused adapter tests with mocks.

## 14. First-Version Boundaries

Include in v1:

- normalized control domain model
- JSON-backed control persistence
- Discord thread projection for child runs
- reaction/reply translation into control signals
- skill/hook/script bridge assumptions and integration points
- explicit paused/waiting-control UX

Exclude from v1:

- full workflow routing engine
- multi-approver coordination
- rich access control rules
- adapter parity across every channel
- database-backed storage
- complex retry orchestration beyond simple recovery and idempotency

## 15. Open Integration Assumptions

These assumptions are intentionally fixed for planning so the implementation plan can stay concrete:

- Claude-side logic will run locally and can read/write local JSON state
- Discord is the first adapter and the reference UX
- a child run may project into a Discord thread rather than requiring a top-level channel
- approval events should not be injected into ordinary Claude conversation history as plain chat messages
- skills, hooks, and local scripts are the preferred first-version Claude integration path

If any of these assumptions change later, they can be revised in a follow-up spec instead of bloating the first implementation.
