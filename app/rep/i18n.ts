/**
 * Every word the rep app shows, in English and Hindi. Shop and product names
 * stay as they are on the invoice; reps know them in English.
 *
 * Kept as plain functions rather than a library: two languages, one screen,
 * and the Hindi was written for a rep, not machine-translated from the English.
 */
export type Lang = 'en' | 'hi';

const rs = (p: number) => '₹' + Math.round(p / 100).toLocaleString('en-IN');

export const T = {
  en: {
    today: 'Today', chat: 'Chat', attendance: 'Attendance',
    greeting: (h: number, name: string) =>
      `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${name}`,
    tomorrow: 'No route on Sunday. Here is Monday’s.',
    stopsLine: (n: number, d: number) => `${n} stops today${d ? `, ${d} done` : ''}.`,
    collectLine: (amt: number, k: number, first: string) =>
      `Collect ${rs(amt)} from ${k} shop${k > 1 ? 's' : ''}. Start with ${first}.`,
    quietLine: (shop: string, days: number | null) =>
      days === null ? `${shop} has never ordered. Ask for a first order.`
                    : `${shop} hasn’t ordered in ${days} days. Ask for an order.`,
    allDone: 'All done for today. Good work.',
    noStops: 'No stops on your route today.',
    listen: 'Listen', stop: 'Stop',
    progress: (d: number, n: number) => `${d} of ${n} done`,
    task: {
      collect: (amt: number) => `Collect ${rs(amt)}`,
      order: () => 'Take order',
      check: () => 'Check stock',
    },
    done: 'Done', visited: 'Visited',
    directions: 'Directions',
    call: 'Call', callTitle: 'Your area manager',
    callNow: 'Call now', cancel: 'Cancel',
    callDemo: 'Demo numbers aren’t real, so this call won’t connect.',
    presentOf: (p: number, w: number) => `${p} of ${w} working days`,
    visitsOf: (m: number, s: number) => `${m} of ${s} visits`,
    legend: { full: 'Full day', part: 'Part day', missed: 'Missed', none: 'No route' },
    attendanceNote: 'Filled in by your orders and visits. There’s nothing to tap.',
    weekdays: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
    locale: 'en-IN',
    speech: 'en-IN',
  },
  hi: {
    today: 'आज', chat: 'चैट', attendance: 'हाज़िरी',
    greeting: (_h: number, name: string) => `नमस्ते, ${name}`,
    tomorrow: 'रविवार को रूट नहीं है। यह सोमवार का रूट है।',
    stopsLine: (n: number, d: number) => `आज ${n} दुकानें${d ? `, ${d} हो गईं` : ''}।`,
    collectLine: (amt: number, k: number, first: string) =>
      `${k} दुकान${k > 1 ? 'ों' : ''} से ${rs(amt)} वसूलना है। पहले ${first} जाएँ।`,
    quietLine: (shop: string, days: number | null) =>
      days === null ? `${shop} ने अभी तक कोई ऑर्डर नहीं दिया। पहला ऑर्डर माँगें।`
                    : `${shop} ने ${days} दिन से ऑर्डर नहीं दिया। ऑर्डर माँगें।`,
    allDone: 'आज का काम पूरा। शाबाश।',
    noStops: 'आज आपके रूट पर कोई दुकान नहीं है।',
    listen: 'सुनें', stop: 'रोकें',
    progress: (d: number, n: number) => `${n} में से ${d} हो गईं`,
    task: {
      collect: (amt: number) => `${rs(amt)} वसूली`,
      order: () => 'ऑर्डर लें',
      check: () => 'स्टॉक देखें',
    },
    done: 'हो गया', visited: 'विज़िट हुई',
    directions: 'रास्ता',
    call: 'कॉल', callTitle: 'आपके एरिया मैनेजर',
    callNow: 'अभी कॉल करें', cancel: 'रद्द करें',
    callDemo: 'डेमो के नंबर असली नहीं हैं, इसलिए कॉल नहीं लगेगी।',
    presentOf: (p: number, w: number) => `${w} में से ${p} कार्य-दिवस`,
    visitsOf: (m: number, s: number) => `${s} में से ${m} विज़िट`,
    legend: { full: 'पूरा दिन', part: 'आधा दिन', missed: 'छूटा', none: 'रूट नहीं' },
    attendanceNote: 'आपके ऑर्डर और विज़िट से अपने-आप भरती है। कुछ दबाना नहीं है।',
    weekdays: ['सो', 'मं', 'बु', 'गु', 'शु', 'श', 'र'],
    locale: 'hi-IN',
    speech: 'hi-IN',
  },
};

export type Strings = typeof T.en;
