import { describe, expect, it } from 'vitest';
import { OMEGA_WALK, OPENING_BLOCKS, ROOMS, ROOM_TONE, doorZ, openingDelay, parseColor, roomOf, roomZ, settled, stepSpring, walkOf } from '@/ui/scene/scene-plan';

describe('the shop ERA opens on', () => {
  it('each page is a room, in the order of the menu; pages inside a room belong to it; the rest is outside the shop', () => {
    expect(roomOf('today')).toBe('today');
    expect(roomOf('item')).toBe('stock');
    expect(roomOf('workshop')).toBe('stock');
    expect(roomOf('parcels')).toBe('sales');
    expect(roomOf('onboarding')).toBeNull();
    expect(roomOf('invoice')).toBeNull();
    expect(roomZ('stock')).toBeGreaterThan(roomZ('today'));
    // Every room has its colour, and its doorway stands ahead of where the camera waits.
    for (const r of ROOMS) expect(ROOM_TONE[r]).toMatch(/^--/);
    expect(doorZ(ROOMS.indexOf('stock'))).toBeGreaterThan(roomZ('stock'));
  });

  it('the camera walks to the room and stops there (nothing left to draw once it has arrived)', () => {
    let s = { x: 0, v: 0 };
    let frames = 0;
    while (!settled(s, 20) && frames < 600) {
      s = stepSpring(s, 20, 1 / 60, OMEGA_WALK);
      frames++;
    }
    expect(Math.abs(s.x - 20)).toBeLessThan(1e-3);
    // Arrives in about a second at 60 fps — then the loop stops.
    expect(frames).toBeLessThan(150);
    // Critically damped: never past the room and back.
    let t = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 300; i++) {
      t = stepSpring(t, 20, 1 / 60, OMEGA_WALK);
      max = Math.max(max, t.x);
    }
    expect(max).toBeLessThanOrEqual(20 + 1e-9);
  });

  it('a click mid-way turns towards the new room without a jump (position and speed continuous)', () => {
    let s = { x: 0, v: 0 };
    for (let i = 0; i < 12; i++) s = stepSpring(s, 30, 1 / 60, OMEGA_WALK);
    const before = s;
    const next = stepSpring(before, 10, 1e-6, OMEGA_WALK);
    expect(Math.abs(next.x - before.x)).toBeLessThan(1e-3);
    expect(Math.abs(next.v - before.v)).toBeLessThan(1e-2);
    // The same whatever the frame time: one long step lands where many small ones do.
    let a = { x: 0, v: 0 };
    for (let i = 0; i < 30; i++) a = stepSpring(a, 10, 1 / 60, OMEGA_WALK);
    const b = stepSpring({ x: 0, v: 0 }, 10, 0.5, OMEGA_WALK);
    expect(Math.abs(a.x - b.x)).toBeLessThan(1e-9);
  });

  it('reads the theme’s colours as written in CSS; an unreadable one is said, never guessed', () => {
    expect(parseColor('#7c5cff')).toEqual([0x7c / 255, 0x5c / 255, 1]);
    expect(parseColor(' #fff ')).toEqual([1, 1, 1]);
    expect(parseColor('rgb(52, 211, 153)')).toEqual([52 / 255, 211 / 255, 153 / 255]);
    expect(parseColor('rgba(52 211 153 / 0.5)')).toEqual([52 / 255, 211 / 255, 153 / 255]);
    expect(parseColor('var(--x)')).toBeNull();
  });

  it('changing page is a walk: forward or back along the menu, into a room or out of it; outside the shop, no walk', () => {
    expect(walkOf('today', 'stock')).toBe('fwd');
    expect(walkOf('sales', 'automations')).toBe('back');
    expect(walkOf('stock', 'item')).toBe('in');
    expect(walkOf('item', 'workshop')).toBe('in');
    expect(walkOf('item', 'stock')).toBe('out');
    expect(walkOf('stock', 'stock')).toBeNull();
    expect(walkOf('onboarding', 'today')).toBeNull();
    expect(walkOf('sales', 'invoice')).toBeNull();
  });

  it('the opening brings the first blocks one after the other, then the rest together — under a second in all', () => {
    expect(openingDelay(1)).toBeGreaterThan(openingDelay(0));
    expect(openingDelay(OPENING_BLOCKS + 4)).toBe(openingDelay(OPENING_BLOCKS - 1));
    expect(openingDelay(99)).toBeLessThan(500);
  });
});
