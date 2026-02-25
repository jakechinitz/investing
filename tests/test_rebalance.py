"""Tests for portfolio.rebalance"""

from portfolio.config import ALLOCATION, PHYSICAL_REALITY_TICKERS
from portfolio.model import Portfolio, Position, build_target_portfolio
from portfolio.rebalance import detect_drift, generate_rebalance_trades, format_drift_report


def _make_on_target_portfolio(capital: float = 100_000) -> Portfolio:
    """Build a portfolio perfectly on target weights."""
    pf = build_target_portfolio(capital)
    for pos in pf.physical_reality.values():
        pos.shares = 1.0
        pos.current_price = pos.cost_basis
    pf.stacked_rsst.shares = 1.0
    pf.stacked_rsst.current_price = pf.stacked_rsst.cost_basis
    pf.stacked_rssb.shares = 1.0
    pf.stacked_rssb.current_price = pf.stacked_rssb.cost_basis
    for pos in pf.sovereign.values():
        pos.shares = 1.0
        pos.current_price = pos.cost_basis
    return pf


def test_no_drift_at_target():
    pf = _make_on_target_portfolio()
    drift = detect_drift(pf)
    for bucket, actual, target, flagged in drift:
        assert not flagged, f"{bucket} should not be flagged"


def test_no_trades_at_target():
    pf = _make_on_target_portfolio()
    trades = generate_rebalance_trades(pf)
    assert len(trades) == 0


def test_drift_detected_after_price_change():
    pf = _make_on_target_portfolio()
    # Double the price of all Physical Reality stocks → overweight
    for pos in pf.physical_reality.values():
        pos.current_price *= 2.0

    drift = detect_drift(pf)
    pr_drift = [d for d in drift if d[0] == "physical_reality_basket"]
    assert len(pr_drift) == 1
    _, actual, target, flagged = pr_drift[0]
    assert actual > target
    assert flagged


def test_trades_generated_on_drift():
    pf = _make_on_target_portfolio()
    for pos in pf.physical_reality.values():
        pos.current_price *= 2.0

    trades = generate_rebalance_trades(pf)
    assert len(trades) > 0
    # Should have SELL trades for physical reality tickers
    sell_trades = [t for t in trades if t.action == "SELL" and t.bucket == "physical_reality_basket"]
    assert len(sell_trades) > 0


def test_format_drift_report():
    pf = _make_on_target_portfolio()
    report = format_drift_report(pf)
    assert "DRIFT REPORT" in report
    assert "physical_reality_basket" in report
