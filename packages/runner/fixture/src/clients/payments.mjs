import { postJson } from '../common/http.mjs';

export function paymentKey(orderId, attempt) {
  return orderId;
}

export async function chargePayment(orderId) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await postJson(`${process.env.PAYMENTS_URL}/charge`, {
        orderId, idempotencyKey: paymentKey(orderId, attempt)
      }, 180);
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}
