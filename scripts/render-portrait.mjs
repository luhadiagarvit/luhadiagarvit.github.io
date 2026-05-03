// Regenerate public/portrait/L{1..5}.txt from a single source photo. Requires jp2a (brew install jp2a). Not wired to build.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/render-portrait.mjs <path-to-photo>");
  process.exit(1);
}

const widths = { 1: 22, 2: 36, 3: 50, 4: 64, 5: 80 };

for (const [level, width] of Object.entries(widths)) {
  const art = execFileSync("jp2a", ["--width=" + width, "--chars= .,:;clodxkO0KXNW", source], { encoding: "utf8" });
  writeFileSync(`public/portrait/L${level}.txt`, art);
  console.log(`wrote public/portrait/L${level}.txt (${width} chars wide)`);
}
