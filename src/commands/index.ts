import { AgentMessage } from '../core/types';
import { CommandContext, CommandDefinition, CommandResult } from './types';

function parseCommand(content: string): { name: string; args: string[] } | null {
  if (!content.startsWith('/')) {
    return null;
  }

  const [name, ...args] = content.slice(1).trim().split(/\s+/);
  if (!name) {
    return null;
  }

  return { name, args };
}

export class CommandHandler {
  private readonly commands = new Map<string, CommandDefinition>();

  register(command: CommandDefinition): void {
    this.commands.set(command.name, command);
    command.aliases?.forEach((alias) => this.commands.set(alias, command));
  }

  list(): CommandDefinition[] {
    return Array.from(new Set(this.commands.values())).sort((left, right) => left.name.localeCompare(right.name));
  }

  async execute(commandName: string, args: string[], context: CommandContext): Promise<CommandResult> {
    const command = this.commands.get(commandName);
    if (!command) {
      return { success: false, message: `Unknown command: ${commandName}` };
    }

    return command.handler(args, context);
  }

  async executeFromMessage(message: AgentMessage, context: CommandContext): Promise<CommandResult> {
    const parsed = parseCommand(message.content);
    if (!parsed) {
      return { success: false, message: 'Not a command message.' };
    }

    return this.execute(parsed.name, parsed.args, context);
  }
}