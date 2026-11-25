// Report exports. Each "sheet" is { name, columns: [{key,label,money?}], rows: [] }.

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection from user-entered text.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportCsv(sheets, filename) {
  const parts = [];
  for (const sh of sheets) {
    if (sheets.length > 1) parts.push(csvCell(sh.name));
    parts.push(sh.columns.map((c) => csvCell(c.label)).join(','));
    for (const r of sh.rows) parts.push(sh.columns.map((c) => csvCell(r[c.key])).join(','));
    parts.push('');
  }
  // BOM so Excel opens UTF-8 (₹, names) correctly.
  download(new Blob(['\ufeff', parts.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`);
}

export async function exportXlsx(sheets, filename) {
  const { default: writeXlsxFile } = await import('write-excel-file');
  const data = sheets.map((sh) => [
    sh.columns.map((c) => ({ value: c.label, fontWeight: 'bold' })),
    ...sh.rows.map((r) => sh.columns.map((c) => {
      const v = r[c.key];
      if (typeof v === 'number') return { value: v, type: Number, format: c.money ? '#,##0.00' : undefined };
      return { value: v == null ? '' : String(v), type: String };
    })),
  ]);
  await writeXlsxFile(data, {
    sheets: sheets.map((s) => s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)),
    fileName: `${filename}.xlsx`,
  });
}

export async function exportPdf(sheets, filename, { title, subtitle } = {}) {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text(title || 'Report', 14, 16);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  if (subtitle) pdf.text(subtitle, 14, 22);
  let y = 28;
  const fmt = (v, money) => (typeof v === 'number'
    ? (money ? `Rs.${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : v.toLocaleString('en-IN'))
    : (v == null ? '' : String(v).replace(/₹/g, 'Rs.')));
  for (const sh of sheets) {
    autoTable(pdf, {
      startY: y,
      head: [[{ content: sh.name, colSpan: sh.columns.length, styles: { fillColor: [20, 20, 20], textColor: [212, 175, 55] } }],
        sh.columns.map((c) => c.label)],
      body: sh.rows.map((r) => sh.columns.map((c) => fmt(r[c.key], c.money))),
      styles: { fontSize: 8.5 },
      headStyles: { fillColor: [16, 163, 111] },
      columnStyles: Object.fromEntries(sh.columns.map((c, i) => [i, typeof sh.rows[0]?.[c.key] === 'number' ? { halign: 'right' } : {}])),
      margin: { left: 14, right: 14 },
    });
    y = pdf.lastAutoTable.finalY + 8;
  }
  pdf.save(`${filename}.pdf`);
}
