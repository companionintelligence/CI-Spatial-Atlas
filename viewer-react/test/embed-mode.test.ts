/**
 * The embed predicate.
 *
 * These tests are written against the *policy*, not against a rendered shell,
 * because the failure this guards is a surface that stays visible in an embed
 * and nobody notices until a reader finds a Save button pointed at somebody
 * else's Companion Memory. A boolean per surface is a thing a test can assert
 * exhaustively; an inline `&&` buried in a 1000-line component is not.
 */
import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_PARAMS, TRANSIENT_PARAMS,
  atlasChrome, carriesCredentials, flagIsOn, hiddenInEmbed, isEmbedded,
  memoryCredentialsAllowed, stripForSharing, type ChromeSurface,
} from '../src/embed/embedMode.js';

describe('reading the switch', () => {
  it('turns on for a bare flag and for the usual spellings of yes', () => {
    for (const q of ['?embed', '?embed=1', '?embed=true', '?embed=YES', '?embed=on']) {
      expect(isEmbedded(q), q).toBe(true);
    }
  });

  it('stays off with no parameter, and for an explicit no', () => {
    // The explicit "off" spellings are how someone debugging an embed turns the
    // chrome back on without hand-editing a long URL; if `?embed=0` read as
    // truthy — which it does under a naive `params.has()` — that route would
    // not exist.
    for (const q of ['', '?story=/s.json', '?embed=0', '?embed=false', '?embed=no']) {
      expect(isEmbedded(q), q).toBe(false);
    }
  });

  it('accepts a URLSearchParams, a string, or nothing at all', () => {
    expect(isEmbedded(new URLSearchParams('embed=1'))).toBe(true);
    expect(isEmbedded(undefined)).toBe(false);
    expect(isEmbedded(null)).toBe(false);
  });

  it('treats a value-less flag as present', () => {
    expect(flagIsOn('')).toBe(true);
    expect(flagIsOn(null)).toBe(false);
  });
});

describe('what an embed shows', () => {
  const app = atlasChrome('');
  const embed = atlasChrome('?embed=1');

  it('drops every authoring and account surface', () => {
    // Each of these is a way to write — to the story, to the scrapbook draft,
    // or to Companion Memory — and an embed is a reading surface.
    const authoring: ChromeSurface[] = [
      'rail', 'topBar', 'drawing', 'sceneAuthoring', 'interop',
      'scrapbook', 'collect', 'people', 'share', 'commandPalette',
    ];
    for (const surface of authoring) {
      expect(app[surface], `app.${surface}`).toBe(true);
      expect(embed[surface], `embed.${surface}`).toBe(false);
    }
  });

  it('keeps everything that makes the story worth embedding', () => {
    // An embed without the timeline is a screenshot, and one without the
    // presenter is a globe with no story on it.
    for (const surface of ['globe', 'timeline', 'presenter', 'inspector', 'lightbox', 'overlays'] as ChromeSurface[]) {
      expect(embed[surface], surface).toBe(true);
    }
  });

  it('adds the embed bar, and only in an embed', () => {
    // The rail carried the only Present button. Without a replacement the
    // presenter would be mounted and unreachable — the exact "finished but
    // never wired up" failure this feature is supposed to avoid.
    expect(embed.embedBar).toBe(true);
    expect(app.embedBar).toBe(false);
  });

  it('marks itself as embedded, so one object answers every question', () => {
    expect(embed.embedded).toBe(true);
    expect(app.embedded).toBe(false);
  });

  it('hides nothing in the full application', () => {
    // `embedded` is the mode flag rather than a surface, and `embedBar` is the
    // embed's own chrome — everything else must be on, or the predicate has
    // quietly taken something away from the app it was only meant to take away
    // from the embed.
    const off = (Object.keys(app) as (keyof typeof app)[])
      .filter((k) => k !== 'embedBar' && k !== 'embedded' && !app[k]);
    expect(off).toEqual([]);
  });
});

describe('the note the share panel prints', () => {
  it('names what the embed actually hides', () => {
    // The list is filtered through the decision rather than hand-written beside
    // it, so a surface that changes side changes this sentence too. A promise
    // in the share panel that the embed then breaks is worse than no promise.
    expect(hiddenInEmbed()).toEqual([
      'the navigation rail',
      'the top bar and account',
      'drawing tools',
      'the scene editor',
      'import and export',
      'the scrapbook',
      'the people panel',
      'search',
    ]);
  });

  it('never claims to hide something the embed keeps', () => {
    const kept = ['globe', 'timeline', 'presenter', 'story'];
    const sentence = hiddenInEmbed().join(' ');
    for (const word of kept) expect(sentence).not.toContain(word);
  });
});

describe('credentials', () => {
  it('refuses a memory connection supplied through an embed URL', () => {
    // The iframe `src` is written by the embedding page, so in embed mode every
    // parameter is attacker-supplied. Honouring `?memory=` there would let any
    // page point Atlas at a server of its choosing, with a token, inside a frame
    // it controls.
    expect(memoryCredentialsAllowed('?memory=https://ci.example&token=abc')).toBe(true);
    expect(memoryCredentialsAllowed('?embed=1&memory=https://evil.example&token=abc')).toBe(false);
  });

  it('strips the bearer token, the server address, and the OAuth code', () => {
    // `code`/`state` matter as much as `token`: a link copied straight after
    // signing in would otherwise publish a live single-use credential, and the
    // existing `safeShareUrl` deletes neither.
    const url = new URL('https://atlas.example/?story=/s.json&memory=https://m&token=jwt&code=abc&state=xyz&view=1,2');
    stripForSharing(url);
    for (const p of CREDENTIAL_PARAMS) expect(url.searchParams.get(p), p).toBeNull();
    expect(url.searchParams.get('story')).toBe('/s.json');
    expect(url.searchParams.get('view')).toBe('1,2');
  });

  it('strips a failed sign-in’s error parameters too', () => {
    const url = new URL('https://atlas.example/?error=access_denied&error_description=nope&error_uri=x&story=/s.json');
    stripForSharing(url);
    for (const p of TRANSIENT_PARAMS) expect(url.searchParams.get(p), p).toBeNull();
    expect(url.searchParams.get('story')).toBe('/s.json');
  });

  it('can say whether the current view carries any', () => {
    expect(carriesCredentials('?story=/s.json')).toBe(false);
    expect(carriesCredentials('?token=jwt')).toBe(true);
    expect(carriesCredentials('?code=abc')).toBe(true);
  });
});
