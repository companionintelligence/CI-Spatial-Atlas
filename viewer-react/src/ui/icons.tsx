/** Minimal lucide-style icon set for the Atlas shell (inline SVG, currentColor). */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const S = (props: P) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

export const GlobeIcon = (p: P) => (
  <svg {...S(p)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" /></svg>
);
export const PinIcon = (p: P) => (
  <svg {...S(p)}><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
);
export const PeopleIcon = (p: P) => (
  <svg {...S(p)}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3 3-4.6 5.5-4.6S13.9 16 14.5 19M16 5.2A3 3 0 0 1 16 11M20.5 19c-.3-2-1.3-3.4-2.8-4.2" /></svg>
);
export const LayersIcon = (p: P) => (
  <svg {...S(p)}><path d="M12 3 3 8l9 5 9-5-9-5z" /><path d="M3 13l9 5 9-5M3 16.5l9 5 9-5" opacity=".5" /></svg>
);
export const SparkIcon = (p: P) => (
  <svg {...S(p)}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M6 18l2-2" /></svg>
);
export const GearIcon = (p: P) => (
  <svg {...S(p)}><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></svg>
);
export const ImagesIcon = (p: P) => (
  <svg {...S(p)}><rect x="3" y="5" width="14" height="12" rx="2" /><path d="M3 14l3.5-3 4 3.5M20 8v11H9" /><circle cx="9.5" cy="9" r="1.2" /></svg>
);
export const ClockIcon = (p: P) => (
  <svg {...S(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></svg>
);
export const GraphIcon = (p: P) => (
  <svg {...S(p)}><circle cx="6" cy="7" r="2.2" /><circle cx="18" cy="6" r="2.2" /><circle cx="16" cy="18" r="2.2" /><circle cx="7" cy="16" r="2.2" /><path d="M8 8l8-1M7.6 14 15 17M8 15l8-8" opacity=".7" /></svg>
);
export const SearchIcon = (p: P) => (
  <svg {...S(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
);
export const ShareIcon = (p: P) => (
  <svg {...S(p)}><circle cx="6" cy="12" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><path d="m8 11 8-4M8 13l8 4" /></svg>
);
export const MoonIcon = (p: P) => (
  <svg {...S(p)}><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></svg>
);
export const SunIcon = (p: P) => (
  <svg {...S(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" /></svg>
);
export const CameraIcon = (p: P) => (
  <svg {...S(p)}><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M8 7l1.5-2.5h5L16 7" /><circle cx="12" cy="13.5" r="3.4" /></svg>
);
export const PlaneIcon = (p: P) => (
  <svg {...S(p)}><path d="M10.5 13.5 3 11l18-7-7 18-2.5-7.5L10.5 13.5z" /></svg>
);
export const PlusIcon = (p: P) => <svg {...S({ ...p, strokeWidth: 1.8 })}><path d="M12 5v14M5 12h14" /></svg>;
export const PlayIcon = (p: P) => <svg {...S({ ...p, fill: 'currentColor', stroke: 'none' })}><path d="M8 5.5v13l11-6.5z" /></svg>;
export const PauseIcon = (p: P) => <svg {...S({ ...p, fill: 'currentColor', stroke: 'none' })}><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>;
export const PrevIcon = (p: P) => <svg {...S({ ...p, fill: 'currentColor', stroke: 'none' })}><path d="M6 5h2v14H6zM19 5 9 12l10 7z" /></svg>;
export const NextIcon = (p: P) => <svg {...S({ ...p, fill: 'currentColor', stroke: 'none' })}><path d="M16 5h2v14h-2zM5 5l10 7L5 19z" /></svg>;

export function BrandMark(props: P) {
  return (
    <svg viewBox="0 0 100 100" {...props} role="img" aria-label="Companion Intelligence">
      <defs>
        <linearGradient id="atlas-bm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#066c80" /><stop offset=".55" stopColor="#00a9a7" /><stop offset="1" stopColor="#72ddd4" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="none" stroke="url(#atlas-bm)" strokeWidth="6" />
      <circle cx="50" cy="50" r="20" fill="none" stroke="url(#atlas-bm)" strokeWidth="6" />
      <circle cx="50" cy="50" r="5" fill="#72ddd4" />
    </svg>
  );
}
