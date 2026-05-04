#!/usr/bin/env node
/**
 * v3 step 7 — render 5-density ASCII portraits via jp2a (or chafa as fallback).
 *
 * Source: private/portrait-source.{jpg,jpeg,png} at the repo root (gitignored).
 * Output: public/portrait/L1.txt … L5.txt.
 *
 * The 5 widths and character ramps map streak → density (matches the
 * level numbering used by src/components/now/Portrait.astro):
 *
 *   L5 (crisp)  → 80 chars wide, fine ramp
 *   L4 (sharp)  → 64 chars wide, fine ramp
 *   L3 (soft)   → 50 chars wide, mid ramp
 *   L2 (faded)  → 36 chars wide, sparse ramp
 *   L1 (gone)   → 22 chars wide, sparse ramp
 *
 * The current files committed to the repo are HAND-AUTHORED and intentionally
 * narrower than the spec widths — they were tuned by hand for the layout. To
 * preserve them, this script refuses to overwrite without --force.
 *
 * Usage:
 *   pnpm portrait:render            # dry-run (lists what it would write)
 *   pnpm portrait:render --force    # actually overwrite L1.txt..L5.txt
 *
 * Requires `brew install jp2a` (or `brew install chafa` as a fallback).
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCE_CANDIDATES = [
	join(ROOT, "private", "portrait-source.jpg"),
	join(ROOT, "private", "portrait-source.jpeg"),
	join(ROOT, "private", "portrait-source.png"),
];
const OUT_DIR = join(ROOT, "public", "portrait");

const LEVELS = [
	{ level: 5, width: 80, ramp: " .-:=+*#%@" },
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

function detectTool() {
	for (const tool of ["jp2a", "chafa"]) {
		try {
			execFileSync("which", [tool], { stdio: ["ignore", "ignore", "ignore"] });
			return tool;
		} catch {
			/* not installed */
		}
	}
	return null;
}

function renderWith(tool, source, level) {
	if (tool === "jp2a") {
		return execFileSync(
			"jp2a",
			[`--width=${level.width}`, `--chars=${level.ramp}`, source],
			{ encoding: "utf8" },
		);
	}
	// chafa fallback — monochrome ASCII, no ANSI.
	return execFileSync(
		"chafa",
		[
			`--size=${level.width}x`,
			"--symbols=ascii",
			"--colors=none",
			"--fg-only",
			source,
		],
		{ encoding: "utf8" },
	);
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

	const tool = detectTool();
	if (!tool) {
		console.warn("[portrait] no ASCII tool found on PATH.");
		console.warn("[portrait] install one of:");
		console.warn("  brew install jp2a   # preferred");
		console.warn("  brew install chafa  # fallback");
		return;
	}

	if (!force) {
		console.log(`[portrait] dry-run (source: ${src}, tool: ${tool}).`);
		console.log("[portrait] pass --force to overwrite the hand-authored files.");
		for (const l of LEVELS) {
			console.log(
				`  would write public/portrait/L${l.level}.txt (${l.width} chars wide)`,
			);
		}
		return;
	}

	await mkdir(OUT_DIR, { recursive: true });
	for (const l of LEVELS) {
		const out = renderWith(tool, src, l);
		await writeFile(join(OUT_DIR, `L${l.level}.txt`), out);
		console.log(
			`[portrait] wrote public/portrait/L${l.level}.txt (${l.width} chars wide, ${tool})`,
		);
	}
}

main().catch((e) => {
	console.error("[portrait] failed:", e.message);
	process.exitCode = 1;
});
