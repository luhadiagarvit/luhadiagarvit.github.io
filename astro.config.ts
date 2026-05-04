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

export default defineConfig({
	site: siteConfig.url,
	integrations: [
		expressiveCode(expressiveCodeOptions),
		icon(),
		sitemap(),
		mdx(),
		buildIndexes,
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
