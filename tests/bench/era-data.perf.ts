import { it } from 'vitest';
import { computeCore, computeDerived, computeEraData, computeIntel } from '@/app/era-data';
import { bigInputs } from './fixture';
import { time } from './timing';

it('dashboard state on a large account', () => {
  const input = bigInputs();
  console.log(`data: ${input.items!.length} items, ${input.listings!.length} listings, ${input.sales!.length} sales, ${input.observations!.length} observations, ${input.analyses!.length} analyses`);
  time('computeEraData — everything from the rows', () => computeEraData(input));
  const core = computeCore(input);
  const layer = computeIntel(core, input);
  time('core layer (articles, listings, sales changed)', () => computeCore(input));
  time('intel layer (analyses, observations changed)', () => computeIntel(core, input));
  time('derived layer only (a sheet saved, a decision taken)', () => computeDerived(core, layer, { ...input, ready: true }));
});
