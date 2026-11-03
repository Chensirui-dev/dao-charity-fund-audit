import { randomHash } from './format';

export const now = Date.now();

export const addresses = Array.from({ length: 40 }, (_, index) => {
  const body = randomHash(`address-${index}`).slice(2, 42);
  return `0x${body}`;
});

export function daysAgo(days: number): number {
  return now - days * 24 * 60 * 60 * 1000;
}

export function hoursFromNow(hours: number): number {
  return now + hours * 60 * 60 * 1000;
}

export function block(index: number): number {
  return 18_542_000 + index * 37;
}
