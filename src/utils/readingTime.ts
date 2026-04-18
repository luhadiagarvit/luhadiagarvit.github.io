const WORDS_PER_MINUTE = 220;

export function readingTime(body: string): string {
	const words = body.trim().split(/\s+/).length;
	const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
	return `${minutes} min read`;
}
