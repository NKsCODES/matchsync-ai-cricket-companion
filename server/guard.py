"""Number grounding guard, the server side twin of web/guard.js.

The model may choose words, never numbers. Every number in model text must
already exist in the fact sheet the model was given.
"""
import json
import re

NUM = re.compile(r"\d+(?:\.\d+)?")
MOMENT_ID = re.compile(r'"id":"m\d+"')


def _norm(token: str) -> str:
    value = float(token)
    return str(int(value)) if value == int(value) else str(value)


def allowed_numbers(facts) -> set:
    source = MOMENT_ID.sub("", json.dumps(facts, separators=(",", ":"), ensure_ascii=False))
    allowed = set()
    for token in NUM.findall(source):
        allowed.add(token)
        allowed.add(_norm(token))
    return allowed


def check(text, allowed: set) -> list:
    """Return the numbers in text that are not in the fact sheet. Empty list means it passed."""
    bad = []
    for token in NUM.findall(str(text or "")):
        if token not in allowed and _norm(token) not in allowed and token not in bad:
            bad.append(token)
    return bad
