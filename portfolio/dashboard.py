"""
Portfolio dashboard — renders a comprehensive text report of portfolio state,
allocation, drift, notional exposure, and trigger status.
"""

from __future__ import annotations

from tabulate import tabulate

from portfolio.config import ALLOCATION
from portfolio.model import Portfolio
from portfolio.rebalance import detect_drift, generate_rebalance_trades
from portfolio.triggers import (
    Signal,
    TriggerResult,
    TriggerState,
    evaluate,
    format_trigger_report,
)


def _pct(val: float) -> str:
    return f"{val * 100:.1f}%"


def render_allocation_table(portfolio: Portfolio) -> str:
    """Table of bucket values and weights vs. targets."""
    bucket_labels = {
        "physical_reality_basket": "Physical Reality Basket",
        "stacked_rsst": "RSST (Equity + Trend)",
        "stacked_rssb": "RSSB (Equity + Bonds)",
        "sovereign_escape_hatch": "Sovereign Escape Hatch",
        "tail_risk_puts": "Tail Risk Puts",
        "cash_buffer": "Cash Buffer",
    }
    bucket_values = {
        "physical_reality_basket": portfolio.physical_reality_value,
        "stacked_rsst": portfolio.rsst_value,
        "stacked_rssb": portfolio.rssb_value,
        "sovereign_escape_hatch": portfolio.sovereign_value,
        "tail_risk_puts": portfolio.puts_value,
        "cash_buffer": portfolio.cash_buffer,
    }
    actual = portfolio.bucket_weights()

    rows = []
    for key in ALLOCATION:
        rows.append([
            bucket_labels.get(key, key),
            f"${bucket_values.get(key, 0):,.2f}",
            _pct(actual.get(key, 0)),
            _pct(ALLOCATION[key]),
            f"{((actual.get(key, 0) - ALLOCATION[key]) * 100):+.1f}%",
        ])
    rows.append([
        "TOTAL",
        f"${portfolio.total_value:,.2f}",
        "100.0%",
        "100.0%",
        "",
    ])

    return tabulate(
        rows,
        headers=["Bucket", "Value", "Actual", "Target", "Drift"],
        tablefmt="simple",
    )


def render_notional_exposure(portfolio: Portfolio) -> str:
    """Show the true notional exposure including embedded leverage."""
    exposure = portfolio.notional_exposure()
    tv = portfolio.total_value

    rows = []
    for label, val in exposure.items():
        pct = val / tv * 100 if tv else 0
        rows.append([label.replace("_", " ").title(), f"${val:,.2f}", f"{pct:.1f}%"])
    rows.append(["TOTAL NOTIONAL", f"${portfolio.total_notional():,.2f}",
                  f"{portfolio.leverage_ratio() * 100:.0f}%"])

    return tabulate(rows, headers=["Exposure", "Value", "% of Portfolio"],
                    tablefmt="simple")


def render_physical_basket(portfolio: Portfolio) -> str:
    """Detail of each position in the Physical Reality Basket."""
    if not portfolio.physical_reality:
        return "  (no positions)"
    rows = []
    for ticker, pos in sorted(portfolio.physical_reality.items()):
        rows.append([
            ticker,
            f"{pos.shares:.4f}",
            f"${pos.current_price:,.2f}",
            f"${pos.market_value:,.2f}",
            f"${pos.cost_basis:,.2f}",
        ])
    return tabulate(
        rows,
        headers=["Ticker", "Shares", "Price", "Mkt Value", "Cost Basis"],
        tablefmt="simple",
    )


def render_trades(portfolio: Portfolio) -> str:
    """Render the rebalance trade list."""
    trades = generate_rebalance_trades(portfolio)
    if not trades:
        return "  No rebalance trades needed."
    rows = []
    for t in trades:
        rows.append([t.action, t.ticker, f"${t.dollar_amount:,.2f}", t.reason])
    return tabulate(
        rows,
        headers=["Action", "Ticker", "Amount", "Reason"],
        tablefmt="simple",
    )


def render_full_dashboard(
    portfolio: Portfolio,
    trigger_result: TriggerResult | None = None,
) -> str:
    """Render the complete dashboard."""
    sections = [
        "",
        "=" * 70,
        "  PORTFOLIO ALLOCATION DASHBOARD",
        "=" * 70,
        "",
        "--- Allocation ---",
        render_allocation_table(portfolio),
        "",
        "--- Notional Exposure (incl. stacked leverage) ---",
        render_notional_exposure(portfolio),
        "",
        "--- Physical Reality Basket ---",
        render_physical_basket(portfolio),
        "",
        "--- Rebalance Trades ---",
        render_trades(portfolio),
    ]

    if trigger_result:
        sections += ["", format_trigger_report(trigger_result)]

    sections += ["", "=" * 70]
    return "\n".join(sections)
