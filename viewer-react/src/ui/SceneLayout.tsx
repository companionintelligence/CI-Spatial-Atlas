/**
 * One scene, drawn in the layout it asks for — the five `Scene.layout` values
 * the schema has always carried and no renderer has ever honoured.
 *
 * What each one means here:
 *
 *   card-left / card-right   A floating narrative card docked to one side. The
 *                            globe stays fully visible and interactive; the
 *                            card is glass, like the inspector it sits beside.
 *   card-bottom              The same card as a wide band across the foot of
 *                            the stage, for a scene whose point is the *view* —
 *                            a horizon needs the width, not the height.
 *   fullscreen               A slide. Title and description over a background
 *                            image, or over a flat tint when the story has no
 *                            loadable one. Opaque: the globe is gone, which is
 *                            the whole reason a story author picks it (chapter
 *                            breaks, an opening title, a closing note).
 *   split                    Half document, half world: an opaque narrative
 *                            column with the globe live beside it. Distinct
 *                            from card-left in that the column is full height
 *                            and solid, so long prose gets somewhere to go.
 *
 * The component is self-contained and useful on its own — mount it with a
 * `DeckSlide` and it renders that scene. `Presenter.tsx` composes it with the
 * stepper chrome; nothing here knows the deck exists.
 */
import type { ReactNode } from 'react';
import { Markdown } from './MarkdownRenderer.js';
import type { DeckSlide } from './sceneDeck.js';

export function SceneLayout({ slide, position, className, children }: {
  slide: DeckSlide;
  /**
   * "Scene 3 of 7". Rendered visually-hidden at the top of the card so a screen
   * reader hears where it is *before* the title. The visible copy of the same
   * fact lives in the presenter's control bar — a reader looking at the screen
   * has it, and one listening to the slide needs it in the announcement.
   */
  position?: string;
  className?: string;
  /** Extra chrome for inside the card — the presenter puts the audio control
   *  here, next to the narrative it narrates. */
  children?: ReactNode;
}) {
  const { layout, backgroundUrl, when, timeMs } = slide;
  const fullBleed = layout === 'fullscreen';
  const classes = ['pr-slide', `pr-layout-${layout}`, slide.tintClass, className].filter(Boolean).join(' ');

  return (
    <section
      /* Keyed by scene, so React *remounts* the slide instead of re-dressing
         the one that is already there. Two things depend on it: the card's
         entrance animation only runs on a fresh element, and `.pr-card-text`
         is a scroll container — reusing it left scene 4 opening halfway down
         the page because scene 3 had been scrolled. */
      key={slide.id}
      className={classes}
      /* One live region for the whole slide, rather than moving focus on every
         step. Focus-on-change is the other common carousel pattern and it is
         wrong here: it steals focus off the Next button the reader is clicking,
         so a second click lands nowhere. Announcing the slide leaves the
         pointer user's focus alone and still tells the listener what changed —
         and `aria-atomic` is what makes it read the whole scene rather than
         just the words that happen to differ from the last one. */
      aria-live="polite"
      aria-atomic="true"
    >
      {fullBleed && (
        <div className="pr-bg" aria-hidden="true">
          {/* Empty alt + aria-hidden: the image is the mood, not the content.
              The narrative beside it is what a reader needs read out, and a
              screen reader announcing "image" over every chapter break is
              noise. A story that means its image to be informative says so in
              the narrative, where an author can actually write it. */}
          {backgroundUrl && <img className="pr-bg-img" src={backgroundUrl} alt="" decoding="async" />}
          <div className="pr-scrim" />
        </div>
      )}

      <article className="pr-card">
        {position && <span className="pr-sr">{position}</span>}

        {/* Everywhere but fullscreen, a scene's image is the card's header —
            which is how the inspector already presents a memory's photo, so a
            reader crossing between the two surfaces sees one idea. */}
        {!fullBleed && backgroundUrl && (
          <img className="pr-card-img" src={backgroundUrl} alt="" decoding="async" />
        )}

        {/* The image and the words are siblings so `card-bottom` can lay them
            out as a row — a band 38vh tall with the picture beside the prose,
            rather than a picture that eats the band and leaves the narrative
            below the fold. */}
        <div className="pr-card-text">
          <header className="pr-card-head">
            {when && timeMs != null && (
              <p className="pr-eyebrow">
                <time dateTime={new Date(timeMs).toISOString()}>{when.date}</time>
                <span className="pr-dot" aria-hidden="true">·</span>
                {when.time}
              </p>
            )}
            <h2 className="pr-title">{slide.title}</h2>
          </header>

          {slide.body.length > 0 && (
            <div className="pr-card-body">
              <Markdown blocks={slide.body} />
            </div>
          )}

          {children}
        </div>
      </article>
    </section>
  );
}
