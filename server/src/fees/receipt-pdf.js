/* Fee receipt PDF — a tiny, dependency-free PDF 1.4 writer (FEE-DAT-3b).
 *
 * The receipt is an immutable artifact, not just a DB row. We render a single-page A4 receipt with the
 * standard Helvetica base font (no embedded fonts, no external dependency) so `files.store` can hold it
 * and a guardian can download it. Amounts are formatted from integer paise — never floats.
 */

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function buildPdf(lines) {
  const content = ['BT', '/F1 12 Tf', '50 780 Td', '16 TL', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

export function receiptPdf({
  schoolName = 'SchoolOS', receiptNo, studentName, admissionNo, grade, section,
  label, term, amountCents, method, gatewayRef, issuedAt, paymentId, voided,
}) {
  const rupees = (Number(amountCents) / 100).toFixed(2);
  const lines = [
    String(schoolName).slice(0, 60),
    '',
    'FEE RECEIPT',
    `Receipt No: ${receiptNo}`,
    `Issued: ${issuedAt ? new Date(issuedAt).toISOString().slice(0, 10) : ''}`,
    `Student: ${studentName ?? ''}${admissionNo ? ` (${admissionNo})` : ''}`,
    `Class: ${[grade, section].filter(Boolean).join(' ')}`,
    `Towards: ${[label, term].filter(Boolean).join(' · ')}`,
    `Amount: INR ${rupees}`,
    `Method: ${method ?? ''}`,
    gatewayRef ? `Reference: ${gatewayRef}` : null,
    `Payment ID: ${paymentId ?? ''}`,
    voided ? 'STATUS: VOIDED' : null,
  ].filter((l) => l !== null);
  return buildPdf(lines);
}
