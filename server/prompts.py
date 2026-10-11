"""Prompt builders. The text lives in prompts.json so the browser and the server share one source."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = json.loads((ROOT / "prompts.json").read_text(encoding="utf-8"))
VOICES = PROMPTS["voices"]


def _fill(lines, **values) -> str:
    text = "\n".join(lines)
    for key, value in values.items():
        text = text.replace("{" + key + "}", value)
    return text


def recap_prompt(facts: dict, voice: str) -> str:
    return _fill(
        PROMPTS["recap"],
        voice=VOICES[voice],
        fan=str(facts.get("fan", "neutral")),
        facts=json.dumps(facts, separators=(",", ":"), ensure_ascii=False),
    )


def ask_prompt(context: dict, voice: str, question: str) -> str:
    return _fill(
        PROMPTS["ask"],
        voice=VOICES[voice],
        fan=str(context.get("fan", "neutral")),
        context=json.dumps(context, separators=(",", ":"), ensure_ascii=False),
        question=question[:300],
    )
