export type Level = 1 | 2 | 3 | 4 | 5;

/**
 * Map a habit's 30-day completion rate to a 5-level detail tier.
 *
 * Thresholds:
 *   >= 0.8 -> 5 (full bloom)
 *   >= 0.6 -> 4
 *   >= 0.4 -> 3
 *   >= 0.2 -> 2
 *   <  0.2 -> 1 (barely there)
 */
export function habitLevel(completionRate: number): Level {
	if (completionRate >= 0.8) return 5;
	if (completionRate >= 0.6) return 4;
	if (completionRate >= 0.4) return 3;
	if (completionRate >= 0.2) return 2;
	return 1;
}
