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

// v3 step 3 — regenerate the home /UvSync embeddings index after each
// build. Wrapped in try/catch so a failed model download (offline CI)
// does not fail the build; the browser falls back to keyword search.
const buildEmbeddings = {
	name: "v3-build-embeddings",
	hooks: {
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
		buildEmbeddings,
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
