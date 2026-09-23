import { AI, PreProcessor } from 'lua-cli';

/**
 * A rep at a counter talks faster than he types. A voice note is turned into
 * the words he said, and those words go through exactly the same order path as
 * a typed message: the same resolver, the same one question, the same slip and
 * "Confirm?". Nothing is placed on the strength of a transcript alone.
 *
 * The listening is done by Gemini, which hears Hindi, English and the mix of the
 * two that reps actually speak. It is asked to write what was said and nothing
 * else: no tidying, no guessing a product, numbers as digits. Understanding the
 * order stays with the agent and the code behind it.
 *
 * Runs on every channel, before email-roster's cleaning, so an email carrying
 * only an audio attachment still reaches the agent as text.
 */
const LISTEN = [
  'Write down exactly what is said in this voice note.',
  'The speaker is a pharmaceutical sales rep in India placing an order at a chemist shop.',
  'He mixes Hindi and English. Write Hindi words in Roman letters as he says them',
  '(e.g. "haan", "chahiye", "din"), never in Devanagari and never translated.',
  'Write every number as digits. Keep shop names and product names as spoken.',
  'Do not correct, summarise, add punctuation beyond commas, or add anything of your own.',
  'If nothing intelligible is said, reply with exactly: (inaudible)',
].join(' ');

const isAudio = (m: any) =>
  m?.type === 'file' && /^(audio\/|video\/ogg)/i.test(String(m.mediaType ?? ''));

export default new PreProcessor({
  name: 'voice-note',
  description: 'Transcribe voice notes into text before the agent reads them',
  priority: 5,
  execute: async (_user, messages) => {
    // What arrived, without the payload: enough to debug a channel's shape.
    console.log('voice-note saw', JSON.stringify(messages.map((m: any) => ({ type: m.type, mediaType: m.mediaType }))));
    if (!messages.some(isAudio)) return { action: 'proceed' };

    const out: any[] = [];
    for (const m of messages as any[]) {
      if (!isAudio(m)) { out.push(m); continue; }
      let heard = '';
      try {
        const r = await AI.generate({
          model: 'google/gemini-3.8-flash',
          temperature: 0,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: LISTEN },
              { type: 'file', data: m.data, mediaType: m.mediaType },
            ],
          }] as any,
        });
        heard = String(r.text ?? '').trim();
      } catch (err) {
        console.log('voice-note transcription failed', String(err));
      }
      console.log('voice-note heard', JSON.stringify(heard));
      if (!heard || heard === '(inaudible)')
        return {
          action: 'block',
          response: "Couldn't make out that voice note. Please send it again, or type the order.",
        };
      out.push({ type: 'text', text: heard });
    }
    return { action: 'proceed', modifiedMessage: out };
  },
});
