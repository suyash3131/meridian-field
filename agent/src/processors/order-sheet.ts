import { AI, PreProcessor } from 'lua-cli';
import * as XLSX from 'xlsx';

/**
 * A distributor or a rep sends the order as a document: a PDF order form, or an
 * Excel sheet with a row per product. It becomes what the rep would have typed,
 * one line per counter ("sharma medical 3 baby lotion, 10 dolomed 650, 15 days"),
 * and from there it is an ordinary message: one slip per counter, each confirmed.
 *
 * Spreadsheets and Word files are opened here, in code, because no model reads
 * .xlsx or .docx. PDFs are read by Gemini directly. Either way the model only copies what the document
 * says into lines. It resolves nothing and prices nothing; that stays with the
 * order tools, which check every quantity against these words.
 */
const COPY = [
  'This is an order document for a pharmaceutical company in India.',
  'Copy out the orders it contains as plain lines, one line per shop (counter), in this form:',
  '"<shop name> <qty> <product>, <qty> <product>, <N> days"',
  'Use the shop and product names exactly as written. Quantities as digits.',
  'Add ", <N> days" only if credit days are written for that shop.',
  'Do not total, price, correct or add anything. Output only the lines.',
  'If the document contains no order, output exactly: (not an order)',
].join(' ');

const SHEET = /(spreadsheetml|ms-excel|opendocument\.spreadsheet|text\/csv)/i;
const PDF = /application\/pdf/i;
const WORD = /wordprocessingml/i;               // .docx
// What the agent can take as a file. Anything else gets a plain answer rather
// than being handed to the model to guess at.
const HANDLED = /^(audio\/|video\/ogg|image\/)|application\/pdf|spreadsheetml|ms-excel|opendocument\.spreadsheet|text\/csv|wordprocessingml/i;

/** Bytes of a file part, whether it came as a URL, a data: URI or bare base64. */
async function bytesOf(data: string): Promise<Buffer> {
  if (/^https?:\/\//.test(data)) return Buffer.from(await (await fetch(data)).arrayBuffer());
  return Buffer.from(data.replace(/^data:[^,]*,/, ''), 'base64');
}

/** A Word document's text: paragraphs as lines, table cells split by " | ".
 *  A .docx is a zip; SheetJS's zip reader opens it, so no extra library. */
export function wordAsText(buf: Buffer): string {
  // The zip reader is on the default export when bundled as ESM, on the namespace as CJS.
  const CFB: any = (XLSX as any).CFB ?? (XLSX as any).default?.CFB;
  const zip = CFB.read(buf, { type: 'buffer' });
  const doc = CFB.find(zip, '/word/document.xml');
  if (!doc?.content) throw new Error('no word/document.xml');
  const xml = Buffer.from(doc.content as any).toString('utf8');
  return xml
    // A table row is one line: its cells' paragraphs join with spaces, cells with " | ".
    .replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (t) => t.replace(/<\/w:p>/g, ' ').replace(/<\/w:tc>/g, ' | ').replace(/<\/w:tr>/g, '\n'))
    .replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, ' ').replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .split('\n').map((l) => l.replace(/\s*\|\s*$/, '').trim()).filter(Boolean).slice(0, 400).join('\n');
}

/** Every sheet as CSV, the first 200 rows each: plenty for an order, bounded for a model. */
function sheetAsText(buf: Buffer): string {
  const book = XLSX.read(buf, { type: 'buffer' });
  return book.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_csv(book.Sheets[name], { blankrows: false }).split('\n').slice(0, 200);
    return `Sheet "${name}":\n${rows.join('\n')}`;
  }).join('\n\n');
}

export default new PreProcessor({
  name: 'order-sheet',
  description: 'Turn PDF, Excel and Word order documents into one order line per counter; refuse file types it cannot read',
  priority: 6,
  execute: async (_user, messages) => {
    const unhandled = (messages as any[]).find((m) => m?.type === 'file' && !HANDLED.test(String(m.mediaType ?? '')));
    if (unhandled) {
      console.log('order-sheet unsupported file', unhandled.mediaType);
      return { action: 'block', response:
        `I can't read that kind of file (${String(unhandled.mediaType ?? 'unknown')}). ` +
        'Send the order as a voice note, a photo, a PDF, an Excel sheet or a Word document, or type it.' };
    }
    const isDoc = (m: any) => m?.type === 'file' && (SHEET.test(m.mediaType) || PDF.test(m.mediaType) || WORD.test(m.mediaType));
    if (!messages.some(isDoc)) return { action: 'proceed' };

    const out: any[] = [];
    for (const m of messages as any[]) {
      if (!isDoc(m)) { out.push(m); continue; }
      let lines = '';
      try {
        const content: any[] = [{ type: 'text', text: COPY }];
        if (PDF.test(m.mediaType)) content.push({ type: 'file', data: m.data, mediaType: m.mediaType });
        else if (WORD.test(m.mediaType)) content.push({ type: 'text', text: wordAsText(await bytesOf(m.data)) });
        else content.push({ type: 'text', text: sheetAsText(await bytesOf(m.data)) });
        const r = await AI.generate({
          model: 'google/gemini-3.8-flash',
          temperature: 0,
          messages: [{ role: 'user', content }] as any,
        });
        lines = String(r.text ?? '').trim();
      } catch (err) {
        console.log('order-sheet failed', m.mediaType, String(err));
      }
      console.log('order-sheet read', m.mediaType, JSON.stringify(lines));
      if (!lines)
        return { action: 'block', response: "Couldn't open that file. Send it as a PDF, Excel or Word file, or type the order." };
      if (lines === '(not an order)')
        return { action: 'block', response: "That file doesn't look like an order. Send the order sheet, or type the order." };

      const counters = lines.split('\n').filter((l) => l.trim()).length;
      if (counters > 8)
        return {
          action: 'block',
          response: `That sheet has ${counters} counters. Send up to 8 at a time so each one can be checked and confirmed.`,
        };
      out.push({ type: 'text', text: lines });
    }
    return { action: 'proceed', modifiedMessage: out };
  },
});
