/**
 * Render parsed Markdown (see `markdown.ts`) as React elements.
 *
 * There is no `dangerouslySetInnerHTML` here and there must never be one. The
 * safety property of the whole narrative pipeline is that a story document's
 * text reaches the DOM only as React children — which React escapes — and its
 * URLs only through `safeUrl.ts`. The moment this file builds an HTML string,
 * that property is gone and `<script>` in a `?story=<url>` narrative is a
 * working injection again. `markdown.ts` has the long form of the argument.
 */
import type { ReactNode } from 'react';
import type { MdBlock, MdInline } from './markdown.js';

function renderInline(nodes: MdInline[], keyPrefix = ''): ReactNode[] {
  return nodes.map((n, i): ReactNode => {
    const key = `${keyPrefix}${i}`;
    switch (n.kind) {
      // A bare string: no wrapper element, and React escapes it. This is the
      // line that makes `<script>alert(1)</script>` in a narrative render as
      // the eight visible characters an author who typed them meant.
      case 'text': return n.text;
      case 'strong': return <strong key={key}>{renderInline(n.children, `${key}.`)}</strong>;
      case 'em': return <em key={key}>{renderInline(n.children, `${key}.`)}</em>;
      case 'code': return <code key={key} className="pr-code">{n.text}</code>;
      case 'break': return <br key={key} />;
      case 'link':
        return (
          // `noopener` is not optional on a story-supplied link: without it the
          // destination gets a live `window.opener` handle to the viewer and can
          // navigate it somewhere else. `noreferrer` keeps the reader's current
          // view — which can carry a memory query — out of the referer header.
          <a key={key} href={n.href} target="_blank" rel="noopener noreferrer nofollow ugc">
            {renderInline(n.children, `${key}.`)}
          </a>
        );
      case 'image':
        // `loading="lazy"` because a narrative can carry a dozen images and only
        // the current slide is on screen; `decoding="async"` so a large one does
        // not block the step to the next scene.
        return <img key={key} className="pr-inline-img" src={n.src} alt={n.alt} loading="lazy" decoding="async" />;
    }
  });
}

/**
 * Heading levels inside a narrative are *relative*.
 *
 * The slide's own title is the card's `<h2>`, so a narrative that opens with
 * `# Reykjavik` must not emit a second `<h1>` under it — that is a broken
 * document outline, and a screen-reader user navigating by heading level lands
 * on a slide that claims two titles. Shifting down by two keeps the author's
 * relative structure and nests it under the slide where it belongs. Written out
 * rather than built from a template string so the tag names stay type-checked.
 */
function Heading({ level, children }: { level: number; children: ReactNode }) {
  const n = Math.min(6, Math.max(3, level + 2));
  if (n === 3) return <h3>{children}</h3>;
  if (n === 4) return <h4>{children}</h4>;
  if (n === 5) return <h5>{children}</h5>;
  return <h6>{children}</h6>;
}

export function Markdown({ blocks, className }: { blocks: MdBlock[]; className?: string }) {
  if (blocks.length === 0) return null;
  return (
    <div className={className ? `pr-md ${className}` : 'pr-md'}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case 'heading':
            return <Heading key={key} level={b.level}>{renderInline(b.children, `${key}.`)}</Heading>;
          case 'paragraph':
            return <p key={key}>{renderInline(b.children, `${key}.`)}</p>;
          case 'quote':
            return <blockquote key={key}>{renderInline(b.children, `${key}.`)}</blockquote>;
          case 'list':
            return b.ordered
              ? <ol key={key}>{b.items.map((it, j) => <li key={j}>{renderInline(it, `${key}.${j}.`)}</li>)}</ol>
              : <ul key={key}>{b.items.map((it, j) => <li key={j}>{renderInline(it, `${key}.${j}.`)}</li>)}</ul>;
          case 'code':
            // The language is a data attribute, never a className: a class name
            // taken from an untrusted document is a hook for styling the author
            // of the *app* did not write, and nothing here needs one.
            return <pre key={key} className="pr-pre" data-lang={b.lang}><code>{b.text}</code></pre>;
          case 'rule':
            return <hr key={key} />;
        }
      })}
    </div>
  );
}
