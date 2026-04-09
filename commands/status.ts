import { CommandDefinition } from './types';

export const statusCommand: CommandDefinition = {
  name: 'status',
  description: 'Show the current session state.',
  usage: '/status',
  handler: async (_args, context) => {
    const session = context.orchestrator.getSession(context.session.id);
    if (!session) {
      return { success: false, message: 'Session not found.' };
    }

    return {
      success: true,
      message: `Session ${session.id}\nmodel=${session.model}\ncwd=${session.workingDirectory}\nmessages=${session.messageCount}`
    };
  }
};