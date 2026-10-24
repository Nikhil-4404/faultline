import { createServer } from 'node:http';

export async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) throw new Error('Request body too large');
  }
  const value = JSON.parse(body);
  if (!value || !/^order-\d{4}$/.test(value.orderId)) throw new Error('Invalid order ID');
  return value;
}

export function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

export function listen(handler) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      if (!response.headersSent && !response.destroyed) json(response, 400, { error: error.message });
      else response.destroy();
    });
  });
  server.requestTimeout = 2000;
  server.headersTimeout = 3000;
  server.listen(0, '127.0.0.1', () => {
    process.send?.({ type: 'ready', port: server.address().port });
  });
  // The IPC pipe closes when the coordinator exits, including an unexpected crash.
  process.once('disconnect', () => {
    server.close();
    server.closeAllConnections();
    process.exit(0);
  });
}

export async function postJson(url, value, timeout = 1500) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value), signal: AbortSignal.timeout(timeout)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

export function startTrace(traces, service, operation, requestId) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let recorded = false;
  return (status, detail) => {
    if (recorded) return;
    recorded = true;
    traces.push({ requestId, service, operation, startedAt,
      durationMs: Math.round((performance.now() - started) * 100) / 100, status, detail });
  };
}
