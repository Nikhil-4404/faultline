import { listen, json, readBody, startTrace } from '../common/http.mjs';

const ledger = new Map();
const calls = new Map();
const traces = [];

listen(async (request, response) => {
  if (request.method === 'GET' && request.url === '/_state') {
    return json(response, 200, { charges: [...ledger.values()], calls: Object.fromEntries(calls), traces });
  }
  if (request.method !== 'POST' || request.url !== '/charge') {
    return json(response, 404, { error: 'Unknown endpoint' });
  }
  const { orderId, idempotencyKey } = await readBody(request);
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length > 100) throw new Error('Invalid idempotency key');
  const finish = startTrace(traces, 'payments', 'charge', orderId);
  const attempt = (calls.get(orderId) || 0) + 1;
  calls.set(orderId, attempt);
  if (process.env.SCENARIO === 'dependency-down') {
    finish('error', `Attempt ${attempt}: unavailable; no charge committed`);
    return json(response, 503, { error: 'Injected payment outage' });
  }
  const reused = ledger.has(idempotencyKey);
  if (!reused) ledger.set(idempotencyKey, { orderId, idempotencyKey, amount: 100 });
  const detail = `Attempt ${attempt}; key=${idempotencyKey}; ${reused ? 'existing charge reused' : 'new charge committed'}`;
  if (attempt === 1 && process.env.SCENARIO === 'connection-reset') {
    finish('error', `${detail}; acknowledgement socket destroyed`);
    return request.socket.destroy();
  }
  if (attempt === 1 && process.env.SCENARIO === 'latency') {
    response.on('close', () => finish('error', `${detail}; client timed out before acknowledgement`));
    setTimeout(() => {
      if (!response.destroyed) {
        finish('ok', `${detail}; delayed acknowledgement delivered`);
        json(response, 200, { charged: true, reused });
      }
    }, 450);
    return;
  }
  finish('ok', detail);
  json(response, 200, { charged: true, reused });
});
