//! Pins the figures quoted in `docs/token-economics.md`.
//!
//! If one of these fails, the paper's yield tables are stale: update the
//! paper (and its review sign-off) together with the code change.

#![cfg(test)]

use super::*;
use soroban_sdk::{contract, contractimpl, testutils::Address as _, token::Client as TokenClient};

/// 1 governance token = 10^7 stroops.
const ONE_TOKEN: i128 = 10_000_000;
/// 1 USDC as registered in ILN (6 decimals, see docs/multi-token.md).
const ONE_USDC_6DEC: i128 = 1_000_000;

#[contract]
pub struct MockIln;

#[contractimpl]
impl MockIln {
    pub fn accrue_lp(env: Env, dist: Address, lp: Address, amount: i128) {
        IlnDistributionClient::new(&env, &dist).accrue_lp(&lp, &amount);
    }

    pub fn accrue_settlement(
        env: Env,
        dist: Address,
        freelancer: Address,
        payer: Address,
        on_time: bool,
    ) {
        IlnDistributionClient::new(&env, &dist).accrue_settlement(&freelancer, &payer, &on_time);
    }
}

struct Setup<'a> {
    env: Env,
    dist_id: Address,
    dist: IlnDistributionClient<'a>,
    iln: MockIlnClient<'a>,
    token: TokenClient<'a>,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();
    let iln_id = env.register_contract(None, MockIln);
    let dist_id = env.register_contract(None, IlnDistribution);
    let gov_token = env
        .register_stellar_asset_contract_v2(dist_id.clone())
        .address();
    let dist = IlnDistributionClient::new(&env, &dist_id);
    dist.initialize(&iln_id, &gov_token);
    let iln = MockIlnClient::new(&env, &iln_id);
    let token = TokenClient::new(&env, &gov_token);
    Setup {
        env,
        dist_id,
        dist,
        iln,
        token,
    }
}

#[test]
fn default_rates_match_paper() {
    let s = setup();
    assert_eq!(s.dist.get_lp_reward_rate(), ONE_TOKEN);
    assert_eq!(s.dist.get_freelancer_reward_rate(), ONE_TOKEN / 2);
    assert_eq!(s.dist.get_payer_reward_rate(), ONE_TOKEN / 2);
}

/// Paper §4.1: accrual divides raw funded amount by 10^9 base units, so a
/// 6-decimal token needs 1,000 units of volume per token, not 100.
#[test]
fn lp_reward_on_six_decimal_token_is_one_token_per_thousand_units() {
    let s = setup();
    let lp = Address::generate(&s.env);

    s.iln.accrue_lp(&s.dist_id, &lp, &(100 * ONE_USDC_6DEC));
    assert_eq!(s.dist.get_accrual(&lp), 0, "100 USDC (6 dec) earns nothing");

    s.iln.accrue_lp(&s.dist_id, &lp, &(900 * ONE_USDC_6DEC));
    assert_eq!(s.dist.get_accrual(&lp), ONE_TOKEN, "1,000 USDC earns 1 token");
}

/// Paper §4.1: the same LP volume on a 7-decimal token earns 10x more.
#[test]
fn lp_reward_on_seven_decimal_token_is_one_token_per_hundred_units() {
    let s = setup();
    let lp = Address::generate(&s.env);
    s.iln.accrue_lp(&s.dist_id, &lp, &(100 * 10_000_000));
    assert_eq!(s.dist.get_accrual(&lp), ONE_TOKEN);
}

/// Paper §5.2: settlement rewards are flat per settlement and independent of
/// invoice size, which is what makes minimum-size self-dealing the dominant
/// farming strategy.
#[test]
fn settlement_reward_is_independent_of_invoice_size() {
    let s = setup();
    let freelancer = Address::generate(&s.env);
    let payer = Address::generate(&s.env);

    // The distribution contract is never told the amount, so a 1-unit and a
    // 1,000,000-unit invoice are indistinguishable to it.
    s.iln
        .accrue_settlement(&s.dist_id, &freelancer, &payer, &true);

    assert_eq!(s.dist.claim_tokens(&freelancer), ONE_TOKEN / 2);
    assert_eq!(s.dist.claim_tokens(&payer), ONE_TOKEN / 2);
    assert_eq!(s.token.balance(&freelancer) + s.token.balance(&payer), ONE_TOKEN);
}

/// Paper §5.1: the contract mints on claim. There is no reward pool balance
/// to exhaust, so claims can never fail for lack of funds; the cost is supply
/// inflation.
#[test]
fn claims_mint_new_supply_with_no_pool_balance() {
    let s = setup();
    let lp = Address::generate(&s.env);
    assert_eq!(s.token.balance(&s.dist_id), 0);
    assert_eq!(s.token.balance(&lp), 0);

    s.iln.accrue_lp(&s.dist_id, &lp, &(1_000_000 * 10_000_000));
    let claimed = s.dist.claim_tokens(&lp);

    assert_eq!(claimed, 10_000 * ONE_TOKEN);
    assert_eq!(s.token.balance(&lp), claimed);
    assert_eq!(s.token.balance(&s.dist_id), 0, "no pool balance was drawn down");
}

/// Paper §5.3: a rate increase re-prices already-claimed history, so the next
/// claim pays the difference (retroactive top-up).
#[test]
fn rate_increase_tops_up_previously_claimed_volume() {
    let s = setup();
    let lp = Address::generate(&s.env);
    s.iln.accrue_lp(&s.dist_id, &lp, &(100 * 10_000_000));
    assert_eq!(s.dist.claim_tokens(&lp), ONE_TOKEN);

    s.dist.set_lp_reward_rate(&(2 * ONE_TOKEN));
    assert_eq!(s.dist.claim_tokens(&lp), ONE_TOKEN);
    assert_eq!(s.token.balance(&lp), 2 * ONE_TOKEN);
}
