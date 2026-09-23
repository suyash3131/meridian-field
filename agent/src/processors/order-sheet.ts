import { AI, PreProcessor } from 'lua-cli';
import * as XLSX from 'xlsx';

/**
 * A distributor or a rep sends the order as a document: a PDF order form, or an
 * Excel sheet with a row per product. It becomes what the rep would have typed,
 * one line per counter ("sharma medical 3 baby lotion, 10 dolomed 650, 15 days"),
 * and from there it is an ordinary message: one slip per counter, each confirmed.
 *
 * Spreadsheets are opened here, in code, because no model reads .xlsx. PDFs are
 * read by Gemini directly. Either way the model only copies what the document
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

/** Bytes of a file part, whether it came as a URL, a data: URI or bare base64. */
async function bytesOf(data: string): Promise<Buffer> {
  if (/^https?:\/\//.test(data)) return Buffer.from(await (await fetch(data)).arrayBuffer());
  return Buffer.from(data.replace(/^data:[^,]*,/, ''), 'base64');
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
  description: 'Turn PDF and Excel order sheets into one order line per counter',
  priority: 6,
  execute: async (_user, messages) => {
    const isDoc = (m: any) => m?.type === 'file' && (SHEET.test(m.mediaType) || PDF.test(m.mediaType));
    if (!messages.some(isDoc)) return { action: 'proceed' };

    const out: any[] = [];
    for (const m of messages as any[]) {
      if (!isDoc(m)) { out.push(m); continue; }
      let lines = '';
      try {
        const content: any[] = [{ type: 'text', text: COPY }];
        if (PDF.test(m.mediaType)) content.push({ type: 'file', data: m.data, mediaType: m.mediaType });
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
        return { action: 'block', response: "Couldn't open that file. Send it as a PDF or Excel sheet, or type the order." };
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
