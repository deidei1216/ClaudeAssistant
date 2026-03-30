import { CommandDefinition } from '../types';

export const profileCommand: CommandDefinition = {
  name: 'profile',
  description: 'Load a saved session profile.',
  usage: '/profile <name>',
  handler: async ([profileName], context) => {
    if (!profileName) {
      return { success: false, message: 'Usage: /profile <name>' };
    }

    const { name: _name, description: _description, ...profile } = context.orchestrator.loadProfile(profileName);
    context.orchestrator.updateSessionConfig(context.session.id, {
      ...profile,
      profile: profileName
    });

    return { success: true, message: `Profile ${profileName} loaded.` };
  }
};