import { postJson } from '../common/http.mjs';

export async function reserveInventory(orderId) {
  return postJson(`${process.env.INVENTORY_URL}/reserve`, { orderId });
}

export async function releaseInventory(orderId) {
  return postJson(`${process.env.INVENTORY_URL}/release`, { orderId });
}
