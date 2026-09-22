// payments.razorpay — plugin manifest (drop-in factory, docs/11 §2.2).
// Mirrors payments.upi (Class B, T2, money-touching): orders + signed-webhook
// FACTS only — settlement stays kernel-only (staff confirm, Fees §4.2).
export default {
  id: 'payments.razorpay',
  capabilities: ['fees.razorpay.gateway'],
  name: 'Razorpay Order Rails',
  version: '1.0.0',
  class: 'B',
  trust: 'T2',
  description: 'Razorpay order rails for fee collection: gateway orders against open fee obligations (REST, Basic auth) + signed-webhook facts in plugin_razorpay.order_log. Money-touching: never auto-moves money — orders and webhook facts only; settlement confirm is staff-only through the kernel action spine (fee.payment.settle, Fees §4.2). Degrades gracefully when unconfigured: the orders door answers 503 with operator guidance instead of half-creating gateway state.',
  permissions: ['fees.read', 'events.emit', 'audit.request'],
  events: { subscribe: ['fee.due'], publish: ['razorpay.order.created', 'payment.captured', 'payment.failed'] },
  slots: ['settings', 'reports'],
  routes: [],
  widgets: [],
  settings_schema: {
    type: 'object',
    properties: {
      key_id: { type: 'string', description: 'Razorpay key id (rzp_test_/rzp_live_…) — falls back to RAZORPAY_KEY_ID env' },
      key_secret: { type: 'string', description: 'Razorpay key secret — falls back to RAZORPAY_KEY_SECRET env; secret-class, never surfaced' },
      webhook_secret: { type: 'string', description: 'webhook HMAC secret — falls back to RAZORPAY_WEBHOOK_SECRET env (boot-guard parity with payments.upi); secret-class' },
      webhook_freshness_mins: { type: 'integer', minimum: 1, maximum: 60, default: 15, description: 'reject webhook events older than this (stale-replay defense)' },
    },
    required: [],
  },
  data: { schema: 'plugin_razorpay.order_log + plugin_razorpay.webhook_log', core_refs: ['payments.id', 'fee_obligations.id'], retention: { on_uninstall: 'export_then_purge_30d' }, residency: ['IN'] },
  regions: ['IN'],
  residency: 'IN',
  billing: { model: 'rails', metered: ['orders_created', 'webhooks_received'] },
  dependencies: [],
  policy_refs: ['Fees §4.2'],
};
