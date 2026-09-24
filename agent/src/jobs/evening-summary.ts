import { Channels, LuaJob } from 'lua-cli';
import { get } from '../lib/api';

/**
 * Eight o'clock, Monday to Saturday, India time: every manager with an email
 * address gets the day's summary without having to ask for it.
 *
 * The CRM writes each email (/api/manager/digest) from the ledger; this job
 * only delivers them through Lua's email channel, so a manager can reply to it
 * and the reply reaches the agent. A send that fails is logged and the rest
 * still go out.
 */
export default new LuaJob({
  name: 'evening-summary',
  description: "Email each manager the day's numbers, the week's causes and what is waiting on them, at 8pm IST",
  schedule: { type: 'cron', expression: '0 20 * * 1-6', timezone: 'Asia/Kolkata' },
  timeout: 120,
  retry: { maxAttempts: 2, backoffSeconds: 60 },
  execute: async () => {
    const { emails = [] } = await get<{ emails: { managerId: string; to: string; subject: string; html: string; text?: string }[] }>(
      '/api/manager/digest');
    const sent: string[] = [];
    for (const e of emails) {
      try {
        const r = await Channels.email.send({ to: { email: e.to }, subject: e.subject, html: e.html, text: e.text });
        console.log(`evening-summary ${e.managerId} → ${e.to}: ${r.status}`);
        sent.push(e.managerId);
      } catch (err) {
        console.log(`evening-summary ${e.managerId} → ${e.to}: not sent`, String(err));
      }
    }
    return { sent, of: emails.length };
  },
});
