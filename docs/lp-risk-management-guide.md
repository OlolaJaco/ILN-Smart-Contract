# LP Risk Management Guide

**Audience:** liquidity providers (LPs) who fund invoices on ILN.
**What this is:** practical guidance on the **credit risk** you take when you
fund an invoice — how to vet who will pay, how to spread exposure, and how to
use the reputation and default data ILN exposes.
**What this is not:** financial, legal or tax advice. ILN is a permissionless
protocol; nothing here is enforced on-chain and nothing here removes risk.

---

## 1. The risk you are taking

When you fund an invoice you advance cash to the freelancer and expect the
**payer** to settle the face value by the due date. Your return is the discount.
Your risk is the payer not paying.

| Outcome | What happens to you |
|---|---|
| Payer settles on time | You receive principal + discount |
| Payer settles late | You receive principal + discount, later than planned (capital tied up) |
| Payer does not settle; you `claim_default` | You lose principal unless recovered via appeal reversal or an insurance claim (§6) |
| Payer disputes / appeals the default | Outcome depends on the appeal ruling; an upheld appeal reverses the payer's reputation penalty |

Three facts shape everything below:

1. **The protocol enforces payment terms; it does not create a payment
   obligation.** The payer is an on-chain address named by the freelancer. Unless
   an identity/verification oracle is configured for that payer, the protocol
   does not prove the named business ever agreed to the invoice.
2. **Loss is asymmetric.** A default costs you the principal; a success earns you
   the discount. At a 3% discount, one full-loss default cancels the profit from
   ~33 successful invoices of equal size.
3. **You are paid for funding, not for repayment.** Any governance-token reward
   accrues when you fund (`accrue_lp` fires at `fund_invoice`), so it does not
   compensate for credit loss.

### 1.1 Break-even default rate

With per-invoice yield *y* (discount earned if paid) and a 100% loss if not
paid, you break even when the default probability *d* satisfies
`(1 − d)·y = d`, i.e. `d = y / (1 + y)`.

| Discount yield *y* | Break-even default rate |
|---|---|
| 1% | 0.99% |
| 2% | 1.96% |
| 3% | 2.91% |
| 5% | 4.76% |
| 10% | 9.09% |

If your realistic estimate of a payer's default probability is anywhere near
the break-even, do not fund. The table ignores your cost of capital, gas and
time value, so real break-even is lower.

---

## 2. KYC and counterparty-risk checks

ILN has no KYC layer. **Counterparty diligence is your job**, and it happens
off-chain before you call `fund_invoice`. Work through this list; skip funding
if you cannot answer the first three.

### 2.1 Before funding an invoice

| # | Check | Why it matters |
|---|---|---|
| 1 | **Who is the payer, in the real world?** Establish the legal entity behind the payer address by an out-of-band channel (contract, email domain, payment history) — not by the address alone | An address is not an identity; the freelancer chose it |
| 2 | **Did the payer accept the invoice?** Ask for evidence (signed PO, accepted statement of work, or a confirmation from the payer's finance contact) | Funding an invoice the payer never agreed to is the classic fraud shape |
| 3 | **Is the freelancer real and unrelated to the payer?** Look for shared ownership, the same person controlling both addresses, or a fresh freelancer address with a large first invoice | Related-party invoices default by design or are used to launder volume |
| 4 | **Payer capacity to pay** — size, sector, and whether the amount is normal for them | A large invoice to a small payer is a concentration and capacity risk |
| 5 | **Tenor vs. discount** — longer terms carry more risk; check the discount pays for it (§1.1) | Time is default risk |
| 6 | **Is the payer verified by an oracle?** If the protocol has an `Identity` oracle registered, check the payer's status via the funding path; if not, treat every payer as unverified | The optional payer-verification oracle is the only on-chain identity signal ([oracle-integration.md](oracle-integration.md)) |
| 7 | **Sanctions / jurisdiction** — screen the payer and freelancer where your jurisdiction requires it | Protocol is permissionless; your legal obligations are yours ([FAQ #5](faq.md)) |

### 2.2 Red flags

- Freelancer address is new, has no settled history, and submits a large invoice.
- Payer and freelancer addresses were funded from the same source.
- Discount is far above the market for the payer's apparent quality — someone
  else has already declined it.
- Due date at the minimum or maximum of the allowed range with no explanation.
- The invoice is repeatedly re-submitted with small changes after being ignored.
- Pressure to fund quickly or off-platform.

### 2.3 Keep records

Keep, for every funded invoice: the payer's confirmation, the correspondence,
the on-chain invoice ID and your funding transaction. You will need them for an
appeal, an insurance claim ([§6](#6-insurance-and-recovery)) or your own
accounting.

---

## 3. Portfolio diversification

Credit losses are lumpy. Diversification is the only lever you fully control.

### 3.1 Suggested limits (starting points — tune to your risk appetite)

| Dimension | Guideline | Reason |
|---|---|---|
| Single payer | ≤ 10% of your deployed capital (≤ 5% for unverified or new payers) | One default cannot exceed that share of principal |
| Single freelancer | ≤ 10% | Same freelancer can generate correlated fraud |
| Single sector / industry | ≤ 25% | Sector shocks default many payers at once |
| Single token | Set a cap per token; treat non-stablecoins as price risk on top of credit risk | Payment token can depeg or lose liquidity |
| Single due-date week | ≤ 25% of capital maturing in one week | Avoid liquidity cliffs and correlated late payments |
| Single invoice | Small relative to your total; use partial funding to share large invoices with other LPs | ILN supports `PartiallyFunded` invoices ([FAQ #14](faq.md)) |
| Minimum number of payers | ≥ 20 before you treat portfolio default rate as "average" | Below that a single default dominates the result |

### 3.2 How much diversification is enough

If you hold *N* equal positions and one defaults, you lose `1/N` of principal.
That loss equals `(1/N) / y` invoice-cycles of the **whole portfolio's** yield:

| Positions *N* | Loss from one default | Cycles of portfolio yield erased (at *y* = 3%) |
|---|---|---|
| 5 | 20% | 6.7 |
| 10 | 10% | 3.3 |
| 20 | 5% | 1.7 |
| 50 | 2% | 0.7 |

Rule of thumb: pick *N* so that **one default costs less than the yield you
expect from a single cycle of the whole portfolio**. At 3% yield that means
roughly ≥ 33 similar positions. If that is not practical, lower the per-payer
cap or fund fewer, higher-quality invoices.

### 3.3 Correlation traps

- **Same payer through many freelancers** is still one payer. Aggregate by payer.
- **Same sector, different payers** default together in a downturn.
- **Same due date** concentrates risk in time.
- **Same controlling entity** across freelancer and payer addresses — treat the
  group as one counterparty.

---

## 4. Using the reputation score

ILN tracks an on-chain reputation for payers and LPs. Read it before funding.
Model details are in [reputation.md](reputation.md) and
[reputation-model.md](reputation-model.md).

### 4.1 What the score means

| Fact | Detail |
|---|---|
| Scale | 0–100; new address starts at **50** (neutral) |
| On-time payment | +1 (capped at 100) |
| Default | −5 (floored at 0) — one default offsets five on-time payments |
| Decay | Inactive addresses decay over time (default 0.5% per ~30 days), computed when read |
| Appeals | An upheld appeal restores the pre-default score; a rejected one leaves the penalty |
| Profile fields | `score`, `invoices_submitted`, `invoices_paid`, `invoices_defaulted` |

### 4.2 How to read it in practice

Do not use the score alone. Read the counts:

- **A score of 50 means "no information"**, not "average". A payer with 0
  history and a payer who paid 30 and defaulted 6 can both show mid-range scores.
- **Volume behind the score matters.** `invoices_paid` of 40 with 0 defaults is
  strong evidence; a score of 70 from 5 invoices is weak.
- **Recent activity matters.** Decay means a high score with no recent
  activity is stale.
- **Default share matters.** Compute
  `invoices_defaulted / (invoices_paid + invoices_defaulted)`. Any payer above
  roughly half your break-even rate (§1.1) is not worth the discount.
- **Sudden jumps in `invoices_submitted` with few settlements** suggest a
  freshly created address inflating history — treat as unverified.
- **Reputation can be gamed** by settling many small invoices across related
  addresses ([reputation.md Q7](reputation.md)). Prefer histories with varied
  counterparties and sizes.

### 4.3 Suggested thresholds

| Payer profile | Suggested action |
|---|---|
| `score < 40` or any default in the last 90 days | Do not fund unless independently verified and priced for it |
| `40 ≤ score < 60`, few settlements | Fund only small positions (≤ 5% cap), short tenor |
| `score ≥ 60`, ≥ 10 settled, 0 recent defaults | Standard limits (§3) |
| `score ≥ 75`, ≥ 30 settled, varied counterparties | Upper limit of §3 caps |

The protocol also has a global `min_payer_reputation` gate set by admin
(`min_payer_reputation()` returns it; 0 = off). Treat that as a **floor**, not
a target. Set your own stricter client-side filter (see the LP filtering
approach in [reputation.md Part 4](reputation.md)).

### 4.4 Reading it

```ts
import { getReputation } from "@iln/sdk";

const rep = await getReputation(server, CONTRACT_ID, payerPublicKey, NETWORK_PASSPHRASE);
const settled = rep.invoicesPaid + rep.invoicesDefaulted;
const defaultShare = settled === 0 ? null : rep.invoicesDefaulted / settled;
```

Or via the indexer: `GET /reputation/:address?historyPeriod=90d` returns
`score`, the counts, `lastActivityLedger` and a score history you can chart for
trend. See [SDK Integration → Analytics](sdk-integration.md#analytics).

---

## 5. Using default and dispute data

### 5.1 What is available today

| Source | What it gives you | Limits |
|---|---|---|
| Indexer `GET /reputation/:address` | Per-address paid/defaulted counts and score history | No portfolio view; you aggregate |
| Indexer `GET /stats/analytics` | Yield trend, **dispute-rate** trend (weekly), token market share, top LPs by earnings | Dispute rate ≠ default rate; there is no dedicated protocol-wide default-rate endpoint yet |
| Indexer `GET /stats` and `/stats/history` | Counts of funded / paid / disputed / expired invoices, average discount | Protocol-wide only |
| Indexer `GET /invoices?status=…` | Filter your own book for `Defaulted`, `Funded` and overdue invoices | You must compute rates yourself |
| Indexer `GET /insurance/pool/:id/stats`, `/claims` | Pool balance, premiums, claims paid | Only relevant if you enrol |
| Insurance pool views (`get_pair_default_count`, `get_pair_collusion_flag`) | Defaults per (LP, payer) pair; collusion flag | Insurance-pool-specific |

> The audit readiness dashboard lists a dedicated LP-queue / default-rate
> dashboard as **open work** ([audit-readiness-dashboard.md](audit-readiness-dashboard.md)).
> Until it exists, use the combination above and compute default rate yourself.

### 5.2 A monitoring routine

Weekly:

1. List your open positions and mark those **past due date** — the ones that may
   need `claim_default` (only callable after the due date; check the appeal
   window before you rely on the outcome).
2. Recompute your **realised default rate** (defaulted / settled by count *and*
   by value) and compare it with the break-even rate for your average discount.
3. Recheck each large payer's reputation: any new default, score drop or long
   silence.
4. Look at the protocol **dispute-rate trend** in `/stats/analytics`. A rising
   trend is an early warning of market-wide stress.
5. Recompute concentration by payer, sector, token and due-week against §3.

Trigger a **stop-funding review** if any of these happen: realised default rate
above 60% of break-even; a single payer above its cap; two defaults from the
same payer or sector in 30 days; the protocol pauses
([incident-response-runbook.md](incident-response-runbook.md)); a sharp rise
in the dispute rate.

### 5.3 After a payer misses the due date

1. Contact the payer through your out-of-band channel first — the invoice may
   simply be late.
2. Note the **appeal window** (30 days) and dispute state before acting on a
   default; a default that is later reversed restores the payer's score but does
   not undo your time lost.
3. Call `claim_default` when the position is clearly not paying.
4. If you are insured, file within the pool's evidence and review requirements
   ([insurance-pool-design.md](insurance-pool-design.md)).

---

## 6. Insurance and recovery

An optional insurance pool exists for LPs. Treat it as a **partial backstop, not
protection**:

- Coverage is **best-effort, pro-rata by claim order**; there is no cap on total
  enrolled coverage against pool balance, so a correlated wave of defaults can
  exhaust it ([insurance-pool-design.md](insurance-pool-design.md)).
- Payout per claim is capped by your tier and by the pool balance.
- Premiums are a real cost: subtract them from your yield before comparing with
  break-even (§1.1).
- A **solvency circuit breaker** can pause claims when the reserve ratio falls
  below the configured minimum.
- The pool is described as experimental in the release notes; do not size
  positions assuming full recovery.

---

## 7. Operational safety

- Use a dedicated LP account with only the capital you intend to deploy.
- Never share signing keys; use the SDK's wallet flow for browser signing
  ([sdk-integration.md](sdk-integration.md)).
- Verify the contract ID and network before every fund transaction.
- If the protocol pauses, stop and follow the community channel; do not attempt
  to route around it.
- Be aware that reward tokens (if any) are a bonus, not a loss buffer: they
  accrue on funding volume regardless of whether the invoice is later repaid.

---

## 8. Quick checklist

Before each funding:

- [ ] I know who the payer is in the real world and they accepted the invoice.
- [ ] Freelancer and payer are unrelated; I've checked for red flags (§2.2).
- [ ] Payer's reputation counts (not just score) meet my threshold (§4.3).
- [ ] Discount comfortably exceeds break-even for this payer (§1.1).
- [ ] The position keeps me inside every limit in §3.1.
- [ ] I've kept the evidence (§2.3).

Weekly:

- [ ] Reviewed overdue positions and realised default rate (§5.2).
- [ ] Rechecked concentration and large-payer reputation.
- [ ] Checked the dispute-rate trend.

---

## Related documents

[FAQ](faq.md) · [SDK Integration](sdk-integration.md) · [Reputation](reputation.md) ·
[Reputation model](reputation-model.md) · [Insurance pool design](insurance-pool-design.md) ·
[Threat model](threat-model.md) · [Incident response runbook](incident-response-runbook.md)

*Numbers in this guide (score deltas, decay, appeal window, pool behaviour) come
from the linked documents and contract source at the time of writing. If a
linked document changes, re-check the corresponding section.*
