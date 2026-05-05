import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { visit } from "unist-util-visit";

import { slugifyWikilink } from "./slugify";

const NOTES_DIR = fileURLToPath(new URL("../content/notes/", import.meta.url));
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function collectSlugs(dir: string, base = dir): Set<string> {
	const out = new Set<string>();
	let entries: string[] = [];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const e of entries) {
		const full = join(dir, e);
		let st;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			for (const s of collectSlugs(full, base)) out.add(s);
		} else if (/\.(md|mdx)$/.test(e)) {
			const rel = relative(base, full).replace(/\\/g, "/");
			const slug = rel.replace(/\.(md|mdx)$/, "");
			out.add(slug.toLowerCase());
		}
	}
	return out;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function wikilinkRemark() {
	return (tree: unknown) => {
		const slugs = collectSlugs(NOTES_DIR);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		visit(tree as any, "text", (node: any, index: number | undefined, parent: any) => {
			if (!parent || index === undefined) return;
			if (parent.type === "link") return;
			const value: string = node.value;
			if (!value || value.indexOf("[[") === -1) return;
			const newChildren: unknown[] = [];
			let last = 0;
			let m: RegExpExecArray | null;
			WIKILINK_RE.lastIndex = 0;
			while ((m = WIKILINK_RE.exec(value)) !== null) {
				if (m.index > last) {
					newChildren.push({ type: "text", value: value.slice(last, m.index) });
				}
				const raw = m[1] ?? "";
				const target = slugifyWikilink(raw);
				if (slugs.has(target)) {
					newChildren.push({
						type: "html",
						value: `<a href="/notes/${target}/" class="cactus-link">${escapeHtml(raw)}</a>`,
					});
				} else {
					newChildren.push({
						type: "html",
						value: `<span class="stub-link" data-slug="${escapeHtml(target)}">${escapeHtml(raw)}</span>`,
					});
				}
				last = m.index + m[0].length;
			}
			if (last < value.length) {
				newChildren.push({ type: "text", value: value.slice(last) });
			}
			if (newChildren.length > 0) {
				parent.children.splice(index, 1, ...newChildren);
				return index + newChildren.length;
			}
			return undefined;
		});
	};
}
