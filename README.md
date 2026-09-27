# corpus-cloud-pricing-mcp

MCP server (stdio) for [corpusAI Cloud Pricing](https://cloud.trycorpus.ai/docs): AWS, GCP and Azure spot price history at event resolution, on-demand and reserved list prices, GPU rental quotes from neo-clouds and marketplaces, LLM token prices, and daily index fixings per GPU and segment (`CX.H100SXM.NEO`, `CX.H100SXM.SPOT`, ...). Free tools need nothing. Paid tools pay per call in USDC over x402 through Circle Gateway, from a wallet you configure.

The API also takes MPP (USDC on Tempo) and prepaid keys. To use a prepaid key from an agent, connect to the hosted MCP server at `https://cloud.trycorpus.ai/mcp` instead of this package (see [the docs](https://cloud.trycorpus.ai/docs#quick-start-for-agents)).

## Install

Claude Code:

```
claude mcp add corpus-cloud-pricing -e CORPUS_PAYER_KEY=0x... -- npx -y corpus-cloud-pricing-mcp
```

Claude Desktop, Cursor or any MCP client (`mcp.json`):

```json
{
  "mcpServers": {
    "corpus-cloud-pricing": {
      "command": "npx",
      "args": ["-y", "corpus-cloud-pricing-mcp"],
      "env": { "CORPUS_PAYER_KEY": "0x...", "CORPUS_CHAIN": "base", "CORPUS_MAX_USDC": "0.10" }
    }
  }
}
```

Without `CORPUS_PAYER_KEY` the free tools work and the paid tools return the price and accepted networks instead of data.

## Paying

Paid calls are settled gaslessly from a Circle Gateway USDC balance held by the payer wallet. Fund it once:

```
CORPUS_PAYER_KEY=0x... npx corpus-cloud-pricing-mcp balance
CORPUS_PAYER_KEY=0x... CORPUS_CHAIN=base npx corpus-cloud-pricing-mcp deposit 2.00   # needs USDC and a little gas on that chain
```

`CORPUS_CHAIN` takes a Circle Gateway chain name as the Gateway SDK spells it (`base`, `ethereum`, `arbitrum`, `worldChain`, `hyperEvm`, ...). `CORPUS_MAX_USDC` (default 0.10) refuses any single call priced above it. Prices: 0.01 USDC for single-type or single-fixing calls, 0.05 for full histories, 0.10 for region or market snapshots.

## Tools

Free: `catalog`, `instances`, `gpu_models`, `index_tickers`, `status`, `tokens_models`.
Paid: `spot_daily`, `spot_hourly`, `spot_events`, `spot_latest`, `spot_snapshot`, `spot_monthly`, `ondemand`, `reserved`, `gpu_quotes`, `gpu_index`, `index_fixing`, `index_history`, `index_board`, `term_instance`, `term_curve`, `tokens_quotes`, `tokens_fixing`, `tokens_history`, `tokens_board`, `capacity_stress`, `capacity_history`, `capacity_board`.

The hosted server generates its tools from the OpenAPI document, so its set is larger and a few names differ (its GPU term structure tool is `term`, where this package says `term_curve`).

Methodology for the index fixings: https://cloud.trycorpus.ai/methodology. Data license: https://cloud.trycorpus.ai/license. Contact: hello@trycorpus.ai.
