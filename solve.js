// A faster drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
// Written from scratch from the published broken-row policy; it returns
// exactly csv-reader's {columns, rows, errors} for every input.
//
// Speed comes from never building a field one character at a time:
//   - a record with no quote and no CR in it (up to its LF) is one slice
//     split on commas, natively;
//   - an unquoted field is found with two native indexOf scans (next comma,
//     next LF); its slice is the value unless it holds a stray CR, which is
//     rare and takes a small fix-up path;
//   - a quoted field is found with native indexOf scans for its closing
//     quote (skipping "" pairs); its slice is the value unless it holds a
//     line break, a lone CR or an escaped quote, which take a small fix-up
//     path. Line numbers inside quotes are counted from the slice, and the
//     global line is only moved once the field is known to close, so an
//     unterminated quote costs nothing to abandon.
//
// The policy, kept exactly:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it is one quote, and each CRLF or lone CR inside
//     it is read as LF; what follows its closing quote, up to the next
//     comma or line break, is appended as it stands (quote_junk, when the
//     field ends); a quote that never closes is a literal character, and
//     the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (short_row, with fields: its field count) or cut (long_row,
//     with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met; a record's
//     short_row or long_row is recorded when it ends, after the field
//     errors of that record; line is the 1-based line its record starts
//     on, row its record's index in rows (null for the header);
//   - a line holding only stray CRs is left with no characters: no record,
//     but its stray_cr errors stay;
//   - when header is true and there is no record at all, columns is [].

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;
  // How the last field read ended: 0 comma, 1 line break, 2 end of text.
  let ended = 0;
  // Next LF at or after the position the cache was taken for (-1: none in
  // the rest of the text). Field starts only move forward, so a cached LF
  // at or after the field start is still the first LF after it.
  let lfPos = -1;
  let lfKnown = false;

  // Reads an unquoted field starting at `start`, with `prefix` already kept
  // ('' for a plain field, the quoted value for quote junk, '"' for the
  // re-read of an unterminated quote). Sets `ended`, moves `pos`, counts
  // `line`, and records stray_cr errors as they are met.
  function unq(start, prefix) {
    const cIdx = text.indexOf(',', start);
    if (!lfKnown || (lfPos !== -1 && lfPos < start)) { lfPos = text.indexOf('\n', start); lfKnown = true; }
    const nIdx = lfPos;
    let end;
    if (cIdx === -1) {
      if (nIdx === -1) { end = n; ended = 2; }
      else { end = nIdx; ended = 1; }
    } else if (nIdx === -1) { end = cIdx; ended = 0; }
    else if (cIdx < nIdx) { end = cIdx; ended = 0; }
    else { end = nIdx; ended = 1; }
    const seg = text.slice(start, end);
    const r = seg.indexOf('\r');
    let value;
    if (r === -1) {
      value = prefix ? prefix + seg : seg;
    } else if (ended === 1 && r === seg.length - 1) {
      // The only CR is the CRLF line break's own.
      value = prefix ? prefix + seg.slice(0, -1) : seg.slice(0, -1);
    } else {
      // One or more stray CRs: drop them, one stray_cr error each. A
      // trailing CR before the terminating LF is the CRLF break, not stray.
      const crlf = ended === 1 && seg.charCodeAt(seg.length - 1) === 13;
      const body = crlf ? seg.slice(0, -1) : seg;
      const cleaned = body.split('\r').join('');
      const count = body.length - cleaned.length;
      for (let i = 0; i < count; i++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      value = prefix ? prefix + cleaned : cleaned;
    }
    if (ended === 0) pos = end + 1;
    else if (ended === 1) { pos = end + 1; line += 1; }
    else pos = n;
    return value;
  }

  // Reads a quoted field whose opening quote is at `pos`. Sets `ended`,
  // moves `pos`, counts `line` for the breaks inside the quotes, and
  // records unterminated_quote / quote_junk / stray_cr errors as met.
  function quo() {
    const open = pos;
    const openLine = line;
    let q = text.indexOf('"', pos + 1);
    let esc = false;
    while (q !== -1 && text.charCodeAt(q + 1) === 34) {
      esc = true;
      q = text.indexOf('"', q + 2);
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted. `line` never moved during the
      // scan, so it is already the opening line.
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      pos = open + 1;
      line = openLine;
      return unq(open + 1, '"');
    }
    let content = text.slice(open + 1, q);
    if (esc) content = content.replaceAll('""', '"');
    // Every LF, CRLF and lone CR inside quotes is one line; CRLF and lone
    // CR are read as LF.
    if (content.indexOf('\r') !== -1) {
      content = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
      let d = 0;
      let ix = content.indexOf('\n');
      while (ix !== -1) { d += 1; ix = content.indexOf('\n', ix + 1); }
      line += d;
    } else {
      let d = 0;
      let ix = content.indexOf('\n');
      while (ix !== -1) { d += 1; ix = content.indexOf('\n', ix + 1); }
      line += d;
    }
    pos = q + 1;
    if (pos >= n) { ended = 2; return content; }
    const c = text.charCodeAt(pos);
    if (c === 44) { pos += 1; ended = 0; return content; }
    if (c === 10) { pos += 1; line += 1; ended = 1; return content; }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; ended = 1; return content; }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break; stray_cr errors inside it come first.
    const before = content.length;
    const value = unq(pos, content);
    if (value.length > before) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return value;
  }


  // Parses one single-line record held in `seg` (no LF in it, no CR in it):
  // every quoted field closes inside it, junk after a closing quote is
  // kept, quotes in unquoted fields are literal. Returns the fields, or
  // null when a quoted field does not close inside the segment (it spans
  // lines, or never closes): the caller then falls back to the slow path.
  // Only quote_junk errors can occur here; they are held locally and
  // committed only on success, so a failed attempt records nothing.
  function parseSeg(seg) {
    const m = seg.length;
    const fields = [];
    let junk = 0;
    let p = 0;
    while (true) {
      let value;
      let comma;
      if (seg.charCodeAt(p) === 34) {
        let q = seg.indexOf('"', p + 1);
        let esc = false;
        while (q !== -1 && seg.charCodeAt(q + 1) === 34) { esc = true; q = seg.indexOf('"', q + 2); }
        if (q === -1) return null;
        let content = seg.slice(p + 1, q);
        if (esc) content = content.replaceAll('""', '"');
        p = q + 1;
        if (p >= m) { value = content; comma = false; }
        else if (seg.charCodeAt(p) === 44) { value = content; comma = true; p += 1; }
        else {
          const cIdx = seg.indexOf(',', p);
          const jEnd = cIdx === -1 ? m : cIdx;
          if (jEnd > p) { junk += 1; value = content + seg.slice(p, jEnd); }
          else value = content;
          if (cIdx === -1) { comma = false; p = m; }
          else { comma = true; p = cIdx + 1; }
        }
      } else {
        const cIdx = seg.indexOf(',', p);
        if (cIdx === -1) { value = seg.slice(p); comma = false; p = m; }
        else { value = seg.slice(p, cIdx); comma = true; p = cIdx + 1; }
      }
      fields.push(value);
      if (!comma) break;
    }
    for (let i = 0; i < junk; i++) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return fields;
  }

  // Pads or cuts a finished record to the first record's width, recording
  // its short_row or long_row, and files it (as the header, when it is).
  function finish(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; return; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record holding no quote and no CR before its LF is one
    // slice split on commas.
    const le = text.indexOf('\n', pos);
    let segEnd = le === -1 ? n : le;
    if (le !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
    if (segEnd === pos) {
      // A blank line (LF, or CRLF whose CR was stripped above).
      pos = le + 1;
      line += 1;
      continue;
    }
    const seg = text.slice(pos, segEnd);
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      const fields = seg.split(',');
      pos = le === -1 ? n : le + 1;
      if (le !== -1) line += 1;
      finish(fields);
      continue;
    }

    // Segment path: the record holds quotes but no CR, and every quoted
    // field closes on this line.
    if (seg.indexOf('\r') === -1) {
      const segFields = parseSeg(seg);
      if (segFields !== null) {
        pos = le === -1 ? n : le + 1;
        if (le !== -1) line += 1;
        finish(segFields);
        continue;
      }
    }

    // Slow path: field by field.
    const fields = [];
    let firstQuoted = false;
    let first = true;
    do {
      const quoted = text.charCodeAt(pos) === 34;
      if (first) { firstQuoted = quoted; first = false; }
      fields.push(quoted ? quo() : unq(pos, ''));
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !firstQuoted) continue;
    finish(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
