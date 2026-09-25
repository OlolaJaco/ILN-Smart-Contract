# Governance Operations Playbook

**Audience:** governance participants, the admin/multisig signers, proposers and
reviewers.
**Purpose:** one place to answer *"what is a safe value, how do I vet an oracle,
and what do I do in an emergency?"* It **links to** the detailed documents rather
than restating them, and it records only the numbers a governance actor needs
to act.
**Nature:** a **live reference**. Numbers marked with a source tag are checked
against the contract source by `scripts/check-playbook-constants.ts` (run in
CI/`node --test`); the review triggers in [§8](#8-keeping-this-playbook-current)
say when a human must re-read it.

| You want to… | Go to |
|---|---|
| Change a protocol parameter | [§2 Parameter ranges](#2-safe-parameter-ranges) |
| Propose or vote on an oracle | [§3 Oracle vetting](#3-oracle-vetting-checklist) |
| Stop something harmful, now | [§4 Emergency procedures](#4-emergency-pause-and-veto) |
| Decide a proposal deposit | [§5 Proposal-deposit economics](#5-proposal-deposit-economics) |
| Know the sequence of a normal change | [§1 Change workflow](#1-change-workflow) |

---

## 1. Change workflow

Two authority paths exist. Which one applies depends on the parameter.

| Path | Used for | Timing |
|---|---|---|
| **Governance proposal** (`create_proposal` → votes → `execute_proposal`) | Fee rate, max discount, tokens, oracle registration, reward rates, quorum, veto disable ([governance.md §3](governance.md#3-governable-parameters)) | 3-day voting window, then execution (delay: see §2.1) |
| **Admin / multisig** | `update_decay_params`, `update_fee_tiers`, `set_max_oracle_age`, `set_min_payer_reputation`, `pause`/`unpause`, upgrades | Per-function cooldowns (§2.3); multisig windows (§2.4) |

Checklist for **any** parameter change:

1. Confirm the target value is inside the range in §2 — or write down why not.
2. State the **expected effect** on LPs, freelancers and payers in the proposal
   text and publish it off-chain; put its SHA-256 in `description_hash`.
3. For reward-rate changes, state the **cumulative-history impact**
   ([token-economics.md §5.3](token-economics.md#53-rate-changes-are-retroactive-finding-f3)) — rate changes re-price already-accrued volume.
4. For oracle changes, attach the completed vetting template (§3).
5. Check the veto/response window (§4.3) is staffed for the execution time.
6. After execution, verify the `ParameterUpdated` / `RewardRateUpdated` event
   and re-read the value via the getter.

---

## 2. Safe parameter ranges

Legend — **Enforced**: the contract rejects values outside the range.
**Policy**: the contract accepts anything of the type; this playbook's range is
guidance and voters should reject proposals outside it without a written
justification.

### 2.1 Governance (`iln_governance`)

| Parameter | Default | Enforced range | Recommended range | Source tag |
|---|---|---|---|---|
| `min_quorum_bps` | 1,000 (10%) | Enforced 1–10,000 | 1,000–4,000. Below 1,000 a single holder can reach quorum | <!-- const:DEFAULT_MIN_QUORUM_BPS=1000 --> `DEFAULT_MIN_QUORUM_BPS` |
| Voting window | 259,200 s (3 d) | Fixed | — | <!-- const:VOTING_PERIOD_SECS=259200 --> `VOTING_PERIOD_SECS` |
| `min_proposal_balance` | 1,000 base units | Setter has **no range check** | Non-trivial fraction of quorum; see §5 | <!-- const:DEFAULT_MIN_PROPOSAL_BALANCE=1000 --> `DEFAULT_MIN_PROPOSAL_BALANCE` |
| `min_proposal_deposit` | 0 (disabled) | Enforced ≥ 0 | Non-zero before mainnet; see §5 | <!-- const:DEFAULT_PROPOSAL_DEPOSIT=0 --> `DEFAULT_PROPOSAL_DEPOSIT` |
| `execution_delay` (ledgers) | 0 | Any `u32` | **≥ 720 (≈1 h); target 17,280 (≈1 d)** so the veto in §4 is actionable | — |
| Max delegation depth | 10 | Fixed default | ≤ 10 | <!-- const:DEFAULT_MAX_DELEGATION_DEPTH=10 --> `DEFAULT_MAX_DELEGATION_DEPTH` |
| `GovTokenTotalSupply` (quorum base) | set at init | Any value | Keep within 1% of true supply; **it is not updated by reward minting** ([token-economics.md §5.5](token-economics.md#55-governance-quorum-drift-finding-f4)) | — |

### 2.2 Core protocol (`invoice_liquidity`)

| Parameter | Default | Enforced range | Recommended range | Source tag |
|---|---|---|---|---|
| Max discount rate (bps) | 5,000 | Setter has **no range check**; `submit_invoice` rejects `0` and > the stored max | ≤ 5,000; changes ≥ ±500 bps need a written impact note | <!-- const:MAX_DISCOUNT_RATE=5000 --> `MAX_DISCOUNT_RATE` |
| Protocol fee (bps) | 0 | Setter has **no range check** (docs quote 0–10,000) | 0–100 bps at launch; anything > 500 needs supermajority discussion | — |
| Min payer reputation | config | Score scale is 0–100; setter has no range check | 0–70; > 100 is unreachable and locks all funding | — |
| Reputation decay (`decay_rate_bps`, period) | config | Setter has **no range check** (bounds work tracked as #692–#694 in the [audit dashboard](audit-readiness-dashboard.md)) | rate ≤ 500 bps per period ([reputation.md appendix](reputation.md#appendix-configuration-recommendations)) | — |
| Max oracle age (ledgers) | 17,280 (≈1 d) | Any `u64`; **`0` disables the freshness check** | 720–17,280. **Never 0** | <!-- const:DEFAULT_MAX_ORACLE_AGE_LEDGERS=17280 --> `DEFAULT_MAX_ORACLE_AGE_LEDGERS` |
| Max price deviation (bps) | 500 | — | ≤ 500 | <!-- const:DEFAULT_MAX_PRICE_DEVIATION_BPS=500 --> `DEFAULT_MAX_PRICE_DEVIATION_BPS` |
| TWAP window (ledgers) | 720 | Enforced 360–17,280 | 720–3,600 | <!-- const:MIN_TWAP_WINDOW_LEDGERS=360 --> `MIN_TWAP_WINDOW_LEDGERS` · <!-- const:MAX_TWAP_WINDOW_LEDGERS=17280 --> `MAX_TWAP_WINDOW_LEDGERS` |
| Oracle circuit breaker | trips after 3 consecutive stale queries | Fixed | — | <!-- const:MAX_CONSECUTIVE_STALE_QUERIES=3 --> `MAX_CONSECUTIVE_STALE_QUERIES` |

### 2.3 Rate limits on economic parameters

Economic setters are rate-limited per function; a second change inside the
window fails. Plan multi-step changes accordingly.

| Class | Cooldown (ledgers) | ≈ time | Source tag |
|---|---|---|---|
| Economic params (`update_fee_rate`, `update_max_discount`, `update_decay_params`, `update_fee_tiers`, `set_min_payer_reputation`) | 360 | 30 min | <!-- const:ECONOMIC_PARAM_COOLDOWN_LEDGERS=360 --> `ECONOMIC_PARAM_COOLDOWN_LEDGERS` |
| Default (e.g. `set_max_oracle_age`) | 120 | 10 min | <!-- const:DEFAULT_RATE_LIMIT_LEDGERS=120 --> `DEFAULT_RATE_LIMIT_LEDGERS` |
| Admin change | 720 | 1 h | <!-- const:ADMIN_CHANGE_COOLDOWN_LEDGERS=720 --> `ADMIN_CHANGE_COOLDOWN_LEDGERS` |
| Upgrade | 1,440 | 2 h | <!-- const:UPGRADE_COOLDOWN_LEDGERS=1440 --> `UPGRADE_COOLDOWN_LEDGERS` |

### 2.4 Multisig and insurance timings

| Item | Value | Source tag |
|---|---|---|
| Multisig proposal window | 17,280 ledgers (≈1 d) | <!-- const:MULTISIG_WINDOW_LEDGERS=17280 --> `MULTISIG_WINDOW_LEDGERS` |
| Signer rotation timelock | 34,560 ledgers (≈2 d) | <!-- const:ROTATION_TIMELOCK_LEDGERS=34560 --> `ROTATION_TIMELOCK_LEDGERS` |
| Insurance pool timelock | 3 days | <!-- const:TIMELOCK_DELAY_SECONDS=259200 --> `TIMELOCK_DELAY_SECONDS` |
| Reputation bonus cap (`bonus_bps`) | ≤ 500, enforced | <!-- const:MAX_BONUS_BPS=500 --> `MAX_BONUS_BPS` |

Insurance-pool launch values (premium, tiers, cap) are in
[insurance-pool-launch-parameters.md](insurance-pool-launch-parameters.md);
they are **not** repeated here to avoid two sources of truth.

### 2.5 Distribution rewards (`iln_distribution`)

| Parameter | Default | Enforced range | Recommended range |
|---|---|---|---|
| LP / freelancer / payer reward rate | 1 / 0.5 / 0.5 token | **None** — any `i128` | Do not raise until [token-economics.md](token-economics.md) findings F1–F4 are resolved; any proposal must include the cumulative-history impact |

---

## 3. Oracle vetting checklist

The vetting rules and the proposal template live in
[oracle-provider-vetting.md](oracle-provider-vetting.md); it is the single
source of truth. This section is the **operational gate**: what must be true
before you vote *for* a `RegisterOracle` proposal.

Vote **against** (or ask for a revised proposal) unless all of these hold:

- [ ] The proposal uses the [template](oracle-provider-vetting.md#4-governance-proposal-template) and its SHA-256 equals `description_hash`.
- [ ] Every item in the [vetting checklist](oracle-provider-vetting.md#3-vetting-checklist) is checked or has a written N/A justification.
- [ ] `interface_version()` matches `ORACLE_INTERFACE_VERSION` (currently 1) — on-chain enforced, but re-confirm.
- [ ] The provider's published update cadence is **materially tighter** than `max_oracle_age_ledgers` (a cadence near the limit causes routine `OracleDataStale` rejections).
- [ ] For **Price** feeds: sandwich-resistance documented ([oracle-attack-economics.md](oracle-attack-economics.md), [oracle-sandwich-audit-findings.md](oracle-sandwich-audit-findings.md)); TWAP window in §2.2 range.
- [ ] Upgrade authority and admin-key custody of the oracle are disclosed.
- [ ] A **removal plan** exists: who proposes `remove_oracle` if it degrades, and how fast (§4.2).
- [ ] The proposal is not being executed in the same period as another oracle change (one oracle change at a time).

**After registration:** watch oracle uptime and staleness on the indexer /
`get_protocol_status` (`oracle_circuit_tripped`, `oracle_circuits_tripped`).
A tripped circuit is not fixed by `reset_oracle_circuit`; see §4.2.

---

## 4. Emergency pause and veto

The authoritative procedure is [incident-response-runbook.md](incident-response-runbook.md).
This section is the **decision card**.

### 4.1 Which lever?

| Situation | Action | Authority | Reversible? |
|---|---|---|---|
| Funds at risk / active exploit | `pause()` **immediately** (runbook §4) | Admin key, or multisig `propose_pause` → `sign_proposal` → `execute_proposal` | Yes (`unpause`) |
| Harmful governance proposal (Active or Passed) | `veto_proposal(id, reason_hash)` | Veto signers (multisig-gated) | No — proposal is dead |
| Governance proposal already executed and harmful | `pause()` as backstop, then corrective proposal | Admin / multisig | Pause yes |
| Compromised or misbehaving oracle | `remove_oracle` / `remove_token_oracle`; `pause()` as blunt stopgap | Admin or governance proposal | Re-register after vetting |
| Suspected admin-key compromise | Follow [disaster-recovery-multisig-signers.md](disaster-recovery-multisig-signers.md) | Signers | — |

### 4.2 Rules of thumb

- **Pause first, root-cause second** for Critical incidents: a false pause is
  recoverable, a drained protocol is not. Record timestamp, trigger and
  authorizer *before* executing.
- Do **not** `reset_oracle_circuit` to "fix" a stale oracle; remove or replace.
- Do **not** `unpause()` within the first 15 minutes; re-open only after the
  runbook §10 checks and Security lead sign-off.
- `reason_hash` on a veto must be the SHA-256 of a published explanation.

### 4.3 The veto is only as fast as `execution_delay`

`execute_proposal` moves a passed proposal to `Passed` and sets
`eta = current ledger + execution_delay`. With the default delay of **0**, a
second call can execute it in the very next transaction, leaving essentially no
time to veto. Until the delay is non-zero, **treat every passing vote as
executing immediately** and have veto signers on call for the end of each
voting window. This is why §2.1 recommends ≥ 720 ledgers (target 17,280).

`disable_veto_power()` is a one-way switch and must only be proposed once
[governance.md §8](governance.md#8-admin-veto-power) conditions for
decentralisation are met; after it, the veto row in §4.1 is unavailable and
`pause()` is the only brake.

---

## 5. Proposal-deposit economics

**Mechanism** (`iln_governance`, Issue #814):

| Event | Deposit outcome |
|---|---|
| `create_proposal` | Escrowed: `token.transfer(proposer → governance contract, deposit)`. Proposer must hold ≥ deposit |
| Vote passes | **Refunded** |
| Rejected (majority against) | **Forfeited** |
| Expired without quorum | **Forfeited** |
| Vetoed | **Forfeited** |
| Sink | `ProposalDepositSink` (treasury) if set; otherwise held in the governance contract |
| Settlement | Idempotent (`ProposalDepositSettled`) — no double refund |

**Current state:** deposit = **0** (disabled) and `min_proposal_balance` = 1,000
base units (0.0001 token at 7 decimals). Effectively free to propose. The
[governance security summary](governance-security-summary.md) records this as a
residual spam risk.

**How to size the deposit `D`.** Spam cost per rejected proposal is exactly `D`
(passed proposals cost nothing but lock capital for the voting window). A
sound `D`:

1. **Above the review cost:** `D ≥ (reviewer-hours per proposal × hourly cost)`,
   converted to token terms at a conservatively low price.
2. **Below the participation barrier:** `D` should be affordable to a legitimate
   proposer who holds a meaningful stake — guideline **≤ 10% of the quorum
   amount ÷ expected proposers** — otherwise proposing becomes plutocratic.
3. **Larger than the reward for griefing:** an attacker who spams to bury a
   real proposal or exhaust veto-signer attention should pay more per proposal
   than they gain.

**Recommended launch policy (judgement, not derived from data):** set
`min_proposal_deposit` to a value in the **0.1%–0.5% of the quorum threshold**
band and `min_proposal_balance` ≥ the deposit; set `ProposalDepositSink` to
the treasury rather than leaving forfeits locked; re-evaluate after the first
20 real proposals (§8).

**Interaction with reward emission.** Because the deposit and the reward token
are the same governance token, and rewards are minted without cap
([token-economics.md](token-economics.md)), a fixed `D` becomes cheaper in
real terms as supply grows. Review `D` when cumulative emission changes the
circulating supply materially.

---

## 6. Standard operating steps

| Task | Steps | Reference |
|---|---|---|
| Raise / lower quorum | proposal → §2.1 check → execute → confirm `get_min_quorum_bps` | governance.md §6 |
| Register oracle | vetting template → hash → proposal → §3 gate → execute → monitor | oracle-provider-vetting.md |
| Remove oracle | proposal or admin `remove_oracle` → confirm circuit state | incident runbook §7 |
| Change fee / discount | §2.2 check → §2.3 cooldown → execute → confirm event | events.md |
| Emergency pause | §4.1 → log → `pause()` → comms → §10 recovery | incident runbook |
| Add / rotate multisig signer | signer rotation timelock (§2.4) | multisig-admin-runbook.md |

---

## 7. Known gaps this playbook works around

| Gap | Where documented | Workaround here |
|---|---|---|
| Setters lack range checks (fee, max discount, decay, min reputation) | Audit dashboard #692–#694; source | Policy ranges §2.2 |
| Execution delay 0 by default | governance.md §7 | §4.3, §2.1 |
| Proposal deposit 0 by default | governance-security-summary.md | §5 |
| Reward rates unbounded; retroactive re-pricing | formal-verification-distribution.md, token-economics.md | §2.5 |
| `GovTokenTotalSupply` not updated by minting | token-economics.md §5.5 | §2.1 tolerance rule |
| Some docs still say quorum supply is caller-supplied | governance.md §6 vs formal-verification.md | Verify against source before relying on either |

When a gap is closed in code, **delete its row and tighten the matching range** —
that is a review trigger (§8).

---

## 8. Keeping this playbook current

**Automated:** `scripts/check-playbook-constants.ts` extracts each
hidden `const:` marker (an HTML comment of the form `const:NAME=VALUE`) and compares it with the constant in the
Rust source. A mismatch fails
`node --experimental-strip-types --test scripts/check-playbook-constants.test.ts`.
Add a marker whenever you add a numeric value sourced from a constant.

**Human review is required when any of these happens:**

| Trigger | Sections to re-read |
|---|---|
| A governance proposal changes any parameter in §2 | §2, §7 |
| A new `ProposalAction` variant, or a setter gains/loses a range check | §2, §7 |
| Any of the constants in §2 changes (script fails) | the failing row |
| An oracle is registered, removed, or its circuit trips | §3, §4 |
| A pause, veto, or `disable_veto_power` is used | §4, §4.3 |
| `execution_delay`, `min_proposal_deposit` or `min_quorum_bps` is changed | §2.1, §4.3, §5 |
| Multisig signer set or thresholds change | §2.4, §4.1 |
| The incident-response runbook or oracle-vetting doc changes | §3, §4 |
| Governance token supply changes materially (e.g. reward emission) | §2.1, §5 |
| Any audit finding touching governance or oracles closes | §7 |
| **Quarterly**, regardless of the above | all |

Record each review in the table below (append; do not overwrite).

| Date | Reviewer | Trigger | Outcome |
|---|---|---|---|
| *(initial publication)* | *(author)* | First version | Awaiting first non-author review |

---

## Related documents

[Governance](governance.md) · [Governance security summary](governance-security-summary.md) ·
[Oracle provider vetting](oracle-provider-vetting.md) · [Oracle design](oracle-design.md) ·
[Incident response runbook](incident-response-runbook.md) · [Multisig admin runbook](multisig-admin-runbook.md) ·
[Token economics](token-economics.md) · [Access control](access-control.md)
