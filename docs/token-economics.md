# ILN Token Economics Paper

**Scope:** the `iln_distribution` reward model — what the accrual rates are, why
they are set where they are, what participants can expect to earn, and whether
the design is sustainable.
**Basis:** `contracts/iln_distribution/src/lib.rs` at the time of writing. Every
number attributed to the contract is pinned by
`contracts/iln_distribution/src/tests_economics.rs`; if a pinned test fails,
this paper is stale.
**Status:** Draft — **reviewer sign-off pending** (see [§9](#9-review-and-sign-off)).

> **Read this first.** The headline sustainability answer is *not* "the pool is
> solvent". There is **no reward pool**: the contract mints governance tokens at
> claim time. Solvency is therefore a non-issue and **inflation, farming and
> quorum drift are the real risks** (§5–§6). Two findings (§4.1 unit mismatch,
> §5.2 flat per-settlement reward) should be resolved or explicitly accepted
> before mainnet.

---

## 1. Purpose and what is measured

ILN has three participant roles that create value: LPs (fund invoices),
freelancers (get paid early) and payers (settle on time). `iln_distribution`
rewards each with governance tokens to bootstrap liquidity and settlement
behaviour. This paper answers three questions a technical reviewer will ask:

1. **Why these rates?** (§3–§4)
2. **What does a participant earn under realistic usage?** (§7)
3. **Does it hold up long-term without ongoing treasury top-up?** (§5–§6)

Token prices are **not** known. Yields are stated in tokens and, where a
dollar figure is useful, as a function of an assumed token price *p*.

---

## 2. The distribution model

```
 invoice_liquidity ── fund_invoice ──► accrue_lp(lp, raw_fund_amount)
        │
        └────────────── mark_paid ──► accrue_settlement(freelancer, payer, on_time)

 participant ── claim_tokens ──► mint(total_earned − already_claimed) on the governance token
```

| Property | Behaviour | Code |
|---|---|---|
| Who can accrue | Only the configured ILN contract (`require_auth`) | `require_iln_invoker` |
| Funding of rewards | **Minted on claim.** The distribution contract must be the governance token's mint authority; it holds no reward balance | `claim_tokens` → `StellarAssetClient::mint` |
| Accrual is stored as | Counters (LP volume, settlement counts), **not** token amounts | `LpFundedVolume`, `FreelancerSettled`, `PayerOnTimeSettled` |
| Earned amount | Computed live from counters × **current** rates | `total_earned` |
| Claimed amount | Stored as a token high-water mark | `Claimed` |
| Rate changes | Governance proposals `UpdateLpRewardRate` / `UpdateFreelancerRewardRate` / `UpdatePayerRewardRate` / `UpdateDistributionRewardParams` | `iln_governance` |
| Supply cap / emission schedule | **None** | — |
| Per-address cap | **None** (LP accrual has a per-call sanity ceiling of 10^13 base units only) | `MAX_LP_ACCRUAL_PER_CALL` |

Consequences of "counters × current rate": a rate change is **retroactive** in
both directions. A raise tops up history already claimed on the next claim; a
cut can leave `already_claimed` above `total_earned`, which stalls further
claims until accrual catches up (no clawback). See
[formal-verification-distribution.md](formal-verification-distribution.md).

---

## 3. Reward-rate rationale

Default rates, in governance-token base units (7 decimals; 10^7 = 1 token):

| Role | Trigger | Rate | Equivalent |
|---|---|---|---|
| LP | funded volume | 10,000,000 per 10^9 base units | 1 token per 10^9 raw units of volume |
| Freelancer | each settlement | 5,000,000 | 0.5 token |
| Payer | each **on-time** settlement | 5,000,000 | 0.5 token |

**Design intent (as evidenced by the code and its comments):**

- **LP rate scales with volume** because LP capital is the scarce side of the
  market and rewards should follow capital deployed.
- **Freelancer and payer rates are flat per event** because the contract
  deliberately does not learn invoice amounts at settlement
  (`accrue_settlement` takes no amount). The rate is a participation reward, not
  a yield.
- **Payer reward is on-time only**, aligning the payer with the outcome LPs
  care about. There is deliberately no LP reward for *repayment*; LPs are paid
  for funding, not for outcomes (see §5.4).
- **Round numbers, low absolute values.** The defaults are `HALF_TOKEN` and 1
  token per 100 USDC. No derivation from a target emission, target APR or fee
  revenue is recorded in the repository. **This paper does not claim the
  defaults were modelled; it evaluates them after the fact.** The evaluation
  concludes they are conservative for large invoices and generous for small ones
  (§5.2).

**Recommended launch stance:** keep defaults until §4.1 is fixed, then revisit
with real volume data (§8 triggers).

---

## 4. What the rates actually pay

### 4.1 Unit mismatch (finding F1)

`iln_distribution` documents the LP rate as "per 100 USDC" and assumes 7-decimal
amounts (`HUNDRED_USDC_STROOPS = 1_000_000_000`). `invoice_liquidity` passes the
**raw funded amount in the invoice token's own decimals**
(`notify_distribution_funding(&env, &funder, fund_amount)`) with no
normalisation, and ILN registers USDC with 6 decimals
([multi-token.md](multi-token.md)). The result:

| Token | Decimals | Volume needed for 1 LP token | Volume the doc/rate comment implies |
|---|---|---|---|
| XLM | 7 | 100 units | 100 |
| USDC / EURC (as 6-dec) | 6 | **1,000 units** | 100 |

So a 6-decimal stablecoin LP earns **10× less** than the documented rate, 100
USDC of volume earns 0 (integer division on cumulative volume), and all tokens
are counted at face value with no price conversion — 100 XLM and 100 USDC earn
the same. Pinned by `lp_reward_on_six_decimal_token_is_one_token_per_thousand_units`.

**Recommendation:** normalise to a common precision (and ideally a USD value
via the price oracle) inside `notify_distribution_funding`, or rename the rate
and document it as "per 10^9 raw units". Until then all LP yield figures below
use the 6-decimal behaviour.

### 4.2 Yield per unit of activity (6-decimal stablecoin)

| Activity | Tokens |
|---|---|
| LP funds 1,000 USDC | 1.0 |
| Freelancer settles one invoice (any size) | 0.5 |
| Payer settles one invoice on time (any size) | 0.5 |
| One complete on-time invoice, all roles (excl. LP volume) | 1.0 |

---

## 5. Sustainability analysis

### 5.1 Solvency: there is no pool to run dry

The question "does the reward pool remain solvent, or need treasury top-up?" has
a precise answer for the current contract:

- **No treasury top-up is needed or possible.** Claims mint new supply, so a
  claim can never fail for lack of reward funds
  (`claims_mint_new_supply_with_no_pool_balance`).
- **The cost is paid in dilution, not from a balance.** Every claimed token is
  new supply. The sustainability question becomes: *is the inflation rate
  acceptable, and is the value it distributes earned?*
- **There is no funding source for the emission either.** The default protocol
  fee is 0 bps (`FeeRate` initialised to 0). With fee revenue at zero there is
  nothing to buy back, burn or backstop the token against.

### 5.2 Emission is decoupled from economic value (finding F2)

Settlement rewards do not depend on invoice size. Modelled with the defaults
(90% of settlements on time; LP volume in 6-decimal units; illustrative usage):

| Scenario | Invoices / yr | Avg size | Volume | LP tokens | Freelancer | Payer | **Total / yr** | Flat share |
|---|---|---|---|---|---|---|---|---|
| A — beta | 1,000 | $300 | $0.3M | 300 | 500 | 450 | **1,250** | 76% |
| B — growth | 50,000 | $500 | $25M | 25,000 | 25,000 | 22,500 | **72,500** | 66% |
| C — scale | 1,000,000 | $500 | $500M | 500,000 | 500,000 | 450,000 | **1.45M** | 66% |

At these sizes two-thirds or more of emission is per-event, not per-dollar.
Two implications:

1. **Self-dealing farming.** An entity controlling a freelancer, a payer
   and an LP address can run a minimum-size invoice (1 unit) in a loop. It earns
   1.0 token per cycle (0.5 + 0.5) against a cost of gas plus a 0-bps fee; the
   discount is paid to itself. Against the LP schedule (0.001 token per USDC of
   volume) that is **~1,000× the reward per dollar of volume**. Any token price
   above per-cycle gas makes this profitable. There is no per-address cap and no
   minimum-age or reputation gate on rewards. Pinned by
   `settlement_reward_is_independent_of_invoice_size`. The reputation system's
   multi-account discussion ([reputation.md Q7](reputation.md)) covers score
   gaming, not reward farming.
2. **Emission does not track revenue.** If fee revenue is set to a candidate
   50 bps, fee income equals emission value at a token price of ≈ **$1.20**
   (scenario A) to **$1.72** (B, C). Above that price, emission (valued at
   market) exceeds fees earned; below it, fees cover emission. With fees at 0
   there is no price at which it is covered. Formula: break-even price =
   `0.005 × volume ÷ tokens_emitted`.

### 5.3 Rate changes are retroactive (finding F3)

Because rewards are `counters × current rate`, a governance vote raising a rate
also pays out on **already-claimed** history at the next claim
(`rate_increase_tops_up_previously_claimed_volume`). A doubling proposal is
therefore a one-time emission of *all historical accrual* on top of the forward
rate. Conversely, cutting a rate silently stalls claimants. Rate proposals must
be evaluated against cumulative counters, not just forward volume.

### 5.4 Reward is paid for funding, not for outcomes

`accrue_lp` fires at `fund_invoice`. An LP is rewarded for volume even if the
invoice later defaults, so the reward does not compensate for credit loss and
does not discourage funding weak invoices. It is small relative to yield
(§7), so this is a second-order incentive issue, not a solvency one.

### 5.5 Governance quorum drift (finding F4)

Quorum is `GovTokenTotalSupply × min_quorum_bps / 10,000`, and
`GovTokenTotalSupply` is a **stored value set via `set_gov_token_total_supply`**
(ILN-contract gated). Minting on claim does not update it. As emission grows
the stored supply falls behind real supply, so quorum is computed against a
number that is too small — proposals get *easier* to pass over time. This must
be operationally coupled to the emission (§8) or fixed by reading supply from
the token.

Emission also concentrates voting power in the most active participants
(LPs with volume), and per-proposal checkpoints mean claimed-but-unused rewards
count immediately as voting weight.

### 5.6 Verdict

| Question | Answer |
|---|---|
| Does the pool remain solvent? | There is no pool; claims cannot fail. |
| Does it need treasury top-up? | No. It mints instead — which is the risk. |
| Is emission bounded? | No. It is bounded only by ledger throughput × minimum invoice size. |
| Is emission funded by protocol revenue? | No — default fee is 0 bps. |
| Sustainable long-term as-is? | **Only if the token is treated as a low-value participation marker.** If it is expected to hold value, F1–F4 need to be addressed first. |

---

## 6. Recommended mitigations

Ordered by risk reduction per effort. None are implemented by this document.

| # | Mitigation | Addresses |
|---|---|---|
| M1 | Normalise LP volume to a common precision / USD in `notify_distribution_funding` | F1 |
| M2 | Make freelancer/payer rewards proportional to settled amount, or require a minimum invoice size for reward eligibility | F2 |
| M3 | Add a per-epoch global emission cap in `iln_distribution` (claims beyond the cap roll to next epoch) | F2, §5.1 |
| M4 | Bound the three rates on-chain (max per role) and require the rate-change proposal to state cumulative-history impact | F3 |
| M5 | Read total supply from the token in governance, or make `claim_tokens` update `GovTokenTotalSupply` | F4 |
| M6 | Set a non-zero protocol fee and route a share to a buyback/treasury before the token is marketed as valuable | §5.2 |
| M7 | Exclude self-dealing (same beneficial address as freelancer/payer/LP) from rewards — not enforceable on-chain today; use M2/M3 | F2 |

---

## 7. Expected yields under realistic usage

**Assumptions (all illustrative, none observed):** 6-decimal stablecoin; average
discount 300 bps per invoice; 30-day tenor, capital fully redeployed monthly
(12 turns/yr); 2% of invoices default with 100% loss; token price *p* unknown.

**LP with $10,000 deployed**

| Item | Value |
|---|---|
| Annual funded volume | $120,000 |
| Gross discount yield | $3,600 (36% APR) |
| Expected default loss (2%) | −$2,400 → **net ≈ 12% APR** |
| Reward tokens | 120 |
| Reward as APR | `120·p ÷ 10,000` = **1.2%·p** |

At *p* = $0.10 the reward adds **0.12 pp** to a ~12% net APR; at *p* = $1.00,
1.2 pp. Even at $1 the reward is a **secondary** incentive. Because it is paid
on funding, it does not offset the 2% default loss. *(If F1 is fixed to
"per 100 units" the reward is 10× larger: 12·p pp at p = $1.)*

**Freelancer:** 12 invoices/yr at $500 → 6 tokens/yr. Against a ~3% discount
cost ($180/yr), the reward is ≈ `6·p` — a rounding error unless *p* is high.

**Payer:** 12 on-time invoices → 6 tokens/yr; no financial offset to the cost of
paying on time. The payer reward is a nudge, not an incentive that changes
behaviour for real businesses — it is **only** attractive to farmers (§5.2).

**Observation.** For legitimate participants the rewards are small; for
minimum-size self-dealing the same rewards are the dominant return. This is the
core mismatch and the reason M2/M3 lead the recommendations.

---

## 8. Review triggers and operations

Re-run this paper's model when any of these occur:

- Any `UpdateLpRewardRate` / `…FreelancerRewardRate` / `…PayerRewardRate` /
  `UpdateDistributionRewardParams` proposal is created.
- Protocol fee changes from 0 bps.
- Governance token gets a public market price.
- Cumulative emission exceeds 1% of the stored `GovTokenTotalSupply`.
- Sustained > 2× growth in monthly settlement count from a small number of
  addresses (see anomaly detection in the indexer).
- Any change to `accrue_lp` / `accrue_settlement` call sites or the amount
  passed.
- Quarterly, regardless.

**Until M5 ships:** whoever operates the ILN-contract admin path must update
`GovTokenTotalSupply` on a schedule that keeps it within an agreed tolerance of
the real supply (recommended: whenever cumulative emission since the last
update exceeds 1% of the stored value).

---

## 9. Review and sign-off

Modelled on the threat-model review discipline: an author cannot sign off their
own work, and a review must cover the model *and* the claims about the code.

| Role | Name | Date | Decision | Notes |
|---|---|---|---|---|
| Author | *(to be filled by PR author)* | | Drafted | |
| Reviewer 1 (non-author, required) | **Pending — not yet reviewed** | | | |

Reviewer checklist:

- [ ] Every "contract does X" claim in §2–§5 is verified against source or a pinned test.
- [ ] §4.1 (F1) reproduced independently, including the decimals assumed for USDC.
- [ ] Scenario arithmetic in §5.2 and §7 re-derived.
- [ ] Recommendations M1–M7 are feasible and do not conflict with the audit scope.
- [ ] Accepted risks are stated in the PR description.

This paper is **not approved** until a reviewer other than the author fills in
the table above.

---

## Related documents

[Governance](governance.md) · [Formal verification — distribution](formal-verification-distribution.md) ·
[Insurance pool design](insurance-pool-design.md) · [Multi-token](multi-token.md) ·
[Reputation](reputation.md) · [Audit readiness dashboard](audit-readiness-dashboard.md)
