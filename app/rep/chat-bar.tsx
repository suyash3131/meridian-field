'use client';

import type { Stop } from './today';
import { T, type Lang } from './i18n';

/**
 * Put words in the chat's input box and hand the cursor to the rep.
 *
 * The Lua widget has no public "send" or "fill" call, but its input has a fixed
 * id inside its shadow root. Setting the value through the native setter and
 * firing `input` is what React inside the widget listens for, so its send
 * button wakes up as if he had typed it. The widget can arrive late, so this
 * retries for a few seconds rather than failing silently.
 */
export function fillChat(text: string, tries = 20) {
  const root = document.getElementById('lua-shadow-root-embedded')?.shadowRoot;
  const box = root?.getElementById('lua-pop-chat-input') as HTMLTextAreaElement | null | undefined;
  if (!box) {
    if (tries > 0) setTimeout(() => fillChat(text, tries - 1), 500);
    return;
  }
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(box, text);
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.focus();
  box.setSelectionRange(text.length, text.length);
}

const ACTIONS = [
  {
    key: 'order' as const,
    icon: <><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2.5 3h2.6l2.4 12.2h11.4L21 7H6.2" /></>,
    text: (shop: string) => `${shop} `,
  },
  {
    key: 'noOrder' as const,
    icon: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
    text: (shop: string) => `${shop} no order, `,
  },
  {
    key: 'dues' as const,
    icon: <><path d="M7 5h10M7 9h10M13 9c0 3-2.5 4.5-6 4.5L14 20" /><path d="M7 9c3 0 6-.5 6-4" /></>,
    text: (shop: string) => (shop ? `what does ${shop} owe` : 'what does '),
  },
];

/**
 * The chat is for three jobs, so it shows three buttons. Each one writes the
 * shop's name for him; he only adds the part that is his to say.
 */
export default function ChatBar({ stop, lang }: { stop: Stop | null; lang: Lang }) {
  const t = T[lang].chatBar;
  const shop = stop?.name ?? '';

  return (
    <div className="shrink-0 bg-surface border-b border-line px-3.5 pt-3 pb-3.5">
      <div className="flex items-center gap-2 min-h-6">
        {stop ? (
          <>
            <span className="h-6 w-6 shrink-0 rounded-full bg-ink text-white grid place-items-center text-[0.6875rem] font-semibold">
              {stop.seq}
            </span>
            <p className="text-[0.8125rem] min-w-0 truncate">
              <span className="text-ink-3">{t.at} </span><span className="font-semibold">{stop.name}</span>
            </p>
          </>
        ) : (
          <p className="text-[0.8125rem] text-ink-3">{t.notAtStop}</p>
        )}
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {ACTIONS.map((a) => (
          <button key={a.key} onClick={() => fillChat(a.text(shop).trimStart())}
                  className="h-14 rounded-xl border border-line bg-sunk hover:bg-track flex flex-col items-center
                             justify-center gap-1 text-[0.75rem] font-medium">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden>{a.icon}</svg>
            {t[a.key]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[0.6875rem] text-ink-3">{t.hint}</p>
    </div>
  );
}
