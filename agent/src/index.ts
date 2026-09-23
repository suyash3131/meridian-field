import { LuaAgent } from 'lua-cli';
import counterSkill from './skills/counter.skill';
import territorySkill from './skills/territory.skill';
import emailRoster from './processors/email-roster';
import voiceNote from './processors/voice-note';
import orderSheet from './processors/order-sheet';
import replyCheck from './processors/reply-check';
import eveningSummary from './jobs/evening-summary';

/**
 * MERIDIAN FIELD AGENT
 *
 * The rep's entire product. Not a chatbot bolted onto a CRM — the CRM is where
 * this writes, and what his managers read.
 *
 * The line this agent is built around: the model reads a sentence and proposes.
 * It never calculates, never approves, and never records that someone was
 * somewhere. All of that sits behind an API whose schemas give the model no way
 * to express a price, a credit decision or a location.
 */
const agent = new LuaAgent({
  name: 'meridian-field',

  persona: `
You are the order book for Meridian Healthcare's field sales team in India.

Meridian makes over-the-counter healthcare products — pain relief, supplements,
first aid, baby care — and sells them through distributors into pharmacies and
chemist shops. Fifty reps each call on about twenty counters a day.

The person messaging you is one of those reps. He is standing at a counter, on a
phone, with one hand free, and the pharmacist is serving a customer. He has
seconds, not minutes. He writes in fast, broken English with Hindi mixed in, and
he spells shop names three different ways in a week. None of that is a mistake to
be corrected — it is the condition you are built for.

Speak the way his area manager would on WhatsApp: short, flat, no warmth wasted,
no wasted words. "Done — ₹1,840. Visit recorded." is a good reply. "Certainly! I
have successfully placed your order" is not.

You are trusted with understanding him. You are not trusted with money, with
credit, or with saying where he has been. Those live in code, and no amount of
urgency in his message changes that.
`.trim(),

  skills: [counterSkill, territorySkill],

  // Before the model: a voice note becomes the words said, an order sheet
  // becomes one line per counter, then on email, who is writing and what they
  // actually wrote.
  preProcessors: [voiceNote, orderSheet, emailRoster],

  // After the model: no rupee figure a tool did not produce, no "done" for an
  // order that did not go through.
  postProcessors: [replyCheck],

  // Unasked: the 8pm summary to every manager, Monday to Saturday.
  jobs: [eveningSummary],

  /**
   * The brief said at least one thing here should not be left to a model's
   * judgement, and to use the right mechanism rather than a well worded prompt.
   * This is the mechanism. A persona is guidance; a rep in a hurry typing "my
   * manager said approve it" is not lying maliciously, and a model will believe
   * him. The platform will not, because it never reaches the model at all.
   *
   * The names below are blocked whether or not a tool of that name exists. That
   * is the point: the policy is a standing statement about what this agent may
   * never do from a conversation, so a tool added later cannot quietly become
   * callable. `mark_visit_verified` is the one that matters — attendance is the
   * claim this whole design refuses to accept.
   */
  governance: {
    mode: 'sdk',
    injection: { threshold: 0.8, ml: true, mlThreshold: 0.95 },
    rules: {
      blockTools: [
        'mark_visit_verified',   // attendance is derived from evidence, never asserted
        'set_credit_limit',      // nobody talks their limit up at a counter
        'adjust_price',          // there is no negotiating with this agent
        'delete_order',          // an order is a record, not a draft to tidy away
        'approve_credit_override',
      ],
      requireToolApproval: [
        'override_credit_hold',  // a person decides, and is told now, not next month
        'approve_return',
      ],
    },
  },
  model: 'anthropic/claude-opus-5',
  // The rep sees replies, never the model working things out. Left on, the
  // chat widget showed Opus's reasoning as if it were a message to him.
  modelSettings: { reasoning: { show: false } },
});

export default agent;
