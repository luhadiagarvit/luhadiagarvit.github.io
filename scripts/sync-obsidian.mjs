#!/usr/bin/env node
/**
 * v3.1 step 7 — Obsidian → site notes one-way sync.
 *
 * Walks an Obsidian vault recursively, finds .md files with frontmatter
 * `publish: true`, normalizes the frontmatter to match the site's notes
 * schema, and writes the result to src/content/notes/<slug>.md. The body
 * is copied as-is — the wikilink remark plugin handles [[…]] at site-build
 * time.
 *
 * Usage:
 *   node scripts/sync-obsidian.mjs --vault <path> [--dry-run]
 *
 * Falls back to the OBSIDIAN_VAULT env var if --vault is omitted.
 * Never deletes notes; orphans (notes on disk no longer matched by a
 * publish:true source) are surfaced as warnings.
 */
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const NOTES_DIR = join(ROOT, "src", "content", "notes");
const SEED_NOTE = "welcome.md";

const KNOWN_KEYS = new Set([
	"title",
	"description",
	"publishDate",
	"updatedDate",
	"tags",
	"draft",
	"ogImage",
	"coverImage",
	"kind",
]);

const SOURCE_KEYS = new Set([
	"title",
	"description",
	"publishDate",
	"publish",
	"date",
	"created",
	"updatedDate",
	"updated",
	"modified",
	"tags",
	"draft",
	"ogImage",
	"coverImage",
	"kind",
	"cssclass",
	"cssclasses",
	"aliases",
]);

function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		const tok = argv[i];
		if (tok === "--dry-run") {
			out["dry-run"] = true;
		} else if (tok === "--vault") {
			out.vault = argv[++i];
		} else if (tok.startsWith("--vault=")) {
			out.vault = tok.slice("--vault=".length);
		} else if (tok === "--help" || tok === "-h") {
			out.help = true;
		}
	}
	return out;
}

function usage() {
	return [
		"Usage: node scripts/sync-obsidian.mjs --vault <path> [--dry-run]",
		"",
		"  --vault <path>   Path to your Obsidian vault root.",
		"                   Falls back to OBSIDIAN_VAULT env var.",
		"  --dry-run        List what would be synced; write nothing.",
	].join("\n");
}

function slugify(s) {
	return String(s)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Minimal YAML-frontmatter parser. Mirrors the pattern in
 * scripts/build-embeddings.mjs and adds an inline-array path for tags.
 * We don't pull in js-yaml; the script stays deps-free.
 */
function parseFrontmatter(raw) {
	const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!m) return { data: {}, content: raw };
	const block = m[1];
	const content = m[2] ?? "";
	const data = {};
	const lines = block.split(/\r?\n/);
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
		if (!kv) {
			i++;
			continue;
		}
		const key = kv[1];
		let val = kv[2].trim();
		if (val === "") {
			// Could be an indented list on subsequent lines (YAML block list).
			const items = [];
			let j = i + 1;
			while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
				const item = lines[j].replace(/^\s*-\s+/, "").trim();
				const q = item.match(/^["'](.*)["']$/);
				items.push(q ? q[1] : item);
				j++;
			}
			if (items.length > 0) {
				data[key] = items;
				i = j;
				continue;
			}
			data[key] = "";
			i++;
			continue;
		}
		if (val === "true") {
			data[key] = true;
			i++;
			continue;
		}
		if (val === "false") {
			data[key] = false;
			i++;
			continue;
		}
		// Inline array: tags: [a, b, "c d"]
		const arr = val.match(/^\[(.*)\]$/);
		if (arr) {
			const inner = arr[1].trim();
			if (inner === "") {
				data[key] = [];
			} else {
				data[key] = inner
					.split(",")
					.map((p) => p.trim())
					.map((p) => {
						const q = p.match(/^["'](.*)["']$/);
						return q ? q[1] : p;
					})
					.filter((p) => p.length > 0);
			}
			i++;
			continue;
		}
		const quoted = val.match(/^["'](.*)["']$/);
		if (quoted) {
			data[key] = quoted[1];
			i++;
			continue;
		}
		// Number?
		if (/^-?\d+(\.\d+)?$/.test(val)) {
			data[key] = Number(val);
			i++;
			continue;
		}
		data[key] = val;
		i++;
	}
	return { data, content };
}

async function walk(dir) {
	const out = [];
	let entries;
	try {
		entries = await readdir(dir);
	} catch {
		return out;
	}
	for (const name of entries) {
		// Skip Obsidian's metadata + common dotfile cruft.
		if (name === ".obsidian" || name === ".trash" || name.startsWith(".")) continue;
		const full = join(dir, name);
		let st;
		try {
			st = await stat(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			out.push(...(await walk(full)));
		} else if (name.toLowerCase().endsWith(".md")) {
			out.push(full);
		}
	}
	return out;
}

function toDateOnly(v, fallbackMtimeMs) {
	if (v instanceof Date) {
		return v.toISOString().slice(0, 10);
	}
	if (typeof v === "string" && v.length > 0) {
		const t = Date.parse(v);
		if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
	}
	if (typeof v === "number" && Number.isFinite(v)) {
		return new Date(v).toISOString().slice(0, 10);
	}
	return new Date(fallbackMtimeMs).toISOString().slice(0, 10);
}

function pickFirst(data, keys) {
	for (const k of keys) {
		if (data[k] !== undefined && data[k] !== null && data[k] !== "") return data[k];
	}
	return undefined;
}

function normalizeTags(raw) {
	if (raw === undefined || raw === null) return [];
	if (Array.isArray(raw)) {
		return raw
			.map((t) => String(t).trim())
			.filter((t) => t.length > 0);
	}
	if (typeof raw === "string") {
		const s = raw.trim();
		if (s === "") return [];
		// Space- or comma-delimited inline (rare in Obsidian, but tolerate it).
		return s
			.split(/[,\s]+/)
			.map((t) => t.replace(/^#/, "").trim())
			.filter((t) => t.length > 0);
	}
	return [];
}

function emitFrontmatter(data) {
	const lines = ["---"];
	lines.push(`title: ${JSON.stringify(data.title)}`);
	lines.push(`description: ${JSON.stringify(data.description)}`);
	lines.push(`publishDate: ${data.publishDate}`);
	if (data.updatedDate) lines.push(`updatedDate: ${data.updatedDate}`);
	const tagsArr = "[" + data.tags.map((t) => JSON.stringify(t)).join(", ") + "]";
	lines.push(`tags: ${tagsArr}`);
	lines.push(`draft: false`);
	lines.push(`kind: ${data.kind}`);
	lines.push("---");
	lines.push("");
	return lines.join("\n");
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(usage());
		return;
	}
	const vault = args.vault ?? process.env.OBSIDIAN_VAULT;
	if (!vault) {
		console.error("[obsidian-sync] error: --vault <path> is required (or set OBSIDIAN_VAULT).");
		console.error(usage());
		process.exit(1);
	}
	const vaultRoot = resolve(vault);
	let vaultStat;
	try {
		vaultStat = await stat(vaultRoot);
	} catch {
		console.error(`[obsidian-sync] error: vault path does not exist: ${vaultRoot}`);
		process.exit(1);
	}
	if (!vaultStat.isDirectory()) {
		console.error(`[obsidian-sync] error: vault path is not a directory: ${vaultRoot}`);
		process.exit(1);
	}
	const dryRun = args["dry-run"] === true;

	const files = await walk(vaultRoot);
	let written = 0;
	let skipped = 0;
	const touchedSlugs = new Set();
	const warnedKeys = new Set();
	const kindWarned = { value: false };

	for (const file of files) {
		const raw = await readFile(file, "utf8");
		const { data, content } = parseFrontmatter(raw);
		if (data.publish !== true) {
			skipped++;
			continue;
		}

		const fname = basename(file, extname(file));
		const slug = slugify(fname);
		if (!slug) {
			console.warn(`[obsidian-sync] warn: ${file} produced empty slug; skipping.`);
			skipped++;
			continue;
		}
		if (slug + ".md" === SEED_NOTE) {
			console.warn(
				`[obsidian-sync] warn: vault note "${fname}" collides with seed ${SEED_NOTE}; skipping.`,
			);
			skipped++;
			continue;
		}

		// Warn once per unknown frontmatter key in this run.
		for (const k of Object.keys(data)) {
			if (k.startsWith("_")) continue;
			if (SOURCE_KEYS.has(k)) continue;
			if (!warnedKeys.has(k)) {
				warnedKeys.add(k);
				console.warn(`[obsidian-sync] warn: unrecognized frontmatter key "${k}" (stripped).`);
			}
		}

		const st = await stat(file);
		const title = (typeof data.title === "string" && data.title.trim().length > 0)
			? data.title.trim()
			: fname;
		const description =
			typeof data.description === "string" ? data.description : "";
		const publishDate = toDateOnly(
			pickFirst(data, ["publishDate", "date", "created"]),
			st.mtimeMs,
		);
		const updatedRaw = pickFirst(data, ["updatedDate", "updated", "modified"]);
		const updatedDate = updatedRaw !== undefined ? toDateOnly(updatedRaw, st.mtimeMs) : undefined;
		const tags = normalizeTags(data.tags);
		let kind = "note";
		if (typeof data.kind === "string") {
			if (["post", "note", "evergreen"].includes(data.kind)) {
				kind = data.kind;
			} else if (!kindWarned.value) {
				kindWarned.value = true;
				console.warn(
					`[obsidian-sync] warn: invalid kind "${data.kind}" (must be post|note|evergreen); defaulting to "note".`,
				);
			}
		}

		const normalized = {
			title,
			description,
			publishDate,
			updatedDate,
			tags,
			kind,
		};

		const outPath = join(NOTES_DIR, slug + ".md");
		touchedSlugs.add(slug);

		if (dryRun) {
			console.log(`[obsidian-sync] would write ${slug}.md`);
		} else {
			const body = content.replace(/^\r?\n+/, "");
			await writeFile(outPath, emitFrontmatter(normalized) + body);
			console.log(`[obsidian-sync] wrote ${slug}.md`);
		}
		written++;
	}

	// Orphan detection: any *.md in NOTES_DIR not touched this run, minus
	// the seed file. We never delete — just surface.
	let existingNotes = [];
	try {
		existingNotes = (await readdir(NOTES_DIR)).filter((n) => n.toLowerCase().endsWith(".md"));
	} catch {
		existingNotes = [];
	}
	const orphans = [];
	for (const n of existingNotes) {
		if (n === SEED_NOTE) continue;
		const slug = basename(n, extname(n));
		if (!touchedSlugs.has(slug)) orphans.push(slug);
	}
	if (orphans.length > 0) {
		console.warn("[obsidian-sync] orphans (not matched by publish:true in vault):");
		for (const s of orphans) console.warn(`  - ${s}`);
	}

	console.log(
		`[obsidian-sync] synced ${written} notes, ${skipped} skipped (no publish:true), ${orphans.length} orphan`,
	);
	console.log(`[obsidian-sync] mode: ${dryRun ? "dry-run" : "write"}`);

	// Suppress unused warning lint by referencing KNOWN_KEYS (kept for docs).
	void KNOWN_KEYS;
}

main().catch((e) => {
	console.error("[obsidian-sync] failed:", e.message);
	process.exitCode = 1;
});
