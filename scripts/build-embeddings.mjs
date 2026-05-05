#!/usr/bin/env node
/**
 * v3 step 3 — build-time embeddings for the home /UvSync ask phase.
 *
 * Walks src/content/notes/, takes title + first 800 chars of each
 * non-draft note, embeds with MiniLM-L6-v2 via @xenova/transformers,
 * and writes public/_index/notes.json. Shape:
 *   { model, generated, items: [{ slug, title, kind, excerpt, embedding }] }
 *
 * Both the embedding path and the keyword fallback in the browser
 * read from the same index, so excerpt is included for both.
 *
 * Failure mode: if @xenova/transformers can't be imported (offline,
 * model download blocked), this script writes an items: [] index
 * and exits 0 so the build succeeds. The browser falls back to
 * keyword search, and an empty index just means empty results.
 */
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, basename, extname, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const NOTES_DIR = join(ROOT, "src", "content", "notes");
const OUT_DIR = join(ROOT, "public", "_index");
const OUT_PATH = join(OUT_DIR, "notes.json");
const MODEL = "Xenova/all-MiniLM-L6-v2";
const EXCERPT_CHARS = 200;
const EMBED_CHARS = 800;

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
 * Tiny YAML-frontmatter parser. Handles the keys we care about
 * (title: scalar, kind: scalar, draft: bool). Anything we miss
 * defaults sensibly. We don't pull in js-yaml so the script stays
 * deps-free aside from the optional transformers import.
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

function buildExcerpt(content) {
	return content
		.replace(/^---[\s\S]*?---\r?\n?/, "")
		.replace(/`{1,3}[^`]*`{1,3}/g, " ")
		.replace(/\[\[[^\]]+\]\]/g, " ")
		.replace(/[#>*_~`]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, EXCERPT_CHARS);
}

async function main() {
	const files = await walk(NOTES_DIR);
	const records = [];
	for (const file of files) {
		const raw = await readFile(file, "utf8");
		const { data, content } = parseFrontmatter(raw);
		if (data.draft === true) continue;
		const slug = basename(file, extname(file));
		const title = data.title || slug;
		const kind = data.kind || "note";
		const excerpt = buildExcerpt(content);
		const text = (title + "\n\n" + content).slice(0, EMBED_CHARS);
		records.push({ slug, title, kind, excerpt, text });
	}

	let extractor = null;
	let modelOk = false;
	if (records.length > 0) {
		try {
			const { pipeline } = await import("@xenova/transformers");
			extractor = await pipeline("feature-extraction", MODEL, { quantized: true });
			modelOk = true;
		} catch (e) {
			console.warn(
				`[embeddings] transformers unavailable (${e.message}); writing index without vectors. ` +
					"Browser will use keyword fallback.",
			);
		}
	}

	const items = [];
	for (const r of records) {
		let embedding = [];
		if (modelOk && extractor) {
			try {
				const out = await extractor(r.text, { pooling: "mean", normalize: true });
				embedding = Array.from(out.data);
			} catch (e) {
				console.warn(`[embeddings] embed failed for ${r.slug}: ${e.message}`);
			}
		}
		items.push({
			slug: r.slug,
			title: r.title,
			kind: r.kind,
			excerpt: r.excerpt,
			embedding,
		});
	}

	await mkdir(OUT_DIR, { recursive: true });
	await writeFile(
		OUT_PATH,
		JSON.stringify({
			model: MODEL,
			generated: new Date().toISOString(),
			items,
		}),
	);
	console.log(`[embeddings] wrote ${items.length} entries to ${OUT_PATH} (vectors=${modelOk})`);
}

main().catch((e) => {
	console.error("[embeddings] failed:", e);
	// Don't fail the build — emit an empty index so runtime falls back.
	mkdir(OUT_DIR, { recursive: true })
		.then(() =>
			writeFile(
				OUT_PATH,
				JSON.stringify({ model: MODEL, generated: new Date().toISOString(), items: [] }),
			),
		)
		.catch(() => {});
});
