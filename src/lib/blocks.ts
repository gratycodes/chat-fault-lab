/**
 * Split streaming markdown-ish text into paragraphs and code blocks.
 *
 * Deliberately small: no HTML, no inline markup, so nothing model-generated
 * is ever injected as markup. An unclosed fence (normal mid-stream) renders as
 * an open code block instead of flashing raw backticks.
 */

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'code'; lang: string; code: string; open: boolean };

const FENCE = /^ {0,3}(```|~~~)\s*([\w+#.-]*)\s*$/;

export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let para: string[] = [];
  let code: { lang: string; lines: string[]; marker: string } | null = null;

  const flushPara = () => {
    const t = para.join('\n').trim();
    if (t) blocks.push({ kind: 'text', text: t });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = FENCE.exec(line);
    if (code) {
      if (m && m[1] === code.marker && !m[2]) {
        blocks.push({ kind: 'code', lang: code.lang, code: code.lines.join('\n'), open: false });
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }
    if (m) {
      flushPara();
      code = { lang: m[2] ?? '', lines: [], marker: m[1]! };
      continue;
    }
    // Hide a half-arrived fence marker at the very end of the stream.
    if (i === lines.length - 1 && /^ {0,3}`{1,2}$/.test(line)) continue;
    if (line.trim() === '') flushPara();
    else para.push(line);
  }
  if (code) blocks.push({ kind: 'code', lang: code.lang, code: code.lines.join('\n'), open: true });
  else flushPara();
  return blocks;
}
