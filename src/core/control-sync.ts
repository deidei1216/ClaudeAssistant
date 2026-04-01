import { ChannelAdapter } from './adapter';
import { ControlStore } from './control-store';
import { AgentResponse, ChannelProjection, ControlRequest } from './types';

interface ControlSyncOptions {
  adapters: ChannelAdapter[];
  controlStore: ControlStore;
  logger: {
    info: (message: string, data?: unknown) => void;
    error: (message: string, data?: unknown) => void;
  };
  intervalMs?: number;
}

export class ControlSync {
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<void>;

  constructor(private readonly options: ControlSyncOptions) {}

  start(): void {
    this.timer = setInterval(() => void this.syncOnce(), this.options.intervalMs ?? 2000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async syncOnce(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.runSyncOnce();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async runSyncOnce(): Promise<void> {
    for (const adapter of this.options.adapters) {
      if (!adapter.upsertControlMessage) {
        continue;
      }

      const pending = this.options.controlStore.listRequests().filter((request) => request.status === 'pending');
      for (const request of pending) {
        const run = this.options.controlStore.getRun(request.runId);
        if (!run?.channelBinding || run.channelBinding.channelType !== adapter.type) {
          continue;
        }

        const existingProjection = this.options.controlStore.getProjection(adapter.type, run.id);
        const projection =
          existingProjection ?? (await this.createProjection(adapter, run.channelBinding.channelId, run.title, run.id));

        const response: AgentResponse = {
          content: `Waiting for control: ${request.summary}`
        };
        const result = await adapter.upsertControlMessage(
          projection.threadId ?? projection.channelId,
          response,
          projection.lastStatusMessageId
        );

        this.options.controlStore.saveProjection({
          ...projection,
          lastStatusMessageId: result.messageId,
          updatedAt: new Date()
        });
        this.options.controlStore.saveRequest({
          ...request,
          sourceMessage: {
            channelType: adapter.type,
            channelId: projection.channelId,
            threadId: projection.threadId,
            messageId: result.messageId
          }
        });
      }
    }
  }

  private async createProjection(
    adapter: ChannelAdapter,
    channelId: string,
    title: string,
    runId: string
  ): Promise<ChannelProjection> {
    if (adapter.createThread) {
      const created = await adapter.createThread(channelId, title);
      return {
        runId,
        channelType: adapter.type,
        channelId,
        threadId: created.channelId,
        rootMessageId: created.messageId,
        title,
        updatedAt: new Date()
      };
    }

    return {
      runId,
      channelType: adapter.type,
      channelId,
      title,
      updatedAt: new Date()
    };
  }
}
