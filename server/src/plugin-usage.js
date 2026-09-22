/* Plugin usage meter (FEE-COM-2).
 *
 * Manifests declare `billing.metered: [...]` but nothing ever counted the counters, so "usage-metered" was
 * a label with no number behind it. This is the ONE increment helper the money rails call; it is
 * best-effort by design — a metering failure must never fail a collection or a webhook — and it upserts a
 * single row per (tenant, plugin, metric) so the report is a cheap read.
 */
export async function meterPlugin(c, tenantId, pluginId, metric, n = 1) {
  try {
    await c.query(
      `INSERT INTO app.plugin_usage (tenant_id, plugin_id, metric, count)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, plugin_id, metric)
       DO UPDATE SET count = app.plugin_usage.count + EXCLUDED.count, updated_at = now()`,
      [tenantId, pluginId, metric, n]);
  } catch { /* metering is best-effort; never fail the money path */ }
}
