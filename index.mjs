#!/usr/bin/env node
// corpus-cloud-pricing-mcp: MCP server (stdio) for corpusAI Cloud Pricing,
// https://cloud.trycorpus.ai
//
// Free tools call the API directly. Paid tools pay per call in USDC over
// x402 through Circle Gateway when CORPUS_PAYER_KEY is set; without a key
// they return the 402 payment requirements so the agent (or its operator)
// can see the price and the accepted networks. Prepaid keys and MPP are
// served by the hosted server (https://cloud.trycorpus.ai/mcp) and the API.
//
// Env:
//   CORPUS_PAYER_KEY   0x-prefixed EVM private key of a wallet with a Circle Gateway balance
//   CORPUS_CHAIN       Gateway chain name for signing (default base; also polygon, arbitrum, ethereum, avalanche, optimism, unichain, sonic, worldChain, sei, hyperEvm, arc)
//   CORPUS_MAX_USDC    refuse any single call priced above this (default 0.10)
//   CORPUS_BASE_URL    API base (default https://cloud.trycorpus.ai)
//
//   corpus-cloud-pricing-mcp            # run the MCP server on stdio
//   corpus-cloud-pricing-mcp balance    # print the payer wallet's USDC and Gateway balances
//   corpus-cloud-pricing-mcp deposit 1  # move 1 USDC from the wallet into its Gateway balance (gas on the chain)
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const UA = `corpus-cloud-pricing-mcp/${VERSION}`;

const BASE = (process.env.CORPUS_BASE_URL || 'https://cloud.trycorpus.ai').replace(/\/$/, '');
const KEY = process.env.CORPUS_PAYER_KEY || '';
const CHAIN = process.env.CORPUS_CHAIN || 'base';
const MAX_USDC = +(process.env.CORPUS_MAX_USDC || '0.10');

let gateway = null;
async function payer() {
  if (!KEY) return null;
  if (!gateway) {
    const { GatewayClient } = await import('@circle-fin/x402-batching/client');
    gateway = new GatewayClient({ chain: CHAIN, privateKey: KEY });
  }
  return gateway;
}

function url(path, params) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
}

async function getFree(path, params) {
  const res = await fetch(url(path, params), { headers: { accept: 'application/json', 'user-agent': UA } });
  const text = await res.text();
  return { status: res.status, body: text };
}

/** Paid call: pay through Gateway when a key is present, otherwise surface the 402. */
async function getPaid(path, params) {
  const target = url(path, params);
  const probe = await fetch(target, { headers: { accept: 'application/json', 'user-agent': UA } });
  if (probe.status !== 402) return { status: probe.status, body: await probe.text() };
  const req = await probe.json().catch(() => null);
  const cheapest = req && req.accepts ? Math.min(...req.accepts.map((a) => +a.amount)) / 1e6 : null;
  if (cheapest != null && cheapest > MAX_USDC) return { status: 402, body: JSON.stringify({ error: `price ${cheapest} USDC exceeds CORPUS_MAX_USDC ${MAX_USDC}`, requirements: req }) };
  const gw = await payer();
  if (!gw) return { status: 402, body: JSON.stringify({ error: 'no payer key: set CORPUS_PAYER_KEY to a wallet with a Circle Gateway USDC balance', price_usdc: cheapest, networks: req ? req.accepts.map((a) => a.network) : [], docs: `${BASE}/docs` }) };
  const r = await gw.pay(target);
  return { status: r.status, body: typeof r.data === 'string' ? r.data : JSON.stringify(r.data), paid_usdc: r.formattedAmount, transaction: r.transaction };
}

const text = (r) => ({ content: [{ type: 'text', text: (r.paid_usdc ? `[paid ${r.paid_usdc} USDC, tx ${r.transaction}]\n` : '') + r.body }], isError: r.status >= 400 });

const provider = z.enum(['aws', 'gcp', 'azure']).describe('Cloud provider');
const region = z.string().describe('Region slug from the catalog tool (e.g. us-east-1, us-central1, us-east)');
const instance = z.string().describe('Instance type exactly as listed by the instances tool (e.g. c5.large)');
const from = z.string().optional().describe('Start, ISO 8601 UTC');
const to = z.string().optional().describe('End, ISO 8601 UTC');

const TOOLS = [
  // free
  ['catalog', 'Free. Providers, region slugs, coverage windows, prices per call and the source legend. Call first.', {}, '/v1/catalog', false],
  ['instances', 'Free. Instance types available in a region with coverage dates.', { provider, region, prefix: z.string().optional().describe('Type-name prefix filter, e.g. c5.') }, '/v1/instances', false],
  ['gpu_models', 'Free. Normalized GPU model names with quote counts and providers.', {}, '/v1/gpu/models', false],
  ['index_tickers', 'Free. Every index ticker (CX.<MODEL>.<SEGMENT>) with segment definitions and the methodology version.', {}, '/v1/index/tickers', false],
  ['status', 'Free. Freshness of every data source.', {}, '/v1/status', false],
  // paid
  ['spot_daily', 'Paid (0.05 USDC). Full daily spot price history of one instance type, all eras, source per row.', { provider, region, instance, from, to }, '/v1/spot/daily', true],
  ['spot_hourly', 'Paid (0.01 USDC). Hourly time-weighted OHLC spot bars for one instance type.', { provider, region, instance, from, to }, '/v1/spot/hourly', true],
  ['spot_events', 'Paid (0.01 USDC). Raw spot price-change events for one instance type with zone and timestamp.', { provider, region, instance, from, to, limit: z.number().int().optional() }, '/v1/spot/events', true],
  ['spot_latest', 'Paid (0.01 USDC). Current spot price per zone for one instance type.', { provider, region, instance }, '/v1/spot/latest', true],
  ['spot_snapshot', 'Paid (0.10 USDC). Current spot price of every type and zone in a region.', { provider, region }, '/v1/spot/snapshot', true],
  ['spot_monthly', 'Paid (0.05 USDC). Monthly spot history back to 2014 for legacy AWS types.', { provider, region, instance }, '/v1/spot/monthly', true],
  ['ondemand', 'Paid (0.01 USDC). On-demand list-price change history of one instance type.', { provider, region, instance }, '/v1/ondemand', true],
  ['reserved', 'Paid (0.01 USDC). AWS reserved-instance effective hourly price history (1y/3y, no/all upfront).', { region, instance, ri_type: z.string().optional() }, '/v1/reserved', true],
  ['gpu_quotes', 'Paid (0.01 USDC). Latest GPU rental quotes for one model across neo-clouds and marketplaces, USD per GPU-hour.', { gpu: z.string().describe('Model from gpu_models, e.g. "H100 SXM"'), provider: z.string().optional(), market: z.string().optional() }, '/v1/gpu/quotes', true],
  ['gpu_index', 'Paid (0.05 USDC). Daily lo/median/mean/hi per provider and market for one GPU model, with aws-spot and gcp-spot legs.', { gpu: z.string(), from: z.string().optional(), to: z.string().optional() }, '/v1/gpu/index', true],
  ['index_fixing', 'Paid (0.01 USDC). One day\'s index fixing for a ticker such as CX.H100SXM.NEO (median USD per GPU-hour, lo, hi, n).', { ticker: z.string(), day: z.string().optional().describe('YYYY-MM-DD') }, '/v1/index/fixing', true],
  ['index_history', 'Paid (0.05 USDC). Daily fixings for a ticker; SPOT tickers reach back to 2022.', { ticker: z.string(), from: z.string().optional(), to: z.string().optional() }, '/v1/index/history', true],
  ['index_board', 'Paid (0.10 USDC). Every ticker\'s fixing for one day.', { day: z.string().optional() }, '/v1/index/board', true],
  ['capacity_stress', 'Paid (0.01 USDC). Capacity stress score for one GPU model on one day, 0 (slack) to 100 (tight), with every component (availability, io.net units, Vast supply, spot-to-on-demand ratio).', { gpu: z.string(), day: z.string().optional() }, '/v1/capacity/stress', true],
  ['capacity_history', 'Paid (0.05 USDC). Daily capacity stress scores for one GPU model.', { gpu: z.string(), from: z.string().optional(), to: z.string().optional() }, '/v1/capacity/history', true],
  ['capacity_board', 'Paid (0.10 USDC). Every GPU model\'s capacity stress score for one day, tightest first.', { day: z.string().optional() }, '/v1/capacity/board', true],
  ['tokens_models', 'Free. Every LLM with a token price fixing: canonical slug, ticker codes, sources, hosts and today\'s price range, plus the frontier basket.', {}, '/v1/tokens/models', false],
  ['tokens_quotes', 'Paid (0.01 USDC). Every source and host\'s price for one model on one day, USD per million input/output tokens.', { model: z.string().describe('Canonical slug from tokens_models, e.g. "claude-sonnet-5"'), day: z.string().optional() }, '/v1/tokens/quotes', true],
  ['tokens_fixing', 'Paid (0.01 USDC). One day\'s token price fixing for CX.TOK.<MODEL>.IN, .OUT or .BLEND, or CX.TOK.FRONTIER.<side>.', { ticker: z.string(), day: z.string().optional() }, '/v1/tokens/fixing', true],
  ['tokens_history', 'Paid (0.05 USDC). Daily fixings for a token ticker.', { ticker: z.string(), from: z.string().optional(), to: z.string().optional() }, '/v1/tokens/history', true],
  ['tokens_board', 'Paid (0.10 USDC). Every model\'s input, output and blended fixing for one day plus the frontier basket.', { day: z.string().optional() }, '/v1/tokens/board', true],
  ['term_instance', 'Paid (0.01 USDC). Price ladder for one instance type: spot, on-demand, 1-year and 3-year commitments with discount to on-demand.', { provider, region, instance }, '/v1/term/instance', true],
  ['term_curve', 'Paid (0.05 USDC). Term structure per hyperscaler for one GPU model, USD per GPU-hour: spot, on-demand, 1y, 3y with discounts.', { gpu: z.string().describe('Model with a hyperscaler mapping, e.g. "H100 SXM", "T4"') }, '/v1/term', true],
];

/** Price range of the paid tools, read from their descriptions ("Paid (0.05 USDC)."). */
function priceRange() {
  const p = TOOLS.map(([, d]) => +((/^Paid \((\d+(?:\.\d+)?) USDC\)/.exec(d) || [])[1])).filter((v) => v > 0);
  return p.length ? [Math.min(...p), Math.max(...p)].map((v) => v.toFixed(2)) : null;
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'balance' || cmd === 'deposit') {
    const gw = await payer();
    if (!gw) { console.error('set CORPUS_PAYER_KEY'); process.exit(1); }
    if (cmd === 'balance') { const b = await gw.getBalances(); console.log(JSON.stringify({ address: gw.address, chain: CHAIN, wallet_usdc: b.wallet.formatted, gateway_available: b.gateway.formattedAvailable }, null, 2)); return; }
    const amount = process.argv[3]; if (!amount) { console.error('usage: deposit <usdc amount>'); process.exit(1); }
    const r = await gw.deposit(amount); console.log(JSON.stringify({ deposited: r.formattedAmount, tx: r.depositTxHash }, null, 2)); return;
  }
  const range = priceRange();
  const instructions = `corpusAI Cloud Pricing: spot, on-demand, reserved, GPU rental and LLM token prices with index fixings. Call catalog / gpu_models / index_tickers first (free), then the paid tools; each paid call costs ${range ? `${range[0]} to ${range[1]} USDC` : 'a few cents in USDC'}, paid over x402 from the Circle Gateway balance of CORPUS_PAYER_KEY${KEY ? ' automatically' : ' (no payer key configured: paid tools return the price and accepted networks instead of data)'}. To pay with a prepaid key or over MPP instead, use the hosted server at ${BASE}/mcp or the API directly. Docs: ${BASE}/docs, methodology: ${BASE}/methodology.md.`;
  const server = new McpServer({ name: 'corpus-cloud-pricing', title: 'corpusAI Cloud Pricing', version: VERSION, websiteUrl: `${BASE}/docs` }, { instructions });
  for (const [name, description, shape, path, paid] of TOOLS) {
    server.tool(name, description, shape, async (params) => text(paid ? await getPaid(path, params) : await getFree(path, params)));
  }
  await server.connect(new StdioServerTransport());
}
main().catch((e) => { console.error(e); process.exit(1); });
