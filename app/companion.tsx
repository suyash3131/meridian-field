'use client';

import { useEffect } from 'react';

const AGENT_ID = 'baseAgent_agent_1789922892145_ie20jx4g5';

declare global {
  interface Window { LuaPop?: { init: (c: Record<string, unknown>) => Promise<unknown>; destroy?: () => void } }
}

/** The agent, beside every manager page. It lives in the layout, so moving
 *  between Today, Eight o'clock and Agent health keeps the conversation. */
export default function Companion({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      if (cancelled || !window.LuaPop) return;
      // The rep screen uses the same global widget; clear it before taking over.
      window.LuaPop.destroy?.();
      await window.LuaPop.init({
        agentId: AGENT_ID,
        environment: 'production',
        displayMode: 'embedded',
        embeddedDisplayConfig: {
          targetContainerId: 'manager-chat',
          useContainerHeight: true,
          conversationStarters: [
            'what is waiting on me',
            'why is north down this week',
            'how is the south doing',
          ],
        },
        theme: 'light',
        sessionId: `meridian-manager-${Math.random().toString(36).slice(2, 10)}`,
        // Plain facts, like the rep screen's context. An earlier version was
        // phrased as orders to the model ("Use X. Never Y.") and the widget's
        // replies stopped using the tools; the CLI, with no context, was fine.
        runtimeContext:
          'The person in this conversation is Anita Rao, regional head for North and South. ' +
          'She is a manager, not a field rep, and she is asking about her territory.',
      });
    };
    if (window.LuaPop) start();
    else {
      const s = document.createElement('script');
      s.src = 'https://lua-ai-global.github.io/lua-pop/lua-pop.umd.js';
      s.onload = start;
      document.body.appendChild(s);
    }
    return () => { cancelled = true; window.LuaPop?.destroy?.(); };
  }, []);

  return (
    <aside className="h-full flex flex-col bg-surface border-l border-line" aria-label="Ask Meridian">
      <div className="h-16 shrink-0 flex items-center gap-2.5 px-5 border-b border-track">
        <span className="h-[26px] w-[26px] rounded-full bg-accent grid place-items-center" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"
               strokeLinecap="round"><path d="M4 12h3l2-5 3 10 2-5h6" /></svg>
        </span>
        <span className="leading-tight">
          <span className="block text-[0.875rem] font-semibold">Ask Meridian</span>
          <span className="block text-[0.75rem] text-ink-3">The same agent your reps use</span>
        </span>
        <button onClick={onClose} aria-label="Close"
                className="xl:hidden ml-auto h-9 w-9 grid place-items-center rounded-lg text-ink-2 hover:bg-track">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div id="manager-chat" className="flex-1 min-h-0" />
    </aside>
  );
}
