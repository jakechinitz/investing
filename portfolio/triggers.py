"""
Mechanical trigger monitor for the Tail-Risk Circuit Breaker (put options).

Sell triggers  — when to harvest the convexity:
  1. VIX > 45       (panic spike)
  2. Delta → -1.0   (moneyness shift — put is deep ITM)
  3. DTE  < 30      (time decay destroys value)

Re-entry triggers — when to re-establish the hedge:
  1. VIX < 18       (complacency restored, premiums cheap)
  2. At least 60-90 days after the last exit

Redeployment rule:
  Cash from selling puts goes straight into the Physical Reality Basket
  at distressed multiples.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from portfolio.config import PUT_RULES


class Signal(Enum):
    HOLD = "HOLD"
    SELL = "SELL"
    REENTER = "REENTER"


@dataclass
class TriggerState:
    """Snapshot of the inputs needed to evaluate put triggers."""

    vix: float
    put_delta: float                # current delta of the put position
    put_dte: int                    # days to expiration
    last_exit_date: Optional[dt.date] = None  # date puts were last sold
    today: Optional[dt.date] = None

    def __post_init__(self):
        if self.today is None:
            self.today = dt.date.today()


@dataclass
class TriggerResult:
    signal: Signal
    reasons: list[str]
    detail: str = ""


def evaluate_sell_triggers(state: TriggerState) -> TriggerResult:
    """Check if any sell trigger is active."""
    rules = PUT_RULES["sell_triggers"]
    reasons: list[str] = []

    if state.vix >= rules["vix_above"]:
        reasons.append(
            f"VIX at {state.vix:.1f} >= {rules['vix_above']} (panic spike)"
        )

    if state.put_delta <= rules["delta_near"]:
        reasons.append(
            f"Put delta at {state.put_delta:.2f} → deep ITM (moneyness shift)"
        )

    if state.put_dte <= rules["dte_below"]:
        reasons.append(
            f"Put DTE at {state.put_dte} <= {rules['dte_below']} (time decay)"
        )

    if reasons:
        return TriggerResult(
            signal=Signal.SELL,
            reasons=reasons,
            detail=(
                "SELL puts to harvest convexity. "
                "Redeploy proceeds into the Physical Reality Basket."
            ),
        )

    return TriggerResult(signal=Signal.HOLD, reasons=["No sell trigger active."])


def evaluate_reentry_triggers(state: TriggerState) -> TriggerResult:
    """Check if conditions are met to re-establish the put hedge."""
    rules = PUT_RULES["reentry_triggers"]
    reasons: list[str] = []
    blockers: list[str] = []

    # VIX must be below threshold
    if state.vix < rules["vix_below"]:
        reasons.append(
            f"VIX at {state.vix:.1f} < {rules['vix_below']} (complacency restored)"
        )
    else:
        blockers.append(
            f"VIX at {state.vix:.1f} — still above {rules['vix_below']}"
        )

    # Cooling period must have elapsed
    if state.last_exit_date is not None:
        days_since = (state.today - state.last_exit_date).days
        if days_since >= rules["min_wait_days"]:
            reasons.append(
                f"{days_since} days since exit >= {rules['min_wait_days']} "
                f"day minimum"
            )
        else:
            blockers.append(
                f"Only {days_since} days since exit — need "
                f"{rules['min_wait_days']}"
            )
    else:
        # No prior exit on record — assume fresh start
        reasons.append("No prior exit on record; fresh hedge allowed.")

    if reasons and not blockers:
        return TriggerResult(
            signal=Signal.REENTER,
            reasons=reasons,
            detail=(
                "RE-ENTER put hedge: buy 3-to-6-month expiry puts on "
                "SPY/QQQ, 15-20% OTM, using 1.5% of total portfolio value."
            ),
        )

    all_reasons = reasons + [f"[BLOCKED] {b}" for b in blockers]
    return TriggerResult(
        signal=Signal.HOLD,
        reasons=all_reasons,
        detail="Wait — conditions not yet met to re-establish hedge.",
    )


def evaluate(state: TriggerState, has_puts: bool) -> TriggerResult:
    """
    Main entry point: evaluate the current trigger state.

    has_puts: True if the portfolio currently holds put positions.
    """
    if has_puts:
        return evaluate_sell_triggers(state)
    else:
        return evaluate_reentry_triggers(state)


def format_trigger_report(result: TriggerResult) -> str:
    """Human-readable trigger report."""
    lines = [
        "PUT TRIGGER MONITOR",
        "=" * 60,
        f"  Signal:  {result.signal.value}",
    ]
    for r in result.reasons:
        lines.append(f"    • {r}")
    if result.detail:
        lines.append(f"  Action:  {result.detail}")
    lines.append("=" * 60)
    return "\n".join(lines)
