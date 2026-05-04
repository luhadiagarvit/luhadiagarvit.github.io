import { getCollection } from "astro:content";

export type Slug = string;

export interface GraphNode {
	slug: Slug;
	title: string;
	kind: "post" | "note" | "evergreen";
	tags: string[];
}

export interface GraphEdge {
	source: Slug;
	target: Slug;
}

export interface GraphStub {
	slug: Slug;          // slugified target name
	raw: string;         // original wikilink text inside [[ ]]
	inboundFrom: Slug[]; // notes that link to this stub
}

export interface NoteGraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
	stubs: GraphStub[];
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

export function slugifyWikilink(raw: string): Slug {
	return raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export async function buildNoteGraph(): Promise<NoteGraph> {
	const notes = await getCollection("notes", ({ data }) => !data.draft);
	const slugSet = new Set<Slug>(notes.map((n) => n.id));
	const nodes: GraphNode[] = notes.map((n) => ({
		slug: n.id,
		title: n.data.title,
		kind: n.data.kind,
		tags: n.data.tags,
	}));
	const edges: GraphEdge[] = [];
	const stubMap = new Map<Slug, GraphStub>();

	for (const note of notes) {
		const body = note.body ?? "";
		const seenInThisNote = new Set<Slug>();
		let m: RegExpExecArray | null;
		WIKILINK_RE.lastIndex = 0;
		while ((m = WIKILINK_RE.exec(body)) !== null) {
			const raw = m[1];
			if (!raw) continue;
			const target = slugifyWikilink(raw);
			if (!target || target === note.id) continue;
			if (seenInThisNote.has(target)) continue;
			seenInThisNote.add(target);
			if (slugSet.has(target)) {
				edges.push({ source: note.id, target });
			} else {
				const existing = stubMap.get(target);
				if (existing) {
					if (!existing.inboundFrom.includes(note.id)) existing.inboundFrom.push(note.id);
				} else {
					stubMap.set(target, { slug: target, raw, inboundFrom: [note.id] });
				}
			}
		}
	}

	return { nodes, edges, stubs: Array.from(stubMap.values()) };
}
