/**
 * The rep's words, in the rep's language.
 *
 * The CRM answers in English: it is the system of record, and other things
 * read it. Everything a rep actually sees is built here, from the CRM's
 * figures, in whichever language he chose in the app. Numbers and names are
 * passed through untouched; only the words around them change.
 *
 * A server sentence this file does not recognise is left in English rather
 * than guessed at: a wrong translation of a credit decision is worse than an
 * untranslated one.
 */
export type Lang = 'en' | 'hi';

const rsOf = (paise: number) => '₹' + Math.round(paise / 100).toLocaleString('en-IN');

/** Said to the model alongside each result, for anything it writes itself. */
export const replyIn = (lang: Lang) =>
  lang === 'hi'
    ? 'He reads Hindi. Anything you add in your own words, write in simple Hindi (Devanagari).'
    : undefined;

// -----------------------------------------------------------------------------
// Sentences the CRM sends, mapped to Hindi.
// -----------------------------------------------------------------------------

const HI: [RegExp, string][] = [
  [/^Which counter\?$/, 'कौन सी दुकान?'],
  [/^No counter called "(.+)" on file\. Which one is it\?$/, '"$1" नाम की कोई दुकान नहीं मिली। कौन सी है?'],
  [/^Which "(.+)"\?$/, '"$1" — कौन सा?'],
  [/^Same order went in (\d+) min ago\. Is this a second one\?$/, 'यही ऑर्डर $1 मिनट पहले जा चुका है। क्या यह दूसरा है?'],
  [/^Same order — ignore this$/, 'वही ऑर्डर है — छोड़ दें'],
  [/^No, this is a new order$/, 'नहीं, यह नया ऑर्डर है'],
  [/^Saved this one — too many things to check\. Your ASM will call\. Move on\.$/,
    'यह ऑर्डर सेव हो गया, पर जाँचने को बहुत कुछ है। आपके ASM कॉल करेंगे। आगे बढ़ें।'],
  [/^Kept the first one\. Nothing new saved\.$/, 'पहला वाला रखा। कुछ नया सेव नहीं हुआ।'],
  [/^I don't stock anything called "(.+)"\.$/, '"$1" नाम का कोई प्रोडक्ट नहीं है।'],
  [/^no counter matches "(.+)"$/, '"$1" नाम की कोई दुकान नहीं मिली।'],
  [/^no products in that message$/, 'मैसेज में कोई प्रोडक्ट नहीं मिला।'],
  [/^that order is no longer open$/, 'यह ऑर्डर अब खुला नहीं है।'],
];

export function tr(text: string, lang: Lang): string {
  if (lang === 'en' || !text) return text;
  // "(19m away)" on a counter option.
  const t = text.replace(/\((\d+)m away\)/g, '($1 मी. दूर)');
  for (const [re, hi] of HI) if (re.test(t)) return t.replace(re, hi);
  return t;
}

// -----------------------------------------------------------------------------
// Messages built from figures.
// -----------------------------------------------------------------------------

export function readBackText(s: any, lang: Lang): string {
  const free = lang === 'hi' ? 'मुफ़्त' : 'free';
  const lines = s.lines.map((l: any) =>
    `${l.qty} × ${l.name} (${l.pack})` + (l.freeQty ? ` + ${l.freeQty} ${free}` : '')).join(', ');
  const total = rsOf(s.totalPaise);

  if (lang === 'hi') {
    const terms = s.creditDays ? `, ${s.creditDays} दिन` : '';
    const warn = s.credit.overLimit
      ? `\n⚠ इससे ${s.outlet.name} का बकाया ${rsOf(s.credit.afterPaise)} हो जाएगा, लिमिट ${rsOf(s.credit.limitPaise)} है। यह ASM के पास जाएगा।`
      : '';
    return `${s.outlet.name} — ${lines} = ${total}${terms}।${warn}\nकन्फ़र्म करें?`;
  }
  const terms = s.creditDays ? `, ${s.creditDays} days` : '';
  const warn = s.credit.overLimit
    ? `\n⚠ Takes ${s.outlet.name} to ${rsOf(s.credit.afterPaise)} against a ${rsOf(s.credit.limitPaise)} limit. It will go to your ASM.`
    : '';
  return `${s.outlet.name} — ${lines} = ${total}${terms}.${warn}\nConfirm?`;
}

export const placedText = (paise: number, lang: Lang) =>
  lang === 'hi' ? `हो गया — ${rsOf(paise)}। विज़िट दर्ज।` : `Done — ${rsOf(paise)}. Visit recorded.`;

export const heldText = (paise: number, lang: Lang) =>
  lang === 'hi'
    ? `सेव हो गया — ${rsOf(paise)}। यह दुकान की क्रेडिट लिमिट से ज़्यादा है, इसलिए मंज़ूरी के लिए ASM के पास गया है। विज़िट दर्ज। आगे बढ़ें।`
    : `Saved — ${rsOf(paise)}. It crosses this counter's credit limit, so it has gone to your ASM for approval. Visit recorded. Move on.`;

export const notedText = (outlet: string, lang: Lang) =>
  lang === 'hi' ? `${outlet} पर दर्ज किया। ✓` : `Noted at ${outlet}. ✓`;
