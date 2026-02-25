#!/usr/bin/env python3
"""
Portfolio Allocation Strategy — CLI

Usage:
    python main.py plan <total_capital>    Build target allocation for a given capital amount
    python main.py status                  Show current portfolio status from saved state
    python main.py triggers                Check put option mechanical triggers
    python main.py rebalance               Show rebalance trades needed

Examples:
    python main.py plan 100000
    python main.py status
    python main.py triggers --vix 50 --delta -0.9 --dte 25
"""

from __future__ import annotations

import argparse
import sys

from portfolio.config import ALLOCATION, PHYSICAL_REALITY_TICKERS, PUT_RULES
from portfolio.dashboard import (
    render_allocation_table,
    render_full_dashboard,
    render_notional_exposure,
    render_physical_basket,
    render_trades,
)
from portfolio.model import Portfolio, build_target_portfolio
from portfolio.rebalance import format_drift_report
from portfolio.triggers import (
    TriggerState,
    evaluate,
    format_trigger_report,
)


def cmd_plan(args: argparse.Namespace) -> None:
    """Build and display the target allocation for a given capital amount."""
    capital = args.capital
    pf = build_target_portfolio(capital)

    print()
    print("=" * 70)
    print(f"  TARGET ALLOCATION PLAN — ${capital:,.2f}")
    print("=" * 70)
    print()
    print("--- Bucket Allocation ---")
    for bucket, weight in ALLOCATION.items():
        label = bucket.replace("_", " ").title()
        dollars = capital * weight
        print(f"  {label:<35s}  {weight*100:5.1f}%   ${dollars:>12,.2f}")
    print(f"  {'TOTAL':<35s}  100.0%   ${capital:>12,.2f}")
    print()

    print(f"--- Physical Reality Basket ({len(PHYSICAL_REALITY_TICKERS)} stocks, equal-weight) ---")
    basket_total = capital * ALLOCATION["physical_reality_basket"]
    per_stock = basket_total / len(PHYSICAL_REALITY_TICKERS)
    for ticker in PHYSICAL_REALITY_TICKERS:
        print(f"  {ticker:<12s}  ${per_stock:>10,.2f}")
    print(f"  {'TOTAL':<12s}  ${basket_total:>10,.2f}")
    print()

    print("--- Stacked Parachute Exposure ---")
    rsst_val = capital * ALLOCATION["stacked_rsst"]
    rssb_val = capital * ALLOCATION["stacked_rssb"]
    print(f"  RSST ${rsst_val:>10,.2f} → ${rsst_val:,.2f} SPX + ${rsst_val:,.2f} Managed Futures")
    print(f"  RSSB ${rssb_val:>10,.2f} → ${rssb_val:,.2f} Global Eq + ${rssb_val:,.2f} Treasuries")
    total_notional = capital + rsst_val + rssb_val  # embedded 2x in each
    print(f"  Total notional exposure: ~${total_notional:,.2f} ({total_notional/capital*100:.0f}%)")
    print()

    print("--- Put Option Parameters ---")
    print(f"  Budget:     ${capital * ALLOCATION['tail_risk_puts']:,.2f}")
    print(f"  Underlying: {', '.join(PUT_RULES['underlying'])}")
    print(f"  Strike:     {PUT_RULES['strike_otm_pct']*100:.0f}-20% OTM")
    print(f"  Expiry:     {PUT_RULES['expiry_months'][0]}-{PUT_RULES['expiry_months'][1]} months")
    print()

    # Save the plan
    pf.save()
    print("Portfolio plan saved to portfolio_state.json")
    print()


def cmd_status(args: argparse.Namespace) -> None:
    """Show current portfolio status from saved state."""
    try:
        pf = Portfolio.load()
    except FileNotFoundError:
        print("No saved portfolio found. Run 'python main.py plan <capital>' first.")
        sys.exit(1)

    print(render_full_dashboard(pf))


def cmd_triggers(args: argparse.Namespace) -> None:
    """Check put option mechanical triggers with provided market data."""
    state = TriggerState(
        vix=args.vix,
        put_delta=args.delta,
        put_dte=args.dte,
    )
    has_puts = args.has_puts
    result = evaluate(state, has_puts=has_puts)
    print()
    print(format_trigger_report(result))
    print()


def cmd_rebalance(args: argparse.Namespace) -> None:
    """Show rebalance trades needed."""
    try:
        pf = Portfolio.load()
    except FileNotFoundError:
        print("No saved portfolio found. Run 'python main.py plan <capital>' first.")
        sys.exit(1)

    print()
    print(format_drift_report(pf))
    print()
    print("--- Trades ---")
    print(render_trades(pf))
    print()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Portfolio Allocation Strategy Manager"
    )
    sub = parser.add_subparsers(dest="command")

    # plan
    p_plan = sub.add_parser("plan", help="Build target allocation")
    p_plan.add_argument("capital", type=float, help="Total capital to allocate")

    # status
    sub.add_parser("status", help="Show portfolio status")

    # triggers
    p_trig = sub.add_parser("triggers", help="Check put option triggers")
    p_trig.add_argument("--vix", type=float, required=True, help="Current VIX level")
    p_trig.add_argument("--delta", type=float, default=-0.1, help="Current put delta")
    p_trig.add_argument("--dte", type=int, default=90, help="Days to expiration")
    p_trig.add_argument(
        "--has-puts", action="store_true", default=True,
        help="Currently holding puts (default: True)",
    )
    p_trig.add_argument(
        "--no-puts", dest="has_puts", action="store_false",
        help="Not currently holding puts",
    )

    # rebalance
    sub.add_parser("rebalance", help="Show rebalance trades needed")

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(1)

    commands = {
        "plan": cmd_plan,
        "status": cmd_status,
        "triggers": cmd_triggers,
        "rebalance": cmd_rebalance,
    }
    commands[args.command](args)


if __name__ == "__main__":
    main()
