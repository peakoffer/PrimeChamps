import os

os.environ["BACKEND_API_KEY"] = "prime-champs-e2e-api-key"
os.environ["PIPELINE_AUTORUN_ENABLED"] = "false"
os.environ["INSTAGRAM_DM_SENDING_ENABLED"] = "false"

from fastapi.testclient import TestClient

from backend.server import app


def test_health_is_public():
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_protected_api_requires_key():
    with TestClient(app) as client:
        response = client.get("/agents")
    assert response.status_code == 401


def test_protected_api_accepts_key():
    with TestClient(app) as client:
        response = client.get(
            "/agents", headers={"X-API-Key": "prime-champs-e2e-api-key"}
        )
    assert response.status_code == 200
    assert {agent["id"] for agent in response.json()["agents"]} == {
        "enrichment",
        "research",
        "outreach",
        "scoring",
    }
