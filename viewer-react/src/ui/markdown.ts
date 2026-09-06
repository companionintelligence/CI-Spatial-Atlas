/**
 * A small, DOM-free Markdown reader for story narratives.
 *
 * `Scene.narrative` is documented as Markdown in the canonical schema, and
 * nothing in the viewer has ever treated it as such — every surface renders it
 * as a plain string, so `**Reykjavik**` shows up with its asterisks. This module
 * is what makes the schema's claim true on the presentation surfaces.
 *
 * ── Why a hand-written parser instead of `marked` + `DOMPurify` ─────────────
 *
 * The obvious build is "Markdown to an HTML string, sanitise the string, hand it
 * to `dangerouslySetInnerHTML`". Three reasons this does not:
 *
 *  1. A story is untrusted input — `?story=<url>` fetches a JSON document from
 *     any origin. Sanitise-then-inject is a *deny* list: it is only as good as
 *     the sanitiser's model of the parser, and it re-opens every time one of
 *     them changes. Never producing HTML in the first place is an *allow* list,
 *     and it cannot regress: this module emits a closed set of node kinds, React
 *     turns them into elements, and the only attacker-controlled strings that
 *     ever reach the DOM are text (which React escapes) and two URLs (which
 *     `safeUrl.ts` filters). There is no path by which `<script>` or an
 *     `onerror=` attribute becomes markup, because no markup is ever parsed.
 *  2. `dompurify` is in this repo's `node_modules` only as a transitive
 *     dependency of Cesium. Importing someone else's transitive dependency by
 *     name is a dependency you did not declare and nobody will notice removing.
 *  3. It needs a DOM. The viewer's suites run in node with no jsdom, so an
 *     inject-then-sanitise design cannot be tested here at all — and this is
 *     precisely the code that has to be tested.
 *
 * The supported subset is what narratives actually use: headings, paragraphs,
 * emphasis, inline code, fenced code, links, images, lists, block quotes and
 * thematic breaks. Raw HTML is *not* supported and never will be — a `<` is
 * always a literal `<`. Autolinks (`<https://…>`) are dropped along with it,
 * which is the deliberate price of that one flat rule.
 */
import { safeHref, safeMediaUrl } from './safeUrl.js';

export type MdInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: MdInline[] }
  | { kind: 'em'; children: MdInline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: MdInline[] }
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'break' };

export type MdBlock =
  | { kind: 'heading'; level: number; children: MdInline[] }
  | { kind: 'paragraph'; children: MdInline[] }
  | { kind: 'quote'; children: MdInline[] }
  | { kind: 'list'; ordered: boolean; items: MdInline[][] }
  | { kind: 'code'; text: string; lang?: string }
  | { kind: 'rule' };

/**
 * How deep emphasis / link nesting may recurse before the rest of a run is
 * taken as literal text.
 *
 * `parseInline` recurses into the content of every emphasis span and link
 * label, so a story that is nothing but 5,000 nested `*` blows the stack — and
 * a story arrives from a URL the reader typed. A depth cap turns that from a
 * crashed tab into slightly ugly text.
 */
const MAX_DEPTH = 8;

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!>~|]/;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** `- item` / `3. item` → the item's content, or null when the line is not one. */
function listMarker(line: string): { ordered: boolean; text: string } | null {
  const un = /^\s{0,3}[-*+][ \t]+(.*)$/.exec(line);
  if (un) return { ordered: false, text: un[1]! };
  const or = /^\s{0,3}\d{1,9}[.)][ \t]+(.*)$/.exec(line);
  if (or) return { ordered: true, text: or[1]! };
  return null;
}

const RULE = /^\s{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+-]*)[ \t]*$/;
const HEADING = /^\s{0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const QUOTE = /^\s{0,3}>/;

/** Does this line interrupt a paragraph? (Everything a paragraph is not.) */
function isBlockStart(line: string): boolean {
  return RULE.test(line) || FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || listMarker(line) != null;
}

/**
 * Parse Markdown into a closed set of block nodes. Never throws, never returns
 * markup, and returns `[]` for empty/absent input so callers can render it
 * unconditionally.
 */
export function parseMarkdown(src: string | null | undefined): MdBlock[] {
  if (typeof src !== 'string' || src.trim() === '') return [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      // The closing fence must use the same character, and be at least as long.
      const marker = fence[1]![0] === '~' ? '~' : '`';
      const close = new RegExp(`^\\s{0,3}${marker}{${fence[1]!.length},}[ \\t]*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i]!)) { body.push(lines[i]!); i++; }
      i++; // the closing fence, or one past the end for an unterminated block
      blocks.push({ kind: 'code', text: body.join('\n'), lang: fence[2] || undefined });
      continue;
    }

    // The rule test must precede the list test: `* * *` matches both, and a
    // thematic break read as a three-item list is a very odd-looking slide.
    if (RULE.test(line)) { blocks.push({ kind: 'rule' }); i++; continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, children: parseInline(heading[2]!) });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== '') {
        // Lazy continuation: an unmarked line inside a quote block stays in it,
        // which is how people actually write them.
        body.push(lines[i]!.replace(/^\s{0,3}>[ \t]?/, ''));
        i++;
      }
      blocks.push({ kind: 'quote', children: parseInline(body.join('\n')) });
      continue;
    }

    if (listMarker(line)) {
      const ordered = listMarker(line)!.ordered;
      const raw: string[] = [];
      while (i < lines.length) {
        const m = listMarker(lines[i]!);
        if (m && m.ordered === ordered) { raw.push(m.text); i++; continue; }
        // An indented, unmarked, non-blank line continues the item above.
        if (raw.length > 0 && lines[i]!.trim() !== '' && !m && /^[ \t]+\S/.test(lines[i]!)) {
          raw[raw.length - 1] += `\n${lines[i]!.trim()}`;
          i++;
          continue;
        }
        break;
      }
      blocks.push({ kind: 'list', ordered, items: raw.map((t) => parseInline(t)) });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !isBlockStart(lines[i]!)) { para.push(lines[i]!); i++; }
    blocks.push({ kind: 'paragraph', children: parseInline(para.join('\n')) });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Inlines
// ---------------------------------------------------------------------------

/** `[label](dest "title")` starting at `at` (which must point at the `[`). */
function matchLink(src: string, at: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let i = at;
  for (; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '\\') { i++; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0 || i >= src.length || src[i + 1] !== '(') return null;

  const label = src.slice(at + 1, i);
  let j = i + 2;
  let paren = 1;
  for (; j < src.length; j++) {
    const ch = src[j]!;
    if (ch === '\\') { j++; continue; }
    if (ch === '(') paren++;
    else if (ch === ')') { paren--; if (paren === 0) break; }
  }
  if (paren !== 0 || j >= src.length) return null;

  const dest = src.slice(i + 2, j).trim();
  const href = dest
    .replace(/\s+["'(][\s\S]*$/, '') // drop the optional title
    .replace(/^<|>$/g, '')           // and the angle-bracket destination form
    .trim();
  return { label, href, end: j + 1 };
}

/** `*em*`, `**strong**`, `***both***` (and the `_` spellings) starting at `at`. */
function matchEmphasis(src: string, at: number, depth: number): { node: MdInline; end: number } | null {
  const c = src[at]!;
  // Intra-word `_` is not emphasis. Narratives are full of `place_id` and
  // `snake_case` field names copied out of a memory record, and italicising the
  // middle of one is both wrong and unfixable by the author.
  if (c === '_' && at > 0 && /\w/.test(src[at - 1]!)) return null;

  const run = src[at + 1] === c ? (src[at + 2] === c ? 3 : 2) : 1;
  const delim = c.repeat(run);
  const from = at + run;
  // A left-flanking run cannot be followed by whitespace: `a * b * c` is prose.
  if (from >= src.length || /\s/.test(src[from]!)) return null;

  let cursor = from;
  while (cursor < src.length) {
    const close = src.indexOf(delim, cursor);
    if (close < 0) return null;
    if (src[close - 1] === '\\') { cursor = close + delim.length; continue; }
    if (/\s/.test(src[close - 1] ?? ' ')) { cursor = close + delim.length; continue; }
    // A shorter delimiter must not close on the first half of a longer run.
    if (src[close + run] === c) { cursor = close + 1; continue; }

    const inner = src.slice(from, close);
    if (inner === '') return null;
    const children = parseInline(inner, depth + 1);
    const node: MdInline =
      run === 1 ? { kind: 'em', children }
        : run === 2 ? { kind: 'strong', children }
          : { kind: 'strong', children: [{ kind: 'em', children }] };
    return { node, end: close + delim.length };
  }
  return null;
}

/** Parse a run of inline Markdown. Emits text for anything it does not model. */
export function parseInline(src: string, depth = 0): MdInline[] {
  if (depth > MAX_DEPTH) return src === '' ? [] : [{ kind: 'text', text: src }];

  const out: MdInline[] = [];
  let buf = '';
  const flush = () => { if (buf !== '') { out.push({ kind: 'text', text: buf }); buf = ''; } };
  let i = 0;

  while (i < src.length) {
    const c = src[i]!;

    if (c === '\\' && i + 1 < src.length && ESCAPABLE.test(src[i + 1]!)) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    if (c === '\n') {
      // CommonMark: a lone newline is a *soft* break and renders as a space; a
      // line ending in two spaces or a backslash is a hard break. Following the
      // spec rather than "every newline is a <br>" matters because curator-
      // generated narratives hard-wrap prose, and treating those wraps as line
      // breaks shreds a paragraph into a ragged column.
      const hard = / {2,}$/.test(buf) || /\\$/.test(buf);
      buf = buf.replace(/(?: +|\\)$/, '');
      if (hard) { flush(); out.push({ kind: 'break' }); } else { buf += ' '; }
      i++;
      while (src[i] === ' ' || src[i] === '\t') i++;
      continue;
    }

    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ kind: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (c === '!' && src[i + 1] === '[') {
      const m = matchLink(src, i + 1);
      if (m) {
        const imageSrc = safeMediaUrl(m.href);
        flush();
        // An image whose URL is refused degrades to its alt text rather than
        // vanishing: the words the author wrote are the point, the file is the
        // decoration.
        if (imageSrc) out.push({ kind: 'image', src: imageSrc, alt: inlineText(parseInline(m.label, depth + 1)) });
        else out.push({ kind: 'text', text: m.label });
        i = m.end;
        continue;
      }
    }

    if (c === '[') {
      const m = matchLink(src, i);
      if (m) {
        const href = safeHref(m.href);
        flush();
        const children = parseInline(m.label, depth + 1);
        // Same rule for a refused href: keep the label, drop the link. A
        // `javascript:` destination must not survive as a *clickable* thing.
        if (href) out.push({ kind: 'link', href, children });
        else out.push(...children);
        i = m.end;
        continue;
      }
    }

    if (c === '*' || c === '_') {
      const m = matchEmphasis(src, i, depth);
      if (m) { flush(); out.push(m.node); i = m.end; continue; }
    }

    buf += c;
    i++;
  }

  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Plain text (contents list previews, aria labels, tooltips)
// ---------------------------------------------------------------------------

/** Flatten inline nodes to their readable text. */
export function inlineText(nodes: MdInline[]): string {
  let s = '';
  for (const n of nodes) {
    switch (n.kind) {
      case 'text': s += n.text; break;
      case 'code': s += n.text; break;
      case 'image': s += n.alt; break;
      case 'break': s += ' '; break;
      default: s += inlineText(n.children); break;
    }
  }
  return s;
}

/**
 * Flatten parsed Markdown to one line of prose, optionally truncated.
 *
 * Used for the contents list and for `aria-label`s — places that need the gist
 * of a scene, not its formatting. Truncation is on a word boundary because a
 * contents entry cut mid-word reads as a rendering bug.
 */
export function plainText(blocks: MdBlock[], maxChars = Infinity): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading': case 'paragraph': case 'quote': parts.push(inlineText(b.children)); break;
      case 'list': parts.push(b.items.map((it) => inlineText(it)).join(' ')); break;
      case 'code': parts.push(b.text); break;
      case 'rule': break;
    }
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const space = cut.lastIndexOf(' ');
  return `${(space > maxChars * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
