import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { siteConfig } from "@/site.config";
import type { APIContext } from "astro";

export async function GET(context: APIContext) {
	const posts = await getCollection("post", ({ data }) => !data.draft);
	const publications = await getCollection("publications");

	const postItems = posts.map((p) => ({
		title: p.data.title,
		description: p.data.description,
		pubDate: p.data.publishDate,
		link: `/posts/${p.id}/`,
		categories: p.data.tags,
	}));

	const pubItems = publications.map((p) => ({
		title: `${p.data.title} (${p.data.venue})`,
		description: p.data.authors.join(", "),
		pubDate: new Date(p.data.year, 0, 1),
		link: p.data.link ?? p.data.doi ?? p.data.arxiv ?? p.data.pdf ?? `/publications/`,
		categories: ["publication"],
	}));

	const items = [...postItems, ...pubItems].sort(
		(a, b) => b.pubDate.getTime() - a.pubDate.getTime(),
	);

	return rss({
		title: siteConfig.title,
		description: siteConfig.description,
		site: context.site ?? siteConfig.url,
		items,
	});
}
