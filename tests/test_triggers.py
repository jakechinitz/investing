"""Tests for portfolio.triggers"""

import datetime as dt

from portfolio.triggers import Signal, TriggerState, evaluate, evaluate_sell_triggers, evaluate_reentry_triggers


class TestSellTriggers:
    def test_vix_panic(self):
        state = TriggerState(vix=50, put_delta=-0.3, put_dte=60)
        result = evaluate_sell_triggers(state)
        assert result.signal == Signal.SELL
        assert any("VIX" in r for r in result.reasons)

    def test_delta_deep_itm(self):
        state = TriggerState(vix=25, put_delta=-1.0, put_dte=60)
        result = evaluate_sell_triggers(state)
        assert result.signal == Signal.SELL
        assert any("delta" in r.lower() for r in result.reasons)

    def test_dte_expiring(self):
        state = TriggerState(vix=20, put_delta=-0.2, put_dte=25)
        result = evaluate_sell_triggers(state)
        assert result.signal == Signal.SELL
        assert any("DTE" in r for r in result.reasons)

    def test_no_trigger(self):
        state = TriggerState(vix=20, put_delta=-0.2, put_dte=90)
        result = evaluate_sell_triggers(state)
        assert result.signal == Signal.HOLD

    def test_multiple_triggers(self):
        state = TriggerState(vix=50, put_delta=-1.0, put_dte=10)
        result = evaluate_sell_triggers(state)
        assert result.signal == Signal.SELL
        assert len(result.reasons) == 3


class TestReentryTriggers:
    def test_all_clear(self):
        state = TriggerState(
            vix=15,
            put_delta=0,
            put_dte=0,
            last_exit_date=dt.date(2025, 1, 1),
            today=dt.date(2025, 6, 1),
        )
        result = evaluate_reentry_triggers(state)
        assert result.signal == Signal.REENTER

    def test_vix_still_high(self):
        state = TriggerState(
            vix=25,
            put_delta=0,
            put_dte=0,
            last_exit_date=dt.date(2025, 1, 1),
            today=dt.date(2025, 6, 1),
        )
        result = evaluate_reentry_triggers(state)
        assert result.signal == Signal.HOLD
        assert any("BLOCKED" in r for r in result.reasons)

    def test_too_soon(self):
        state = TriggerState(
            vix=15,
            put_delta=0,
            put_dte=0,
            last_exit_date=dt.date(2025, 5, 1),
            today=dt.date(2025, 5, 20),
        )
        result = evaluate_reentry_triggers(state)
        assert result.signal == Signal.HOLD

    def test_fresh_start_no_prior_exit(self):
        state = TriggerState(vix=15, put_delta=0, put_dte=0)
        result = evaluate_reentry_triggers(state)
        assert result.signal == Signal.REENTER


class TestEvaluateMain:
    def test_has_puts_sell(self):
        state = TriggerState(vix=50, put_delta=-0.5, put_dte=60)
        result = evaluate(state, has_puts=True)
        assert result.signal == Signal.SELL

    def test_has_puts_hold(self):
        state = TriggerState(vix=20, put_delta=-0.2, put_dte=90)
        result = evaluate(state, has_puts=True)
        assert result.signal == Signal.HOLD

    def test_no_puts_reenter(self):
        state = TriggerState(vix=15, put_delta=0, put_dte=0)
        result = evaluate(state, has_puts=False)
        assert result.signal == Signal.REENTER

    def test_no_puts_wait(self):
        state = TriggerState(vix=30, put_delta=0, put_dte=0)
        result = evaluate(state, has_puts=False)
        assert result.signal == Signal.HOLD
