import asyncio

from backend.services import pipeline_scheduler as scheduler_module
from backend.services.pipeline_scheduler import PipelineScheduler
from backend.sources.instagram_dm import InstagramDMService, instagram_auth


def test_pipeline_autorun_defaults_to_disabled(monkeypatch):
    monkeypatch.delenv("PIPELINE_AUTORUN_ENABLED", raising=False)
    assert PipelineScheduler.autorun_enabled() is False


def test_instagram_sending_defaults_to_disabled(monkeypatch):
    monkeypatch.delenv("INSTAGRAM_DM_SENDING_ENABLED", raising=False)

    async def must_not_be_called():
        raise AssertionError("kill-switch lookup should not run while sending is disabled")

    monkeypatch.setattr(instagram_auth, "is_kill_switch_active", must_not_be_called)
    result = asyncio.run(InstagramDMService().send_dm("test_account", "hello"))

    assert result == {
        "success": False,
        "error": "sending_disabled",
        "thread_id": None,
    }


def test_pipeline_orders_enrichment_scoring_and_draft_generation_without_sending(monkeypatch):
    events = []

    class FakeEnrichmentAgent:
        async def run(self, **_kwargs):
            events.append("enrich")
            return {"processed": 1}

    class FakeScoringAgent:
        async def run(self, **_kwargs):
            events.append("score")
            return {"scored": 1}

    class FakeOutreachAgent:
        async def run(self, **_kwargs):
            events.append("generate")
            return {"generated": 1}

        async def send_approved_messages(self):
            raise AssertionError("scheduled automation must never send")

    monkeypatch.setattr(scheduler_module, "EnrichmentAgent", FakeEnrichmentAgent)
    monkeypatch.setattr(scheduler_module, "ScoringAgent", FakeScoringAgent)
    monkeypatch.setattr(scheduler_module, "OutreachAgent", FakeOutreachAgent)
    monkeypatch.setattr(scheduler_module.db, "log_system", lambda **_kwargs: None)

    scheduler = PipelineScheduler()
    monkeypatch.setattr(scheduler, "_is_paused", lambda: False)
    result = asyncio.run(scheduler.trigger_once())

    assert events == ["enrich", "score", "generate"]
    assert result["send"] == {
        "sent": 0,
        "disabled": True,
        "reason": "scheduled sending is permanently disabled",
    }
