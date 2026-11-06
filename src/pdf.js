const escapePdfText = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function wrapLine(line, max = 92) {
  const words = String(line).split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) {
      if (cur) out.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

export function buildPdf({ title, subtitle, paragraphs = [], footer = [] }) {
  const contentLines = [];
  let y = 790;
  const push = (size, text) => {
    for (const l of wrapLine(text)) {
      if (y < 60) return;
      contentLines.push(`BT /F1 ${size} Tf 56 ${y} Td (${escapePdfText(l)}) Tj ET`);
      y -= size + 6;
    }
  };
  push(20, title);
  y -= 6;
  if (subtitle) push(11, subtitle);
  y -= 10;
  for (const p of paragraphs) {
    push(11, p);
    y -= 8;
  }
  y = 110;
  for (const f of footer) push(10, f);

  const content = Buffer.from(contentLines.join('\n') + '\n', 'latin1');

  const objects = [];
  const addObj = (buf) => objects.push(buf);
  addObj(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'));
  addObj(Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'));
  addObj(Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', 'latin1'));
  addObj(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', 'latin1'));
  objects.push(Buffer.concat([
    Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'),
    content,
    Buffer.from('endstream', 'latin1'),
  ]));

  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(parts.reduce((acc, p) => acc + p.length, 0));
    parts.push(Buffer.from(`${i + 1} 0 obj\n`, 'latin1'));
    parts.push(obj);
    parts.push(Buffer.from('\nendobj\n', 'latin1'));
  });
  const xrefOffset = parts.reduce((acc, p) => acc + p.length, 0);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}
