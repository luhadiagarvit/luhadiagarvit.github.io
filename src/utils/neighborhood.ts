import { buildNoteGraph, type GraphNode, type Slug } from "./buildGraph";

export interface Neighborhood {
	backlinks: GraphNode[];
	forwards: GraphNode[];
	siblings: GraphNode[];
}

export async function getNeighborhood(slug: Slug): Promise<Neighborhood> {
	const graph = await buildNoteGraph();
	const byId = new Map(graph.nodes.map((n) => [n.slug, n]));
	const self = byId.get(slug);
	if (!self) {
		return { backlinks: [], forwards: [], siblings: [] };
	}
	const backlinks: GraphNode[] = [];
	const forwards: GraphNode[] = [];
	const seenForward = new Set<Slug>();
	const seenBack = new Set<Slug>();
	for (const e of graph.edges) {
		if (e.source === slug && !seenForward.has(e.target)) {
			const n = byId.get(e.target);
			if (n) {
				forwards.push(n);
				seenForward.add(e.target);
			}
		}
		if (e.target === slug && !seenBack.has(e.source)) {
			const n = byId.get(e.source);
			if (n) {
				backlinks.push(n);
				seenBack.add(e.source);
			}
		}
	}
	const siblingMap = new Map<Slug, { node: GraphNode; overlap: number }>();
	const selfTagSet = new Set(self.tags);
	for (const n of graph.nodes) {
		if (n.slug === slug) continue;
		if (seenForward.has(n.slug) || seenBack.has(n.slug)) continue;
		const overlap = n.tags.filter((t) => selfTagSet.has(t)).length;
		if (overlap >= 2) siblingMap.set(n.slug, { node: n, overlap });
	}
	const siblings = Array.from(siblingMap.values())
		.sort((a, b) => b.overlap - a.overlap)
		.map((x) => x.node);
	return { backlinks, forwards, siblings };
}
