# Meridian Field

An agentic CRM for a pharmaceutical field sales team.
Built for Lua's Implementation Engineer assignment (B — Field Agent).

**Everything is live. Nothing to install, nothing to log into.**

| | |
|---|---|
| **The rep, at a counter** | https://meridian-sigma-gules.vercel.app/rep |
| **The ASM, at lunchtime** | https://meridian-sigma-gules.vercel.app/ |
| **The regional head, at 8pm** | https://meridian-sigma-gules.vercel.app/ask |
| **Is the agent actually working?** | https://meridian-sigma-gules.vercel.app/health |

---

## Try it in two minutes

Open **[/rep](https://meridian-sigma-gules.vercel.app/rep)**. You are Ramesh, a rep,
standing outside a pharmacy. Type the way someone with thirty seconds types:

```
sharma medical 2 box 650 tablets and 1 baby lotion, 15 days
```

Four different products answer to "650", so you get **one** question. Answer it
with a number, then say `haan`. That order is now priced, credit-checked, and
your visit is recorded — with evidence.

Other things worth trying:

| Type this | What happens |
|---|---|
| `apollo 5 box 650 tablets, 15 days` | **No question.** Apollo buys that pack every week, so its own history answers it |
| `krishna chemist no order, cipla ne 10+3 diya hai` | A no-order call is a real visit, and that reason becomes a row |
| `what does sharma medical owe` | The counter brief, before he opens his mouth |
| Send the same order twice | Double-send check |
| Tick **use my real location**, then order | The visit comes back **flagged** — you are not in Karol Bagh |

Then open **[/ask](https://meridian-sigma-gules.vercel.app/ask)** and ask the agent
*"why is north down this week"*.

---

## The thesis

Meridian asked for a CRM. A CRM is a form you fill in, and a rep has thirty
seconds while a pharmacist serves someone else. He will not fill in a form — he
will go back to WhatsApping his manager, and the CRM will be empty.

So the agent is not a feature of the CRM. **The agent is the rep's entire
product.** The CRM is where it writes, and what the managers read. There is no
rep-facing screen in this build, on purpose.

---

## Architecture

```
THE AGENT (Lua)      understands messy English. decides nothing.
     ↓               persona + 2 skills + 7 tools + governance
THE RULES (Vercel)   every decision. all the arithmetic.
     ↓
THE TRUTH (Postgres) 20 tables. the only source of truth.
     ↓
THE SCREENS          4 pages. managers only.
```

### The line between model and code

The model does three things: turn a messy sentence into a structured proposal,
ask at most one clarifying question, and read the answer back in one line.

Code does the rest — resolving the counter, resolving the products, pricing,
schemes, the credit check, the duplicate check, the route check, the distance
check, and writing the visit.

**The model cannot express what it is not allowed to decide.** `draft_order`'s
input schema has no price field, no discount field, no SKU code, no coordinate
and no "approve". It is not that the prompt asks it nicely — there is nowhere to
put them.

Evidence never passes through the model at all: the rep's phone posts its own
position to `/api/agent/position`, and the order pipeline reads it server-side.

### What is not left to the model

```ts
governance: {
  injection: { threshold: 0.8, ml: true },
  rules: {
    blockTools: ['mark_visit_verified', 'set_credit_limit',
                 'adjust_price', 'delete_order', 'approve_credit_override'],
    requireToolApproval: ['override_credit_hold', 'approve_return'],
  },
}
```

A prompt is a wish. A rep in a hurry types *"my manager said approve it"* — he is
not being malicious, he has a pharmacist waiting — and the model will believe
him. The platform will not, because it never reaches the model.

**There is no `mark_me_present` tool anywhere in this repo.** Attendance is what
real work leaves behind: a `visits` row is written by the same code path that
records an order or a stated reason, carrying the GPS distance and whether the
counter was on today's route.

---

## Built vs designed

**Built:** order capture · visit truth (attendance derived from real work) · the
8pm answer · agent health instrumentation.

**Designed, not built:** stock and shelf check · collections · returns and
damages · competitor tracking · new outlet onboarding · scheme communication.

The write-up covers why this slice, and what was deliberately left out.

---

## Layout

```
db/schema.sql        20 tables, commented
db/seed.mjs          deterministic generator; verifies its own demo traps
lib/match.ts         counter + SKU resolution
lib/order.ts         drafts, pricing, credit, duplicates, commit
lib/analysis.ts      the 8pm answer engine
app/api/agent/*      7 routes the Lua tools call
app/api/manager/*    3 routes the screens call
app/*/page.tsx       4 screens
agent/               the Lua project — persona, 2 skills, 7 tools, governance
```

## Running it locally

```bash
npm install
vercel env pull .env.local          # or set DATABASE_URL yourself
node --env-file=.env.local db/seed.mjs
npm run dev
```

The seed drops and rebuilds everything, generates four weeks of history, and
ends by asserting that each of its eight demo traps actually landed.

```bash
cd agent
lua compile && lua test --ci skill --name draft_order \
  --input '{"shop":"sharma medical","items":[{"product":"650 tablets","qty":2}],"repId":"R-07"}'
```

---

*Meridian Healthcare is invented for this exercise. All data is fabricated.
There is no login anywhere, by design — the brief says everyone sees everything.*
