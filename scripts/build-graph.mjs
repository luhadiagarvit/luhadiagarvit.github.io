#!/usr/bin/env node
/**
 * v3 step 5 — build-time wikilink graph for the /graph route.
 *
 * Walks src/content/notes/, parses each non-draft note's body for
 * `[[wikilinks]]`, slugifies them (matching src/utils/slugify.ts),
 * and emits public/_data/graph.json:
 *   { generated, nodes: [{ id, title, kind, weight }],
 *     edges: [{ source, target }],
 *     stubs: [{ slug, raw, inboundFrom: [...] }] }
 *
 * weight = inDegree + outDegree (used by /graph for node sizing).
 *
 * Mirrors scripts/build-embeddings.mjs: pure Node, no Astro runtime,
 * tiny scalar-only frontmatter parser. Failure mode: write an empty
 * graph and exit 0 so the build never breaks because of this hook.
 */
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, basename, extname, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const NOTES_DIR = join(ROOT, "src", "content", "notes");
const OUT_DIR = join(ROOT, "public", "_data");
const OUT_PATH = join(OUT_DIR, "graph.json");
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

async function walk(dir) {
	const out = [];
	let entries;
	try {
		entries = await readdir(dir);
	} catch {
		return out;
	}
	for (const name of entries) {
		const full = join(dir, name);
		const st = await stat(full);
		if (st.isDirectory()) {
			out.push(...(await walk(full)));
		} else if (/\.(md|mdx)$/.test(name)) {
			out.push(full);
		}
	}
	return out;
}

/**
 * Tiny YAML-frontmatter parser. Handles scalars (title, kind, draft).
 * Anything else defaults sensibly. /graph doesn't need tags here, so
 * we don't bother parsing list bodies — keep this script deps-free.
 */
function parseFrontmatter(raw) {
	const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!m) return { data: {}, content: raw };
	const block = m[1];
	const content = m[2] ?? "";
	const data = {};
	for (const line of block.split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
		if (!kv) continue;
		const key = kv[1];
		let val = kv[2].trim();
		if (val === "") {
			data[key] = "";
			continue;
		}
		if (val === "true") {
			data[key] = true;
			continue;
		}
		if (val === "false") {
			data[key] = false;
			continue;
		}
		const quoted = val.match(/^["'](.*)["']$/);
		if (quoted) {
			data[key] = quoted[1];
			continue;
		}
		data[key] = val;
	}
	return { data, content };
}

// Mirrors src/utils/slugify.ts so dev (Astro getCollection) and
// build-time (this script) produce identical edge keys.
function slugifyWikilink(raw) {
	return raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

async function main() {
	const files = await walk(NOTES_DIR);
	const records = [];
	for (const file of files) {
		const raw = await readFile(file, "utf8");
		const { data, content } = parseFrontmatter(raw);
		if (data.draft === true) continue;
		const slug = basename(file, extname(file));
		records.push({
			slug,
			title: data.title || slug,
			kind: data.kind || "note",
			content,
		});
	}
	const slugSet = new Set(records.map((r) => r.slug));

	const edgeKey = new Set();
	const edges = [];
	const stubMap = new Map();
	const inDeg = new Map();
	const outDeg = new Map();

	for (const r of records) {
		const seen = new Set();
		let m;
		WIKILINK_RE.lastIndex = 0;
		while ((m = WIKILINK_RE.exec(r.content)) !== null) {
			const targetRaw = m[1];
			const target = slugifyWikilink(targetRaw);
			if (!target || target === r.slug || seen.has(target)) continue;
			seen.add(target);
			if (slugSet.has(target)) {
				const k = `${r.slug} ${target}`;
				if (edgeKey.has(k)) continue;
				edgeKey.add(k);
				edges.push({ source: r.slug, target });
				outDeg.set(r.slug, (outDeg.get(r.slug) || 0) + 1);
				inDeg.set(target, (inDeg.get(target) || 0) + 1);
			} else {
				const existing = stubMap.get(target);
				if (existing) {
					if (!existing.inboundFrom.includes(r.slug)) existing.inboundFrom.push(r.slug);
				} else {
					stubMap.set(target, { slug: target, raw: targetRaw, inboundFrom: [r.slug] });
				}
			}
		}
	}

	const nodes = records.map((r) => ({
		id: r.slug,
		title: r.title,
		kind: r.kind,
		weight: (inDeg.get(r.slug) || 0) + (outDeg.get(r.slug) || 0),
	}));

	await mkdir(OUT_DIR, { recursive: true });
	await writeFile(
		OUT_PATH,
		JSON.stringify({
			generated: new Date().toISOString(),
			nodes,
			edges,
			stubs: Array.from(stubMap.values()),
		}),
	);
	console.log(
		`[graph] wrote ${nodes.length} nodes, ${edges.length} edges, ${stubMap.size} stubs`,
	);
}

main().catch((e) => {
	console.error("[graph] failed:", e);
	mkdir(OUT_DIR, { recursive: true })
		.then(() =>
			writeFile(
				OUT_PATH,
				JSON.stringify({
					generated: new Date().toISOString(),
					nodes: [],
					edges: [],
					stubs: [],
				}),
			),
		)
		.catch(() => {});
});
