#!/usr/bin/env node
/**
 * v3 step 8 — GPX → trails markdown frontmatter writer.
 * Walks private/gpx/*.gpx, parses <trkpt> chains, downsamples elevation
 * to 64 buckets, computes km / ascent_m / duration_min, and writes (or
 * updates the frontmatter of) src/content/trails/<slug>.md. The body of
 * any existing markdown is preserved so user-written prose survives a
 * re-import. Tolerates a missing private/gpx directory.
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GPX_DIR = join(ROOT, "private", "gpx");
const OUT_DIR = join(ROOT, "src", "content", "trails");
const BUCKETS = 64;

function slugify(s) {
	return String(s)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function downsample(values, n) {
	if (values.length === 0) return new Array(n).fill(0);
	if (values.length <= n) {
		const out = new Array(n);
		const r = (values.length - 1) / Math.max(1, n - 1);
		for (let i = 0; i < n; i++) {
			const idx = i * r;
			const lo = Math.floor(idx);
			const hi = Math.min(values.length - 1, Math.ceil(idx));
			const t = idx - lo;
			out[i] = values[lo] * (1 - t) + values[hi] * t;
		}
		return out;
	}
	const out = new Array(n);
	const w = values.length / n;
	for (let i = 0; i < n; i++) {
		const start = Math.floor(i * w);
		const end = Math.floor((i + 1) * w);
		let s = 0;
		let c = 0;
		for (let j = start; j < end && j < values.length; j++) {
			s += values[j];
			c++;
		}
		out[i] = c > 0 ? s / c : 0;
	}
	return out;
}

function haversine(a, b) {
	const R = 6371;
	const toRad = (d) => (d * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLon = toRad(b.lon - a.lon);
	const lat1 = toRad(a.lat);
	const lat2 = toRad(b.lat);
	const x =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(x));
}

async function parseOne(file) {
	const xml = await readFile(file, "utf8");
	const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
	const doc = parser.parse(xml);
	const trk = doc.gpx?.trk;
	const segs = Array.isArray(trk?.trkseg) ? trk.trkseg : trk?.trkseg ? [trk.trkseg] : [];
	const pts = [];
	for (const seg of segs) {
		const arr = Array.isArray(seg.trkpt) ? seg.trkpt : seg.trkpt ? [seg.trkpt] : [];
		for (const p of arr) {
			pts.push({
				lat: parseFloat(p.lat),
				lon: parseFloat(p.lon),
				ele: parseFloat(p.ele ?? 0),
				time: p.time ? new Date(p.time).getTime() : null,
			});
		}
	}
	if (pts.length === 0) return null;

	let km = 0;
	for (let i = 1; i < pts.length; i++) km += haversine(pts[i - 1], pts[i]);

	let ascent = 0;
	for (let i = 1; i < pts.length; i++) {
		const d = pts[i].ele - pts[i - 1].ele;
		if (d > 0) ascent += d;
	}

	const t0 = pts[0].time;
	const tN = pts[pts.length - 1].time;
	const duration_min = t0 && tN ? Math.max(0, Math.round((tN - t0) / 60000)) : 0;

	const elevation_profile = downsample(
		pts.map((p) => p.ele),
		BUCKETS,
	).map((n) => Math.round(n));

	const date = t0
		? new Date(t0).toISOString().slice(0, 10)
		: new Date().toISOString().slice(0, 10);

	return {
		name: trk?.name || basename(file, extname(file)),
		park: trk?.desc || "",
		km: Math.round(km * 100) / 100,
		ascent_m: Math.round(ascent),
		duration_min,
		date,
		gpx_path: file.replace(ROOT + "/", ""),
		elevation_profile,
		photos: [],
		featured: false,
	};
}

function toFrontmatter(rec) {
	const arr = "[" + rec.elevation_profile.join(", ") + "]";
	return `---
name: ${JSON.stringify(rec.name)}
park: ${JSON.stringify(rec.park)}
km: ${rec.km}
ascent_m: ${rec.ascent_m}
duration_min: ${rec.duration_min}
date: ${rec.date}
gpx_path: ${JSON.stringify(rec.gpx_path)}
elevation_profile: ${arr}
photos: []
featured: false
---

`;
}

async function main() {
	if (!existsSync(GPX_DIR)) {
		console.warn(`[trails] no GPX dir at ${GPX_DIR}; nothing to parse.`);
		return;
	}
	const files = (await readdir(GPX_DIR)).filter((f) => f.toLowerCase().endsWith(".gpx"));
	if (files.length === 0) {
		console.warn("[trails] no .gpx files; nothing to parse.");
		return;
	}
	await mkdir(OUT_DIR, { recursive: true });
	for (const f of files) {
		const full = join(GPX_DIR, f);
		const rec = await parseOne(full);
		if (!rec) {
			console.warn(`[trails] ${f}: no track points; skipping.`);
			continue;
		}
		const slug = slugify(`${rec.date} ${rec.name}`);
		const path = join(OUT_DIR, slug + ".md");
		let body = "";
		try {
			const existing = await readFile(path, "utf8");
			const m = existing.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
			if (m) body = m[1];
		} catch {
			/* new file */
		}
		await writeFile(path, toFrontmatter(rec) + body);
		console.log(`[trails] wrote ${slug}.md`);
	}
}

main().catch((e) => {
	console.error("[trails] failed:", e.message);
	process.exitCode = 1;
});
