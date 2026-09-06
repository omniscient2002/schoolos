// payments.upi — plugin manifest (drop-in factory, docs/11 §2.2)
export default {
  id: 'payments.upi',
  name: 'UPI Collection Rails',
  version: '1.0.0',
  class: 'B',
  trust: 'T2',
  description: 'UPI payment links + signed gateway webhook facts. Settlement stays kernel-only (staff confirm on /fees/payments/:id/confirm, Fees §4.2); the rail never moves money.',
  permissions: ['fees.read', 'events.emit', 'audit.request'],
  events: { subscribe: ['fee.due'], publish: ['payment.link.created', 'payment.captured', 'payment.failed'] },
  slots: ['settings', 'reports'],
  routes: [],
  widgets: [],
  settings_schema: {
    type: 'object',
    properties: {
      gateway: { type: 'string', enum: ['razorpay', 'cashfree', 'phonepe'], default: 'razorpay' },
      webhook_secret_configured: { type: 'boolean', description: 'set via UPI_WEBHOOK_SECRET env; never stored here' },
      default_vpa: { type: 'string', description: 'school VPA for upi:// intent links' },
    },
    required: ['gateway'],
  },
  data: { schema: 'plugin_upi.webhook_log', core_refs: ['fee_obligations.id', 'payments.id'], retention: { on_uninstall: 'export_then_purge_30d' }, residency: ['IN'] },
  regions: ['IN'],
  residency: 'IN',
  billing: { model: 'rails', metered: ['links_created', 'webhooks_received'] },
  dependencies: [],
  policy_refs: ['Fees §4.2'],
};
