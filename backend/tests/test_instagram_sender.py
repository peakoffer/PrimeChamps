import asyncio
from datetime import datetime, timezone

from backend.services import instagram_sender as sender_module
from backend.services.instagram_sender import InstagramSender


class FakeAgent:
    """Outreach agent stand-in: settings from a dict, and a record of sends."""

    def __init__(self, settings, sent_today=0):
        self._settings = settings
        self._sent_today = sent_today
        self.send_calls = []

    def _get_setting(self, key, default):
        return self._settings.get(key, default)

    def _dms_sent_today(self):
        return self._sent_today

    async def send_approved_messages(self, limit=20):
        self.send_calls.append(limit)
        return {"sent": 1, "failed": 0}


ON = {
    "auto_send_instagram": True,
    "pause_all_outreach": False,
    "daily_dm_limit": 15,
    "send_window_start_hour": 0,
    "send_window_end_hour": 24,
    "send_timezone": "UTC",
}


def run_tick(monkeypatch, settings, sent_today=0, deployment=True):
    agent = FakeAgent(settings, sent_today)
    monkeypatch.setattr(sender_module, "OutreachAgent", lambda: agent)
    monkeypatch.setenv("INSTAGRAM_DM_SENDING_ENABLED", "true" if deployment else "false")
    result = asyncio.run(InstagramSender().tick())
    return result, agent


def test_sends_exactly_one_message_per_tick_when_everything_is_on(monkeypatch):
    result, agent = run_tick(monkeypatch, ON)
    assert result["reason"] == "ran"
    assert agent.send_calls == [1]


def test_nothing_sends_unless_every_switch_allows_it(monkeypatch):
    cases = [
        ({**ON}, 0, False, "sending_disabled_on_backend"),
        ({**ON, "auto_send_instagram": False}, 0, True, "auto_send_off"),
        ({**ON, "auto_send_instagram": "false"}, 0, True, "auto_send_off"),
        ({**ON, "pause_all_outreach": True}, 0, True, "paused"),
        ({**ON, "send_window_start_hour": 0, "send_window_end_hour": 0}, 0, True, "outside_sending_hours"),
        ({**ON}, 15, True, "daily_limit_reached"),
    ]
    for settings, sent_today, deployment, reason in cases:
        result, agent = run_tick(monkeypatch, settings, sent_today, deployment)
        assert result["reason"] == reason, (settings, result)
        assert agent.send_calls == []


def test_daily_limit_is_capped_at_thirty_whatever_the_setting(monkeypatch):
    result, agent = run_tick(monkeypatch, {**ON, "daily_dm_limit": 500}, sent_today=30)
    assert result["reason"] == "daily_limit_reached"
    assert agent.send_calls == []


def test_sending_window_uses_the_configured_time_zone():
    settings = {"window_start": 9, "window_end": 20, "timezone": "America/New_York"}
    # 14:00 UTC is 10:00 in New York (inside); 03:00 UTC is 23:00 (outside).
    assert InstagramSender.inside_window(settings, datetime(2026, 9, 30, 14, tzinfo=timezone.utc))
    assert not InstagramSender.inside_window(settings, datetime(2026, 9, 30, 3, tzinfo=timezone.utc))
