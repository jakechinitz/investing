"""Tests for portfolio.model"""

import json
import tempfile
from pathlib import Path

from portfolio.config import ALLOCATION, PHYSICAL_REALITY_TICKERS, SOVEREIGN_TICKERS
from portfolio.model import Portfolio, Position, build_target_portfolio


def test_position_market_value():
    p = Position(ticker="TSM", shares=10, current_price=150.0)
    assert p.market_value == 1500.0


def test_position_zero_shares():
    p = Position(ticker="TSM", shares=0, current_price=150.0)
    assert p.market_value == 0.0


def test_build_target_portfolio_bucket_count():
    pf = build_target_portfolio(100_000)
    assert len(pf.physical_reality) == len(PHYSICAL_REALITY_TICKERS)
    assert pf.stacked_rsst is not None
    assert pf.stacked_rssb is not None
    assert len(pf.sovereign) == len(SOVEREIGN_TICKERS)


def test_build_target_portfolio_cost_basis():
    capital = 100_000
    pf = build_target_portfolio(capital)

    # Physical Reality Basket should be 40% of capital, split equally
    expected_per_stock = (capital * 0.40) / len(PHYSICAL_REALITY_TICKERS)
    for pos in pf.physical_reality.values():
        assert abs(pos.cost_basis - expected_per_stock) < 0.01

    # RSST = 25%
    assert abs(pf.stacked_rsst.cost_basis - 25_000) < 0.01
    # RSSB = 25%
    assert abs(pf.stacked_rssb.cost_basis - 25_000) < 0.01

    # Puts = 1.5%
    assert abs(pf.puts_value - 1_500) < 0.01
    # Cash = 3.5%
    assert abs(pf.cash_buffer - 3_500) < 0.01


def test_bucket_weights_at_target():
    """When all positions are at cost with no price changes, weights = target."""
    capital = 200_000
    pf = build_target_portfolio(capital)
    # Set current_price * shares = cost_basis for each (simulate buying at cost)
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

    weights = pf.bucket_weights()
    for bucket, target in ALLOCATION.items():
        assert abs(weights[bucket] - target) < 0.001, (
            f"{bucket}: {weights[bucket]:.4f} != {target:.4f}"
        )


def test_bucket_drift_zero_at_target():
    capital = 100_000
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

    drift = pf.bucket_drift()
    for bucket, d in drift.items():
        assert abs(d) < 0.001


def test_save_and_load(tmp_path):
    capital = 50_000
    pf = build_target_portfolio(capital)
    path = tmp_path / "test_state.json"
    pf.save(path)

    loaded = Portfolio.load(path)
    assert loaded.total_cash_deployed == capital
    assert len(loaded.physical_reality) == len(PHYSICAL_REALITY_TICKERS)
    assert loaded.stacked_rsst.ticker == "RSST"
    assert loaded.stacked_rssb.ticker == "RSSB"
    assert abs(loaded.puts_value - pf.puts_value) < 0.01
    assert abs(loaded.cash_buffer - pf.cash_buffer) < 0.01


def test_leverage_ratio():
    capital = 100_000
    pf = build_target_portfolio(capital)
    # Give everything a market value equal to cost basis
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

    ratio = pf.leverage_ratio()
    # RSST and RSSB each double-count, so notional > 100%
    assert ratio > 1.0
