/**
 * CSV parsing and export utilities
 */

/**
 * Parse a CSV row handling quoted fields with commas
 * @param {string} line - CSV line to parse
 * @returns {string[]} Array of column values
 */
export function parseCSVRow(line) {
  const cols = []
  let cur = '',
    inq = false
  for (const c of line) {
    if (c === '"') {
      inq = !inq
      continue
    }
    if (c === ',' && !inq) {
      cols.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  cols.push(cur)
  return cols
}

/**
 * Escape a value for CSV format (handles quotes and null values)
 * @param {any} value - Value to escape
 * @returns {string} Escaped CSV value wrapped in quotes
 */
export function escapeCsvValue(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

/**
 * Convert array of values to CSV row
 * @param {Array<any>} row - Array of values
 * @returns {string} CSV row string
 */
export function toCsvRow(row) {
  return row.map(escapeCsvValue).join(',')
}

/**
 * Export data to CSV file and trigger download
 * @param {string} filename - Name of the file to download
 * @param {string} header - CSV header row
 * @param {Array<Array<any>>} rows - Array of row data arrays
 */
export function exportToCSV(filename, header, rows) {
  const csvRows = rows.map(toCsvRow)
  const csv = [header, ...csvRows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
