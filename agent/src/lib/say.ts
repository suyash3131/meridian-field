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
  [/^Not placed\.$/, 'ऑर्डर नहीं गया।'],
  [/^Not placed: (.+)\.$/, 'ऑर्डर नहीं गया: $1।'],
  [/^Cancel order$/, 'ऑर्डर कैंसल करें'],
  [/^Change something$/, 'कुछ बदलना है'],
  [/^Cancelled\. Nothing sent\.$/, 'कैंसल हो गया। कुछ नहीं भेजा गया।'],
  [/^What to change\? Send just that, like "2 calci d3"\.$/, 'क्या बदलना है? बस वही भेजें, जैसे "2 calci d3"।'],
  [/^No order placed today to change\.$/, 'आज कोई ऑर्डर नहीं है जिसे बदला जाए।'],
  [/^That order was cancelled\. Nothing was sent\.$/, 'वह ऑर्डर कैंसल हो चुका है। कुछ नहीं भेजा गया।'],
  [/^That one is already with your ASM\.$/, 'वह पहले से आपके ASM के पास है।'],
  [/^That order timed out after (\d+) minutes\. Send it again\.$/, 'वह ऑर्डर $1 मिनट में कन्फ़र्म नहीं हुआ, बंद हो गया। दोबारा भेजें।'],
];

export function tr(text: string, lang: Lang): string {
  if (lang === 'en' || !text) return text;
  // "(19m away)" on a counter option.
  const t = text.replace(/\((\d+)m away\)/g, '($1 मी. दूर)')
                .replace(/\(([\d.]+) km away\)/g, '($1 कि.मी. दूर)');
  for (const [re, hi] of HI) if (re.test(t)) return t.replace(re, hi);
  return t;
}

// -----------------------------------------------------------------------------
// Messages built from figures.
// -----------------------------------------------------------------------------

/** " (strip of 15)", unless the name already says the size: "Baby Lotion 200ml"
 *  needs no "(200ml bottle)" after it. */
function packNote(name: string, pack: string): string {
  if (!pack) return '';
  const size = pack.split(' ')[0].toLowerCase();
  return name.toLowerCase().includes(size) ? '' : ` (${pack})`;
}

/**
 * Shop, then one product per line, then credit, then price, then the question.
 * Laid out as a slip rather than a sentence: the rep reads it top to bottom at
 * a glance, and each thing he might need to correct sits on a line of its own.
 *
 * The chat widget renders markdown, where a single line break is only a space,
 * so the first version arrived as one run-on paragraph. Items are a list and
 * every other part is its own paragraph: the only breaks the widget keeps.
 */
export function readBackText(s: any, lang: Lang): string {
  const hi = lang === 'hi';
  const free = hi ? 'मुफ़्त' : 'free';
  const items = s.lines.map((l: any) =>
    `${l.qty} × ${l.name}${packNote(l.name, l.pack)}` + (l.freeQty ? ` + ${l.freeQty} ${free}` : ''));

  // One line per number that is far above normal, straight under the items,
  // so the rep checks the figure before he reads the total.
  const checks = s.lines.filter((l: any) => l.unusual).map((l: any) => {
    const shop = l.unusual.basis === 'this_shop';
    return hi
      ? `⚠ ध्यान दें: ${l.qty} ${l.name}। ${shop ? 'यह दुकान' : 'दुकानें'} आमतौर पर ${l.unusual.usual} ${shop ? 'लेती है' : 'लेती हैं'}।`
      : `⚠ Check: ${l.qty} ${l.name}. ${shop ? 'This shop usually takes' : 'Shops usually take'} ${l.unusual.usual}.`;
  });

  const credit = s.creditDays
    ? (hi ? `क्रेडिट: ${s.creditDays} दिन` : `Credit: ${s.creditDays} days`)
    : null;
  const warn = s.credit.overLimit
    ? (hi
        ? `⚠ लिमिट से ऊपर: ${rsOf(s.credit.afterPaise)} / ${rsOf(s.credit.limitPaise)}। ASM के पास जाएगा।`
        : `⚠ Over limit: ${rsOf(s.credit.afterPaise)} of ${rsOf(s.credit.limitPaise)}. Goes to your ASM.`)
    : null;
  const price = hi ? `कीमत: ${rsOf(s.totalPaise)}` : `Price: ${rsOf(s.totalPaise)}`;

  return [
    `**${s.outlet.name}**`,
    items.map((i: string) => `- ${i}`).join('\n'),
    ...checks,
    ...(credit ? [credit] : []),
    ...(warn ? [warn] : []),
    price,
    hi ? 'कन्फ़र्म करें?' : 'Confirm?',
  ].join('\n\n');
}

// Every result names the counter: one message can carry orders for two shops,
// and "Done — ₹588" alone does not say which of them went through.
const at = (outlet?: string) => (outlet ? `${outlet}, ` : '');

export const placedText = (paise: number, lang: Lang, outlet?: string) =>
  lang === 'hi' ? `हो गया — ${at(outlet)}${rsOf(paise)}। विज़िट दर्ज।`
                : `Done — ${at(outlet)}${rsOf(paise)}. Visit recorded.`;

export const heldText = (paise: number, lang: Lang, outlet?: string) =>
  lang === 'hi'
    ? `सेव हो गया — ${at(outlet)}${rsOf(paise)}। यह दुकान की क्रेडिट लिमिट से ज़्यादा है, इसलिए मंज़ूरी के लिए ASM के पास गया है। विज़िट दर्ज। आगे बढ़ें।`
    : `Saved — ${at(outlet)}${rsOf(paise)}. It crosses this counter's credit limit, so it has gone to your ASM for approval. Visit recorded. Move on.`;

/** He said yes again, and the order had already gone through. */
export const alreadyText = (paise: number, held: boolean, lang: Lang, outlet?: string) =>
  lang === 'hi'
    ? (held ? `पहले ही सेव हो चुका है ✓ ${at(outlet)}${rsOf(paise)}, ASM की मंज़ूरी का इंतज़ार है।`
            : `पहले ही हो चुका है ✓ ${at(outlet)}${rsOf(paise)}। दोबारा नहीं भेजा।`)
    : (held ? `Already saved ✓ ${at(outlet)}${rsOf(paise)}, waiting on your ASM.`
            : `Already placed ✓ ${at(outlet)}${rsOf(paise)}. Not sent twice.`);

/** A fix to a placed order, sent to the ASM rather than made. */
export const changeSentText = (outlet: string, paise: number, lang: Lang) =>
  lang === 'hi'
    ? `ASM को भेज दिया ✓\n\n${outlet}, ${rsOf(paise)}। जब तक वे तय नहीं करते, ऑर्डर जैसा है वैसा रहेगा।`
    : `Sent to your ASM ✓\n\n${outlet}, ${rsOf(paise)}. The order stays as placed until they decide.`;

export const notedText = (outlet: string, lang: Lang) =>
  lang === 'hi' ? `${outlet} पर दर्ज किया। ✓` : `Noted at ${outlet}. ✓`;

/** What a counter owes and what to know before walking in. Three lines at
 *  most, in the order he can act on them. Built here because a model once
 *  turned "₹21,000 past terms" into "the terms used to be ₹21,000". */
export function briefText(b: {
  counter: string; owesPaise: number; roomPaise: number; overduePaise: number;
  nearExpiry: { name: string; batch_no: string; days: number }[]; usuallyBuys: string[];
}, lang: Lang): string {
  const hi = lang === 'hi';
  const lines = [
    hi ? `${b.counter} — बकाया ${rsOf(b.owesPaise)}, क्रेडिट में ${rsOf(Math.max(0, b.roomPaise))} बाकी।`
       : `${b.counter} — owes ${rsOf(b.owesPaise)}, ${rsOf(Math.max(0, b.roomPaise))} credit left.`,
  ];
  if (b.overduePaise > 0)
    lines.push(hi ? `इसमें ${rsOf(b.overduePaise)} की पेमेंट की तारीख निकल चुकी है। पहले वसूली करें।`
                  : `${rsOf(b.overduePaise)} of it is overdue. Collect first.`);
  const e = b.nearExpiry[0];
  if (e)
    lines.push(hi ? `जल्दी एक्सपायर: ${e.name}, बैच ${e.batch_no}, ${e.days} दिन में।`
                  : `Expiring soon: ${e.name}, batch ${e.batch_no}, in ${e.days} days.`);
  else if (b.usuallyBuys.length)
    lines.push(hi ? `आमतौर पर लेते हैं: ${b.usuallyBuys.slice(0, 3).join(', ')}।`
                  : `Usually buys: ${b.usuallyBuys.slice(0, 3).join(', ')}.`);
  return lines.join('\n');
}
