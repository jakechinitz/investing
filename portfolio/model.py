"""
Portfolio model — holds current positions and computes weights / drift.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from portfolio.config import (
    ALLOCATION,
    PHYSICAL_REALITY_TICKERS,
    SOVEREIGN_TICKERS,
)


@dataclass
class Position:
    ticker: str
    shares: float = 0.0
    cost_basis: float = 0.0       # total cost paid
    current_price: float = 0.0    # last-known price

    @property
    def market_value(self) -> float:
        return self.shares * self.current_price


@dataclass
class Portfolio:
    """Represents the full portfolio state."""

    total_cash_deployed: float = 0.0

    # Bucket positions
    physical_reality: dict[str, Position] = field(default_factory=dict)
    stacked_rsst: Optional[Position] = None
    stacked_rssb: Optional[Position] = None
    sovereign: dict[str, Position] = field(default_factory=dict)
    puts_value: float = 0.0       # mark-to-market value of put positions
    cash_buffer: float = 0.0

    # ---------- helpers ----------

    @property
    def physical_reality_value(self) -> float:
        return sum(p.market_value for p in self.physical_reality.values())

    @property
    def rsst_value(self) -> float:
        return self.stacked_rsst.market_value if self.stacked_rsst else 0.0

    @property
    def rssb_value(self) -> float:
        return self.stacked_rssb.market_value if self.stacked_rssb else 0.0

    @property
    def sovereign_value(self) -> float:
        return sum(p.market_value for p in self.sovereign.values())

    @property
    def total_value(self) -> float:
        return (
            self.physical_reality_value
            + self.rsst_value
            + self.rssb_value
            + self.sovereign_value
            + self.puts_value
            + self.cash_buffer
        )

    def bucket_weights(self) -> dict[str, float]:
        """Return current actual weights for each bucket."""
        tv = self.total_value
        if tv == 0:
            return {k: 0.0 for k in ALLOCATION}
        return {
            "physical_reality_basket": self.physical_reality_value / tv,
            "stacked_rsst": self.rsst_value / tv,
            "stacked_rssb": self.rssb_value / tv,
            "sovereign_escape_hatch": self.sovereign_value / tv,
            "tail_risk_puts": self.puts_value / tv,
            "cash_buffer": self.cash_buffer / tv,
        }

    def bucket_drift(self) -> dict[str, float]:
        """Difference between actual and target weight (positive = overweight)."""
        actual = self.bucket_weights()
        return {k: actual[k] - ALLOCATION[k] for k in ALLOCATION}

    # ---------- notional exposure ----------

    def notional_exposure(self) -> dict[str, float]:
        """
        Compute total notional exposure accounting for the embedded leverage
        in RSST and RSSB (each provides ~2x notional per dollar invested).
        """
        return {
            "physical_reality": self.physical_reality_value,
            "core_spx_via_rsst": self.rsst_value,      # 1x SPX inside RSST
            "managed_futures_via_rsst": self.rsst_value, # 1x trend inside RSST
            "global_eq_via_rssb": self.rssb_value,       # 1x global eq inside RSSB
            "treasuries_via_rssb": self.rssb_value,      # 1x UST inside RSSB
            "sovereign": self.sovereign_value,
            "puts_notional": self.puts_value,
            "cash": self.cash_buffer,
        }

    def total_notional(self) -> float:
        return sum(self.notional_exposure().values())

    def leverage_ratio(self) -> float:
        tv = self.total_value
        return self.total_notional() / tv if tv else 0.0

    # ---------- persistence ----------

    def save(self, path: str | Path = "portfolio_state.json") -> None:
        """Serialize portfolio state to JSON."""

        def _pos_dict(p: Position) -> dict:
            return {
                "ticker": p.ticker,
                "shares": p.shares,
                "cost_basis": p.cost_basis,
                "current_price": p.current_price,
            }

        data = {
            "total_cash_deployed": self.total_cash_deployed,
            "physical_reality": {
                t: _pos_dict(p) for t, p in self.physical_reality.items()
            },
            "stacked_rsst": _pos_dict(self.stacked_rsst) if self.stacked_rsst else None,
            "stacked_rssb": _pos_dict(self.stacked_rssb) if self.stacked_rssb else None,
            "sovereign": {t: _pos_dict(p) for t, p in self.sovereign.items()},
            "puts_value": self.puts_value,
            "cash_buffer": self.cash_buffer,
        }
        Path(path).write_text(json.dumps(data, indent=2))

    @classmethod
    def load(cls, path: str | Path = "portfolio_state.json") -> "Portfolio":
        """Deserialize portfolio state from JSON."""
        data = json.loads(Path(path).read_text())

        def _make_pos(d: dict) -> Position:
            return Position(**d)

        pf = cls()
        pf.total_cash_deployed = data["total_cash_deployed"]
        pf.physical_reality = {
            t: _make_pos(p) for t, p in data["physical_reality"].items()
        }
        if data["stacked_rsst"]:
            pf.stacked_rsst = _make_pos(data["stacked_rsst"])
        if data["stacked_rssb"]:
            pf.stacked_rssb = _make_pos(data["stacked_rssb"])
        pf.sovereign = {t: _make_pos(p) for t, p in data["sovereign"].items()}
        pf.puts_value = data["puts_value"]
        pf.cash_buffer = data["cash_buffer"]
        return pf


def build_target_portfolio(total_capital: float) -> Portfolio:
    """
    Given a total capital amount, compute the dollar allocation for each
    bucket and the equal-weight share counts (at current prices this is
    purely dollar-based; share counts remain 0 until prices are fetched).
    """
    pf = Portfolio(total_cash_deployed=total_capital)

    # Physical Reality Basket — equal-weight across all tickers
    basket_dollars = total_capital * ALLOCATION["physical_reality_basket"]
    per_stock = basket_dollars / len(PHYSICAL_REALITY_TICKERS)
    for ticker in PHYSICAL_REALITY_TICKERS:
        pf.physical_reality[ticker] = Position(
            ticker=ticker, cost_basis=per_stock
        )

    # Stacked parachutes
    pf.stacked_rsst = Position(
        ticker="RSST",
        cost_basis=total_capital * ALLOCATION["stacked_rsst"],
    )
    pf.stacked_rssb = Position(
        ticker="RSSB",
        cost_basis=total_capital * ALLOCATION["stacked_rssb"],
    )

    # Sovereign escape hatch — equal-weight
    sov_dollars = total_capital * ALLOCATION["sovereign_escape_hatch"]
    per_sov = sov_dollars / len(SOVEREIGN_TICKERS)
    for ticker in SOVEREIGN_TICKERS:
        pf.sovereign[ticker] = Position(ticker=ticker, cost_basis=per_sov)

    # Tail-risk puts and cash
    pf.puts_value = total_capital * ALLOCATION["tail_risk_puts"]
    pf.cash_buffer = total_capital * ALLOCATION["cash_buffer"]

    return pf
