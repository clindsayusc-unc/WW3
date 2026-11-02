import type { ResourceId } from '../sim/types';

/** One colour per strategic resource (economy screen, resource map mode). */
export const RESOURCE_COLOR: Record<ResourceId, string> = {
  oil: '#f59e0b',
  gas: '#38bdf8',
  rareEarths: '#c084fc',
  chips: '#22d3ee',
  food: '#4ade80',
  steel: '#94a3b8',
};
