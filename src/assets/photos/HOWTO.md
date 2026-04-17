Drop photos here as JPEG or PNG. Create a sibling markdown entry in
`src/content/photos/` (one file per image) with the frontmatter:

```yaml
---
src: ../../assets/photos/2026-03-les-01.jpg
alt: ""
date: 2026-03-14
location: Lower East Side
camera: Leica M6
lens: 35 Summicron
---
```

`draft: true` hides a photo from the grid.

Astro processes the image at build time: responsive `srcset`, webp, correct
dimensions, lazy loading — no manual optimization needed, but keep uploads
reasonable (≤4000px long edge) so the build doesn't blow up memory.
