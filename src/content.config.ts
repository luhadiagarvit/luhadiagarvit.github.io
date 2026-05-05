import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const photos = defineCollection({
	loader: glob({ base: "./src/content/photos", pattern: "**/*.{md,mdx}" }),
	schema: ({ image }) =>
		z.object({
			src: image(),
			alt: z.string().default(""),
			date: z.string().or(z.date()).transform((val) => new Date(val)),
			location: z.string().optional(),
			camera: z.string().optional(),
			lens: z.string().optional(),
			draft: z.boolean().default(false),
		}),
});

const publications = defineCollection({
	loader: glob({ base: "./src/content/publications", pattern: "**/*.{md,mdx}" }),
	schema: z.object({
		title: z.string(),
		venue: z.string(),
		year: z.number(),
		authors: z.array(z.string()).default([]),
		status: z.enum(["accepted", "submitted", "published", "preprint"]).default("accepted"),
		pdf: z.string().optional(),
		arxiv: z.string().optional(),
		doi: z.string().optional(),
		link: z.string().optional(),
		order: z.number().default(0),
	}),
});

const notes = defineCollection({
	loader: glob({ base: "./src/content/notes", pattern: "**/*.{md,mdx}" }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string().default(""),
			publishDate: z.string().or(z.date()).transform((val) => new Date(val)),
			updatedDate: z.string().or(z.date()).transform((val) => new Date(val)).optional(),
			tags: z.array(z.string()).default([]),
			draft: z.boolean().default(false),
			ogImage: z.string().optional(),
			coverImage: z
				.object({
					src: image(),
					alt: z.string().default(""),
				})
				.optional(),
			kind: z.enum(["post", "note", "evergreen"]).default("note"),
		}),
});

const commitments = defineCollection({
	loader: glob({ base: "./src/content/commitments", pattern: "**/*.{md,mdx}" }),
	schema: z.object({
		week: z.string().regex(/^\d{4}-W\d{2}$/),
		text: z.string(),
		state: z.enum(["doing", "done", "missed"]).default("doing"),
		link: z.string().optional(),
		deadline: z.string().or(z.date()).transform((v) => new Date(v)).optional(),
		order: z.number().default(0),
	}),
});

const trails = defineCollection({
	loader: glob({ base: "./src/content/trails", pattern: "**/*.{md,mdx}" }),
	schema: z.object({
		name: z.string(),
		park: z.string(),
		km: z.number(),
		ascent_m: z.number(),
		duration_min: z.number(),
		date: z.string().or(z.date()).transform((v) => new Date(v)),
		alltrails_url: z.string().optional(),
		gpx_path: z.string().optional(),
		elevation_profile: z.array(z.number()).length(64),
		photos: z.array(z.string()).default([]),
		featured: z.boolean().default(false),
	}),
});

export const collections = { photos, publications, notes, commitments, trails };
