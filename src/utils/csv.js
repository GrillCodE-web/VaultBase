/**
 * CSV parsing utilities
 */

/**
 * Parse a CSV row handling quoted fields with commas
 * @param {string} line - CSV line to parse
 * @returns {string[]} Array of column values
 */
export function parseCSVRow(line) {
  const cols = [];
  let cur = "", inq = false;
  for (const c of line) {
    if (c === '"') { inq = !inq; continue; }
    if (c === "," && !inq) { cols.push(cur); cur = ""; continue; }
    cur += c;
  }
  cols.push(cur);
  return cols;
}
