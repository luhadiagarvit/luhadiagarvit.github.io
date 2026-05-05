#!/usr/bin/env node
/**
 * v3 step 7 — render 5-density ASCII portraits using sharp.
 *
 * Source: private/portrait-source.{jpg,jpeg,png} at the repo root (gitignored).
 * Output: public/portrait/L1.txt … L5.txt.
 *
 * Uses sharp (already a dep via Astro's image pipeline) — no external system
 * tools required. Each level resizes the source to a different character
 * grid, normalizes the brightness range, and maps each cell to a glyph from
 * a density ramp (sparse glyph = bright pixel, dense glyph = dark pixel).
 *
 * Level → streak mapping lives in src/components/now/Portrait.astro:
 *   L5 (crisp)  → 80 chars wide, fine ramp
 *   L4 (sharp)  → 64 chars wide, fine ramp
 *   L3 (soft)   → 50 chars wide, mid ramp
 *   L2 (faded)  → 36 chars wide, sparse ramp
 *   L1 (gone)   → 22 chars wide, sparse ramp
 *
 * Files committed to the repo are intentional — this script refuses to
 * overwrite without --force.
 *
 * Usage:
 *   pnpm portrait:render            # dry-run (lists what it would write)
 *   pnpm portrait:render --force    # overwrite L1.txt..L5.txt
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCE_CANDIDATES = [
	join(ROOT, "private", "portrait-source.jpg"),
	join(ROOT, "private", "portrait-source.jpeg"),
	join(ROOT, "private", "portrait-source.png"),
];
const OUT_DIR = join(ROOT, "public", "portrait");

// Terminal cells are roughly 2× as tall as wide in monospace fonts, so
// height = width × 0.5 keeps a square source rendering as a square portrait.
const ASPECT = 0.5;

const LEVELS = [
	{ level: 5, width: 80, ramp: " .'`,:;-_~+=*#%@$" },
	{ level: 4, width: 64, ramp: " .-:=+*#%@" },
	{ level: 3, width: 50, ramp: " .,-=+#@" },
	{ level: 2, width: 36, ramp: " .:#" },
	{ level: 1, width: 22, ramp: " .:" },
];

function findSource() {
	for (const candidate of SOURCE_CANDIDATES) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

async function rasterize(source, width, ramp) {
	const height = Math.max(1, Math.round(width * ASPECT));
	const { data, info } = await sharp(source)
		.resize(width, height, { fit: "fill" })
		.greyscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	// Normalize the brightness range so contrast is consistent across photos.
	let min = 255;
	let max = 0;
	for (let i = 0; i < data.length; i++) {
		if (data[i] < min) min = data[i];
		if (data[i] > max) max = data[i];
	}
	const range = Math.max(1, max - min);
	const lines = [];
	for (let y = 0; y < info.height; y++) {
		let row = "";
		for (let x = 0; x < info.width; x++) {
			const norm = (data[y * info.width + x] - min) / range; // 0..1
			// Dark pixel → end of ramp (densest glyph). Bright → start (space).
			const idx = Math.floor((1 - norm) * (ramp.length - 1));
			row += ramp[idx];
		}
		lines.push(row);
	}
	return lines.join("\n") + "\n";
}

async function main() {
	const force = process.argv.includes("--force");
	const src = findSource();

	if (!src) {
		console.warn(
			"[portrait] no source photo found. Drop one at private/portrait-source.jpg (or .jpeg/.png) and re-run.",
		);
		console.warn("[portrait] checked:");
		for (const c of SOURCE_CANDIDATES) console.warn(`  - ${c}`);
		return;
	}

	if (!force) {
		console.log(`[portrait] dry-run (source: ${src}).`);
		console.log("[portrait] pass --force to overwrite L1..L5.");
		for (const l of LEVELS) {
			const h = Math.round(l.width * ASPECT);
			console.log(`  would write public/portrait/L${l.level}.txt (${l.width}×${h})`);
		}
		return;
	}

	await mkdir(OUT_DIR, { recursive: true });
	for (const l of LEVELS) {
		const out = await rasterize(src, l.width, l.ramp);
		await writeFile(join(OUT_DIR, `L${l.level}.txt`), out);
		const h = Math.round(l.width * ASPECT);
		console.log(`[portrait] wrote public/portrait/L${l.level}.txt (${l.width}×${h})`);
	}
}

main().catch((e) => {
	console.error("[portrait] failed:", e.message);
	process.exitCode = 1;
});
