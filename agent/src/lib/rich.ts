import { Lua } from 'lua-cli';

/**
 * Lua's reply blocks, per channel.
 *
 * A reply can carry `:::` blocks that each channel renders natively: tap
 * buttons on WhatsApp (and chips on the web widget), a document message, an
 * emoji reaction on the person's own message. On email, buttons are dropped
 * by Lua and a reaction would arrive as a stray emoji, so those are left out
 * there and the words alone carry the choice.
 */
const channel = () => String(Lua.request?.channel ?? '');

/** Up to ten choices the person can tap. A tap comes back as the label. */
export function buttons(labels: string[]): string {
  if (channel() === 'email' || !labels.length) return '';
  return '\n\n::: actions\n' + labels.slice(0, 10).map((l) => `- ${l}`).join('\n') + '\n:::';
}

/** An emoji on the person's own message. WhatsApp and the widget only. */
export function reaction(emoji: string): string {
  const c = channel();
  return c === 'whatsapp' || c === 'web' ? `\n\n::: reaction\nemoji=${emoji}\n:::` : '';
}

/** A file to open: a WhatsApp document, a widget file card, an email attachment. */
export function documentBlock(label: string, url: string, filename: string, mime = 'application/pdf'): string {
  return `\n\n::: documents\n[${label}](${url}) filename:${filename} mime:${mime}\n:::`;
}

export const onWhatsApp = () => channel() === 'whatsapp';
export const onEmail = () => channel() === 'email';
