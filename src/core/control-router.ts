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
    private readonly clock: () => Date = () => new Date()
  ) {}

  resolve(input: ChannelControlInput): ControlResolution | null {
    const request = this.store.findPendingRequestBySourceMessage(input.channelType, input.messageId);
    if (!request) {
      return null;
    }

    if (this.store.listSignalsForRequest(request.id).some((signal) => signal.actor.userId === input.userId)) {
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

    return { run: nextRun, request: nextRequest, signal };
  }
}