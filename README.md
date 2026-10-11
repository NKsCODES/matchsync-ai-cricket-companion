# MatchSync

A live match companion for the fan who looked away. It tells you what you missed, whether it is good or bad for your team, and what to watch next, in about 20 seconds and in your own voice.

The catch up feature inside the app is called Kya Hua? (Hindi for "what happened?"), the first thing a fan asks when they look back at the screen.

Built as a Forward Deployed Engineer exercise: one AI powered artifact that solves a real problem fans face during a live match.

## The fan problem

Nobody watches all 40 overs of a T20. Fans follow a match in snatches, between work, a cab ride, dinner and a dozen other apps. Every time they look back at the screen they hit the same wall.

- The scorecard gives the score, not the story. 103/4 does not say that it was 62/0 half an hour ago.
- Ball by ball commentary is a firehose. Nobody scrolls back through 40 balls.
- The chat and the watch along have moved on. Everyone is reacting to something the fan did not see.

A returning fan has three questions, in this order.

1. What did I miss?
2. Is it good or bad for my team?
3. What do I watch now?

Existing second screen products answer a fourth question, what is the score. MatchSync answers the three above.

## What it does

- Tracks when you last looked. Leave the tab and come back, and a catch up is waiting. You can also ask for the last 2 overs, the last 5, this innings or the whole match.
- One headline that takes your side. The same collapse is bad news for a Kings fan and good news for a Strikers fan.
- Up to three moments that mattered, ranked by how far they moved the win chance, not by how loud they were. Collapses, run surges, squeezes, dropped catches, big overs.
- A win chance line with the part you missed shaded, so you can see the swing at a glance.
- One thing to watch next. The set batter, the bowler with overs left, or the equation.
- Three voices. Hinglish like a friend on WhatsApp, simple English for someone new to cricket, and an analyst voice for the stats fan.
- Ask anything about the match in plain language.

## How it works

```
ball by ball feed
      |
      v
facts engine (web/engine.js)       deterministic, unit tested
  state after every ball
  win chance estimate
  moments inside the window
  fact sheet (JSON)
      |
      +--> instant narrator (web/voices.js)   templates, zero latency, always available
      |
      +--> AI narrator (web/ai.js or server/)  picks the words, in the fan's voice
                 |
                 v
           number guard (web/guard.js, server/guard.py)
           every number in the AI text must exist in the fact sheet
           a line that fails is replaced by the instant narrator's line
```

Three decisions shaped the build.

**The AI never does the maths.** In live sport one wrong score destroys trust. The engine works out every fact. The model only chooses words, and each number it writes is checked against the fact sheet. A line that fails the check is swapped for the engine's own line, so the fan always gets a correct recap.

**Instant first, AI second.** The template recap renders at once. The AI version replaces it when it arrives. If the model is slow, down or over its limit, the product still works. On a match day that matters more than polish.

**Moments are ranked by impact.** Each moment is scored by the win chance swing it caused. A quiet 3 over squeeze can outrank a six. That is the difference between a recap and a highlight reel.

Win chance here is a small explainable heuristic (runs needed, balls left, wickets in hand). It is a storytelling aid, not odds, and the copy avoids betting language on purpose.

## Run it on your laptop

You need Python 3.10 or newer. Node is only needed if you want to run the engine tests or rebuild.

Windows (PowerShell):

```
cd matchsync
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn server.main:app --port 8000
```

macOS or Linux:

```
cd matchsync
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn server.main:app --port 8000
```

Open http://localhost:8000

Without an API key the app runs fully on the instant narrator. The AI narrator line in the demo controls shows which mode you are in.

### Turn on the AI narrator

Copy `.env.example` to `.env`, fill in two lines, and restart the server.

```
LLM_PROVIDER=anthropic
LLM_API_KEY=your key here
```

| LLM_PROVIDER | Needs | Notes |
| --- | --- | --- |
| anthropic | API key | Default model claude-haiku-4-5-20251001 |
| openai | API key | Default model gpt-4o-mini. Set LLM_MODEL for another, GPT-5 family included |
| groq | API key | Has a free tier |
| gemini | API key | Uses the OpenAI compatible endpoint |
| ollama | Nothing | Local model, run `ollama serve` first |

Default model names for providers other than Anthropic are a starting point. Providers retire models often, so set `LLM_MODEL` to a current model from your provider if a call fails with a model error. `LLM_BASE_URL` points the server at any other OpenAI compatible endpoint.

### Docker

```
docker build -t matchsync .
docker run -p 8000:8000 --env-file .env matchsync
```

### Deploy to Google Cloud Run

The Dockerfile listens on the port Cloud Run provides, so no changes are needed. You need a Google Cloud project with billing enabled. Run this from the project folder, on your laptop with the gcloud CLI or in Cloud Shell in the browser.

```
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud run deploy matchsync --source . --region asia-south1 --allow-unauthenticated --max-instances 1
```

Say yes when gcloud asks to enable the Cloud Run, Cloud Build and Artifact Registry APIs. The command ends by printing the Service URL. That is your public link.

To turn on the AI narrator on the deployed service:

```
gcloud run services update matchsync --region asia-south1 --update-env-vars LLM_PROVIDER=anthropic,LLM_API_KEY=your_key
```

A public link with a key means every visitor's "Catch me up" spends your key. The server caps this with `AI_CALLS_PER_IP_PER_MINUTE` (default 12) and `AI_CALLS_PER_HOUR` (default 600). Set a spend limit with your model provider as well, and delete the service when the review is over with `gcloud run services delete matchsync --region asia-south1`.

The same Dockerfile runs on AWS App Runner, ECS or any other container host. Set the same environment variables there.

### No server at all

Open `dist/matchsync.html` in a browser. It is the whole app in one file and runs on the instant narrator.

## Tests

```
node --test tests/engine.test.js
python -m pytest tests/
```

What they cover:

- The scorecard adds up (batter runs plus extras, bowler figures, over limits).
- The win chance model moves the right way with runs, balls and wickets.
- A fact sheet never uses balls bowled after "now". The test rebuilds the match with the future cut off and compares.
- The opening scenario finds the collapse and the fightback.
- Over 1000 window, side and voice combinations produce clean lines with no ungrounded numbers.
- The number guard keeps good AI lines and replaces bad ones. The browser and the server share the same test cases.
- The server works with no key, drops lines with invented numbers, rejects non JSON replies, and caps AI calls per visitor and per hour.

The AI path is tested with a stubbed model. Run it once with your own key to see real model output.

## Project layout

```
prompts.json          the prompts, single source for browser and server
web/
  index.html          markup
  styles.css          styles, light and dark
  data.js             the match feed (generated)
  engine.js           facts engine
  voices.js           instant narrator and scorecard answers
  guard.js            number guard
  ai.js               AI transport (hosted demo, local server, or none)
  app.js              UI and replay clock
server/
  main.py             FastAPI app: static files, /api/recap, /api/ask, /api/health
  llm.py              provider adapters over plain HTTP
  prompts.py          prompt builders
  guard.py            number guard, server side
scripts/
  make_match.mjs      writes web/data.js from an over by over script
  build.mjs           writes web/prompts.js and dist/matchsync.html
tests/                engine tests (node) and server tests (pytest)
dist/matchsync.html     single file build, the form the hosted demo is published in
```

## Plugging in a real feed

The engine needs one array of ball events. Map your provider to this shape and everything else works unchanged.

```
{ "inn": 2, "over": 13, "n": 4, "legal": true,
  "striker": "Rane", "nonStriker": "Fernandes", "bowler": "Gaikwad",
  "bat": 4, "extras": 0, "extraType": null,
  "wicket": null, "dropped": null, "text": "Gaikwad to Rane, swept fine, FOUR" }
```

`over` counts from 0 and `n` is the legal ball number in the over. `wicket` is `{kind, player, fielder}` and `dropped` is `{fielder, position}` when they apply.

## Limits

- The match is simulated and the teams and players are fictional. I did not want to invent ball by ball data for real players.
- The win chance model is a heuristic, not trained on real matches.
- The number guard checks numbers, not names or claims. A wrong player name with no number would pass.
- The facts engine runs in the browser so the hosted demo needs no backend. In production it would run server side next to the feed.

## What I would do next

1. Push, not pull. Detect a big swing and send one line to fans who are not in the app: "Kings lost 4 for 13. Come back."
2. Cache recaps per match, window bucket, side and voice, so millions of returning fans share a few hundred generations.
3. Make the catch up a shared object in the watch along, so a creator can drop it into chat when viewers ask kya hua.
4. Replace the heuristic with a model trained on ball by ball history, and measure recap quality with fan ratings.
5. More languages. Hindi, Marathi, Tamil, Telugu and Bengali, by voice as well as text.
6. Extend the guard from numbers to names and events.
