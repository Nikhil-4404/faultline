import { listen, json, readBody, startTrace } from '../common/http.mjs';

const reservations = new Set();
const traces = [];

listen(async (request, response) => {
  if (request.method === 'GET' && request.url === '/_state') {
    return json(response, 200, { reservations: [...reservations], traces });
  }
  if (request.method !== 'POST' || !['/reserve', '/release'].includes(request.url)) {
    return json(response, 404, { error: 'Unknown endpoint' });
  }
  const { orderId } = await readBody(request);
  const finish = startTrace(traces, 'inventory', request.url.slice(1), orderId);
  if (request.url === '/reserve') reservations.add(orderId);
  else reservations.delete(orderId);
  finish('ok', request.url === '/reserve' ? 'Inventory reserved once per order' : 'Reservation released after payment failure');
  json(response, 200, { reserved: reservations.has(orderId) });
});
