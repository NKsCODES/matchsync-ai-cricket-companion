"""Run: python -m pytest tests/"""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server import guard, llm, main, prompts
from server.main import app, parse_json

CASES = json.loads((Path(__file__).parent / "guard_cases.json").read_text(encoding="utf-8"))
FACTS = CASES["facts"]
client = TestClient(app)


@pytest.fixture(autouse=True)
def no_real_keys(monkeypatch):
    for name in ("LLM_PROVIDER", "LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL", "AI_CALLS_PER_IP_PER_MINUTE", "AI_CALLS_PER_HOUR"):
        monkeypatch.delenv(name, raising=False)
    main._by_ip.clear()
    main._all_calls.clear()


def fake_llm(monkeypatch, reply):
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("LLM_API_KEY", "test")

    async def complete(prompt, max_tokens=600):
        complete.prompt = prompt
        return reply

    monkeypatch.setattr(llm, "complete", complete)
    return complete


def test_guard_matches_the_browser_guard():
    allowed = guard.allowed_numbers(FACTS)
    for case in CASES["cases"]:
        assert guard.check(case["text"], allowed) == case["bad"], case["text"]


def test_health_reports_ai_off_without_a_key():
    body = client.get("/api/health").json()
    assert body["ok"] is True and body["ai"] is False


def test_recap_without_a_key_says_no_ai():
    res = client.post("/api/recap", json={"facts": FACTS, "voice": "simple"})
    assert res.status_code == 503 and res.json()["code"] == "no_ai"


def test_recap_drops_lines_with_invented_numbers(monkeypatch):
    reply = "Sure! " + json.dumps(
        {
            "headline": "Kings 62/0 se 103/4 pe aa gaye.",
            "story": "They lost 5 wickets in a rush.",
            "moments": [{"id": "m1", "line": "4 wickets for 13, the game turned here."}],
            "watch": "Need 79 off 36.",
        }
    )
    fake = fake_llm(monkeypatch, reply)
    body = client.post("/api/recap", json={"facts": FACTS, "voice": "hinglish"}).json()
    assert body["ok"] is True
    assert body["recap"]["headline"].startswith("Kings 62/0")
    assert body["recap"]["story"] is None
    assert body["recap"]["moments"] == [{"id": "m1", "line": "4 wickets for 13, the game turned here."}]
    assert body["flagged"] == ["5"]
    assert "Hinglish" in fake.prompt and '"need":79' in fake.prompt


def test_recap_rejects_non_json(monkeypatch):
    fake_llm(monkeypatch, "I cannot help with that.")
    res = client.post("/api/recap", json={"facts": FACTS, "voice": "simple"})
    assert res.status_code == 502 and res.json()["code"] == "invalid_json"


def test_ask_flags_unverified_numbers(monkeypatch):
    fake_llm(monkeypatch, "They need 79 off 36, about 2 sixes an over.")
    body = client.post("/api/ask", json={"context": FACTS, "voice": "simple", "question": "What do they need?"}).json()
    assert body["ok"] is True and body["unverified"] == ["2"]


def test_spend_guard_caps_ai_calls(monkeypatch):
    fake_llm(monkeypatch, "They need 79 off 36.")
    monkeypatch.setenv("AI_CALLS_PER_IP_PER_MINUTE", "2")
    body = {"context": FACTS, "voice": "simple", "question": "What do they need?"}
    assert client.post("/api/ask", json=body).status_code == 200
    assert client.post("/api/ask", json=body).status_code == 200
    third = client.post("/api/ask", json=body)
    assert third.status_code == 429 and third.json()["code"] == "rate_limited"
    recap = client.post("/api/recap", json={"facts": FACTS, "voice": "simple"})
    assert recap.status_code == 429, "the cap is shared by recap and ask"


def test_hourly_cap_applies_across_visitors(monkeypatch):
    fake_llm(monkeypatch, "They need 79 off 36.")
    monkeypatch.setenv("AI_CALLS_PER_HOUR", "1")
    body = {"context": FACTS, "voice": "simple", "question": "What do they need?"}
    assert client.post("/api/ask", json=body, headers={"x-forwarded-for": "1.1.1.1"}).status_code == 200
    assert client.post("/api/ask", json=body, headers={"x-forwarded-for": "2.2.2.2"}).status_code == 429


def test_openai_retries_in_the_form_newer_models_accept(monkeypatch):
    import asyncio

    import httpx

    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_API_KEY", "test")
    monkeypatch.setenv("LLM_MODEL", "some-reasoning-model")
    seen = []

    def handler(request):
        body = json.loads(request.content)
        seen.append(body)
        assert request.url == "https://api.openai.com/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer test"
        if "max_tokens" in body:
            return httpx.Response(400, json={"error": {"message": "Unsupported parameter: 'max_tokens' is not supported with this model."}})
        return httpx.Response(200, json={"choices": [{"message": {"content": "Need 79 off 36."}}]})

    monkeypatch.setattr(llm, "_transport", httpx.MockTransport(handler))
    assert asyncio.run(llm.complete("hi")) == "Need 79 off 36."
    assert len(seen) == 2
    assert "temperature" not in seen[1] and seen[1]["max_completion_tokens"] >= 2000


def test_openai_default_request_shape(monkeypatch):
    import asyncio

    import httpx

    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_API_KEY", "test")
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr(llm, "_transport", httpx.MockTransport(handler))
    assert asyncio.run(llm.complete("hi")) == "ok"
    assert len(seen) == 1 and seen[0]["model"] == "gpt-4o-mini"


def test_bad_voice_and_empty_question_are_rejected():
    assert client.post("/api/recap", json={"facts": FACTS, "voice": "pirate"}).status_code == 400
    assert client.post("/api/ask", json={"context": FACTS, "voice": "simple", "question": ""}).status_code == 422


def test_prompts_carry_the_rules_and_the_data():
    text = prompts.recap_prompt(FACTS, "analyst")
    assert "Every digit you write must be copied from FACTS" in text
    assert "{facts}" not in text and "{voice}" not in text


def test_parse_json_is_tolerant():
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json("no json here") is None


def test_web_app_is_served():
    res = client.get("/")
    assert res.status_code == 200 and "MatchSync" in res.text
