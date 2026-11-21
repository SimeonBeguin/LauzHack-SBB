from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_journey_status_mock():
    r = client.get("/journeys/demo-1/status")
    assert r.status_code == 200
    assert "estimate" in r.json()


def test_alternatives_mock():
    r = client.post("/alternatives", json={"journey_id": "demo-1"})
    assert r.status_code == 200
    assert set(r.json()["by_category"]) == {"fastest", "nearby", "comfort", "wait"}


def test_register_trip():
    r = client.post("/commuters/trips", json={
        "user_id": "u1", "origin_stop_id": "8501120",
        "destination_stop_id": "8504100", "departure_time": "07:42",
    })
    assert r.status_code == 200 and r.json()["id"]
