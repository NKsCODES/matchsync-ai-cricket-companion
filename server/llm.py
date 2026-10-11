"""LLM access over plain HTTP. One coroutine, complete(prompt) -> str.

Configured with environment variables (see .env.example):
  LLM_PROVIDER  anthropic | openai | groq | gemini | ollama
  LLM_API_KEY   the key for that provider (not needed for ollama)
  LLM_MODEL     optional, overrides the default model
  LLM_BASE_URL  optional, any OpenAI compatible endpoint
"""
import os
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent

# Default models are a starting point. Providers retire models often, so set LLM_MODEL
# to a current one from your provider's model list if a call returns a model error.
PRESETS = {
    "anthropic": {"base": "https://api.anthropic.com/v1", "model": "claude-haiku-4-5-20251001"},
    "openai": {"base": "https://api.openai.com/v1", "model": "gpt-4o-mini"},
    "groq": {"base": "https://api.groq.com/openai/v1", "model": "llama-3.3-70b-versatile"},
    "gemini": {"base": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-2.0-flash"},
    "ollama": {"base": "http://localhost:11434/v1", "model": "llama3.2"},
}


class LLMError(Exception):
    pass


_transport = None  # tests swap in an httpx.MockTransport


def load_env(path: Path = ROOT / ".env") -> None:
    """Minimal .env reader so the project needs no extra dependency."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def config() -> dict:
    provider = os.getenv("LLM_PROVIDER", "").strip().lower()
    key = os.getenv("LLM_API_KEY", "").strip()
    preset = PRESETS.get(provider)
    enabled = bool(preset) and (bool(key) or provider == "ollama")
    return {
        "enabled": enabled,
        "provider": provider if preset else "",
        "key": key,
        "model": os.getenv("LLM_MODEL", "").strip() or (preset or {}).get("model", ""),
        "base": (os.getenv("LLM_BASE_URL", "").strip() or (preset or {}).get("base", "")).rstrip("/"),
    }


async def complete(prompt: str, max_tokens: int = 600) -> str:
    cfg = config()
    if not cfg["enabled"]:
        raise LLMError("no_ai")
    try:
        async with httpx.AsyncClient(timeout=40, transport=_transport) as client:
            if cfg["provider"] == "anthropic":
                response = await client.post(
                    cfg["base"] + "/messages",
                    headers={"x-api-key": cfg["key"], "anthropic-version": "2023-06-01"},
                    json={
                        "model": cfg["model"],
                        "max_tokens": max_tokens,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
                response.raise_for_status()
                return "".join(block.get("text", "") for block in response.json()["content"])
            headers = {"Authorization": "Bearer " + cfg["key"]} if cfg["key"] else {}
            messages = [{"role": "user", "content": prompt}]
            url = cfg["base"] + "/chat/completions"
            response = await client.post(
                url,
                headers=headers,
                json={"model": cfg["model"], "max_tokens": max_tokens, "temperature": 0.4, "messages": messages},
            )
            if response.status_code == 400 and ("max_tokens" in response.text or "temperature" in response.text):
                # Newer OpenAI reasoning models (the GPT-5 family) reject max_tokens and a custom
                # temperature. Retry once in the form they accept, with room for reasoning tokens.
                response = await client.post(
                    url,
                    headers=headers,
                    json={"model": cfg["model"], "max_completion_tokens": max(max_tokens * 4, 2000), "messages": messages},
                )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"] or ""
    except httpx.HTTPStatusError as err:
        raise LLMError(f"{cfg['provider']} returned {err.response.status_code}: {err.response.text[:200]}") from err
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as err:
        raise LLMError(f"{cfg['provider']} call failed: {err}") from err
