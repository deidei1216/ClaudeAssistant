import { CommandHandler } from './index';
import { CommandDefinition } from './types';
import { cdCommand } from './cd';
import { modelCommand } from './model';
import { newSessionCommand } from './new';
import { profileCommand } from './profile';
import { statusCommand } from './status';

export const helpCommand: CommandDefinition = {
  name: 'help',
  description: 'List the built-in commands.',
  usage: '/help',
  handler: async (_args, _context) => ({
    success: true,
    message: ['/new', '/model <name>', '/cd <path>', '/profile <name>', '/status', '/help'].join('\n')
  })
};

export function buildBuiltInCommands(handler: CommandHandler): void {
  [newSessionCommand, modelCommand, cdCommand, profileCommand, statusCommand, helpCommand].forEach((command) =>
    handler.register(command)
  );
}
