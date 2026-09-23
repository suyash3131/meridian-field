// =============================================================================
// MERIDIAN — seed data
//
// The brief: "An empty CRM cannot be assessed, and a CRM full of tidy data
// proves nothing." So this file plants six traps that fire live in the demo:
//
//   1. TWO shops match "sharma"  -> resolved by GPS, not by asking
//   2. FOUR products match "650" -> the one clarifying question
//   3. Sharma Medical is ~₹2,000 under its credit limit -> next order holds
//   4. Krishna Chemist hasn't been visited in 23 days   -> coverage gap
//   5. A Dolomed 650 batch expires in 34 days            -> near-expiry
//   6. Ramesh (R-07) slipped this week                   -> the 8pm question
//
// History is GENERATED, not hand-written, so the numbers on the manager
// screens are real arithmetic over real rows. If the panel checks, it adds up.
// =============================================================================

import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

// Every query here is a round-trip to us-east-1. From a laptop in India that
// is roughly 250ms, and the history generates a few thousand rows, which made
// a seed take twelve minutes. Leaf tables buffer their rows and go out as
// multi-row INSERTs instead — same SQL, a hundredth of the waiting.
const buffers = new Map();
const push = (table, cols, row) => {
  if (!buffers.has(table)) buffers.set(table, { cols, rows: [] });
  buffers.get(table).rows.push(row);
};
const flushAll = async () => {
  for (const [table, { cols, rows }] of buffers) {
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400);
      const params = [];
      const tuples = chunk.map(
        (r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(',')})`);
      await client.query(
        `INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')}`, params);
    }
  }
  buffers.clear();
};

const rupees = (r) => Math.round(r * 100);           // ₹ -> paise

// Deterministic PRNG. Data that changes on every run cannot be reasoned about:
// the manager screens would tell a different story each deploy, and the numbers
// in the write-up would stop matching the numbers in the demo.
// The seed number itself was chosen. At this volume (a few orders per rep per
// day) ordinary noise can be larger than the one dip the data is built around,
// and the first seed hid Ramesh's slip on some weekdays. 218 was picked by
// running candidates in memory and keeping one where the designed story holds
// through the day: North down, Ramesh the cause, everyone else within ~10%.
let _s = 218 >>> 0;
const rnd = () => {
  _s = (_s + 0x6D2B79F5) >>> 0;
  let t = _s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = (p) => rnd() < p;

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const dayOffset = (n) => { const d = new Date(TODAY); d.setDate(d.getDate() + n); return d; };
const iso = (d) => d.toISOString().slice(0, 10);
// Postgres/ISO weekday where 1 = Monday ... 7 = Sunday
const weekday = (d) => (d.getDay() === 0 ? 7 : d.getDay());

// -----------------------------------------------------------------------------
// PEOPLE
// -----------------------------------------------------------------------------
const managers = [
  { id: 'M-00', name: 'Anita Rao',     role: 'regional_head', region: null },
  { id: 'M-01', name: 'Vikram Shetty', role: 'asm',           region: 'North' },
  { id: 'M-02', name: 'Priya Nair',    role: 'asm',           region: 'South' },
];

const reps = [
  { id: 'R-05', name: 'Sunil Yadav',   phone: '+919810000005', asm_id: 'M-01', region: 'North' },
  { id: 'R-07', name: 'Ramesh Kumar',  phone: '+919810000007', asm_id: 'M-01', region: 'North' },
  { id: 'R-06', name: 'Faisal Khan',   phone: '+919810000006', asm_id: 'M-02', region: 'South' },
  { id: 'R-08', name: 'Deepa Menon',   phone: '+919810000008', asm_id: 'M-02', region: 'South' },
];

// -----------------------------------------------------------------------------
// OUTLETS
// Lat/lng are real-ish Delhi / Bengaluru coordinates. The two "Sharma" shops
// are deliberately 2.1 km apart: close enough to confuse a name match,
// far enough that GPS settles it without asking the rep anything.
// -----------------------------------------------------------------------------
const outlets = [
  // --- R-07, North (Karol Bagh / Paharganj) ---
  { id: 'OUT-001', name: 'Sharma Medical Store', area: 'Karol Bagh',   region: 'North', lat: 28.6519, lng: 77.1909,
    rep: 'R-07', limit: 50000, terms: 15, aliases: ['sharma medical', 'sharma', 'sharma store', 'sharmaji'] },
  { id: 'OUT-002', name: 'Sharma Medicos',       area: 'Paharganj',    region: 'North', lat: 28.6448, lng: 77.2100,
    rep: 'R-07', limit: 40000, terms: 15, aliases: ['sharma medicos', 'sharma medico', 'sharma p ganj'] },
  { id: 'OUT-003', name: 'Krishna Chemist',      area: 'Karol Bagh',   region: 'North', lat: 28.6542, lng: 77.1885,
    rep: 'R-07', limit: 35000, terms: 21, aliases: ['krishna chemist', 'krishna', 'krishna medical'] },
  { id: 'OUT-004', name: 'Apollo Pharmacy KB',   area: 'Karol Bagh',   region: 'North', lat: 28.6501, lng: 77.1930,
    rep: 'R-07', limit: 120000, terms: 30, aliases: ['apollo', 'apollo kb', 'apollo karol bagh'] },
  { id: 'OUT-005', name: 'Gupta Medical Hall',   area: 'Paharganj',    region: 'North', lat: 28.6460, lng: 77.2135,
    rep: 'R-07', limit: 45000, terms: 15, aliases: ['gupta medical', 'gupta', 'gupta hall'] },
  { id: 'OUT-006', name: 'New Life Pharmacy',    area: 'Paharganj',    region: 'North', lat: 28.6431, lng: 77.2088,
    rep: 'R-07', limit: 30000, terms: 15, aliases: ['new life', 'newlife pharmacy', 'new life medical'] },

  // --- R-05, North (Rohini / Pitampura) ---
  { id: 'OUT-007', name: 'Bansal Chemist',       area: 'Rohini',       region: 'North', lat: 28.7355, lng: 77.1185,
    rep: 'R-05', limit: 60000, terms: 21, aliases: ['bansal', 'bansal chemist', 'bansal medical'] },
  { id: 'OUT-008', name: 'Care Point Pharmacy',  area: 'Rohini',       region: 'North', lat: 28.7402, lng: 77.1220,
    rep: 'R-05', limit: 45000, terms: 15, aliases: ['care point', 'carepoint'] },
  { id: 'OUT-009', name: 'Saini Medicos',        area: 'Pitampura',    region: 'North', lat: 28.6980, lng: 77.1310,
    rep: 'R-05', limit: 38000, terms: 15, aliases: ['saini', 'saini medicos', 'saini medical'] },
  { id: 'OUT-010', name: 'Wellness Forever PP',  area: 'Pitampura',    region: 'North', lat: 28.7015, lng: 77.1355,
    rep: 'R-05', limit: 90000, terms: 30, aliases: ['wellness', 'wellness forever', 'wf pitampura'] },
  { id: 'OUT-011', name: 'Jain Medical Agency',  area: 'Rohini',       region: 'North', lat: 28.7290, lng: 77.1150,
    rep: 'R-05', limit: 55000, terms: 21, aliases: ['jain medical', 'jain', 'jain agency'] },
  { id: 'OUT-012', name: 'Shree Ram Chemist',    area: 'Pitampura',    region: 'North', lat: 28.6955, lng: 77.1288,
    rep: 'R-05', limit: 32000, terms: 15, aliases: ['shree ram', 'shri ram chemist', 'shreeram'] },

  // --- R-06, South (Jayanagar / JP Nagar) ---
  { id: 'OUT-013', name: 'Sagar Pharma',         area: 'Jayanagar',    region: 'South', lat: 12.9250, lng: 77.5838,
    rep: 'R-06', limit: 70000, terms: 21, aliases: ['sagar', 'sagar pharma', 'sagar medical'] },
  { id: 'OUT-014', name: 'Medplus Jayanagar',    area: 'Jayanagar',    region: 'South', lat: 12.9301, lng: 77.5820,
    rep: 'R-06', limit: 110000, terms: 30, aliases: ['medplus', 'med plus jayanagar'] },
  { id: 'OUT-015', name: 'Lakshmi Medicals',     area: 'JP Nagar',     region: 'South', lat: 12.9080, lng: 77.5855,
    rep: 'R-06', limit: 42000, terms: 15, aliases: ['lakshmi', 'laxmi medicals', 'lakshmi medical'] },
  { id: 'OUT-016', name: 'City Care Chemist',    area: 'JP Nagar',     region: 'South', lat: 12.9115, lng: 77.5902,
    rep: 'R-06', limit: 36000, terms: 15, aliases: ['city care', 'citycare'] },
  { id: 'OUT-017', name: 'Ganesh Medical Store', area: 'Jayanagar',    region: 'South', lat: 12.9282, lng: 77.5795,
    rep: 'R-06', limit: 48000, terms: 21, aliases: ['ganesh', 'ganesh medical', 'ganesh store'] },
  { id: 'OUT-018', name: 'Nakoda Pharma',        area: 'JP Nagar',     region: 'South', lat: 12.9060, lng: 77.5921,
    rep: 'R-06', limit: 29000, terms: 15, aliases: ['nakoda', 'nakoda pharma'] },

  // --- R-08, South (Indiranagar / Koramangala) ---
  { id: 'OUT-019', name: 'Trust Pharmacy',       area: 'Indiranagar',  region: 'South', lat: 12.9719, lng: 77.6412,
    rep: 'R-08', limit: 65000, terms: 21, aliases: ['trust', 'trust pharmacy', 'trust medical'] },
  { id: 'OUT-020', name: 'Koramangala Chemist',  area: 'Koramangala',  region: 'South', lat: 12.9352, lng: 77.6245,
    rep: 'R-08', limit: 52000, terms: 21, aliases: ['koramangala chemist', 'kormangala chemist', 'km chemist'] },
  { id: 'OUT-021', name: 'HealthFirst Indira',   area: 'Indiranagar',  region: 'South', lat: 12.9755, lng: 77.6390,
    rep: 'R-08', limit: 80000, terms: 30, aliases: ['healthfirst', 'health first', 'hf indiranagar'] },
  { id: 'OUT-022', name: 'Shanti Medicals',      area: 'Koramangala',  region: 'South', lat: 12.9330, lng: 77.6198,
    rep: 'R-08', limit: 34000, terms: 15, aliases: ['shanti', 'shanthi medicals', 'shanti medical'] },
  { id: 'OUT-023', name: 'Green Cross Pharmacy', area: 'Indiranagar',  region: 'South', lat: 12.9698, lng: 77.6435,
    rep: 'R-08', limit: 44000, terms: 15, aliases: ['green cross', 'greencross'] },
  { id: 'OUT-024', name: 'Sai Krupa Medicals',   area: 'Koramangala',  region: 'South', lat: 12.9375, lng: 77.6270,
    rep: 'R-08', limit: 27000, terms: 15, aliases: ['sai krupa', 'saikrupa', 'sai krupa medical'] },
];

// -----------------------------------------------------------------------------
// CATALOGUE
// Note SKU 1-4: four different products a rep would all call "650".
// This is the ambiguity the agent has to survive, and it is real —
// same molecule, different pack, different brand, different price.
// -----------------------------------------------------------------------------
// An alias names a thing. "650" names a family — four packs answer to it — so
// it belongs to all four rather than to whichever one we picked first. Sharing
// it means a generic phrase cannot be resolved by name alone, and has to fall
// through to evidence: what this counter actually buys. That is the difference
// between an agent that asks when it doesn't know and one that guesses.
const FAMILY_650 = ['650', '650 tablets', '650 tablet', 'para 650', 'paracetamol 650'];

const skus = [
  // --- pain relief ---
  { id: 'SKU-DOL650-10X10', name: 'Dolomed 650', brand: 'Dolomed', molecule: 'Paracetamol 650mg',
    pack: '10x10 tablets', upb: 100, cat: 'Pain Relief', mrp: 120, ptr: 84,
    aliases: [...FAMILY_650, 'dolomed 650', 'dolomed', 'dolomed 10x10'] },
  { id: 'SKU-DOL650-5X10',  name: 'Dolomed 650 (small pack)', brand: 'Dolomed', molecule: 'Paracetamol 650mg',
    pack: '5x10 tablets', upb: 50, cat: 'Pain Relief', mrp: 62, ptr: 43,
    aliases: [...FAMILY_650, '650 small', 'dolomed 5x10', 'dolomed small'] },
  { id: 'SKU-DOLP650-10X10', name: 'Dolomed Plus 650', brand: 'Dolomed', molecule: 'Paracetamol 650mg + Caffeine 50mg',
    pack: '10x10 tablets', upb: 100, cat: 'Pain Relief', mrp: 165, ptr: 115,
    aliases: [...FAMILY_650, 'dolomed plus', '650 plus', 'plus 650'] },
  { id: 'SKU-FEV650-10X10', name: 'Feverlite 650 DT', brand: 'Feverlite', molecule: 'Paracetamol 650mg dispersible',
    pack: '10x10 tablets', upb: 100, cat: 'Pain Relief', mrp: 138, ptr: 96,
    aliases: [...FAMILY_650, 'feverlite', '650 dt', 'feverlite 650', 'dt 650'] },

  { id: 'SKU-DOL500-10X10', name: 'Dolomed 500', brand: 'Dolomed', molecule: 'Paracetamol 500mg',
    pack: '10x10 tablets', upb: 100, cat: 'Pain Relief', mrp: 95, ptr: 66,
    aliases: ['500', 'dolomed 500', 'para 500', '500 tablets'] },
  { id: 'SKU-NIMU100', name: 'Nimufast 100', brand: 'Nimufast', molecule: 'Nimesulide 100mg',
    pack: '10x10 tablets', upb: 100, cat: 'Pain Relief', mrp: 145, ptr: 101,
    aliases: ['nimufast', 'nimesulide', 'nimu'] },
  { id: 'SKU-IBU400', name: 'Ibucalm 400', brand: 'Ibucalm', molecule: 'Ibuprofen 400mg',
    pack: '10x10 tablets', upb: 100, cat: 'Pain Relief', mrp: 110, ptr: 77,
    aliases: ['ibucalm', 'ibuprofen', 'ibu 400'] },
  { id: 'SKU-DICLO50', name: 'Diclomer 50', brand: 'Diclomer', molecule: 'Diclofenac 50mg',
    pack: '10x10 tablets', upb: 100, cat: 'Pain Relief', mrp: 128, ptr: 89,
    aliases: ['diclomer', 'diclofenac', 'diclo'] },
  { id: 'SKU-BALM-30G', name: 'Meridian Pain Balm 30g', brand: 'Meridian', molecule: null,
    pack: '30g jar', upb: 1, cat: 'Pain Relief', mrp: 85, ptr: 59,
    aliases: ['balm', 'pain balm', 'meridian balm'] },
  { id: 'SKU-SPRAY-50ML', name: 'Meridian Relief Spray 50ml', brand: 'Meridian', molecule: null,
    pack: '50ml bottle', upb: 1, cat: 'Pain Relief', mrp: 195, ptr: 136,
    aliases: ['spray', 'relief spray', 'pain spray'] },

  // --- supplements ---
  { id: 'SKU-CALCI-30', name: 'Calcimax D3', brand: 'Calcimax', molecule: 'Calcium + Vitamin D3',
    pack: '30 tablets', upb: 30, cat: 'Supplements', mrp: 210, ptr: 147,
    aliases: ['calcimax', 'calcium', 'calci d3'] },
  { id: 'SKU-IRON-30', name: 'Ironwell', brand: 'Ironwell', molecule: 'Ferrous Ascorbate',
    pack: '30 tablets', upb: 30, cat: 'Supplements', mrp: 185, ptr: 129,
    aliases: ['ironwell', 'iron', 'iron tablets'] },
  { id: 'SKU-MULTIVIT-30', name: 'Vitaplus Multivitamin', brand: 'Vitaplus', molecule: 'Multivitamin',
    pack: '30 capsules', upb: 30, cat: 'Supplements', mrp: 240, ptr: 168,
    aliases: ['vitaplus', 'multivitamin', 'multi vitamin', 'vitamin'] },
  { id: 'SKU-VITC-20', name: 'Vitamin C 500 Chewable', brand: 'Vitaplus', molecule: 'Ascorbic Acid 500mg',
    pack: '20 tablets', upb: 20, cat: 'Supplements', mrp: 130, ptr: 91,
    aliases: ['vitamin c', 'vit c', 'chewable'] },
  { id: 'SKU-ZINC-20', name: 'Zincoral', brand: 'Zincoral', molecule: 'Zinc 50mg',
    pack: '20 tablets', upb: 20, cat: 'Supplements', mrp: 98, ptr: 68,
    aliases: ['zincoral', 'zinc'] },
  { id: 'SKU-PROTEIN-200', name: 'Meridian Protein Powder 200g', brand: 'Meridian', molecule: null,
    pack: '200g tin', upb: 1, cat: 'Supplements', mrp: 450, ptr: 315,
    aliases: ['protein', 'protein powder'] },
  { id: 'SKU-OMEGA-30', name: 'Omega Gold', brand: 'Omega Gold', molecule: 'Omega-3',
    pack: '30 capsules', upb: 30, cat: 'Supplements', mrp: 320, ptr: 224,
    aliases: ['omega', 'omega gold', 'fish oil'] },
  { id: 'SKU-B12-30', name: 'B-Complex Forte', brand: 'Vitaplus', molecule: 'Vitamin B Complex',
    pack: '30 tablets', upb: 30, cat: 'Supplements', mrp: 155, ptr: 108,
    aliases: ['b complex', 'bcomplex', 'b12'] },

  // --- first aid ---
  { id: 'SKU-BAND-100', name: 'Meridian Band Aid 100s', brand: 'Meridian', molecule: null,
    pack: 'box of 100', upb: 100, cat: 'First Aid', mrp: 250, ptr: 175,
    aliases: ['band aid', 'bandaid', 'band aid 100', 'bandage strips'] },
  { id: 'SKU-BAND-20', name: 'Meridian Band Aid 20s', brand: 'Meridian', molecule: null,
    pack: 'box of 20', upb: 20, cat: 'First Aid', mrp: 60, ptr: 42,
    aliases: ['band aid small', 'bandaid 20'] },
  { id: 'SKU-GAUZE-10', name: 'Sterile Gauze Pack', brand: 'Meridian', molecule: null,
    pack: '10 pieces', upb: 10, cat: 'First Aid', mrp: 90, ptr: 63,
    aliases: ['gauze', 'sterile gauze'] },
  { id: 'SKU-ANTISEP-100', name: 'Antiseptic Liquid 100ml', brand: 'Meridian', molecule: null,
    pack: '100ml bottle', upb: 1, cat: 'First Aid', mrp: 75, ptr: 52,
    aliases: ['antiseptic', 'antiseptic 100', 'dettol type'] },
  { id: 'SKU-ANTISEP-500', name: 'Antiseptic Liquid 500ml', brand: 'Meridian', molecule: null,
    pack: '500ml bottle', upb: 1, cat: 'First Aid', mrp: 265, ptr: 185,
    aliases: ['antiseptic big', 'antiseptic 500'] },
  { id: 'SKU-COTTON-100', name: 'Absorbent Cotton 100g', brand: 'Meridian', molecule: null,
    pack: '100g roll', upb: 1, cat: 'First Aid', mrp: 70, ptr: 49,
    aliases: ['cotton', 'rui', 'absorbent cotton'] },
  { id: 'SKU-TAPE-1', name: 'Micropore Tape 1 inch', brand: 'Meridian', molecule: null,
    pack: 'single roll', upb: 1, cat: 'First Aid', mrp: 55, ptr: 38,
    aliases: ['tape', 'micropore', 'surgical tape'] },
  { id: 'SKU-CREPE-10', name: 'Crepe Bandage 10cm', brand: 'Meridian', molecule: null,
    pack: 'single roll', upb: 1, cat: 'First Aid', mrp: 120, ptr: 84,
    aliases: ['crepe', 'crepe bandage', 'bandage'] },

  // --- baby care ---
  { id: 'SKU-BLOTION-200', name: 'Meridian Baby Lotion 200ml', brand: 'Meridian Baby', molecule: null,
    pack: '200ml bottle', upb: 1, cat: 'Baby Care', mrp: 230, ptr: 161,
    aliases: ['baby lotion', 'lotion', 'baby loson', 'baby lotion 200'] },
  { id: 'SKU-BLOTION-100', name: 'Meridian Baby Lotion 100ml', brand: 'Meridian Baby', molecule: null,
    pack: '100ml bottle', upb: 1, cat: 'Baby Care', mrp: 135, ptr: 95,
    aliases: ['baby lotion small', 'lotion 100'] },
  { id: 'SKU-BSOAP-75', name: 'Meridian Baby Soap 75g', brand: 'Meridian Baby', molecule: null,
    pack: '75g bar', upb: 1, cat: 'Baby Care', mrp: 65, ptr: 46,
    aliases: ['baby soap', 'soap'] },
  { id: 'SKU-BPOWDER-200', name: 'Meridian Baby Powder 200g', brand: 'Meridian Baby', molecule: null,
    pack: '200g tin', upb: 1, cat: 'Baby Care', mrp: 180, ptr: 126,
    aliases: ['baby powder', 'powder', 'talc'] },
  { id: 'SKU-BOIL-200', name: 'Meridian Baby Massage Oil 200ml', brand: 'Meridian Baby', molecule: null,
    pack: '200ml bottle', upb: 1, cat: 'Baby Care', mrp: 245, ptr: 172,
    aliases: ['baby oil', 'massage oil', 'malish oil'] },
  { id: 'SKU-BSHAMPOO-200', name: 'Meridian Baby Shampoo 200ml', brand: 'Meridian Baby', molecule: null,
    pack: '200ml bottle', upb: 1, cat: 'Baby Care', mrp: 215, ptr: 151,
    aliases: ['baby shampoo', 'shampoo'] },
  { id: 'SKU-DIAPER-RASH', name: 'Diaper Rash Cream 50g', brand: 'Meridian Baby', molecule: null,
    pack: '50g tube', upb: 1, cat: 'Baby Care', mrp: 190, ptr: 133,
    aliases: ['rash cream', 'diaper cream', 'nappy cream'] },

  // --- wellness ---
  { id: 'SKU-HONEY-500', name: 'Meridian Honey 500g', brand: 'Meridian', molecule: null,
    pack: '500g jar', upb: 1, cat: 'Wellness', mrp: 340, ptr: 238,
    aliases: ['honey', 'shahad'] },
  { id: 'SKU-CHYAWAN-500', name: 'Meridian Chyawanprash 500g', brand: 'Meridian', molecule: null,
    pack: '500g jar', upb: 1, cat: 'Wellness', mrp: 285, ptr: 200,
    aliases: ['chyawanprash', 'chawanprash', 'chyawan'] },
  { id: 'SKU-SANITIZER', name: 'Hand Sanitizer 200ml', brand: 'Meridian', molecule: null,
    pack: '200ml bottle', upb: 1, cat: 'Wellness', mrp: 110, ptr: 77,
    aliases: ['sanitizer', 'hand sanitizer'] },
];

// Reasons a counter gives for not ordering. "No order" is not a blank —
// it is often the most valuable thing a rep brings back. Weighted so that
// competitor pressure in the North shows up as a real, findable cause.
const NO_ORDER_REASONS = [
  'stock bhara hai, next week dekhenge',
  'shop closed, shutter down',
  'owner not there, staff cannot order',
  'payment pending bol rahe hain',
];
const COMPETITOR_REASONS = [
  'Cipla ne offer diya hai, 10+3 de rahe hain',
  'Cipla rep aaya tha, unka scheme better hai',
  'competitor ne shelf le liya, upar wala rack',
];

async function main() {
  await client.connect();

  console.log('→ creating schema');
  await client.query(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));

  // ---------------------------------------------------------------- people
  for (const m of managers)
    await client.query(
      'INSERT INTO managers (id,name,role,region) VALUES ($1,$2,$3,$4)',
      [m.id, m.name, m.role, m.region]);

  for (const r of reps)
    await client.query(
      'INSERT INTO reps (id,name,phone,asm_id,region) VALUES ($1,$2,$3,$4,$5)',
      [r.id, r.name, r.phone, r.asm_id, r.region]);

  // Real inboxes for the email channel. They come from .env.local, never from
  // this file, because the repo is public: one rep, one ASM, and one address
  // that stands in for every chemist so the confirmations can be watched live.
  const E = process.env;
  if (E.DEMO_REP_EMAIL)
    await client.query('UPDATE reps SET email=$1 WHERE id=$2', [E.DEMO_REP_EMAIL.toLowerCase(), 'R-07']);
  if (E.DEMO_ASM_EMAIL)
    await client.query('UPDATE managers SET email=$1 WHERE id=$2', [E.DEMO_ASM_EMAIL.toLowerCase(), 'M-01']);

  // --------------------------------------------------------------- outlets
  for (const o of outlets) {
    await client.query(
      `INSERT INTO outlets (id,name,area,region,lat,lng,drug_licence,gstin,
                            credit_limit_paise,credit_terms_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [o.id, o.name, o.area, o.region, o.lat, o.lng,
       `DL-${o.region.slice(0,1)}-${o.id.slice(-3)}-${between(10000,99999)}`,
       `0${between(6,9)}AABCM${between(1000,9999)}K1Z${between(1,9)}`,
       rupees(o.limit), o.terms]);
    if (E.DEMO_CHEMIST_EMAIL)
      await client.query('UPDATE outlets SET email=$1 WHERE id=$2', [E.DEMO_CHEMIST_EMAIL.toLowerCase(), o.id]);

    for (const a of o.aliases)
      push('outlet_aliases', ['outlet_id','alias','source','hits'],
           [o.id, a, 'seed', between(0, 12)]);
  }

  // ----------------------------------------------------------------- beats
  // Each rep works two alternating routes: Mon/Wed/Fri and Tue/Thu/Sat.
  // (A real beat is ~20 counters; scaled down here so the demo data stays
  // readable. The coverage arithmetic is identical either way.)
  const beatOf = {};                       // repId -> { weekday -> [outletIds] }
  for (const r of reps) {
    const mine = outlets.filter((o) => o.rep === r.id).map((o) => o.id);
    const routeA = mine.slice(0, 3);
    const routeB = mine.slice(3);
    beatOf[r.id] = {};
    for (const wd of [1, 2, 3, 4, 5, 6]) {
      const route = wd % 2 === 1 ? routeA : routeB;   // odd weekday = route A
      const beatId = `BEAT-${r.id}-${wd}`;
      await client.query(
        'INSERT INTO beats (id,rep_id,weekday,name) VALUES ($1,$2,$3,$4)',
        [beatId, r.id, wd, `${r.name.split(' ')[0]} — ${wd % 2 === 1 ? 'Route A' : 'Route B'}`]);
      for (let i = 0; i < route.length; i++)
        push('beat_outlets', ['beat_id','outlet_id','seq'], [beatId, route[i], i + 1]);
      beatOf[r.id][wd] = route;
    }
  }

  // ------------------------------------------------------------- catalogue
  for (const s of skus) {
    await client.query(
      `INSERT INTO skus (id,name,brand,molecule,pack_desc,units_per_box,category,
                         mrp_paise,ptr_paise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [s.id, s.name, s.brand, s.molecule, s.pack, s.upb, s.cat, rupees(s.mrp), rupees(s.ptr)]);
    for (const a of s.aliases)
      push('sku_aliases', ['sku_id','alias','source','hits'],
           [s.id, a, 'seed', between(0, 20)]);
  }

  // --------------------------------------------------------------- batches
  // TRAP 5: one Dolomed 650 batch expires 34 days from today.
  let batchN = 0;
  for (const s of skus) {
    const count = between(1, 2);
    for (let i = 0; i < count; i++) {
      const mfg = dayOffset(-between(200, 600));
      const exp = new Date(mfg); exp.setMonth(exp.getMonth() + 24);
      push('batches', ['id','sku_id','batch_no','mfg_date','expiry_date'],
        [`B-${String(++batchN).padStart(4, '0')}`, s.id,
         `${s.id.split('-')[1]}-${iso(mfg).slice(2, 7).replace('-', '')}${String.fromCharCode(65 + i)}`, iso(mfg), iso(exp)]);
    }
  }
  await client.query(
    `INSERT INTO batches (id,sku_id,batch_no,mfg_date,expiry_date) VALUES ($1,$2,$3,$4,$5)`,
    ['B-NEAREXP', 'SKU-DOL650-10X10', 'DOL650-2410',
     iso(dayOffset(-696)), iso(dayOffset(34))]);        // <- expires next month

  // --------------------------------------------------------------- schemes
  await client.query(
    `INSERT INTO schemes (id,description,sku_id,buy_qty,free_qty,valid_from,valid_to)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    ['SCH-DOL650', 'Dolomed 650 — buy 2 boxes, get 1 free', 'SKU-DOL650-10X10',
     2, 1, iso(dayOffset(-20)), iso(dayOffset(10))]);
  await client.query(
    `INSERT INTO schemes (id,description,category,buy_qty,free_qty,valid_from,valid_to)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    ['SCH-BABY', 'Baby Care — buy 5, get 1 free', 'Baby Care',
     5, 1, iso(dayOffset(-20)), iso(dayOffset(10))]);

  console.log('→ masters loaded:', outlets.length, 'outlets,', skus.length, 'SKUs');

  // ===========================================================================
  // TWO WEEKS OF HISTORY
  //
  // Generated, not hand-written. Coverage and order values are driven by a
  // per-rep, per-week probability, so the numbers the manager screens show are
  // honest arithmetic over real rows. Last week everyone did fine. This week
  // Ramesh (R-07) slipped — which is the answer to the 8pm question, and it is
  // findable in the data rather than typed into a slide.
  // ===========================================================================

  const outletById = Object.fromEntries(outlets.map((o) => [o.id, o]));
  const orderable  = skus.filter((s) => s.id !== 'SKU-DOL650-5X10');

  // Counters reorder the same fast movers week after week and sample the rest
  // occasionally. Picking SKUs uniformly at random produced a dataset where no
  // counter had a buying pattern at all — unrealistic, and it left the resolver
  // with no history to lean on, so it had to ask about every ambiguous phrase.
  // Every chemist in the country sells paracetamol, so it anchors every basket.
  const FAST_MOVERS = ['SKU-DOL650-10X10', 'SKU-DOL500-10X10', 'SKU-BAND-100',
                       'SKU-ANTISEP-100', 'SKU-BLOTION-200', 'SKU-CALCI-30',
                       'SKU-COTTON-100', 'SKU-MULTIVIT-30'];
  const regularBasket = {};
  for (const o of outlets) {
    const basket = new Set(['SKU-DOL650-10X10']);
    while (basket.size < 5) basket.add(chance(0.6) ? pick(FAST_MOVERS) : pick(orderable).id);
    regularBasket[o.id] = [...basket];
  }

  let vN = 0, oN = 0, iN = 0, pN = 0;
  const newVisit = () => `V-${String(++vN).padStart(4, '0')}`;
  const newOrder = () => `ORD-${String(1000 + (++oN))}`;
  const newInv   = () => `INV-${String(5000 + (++iN))}`;
  const newPay   = () => `PAY-${String(3000 + (++pN))}`;

  // Rough metres between two lat/lng points. Good enough at city scale, and
  // it is the same function the agent uses to check a rep's location.
  const metres = (aLat, aLng, bLat, bLng) => {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
    const h = Math.sin(dLat / 2) ** 2
            + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  };

  const openInvoices = [];   // collected as we go, so collections look real

  // Four weeks, not two. Credit terms run 15-30 days, so a shorter window
  // cannot contain a genuinely overdue invoice or a counter that has been
  // cold for three weeks — and both of those are the point.
  for (let d = -27; d <= 0; d++) {
    const day = dayOffset(d);
    const wd  = weekday(day);
    if (wd === 7) continue;                       // Sunday: nobody works
    const thisWeek = d >= -6;

    for (const r of reps) {
      const route = beatOf[r.id][wd] ?? [];

      // The one deliberate dip in the whole dataset.
      // One rep slips; everyone else holds steady. A single moving part means
      // "why is north down" resolves to one name with a number attached,
      // rather than four reps drifting and no cause worth acting on.
      const coverage = thisWeek && r.id === 'R-07' ? 0.50
                     :                               0.93;

      for (let seq = 0; seq < route.length; seq++) {
        const outlet = outletById[route[seq]];

        // TRAP 4: Krishna Chemist has not been seen for 23 days.
        if (outlet.id === 'OUT-003' && d > -23) continue;
        if (!chance(coverage)) continue;

        // A visit happens some time between 9am and 7pm, in route order.
        const at = new Date(day);
        at.setHours(9 + Math.floor(seq * 3.2), between(0, 59), 0, 0);

        // Evidence. Most visits are honest: the rep is within ~60m of the shop.
        // A few land far away — those get flagged, not blocked.
        const honest = chance(0.93);
        const jitter = honest ? 0.0004 : 0.03;
        const gLat = outlet.lat + (rnd() - 0.5) * jitter;
        const gLng = outlet.lng + (rnd() - 0.5) * jitter;
        const dist = metres(gLat, gLng, outlet.lat, outlet.lng);
        const verification = dist <= 200 ? 'verified' : 'flagged';

        // Competitor pressure is concentrated in the North this week —
        // so "why is north down" has a real, discoverable cause.
        const competitorPressure = thisWeek && r.region === 'North' ? 0.60 : 0.12;
        const roll = rnd();
        const outcome = roll < 0.60 ? 'order'
                      : roll < 0.87 ? 'no_order'
                      :               'collection';

        const reason = outcome !== 'no_order' ? null
                     : chance(competitorPressure) ? pick(COMPETITOR_REASONS)
                     :                              pick(NO_ORDER_REASONS);

        const visitId = newVisit();
        await client.query(
          `INSERT INTO visits (id,outlet_id,rep_id,occurred_at,outcome,no_order_reason,
                               on_beat,beat_seq,out_of_sequence,gps_lat,gps_lng,
                               gps_distance_m,photo_url,verification,verification_note,raw_message)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [visitId, outlet.id, r.id, at.toISOString(), outcome, reason,
           true, seq + 1, false, gLat, gLng, dist,
           `https://cdn.example.com/visits/${visitId}.jpg`,
           verification,
           verification === 'flagged' ? `location ${dist}m from outlet` : null,
           reason ?? null]);

        // ---- an order ----
        if (outcome === 'order') {
          const orderId  = newOrder();
          const lineCnt  = between(3, 5);
          const chosen   = [];
          const basket   = regularBasket[outlet.id];
          for (let guard = 0; chosen.length < lineCnt && guard < 40; guard++) {
            const id = chance(0.7) ? pick(basket) : pick(orderable).id;
            const s  = orderable.find((x) => x.id === id);
            if (s && !chosen.find((c) => c.id === s.id)) chosen.push(s);
          }

          let subtotal = 0, discount = 0;
          const lines = chosen.map((s) => {
            const unit       = rupees(s.ptr);
            // Narrow. A counter's line value varies far less in reality than a uniform
            // draw suggests, and a wide spread meant one lucky order could hide a rep
            // missing half his route — which is exactly the signal the manager needs.
            const targetValue = rupees(between(2400, 3200));
            const qty         = Math.max(2, Math.min(60, Math.round(targetValue / unit)));
            const tot  = unit * qty;
            subtotal  += tot;
            let freeQty = 0, schemeId = null;
            if (s.id === 'SKU-DOL650-10X10' && qty >= 2) {
              freeQty  = Math.floor(qty / 2);
              schemeId = 'SCH-DOL650';
              discount += unit * freeQty;
            }
            return { s, qty, unit, tot, freeQty, schemeId };
          });

          const total = subtotal - discount;

          const fingerprint = [r.id, outlet.id,
            ...lines.map((l) => `${l.s.id}x${l.qty}`).sort()].join('|');

          await client.query(
            `INSERT INTO orders (id,outlet_id,rep_id,visit_id,status,credit_terms_days,
                                 subtotal_paise,scheme_discount_paise,total_paise,
                                 fingerprint,source_message,created_at,confirmed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [orderId, outlet.id, r.id, visitId, 'confirmed', outlet.terms,
             subtotal, discount, total, fingerprint,
             null, at.toISOString(), at.toISOString()]);

          for (const l of lines)
            push('order_lines',
              ['order_id','sku_id','qty','unit_price_paise','line_total_paise',
               'scheme_id','free_qty','matched_from','match_confidence','match_method'],
              [orderId, l.s.id, l.qty, l.unit, l.tot, l.schemeId, l.freeQty,
               pick(l.s.aliases), 0.8 + rnd() * 0.2, chance(0.85) ? 'alias' : 'asked']);

          // ---- the invoice that follows the delivery ----
          const issued = new Date(at); issued.setDate(issued.getDate() + 2);
          const due    = new Date(issued); due.setDate(due.getDate() + outlet.terms);
          const invId  = newInv();
          await client.query(
            `INSERT INTO invoices (id,order_id,outlet_id,amount_paise,issued_on,due_on,status)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [invId, orderId, outlet.id, total, iso(issued), iso(due), 'open']);
          openInvoices.push({ invId, outlet, amount: total, due, issued });

          // ---- instrumentation, so /health has real history ----
          const threadId = `th_${orderId}`;
          const asked    = chance(0.3) ? 1 : 0;
          const elapsed  = between(9000, 52000);
          for (const [ev, ms, q] of [
            ['message_in',  0,            0],
            ['draft_built', between(1200, 3500), 0],
            ...(asked ? [['question_asked', between(4000, 9000), 1]] : []),
            ['confirmed',   elapsed,      asked],
          ])
            push('agent_events',
              ['at','rep_id','thread_id','event','order_id','visit_id',
               'ms_since_first','questions_so_far','meta'],
              [new Date(at.getTime() + ms).toISOString(), r.id, threadId, ev,
               orderId, visitId, ms, q, null]);
        }

        // ---- a collection ----
        if (outcome === 'collection') {
          const candidates = openInvoices.filter(
            (i) => i.outlet.id === outlet.id && i.issued <= at);
          if (candidates.length) {
            const inv = pick(candidates);
            await client.query(
              `INSERT INTO payments (id,invoice_id,outlet_id,rep_id,visit_id,
                                     amount_paise,mode,collected_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [newPay(), inv.invId, outlet.id, r.id, visitId,
               inv.amount, pick(['cash', 'upi', 'cheque']), at.toISOString()]);
            await client.query("UPDATE invoices SET status='paid' WHERE id=$1", [inv.invId]);
            openInvoices.splice(openInvoices.indexOf(inv), 1);
          }
        }
      }
    }
  }

  // Older invoices outside the North mostly get settled on time, so overdue
  // money concentrates where the story is.
  for (const inv of [...openInvoices]) {
    const overdue = inv.due < TODAY;
    const settles = inv.outlet.region === 'North' ? 0.45 : 0.85;
    if (overdue && chance(settles)) {
      const paidAt = new Date(inv.due); paidAt.setDate(paidAt.getDate() - between(0, 3));
      await client.query(
        `INSERT INTO payments (id,invoice_id,outlet_id,rep_id,amount_paise,mode,collected_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [newPay(), inv.invId, inv.outlet.id, null, inv.amount,
         pick(['cash', 'upi', 'neft']), paidAt.toISOString()]);
      await client.query("UPDATE invoices SET status='paid' WHERE id=$1", [inv.invId]);
      openInvoices.splice(openInvoices.indexOf(inv), 1);
    }
  }


  // ===========================================================================
  // OPENING RECEIVABLES
  // Credit terms are 15-30 days and the generated history is 14 days long, so
  // nothing in it can be overdue yet. A real deployment inherits a receivables
  // book on day one. The North settles less often than the South, which is
  // what makes "why is north down" answerable with money as well as coverage.
  // ===========================================================================
  for (const o of outlets) {
    const settles = o.region === 'North' ? 0.55 : 0.88;
    for (let k = 0; k < between(2, 5); k++) {
      const issued = dayOffset(-between(20, 100));
      const due    = new Date(issued); due.setDate(due.getDate() + o.terms);
      const amount = rupees(between(3000, 20000));
      const invId  = newInv();
      const paid   = chance(settles);
      await client.query(
        `INSERT INTO invoices (id,outlet_id,amount_paise,issued_on,due_on,status)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [invId, o.id, amount, iso(issued), iso(due), paid ? 'paid' : 'open']);
      if (paid) {
        const paidAt = new Date(due); paidAt.setDate(paidAt.getDate() - between(0, 5));
        await client.query(
          `INSERT INTO payments (id,invoice_id,outlet_id,rep_id,amount_paise,mode,collected_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [newPay(), invId, o.id, o.rep, amount, pick(['cash','upi','neft','cheque']),
           paidAt.toISOString()]);
      }
    }
  }

  // ===========================================================================
  // TRAP 3 — Sharma Medical sits just under its ₹50,000 limit.
  // The next real order at that counter crosses it, live, on camera.
  // ===========================================================================
  const sharma = outletById['OUT-001'];
  const { rows: [owed] } = await client.query(
    `SELECT COALESCE(SUM(amount_paise),0)::bigint AS due
       FROM invoices WHERE outlet_id=$1 AND status<>'paid'`, ['OUT-001']);
  // Settle whatever the generated history left open at this counter, then
  // build the balance deliberately. Adjusting toward a target only works while
  // the history stays below it; constructing it works every time.
  const { rows: stale } = await client.query(
    `SELECT id, amount_paise FROM invoices WHERE outlet_id='OUT-001' AND status<>'paid'`);
  for (const inv of stale) {
    await client.query(
      `INSERT INTO payments (id,invoice_id,outlet_id,rep_id,amount_paise,mode,collected_at)
       VALUES ($1,$2,'OUT-001','R-07',$3,'upi',$4)`,
      [newPay(), inv.id, inv.amount_paise, dayOffset(-30).toISOString()]);
    await client.query("UPDATE invoices SET status='paid' WHERE id=$1", [inv.id]);
  }

  // ₹48,000 against a ₹50,000 limit: ₹2,000 of headroom, so the next real
  // order at this counter crosses the line during the demo.
  for (const [amount, issuedDays] of [[21000, -26], [18000, -12], [9000, -4]]) {
    const issued = dayOffset(issuedDays);
    const due    = new Date(issued); due.setDate(due.getDate() + sharma.terms);
    await client.query(
      `INSERT INTO invoices (id,outlet_id,amount_paise,issued_on,due_on,status)
       VALUES ($1,'OUT-001',$2,$3,$4,'open')`,
      [newInv(), rupees(amount), iso(issued), iso(due)]);
  }

  // Four orders already stuck behind that limit this week.
  for (let k = 0; k < 4; k++) {
    const heldId = newOrder();
    const at = dayOffset(-(k + 1)); at.setHours(between(10, 17), between(0, 59));
    const s = pick(orderable);
    const unit = rupees(s.ptr);
    // Size these the same way every other order is sized, or "four orders held"
    // adds up to a number too small for anyone to care about.
    const qty = Math.max(2, Math.min(60, Math.round(rupees(between(2400, 3200)) / unit)));
    const tot = unit * qty;
    await client.query(
      `INSERT INTO orders (id,outlet_id,rep_id,status,credit_terms_days,
                           subtotal_paise,scheme_discount_paise,total_paise,
                           fingerprint,source_message,created_at)
       VALUES ($1,$2,$3,'held_credit',$4,$5,0,$6,$7,$8,$9)`,
      [heldId, 'OUT-001', 'R-07', sharma.terms, tot, tot,
       `R-07|OUT-001|${s.id}x${qty}`,
       `sharma medical ${qty} ${pick(s.aliases)}`, at.toISOString()]);
    await client.query(
      `INSERT INTO order_lines (order_id,sku_id,qty,unit_price_paise,line_total_paise,
                                matched_from,match_confidence,match_method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'alias')`,
      [heldId, s.id, qty, unit, tot, pick(s.aliases), 0.9]);
    await client.query(
      `INSERT INTO approvals (id,kind,subject_id,outlet_id,requested_by,assigned_to,
                              reason,status,created_at)
       VALUES ($1,'credit_override',$2,$3,$4,$5,$6,'pending',$7)`,
      [`APR-${String(k + 1).padStart(3, '0')}`, heldId, 'OUT-001', 'R-07', 'M-01',
       `Order takes Sharma Medical past its ₹50,000 credit limit`, at.toISOString()]);
  }

  // A handful of drafts nobody ever confirmed — the early-warning signal.
  for (let k = 0; k < 5; k++) {
    const at = dayOffset(-between(0, 5)); at.setHours(between(10, 18), between(0, 59));
    const r = pick(reps);
    await client.query(
      `INSERT INTO agent_events (at,rep_id,thread_id,event,ms_since_first,questions_so_far)
       VALUES ($1,$2,$3,'message_in',0,0)`,
      [at.toISOString(), r.id, `th_aband_${k}`]);
    await client.query(
      `INSERT INTO agent_events (at,rep_id,thread_id,event,ms_since_first,questions_so_far)
       VALUES ($1,$2,$3,'abandoned',$4,$5)`,
      [new Date(at.getTime() + between(30000, 120000)).toISOString(),
       r.id, `th_aband_${k}`, between(30000, 120000), between(1, 2)]);
  }

  await flushAll();

  // ------------------------------------------------------------------ report
  const q = async (sql, p = []) => (await client.query(sql, p)).rows;
  const [{ count: visitCount }]  = await q('SELECT count(*) FROM visits');
  const [{ count: orderCount }]  = await q("SELECT count(*) FROM orders WHERE status='confirmed'");
  const week = await q(`
    WITH v AS (
      SELECT rep_id,
             count(*) FILTER (WHERE occurred_at >= now() - interval '7 days') AS v_this,
             count(*) FILTER (WHERE occurred_at <  now() - interval '7 days'
                      AND occurred_at >= now() - interval '14 days') AS v_last
        FROM visits GROUP BY rep_id)
    SELECT o.rep_id, r.region, v.v_this, v.v_last,
           SUM(o.total_paise) FILTER (WHERE o.created_at >= now() - interval '7 days')  AS this_week,
           SUM(o.total_paise) FILTER (WHERE o.created_at <  now() - interval '7 days'
                                AND o.created_at >= now() - interval '14 days') AS last_week
      FROM orders o JOIN reps r ON r.id = o.rep_id JOIN v ON v.rep_id = o.rep_id
     WHERE o.status='confirmed'
     GROUP BY o.rep_id, r.region, v.v_this, v.v_last ORDER BY o.rep_id`);
  const overdue = await q(`
    SELECT o.region, SUM(i.amount_paise) AS past_terms
      FROM invoices i JOIN outlets o ON o.id=i.outlet_id
     WHERE i.status<>'paid' AND i.due_on < current_date
     GROUP BY o.region ORDER BY o.region`);

  console.log(`→ ${visitCount} visits, ${orderCount} confirmed orders`);
  console.log('\n  rep    region   visits          order value            change');
  for (const w of week) {
    const lw = Number(w.last_week || 0) / 100, tw = Number(w.this_week || 0) / 100;
    const pct = lw ? Math.round(((tw - lw) / lw) * 100) : 0;
    console.log(`  ${w.rep_id}  ${w.region.padEnd(7)} `
      + `${String(w.v_last).padStart(2)} → ${String(w.v_this).padStart(2)}   `
      + `₹${lw.toLocaleString('en-IN').padStart(9)} → ₹${tw.toLocaleString('en-IN').padStart(9)}`
      + `   ${pct > 0 ? '+' : ''}${pct}%`);
  }
  console.log('\n  overdue by region:');
  for (const o of overdue)
    console.log(`  ${o.region.padEnd(7)} ₹${(Number(o.past_terms) / 100).toLocaleString('en-IN')}`);
  // ---------------------------------------------------- trap verification
  console.log('\n  traps:');
  const checks = [];

  const [sharmaDue] = await q(
    `SELECT COALESCE(SUM(amount_paise),0)::bigint AS due FROM invoices
      WHERE outlet_id='OUT-001' AND status<>'paid'`);
  const [sharmaLimit] = await q(`SELECT credit_limit_paise FROM outlets WHERE id='OUT-001'`);
  const headroom = Number(sharmaLimit.credit_limit_paise) - Number(sharmaDue.due);
  checks.push(['Sharma Medical near its limit',
    headroom > 0 && headroom < rupees(5000),
    `owes ₹${(Number(sharmaDue.due)/100).toLocaleString('en-IN')} of ₹${(Number(sharmaLimit.credit_limit_paise)/100).toLocaleString('en-IN')} — ₹${(headroom/100).toLocaleString('en-IN')} headroom`]);

  const [krishna] = await q(
    `SELECT COALESCE(MAX(occurred_at)::date::text,'never') AS last,
            current_date - COALESCE(MAX(occurred_at)::date, current_date - 999) AS days
       FROM visits WHERE outlet_id='OUT-003'`);
  checks.push(['Krishna Chemist gone cold', Number(krishna.days) >= 20,
    `last seen ${krishna.days} days ago`]);

  const sharmaish = await q(
    `SELECT count(*)::int AS n FROM outlet_aliases WHERE alias LIKE 'sharma%'`);
  const [twoShops] = await q(
    `SELECT count(*)::int AS n FROM outlets WHERE lower(name) LIKE 'sharma%'`);
  checks.push(['Two shops match "sharma"', twoShops.n === 2,
    `${twoShops.n} outlets, ${sharmaish[0].n} aliases`]);

  const [six50] = await q(
    `SELECT count(DISTINCT sku_id)::int AS n FROM sku_aliases WHERE alias LIKE '%650%'`);
  checks.push(['Several products match "650"', six50.n >= 4, `${six50.n} distinct SKUs`]);

  const [nearExp] = await q(
    `SELECT batch_no, expiry_date - current_date AS days FROM batches
      WHERE id='B-NEAREXP'`);
  checks.push(['A batch expiring soon', nearExp && Number(nearExp.days) < 60,
    `${nearExp?.batch_no} expires in ${nearExp?.days} days`]);

  const [held] = await q(`SELECT count(*)::int AS n FROM orders WHERE status='held_credit'`);
  const [pend] = await q(`SELECT count(*)::int AS n FROM approvals WHERE status='pending'`);
  checks.push(['Orders waiting on a human', held.n >= 4 && pend.n >= 4,
    `${held.n} held, ${pend.n} approvals pending`]);

  const [aband] = await q(`SELECT count(*)::int AS n FROM agent_events WHERE event='abandoned'`);
  checks.push(['Abandoned drafts to measure', aband.n > 0, `${aband.n} abandoned`]);

  const [comp] = await q(
    `SELECT count(*)::int AS n FROM visits v JOIN outlets o ON o.id=v.outlet_id
      WHERE v.no_order_reason ILIKE '%cipla%' OR v.no_order_reason ILIKE '%competitor%'`);
  checks.push(['Competitor pressure recorded', comp.n >= 5, `${comp.n} counters mentioned a rival`]);

  let failed = 0;
  for (const [name, ok, detail] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(32)} ${detail}`);
  }

  console.log(failed ? `\n✗ ${failed} trap(s) did not seed` : '\n✓ seed complete — every trap live');
  if (failed) process.exitCode = 1;

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
