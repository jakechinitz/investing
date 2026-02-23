"""
Portfolio Allocation Strategy — Configuration

Final Pareto-Optimal Allocation:
  40.0%  Physical Reality Basket (equal-weighted bottleneck equities)
  25.0%  RSST  (Return Stacked US Equity & Trend)
  25.0%  RSSB  (Return Stacked US Equity & Bonds)
   5.0%  Sovereign Escape Hatch (Gold, ETH, SOL, XMR)
   1.5%  Tail Risk Circuit Breaker (SPY/QQQ deep OTM puts)
   3.5%  Cash Buffer

Total notional exposure: ~140%
"""

# ---------------------------------------------------------------------------
# Bucket weights (must sum to 1.0)
# ---------------------------------------------------------------------------
ALLOCATION = {
    "physical_reality_basket": 0.40,
    "stacked_rsst": 0.25,
    "stacked_rssb": 0.25,
    "sovereign_escape_hatch": 0.05,
    "tail_risk_puts": 0.015,
    "cash_buffer": 0.035,
}

# ---------------------------------------------------------------------------
# Physical Reality Basket — equal-weighted
# ---------------------------------------------------------------------------
PHYSICAL_REALITY_TICKERS = [
    "TSM",      # TSMC
    "ASML",     # ASML
    "INTC",     # Intel
    "7741.T",   # Hoya Corp
    "4186.T",   # Tokyo Ohka Kogyo (TOK)
    "SNPS",     # Synopsys
    "000660.KS",# SK Hynix
    "BESI.AS",  # Besi (Amsterdam)
    "CAMT",     # Camtek
    "AJINY",    # Ajinomoto (ADR)
    "3037.TW",  # Unimicron
    "6315.T",   # Towa Corp
    "6146.T",   # Disco Corp
    "FORM",     # FormFactor
    "GEV",      # GE Vernova
    "SIEGY",    # Siemens (ADR)
    "ETN",      # Eaton
    "VRT",      # Vertiv
    "ANET",     # Arista Networks
    "PSTG",     # Pure Storage
    "NET",      # Cloudflare
    "ISRG",     # Intuitive Surgical
    "RKLB",     # Rocket Lab
    "HEI",      # Heico
    "BRK-B",    # Berkshire Hathaway B
    "AMZN",     # Amazon
    "GOOG",     # Alphabet
]

# ---------------------------------------------------------------------------
# Stacked Parachute ETFs
# ---------------------------------------------------------------------------
STACKED_TICKERS = {
    "RSST": "Return Stacked US Equity & Trend (25% SPX + 25% Managed Futures)",
    "RSSB": "Return Stacked Global Equity & Bonds (25% Global Eq + 25% UST)",
}

# ---------------------------------------------------------------------------
# Sovereign Escape Hatch — equal-weighted within bucket
# ---------------------------------------------------------------------------
SOVEREIGN_TICKERS = {
    "GLD":  "Gold ETF (held in brokerage)",
    "ETH":  "Ethereum (cold storage / Coinbase)",
    "SOL":  "Solana  (cold storage / Coinbase)",
    "XMR":  "Monero  (cold storage)",
}

# ---------------------------------------------------------------------------
# Tail-Risk Circuit Breaker — Mechanical Put Rules
# ---------------------------------------------------------------------------
PUT_RULES = {
    "underlying": ["SPY", "QQQ"],
    "strike_otm_pct": 0.15,          # 15-20% below current price
    "expiry_months": (3, 6),          # 3-to-6-month expiry
    "sell_triggers": {
        "vix_above": 45,              # Panic spike → sell puts
        "delta_near": -1.0,           # Moneyness shift → sell
        "dte_below": 30,              # Time decay → sell
    },
    "reentry_triggers": {
        "vix_below": 18,              # Wait for complacency
        "min_wait_days": 60,          # 60-90 day cooling period
    },
}

# ---------------------------------------------------------------------------
# Rebalance cadence
# ---------------------------------------------------------------------------
REBALANCE_PHYSICAL_MONTHS = 12        # Rebalance Physical Reality once/year
DRIFT_THRESHOLD_PCT = 5.0             # Alert if any bucket drifts > 5%
