from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_journey_status_follows_situation():
    client.post("/situation/demo-zh", json={"action": "reset"})
    r = client.get("/journeys/demo-zh/status")
    assert r.status_code == 200 and r.json()["kind"] == "interruption" and not r.json()["changes"]
    client.post("/situation/demo-zh", json={"action": "replacement_bus", "value": True})
    changes = client.get("/journeys/demo-zh/status").json()["changes"]
    assert changes and "Replacement buses" in changes[0]
    client.post("/situation/demo-zh", json={"action": "resume"})
    st = client.get("/journeys/demo-zh/status").json()
    assert st["kind"] == "resolved" and st["estimate"]["ended"]
    assert client.post("/situation/demo-zh", json={"action": "replacement_bus", "value": True}).status_code == 409
    client.post("/situation/demo-zh", json={"action": "reset"})


def test_replay_situation_follows_the_data():
    sit = client.get("/situation/demo-1").json()
    assert sit["mode"] == "replay" and sit["next_update"]
    nxt = client.post("/situation/demo-1", json={"action": "next_update"}).json()
    assert nxt["clock"] == sit["next_update"]
    assert client.post("/situation/demo-1", json={"action": "resume"}).status_code == 409
    client.post("/situation/demo-1", json={"action": "reset"})


def test_stop_search():
    names = [s["name"] for s in client.get("/stops", params={"q": "Wetzikon"}).json()]
    assert "Wetzikon ZH" in names


def test_register_trip():
    r = client.post("/commuters/trips", json={
        "user_id": "u1", "origin_stop_id": "8501120",
        "destination_stop_id": "8504100", "departure_time": "07:42",
    })
    assert r.status_code == 200 and r.json()["id"]
