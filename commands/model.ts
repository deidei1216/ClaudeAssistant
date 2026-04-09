import { CommandDefinition } from './types';

export const modelCommand: CommandDefinition = {
  name: 'model',
  description: 'Switch the Claude model for this session.',
  usage: '/model <name>',
  handler: async ([model], context) => {
    if (!model) {
      return { success: false, message: 'Usage: /model <name>' };
    }

    context.orchestrator.updateSessionConfig(context.session.id, { model });
    return { success: true, message: `Model updated to ${model}.` };
  }
};