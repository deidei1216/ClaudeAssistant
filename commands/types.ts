import { AgentMessage, SessionConfigPatch, SessionProfile, SessionProfileTemplate } from '../core/types';

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

export interface CommandContext {
  session: SessionProfile;
  message: AgentMessage;
  orchestrator: {
    updateSessionConfig: (sessionId: string, config: SessionConfigPatch) => SessionProfile;
    loadProfile: (profileName: string) => SessionProfileTemplate;
    getSession: (sessionId: string) => SessionProfile | null;
    archiveSession?: (sessionId: string) => void;
    getOrCreateSession?: (channelId: string, channelType: string) => SessionProfile;
  };
}

export interface CommandDefinition {
  name: string;
  description: string;
  usage: string;
  aliases?: string[];
  handler: (args: string[], context: CommandContext) => Promise<CommandResult>;
}
