/* PLG-10: kernel capabilities are declared by manifests, not guessed from a
 * second list of plugin ids. A capability lookup returns the enabled provider
 * for this tenant; provider order is the database's manifest order, so a rail
 * can be replaced without changing a kernel route. */
export async function enabledCapability(sysq, tenantId, capability) {
  const row = (await sysq(
    `SELECT plugin_id, settings, manifest
       FROM app.plugins
      WHERE tenant_id=$1
        AND status IN ('enabled','active','degraded')
        AND COALESCE(manifest->'capabilities', '[]'::jsonb) ? $2
      ORDER BY plugin_id
      LIMIT 1`, [tenantId, capability])).rows[0];
  return row ?? null;
}

export const capabilityEnabled = async (sysq, tenantId, capability) =>
  Boolean(await enabledCapability(sysq, tenantId, capability));
