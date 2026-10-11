"""MatchSync local server.

Serves the web app and gives it an AI narrator while keeping the API key off the browser.
The facts are worked out in the browser by web/engine.js. This server only turns a fact
sheet into words, then checks every number in those words against the fact sheet.

Run: uvicorn server.main:app --port 8000
"""
import json
import logging
import os
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import guard, llm, prompts

ROOT = Path(__file__).resolve().parent.parent
llm.load_env()
log = logging.getLogger("matchsync")

app = FastAPI(title="MatchSync")


class RecapIn(BaseModel):
    facts: dict
    voice: str = "simple"


class AskIn(BaseModel):
    context: dict
    voice: str = "simple"
    question: str = Field(min_length=1, max_length=300)


def error(code: str, status: int, detail: str = "") -> JSONResponse:
    return JSONResponse({"ok": False, "code": code, "detail": detail}, status_code=status)


# Spend guard for a public deployment. Anyone with the link can press "Catch me up",
# and every press costs the key owner a model call. Two caps, both set by env vars:
# calls per visitor per minute, and calls per hour across all visitors.
_by_ip = defaultdict(deque)
_all_calls = deque()


def allow_ai_call(request: Request) -> bool:
    per_ip = int(os.getenv("AI_CALLS_PER_IP_PER_MINUTE", "12"))
    per_hour = int(os.getenv("AI_CALLS_PER_HOUR", "600"))
    now = time.monotonic()
    # Behind a single trusted proxy (Cloud Run, App Runner) the last entry is the real client.
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[-1].strip() or (request.client.host if request.client else "unknown")
    mine = _by_ip[ip]
    while mine and now - mine[0] > 60:
        mine.popleft()
    while _all_calls and now - _all_calls[0] > 3600:
        _all_calls.popleft()
    if len(_by_ip) > 5000:
        for key in [k for k, v in _by_ip.items() if not v and k != ip]:
            del _by_ip[key]
    if len(mine) >= per_ip or len(_all_calls) >= per_hour:
        return False
    mine.append(now)
    _all_calls.append(now)
    return True


def parse_json(text: str):
    """Models sometimes wrap JSON in a sentence or a code fence. Take the outermost object."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        value = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


@app.get("/api/health")
def health():
    cfg = llm.config()
    return {"ok": True, "ai": cfg["enabled"], "provider": cfg["provider"], "model": cfg["model"]}


@app.post("/api/recap")
async def recap(body: RecapIn, request: Request):
    if body.voice not in prompts.VOICES:
        return error("invalid_request", 400, "unknown voice")
    if len(json.dumps(body.facts)) > 20_000:
        return error("invalid_request", 400, "fact sheet too large")
    if not llm.config()["enabled"]:
        return error("no_ai", 503)
    if not allow_ai_call(request):
        return error("rate_limited", 429)
    try:
        text = await llm.complete(prompts.recap_prompt(body.facts, body.voice))
    except llm.LLMError as err:
        if str(err) == "no_ai":
            return error("no_ai", 503)
        log.warning("recap failed: %s", err)
        return error("upstream_error", 502, str(err))

    draft = parse_json(text)
    if draft is None:
        return error("invalid_json", 502)

    # Number check. A line with a number that is not on the fact sheet is dropped,
    # and the browser fills that slot with the engine's own line.
    allowed = guard.allowed_numbers(body.facts)
    flagged = []

    def keep(value):
        if not isinstance(value, str) or not value.strip() or len(value) > 400:
            return None
        bad = guard.check(value, allowed)
        if bad:
            flagged.extend(bad)
            return None
        return value.strip()

    moments = draft.get("moments") if isinstance(draft.get("moments"), list) else []
    clean = {
        "headline": keep(draft.get("headline")),
        "story": keep(draft.get("story")),
        "moments": [
            {"id": m.get("id"), "line": keep(m.get("line"))} for m in moments if isinstance(m, dict) and m.get("id")
        ],
        "watch": keep(draft.get("watch")),
    }
    if flagged:
        log.info("number check dropped lines, ungrounded numbers: %s", flagged)
    return {"ok": True, "recap": clean, "flagged": flagged, "model": llm.config()["model"]}


@app.post("/api/ask")
async def ask(body: AskIn, request: Request):
    if body.voice not in prompts.VOICES:
        return error("invalid_request", 400, "unknown voice")
    if len(json.dumps(body.context)) > 40_000:
        return error("invalid_request", 400, "context too large")
    if not llm.config()["enabled"]:
        return error("no_ai", 503)
    if not allow_ai_call(request):
        return error("rate_limited", 429)
    try:
        text = await llm.complete(prompts.ask_prompt(body.context, body.voice, body.question), max_tokens=300)
    except llm.LLMError as err:
        if str(err) == "no_ai":
            return error("no_ai", 503)
        log.warning("ask failed: %s", err)
        return error("upstream_error", 502, str(err))
    answer = text.strip()
    if not answer:
        return error("empty_completion", 502)
    return {"ok": True, "answer": answer, "unverified": guard.check(answer, guard.allowed_numbers(body.context))}


# The web app. Mounted last so it does not shadow the API routes.
app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
