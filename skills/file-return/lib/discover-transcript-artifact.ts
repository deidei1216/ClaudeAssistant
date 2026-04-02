import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { toRelativeWorkspacePath } from './gateway-contract';

const OUTPUT_PATH_PATTERN =
  /(?:^|[\s"'`(])([A-Za-z0-9._/-]+\.(?:csv|doc|docx|gif|htm|html|json|jpeg|jpg|md|pdf|png|ppt|pptx|txt|webp|xlsx|yaml|yml|zip))(?:$|[\s"'`),.:])/g;

interface TranscriptRecord {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

interface ToolResultContentBlock {
  type?: string;
  content?: unknown;
  is_error?: boolean;
}

export function discoverTranscriptArtifact(workingDirectory: string, transcriptPath?: string): string | null {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return null;
  }

  const transcript = readFileSync(transcriptPath, 'utf8');
  const candidates = getCurrentTurnToolResultStrings(transcript).flatMap((content) =>
    Array.from(content.matchAll(OUTPUT_PATH_PATTERN), (match) => match[1])
  );

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    const relativePath = toRelativeWorkspacePath(workingDirectory, candidate);
    if (relativePath && statSync(join(workingDirectory, relativePath)).isFile()) {
      return relativePath;
    }
  }

  return null;
}

function getCurrentTurnToolResultStrings(transcript: string): string[] {
  const records = transcript
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as TranscriptRecord];
      } catch {
        return [];
      }
    });

  if (records.length === 0) {
    return [];
  }

  const lastAssistantIndex = findLastAssistantRecordIndex(records);
  if (lastAssistantIndex === -1) {
    return [];
  }

  let turnStartIndex = 0;
  for (let index = lastAssistantIndex - 1; index >= 0; index -= 1) {
    if (isAssistantRecord(records[index])) {
      turnStartIndex = index + 1;
      break;
    }
  }

  const toolResults: string[] = [];
  for (let index = turnStartIndex; index < lastAssistantIndex; index += 1) {
    toolResults.push(...getToolResultStrings(records[index]));
  }

  return toolResults;
}

function findLastAssistantRecordIndex(records: TranscriptRecord[]): number {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (isAssistantRecord(records[index])) {
      return index;
    }
  }

  return -1;
}

function isAssistantRecord(record: TranscriptRecord): boolean {
  return record.type === 'assistant' || record.message?.role === 'assistant';
}

function getToolResultStrings(record: TranscriptRecord): string[] {
  const content = record.message?.content;
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((block) => {
    if (!isToolResultBlock(block) || block.is_error || typeof block.content !== 'string') {
      return [];
    }

    return [block.content];
  });
}

function isToolResultBlock(block: unknown): block is ToolResultContentBlock {
  return typeof block === 'object' && block !== null && (block as ToolResultContentBlock).type === 'tool_result';
}
