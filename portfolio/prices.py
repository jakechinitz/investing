"""
Price fetching utilities using yfinance.

Fetches current prices for portfolio tickers and the VIX.
"""

from __future__ import annotations

from typing import Optional

import yfinance as yf

from portfolio.config import PHYSICAL_REALITY_TICKERS, SOVEREIGN_TICKERS


def fetch_prices(tickers: list[str]) -> dict[str, Optional[float]]:
    """
    Fetch the latest closing price for a list of tickers.
    Returns {ticker: price} — price is None if the fetch failed.
    """
    results: dict[str, Optional[float]] = {}
    for ticker in tickers:
        try:
            data = yf.Ticker(ticker).history(period="1d")
            if not data.empty:
                results[ticker] = float(data["Close"].iloc[-1])
            else:
                results[ticker] = None
        except Exception:
            results[ticker] = None
    return results


def fetch_all_portfolio_prices() -> dict[str, Optional[float]]:
    """Fetch prices for every ticker in the portfolio."""
    all_tickers = (
        list(PHYSICAL_REALITY_TICKERS)
        + ["RSST", "RSSB"]
        + [t for t in SOVEREIGN_TICKERS if t == "GLD"]  # only GLD is tradeable
    )
    return fetch_prices(all_tickers)


def fetch_vix() -> Optional[float]:
    """Fetch current VIX level."""
    try:
        data = yf.Ticker("^VIX").history(period="1d")
        if not data.empty:
            return float(data["Close"].iloc[-1])
    except Exception:
        pass
    return None
