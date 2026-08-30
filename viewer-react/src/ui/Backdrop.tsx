import { useEffect, useMemo, useRef } from 'react';

/** Fixed starfield behind everything (subtle twinkle, respects reduced-motion). */
export function Starfield() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const x = c.getContext('2d');
    if (!x) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let stars: { x: number; y: number; r: number; a: number; t: number }[] = [];
    let w = 0, h = 0, raf = 0;
    const init = () => {
      w = c.width = innerWidth;
      h = c.height = innerHeight;
      const n = Math.min(320, Math.floor((w * h) / 6000));
      stars = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.3 + 0.2, a: Math.random() * 0.6 + 0.2, t: Math.random() * 6 }));
    };
    const draw = (now: number) => {
      x.clearRect(0, 0, w, h);
      for (const s of stars) {
        x.globalAlpha = reduce ? s.a : s.a * (0.6 + 0.4 * Math.sin(now / 900 + s.t));
        x.fillStyle = s.r > 1 ? '#bfeaf0' : '#8fd6d0';
        x.beginPath();
        x.arc(s.x, s.y, s.r, 0, 7);
        x.fill();
      }
      x.globalAlpha = 1;
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    init();
    raf = requestAnimationFrame(draw);
    addEventListener('resize', init);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', init); };
  }, []);
  return <canvas ref={ref} className="atlas-stars" aria-hidden="true" />;
}

/** Teal synthwave grid horizon at the base of the stage (the "time-machine floor"). */
