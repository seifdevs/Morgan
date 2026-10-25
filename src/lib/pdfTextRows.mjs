/** Rebuild a best-effort table from PDF text item positions. The import review remains authoritative. */
export function pdfTextRows(items, rowTolerance = 2.5, columnGap = 10) {
  const sorted = items.filter((item) => item.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of sorted) {
    let line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) <= rowTolerance);
    if (!line) { line = []; lines.push(line); }
    line.push(item);
  }
  const rows = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    const cells = [];
    let cellEnd = Number.NEGATIVE_INFINITY;
    for (const item of line) {
      const text = item.str.trim();
      if (!cells.length || item.x - cellEnd > columnGap) cells.push(text);
      else cells[cells.length - 1] = `${cells.at(-1)} ${text}`.trim();
      cellEnd = Math.max(cellEnd, item.x + item.width);
    }
    if (cells.some(Boolean)) rows.push(cells);
  }
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')]);
}
