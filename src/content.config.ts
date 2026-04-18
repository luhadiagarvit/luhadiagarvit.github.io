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

const post = defineCollection({
	loader: glob({ base: "./src/content/post", pattern: "**/*.{md,mdx}" }),
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
		}),
});

export const collections = { photos, publications, post };
