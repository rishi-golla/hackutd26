// What the live-view panel shows before the first video frame: a halftone heart floating slowly, drawn by
// Canvas UI's Dithered Object. Unmounted once a frame arrives, so it costs nothing after that.
import { useEffect, useRef } from 'react';
import { createDitheredObject } from './canvasui/DitheredObjectVanilla';

// Lucide "heart" (ISC), filled. A dark grey fill gives the halftone shading to work with; white prints solid.
const HEART_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4a4a4a" d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';

export default function HeartPlaceholder() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const src = URL.createObjectURL(new Blob([HEART_SVG], { type: 'image/svg+xml' }));
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const heart = createDitheredObject(
      { canvas: canvas.current },
      {
        src,
        method: 'halftone',
        gridSize: 6,
        grayscale: true,
        scale: 2.2,
        orbit: false,
        zoom: false,
        floatIntensity: still ? 0 : 0.6,
        rotationIntensity: still ? 0 : 1.2,
        floatSpeed: 0.8,
      },
    );
    const onResize = () => heart?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      heart?.destroy();
      URL.revokeObjectURL(src);
    };
  }, []);
  return <canvas ref={canvas} className="heart" aria-hidden="true" />;
}
