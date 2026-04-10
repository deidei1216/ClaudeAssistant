import { CommandDefinition } from './types';

export const newSessionCommand: CommandDefinition = {
  name: 'new',
  aliases: ['reset'],
  description: 'Start a fresh conversation for the current channel.',
  usage: '/new',
  handler: async (_args, context) => {
    if (!context.orchestrator.archiveSession || !context.orchestrator.getOrCreateSession) {
      return {
        success: false,
        message: 'Starting a new session is not supported by the current runtime.'
      };
    }

    context.orchestrator.archiveSession(context.session.id);
    const nextSession = context.orchestrator.getOrCreateSession(
      context.message.channelId,
      context.message.channelType
    );

    return {
      success: true,
      message: `Started a new session.\nold=${context.session.id}\nnew=${nextSession.id}`
    };
  }
};
