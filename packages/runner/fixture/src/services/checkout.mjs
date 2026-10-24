import { listen, json, readBody, startTrace } from '../common/http.mjs';
import { reserveInventory, releaseInventory } from '../clients/inventory.mjs';
import { chargePayment } from '../clients/payments.mjs';

const traces = [];

listen(async (request, response) => {
  if (request.method === 'GET' && request.url === '/_state') return json(response, 200, { traces });
  if (request.method !== 'POST' || request.url !== '/checkout') return json(response, 404, { error: 'Unknown endpoint' });
  const { orderId } = await readBody(request);
  const finish = startTrace(traces, 'checkout', 'checkout', orderId);
  try {
    await reserveInventory(orderId);
    await chargePayment(orderId);
    finish('ok', 'Checkout completed');
    json(response, 200, { orderId, status: 'completed' });
  } catch (error) {
    let released = false;
    try { await releaseInventory(orderId); released = true; } catch { /* Preserve the payment failure in the response. */ }
    finish('error', `${error.message}; inventory ${released ? 'released' : 'release failed'}`);
    json(response, 502, { orderId, error: error.message });
  }
});
