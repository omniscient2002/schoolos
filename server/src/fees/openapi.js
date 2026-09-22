/* Fees read-plane OpenAPI (FEE-API-6).
 *
 * The money REST surface had no machine-readable contract, so an integrator read prose. This is the
 * read-plane document (the list/detail doors the desk, parents and students consume). It is plain data so a
 * test can "build" it in CI without a bundler, and it is the single source a client generator reads.
 */
export const FEES_OPENAPI = Object.freeze({
  openapi: '3.1.0',
  info: {
    title: 'SchoolOS Fees read plane',
    version: '1.0.0',
    description: 'Read models for the fee ledger, payments, receipts, plans, heads, installments and concessions. Every error carries a `code` from the money catalogue.',
  },
  servers: [{ url: '/' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      MoneyCents: { type: 'string', pattern: '^[0-9]+$', description: 'Integer paise as a string (bigint) — never a float.' },
      Pagination: {
        type: 'object',
        properties: { limit: { type: 'integer' }, offset: { type: 'integer' }, hasMore: { type: 'boolean' } },
      },
      Error: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string' }, code: { type: 'string', description: 'A code from the money error catalogue.' } },
      },
      FeeHead: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, category: { type: ['string', 'null'] },
          is_refundable: { type: 'boolean' }, tax_code: { type: ['string', 'null'] }, gl_ledger_name: { type: ['string', 'null'] },
          active: { type: 'boolean' }, obligations: { type: 'integer' },
        },
      },
      FeePlan: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, grades: { type: 'array', items: { type: 'string' } },
          terms: { type: 'array', items: { type: 'object' } }, fee_head_id: { type: ['string', 'null'], format: 'uuid' },
          installments: { type: ['array', 'null'], items: { type: 'object' } },
          obligations_generated: { type: 'integer' }, last_generated_at: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      Obligation: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, student_id: { type: 'string', format: 'uuid' },
          fee_head_id: { type: ['string', 'null'], format: 'uuid' }, term: { type: 'string' }, label: { type: 'string' },
          due_on: { type: ['string', 'null'], format: 'date' }, amount_cents: { $ref: '#/components/schemas/MoneyCents' },
          concession_cents: { $ref: '#/components/schemas/MoneyCents' }, waived_cents: { $ref: '#/components/schemas/MoneyCents' },
          net_amount_cents: { $ref: '#/components/schemas/MoneyCents' }, paid_cents: { $ref: '#/components/schemas/MoneyCents' },
          status: { type: 'string', enum: ['open', 'partial', 'paid', 'void'] },
        },
      },
      Payment: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, student_id: { type: 'string', format: 'uuid' },
          obligation_id: { type: ['string', 'null'], format: 'uuid' }, amount_cents: { $ref: '#/components/schemas/MoneyCents' },
          refunded_cents: { $ref: '#/components/schemas/MoneyCents' },
          method: { type: 'string' }, status: { type: 'string', enum: ['created', 'initiated', 'confirmed', 'failed', 'refunded'] },
          gateway_ref: { type: ['string', 'null'] }, receipt_no: { type: ['string', 'null'] },
          settled_via: { type: ['string', 'null'], enum: ['gateway', 'manual', 'auto', null] },
          reconciliation_status: { type: 'string', enum: ['unreconciled', 'matched', 'manual', 'disputed'] },
        },
      },
      Receipt: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, receipt_no: { type: 'string' }, payment_id: { type: 'string', format: 'uuid' },
          student_id: { type: 'string', format: 'uuid' }, amount_cents: { $ref: '#/components/schemas/MoneyCents' },
          issued_at: { type: 'string', format: 'date-time' }, voided_at: { type: ['string', 'null'], format: 'date-time' },
          pdf_file_id: { type: ['string', 'null'], format: 'uuid' },
        },
      },
      Installment: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, obligation_id: { type: 'string', format: 'uuid' }, seq: { type: 'integer' },
          due_on: { type: ['string', 'null'], format: 'date' }, amount_cents: { $ref: '#/components/schemas/MoneyCents' },
          status: { type: 'string', enum: ['pending', 'paid', 'overdue', 'waived'] }, payment_id: { type: ['string', 'null'], format: 'uuid' },
        },
      },
      Concession: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, student_id: { type: 'string', format: 'uuid' },
          obligation_id: { type: ['string', 'null'], format: 'uuid' }, kind: { type: 'string', enum: ['concession', 'scholarship', 'sibling', 'staff', 'waiver'] },
          percent: { type: ['number', 'null'] }, amount_cents: { type: ['string', 'null'] },
          status: { type: 'string', enum: ['requested', 'approved', 'rejected', 'active', 'expired'] },
        },
      },
    },
    responses: {
      Forbidden: { description: 'Role/mask refusal', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      NotFound: { description: 'Not found (also used to keep existence private)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/fees/heads': {
      get: {
        summary: 'List fee heads',
        responses: {
          200: { description: 'Heads', content: { 'application/json': { schema: { type: 'object', properties: { feeHeads: { type: 'array', items: { $ref: '#/components/schemas/FeeHead' } } } } } } },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/fee-plans': {
      get: {
        summary: 'List plan templates',
        responses: {
          200: { description: 'Plans', content: { 'application/json': { schema: { type: 'object', properties: { feePlans: { type: 'array', items: { $ref: '#/components/schemas/FeePlan' } } } } } } },
        },
      },
    },
    '/fees/obligations': {
      get: {
        summary: 'List obligations (parent/student scoped)',
        responses: {
          200: { description: 'Obligations', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/Pagination' }, { type: 'object', properties: { obligations: { type: 'array', items: { $ref: '#/components/schemas/Obligation' } } } }] } } } },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/fees/installments': {
      get: {
        summary: 'List installments (parent/student scoped)',
        responses: {
          200: { description: 'Installments', content: { 'application/json': { schema: { type: 'object', properties: { installments: { type: 'array', items: { $ref: '#/components/schemas/Installment' } } } } } } },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/payments': {
      get: {
        summary: 'List payments (parent scoped)',
        responses: {
          200: { description: 'Payments', content: { 'application/json': { schema: { type: 'object', properties: { payments: { type: 'array', items: { $ref: '#/components/schemas/Payment' } } } } } } },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/fees/receipts': {
      get: {
        summary: 'List receipts (parent scoped)',
        responses: {
          200: { description: 'Receipts', content: { 'application/json': { schema: { type: 'object', properties: { receipts: { type: 'array', items: { $ref: '#/components/schemas/Receipt' } } } } } } },
        },
      },
    },
    '/fees/receipts/{id}': {
      get: {
        summary: 'One receipt (includes pdf_file_id)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Receipt', content: { 'application/json': { schema: { type: 'object', properties: { receipt: { $ref: '#/components/schemas/Receipt' } } } } } },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/fees/concessions': {
      get: {
        summary: 'List concessions',
        responses: {
          200: { description: 'Concessions', content: { 'application/json': { schema: { type: 'object', properties: { concessions: { type: 'array', items: { $ref: '#/components/schemas/Concession' } } } } } } },
        },
      },
    },
    '/fees/entitlements': {
      get: {
        summary: 'Fee feature availability for the tenant plan',
        responses: {
          200: { description: 'Availability', content: { 'application/json': { schema: { type: 'object', properties: { plan: { type: 'string' }, features: { type: 'object' } } } } } },
        },
      },
    },
    '/fees/delivery': {
      get: {
        summary: 'Fee-message delivery status',
        responses: { 200: { description: 'Delivery rows' }, 403: { $ref: '#/components/responses/Forbidden' } },
      },
    },
    '/student/fees': {
      get: {
        summary: "A student's own dues/payments/receipts",
        responses: { 200: { description: 'Self-scoped fee view' } },
      },
    },
  },
});
