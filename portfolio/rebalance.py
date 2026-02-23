"""
Rebalancing engine — drift detection and trade-list generation.
"""

from __future__ import annotations

from dataclasses import dataclass

from portfolio.config import ALLOCATION, DRIFT_THRESHOLD_PCT, PHYSICAL_REALITY_TICKERS
from portfolio.model import Portfolio


@dataclass
class Trade:
    ticker: str
    bucket: str
    action: str          # "BUY" or "SELL"
    dollar_amount: float
    reason: str


def detect_drift(portfolio: Portfolio) -> list[tuple[str, float, float, bool]]:
    """
    Returns a list of (bucket, actual_weight, target_weight, needs_rebalance)
    for every bucket.
    """
    actual = portfolio.bucket_weights()
    results = []
    for bucket, target in ALLOCATION.items():
        act = actual.get(bucket, 0.0)
        drift_pct = (act - target) * 100
        flagged = abs(drift_pct) > DRIFT_THRESHOLD_PCT
        results.append((bucket, act, target, flagged))
    return results


def generate_rebalance_trades(portfolio: Portfolio) -> list[Trade]:
    """
    Generate a list of trades needed to bring the portfolio back to target
    weights.  Only produces trades for buckets that exceed the drift threshold.
    """
    trades: list[Trade] = []
    tv = portfolio.total_value
    if tv == 0:
        return trades

    actual = portfolio.bucket_weights()

    for bucket, target in ALLOCATION.items():
        act = actual.get(bucket, 0.0)
        drift_pct = (act - target) * 100
        if abs(drift_pct) <= DRIFT_THRESHOLD_PCT:
            continue

        dollar_diff = (act - target) * tv  # positive = overweight

        if bucket == "physical_reality_basket":
            # Spread equally across all tickers in the basket
            per_stock = abs(dollar_diff) / len(PHYSICAL_REALITY_TICKERS)
            action = "SELL" if dollar_diff > 0 else "BUY"
            for ticker in PHYSICAL_REALITY_TICKERS:
                trades.append(Trade(
                    ticker=ticker,
                    bucket=bucket,
                    action=action,
                    dollar_amount=round(per_stock, 2),
                    reason=f"Bucket drift {drift_pct:+.1f}%",
                ))

        elif bucket == "stacked_rsst":
            action = "SELL" if dollar_diff > 0 else "BUY"
            trades.append(Trade(
                ticker="RSST",
                bucket=bucket,
                action=action,
                dollar_amount=round(abs(dollar_diff), 2),
                reason=f"Bucket drift {drift_pct:+.1f}%",
            ))

        elif bucket == "stacked_rssb":
            action = "SELL" if dollar_diff > 0 else "BUY"
            trades.append(Trade(
                ticker="RSSB",
                bucket=bucket,
                action=action,
                dollar_amount=round(abs(dollar_diff), 2),
                reason=f"Bucket drift {drift_pct:+.1f}%",
            ))

        elif bucket == "sovereign_escape_hatch":
            from portfolio.config import SOVEREIGN_TICKERS
            per_asset = abs(dollar_diff) / len(SOVEREIGN_TICKERS)
            action = "SELL" if dollar_diff > 0 else "BUY"
            for ticker in SOVEREIGN_TICKERS:
                trades.append(Trade(
                    ticker=ticker,
                    bucket=bucket,
                    action=action,
                    dollar_amount=round(per_asset, 2),
                    reason=f"Bucket drift {drift_pct:+.1f}%",
                ))

        elif bucket == "cash_buffer":
            # Cash drift is informational — no trade, just a note
            trades.append(Trade(
                ticker="CASH",
                bucket=bucket,
                action="ADJUST",
                dollar_amount=round(abs(dollar_diff), 2),
                reason=f"Cash drift {drift_pct:+.1f}% — reallocate excess or replenish",
            ))

    return trades


def format_drift_report(portfolio: Portfolio) -> str:
    """Human-readable drift report."""
    lines = ["DRIFT REPORT", "=" * 60]
    drift = detect_drift(portfolio)
    for bucket, actual, target, flagged in drift:
        marker = " *** REBALANCE" if flagged else ""
        lines.append(
            f"  {bucket:<30s}  actual={actual*100:5.1f}%  "
            f"target={target*100:5.1f}%  "
            f"drift={((actual - target)*100):+5.1f}%{marker}"
        )
    lines.append("=" * 60)
    return "\n".join(lines)
