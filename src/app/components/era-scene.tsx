import { useEffect, useRef, useState } from 'react';
import { type SceneEngine, type SceneState, createScene } from '@/ui/scene/scene-engine';
import { roomOf } from '@/ui/scene/scene-plan';

/**
 * The shop behind every page (decorative: hidden from screen readers, never in the way of a click). The camera comes
 * down into the shop when ERA opens, then walks from room to room as the seller changes page.
 */
export function EraScene({ route }: { route: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const engine = useRef<SceneEngine | null>(null);
  const [state, setState] = useState<SceneState>('moving');
  const room = roomOf(route);
  useEffect(() => {
    if (!ref.current) return;
    engine.current = createScene(ref.current, setState);
    return () => {
      engine.current?.dispose();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    if (room) engine.current?.goTo(room);
  }, [room]);
  return <canvas ref={ref} className="era-scene" aria-hidden="true" data-testid="era-scene" data-room={room ?? ''} data-state={state} />;
}
