import { one, sql, tx } from './db';

/**
 * A manager's decision on something waiting for one.
 *
 * The agent carries a decision here; it never makes one. Before anything
 * changes, this checks, in code:
 *
 *   - the approval exists and is still pending (a second "approve" is a no-op,
 *     reported as such, never a second release)
 *   - the person deciding is the manager it is assigned to, or the regional
 *     head. Who they are comes from the verified email address or phone number
 *     the conversation was bound to, never from anything typed
 *
 * Approving a credit hold releases the order: it becomes confirmed and gets
 * its invoice, in one transaction. Rejecting it cancels the order and keeps the
 * row, because a refused sale is still information.
 */
export type Decision = 'approve' | 'reject';

export type Pending = {
  id: string; kind: string; subject_id: string; outlet: string | null; rep: string | null;
  rep_id: string | null; reason: string; value_paise: string | null; age_days: number; assigned_to: string | null;
};

/** What is waiting on this manager, oldest first. The regional head sees all. */
export async function pendingFor(managerId: string): Promise<Pending[]> {
  return sql<Pending>(
    `SELECT a.id, a.kind, a.subject_id, ou.name AS outlet, r.name AS rep, r.id AS rep_id, a.reason,
            o.total_paise AS value_paise,
            (current_date - a.created_at::date)::int AS age_days, a.assigned_to
       FROM approvals a
       LEFT JOIN outlets ou ON ou.id = a.outlet_id
       LEFT JOIN reps r     ON r.id = a.requested_by
       LEFT JOIN orders o   ON o.id = a.subject_id
       JOIN managers m      ON m.id = $1
      WHERE a.status = 'pending'
        AND (a.assigned_to = m.id OR m.role = 'regional_head')
      ORDER BY a.created_at, a.id`, [managerId]);
}

export async function decide(p: { managerId: string; approvalId: string; decision: Decision; note?: string }) {
  const m = await one<{ id: string; name: string; role: string }>(
    `SELECT id, name, role FROM managers WHERE id = $1`, [p.managerId]);
  if (!m) return { error: 'Only a Meridian manager can decide this.' };

  const a = await one<{ id: string; kind: string; subject_id: string; status: string; assigned_to: string | null;
                        decided_by: string | null; outlet: string | null }>(
    `SELECT a.id, a.kind, a.subject_id, a.status, a.assigned_to, a.decided_by, ou.name AS outlet
       FROM approvals a LEFT JOIN outlets ou ON ou.id = a.outlet_id WHERE a.id = $1`, [p.approvalId]);
  if (!a) return { error: 'There is no such request.' };
  if (a.assigned_to !== m.id && m.role !== 'regional_head')
    return { error: `That request is for another manager, so it has not been changed.` };
  if (a.status !== 'pending')
    return { already: true, approvalId: a.id, status: a.status, outlet: a.outlet, orderId: a.subject_id,
             message: `Already ${a.status}. Nothing changed.` };

  return tx(async (q) => {
    // Re-read under a row lock: two "approve" taps a second apart release once.
    const [locked] = await q<{ status: string }>(`SELECT status FROM approvals WHERE id = $1 FOR UPDATE`, [a.id]);
    if (locked?.status !== 'pending')
      return { already: true, approvalId: a.id, status: locked?.status, outlet: a.outlet, orderId: a.subject_id,
               message: `Already ${locked?.status}. Nothing changed.` };

    await q(`UPDATE approvals SET status = $2, decided_by = $3, decided_at = now(), note = $4 WHERE id = $1`,
            [a.id, p.decision === 'approve' ? 'approved' : 'rejected', m.id, p.note ?? null]);

    let orderStatus: string | null = null;
    if (a.kind === 'credit_override') {
      const [o] = await q<{ status: string; outlet_id: string; total_paise: string; credit_terms_days: number }>(
        `SELECT status, outlet_id, total_paise, credit_terms_days FROM orders WHERE id = $1 FOR UPDATE`, [a.subject_id]);
      if (o?.status === 'held_credit') {
        if (p.decision === 'approve') {
          await q(`UPDATE orders SET status = 'confirmed', confirmed_at = now() WHERE id = $1`, [a.subject_id]);
          await q(
            `INSERT INTO invoices (id, order_id, outlet_id, amount_paise, issued_on, due_on, status)
             VALUES ($1,$2,$3,$4, current_date + 2, current_date + 2 + $5::int, 'open')`,
            [`INV-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
             a.subject_id, o.outlet_id, o.total_paise, o.credit_terms_days]);
          orderStatus = 'confirmed';
        } else {
          await q(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [a.subject_id]);
          orderStatus = 'cancelled';
        }
      } else orderStatus = o?.status ?? null;
    }
    return {
      decided: p.decision, approvalId: a.id, kind: a.kind, outlet: a.outlet,
      orderId: a.subject_id, orderStatus, by: m.name,
    };
  });
}
