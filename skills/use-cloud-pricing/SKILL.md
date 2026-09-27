---
name: use-cloud-pricing
description: "Use when the user asks about cloud compute prices: AWS/GCP/Azure spot or on-demand prices, reserved-instance costs, the price of an instance type over time, GPU rental prices (H100, H200, B200, A100, L40S, 4090) across RunPod, Vast.ai, Lambda, Nebius, CoreWeave and others, cheapest place to rent a GPU, spot-vs-on-demand discounts, or a GPU price index. Triggers on: spot price, GPU price, GPU-hour, H100 cost, cheapest GPU, reserved instance price, on-demand price, cloud pricing history, CX. ticker."
---

# Use the corpusAI Cloud Pricing API

Prices for cloud compute, GPUs and LLM tokens. No account needed: pay per call over x402 (USDC via Circle Gateway, or Coinbase's facilitator on Base) or MPP (USDC on Tempo), or use a prepaid key. This package's tools pay over x402 from a Circle Gateway balance. Base URL `https://cloud.trycorpus.ai/v1`; OpenAPI at `/openapi.json`; docs at `/docs.md`; methodology at `/methodology.md`.

## Workflow

1. Free discovery first: `GET /v1/catalog` (regions, coverage, prices), `GET /v1/instances?provider=&region=`, `GET /v1/gpu/models`, `GET /v1/index/tickers`, `GET /v1/status` (freshness).
2. Pick the smallest paid call that answers the question:
   - one instance's price history → `/v1/spot/daily` (0.05) or `/v1/spot/events` (0.01, raw events)
   - what it costs right now per zone → `/v1/spot/latest` (0.01)
   - a whole region at once → `/v1/spot/snapshot` (0.10)
   - on-demand or reserved → `/v1/ondemand`, `/v1/reserved` (0.01)
   - GPU rental across providers → `/v1/gpu/quotes?gpu=H100 SXM` (0.01); the citable number → `/v1/index/fixing?ticker=CX.H100SXM.NEO` (0.01); history → `/v1/index/history` (0.05)
   - how tight is GPU supply right now → `capacity_stress` / `/v1/capacity/stress?gpu=H100 SXM` (0.01), all models → `capacity_board` (0.10)
   - LLM token price per million tokens → `tokens_fixing` / `/v1/tokens/fixing?ticker=CX.TOK.CLAUDESONNET5.IN` (0.01); every host's price → `tokens_quotes` (0.01); list models free with `tokens_models`
   - spot vs on-demand vs 1y/3y commitment (discount curve) → `term_instance` / `/v1/term/instance` (0.01), per GPU across clouds → `term_curve` (named `term` on the hosted server) / `/v1/term?gpu=` (0.05)
3. Pay: an unpaid call returns HTTP 402 with x402 v2 requirements (PAYMENT-REQUIRED header and JSON body, one offer per accepted network) and an MPP challenge. With the Circle CLI: `circle services pay "<url>" -X GET --address <wallet> --chain <chain> --max-amount 0.10 --output json`. With this MCP server installed, the paid tools pay automatically when `CORPUS_PAYER_KEY` is set. With a prepaid key, send it as `X-Api-Key` to the API, or as `Authorization: Bearer ck_…` to the hosted MCP server at `https://cloud.trycorpus.ai/mcp`.
4. Report prices in USD per hour (per GPU-hour for /gpu and /index), name the segment or provider, and cite the fixing's methodology version when quoting an index.

## Gotchas

- `region` and `instance` must match the catalog exactly (Azure regions use slugs like `us-east`).
- Only `direct` rows carry zones and intraday timing; `titans` rows are daily averages; `archive` rows are third-party.
- SPOT index fixings are for finished UTC days (latest is yesterday); quote segments fix on the snapshot day.
- 400 and 404 responses are never charged; a 503 means the store is warming up.
