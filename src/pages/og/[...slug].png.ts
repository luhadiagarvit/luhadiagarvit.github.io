import { readFileSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { getCollection } from "astro:content";
import satori from "satori";
import { html } from "satori-html";
import type { APIContext } from "astro";
import { siteConfig } from "@/site.config";

const fontRegular = readFileSync(path.join(process.cwd(), "src/assets/roboto-mono-regular.ttf"));
const fontBold = readFileSync(path.join(process.cwd(), "src/assets/roboto-mono-700.ttf"));

const W = 1200;
const H = 630;
const BG = "#1a1a22";
const FG = "#e5e7eb";
const MUTED = "#9ca3af";
const ACCENT = "#6ee7b7";

function escape(s: string) {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function card(title: string) {
	const titleSize = title.length > 48 ? 64 : 84;
	const hostname = siteConfig.url.replace(/^https?:\/\//, "");
	// Single line, no whitespace between tags. Satori rejects whitespace text nodes as extra children.
	const markup = `<div style="display:flex;flex-direction:column;justify-content:space-between;width:${W}px;height:${H}px;background:${BG};color:${FG};padding:80px;font-family:Roboto Mono"><div style="display:flex;flex-direction:column"><div style="font-size:28px;color:${MUTED};letter-spacing:0.05em">${escape(siteConfig.author.toUpperCase())}</div><div style="display:flex;width:60px;height:4px;background:${ACCENT};margin-top:18px"></div></div><div style="display:flex;font-size:${titleSize}px;font-weight:700;line-height:1.1;max-width:1040px">${escape(title)}</div><div style="display:flex;justify-content:space-between;align-items:flex-end;font-size:24px;color:${MUTED}"><div style="display:flex">${escape(hostname)}</div><div style="display:flex">data · images · research</div></div></div>`;
	return html(markup);
}

export async function getStaticPaths() {
	const posts = await getCollection("post", ({ data }) => !data.draft);
	const publications = await getCollection("publications");

	const pages: { slug: string; title: string }[] = [
		{ slug: "index", title: siteConfig.author },
		{ slug: "photos", title: "Photos" },
		{ slug: "publications", title: "Publications" },
		{ slug: "cv", title: "CV" },
		{ slug: "contact", title: "Contact" },
		{ slug: "now", title: "Now" },
		{ slug: "posts", title: "Posts" },
		{ slug: "tags", title: "Tags" },
	];

	return [
		...pages.map((p) => ({ params: { slug: p.slug }, props: { title: p.title } })),
		...posts.map((p) => ({
			params: { slug: `posts/${p.id}` },
			props: { title: p.data.title },
		})),
		...publications.map((p) => ({
			params: { slug: `publications/${p.id}` },
			props: { title: p.data.title },
		})),
	];
}

export async function GET({ props }: APIContext) {
	const { title } = props as { title: string };
	const svg = await satori(card(title), {
		width: W,
		height: H,
		fonts: [
			{ name: "Roboto Mono", data: fontRegular, weight: 400, style: "normal" },
			{ name: "Roboto Mono", data: fontBold, weight: 700, style: "normal" },
		],
	});
	const png = new Resvg(svg).render().asPng();
	return new Response(png as BodyInit, {
		headers: {
			"Content-Type": "image/png",
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	});
}
