import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { get, rs } from '../../lib/api';
import { chemistShop } from '../../lib/chemist';
import { buttons } from '../../lib/rich';

/** A chemist asks what their shop owes. Their own shop only (lib/chemist.ts). */
export default class ChemistAccountTool implements LuaTool {
  name = 'chemist_account';
  description = 'A chemist (a customer shop) asks what they owe, what is overdue, when payment is due, or about their recent orders.';
  inputSchema = z.object({ shop: z.string().optional().describe('Only if they named one of their shops.') });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const s = await chemistShop(input.shop);
    if ('ask' in s)
      return { sendExactly: `${s.ask}\n\n${s.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}` + buttons(s.options),
               nextStep: 'Send sendExactly word for word and stop.' };
    const a = await get<any>(`/api/chemist/account?outletId=${encodeURIComponent(s.id)}`);
    const lines = [`**${a.shop}**: ${rs(a.owedPaise)} outstanding across ${a.openInvoices} invoice${a.openInvoices === 1 ? '' : 's'}.`];
    if (a.overduePaise > 0) lines.push(`${rs(a.overduePaise)} of it is past its due date (oldest by ${a.oldestOverdueDays} days).`);
    if (a.nextDue) lines.push(`Next due: ${rs(Number(a.nextDue.amount_paise))} on ${a.nextDue.due}.`);
    if (a.lastOrders?.length)
      lines.push(`Recent orders: ${a.lastOrders.map((o: any) => `${o.on} ${rs(o.totalPaise)}${o.status === 'held_credit' ? ' (awaiting approval)' : o.status === 'cancelled' ? ' (cancelled)' : ''}`).join(', ')}.`);
    lines.push('To pay, or for anything about an order, reply here and it reaches your Meridian rep.');
    return { sendExactly: lines.join('\n\n'), nextStep: 'Send sendExactly word for word and stop.' };
  }
}
