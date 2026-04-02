import { randomUUID } from 'node:crypto';
import { ControlStore } from './control-store';
import { AgentRun, ChannelControlInput, ControlRequest, ControlSignal } from './types';

export interface ControlResolution {
  run: AgentRun;
  request: ControlRequest;
  signal: ControlSignal;
}

export class ControlRouter {
  constructor(
    private readonly store: ControlStore,
    private readonly clock: () => Date = () => new Date(),
    private readonly logger: {
      info?: (data: unknown, message: string) => void;
      warn?: (data: unknown, message: string) => void;
      error?: (data: unknown, message: string) => void;
    } = {}
  ) {}

  resolve(input: ChannelControlInput): ControlResolution | null {
    const request =
      this.store.findPendingRequestBySourceMessage(input.channelType, input.messageId) ??
      (input.threadId ? this.store.findPendingRequestByThreadId(input.channelType, input.threadId) : null);
    if (!request) {
      this.log('warn', 'Control input did not match any pending request', {
        channelType: input.channelType,
        channelId: input.channelId,
        messageId: input.messageId,
        interactionType: input.interactionType,
        rawValue: input.rawValue,
        pendingRequests: this.store
          .listRequests()
          .filter((candidate) => candidate.status === 'pending')
          .map((candidate) => ({
            requestId: candidate.id,
            runId: candidate.runId,
            sourceMessageId: candidate.sourceMessage?.messageId,
            sourceThreadId: candidate.sourceMessage?.threadId
          }))
      });
      return null;
    }

    if (this.store.listSignalsForRequest(request.id).some((signal) => signal.actor.userId === input.userId)) {
      this.log('info', 'Ignoring duplicate control input from same user', {
        requestId: request.id,
        runId: request.runId,
        userId: input.userId,
        messageId: input.messageId
      });
      return null;
    }

    const run = this.store.getRun(request.runId);
    if (!run) {
      return null;
    }

    const signal: ControlSignal = {
      id: randomUUID(),
      requestId: request.id,
      runId: request.runId,
      signal: input.signal,
      comment: input.comment,
      actor: {
        channelType: input.channelType,
        userId: input.userId,
        username: input.username
      },
      source: {
        channelType: input.channelType,
        channelId: input.channelId,
        messageId: input.messageId,
        threadId: input.threadId,
        interactionType: input.interactionType,
        rawValue: input.rawValue
      },
      createdAt: this.clock()
    };

    const nextRun: AgentRun = {
      ...run,
      status:
        input.signal === 'reject'
          ? 'cancelled'
          : input.signal === 'hold'
            ? 'paused'
            : 'running',
      updatedAt: this.clock()
    };

    const nextRequest: ControlRequest = {
      ...request,
      status: 'resolved',
      resolvedAt: this.clock()
    };

    this.store.saveSignal(signal);
    this.store.saveRun(nextRun);
    this.store.saveRequest(nextRequest);
    this.log('info', 'Resolved control request from channel input', {
      requestId: request.id,
      runId: request.runId,
      signal: input.signal,
      channelId: input.channelId,
      messageId: input.messageId,
      threadId: input.threadId,
      resolutionSource:
        request.sourceMessage?.messageId === input.messageId ? 'message' : input.threadId ? 'thread' : 'message'
    });

    return { run: nextRun, request: nextRequest, signal };
  }

  private log(level: 'info' | 'warn' | 'error', message: string, data: Record<string, unknown>): void {
    const method = this.logger[level];
    method?.call(this.logger, data, message);
  }
}
