import { LuaTool, User } from 'lua-cli';
import { z } from 'zod';
import { post, currentManager, thisTurn } from '../../lib/api';

/**
 * Save the counter or rep the manager was just shown, on their own "yes".
 * Their words this turn are checked in code, the proposal must be under 30
 * minutes old, and what is saved is exactly what they were shown: the model
 * passes nothing but the go-ahead.
 */
const YES = /\b(yes|yeah|yep|haan|han|ha|ok|okay|sure|save|add( it| him)?|kar do|theek|thik|confirm|done)\b|👍|✅/i;
const NO = /\b(no|nope|nahi|nahin|mat|cancel|don'?t|wrong|galat)\b/i;

export default class ConfirmSetupTool implements LuaTool {
  name = 'confirm_setup';
  description = 'The manager answered the "add this counter / add this rep?" read-back. Saves it on yes, drops it on no.';
  inputSchema = z.object({});

  async execute() {
    const mgr = await currentManager();
    const u: any = await User.get();
    const p = u?.pendingSetup;
    const said = (await thisTurn()).text.replace(/I selected:\s*/i, '');
    if (!p) return { sendExactly: 'Nothing is waiting to be saved.', nextStep: 'Send sendExactly word for word and stop.' };
    if (Date.now() - new Date(p.at).getTime() > 30 * 60 * 1000) {
      await u.patch({ set: { pendingSetup: null } });
      return { sendExactly: 'That was more than 30 minutes ago, so I did not save it. Send it again.', nextStep: 'Send sendExactly word for word and stop.' };
    }
    const yes = YES.test(said), no = NO.test(said);
    if (no && !yes) {
      await u.patch({ set: { pendingSetup: null } });
      return { sendExactly: 'Not saved.', nextStep: 'Send sendExactly word for word and stop.' };
    }
    if (!yes || no)
      return { sendExactly: 'Save it? Reply yes or no.', nextStep: 'Send sendExactly word for word and stop.' };

    const r = p.kind === 'counter'
      ? await post<any>('/api/manager/outlets', p.data)
      : await post<any>('/api/manager/reps', { ...p.data, managerId: mgr.id });
    await u.patch({ set: { pendingSetup: null } });
    if (r.error) return { sendExactly: `Not saved: ${r.error}`, nextStep: 'Send sendExactly word for word and stop.' };
    return {
      sendExactly: p.kind === 'counter'
        ? `Added ✓ *${p.data.name}*, ${p.data.area} (${r.id}).\n\nPut it on a route? e.g. "add ${p.data.name} to Ramesh's Monday route".`
        : `Added ✓ *${r.name}* (${r.id}), ${r.region}. He can message the agent from ${r.phone} now.`,
      nextStep: 'Send sendExactly word for word and stop.',
    };
  }
}
