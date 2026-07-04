# AI Provider Setup — EAS Intelligence Copilot

The Copilot runs **live Anthropic Claude** in production. If no valid key is
configured it falls back to a deterministic expert engine — always visibly, never
silently. This doc is the exact procedure to turn on live Claude on the VM.

> **Never commit a real API key** to the repo, `.env` in git, logs, screenshots,
> or chat. Keys live only in the VM's environment / secret store.

---

## 1. Add the Anthropic key on the VM

Set two environment variables in the VM's environment (systemd unit, container
env, PaaS dashboard, or the app's `.env` file that is **git-ignored**):

```bash
# The app already ignores .env (only .env.example is committed).
ANTHROPIC_API_KEY=<your-real-anthropic-key>     # starts with sk-ant-...
ANTHROPIC_MODEL=claude-opus-4-8                  # confirm this exact value
```

- `ANTHROPIC_API_KEY` — the live key. An **empty** value (`ANTHROPIC_API_KEY=`)
  counts as *not configured* and keeps the app in fallback mode.
- `ANTHROPIC_MODEL=claude-opus-4-8` — the default/high-tier model. Cost controls
  will automatically down-tier simple questions to Sonnet (see `AI_MODEL_SONNET`
  below); Opus is used only for complex engineering / PLC / RCA / multi-document
  reasoning.

Optional cost-control knobs (all have safe defaults — see `.env.example`):

```bash
AI_MODEL_SONNET=claude-sonnet-4-5                # model for normal troubleshooting
AI_MONTHLY_TOKEN_LIMIT_PER_ORG=5000000          # per-org monthly token cap (0 = unlimited)
AI_MONTHLY_USD_LIMIT_PER_ORG=0                   # per-org monthly spend cap USD (0 = unlimited)
AI_KILL_SWITCH=0                                 # set 1 to force fallback everywhere
```

---

## 2. Restart the app

Restart so the new environment is read:

```bash
# systemd
sudo systemctl restart easintelligence

# docker
docker compose restart app        # or: docker restart <container>

# pm2 / node
pm2 restart easintelligence        # or re-run: node .next/standalone/server.js
```

The process reads `ANTHROPIC_API_KEY` at startup and on each request, so a plain
restart is enough.

---

## 3. Check the health endpoint

```bash
curl -s https://<your-domain>/api/health | jq '{aiProviderConfigured, aiProviderName, aiModel, mode, lastProviderError, lastSuccessAt}'
```

### `mode: "live"` — Claude is answering
```json
{
  "aiProviderConfigured": true,
  "aiProviderName": "anthropic",
  "aiModel": "claude-opus-4-8",
  "mode": "live",
  "lastProviderError": null,
  "lastSuccessAt": 1720000000000
}
```
- The Copilot uses live Claude for troubleshooting (Sonnet for normal questions,
  Opus for complex ones).
- The amber "Live AI provider not configured" banner is **gone**.
- `lastSuccessAt` updates after each successful live answer.

### `mode: "fallback"` — deterministic engine
```json
{
  "aiProviderConfigured": false,
  "aiProviderName": "deterministic-fallback",
  "aiModel": null,
  "mode": "fallback",
  "lastProviderError": null
}
```
- No live key set (or `AI_KILL_SWITCH=1`, or the org hit its monthly limit).
- The Copilot still returns the full expert format (Answer → What it means →
  Likely causes → Check first → Safety → Next action → Sources → Confidence) and
  answers known fault codes directly (e.g. **F004 UnderVoltage**) — but without
  live LLM reasoning on open-ended questions.
- The amber admin banner is shown.

You can also see this in-app: **Team & Roles → AI Provider Status** (admins).

---

## 4. Verify after adding the real key

1. `curl .../api/health` shows `aiProviderConfigured:true`, `aiProviderName:"anthropic"`,
   `aiModel:"claude-opus-4-8"`, `mode:"live"`.
2. Open the Copilot — the amber fallback banner is gone.
3. Ask: **"What code is under voltage for a PowerFlex drive?"** → the answer
   starts with the direct answer (**F004 — UnderVoltage**), then citations below.
4. Ask an open-ended question (e.g. "why would this line trip only on cold
   mornings?") — the answer badge shows **Anthropic (Claude)**, not
   *Deterministic fallback*.

---

## 5. Troubleshooting

| Symptom | Health shows | Cause | Fix |
|---|---|---|---|
| Banner still shows fallback | `aiProviderConfigured:false`, `mode:"fallback"` | Key missing or empty | Set `ANTHROPIC_API_KEY` to the real value; restart. |
| Answers are deterministic despite a key | `mode:"live"`, `lastProviderError:"401 … invalid x-api-key"` | Invalid/expired key | Replace with a valid key; restart. `lastProviderError` clears on the next success. |
| Intermittent fallback | `lastProviderError` populated (429, 5xx, timeout) | Rate limit / provider outage | Transient — the app auto-falls back per request and retries live on the next call. Check Anthropic status / rate limits. |
| Everything forced to fallback | `mode:"fallback"` with a key set | `AI_KILL_SWITCH=1` **or** the org hit its monthly limit | Unset `AI_KILL_SWITCH`, or raise `AI_MONTHLY_TOKEN_LIMIT_PER_ORG`, or wait for the month to roll over. |
| Wrong model | `aiModel` unexpected | `ANTHROPIC_MODEL` not set to `claude-opus-4-8` | Set it exactly; restart. |

**Never** paste a real key into a support ticket, screenshot, or chat. Rotate the
key immediately if it is ever exposed.
