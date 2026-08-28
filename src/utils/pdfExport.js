// PERF-014: jspdf + autotable (~350 КБ) грузятся по требованию — только при
// реальном экспорте, а не в стартовом бандле.
export async function exportCardsToPDF(cards, filename = 'cards_export.pdf') {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  doc.setFontSize(16)
  doc.text('Cards Export', 14, 15)
  doc.setFontSize(8)
  doc.text(`Generated: ${new Date().toLocaleString()}  |  Total: ${cards.length}`, 14, 21)

  const head = [['#', 'Last4', 'Holder', 'Type', 'Bank', 'Country', 'Status', 'BIN', 'Expiry']]
  const body = cards.map((c, i) => [
    i + 1,
    c.last4 || '—',
    c.holder_masked || c.holder_name || '—',
    c.card_type || '—',
    c.bank_name || '—',
    c.country || '—',
    c.status || '—',
    c.bin || '—',
    c.expiry_date || '—',
  ])

  doc.autoTable({
    head,
    body,
    startY: 25,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [41, 41, 41], textColor: 255, fontSize: 7 },
    alternateRowStyles: { fillColor: [245, 245, 245] },
  })

  doc.save(filename)
}
