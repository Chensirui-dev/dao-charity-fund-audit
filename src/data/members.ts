import type { DAOMember } from '../types';
import { addresses, daysAgo } from '../utils/mock';

const powers = [520, 380, 240, 180, 150, 120, 98, 88, 76, 64, 58, 50, 44, 39, 32, 28, 24, 20, 18, 16, 14, 12, 10, 8];

export const members: DAOMember[] = powers.map((votingPower, index) => ({
  address: addresses[index],
  votingPower,
  joinTimestamp: daysAgo(120 - index * 3),
  totalVotesParticipated: Math.max(1, 34 - index),
  delegatedTo: index > 16 && index % 3 === 0 ? addresses[index % 6] : undefined,
}));
