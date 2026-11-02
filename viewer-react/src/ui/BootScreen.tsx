import { BrandMark } from './icons.js';

/**
 * The screen shown while the viewer prepares its first frame. The mark is the app
 * icon's globe. Motion is a slow breathing, switched off for reduced motion.
 */
export function BootScreen({ label = 'Loading Companion Atlas…' }: { label?: string }) {
  return (
    <div className="atlas-boot" role="status" aria-live="polite">
      <div className="msg">
        <BrandMark className="atlas-boot-mark" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}
