import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentRun, ChannelProjection, ControlRequest, ControlSignal } from './types';

function serializeDateRecord<T extends object>(value: T): string {
  return JSON.stringify(
    value,
    (_key, current) => (current instanceof Date ? current.toISOString() : current),
    2
  );
}

function deserializeRun(raw: string): AgentRun {
  const parsed = JSON.parse(raw);
  return { ...parsed, createdAt: new Date(parsed.createdAt), updatedAt: new Date(parsed.updatedAt) };
}

function deserializeRequest(raw: string): ControlRequest {
  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    requestedAt: new Date(parsed.requestedAt),
    resolvedAt: parsed.resolvedAt ? new Date(parsed.resolvedAt) : undefined
  };
}

function deserializeSignal(raw: string): ControlSignal {
  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt)
  };
}

function deserializeProjection(raw: string): ChannelProjection {
  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    updatedAt: new Date(parsed.updatedAt)
  };
}

export class ControlStore {
  constructor(private readonly baseDir: string) {}

  saveRun(run: AgentRun): void {
    this.write('runs', run.id, serializeDateRecord(run));
  }

  getRun(runId: string): AgentRun | null {
    return this.read('runs', runId, deserializeRun);
  }

  saveRequest(request: ControlRequest): void {
    this.write('requests', request.id, serializeDateRecord(request));
  }

  getRequest(requestId: string): ControlRequest | null {
    return this.read('requests', requestId, deserializeRequest);
  }

  listRequests(): ControlRequest[] {
    return this.list('requests', deserializeRequest);
  }

  findPendingRequestBySourceMessage(channelType: string, messageId: string): ControlRequest | null {
    return (
      this.listRequests().find(
        (request) =>
          request.status === 'pending' &&
          request.sourceMessage?.channelType === channelType &&
          request.sourceMessage?.messageId === messageId
      ) ?? null
    );
  }

  saveSignal(signal: ControlSignal): void {
    this.write('signals', signal.id, serializeDateRecord(signal));
  }

  listSignalsForRequest(requestId: string): ControlSignal[] {
    return this.list('signals', deserializeSignal).filter((s) => s.requestId === requestId);
  }

  getLatestSignalForRequest(requestId: string): ControlSignal | null {
    const signals = this.listSignalsForRequest(requestId);
    if (signals.length === 0) return null;
    return signals.reduce((latest, current) =>
      current.createdAt.getTime() > latest.createdAt.getTime() ? current : latest
    );
  }

  saveProjection(projection: ChannelProjection): void {
    this.write('projections', `${projection.channelType}-${projection.runId}`, serializeDateRecord(projection));
  }

  getProjection(channelType: string, runId: string): ChannelProjection | null {
    return this.read('projections', `${channelType}-${runId}`, deserializeProjection);
  }

  private write(group: string, id: string, content: string): void {
    const dir = join(this.baseDir, group);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.json`), content);
  }

  private read<T>(group: string, id: string, deserialize: (raw: string) => T): T | null {
    try {
      return deserialize(readFileSync(join(this.baseDir, group, `${id}.json`), 'utf8'));
    } catch {
      return null;
    }
  }

  private list<T>(group: string, deserialize: (raw: string) => T): T[] {
    try {
      return readdirSync(join(this.baseDir, group)).map((file) =>
        deserialize(readFileSync(join(this.baseDir, group, file), 'utf8'))
      );
    } catch {
      return [];
    }
  }
}