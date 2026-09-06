// accounting.tally — Tally reconciliation rails (Class B, read-only on money).
// Day-book + voucher export from the kernel fee ledger (app.payments, status
// 'confirmed'). The plugin READS money and exports — it NEVER posts: every door
// here is SELECT-only; the only writes are the plugin's own audit entries.
// Voucher totals are computed from the same GROUP BY that renders the vouchers,
// so voucher_totals_match_ledger holds by construction (009 invariant).
// Decoupled: zero kernel logic — mounts its own doors only (docs/11 §2.3).
const ID = 'accounting.tally';
export { default as manifest } from './manifest.js';

// Tally 4.1 voucher XML for a receipt (importable via Gateway of Tally → Import)
function voucherXml(v, companyName) {
  const d = v.confirmed_at ?? v.created_at;
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const amt = (v.amount_cents / 100).toFixed(2);
  const ledger = v.ledger_name ?? 'Fee Income';
  const party = v.ledger_party ?? 'Sundry Debtors';
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>` +
    `<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>` +
    `<STATICVARIABLES><SVCOMPANYNAME>${companyName}</SVCOMPANYNAME></STATICVARIABLES></REQUESTDESC>` +
    `<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">` +
    `<DATE>${day}</DATE><NARRATION>SchoolOS ${v.receipt_no ?? v.id} · student ${v.student_id ?? 'n/a'} · ref ${v.gateway_ref ?? 'counter'}</NARRATION>` +
    `<VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>` +
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${ledger}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${amt}</AMOUNT></ALLLEDGERENTRIES.LIST>` +
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${party}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amt}</AMOUNT></ALLLEDGERENTRIES.LIST>` +
    `</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

export function register(app, kernel) {
  const { withUser, auditLog, requestAudit, require } = kernel;

  // ── Day-book: confirmed money for a date window, voucher-ready ────────────────
  app.get('/plugins/accounting.tally/daybook', { preHandler: require('owner', 'itadmin', 'finance') }, async (req, reply) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.from ?? '') ? req.query.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.to ?? '') ? req.query.to : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT p.id, p.receipt_no, p.amount_cents, p.method, p.gateway_ref, p.status,
                p.student_id, p.confirmed_at, p.created_at,
                COALESCE(lm.co->>'name', 'Fee Income') AS ledger_name,
                COALESCE(lm.co->>'party', 'Sundry Debtors') AS ledger_party
         FROM app.payments p
         LEFT JOIN LATERAL (
           SELECT pl.settings->'ledger_mapping'->(ob.term) AS co
           FROM app.fee_obligations ob
           JOIN app.plugins pl ON pl.tenant_id = ob.tenant_id AND pl.plugin_id = 'accounting.tally'
           WHERE ob.id = p.obligation_id
         ) lm ON true
         WHERE p.tenant_id = $1 AND p.status = 'confirmed'
           AND ($2::date IS NULL OR (p.confirmed_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date)
           AND ($3::date IS NULL OR (p.confirmed_at AT TIME ZONE 'Asia/Kolkata')::date <= $3::date)
         ORDER BY p.confirmed_at ASC
         LIMIT 1000`, [req.user.tenant_id, from, to]);
      const totalCents = r.rows.reduce((s, v) => s + Number(v.amount_cents), 0);
      return {
        window: { from, to, tz: 'Asia/Kolkata' },
        vouchers: r.rows,
        voucher_count: r.rows.length,
        total_cents: totalCents,   // same rows the vouchers render — totals match by construction
      };
    });
  });

  // ── Export: materialize a voucher bundle for the window (read-only + audit) ──
  app.post('/plugins/accounting.tally/export', { preHandler: require('owner', 'itadmin', 'finance') }, async (req, reply) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.from ?? '') ? req.query.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.to ?? '') ? req.query.to : null;
    const companyName = String(req.query?.company ?? 'SchoolOS Demo');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // read settings (ledger mapping / party defaults) — owner-scoped secrets stay server-side
      const s = await c.query(`SELECT settings->'ledger_mapping' AS lm, settings->>'company_name' AS cn FROM app.plugins WHERE tenant_id=$1 AND plugin_id='accounting.tally'`, [req.user.tenant_id]);
      const mapping = s.rows[0]?.lm ?? {};
      const company = s.rows[0]?.cn || companyName;
      const r = await c.query(
        `SELECT p.id, p.receipt_no, p.amount_cents, p.method, p.gateway_ref,
                p.student_id, p.confirmed_at, p.created_at,
                lm.co AS mapped
         FROM app.payments p
         LEFT JOIN LATERAL (
           SELECT pl.settings->'ledger_mapping'->(ob.term) AS co
           FROM app.fee_obligations ob
           JOIN app.plugins pl ON pl.tenant_id = ob.tenant_id AND pl.plugin_id = 'accounting.tally'
           WHERE ob.id = p.obligation_id
         ) lm ON true
         WHERE p.tenant_id = $1 AND p.status = 'confirmed'
           AND ($2::date IS NULL OR (p.confirmed_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date)
           AND ($3::date IS NULL OR (p.confirmed_at AT TIME ZONE 'Asia/Kolkata')::date <= $3::date)
         ORDER BY p.confirmed_at ASC
         LIMIT 1000`, [req.user.tenant_id, from, to]);
      const vouchers = r.rows.map(v => {
        const m = v.mapped ?? {};
        return { ...v, ledger_name: m.name ?? 'Fee Income', ledger_party: m.party ?? 'Sundry Debtors' };
      });
      const totalCents = vouchers.reduce((sum, v) => sum + Number(v.amount_cents), 0);
      const xml = vouchers.map(v => voucherXml(v, company)).join('\n');
      const contentHash = (await import('node:crypto')).createHash('sha256').update(xml).digest('hex').slice(0, 16);
      const exportRef = `tally-export-${(from ?? 'all')}_${(to ?? 'all')}-${contentHash}`;
      // 009 audit level 'digest': window + voucher_count + content_hash — never PII amounts
      await auditLog(c, req.user.tenant_id, {
        actor: req.user.name, actorRole: req.user.role,
        action: `Tally voucher export: ${exportRef}`,
        recordType: 'Plugin', recordRef: 'accounting.tally@1.0.0',
        outcome: `window ${from ?? '*'}..${to ?? '*'} · ${vouchers.length} vouchers · sha256:${contentHash}`,
      });
      // plugin governance request audit (kernel-owned; actorRole plugin:accounting.tally)
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name,
        action: `Capability request: tally.voucher.export`,
        recordType: 'Plugin', recordRef: 'accounting.tally@1.0.0',
        reason: `owner/finance-initiated day-book export`,
        policyRef: 'Platform §5.2 (artifacts) · Fees §4.2',
        outcome: `window ${from ?? '*'}..${to ?? '*'} · ${vouchers.length} vouchers · sha256:${contentHash}`,
      });
      const { checkEventBudget } = await import('../../governance.js');
      await checkEventBudget(c, req.user.tenant_id, ID, 256);
      await kernel.emitEvent(c, req.user.tenant_id,
        { type: 'accounting', label: `Tally voucher export — ${vouchers.length} vouchers (${contentHash})`, severity: 'info', ref: exportRef },
        'tally.export.completed', { exportRef, window: { from, to }, voucherCount: vouchers.length, contentHash },
        { emittedBy: `plugin:${ID}`, schemaVersion: 1 });
      reply.header('content-type', 'application/xml; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="${exportRef}.xml"`);
      return xml;
    });
  });

  // ── Export history: rides the kernel audit ledger (digest level) ─────────────
  app.get('/plugins/accounting.tally/exports', { preHandler: require('owner', 'itadmin', 'finance') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT created_at, actor, actor_role, action, outcome
         FROM app.audit_log
         WHERE tenant_id = $1 AND record_type = 'Plugin' AND record_ref = 'accounting.tally@1.0.0'
           AND action LIKE 'Tally voucher export:%'
         ORDER BY created_at DESC LIMIT 50`, [req.user.tenant_id]);
      return { exports: r.rows };
    });
  });
}
