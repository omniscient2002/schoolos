# The Fees Domain Story — one term at Sunrise Public School

> **What this document is.** A plain-language walkthrough of how school money moves in SchoolOS.
> It follows one real-feeling school through one school year — from switching the module on in
> April to admitting an RTE child in August — and explains, at each step, *what happens*, *why it
> works that way*, and *what would have gone wrong without it*. You do not need to be technical to
> read it. Where a screen, button, or table matters, it is named so you can find it later.
>
> **How to read it.** Start at Part 0 (the one big idea). Then follow the months. Boxes marked
> **"In plain words"** translate jargon. Boxes marked **"Why this matters"** explain the danger
> being prevented. Every rupee is shown with its exact paise underneath, because the system stores
> money as whole paise (₹1 = 100 paise) and never as a decimal point — decimals lose fractions of
> a paisa and, over thousands of payments, those fractions become a real accounting hole.
>
> The precise rules, database tables, and edge cases live in `docs/FEES-DESIGN.md`. This document
> is the story; that one is the law book.

**Cast of characters:**

| Who | Role | What they care about |
|---|---|---|
| **Ravi** | Owner | Money is honest, nobody can quietly move it |
| **Meera** | Principal | Parents are treated fairly; school runs smoothly |
| **Arjun** | IT admin | Systems connected and secure |
| **Rao-ma'am** | Finance head | The books balance; dues get collected |
| **Sunita** | Fee clerk | Collecting at the counter quickly |
| **Kavita** | Parent | Knowing what she owes and getting a receipt she can trust |
| **Aarav** | Student, Grade 6-A | Nothing, thankfully — he is 11 |
| **Imran** | RTE quota child, admitted August | His fees are paid by the state |

---

## Part 0 — The one big idea

Before the story, hold this single picture in your head. It explains almost every rule that follows.

**A school's fee money has two completely separate worlds:**

1. **The school's own account book** (in this software, the *ledger*). This is the truth of who
   owes what and who has paid. Only one thing can change it: a person at the school pressing a
   button that says "yes, the money has arrived."
2. **The outside world of payment** — UPI apps, card machines, bank transfers, cash in a drawer,
   WhatsApp messages from a payment company. This world produces *evidence* that money moved, but
   it never, ever changes the school's account book by itself.

> **In plain words:** the bank telling you "₹11,250 arrived" is a *message*, not a *command*.
> The school decides when to write it into its own book. The software enforces that separation
> so hard that even a correct, genuine message from the payment company cannot move a single
> paisa on its own.

**Why this matters:** schools get defrauded, and books get corrupted, precisely when the outside
world can write into the account book. If a payment gateway message could mark a bill "paid," then
a fake message, a replayed old message, or a message for the wrong school would silently wipe out
a real due. So the software makes the human the gate — every time, with no exceptions, not even a
setting to turn it off.

Now the story.

---

## Part 1 — April, week 1: Switching the money machinery on

Sunrise Public School has just finished **Part 1** of its setup. That means the school already
exists as a tenant, the owner (Ravi) can sign in, the principal (Meera) and IT admin (Arjun) and
finance head (Rao-ma'am) and clerk (Sunita) all have accounts, and ~40 students are on the roster
in defined classes and sections. None of that is about money yet. Now the money begins.

Ravi opens the **Modules** screen (`/plugins`) and picks the school size preset called
**Standard**. He presses Apply. In one motion, twenty-nine optional modules are sorted: twelve
stay switched on, seventeen switch off.

The twelve that stay on for Standard are: People console, Visitors gate pass, Timetable,
Documents, Library, Admissions funnel, Exams, Bus tracking (`transport.gps`), Teacher classroom,
Parent assistant, and the two compliance packs (CBSE and DPDP). Everything the school doesn't
need yet — payroll, health clinic, Tally accounting, WhatsApp, the UPI and card payment rails —
sits switched off, dormant, waiting. Nothing is deleted; a switch flipped is a switch that can be
flipped back.

**And then something quiet and important happens.** In the very same action, the school gains
three **fee heads** it did not have a moment before:

| Fee head | What it's for | Short ledger code |
|---|---|---|
| **Tuition** | The main monthly/term fee | `TUIT` |
| **Transport** | The bus fee | `TRANS` |
| **Activity** | Clubs, sports, events | `ACT` |

> **In plain words:** a *fee head* is just a bucket with a name — "Tuition" is one bucket,
> "Transport" is another. Every rupee the school charges belongs in exactly one bucket, so the
> school can later answer "how much tuition did we collect?" separately from "how much bus fee?"

**That is the entire "installation" of the fees domain.** There is no big setup wizard to complete.
There is no paywall that appears halfway. The trial plan that every new school starts on already
includes every fee feature — heads, plans, installments, sibling discounts, reminders, refunds,
even the payment gateways. A school can run its whole first term on the free plan and still run
fees completely. The paywall, when it comes, is about other things — never about whether fee
collection works.

---

## Part 2 — April, week 2: Naming the price

Now the school has buckets but no prices. That's what the **Fee Plans** screen is for.

Rao-ma'am opens `/fees/plans` and creates a plan called **"Grade 6 — AY 2026-27"**
(AY = academic year). She fills in:

- **Which bucket?** The Tuition head.
- **Which grades?** Grade 6 — chosen from a dropdown built from the school's *own* `/classes`
  list. She literally cannot type a grade the school doesn't teach; the dropdown wouldn't offer
  it.
- **Which terms, what amount, due when?** She types this table:

| Term | Label (what the parent sees) | Per student | Due date |
|---|---|---|---|
| Term 1 | Term 1 Tuition 2026-27 | ₹12,500 → **1,250,000 paise** | 2026-05-10 |
| Term 2 | Term 2 Tuition 2026-27 | ₹12,500 → **1,250,000 paise** | 2026-09-10 |
| Term 3 | Term 3 Tuition 2026-27 | ₹12,500 → **1,250,000 paise** | 2027-01-10 |

- **Split into installments?** Yes, four parts per term.
- **Sibling discount?** Yes, 10% automatically when two children of the same family are enrolled.

As she types, the system quietly checks every field before saving: each term name is under 40
characters, each label under 80, each amount is a whole number of paise (never negative), and
each due date is a real calendar date. If she had tried to raise fees by **12%** in one jump, the
system would have stopped her and asked for proof of a School Management Committee (SMC) meeting
held within the last 180 days — a guard against surprise fee hikes.

**And then she does nothing that costs anyone money.** The plan is saved. It is a *rule*, sitting
inert. No child owes anything yet. This is deliberate — a plan is a recipe, not a meal.

### The magic button: "Generate fee dues"

Rao-ma'am presses **Generate fee dues**. This is the moment the plan becomes real.

In one single, all-or-nothing action, the system takes the rule and stamps out bills:

- One **obligation** (a bill, a due) for every *active* Grade-6 student, for each of the three
  terms. With ~40 children, that's 40 × 3 = **120 bills**, created together.
- Each bill is split into the four installments she asked for: ₹12,500 ÷ 4 = **₹3,125 each**
  (312,500 paise). When an amount doesn't divide evenly, the leftover paise go onto the *last*
  installment, so the four parts always add up to exactly the whole. No rounding is ever lost.
- Every bill is tagged with a **billing run id** — a label that says "these 120 bills were born
  together, on this day, from this plan." That tag is what lets the school undo the whole run
  later if she made a mistake.

Here is Aarav's Term 1 bill, as the system actually stores it:

```
student:            Aarav Sharma (Grade 6-A)
term:               Term 1
label:              Term 1 Tuition 2026-27
amount_cents:       1250000        ← the full price, in paise
concession_cents:   0              ← a discount, if any
waived_cents:       0              ← a forgiveness, if any
net_amount_cents:   1250000        ← amount − concession − waived (the system computes this itself)
paid_cents:         0              ← how much has actually been received
status:             open           ← open = nothing paid yet
source_ref:         billing_run:<id>
```

> **In plain words:** `amount` is what the school asked for. `concession` and `waived` are
> reductions. `net` is what the family truly owes after reductions. `paid` is what has arrived.
> The family is fully settled when `paid` equals `net`. Notice that `net` is *computed* by the
> system from the other three — nobody can type a `net` that doesn't match the arithmetic.

### The sibling discount that fired by itself

Kavita, Aarav's mother, also has a younger daughter in Grade 3. So the sibling rule Rao-ma'am
configured fires *during generation*, with no human approval:

```
concession_cents = round(1,250,000 × 10 ÷ 100) = 125,000 paise
net_amount_cents = 1,250,000 − 125,000 = 1,125,000 paise  →  ₹11,250
```

Aarav's bill drops from ₹12,500 to **₹11,250** before anyone looks at it.

**But here is the subtle, clever part:** the rule decided these two children are siblings by
checking whether they **share the same guardian phone number** — Kavita's number. It did *not*
look at surnames or addresses.

> **Why this matters:** in India, surnames are a poor identity signal. Two unrelated "Sharma"
> families share a surname; two siblings can have different surnames after a remarriage or a
> spelling variation. A phone number is the identifier the school already uses to reach the
> family. So the discount follows the *actual family*, not the name.

### What happens if she presses Generate again

Say Rao-ma'am realizes in September that she forgot the plan existed and presses **Generate fee
dues** a second time. What happens? **Nothing harmful.** The system recognizes each bill by a
unique key — the combination of school + student + term + label — and skips any bill that already
exists. It only creates genuinely *new* combinations. Critically, **a bill that has any money paid
against it is never touched, ever.**

What if she made a *typo* in the plan — said "Grade 6" when she meant "Grade 7"? There is no "edit
plan" button. Instead she **voids the whole billing run** (if nothing has been paid yet) and makes
a corrected plan.

> **In plain words:** voiding a run is like crossing out an invoice entirely and not accepting
> partial corrections to it. It feels rigid for a minute, but it means the books can never hold a
> half-edited bill. If even ₹1 has been paid, the void is refused — you must refund first, then
> void. Money that moved can't be un-moved by editing a form.

### The school's money rules (policy)

Before leaving this screen, Rao-ma'am and Ravi set the school's **fee policy** together on the
Payments tab. These are the numbers that govern the whole year:

| Rule | Their setting | What it means |
|---|---|---|
| Refund approval threshold | **₹5,000** | Any refund of ₹5,000 or more needs a second person to approve |
| Parent partial payments | **Allowed**, minimum **₹100** | A parent can pay part of a bill, but not a token ₹1 |
| Receipt numbering | Prefix `RCP`, starting at **1** | Every receipt is `RCP-000001`, `RCP-000002`, … |
| Late fee | **₹10/day** after **7 days** grace, capped at **₹500** | Overdue bills grow slowly and stop growing at ₹500 |

> **Why a grace period?** Life happens. A payment stuck in a bank queue for three days shouldn't
> punish a family. So the first 7 days past due cost nothing. After that, a small daily amount
> accrues, and it never explodes past the cap. The cap matters: without it, a bill forgotten for
> two years would accrue a late fee larger than the fees themselves — which courts often strike
> down as unfair.

Note their late fee is set to a real number. If they had left it at ₹0 (the default), the school
would simply charge no late fees at all — the machinery exists but is switched off by default.

---

## Part 3 — April, week 3: Connecting the pay rails

Bills now exist. But how will money actually get from parents to school? That's the **rails**.

Arjun, the IT admin, opens each payment plugin's settings and pastes in the credentials:

- **UPI:** the school's UPI ID (called a VPA — something like `sunrise@okhdfc`). This is the
  address parents' UPI apps will pay to.
- **Card/netbanking (Razorpay):** the school's key id, secret key, and a special "webhook secret"
  (a password the payment company uses to prove its messages are genuine).
- **WhatsApp:** the school's sender ID, its DLT entity registration (an Indian telecom
  requirement for business messaging), and **quiet hours** of **21:00–08:00**.
- **Tally (accounting software):** the names the school's accountant wants to see — e.g. map fee
  income to a ledger called "Fee Income."

**Secrets are treated like secrets.** The key and secret are encrypted when stored and shown back
as asterisks. The audit log records *that* Arjun set them, and *which* key names, but never their
values — so even someone reading the school's full activity history cannot steal the keys.

**Quiet hours matter more than they sound.** Between 9pm and 8am, the school will not send a
single fee reminder, no matter who is overdue.

> **Why this matters:** a family grieving a death, or a night-shift worker asleep at 10am, should
> not be hounded at midnight by a school about ₹3,000. The software simply refuses to send during
> quiet hours — it doesn't send "politely"; it sends *nothing*, and says so.

**Nothing Arjun just did moves any money.** He has only made movement *possible*. If he had
skipped the UPI ID, the first parent tapping "Pay by UPI" would meet an honest message: "UPI is
not configured for this school yet" — not a silent hang, not a fake success.

---

## Part 4 — May: The bill reaches home, and a parent pays

The demand is now live. Kavita opens the parent app and goes to **Fees** (`/parent/fees`). She
sees Aarav's Term 1: **₹11,250** (already net of the sibling discount), due 10 May, status *open*.
She also sees a small flag showing a discount was applied — the school is not hiding anything.

Notice how she got to her children's data. The system found her children through a **family link**
— the structural record that says "Kavita is the guardian of Aarav and of the younger daughter."
It is not a search, and it is not a filter on a shared list.

> **In plain words:** when she asks for her children's dues, the system doesn't look at a big
> table of all students and hide the others. It starts from *her* family links and can only ever
> reach *her* children. If someone tampered with the request and asked for a different child's id,
> they would get an empty result — never another family's data. Privacy is built into the path,
> not bolted on as a check.

Kavita taps **Pay ₹11,250 → Pay by UPI**. Her phone leaves the school app and opens her UPI app,
carrying an intent built entirely from the school's own data:

```
upi://pay?pa=sunrise@okhdfc&tr=<this payment's id>&am=11250.00&cu=INR
```

That long line says: pay ₹11,250.00 in Indian Rupees (INR) to `sunrise@okhdfc`, and tag this
transfer with the payment's id so the school can recognize it.

She pays in her UPI app and returns. The school app now shows something honest and slightly
old-fashioned: **"school confirms once received."**

> **In plain words:** at this moment, nothing has been added to the school's account book. The
> system created a record called an **intent** — a promise, an "initiated" payment — not a
> payment. Aarav's `paid_cents` is still zero. This is the two-worlds idea from Part 0, in action.

There's a quiet protection here too. Kavita's phone network is flaky in her building, so she taps
the button three times. Does that create three payments? **No.** Each attempt carries an
**idempotency key** — a unique tag. The system sees the same tag arrive again and answers
"already done" instead of making a duplicate. This one design choice prevents the single most
common parent complaint: double charges from a shaky connection.

Meanwhile, in the background, the UPI company's system sends a message to SchoolOS: a **webhook**
saying "this payment captured." That message is scrutinized before it is believed:

- **Is it genuine?** It must carry a cryptographic signature (HMAC-SHA256) computed over the raw
  bytes, compared in a way that resists timing attacks. A forged message fails.
- **Is it fresh?** It must be timestamped within ±15 minutes. An old captured message, replayed
  later, fails.
- **Has it been seen before?** Each message has a unique event id; a replayed duplicate is
  recognized and ignored.
- **Which school is it for?** The system resolves the correct school from the payment itself, and
  binds the checking secret to *that* school — so one school's messages can never be validated
  against another's.

And then — despite all that careful verification — the message changes **nothing** in the account
book. It is filed as a **fact**: "UPI reported a capture." Facts never settle payments.

> **Why this matters:** a one-line setting to "auto-accept verified payments" would be convenient
> and dangerous. It was deliberately never built. A correct message is strong *evidence*, but the
> act of writing it into the books stays with a person at the school.

### A card payment that couldn't happen (an honest limitation)

Suppose Kavita instead taps **Pay by card / netbanking**. Today she meets a locked door.

The button is on screen, but the card gateway endpoint accepts only *staff* — not parents. So the
attempt is refused.

> **In plain words:** this is a known, documented gap (§15.3 #1 in the design document). The
> parent's real online option today is UPI; card and netbanking are done at the desk. The screen
> is ahead of the server here — a place the team has flagged to fix, not hidden.

---

## Part 5 — May, same week: The school confirms the money arrived

Rao-ma'am sits at the finance desk. Kavita's payment sits there marked as an *intent*. Rao-ma'am
checks that the payment company's own record backs it up — the system looks at the rail's
`order_log` (the payment company's own logbook), **not** merely at whether the reference string
looks right.

> **In plain words:** "looks like a valid receipt number" is worthless as proof — anyone can type
> a plausible string. The system instead asks the payment company's own records: "did you actually
> capture this?" Only a yes from the source counts as gateway-verified.

She confirms. In one transaction, the following happens together:

```
payments:          status  initiated  →  confirmed
                   settled_by        =  Rao-ma'am
                   settled_via       =  gateway       ← came through the payment gateway
                   reconciliation_status = matched   ← and the rail's log agrees
                   gateway_ref       =  pay_<provider id>

fee_obligations:   paid_cents  0  →  1,125,000       ← ₹11,250 now received
                   status      open  →  paid

fee_installments:  seq 1,2,3,4  →  paid, in order, each stamped with this payment's id

fee_receipts:      + 1 row  (RCP-000017 — numbered under a school-wide lock; no skips, no doubles)
files.store:       + 1 PDF artifact  (rendered best-effort; the row is the truth, the file a convenience)

communications:    + 1 WhatsApp receipt message  (deduplicated by receipt:<paymentId>)

audit:             "Confirmed payment (gateway reference pay_… verified …)"
                   + a payment_events row of kind "confirmed"
```

Kavita's phone buzzes with receipt **RCP-000017** before Rao-ma'am's tea cools.

**What if Rao-ma'am had double-clicked?** The second confirm sees the payment is already
confirmed and returns "already done" — no second receipt, no second ₹11,250. This is the same
idempotency idea from the parent side, now protecting the school side.

> **Why receipts are specially numbered:** a receipt number is a legal artifact. If two receipts
> could share a number, the school's books would be worthless to an auditor. So the system takes a
> school-wide lock, finds the highest receipt number so far, adds one, and pads it (RCP-000017).
> The old design used a timestamp-based number that could *skip* under contention — silently
> creating a gap in the books. That was replaced with the locked counter. The honest limitation:
> it is *collision-proof*, not *gapless* — if a transaction rolls back, the number is simply not
> reused, so an auditor may see a hole. No number is ever duplicated.

### The cash payment at the counter

Now a different scene. A father walks in and pays **₹8,000 cash** toward a ₹12,500 Term 1 bill.
This is Sunita's world — the counter.

Sunita initiates the payment and enters her **4-digit counter PIN**. (The PIN is stored as a hash,
never as digits; if the school hasn't enrolled her in a PIN, the collection proceeds without the
extra check.)

**And then she stops.** She cannot confirm the payment. The system refuses clerks at the confirm
step.

> **In plain words:** the person who *takes* the money is not allowed to be the same person who
> *writes it into the books*. Two pairs of eyes. This is the oldest control in accounting
> (it's called "maker-checker" or "segregation of duties"), and it exists because the person most
> able to fake a transaction is the person holding the cash.

So Rao-ma'am confirms it. Because it's cash — there is no payment company to vouch for it — the
row is permanently labelled **manual**:

```
settled_via:  manual
gateway_ref:  MANUAL   ← a reserved word meaning "a human verified this, not a gateway"
```

The bill becomes **partial**: ₹8,000 of ₹11,250 paid, ₹3,250 still owed.

This frustrates Sunita every single week — she has the money in her hand and still has to wait
for Rao-ma'am. And it protects the school every single week. The friction is the feature.

### One payment, several bills

What if a parent wants to pay the Term 1 fee *and* the bus fee in one go? The system supports a
single payment settling several bills at once — up to 20 bills belonging to the *same* child.

It fills the bills **greedily, in order**: the first bill takes as much as it needs, the next
takes what's left, and so on. Every rupee's destination is recorded in a table
(`payment_allocations`), so months later the school can answer exactly which rupee paid which bill.

> **In plain words:** think of one envelope of cash arriving to pay several outstanding chits. The
> system opens chits one by one, pays each in full before moving to the next, and writes on each
> chit exactly how much of this envelope went to it.

---

## Part 6 — June: The term gets messy

Real terms are messy. This is where the fee domain earns its keep. Four things happen this month.

### 6a. The scholarship (a concession, in two hands)

Aarav's friend wins a merit scholarship worth **₹5,000** against his Term 2 fee. His teacher
*requests* it. Rao-ma'am *approves* it.

These must be two different people. If Rao-ma'am had tried to approve a request she herself
raised, the system would refuse with a formal error (`SOD_REQUIRED`). Only the owner is exempt
from this rule (because the owner is the school's ultimate authority, and sometimes there is no
one above them).

When approved, the bill's `concession_cents` rises to 500,000 paise, the `net` falls from ₹12,500
to ₹7,500, and — crucially — **`paid_cents` does not move at all.** A discount changes what is
*owed*; it never pretends money *arrived*. A notice goes to the guardian so the family knows.

Small rules keep it sane: a concession is expressed as *either* a percentage *or* a rupee amount,
never both; and an approval can never push the net below zero (you can't discount a ₹500 bill by
₹800).

> **In plain words:** a discount shrinks the target. It does not add money. Confusing those two
> is how schools end up with books that claim they collected money they never received.

### 6b. The late fee (slow, capped, and repeatable)

On the 8th day past due (one day past the 7-day grace), the school's late-fee rule can be run.
It is *not* automatic by default — Rao-ma'am runs it, or a nightly worker does if the school has
it scheduled.

The rule is a simple, honest formula:

```
late fee = LEAST( cap , GREATEST(0, (today − due date) − grace days) × per-day amount )
```

Worked out for a family **20 days overdue**, with ₹10/day, 7 grace days, ₹500 cap:

```
days over the due date      = 20
minus grace                  = 20 − 7 = 13 chargeable days
13 × ₹10                     = ₹130
compared to the ₹500 cap     = ₹130 is below the cap, so ₹130 stands
```

**Notice it's a SET, not an ADD.** Running it a second time doesn't add another ₹130 — it
recomputes and sets the same ₹130. So running it twice, or ten times, never compounds. A late
fee that compounds every time you click "run" would be a disaster; the design makes that
impossible.

### 6c. The reminders (quiet, deduplicated, escalating)

Overdue bills feed the **dunning** (reminder) system. It sends three kinds of message:

1. **Before due** — a friendly heads-up a few days early (opt-in).
2. **Overdue** — a nudge after the due date (always on).
3. **Escalation** — after many days, it stops being just a message and becomes a **task** on the
   finance team's Action Center. Dunning turns into *work*, not noise.

Three protections run the whole time:

- **Deduplication.** Each reminder carries a unique key (`dunning:<bill id>`, with a 7-day
  window, or `escalation:<bill id>:<days>`). A family is never texted twice for the same overdue
  bill in the same cycle.
- **No contact, no send.** If a family has no guardian phone on record, the message is skipped —
  never sent into the void.
- **Quiet hours.** Between 21:00 and 08:00, the run writes **nothing**. It doesn't queue for
  later, it doesn't send a "we'll message you in the morning" — it simply does nothing, and says
  it did nothing.

Kavita, who has paid in full, hears **nothing**. The sweep selects overdue *dues*, not pupils. A
families' inbox reflects their behaviour, not the school's eagerness.

### 6d. The mistake (a double payment and a refund)

A parent, confused by two payment attempts, ends up paying Term 1 **twice**: ₹12,500 confirmed,
then ₹12,500 again. Both landed. This is a real problem — the family is out ₹12,500.

Sunita *proposes* a refund. Because it's a full refund above the ₹5,000 threshold, the rules
tighten:

- She must give a **reason** (mandatory at this size).
- She **cannot approve it herself** — a clerk may propose, never approve.

Rao-ma'am approves. And now the ordering matters enormously:

1. **First**, the system asks the gateway to return the money.
2. **Only if the gateway succeeds**, the system touches the ledger: `paid_cents` goes down,
   `refunded_cents` goes up, the bill goes back to `open` (or `partial`), and the receipt is
   *voided* — not deleted, just stamped with a void date so the audit trail keeps it.
3. The parent is told.

**If the gateway had refused the refund, the ledger would be untouched — byte-for-byte the same.**
The network call happens *before* the book change and *outside* the lock, so a failure leaves the
books exactly as they were. Money never leaves the ledger unless it has actually returned to the
family. (Again: two worlds. The external refund is evidence/action; the ledger records it, but
only after reality.)

A *small* refund — say ₹200 below the threshold, a partial — needs no reason and no second
person. The ceremony scales with the risk.

> **Why separate rules for large and small?** Requiring two signatures for every ₹50 correction
> would paralyze the office. Requiring none for a ₹50,000 reversal would invite theft. So the
> threshold sits where the money starts to matter.

---

## Part 7 — July: Trust, but verify (reconciliation)

Here is a hard truth about payments: the ledger and the payment company's records *will*
sometimes disagree. A network blip, a manual entry, a settlement on a holiday. If the school
never checks, small disagreements become big audit findings. So Rao-ma'am runs **reconciliation** —
a systematic comparison of the school's books against the payment companies' logs.

The sweep sorts every problem into four named shapes:

| Finding | Plain meaning |
|---|---|
| **Ghost** | The school's books say paid, but the payment company's log shows nothing |
| **Missing** | The payment company captured money, but the school's books don't show it confirmed |
| **Orphan** | The school's books show confirmed, but there's no payment-company record at all (often cash) |
| **Amount mismatch** | Both sides show the payment, but for different amounts |

This month it finds **one orphan**: a ₹12,500 confirmed payment from a cash-heavy week with no
provider trace.

**And — this is the important part — it does not "fix" anything.** It writes a record
(`disputed`), an audit line, a tally in `recon_runs`, and a card on the finance team's Action
Center. A human then checks the bank statement, decides it's legitimate, and marks it matched.
The case closes.

> **In plain words:** reconciliation is a smoke detector, not a fire extinguisher. It tells you
> where a problem might be; it never silently rewrites money. An automatic "fixer" that guesses
> which side is right is how you hide fraud instead of finding it.

### Turning the month into reports

All of this compresses upward into views for different people:

- **Aging buckets** (1–7, 8–30, 31–90, 90+ days overdue), oldest debtors first — who owes what,
  sorted by how worrying it is.
- **A board-pack money card** — billed, collected, outstanding, collection percentage (a
  one-screen financial health snapshot for the board).
- **A Tally daybook export** — confirmed payments only, in Indian Standard Time, as accounting
  vouchers (XML) that the school's accountant downloads into Tally. The export is content-hashed
  and digest-audited.

The Tally plugin **reads** the ledger and **exports** files. It never posts anything back into
the ledger. One direction only.

---

## Part 8 — August: The RTE child

In August, the state sends its Right to Education (RTE) lottery results: a list of children who
have won a seat under the 25% economically-weaker-section quota. One winner is for Grade 1:
**Imran**.

The admissions team imports the single row. In one move:

- Imran joins the roster as a student with `ADM RTE-…` as his admission number.
- A guardian record is created for him.
- His Term 1 fee obligation is created.
- He receives a **statutory 100% waiver** — auto-approved.

He owes nothing. And nobody had to approve anything, because **the lottery is the authority**, not
a staff member. This is fundamentally different from a discretionary discount: a scholarship
needs two hands (request + approve); an RTE waiver needs none from staff because the *state*
already decided.

Now compare that with **discretionary write-offs** — forgiving a debt out of pure kindness, outside
the concession categories. **Those do not exist in the system.** There is no "forgive debt" button,
no bad-debt table, no threshold. The only path to reducing what's owed is a concession of one of
the defined kinds (concession, scholarship, sibling, staff, waiver), each with its own approval
rules. This is a deliberate honesty choice: if the system can't do something, it doesn't pretend
to.

---

## Part 9 — What the whole term proved

Six months, one school, dozens of families. Pull back and look at what held:

- **Kavita always knew where her money went.** Her dues → her intent → a staff confirmation → a
  numbered receipt → a PDF. Each step was labelled either *gateway* (machine-verified) or
  *manual* (human-verified). Nothing was ever dressed up as more certain than it was.
- **Sunita could collect but never self-approve.** The maker never becomes the checker.
- **Rao-ma'am could approve but never silently.** Every approval is in the audit trail.
- **Ravi could void a bill — but never one that had money on it.** Refund first, always.
- **The payment companies could send all the messages they liked** — signed, fresh, unique — and
  still not move a single paisa until a human confirmed.
- **And when an auditor asks**, every sentence above resolves to rows in specific tables:
  `fee_obligations` (bills), `payments` (collections), `payment_allocations` (which rupee paid
  which bill), `payment_events` (an append-only money diary), `fee_receipts` (immutable receipts),
  `fee_concessions` (discounts), `recon_runs` (reconciliation sweeps), `fee_dunning_log`
  (reminders) — each with a hash-chained audit line, where each entry is linked to the one before
  so that tampering with history is detectable.

---

## Part 10 — The whole domain in one page (plain-language cheat sheet)

| Plain term | What it really is | Where it lives |
|---|---|---|
| **Fee head** | A named bucket for charges (Tuition, Transport…) | `fee_heads` |
| **Fee plan** | A rule: bucket × grades × terms × amounts × installments | `fee_plan_templates` |
| **Generate dues** | Turning a plan into actual bills for real students | `fee_obligations` + `billing_runs` |
| **Bill / due** | One student's amount owed for one term | `fee_obligations` |
| **Installment** | A scheduled part of a bill | `fee_installments` |
| **Discount** | A sanctioned reduction (needs approval) | `fee_concessions` |
| **Intent** | "I mean to pay" — not yet money | `payments` (status `initiated`) |
| **Confirmation** | A staff member writing money into the books | `payments` (status `confirmed`) |
| **Receipt** | A numbered, permanent proof of payment | `fee_receipts` + PDF |
| **Allocation** | Which rupee paid which bill | `payment_allocations` |
| **Webhook** | A message from the payment company — evidence only | plugin logs |
| **Reconciliation** | Comparing the books to the payment company | `recon_runs` |
| **Dunning** | Reminders and escalations | `fee_dunning_log` + comms |
| **Late fee** | A slow, capped charge for being overdue | `fee_obligations.late_fee_cents` |

**The four laws, in one breath each:**

1. **Money is whole paise, never decimals.** No rounding holes, ever.
2. **Only a human confirmation moves the books.** The outside world sends evidence, not commands.
3. **The taker and the checker are never the same person.** For large or reversible actions,
   always a second pair of eyes.
4. **Nothing that moved is ever edited or deleted.** Corrections are new rows; history is
   append-only and hash-chained.

---

## Part 11 — Where the domain fits — and where it doesn't (India reality check)

The fee domain is built **for a mainstream Indian private day school** — and it serves that
segment very well. In plain terms:

**Fits well:** private unaided schools (CBSE / ICSE / State board), small to large, single campus.
Term-wise and installment billing, sibling and staff discounts, UPI + cash + card-at-desk,
Hindi/English reminders, RTE intake, UDISE/OASIS/Tally exports.

**Strains or breaks:**

| School type | What happens |
|---|---|
| **Government schools** | They charge almost nothing; the fee machinery is dead weight. Needs (enrollment, scholarships, meals) aren't fee-shaped. |
| **Multi-branch chains / trusts** | Each branch is a separate school. Per-branch fees work; **combined chain finances don't exist**. |
| **Boarding schools** | Hostel as a flat fee head works; daily mess/canteen billing tied to attendance does not. |
| **EMI / auto-debit schools** | No NACH mandates, no automatic bank debits. Upfront + installments only. |
| **Donation-funded trusts** | No 80G donation receipts, no donor ledger. Only fee dues exist. |
| **Non-English offices** | Translation infrastructure exists but coverage is partial; parent-facing copy is the thinnest. |

The domain is **generalised across school *data*** (any heads, any terms, any discounts) but
**locked to an Indian private day-school *shape*** (Indian Rupees, Indian Standard Time,
April–March academic year, UPI/Razorpay/cash, RTE, Tally). Within that shape it is
production-grade. Outside it, the answer ranges from "not useful" to "wrong tool."

---

## Where to read next

| Question | Document |
|---|---|
| Exact doors, gates, tables, invariants | `FEES-DESIGN.md` §2 (roles), §4 (data model), §5 (API) |
| How a new school sets fees up, step by step | `FEES-DESIGN.md` §14 (runbook), plus Parts 12–13 below |
| What is production-ready vs India-locked vs missing | `FEES-DESIGN.md` §15 |
| Parent/staff screen inventory | `FEES-DESIGN.md` §10 |
| Precision gaps with file:line | `FEES-DESIGN.md` §15.3 |
| One term's full ledger walkthrough (what you just read) | Parts 0–11 above |
| Full technical story from the current code (verbose) | Part 12 below |
| Tenant configuration runbook, one by one | Part 13 below |

---

## Part 12 — The full technical story, from the current code (verbose)

> What follows is the fees domain exactly as it runs today: `server/src/routes.js`
> (all `/fees/*`, `/fee-plans/*`, `/payments/*` doors) + `server/src/fees/*`
> (`installments.js`, `dunning.js`, `reconcile.js`, `receipt-pdf.js`, `openapi.js`)
> + migrations `059 → 150`, as seen from the desk in `app/src/screens/Fees.tsx`
> and `app/src/screens/finance/FeePlans.tsx`. Every behaviour named here maps
> to a door, a table, or a test (`fee-plans`, `fees-enterprise`,
> `fees-perfect-100`, `fees-dunning` suites — all green).

### 12.1 The one-sentence model

A school **bills** by fanning a **plan template** out into per-student
**obligations** (grouped in a **billing run**), optionally split into
**installments**; families/staff **initiate payments** against one or many
obligations, a **checker confirms** the settlement which moves `paid_cents`
and mints an immutable **receipt (+ PDF)**; **concessions** reduce what is
owed, **late fees** increase it, **refunds** reverse it, **dunning** reminds
about it, and **reconciliation** checks the ledger against what the gateway
actually captured. Every rupee is `bigint` paise — no floats anywhere
(`server/src/fees/installments.js`, audit money-math row).

Schema-enforced invariants (migration `109`, extended `129`):

- `obligations_reductions_nonneg`:
  `concession_cents ≥ 0 AND waived_cents ≥ 0 AND amount − concession − waived ≥ 0`
- `obligations_paid_lte_net`: `paid_cents ≤ net_amount_cents`, where
  `net_amount_cents` is a **generated column**
  `amount − concession − waived + late_fee` (migration `129` folded the late
  fee in; `net` is never written directly)
- `payments`: `refunded_cents ≤ amount_cents`;
  `status <> 'confirmed' OR gateway_ref IS NOT NULL`

### 12.2 Who does what (roles)

Finance is a split desk (migration `109`):

| Role | Meaning |
|---|---|
| `finance_clerk` | maker only — initiates/collects, requests concessions, runs dunning. **Cannot confirm** (`POST /fees/payments/:id/confirm` admits only `finance, finance_head, owner` — D6), cannot approve a material refund |
| `finance` | legacy broad role, grandfathered as head-equivalent |
| `finance_head` | checker — confirms, reconciles, decides concessions, runs late fees, edits policy |
| `owner` | everything, including the only `POST /fees/obligations/:id/void` and `PUT /fees/settings` (shared with `finance_head`) |
| `principal` | reads the ledger, creates plans, runs dunning, decides concessions, extends due dates |
| `parent` | structurally scoped to own children via `family.child_link` — can initiate, never confirm; a cross-child id returns empty/404, never another family's rows |
| `student` | read-only own-dues via `app.student_accounts` (`GET /student/fees`), never initiates |
| `teacher` | no fee mandate except **requesting** a concession; refused on create/generate/void/confirm/refund |
| `coordinator` / `itadmin` | read the ledger where admitted, move no money |

`FEE_LEDGER_ROLES = {owner, principal, itadmin, finance, finance_head,
finance_clerk, coordinator}` gates every staff-wide read; `canReach()` also
honours a custom role's explicit door grant. All writes run through
`withUser(tenant, role)` (RLS as `schoolos_app`) and write `auditLog` +
usually `emitEvent`.

Counter-PINs (`POST /fees/pins`): cash at the desk is the borrowed-phone fraud
vector. Owner/head enrolls a 4–6 digit PIN per counter-staff member
(hash-only, `app.fee_pins`). If a PIN is enrolled for that user, every `cash`
initiation must present it; unenrolled staff work exactly as before.

### 12.3 Data plane (tables)

| Table | What it is | Key columns |
|---|---|---|
| `fee_heads` | charge categories (Tuition, Transport, Admission…) | `name UNIQUE(tenant,name)`, `category, tax_code, gl_ledger_name, active`, policy flags `applies_late_fee, allows_installments, allows_concession, refund_window_days, sort_order` (150) |
| `fee_plan_templates` | reusable billing recipe | `name UNIQUE(tenant,name)`, `grades text[]`, `terms jsonb [{term,label,amount_cents,due_on?}]`, `academic_year_id, fee_head_id, installments jsonb, auto_concession jsonb, hike_pct, consultation_meeting_id` |
| `billing_runs` | one generation = one run | `plan_template_id, created_by, note`, `status open\|void`, `policy_snapshot jsonb` (150) |
| `fee_obligations` | the receivable — one row per student × term | `student_id, term, label, due_on, amount_cents, concession_cents, waived_cents, late_fee_cents, net (generated), paid_cents, status open\|partial\|paid\|void`, `fee_head_id, billing_run_id, academic_year_id, source_ref='feeplan:<id>'`, `invoice_file_id`. Idempotency key `UNIQUE(tenant, student, term, label)` |
| `fee_installments` | scheduled parts of one obligation | `(tenant, obligation, seq) UNIQUE`, `due_on, amount_cents, status pending\|paid\|overdue\|waived, payment_id`, `updated_at/by, waived_reason` (150) |
| `payments` | one settlement attempt | `student_id, obligation_id (legacy single), amount_cents, refunded_cents, method, status initiated\|confirmed\|refunded\|failed, gateway_ref, receipt_no, settled_by/via gateway\|manual\|auto(reserved), reconciliation_status unreconciled\|matched\|manual\|disputed, confirmed_at, refund_reason/ref/gateway_ref/at, idempotency_key` |
| `payment_allocations` | pay-many split | `(tenant, payment, obligation) UNIQUE`, `amount_cents` — one payment across ≤20 obligations of the **same student** |
| `payment_events` | append-only money trail (audit's second trail) | `payment_id, kind initiated\|confirmed\|refunded\|failed\|webhook_fact\|reconciled\|disputed\|allocation, actor/role, source, amount_cents, payload`. Best-effort: never rolls back the ledger |
| `fee_receipts` | immutable numbered receipts | `(tenant, receipt_no) UNIQUE`, `payment_id, student_id, amount_cents, issued_by/at, voided_at, pdf_file_id → app.files` |
| `fee_concessions` | discount instances | `student_id, obligation_id?, fee_head_id?, kind concession\|scholarship\|sibling\|staff\|waiver, percent\|amount_cents, reason, status requested\|approved\|rejected\|active\|expired, requested_by/approved_by/at, valid_from/to`. Propose-dedup `UNIQUE(tenant, student, obligation, kind) WHERE requested` (150) |
| `fee_discount_rules` (150) | scholarship **catalogue** | `name UNIQUE(tenant,name)`, `kind merit\|need\|ews\|rte\|sibling\|staff\|early_bird\|other\|…`, `value_type percent\|flat, value_numeric`, `max_per_student_cents, valid_from/to, grades[], fee_head_id, requires_approval, auto_apply, stackable, priority, active` |
| `fee_late_rules` (150) | per-head late overrides | `fee_head_id null=default, mode per_day\|fixed\|percent, per_day/fixed/percent/cap/grace, active` |
| `fee_dunning_log` | dunning audit/dedup | `obligation_id, kind before_due\|overdue\|escalation, channel, offset_days, dedup_key UNIQUE WHERE NOT NULL` |
| `fee_settings` | per-tenant knobs | `tenant_id PK, settings jsonb, updated_at` — merged over `FEE_SETTING_DEFAULTS` on every read |
| `fee_pins` | counter PIN hashes | `(user_id) UNIQUE, pin_hash` |
| `recon_runs` (147) | sweep history | `source, ran_by, ghost/missing/orphan/amount_mismatch counts, actions_raised` |

Migrations that built this: `059` templates + idempotency key → `109`
enterprise plane (heads, allocations, events, receipts, concessions,
installments, dunning log, finance split, net column) → `110` settings +
receipt PDF pointer + usage meter → `128` `auto_concession` → `129`
`late_fee_cents` folded into net → `131` `invoice_file_id` → `150` policy
tables + head flags + installment audit + concession dedup.

### 12.4 Tenant policy — everything is configurable

`feeSettings()` returns `DEFAULTS + stored jsonb`. `PUT /fees/settings`
(owner/`finance_head` only, audited `Fees §1`) validates every key; unknown
keys are 400. Current defaults:

- **Refunds:** `refund_approval_threshold_cents 500000` (₹5,000),
  `refund_window_days 0` (0 = no window), `refund_deduction_pct 0`,
  `refund_require_reason false` (still mandatory **above** threshold),
  `refund_partial_allowed true`, `refund_auto_gateway false`
- **Payments:** `enabled_methods [upi, razorpay, cash, card, cheque,
  netbanking, bank_transfer, manual]`, `overpayment_rule 'refuse'`,
  `cash_requires_pin true`, `allow_parent_partial true`,
  `min_partial_cents 10000` (₹100)
- **Receipts/invoices:** `receipt_prefix 'RCP'`, `receipt_series_start 1`,
  `receipt_reset never|yearly|academic_year`, `invoice_notes ''`,
  `invoice_show_breakup true`
- **Late fees:** `late_fee_enabled false`,
  `late_fee_mode per_day|fixed|percent`, `late_fee_per_day_cents 0`,
  `late_fee_fixed_cents 0`, `late_fee_percent 0`, `late_fee_cap_cents 0`,
  `late_fee_grace_days 0`, `late_fee_auto_run false`
- **Installments:** `installment_mode equal|custom|percent`,
  `installment_max_parts 12`, `installment_allow_edit true`,
  `installment_rounding remainder_last`
- **Dunning:** `dunning_enabled true`, `dunning_before_due_days []`,
  `dunning_escalation_days []`, `dunning_quiet_start 21:00`,
  `dunning_quiet_end 08:00`, `dunning_channels [whatsapp]`,
  `dunning_stop_on_partial false`
- **Concessions:** `concession_stacking single_best|additive_capped`,
  `concession_cap_pct 100`, `sibling_min_children 2`,
  `staff_default_pct 0`, `allow_owner_self_approve true`
- **Governance:** `hike_review_threshold_pct 10`,
  `hike_evidence_max_age_days 180`, `default_due_time_ist 23:59`,
  `max_extension_days 30`, `settlement_slo_hours 24`,
  `reconciliation_tolerance_cents 0`, `reconciliation_auto_match true`

Plan-tier gates (`entitlements.js`, `GET /fees/entitlements`, 402 on gap):
`collection` (all plans) → `heads, concessions` (operations+) →
`installments, multi_obligation` (campus+) → `dunning, reconciliation`
(rails; trial gets everything).

### 12.5 The flows, door by door

**Heads** — `GET /fees/heads` (staff; `?includeInactive`),
`POST /fees/heads` (owner/principal/finance/head; 402 without `fees.heads`;
409 on duplicate name). `applies_late_fee=false` skips the head in the late
run; `is_refundable=false` or `refund_window_days` blocks refunds;
`allows_installments/concession` are recorded policy.

**Plans** — `GET /fee-plans` lists templates with
`obligations_generated, last_generated_at` + head name.
`POST /fee-plans` validates `name ≤80`, `grades 1–40`,
`terms 1–24 [{term ≤40, label ≤80, amount_cents int ≥0, due_on?}]`,
`installments 1–24 [{amount_cents | percent 0–100 (not both), due_on?}]`,
`autoConcession {kind:'sibling', percent 0–100, min_children 2–10}`,
`hikePct 0–100` (above the tenant threshold needs a cited SMC meeting
`kind='SMC'` within the tenant max-age, else 400),
`academicYearId/feeHeadId` must reference this school.
`POST /fee-plans/:id/preview` dry-runs (scope count + 10-student sample,
`writes:false`); `POST /fee-plans/:id/clone {name, academicYearId?}` copies
a plan for year rollover; `POST /fee-plans/:id/generate` locks the template,
creates a `billing_runs` row, `INSERT … SELECT active students × terms
ON CONFLICT DO NOTHING RETURNING`, splits each new obligation via
`splitInstallments()` (explicit paise honored, `percent` →
`floor(total·pct/100)`, remainder shared evenly with leftover on the last
open part), writes `fee_installments ON CONFLICT DO NOTHING` (paid parts
never re-created), then applies `auto_concession.sibling` as
`concession_cents = round(amount·pct/100)` only where
`concession_cents = 0` and guardian-phone sibling count ≥ min. Returns
`{inserted, skipped, students, terms, installmentsCreated, autoConcessions,
billingRunId}`; regeneration is safe by construction.
`POST /billing-runs/:id/void` (owner/head) refuses when any obligation
carries `paid_cents > 0`, else voids all open obligations in the run.

**Obligations** — `GET /fees/obligations?studentId&status` (paged 100/500;
parent → own children, student → own row via `student_accounts`, staff →
full ledger or 403 with a plain-language message).
`GET /fees/obligations/:id` adds payments + installments with the same
scoping. Lifecycle: `open → partial → paid`, plus `void`.
`POST /fees/obligations/:id/void` (owner only; refuses `paid_cents > 0` —
"refund before voiding").
`POST /fees/obligations/:id/extend {due_on, reason}`
(owner/head/principal; forward-only, capped by `max_extension_days`).
`GET /fees/obligations/:id/invoice` renders a deterministic invoice text
into `app.files` on first request and returns the cached artifact after
(`invoice_file_id`; includes amount/concession/waived/late/net/paid/due/
status + tenant `invoice_notes`).

**Installments** — `GET /fees/installments?obligationId&studentId&status`
(parent scoped; staff or 403).
`PATCH /fees/installments/:id {due_on?, amount_cents?}` (owner/head;
refused when `installment_allow_edit=false`, or status ≠ pending; stamps
`updated_at/by`, audited).
`POST /fees/installments/:id/waive {reason}` → `status='waived'` +
`waived_reason`. Confirm settles installments **in order** up to the new
paid total.

**Concessions** — `POST /fees/concessions` (owner/principal/finance/clerk/
**parent/teacher**; parent scoped to own child; 402 without
`fees.concessions`) creates `requested` with `percent|amountCents + reason`.
`GET /fees/concessions?status` (requesters see only own requests; staff see
the ledger). `POST /fees/concessions/:id/decide {approve|reject}`
(owner/principal/finance/head; requester ≠ approver unless owner —
`SOD_REQUIRED`; already-decided → 409). Approve with an `obligation_id`
locks the obligation, computes `reduction` (flat or `%` of
`amount − concession − waived`), clamps to the unpaid remainder, adds to
`concession_cents` (or `waived_cents` for `waiver`), flips to `approved`. A
null-obligation approval is a recorded no-op. Discount **rules**
(`GET/POST /fees/discount-rules`, owner/head) are the catalogue behind this
— kinds, %/flat, caps, validity, grades/heads, approval/auto/stack/priority
flags.

**Payments: initiate** — `POST /fees/payments
{obligationId|obligationIds[≤20], method, amountCents?, pin?}`
(parent/finance/clerk/head/owner/principal). Validates uuids, method ∈
tenant `enabled_methods` (else 400 naming the enabled rails),
`Idempotency-Key` shape, cash PIN when enrolled, locks obligations in id
order (no deadlocks), parent→own-children only (404 otherwise),
single-student only, skips settled rows (`OBLIGATION_SETTLED`), refuses
double-`initiated` per obligation (`PAYMENT_IN_PROGRESS`),
`amountCents ≤ totalDue` (overpay → 400; default `refuse`), partials gated
by `allow_parent_partial/min_partial_cents`. Allocates greedily in
obligation order, inserts `payments(initiated)` + `payment_allocations`,
emits `payment.initiated` + `paymentEvents(initiated)`. Idempotent on repeat
key.

**Payments: confirm (settlement)** — `POST /fees/payments/:id/confirm
{gatewayRef?}` (finance/head/owner only). Idempotent on `confirmed`.
Refuses non-`initiated`, refuses voided obligations (RTE-5, before any
mutation). Gateway provenance is **evidence, not regex**: a non-`MANUAL`
ref is `verified` only if `plugin_razorpay.order_log` (order or payment id
on **this** payment) or `plugin_upi.webhook_log` contains it (`to_regclass`
so missing plugin = unverifiable, not 500); otherwise it settles as
`settled_via='manual'` with stored ref `MANUAL`. Under a per-tenant
advisory lock it mints the next receipt number (`prefix-000001…`, or
`prefix-YYYY-NNNN` when `receipt_reset='yearly'`), flips `confirmed`
(`reconciliation_status matched` if gateway else `manual`), distributes
`paid_cents` across **allocations** (legacy single-obligation fallback),
flips each obligation `paid|partial` against **net**, settles installments
in order, inserts the immutable `fee_receipts` row (hard error on
collision, never silent skip), renders the dependency-free PDF artifact
(`receipt-pdf.js` → `app.files`), records `paymentEvents(confirmed)`,
emits + audits, and queues a `FEE_RECEIPT` communication to resolved
guardian phones (`family.child_link → users.phone`, fallback
`students.guardian_phone`).

**Receipts/invoices** — `GET /fees/receipts?studentId`,
`GET /fees/receipts/:id` (full receipt + student + obligation +
method/provenance), `GET /fees/receipts/:id/pdf` (same scoping as the read;
streams the stored file with `no-store`; 404 no artifact, 410 file gone).
Full refunds void open receipts. `GET /student/fees` is the student
self-view (obligations + payments + receipts + `outstandingCents`,
`linked:false` when no `student_accounts` row).

**Refunds** — `POST /payments/:id/refund {refundCents?, reason?}`
(finance/clerk/head/owner). Only `confirmed`; double-refund → `CONFLICT`;
`refundCents` positive ≤ refundable (default = full remainder). Policy:
partial refused when `refund_partial_allowed=false`; reason mandatory when
`refund_require_reason=true` **or** (full refund ≥ tenant threshold → maker
`finance_clerk` refused + settler ≠ approver unless owner + reason
mandatory, `SOD_REQUIRED`). Window: tenant `refund_window_days` and
per-head `refund_window_days` from `confirmed_at`; non-refundable heads
refuse. Ledger-first (RTE-2): obligations locked and reversal proven
**before** any gateway call; inconsistent ledger → `LEDGER_INCONSISTENT`,
gateway untouched. Razorpay leg refunds via gateway or degrades to
recorded-manual with a note; then reverses `paid_cents` across allocations
(status back to `open|partial|paid`), bumps `refunded_cents`
(CHECK-capped), flips `refunded` only when fully reversed, voids receipts
on full refund, records `paymentEvents(refunded)` + audit + event.

**Late fees** — `POST /fees/late-fees/run (?dryRun=true)` (owner/head).
Modes from policy: `per_day` (days-overdue − grace × rate, capped), `fixed`
(flat, capped), `percent` (% of amount, capped); `SET` not increment
(idempotent); heads with `applies_late_fee=false` skipped; per-head
`fee_late_rules` override when present; pre-150 DBs fall back to legacy
per-day SQL. `dryRun` returns `{wouldUpdate, sample[20]}` without writing.
`POST /fees/obligations/:id/late-fee/waive {reason}` zeroes with audit.

**Dunning** — `POST /fees/dunning/run`
(owner/principal/finance/clerk/head; 402 without `fees.dunning`) + the same
selection shared with `scripts/dunning-reminders.js` / `day-worker.js`
(`src/fees/dunning.js` — `OVERDUE/BEFORE_DUE/ESCALATION_SQL`,
bodies, dedup keys, selectors, `outstanding()`). Policy: fee-settings
ladder first (`dunning_before_due_days`, `dunning_escalation_days`),
`comms.whatsapp` plugin second; quiet hours fee-settings first, plugin
fallback (`21:00–08:00` IST default) — inside quiet hours the sweep
**writes nothing** and returns `{queued:0, quietHours, note}`. Classes:
overdue (due < today, outstanding, no `dunning:<id>` in 7 days) always on;
before-due (due within each offset, per-offset `due:<id>:<n>` dedup)
opt-in; escalation (overdue ≥ N days, `escalation:<id>:<n>` dedup) raises a
`fee.overdue.<id>` finance Action (high). Queueing is
`communications(template FEE_REMINDER/FEE_ESCALATION, channel whatsapp,
dedup_key ON CONFLICT DO NOTHING)` + `fee_dunning_log`; phoneless
guardians counted as `skippedNoContact`, never failed. Emits `fee.due` per
newly queued obligation. `GET /fees/delivery` is the fee-message subset
with carrier state; the all-tenant worker `runDunning()` is the cron entry.

**Reconciliation** — `POST /payments/reconcile`
(owner/finance/clerk/head; 402 without `fees.reconciliation`) vs
`scripts/reconcile-payments.js` share `src/fees/reconcile.js`: four classes
— `ghost` (ledger confirmed, rail not captured), `missing` (rail captured,
ledger unconfirmed), `orphan` (confirmed, no rail log), `amount_mismatch`
(|ledger − rail| > tenant `reconciliation_tolerance_cents`). Findings never
move money: each marks `reconciliation_status='disputed'`, writes
`paymentEvents(disputed)`, emits an event, raises **one** owned
`fee.recon.<class>.<paymentId>` Action (finance_head,
`ON CONFLICT DO NOTHING`), and records `recon_runs`.
`POST /payments/:id/mark-matched {note?}` (owner/finance/head) closes the
loop (`matched` + resolve matching Actions + `reconciled` event + audit).
`GET /payments/recon-runs?limit` is the sweep history header;
`GET /payments?recon=disputed` is the mismatch queue.

### 12.6 Integrity, isolation, observability

- **Tenancy:** every fee table is RLS `tenant_isolation` on
  `app.current_tenant()`, composite `(tenant_id, …)` FKs,
  `GRANT SELECT,INSERT,UPDATE` only (never DELETE — money rows are
  voided/refunded, not deleted). Cross-tenant reads return empty;
  cross-tenant writes are rejected.
- **Concurrency:** obligations locked `FOR UPDATE` in sorted id order;
  receipt numbering under
  `pg_advisory_xact_lock('fee_receipt:<tenant>')`;
  one-`initiated`-per-obligation; generation `ON CONFLICT DO NOTHING` +
  `paid_cents` invariant (regeneration never touches paid rows).
- **Audit/events:** every mutation writes the hash-chained audit ledger
  with actor/role/action/record/reason/policyRef (`Fees §N`)/outcome, plus
  domain events (`fee.due`, `payment.initiated/confirmed/refunded`,
  dunning summaries, recon discrepancies). `payment_events` is the
  per-payment trail; `recon_runs`, `fee_dunning_log`,
  `billing_runs.policy_snapshot` give the sweep/generation history.
- **Delivery honesty:** comms rows are queued for `comms-dispatcher.js`;
  sandbox carriers record `failed` with reason, never `sent`. Receipt SMS
  uses resolved guardian phones.
- **Ops:** `ops/cron/schoolos.cron` sequences `day-worker.js` (tally,
  retention, **dunning**, library, compliance) and the money-ledger/chain
  drill; alerts cover `fee_reconciliation_discrepancies`, settlement
  latency, and dunning-queue age.

### 12.7 The desk UI (what the tenant clicks)

`Fees.tsx` tabs — **ledger | payments | installments | delivery |
concessions | byclass | plans** — all live doors, toasts only on 2xx
quoting the server receipt: search-first ledger table with status badges,
per-student drawer, void (owner + reason), invoice generation, **Fee policy
card** (owner/head — every knob in §12.4), RecordPaymentModal (cash PIN when
enrolled), confirm (checker only), refund (reason above threshold),
reconcile + mismatch queue, dunning run buttons, counter-PIN enrollment
card. Plans tab (`finance/FeePlans`): create (grades/terms/head/
installments/auto-concession/hike + SMC cite), preview (no writes),
generate (inserted/skipped/installments/auto-concessions/run id), clone for
next year. Parent (`/parent/fees`) and student (`/student/fees`) views are
the family-scoped mirrors.

---

## Part 13 — Tenant configuration runbook: everything, one by one

> Do it in this order — each step unlocks the next. All under **Fees**;
> every save is audited. You need **owner** or **finance_head** unless
> stated. Paise rule: the ledger stores paise, screens collect rupees —
> type `12000` for ₹12,000; the app converts (`×100`) once before sending.

### Step 0 — Open the desk

**Fees** → tabs `ledger | payments | installments | delivery |
concessions | byclass | plans`. The **Fee policy** card (ledger/payments
area) is Step 1; the **plans** tab is Step 5.

### Step 1 — Fee policy (the master switches)

**Where:** Fees → Fee policy card → **Save policy**. **Door:**
`PUT /fees/settings`. **Who:** owner / finance_head.

| Field | What it does | Example |
|---|---|---|
| Refund approval threshold (₹) | full refunds at/above this need a checker + reason; clerks can never approve them | `5000` |
| Refund window (days, 0 = none) | refunds refused after N days from confirmation | `90` |
| Partial refunds | `Allowed` / `Full only` | Allowed |
| Receipt prefix + reset | `RCP-000421`, or yearly `RCP-2026-0042` | prefix `RCP`, reset `Yearly` |
| Late fees on/off + mode | `Off` until you switch on; `Per day \| Fixed \| Percent` | On, Per day, ₹5/day |
| Late grace + cap | grace days at zero fee; cap `0` = none | grace `3`, cap `500` |
| Min partial (₹) + Parent partials | smallest part-payment; whether parents may part-pay | `100`, Allowed |
| Remind before due | comma list — days before due that remind | `7,3,1` |
| Escalate after | days overdue that raise a finance task | `30` |
| Quiet start / end | IST window where reminders **write nothing** | `21:00` / `08:00` |
| Max installments | cap on parts per obligation (1–24) | `4` |
| Max extension (days) | how far a due date may be pushed | `30` |
| Invoice note | printed on every invoice | `Pay before due date…` |

Leave what you don't use at defaults — a fresh tenant behaves exactly as
before until you change something.

### Step 2 — Fee heads (the categories)

**Door:** `POST /fees/heads`. **Who:** owner / principal / finance /
finance_head. **Why first:** plans, obligations, late-fee and refund rules
all point at a head.

Create one by one, e.g. `Tuition`, `Transport`, `Admission`, `Exam`:
`name` (required, ≤80, unique per school), `category`, `taxCode`,
`glLedgerName`, `isRefundable` (`false` for Admission — refunds touching it
are refused), `refundWindowDays` (e.g. `30` on Exam),
`appliesLateFee` (`false` for heads you never fine),
`allowsInstallments` / `allowsConcession`, `sortOrder` for display.
Duplicate name → `409`. Reports group by head, not free text.

### Step 3 — Scholarship / discount catalogue

**Door:** `GET/POST /fees/discount-rules`. **Who:** owner / finance_head.

One rule per scheme, e.g. `Sibling 10%`
(`kind: sibling, valueType: percent, value: 10, requiresApproval: true`),
`Staff 25%`, `Merit ₹5,000`
(`kind: merit, valueType: flat, value: 5000, maxPerStudentCents,
validFrom/validTo, grades, feeHeadId`), `EWS / RTE`. Flags:
`requiresApproval` (default true — request→approve), `autoApply` (propose
at generation), `stackable`, `priority`, `active`. Duplicate name → `409`.
Instances still live in `POST /fees/concessions` + decide door — the
catalogue is the *policy*, concessions are the *cases*.

### Step 4 — Late-fee overrides (optional)

**Door:** `GET/POST /fees/late-rules`. **Who:** owner / finance_head.

Only if heads differ: Tuition `per_day ₹5, grace 3, cap ₹500`, Transport
`fixed ₹200`, Admission *no rule + `applies_late_fee=false`* = never fined.
No `feeHeadId` = tenant default from Step 1. Test with
`POST /fees/late-fees/run?dryRun=true` — `{wouldUpdate, sample[20]}`
without writing.

### Step 5 — One fee plan (the core step)

**Where:** Fees → **plans** tab → **New plan**. **Doors:**
`POST /fee-plans`, `POST /fee-plans/:id/preview`,
`POST /fee-plans/:id/generate`. **Who:** owner / principal / finance /
finance_head / finance_clerk.

1. **Name** — `Grade 6 T1`, ≤80, unique (`409` on duplicate).
2. **Grades** — tick from **your school's own classes** (picker reads
   `GET /school/classes`). Generation bills only `status='active'`
   students in these grades.
3. **Fee head** — from Step 2 (rides every obligation for reports).
4. **Academic year** — validated against your calendar.
5. **Terms** — one row per bill: `term` (e.g. `T1`), `label` (e.g.
   `Tuition T1`), amount in **rupees**, `due_on YYYY-MM-DD` (optional).
   1–24 rows, `amount_cents ≥ 0`.
6. **Installments** — count or custom parts. Each part: `amount_cents`
   **or** `percent 0–100` (not both) + `due_on?`. Omitted amount = equal
   share of the remainder, leftover paise on the last part (sums exactly).
7. **Auto-concession** — `{kind: sibling, percent: 10, min_children: 2}`
   (sibling = shares a guardian phone). Applied only where
   `concession_cents = 0`.
8. **Hike** — `hikePct` + `consultationMeetingId`. Above your threshold
   (default 10%) you **must** cite the SMC meeting (`kind='SMC'`, within
   your max-age, default 180 days) — else `400`.

Save → template created (audited). A plan is a recipe, not a meal: no
child owes anything yet.

### Step 6 — Preview, then generate

1. **Preview** (`POST /fee-plans/:id/preview`): `{studentsInScope,
   sample[10], installments, autoConcession, writes:false}`. Wrong grades =
   zero students, no error, no bills — check the count.
2. **Generate** (`POST /fee-plans/:id/generate`): creates a **billing
   run**, then one obligation per student × term
   (`ON CONFLICT (tenant, student, term, label) DO NOTHING` — regeneration
   skips, **never touches paid rows**), then installments, then sibling
   concessions. Returns `{inserted, skipped, students, terms,
   installmentsCreated, autoConcessions, billingRunId}`. Mistake?
   `POST /billing-runs/:id/void` (owner/head) voids the run **only if no
   money** sits on any obligation; otherwise refund first.

### Step 7 — Installments & due dates (after billing)

- **View:** `GET /fees/installments?obligationId&status`.
- **Edit a pending part:**
  `PATCH /fees/installments/:id {due_on?, amount_cents?}` (owner/head;
  refused if the school disabled editing or the part isn't `pending`).
- **Waive:** `POST /fees/installments/:id/waive {reason}` → `waived`.
- **Extend a due date:** `POST /fees/obligations/:id/extend {due_on,
  reason}` (owner/head/principal; forward-only, capped by
  `max_extension_days`).
- **Waive a late fee:**
  `POST /fees/obligations/:id/late-fee/waive {reason}`.
- **Void a wrong due:** `POST /fees/obligations/:id/void` (owner only;
  refuses `paid_cents > 0` — refund first).

### Step 8 — Discounts in action

- **Request:** `POST /fees/concessions {studentId, obligationId?, kind,
  percent|amountCents, reason}` — parents/teachers may request (parents:
  own child only); staff too.
- **Decide:** `POST /fees/concessions/:id/decide {approve|reject}` —
  owner/principal/finance/head; requester ≠ approver (owner excepted, else
  `SOD_REQUIRED`); approve adds to `concession_cents` (or `waived_cents`
  for `waiver`), clamped to the unpaid remainder — `paid_cents` never
  moves. Null-obligation approvals are recorded no-ops.

### Step 9 — Collect money

- **Initiate** (`POST /fees/payments`): pick obligation(s) (≤20, same
  student), method (must be in your `enabled_methods` — disabled rails get
  a 400 naming what's enabled), amount (≤ outstanding; partials need
  `allow_parent_partial` + ≥ `min_partial_cents`), cash PIN when enrolled.
  Creates `initiated` + allocations. One `initiated` per obligation;
  parent cross-child → 404.
- **Confirm** (`POST /fees/payments/:id/confirm {gatewayRef?}`,
  finance/head/owner only): verifies the ref against the gateway's own log
  or settles `manual` with sentinel `MANUAL`; mints the next receipt number
  (per-tenant lock; yearly reset when configured); moves `paid_cents`
  across allocations (`open→partial→paid` vs net); settles installments in
  order; writes the immutable receipt + PDF; sends `FEE_RECEIPT` to
  resolved guardian phones.
- **Receipts/invoices:** `GET /fees/receipts`,
  `GET /fees/receipts/:id/pdf` (same parent scoping),
  `GET /fees/obligations/:id/invoice` (renders once, caches via
  `invoice_file_id`, includes your invoice note).

### Step 10 — Refunds (when needed)

`POST /payments/:id/refund {refundCents?, reason?}` — only `confirmed`.
Partial keeps `confirmed` + bumps `refunded_cents`; full flips `refunded` +
voids open receipts. Enforced in order: partial toggle → reason rule →
global + per-head window → threshold SoD (clerk never, settler ≠ approver,
reason mandatory) → ledger proven before any gateway call
(`LEDGER_INCONSISTENT` if unrepresented) → gateway or recorded-manual →
reverse allocations.

### Step 11 — Reminders & reconciliation (daily ops)

- **Reminders** (`POST /fees/dunning/run`): reads your ladder (Step 1).
  Overdue always on (7-day `dunning:<id>` dedup); before-due per offset
  (`due:<id>:<n>`); escalation per age (finance task `fee.overdue.<id>`).
  Inside quiet hours: writes nothing, returns when it opens. Phoneless
  guardians counted as skipped. Watch `GET /fees/delivery`. Same sweep runs
  from `day-worker.js` / `dunning-reminders.js` cron.
- **Reconciliation** (`POST /payments/reconcile`): ledger vs rail —
  `ghost / missing / orphan / amount_mismatch` (tolerance from Step 1).
  Each finding → `disputed` + event + one finance_head Action +
  `recon_runs` row. Never moves money. Clear with
  `POST /payments/:id/mark-matched {note?}`. Same logic in
  `reconcile-payments.js` worker.
- **Counter PINs:** Fees → Counter PINs card → pick staff → 4–6 digits
  (`POST /fees/pins`). Their cash collections now require it.

### Step 12 — Next year

`POST /fee-plans/:id/clone {name, academicYearId}` — copies
grades/terms/head/installments/auto-concession into the new year; adjust
amounts/hike there, then preview → generate again.

Do plans one at a time (one head, one grade-set, preview, generate, check
counts) and the whole domain stays consistent — policy first, heads
second, plan last, money always audited.
