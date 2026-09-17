// files.store — manifest (drop-in contract; the registry row + capability contract
// are authored by migration 048 — 018/020/024 precedent: the plugin factory provisions
// its own rows via numbered migrations; this file mirrors them for the drop-in factory).
// Invariants: bytes_never_web_served · mime_whitelist_with_extension_agreement ·
// sha256_over_exact_bytes · scoped_download_access · download_audited ·
// metadata_append_only. Uniform lifecycle gate on every door.
export default {
  id: 'files.store',
  version: '1.0.0',
  class: 'B',
  /* PLG-1: this manifest declared nothing while its code called emitEvent/requestAudit and read (or wrote)
     the tables below — so the stored grant was whatever a client asked for. Declared now from a static scan of
     this plugin's own index.js: the facilities it actually calls, and nothing it does not (the catalog's
     `memory.write` for pack.cbse/pack.dpdp was a copy-paste: no code path touches app.memory_entries). */
  permissions: ['students.read', 'files.write', 'events.emit', 'audit.request'],
  description: 'Private file storage: uploads are validated (5MB cap, mime whitelist PDF/PNG/JPEG/WebP/CSV/DOCX with extension agreement, sha256 integrity digest) and stored under the server-owned FILES_DIR tree — never web-served. Every read flows through the download door: uploader plus owner/principal/itadmin always; scope=student additionally admits that child\'s guardians (family.child_link) and the student themself (name-match identity pin). Downloads are audited. Accepts multipart/form-data and JSON base64 payloads.',
  policyRefs: ['Platform §2.4 (identity & access)', 'DPDP Act 2023 · data minimisation'],
  settingsSchema: { type: 'object', properties: {} },
  invariants: [
    'bytes_never_web_served',
    'mime_whitelist_with_extension_agreement',
    'sha256_over_exact_bytes',
    'scoped_download_access',
    'download_audited',
    'metadata_append_only',
  ],
  dependencies: [],
};
