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
