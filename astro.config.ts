import { execSync } from "node:child_process";
import fs from "node:fs";
import { rehypeHeadingIds } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import expressiveCode from "astro-expressive-code";
import icon from "astro-icon";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeExternalLinks from "rehype-external-links";
import rehypeUnwrapImages from "rehype-unwrap-images";
import { expressiveCodeOptions, siteConfig } from "./src/site.config";
import { wikilinkRemark } from "./src/utils/wikilinkRemark";

// v3 step 3 + step 5 + step 6 — regenerate build-time indexes around
// each production build:
//   - public/_data/graph.json  — wikilink node/edge graph for /graph
//     and /stubs. Emitted on `astro:build:start` so /stubs.astro can
//     read it via fs in its frontmatter before pages render.
//   - public/_index/notes.json — embeddings index for /UvSync ask.
//     Emitted on `astro:build:done` because it's a runtime fetch only.
// Each script wrapped in try/catch so a failed model download
// (offline CI) or graph emit doesn't break the build. Both consumers
// have empty-state fallbacks.
const buildIndexes = {
	name: "v3-build-indexes",
	hooks: {
		"astro:build:start": () => {
			try {
				execSync("node scripts/build-graph.mjs", { stdio: "inherit" });
			} catch (e) {
				console.warn(
					"[graph] build hook skipped:",
					e instanceof Error ? e.message : String(e),
				);
			}
		},
		"astro:build:done": () => {
			try {
				execSync("node scripts/build-embeddings.mjs", { stdio: "inherit" });
			} catch (e) {
				console.warn(
					"[embeddings] build hook skipped:",
					e instanceof Error ? e.message : String(e),
				);
			}
		},
	},
};

// v3 step 9 — pull worker-written KV state into the source tree at
// build time so the static site reflects the latest iOS Shortcut
// uploads. Skipped silently when env vars are absent (local dev keeps
// working off the file-based content).
//   - trails:<date>:<slug> → src/content/trails/<slug>.md (frontmatter
//     replaced; user-authored body preserved across re-imports).
//   - streak:current       → src/content/now/streak.json (mapped to
//     the file's existing { "streak": <int> } shape).
const buildKvSync = {
	name: "v3-build-kv-sync",
	hooks: {
		"astro:build:start": async () => {
			const token = process.env.CLOUDFLARE_API_TOKEN;
			const account = process.env.CLOUDFLARE_ACCOUNT_ID;
			const ns = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
			if (!token || !account || !ns) {
				console.log("[kv] skipped (no credentials)");
				return;
			}
			try {
				await syncTrails({ token, account, ns });
				await syncStreak({ token, account, ns });
				console.log("[kv] synced");
			} catch (e) {
				console.warn(
					"[kv] sync failed:",
					e instanceof Error ? e.message : String(e),
				);
			}
			try {
				await syncHabits({ token, account, ns });
			} catch (e) {
				console.warn(
					"[kv] habits sync failed:",
					e instanceof Error ? e.message : String(e),
				);
			}
			try {
				await syncEvents({ token, account, ns });
			} catch (e) {
				console.warn(
					"[kv] events sync failed:",
					e instanceof Error ? e.message : String(e),
				);
			}
		},
	},
};

interface KvCreds {
	token: string;
	account: string;
	ns: string;
}

async function kvList(c: KvCreds, prefix: string): Promise<string[]> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${c.account}/storage/kv/namespaces/${c.ns}/keys?prefix=${encodeURIComponent(prefix)}`;
	const r = await fetch(url, {
		headers: { authorization: `Bearer ${c.token}` },
	});
	if (!r.ok) throw new Error(`kv list ${r.status}`);
	const j = (await r.json()) as { result: { name: string }[] };
	return j.result.map((k) => k.name);
}

async function kvGet(c: KvCreds, key: string): Promise<string | null> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${c.account}/storage/kv/namespaces/${c.ns}/values/${encodeURIComponent(key)}`;
	const r = await fetch(url, {
		headers: { authorization: `Bearer ${c.token}` },
	});
	if (r.status === 404) return null;
	if (!r.ok) throw new Error(`kv get ${key} ${r.status}`);
	return await r.text();
}

async function syncTrails(c: KvCreds): Promise<void> {
	const keys = await kvList(c, "trails:");
	const TRAILS_DIR = new URL("./src/content/trails/", import.meta.url);
	for (const k of keys) {
		const raw = await kvGet(c, k);
		if (!raw) continue;
		let payload: Record<string, unknown>;
		try {
			payload = JSON.parse(raw);
		} catch {
			continue;
		}
		const slug = typeof payload.slug === "string" ? payload.slug : null;
		if (!slug) continue;
		const path = new URL(`${slug}.md`, TRAILS_DIR);
		let body = "";
		try {
			const existing = await fs.promises.readFile(path, "utf8");
			const m = existing.match(/^---[\s\S]*?---\n([\s\S]*)$/);
			if (m) body = m[1] ?? "";
		} catch {}
		await fs.promises.mkdir(new URL("./", path), { recursive: true });
		await fs.promises.writeFile(path, frontmatter(payload) + body);
	}
}

async function syncStreak(c: KvCreds): Promise<void> {
	const raw = await kvGet(c, "streak:current");
	if (!raw) return;
	let payload: { value?: number; updated?: string };
	try {
		payload = JSON.parse(raw);
	} catch {
		return;
	}
	if (typeof payload.value !== "number") return;
	const path = new URL("./src/content/now/streak.json", import.meta.url);
	// streak.json shape is { "streak": <int> } — map payload.value → that key.
	await fs.promises.writeFile(
		path,
		`${JSON.stringify({ streak: payload.value }, null, 2)}\n`,
	);
}

// v3.1 step 2 — habits and events sync. Habits aggregate the last 30 days
// (today inclusive) into a per-day row of {meditate, reflect, move, read};
// missing data is null. Events filter to the same window and sort newest
// first. KV keys outside the window are silently ignored.
const HABIT_NAMES = ["meditate", "reflect", "move", "read"] as const;
type HabitName = (typeof HABIT_NAMES)[number];

function lastNDates(n: number, today: Date): string[] {
	const out: string[] = [];
	const base = new Date(
		Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
	);
	for (let i = n - 1; i >= 0; i--) {
		const d = new Date(base);
		d.setUTCDate(d.getUTCDate() - i);
		out.push(d.toISOString().slice(0, 10));
	}
	return out;
}

async function syncHabits(c: KvCreds): Promise<void> {
	const keys = await kvList(c, "habit:");
	const today = new Date();
	const window = lastNDates(30, today);
	const windowSet = new Set(window);
	const perDay = new Map<string, Record<HabitName, number | null>>();
	for (const date of window) {
		perDay.set(date, { meditate: null, reflect: null, move: null, read: null });
	}
	for (const k of keys) {
		// key shape: habit:<name>:<YYYY-MM-DD>
		const parts = k.split(":");
		if (parts.length !== 3) continue;
		const habit = parts[1] as HabitName;
		const date = parts[2];
		if (!HABIT_NAMES.includes(habit)) continue;
		if (!date || !windowSet.has(date)) continue;
		const raw = await kvGet(c, k);
		if (!raw) continue;
		let payload: { value?: unknown };
		try {
			payload = JSON.parse(raw);
		} catch {
			continue;
		}
		const value = typeof payload.value === "number" ? payload.value : null;
		const row = perDay.get(date);
		if (row) row[habit] = value;
	}
	const days = window.map((date) => ({
		date,
		...(perDay.get(date) ?? {
			meditate: null,
			reflect: null,
			move: null,
			read: null,
		}),
	}));
	const out = { generated: new Date().toISOString(), days };
	const path = new URL(
		"./src/content/now/habits-30d.json",
		import.meta.url,
	);
	await fs.promises.writeFile(path, `${JSON.stringify(out, null, 2)}\n`);
}

async function syncEvents(c: KvCreds): Promise<void> {
	const keys = await kvList(c, "event:");
	const today = new Date();
	const window = lastNDates(30, today);
	const windowSet = new Set(window);
	const events: { kind: string; iso: string; payload?: unknown }[] = [];
	for (const k of keys) {
		// key shape: event:<kind>:<iso>
		const idx = k.indexOf(":");
		const idx2 = k.indexOf(":", idx + 1);
		if (idx < 0 || idx2 < 0) continue;
		const kind = k.slice(idx + 1, idx2);
		const iso = k.slice(idx2 + 1);
		if (!kind || !iso) continue;
		const date = iso.slice(0, 10);
		if (!windowSet.has(date)) continue;
		const raw = await kvGet(c, k);
		if (!raw) continue;
		let payload: { payload?: unknown };
		try {
			payload = JSON.parse(raw);
		} catch {
			continue;
		}
		const entry: { kind: string; iso: string; payload?: unknown } = {
			kind,
			iso,
		};
		if (payload.payload !== undefined) entry.payload = payload.payload;
		events.push(entry);
	}
	events.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));
	const out = { generated: new Date().toISOString(), events };
	const path = new URL(
		"./src/content/now/events-30d.json",
		import.meta.url,
	);
	await fs.promises.writeFile(path, `${JSON.stringify(out, null, 2)}\n`);
}

function frontmatter(p: Record<string, unknown>): string {
	const arr = Array.isArray(p.elevation_profile)
		? `[${(p.elevation_profile as number[]).join(", ")}]`
		: "[]";
	return `---
name: ${JSON.stringify(p.name ?? "")}
park: ${JSON.stringify(p.park ?? "")}
km: ${typeof p.km === "number" ? p.km : 0}
ascent_m: ${typeof p.ascent_m === "number" ? p.ascent_m : 0}
duration_min: ${typeof p.duration_min === "number" ? p.duration_min : 0}
date: ${typeof p.date === "string" ? p.date : ""}
elevation_profile: ${arr}
photos: []
featured: ${p.featured === true ? "true" : "false"}
---

`;
}

export default defineConfig({
	site: siteConfig.url,
	integrations: [
		expressiveCode(expressiveCodeOptions),
		icon(),
		sitemap(),
		mdx(),
		buildIndexes,
		buildKvSync,
	],
	markdown: {
		remarkPlugins: [wikilinkRemark],
		rehypePlugins: [
			rehypeHeadingIds,
			[rehypeAutolinkHeadings, { behavior: "wrap", properties: { className: ["not-prose"] } }],
			[
				rehypeExternalLinks,
				{
					rel: ["noreferrer", "noopener"],
					target: "_blank",
				},
			],
			rehypeUnwrapImages,
		],
		remarkRehype: {
			footnoteLabelProperties: { className: [""] },
		},
	},
	vite: {
		plugins: [tailwind(), rawFonts([".ttf", ".woff"])],
	},
});

function rawFonts(ext: string[]) {
	return {
		name: "vite-plugin-raw-fonts",
		// @ts-expect-error:next-line
		transform(_, id) {
			if (ext.some((e) => id.endsWith(e))) {
				const buffer = fs.readFileSync(id);
				return {
					code: `export default ${JSON.stringify(buffer)}`,
					map: null,
				};
			}
		},
	};
}
