import { resolve } from 'node:path';
import { CommandDefinition } from '../types';

export const cdCommand: CommandDefinition = {
  name: 'cd',
  description: 'Switch the working directory for this session.',
  usage: '/cd <path>',
  handler: async (args, context) => {
    const path = args.join(' ').trim();
    if (!path) {
      return { success: false, message: 'Usage: /cd <path>' };
    }

    const workingDirectory = resolve(path);
    context.orchestrator.updateSessionConfig(context.session.id, { workingDirectory });
    return { success: true, message: `Working directory updated to ${workingDirectory}.` };
  }
};