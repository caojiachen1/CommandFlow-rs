import { mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "dist");

await mkdir(outDir, { recursive: true });
await mkdir(resolve(root, "popup"), { recursive: true });

const common = {
  bundle: true,
  sourcemap: true,
  target: "es2022",
  format: "esm",
  logLevel: "info"
};

const jobs = [
  {
    entryPoints: [resolve(root, "src/background.ts")],
    outfile: resolve(outDir, "background.js")
  },
  {
    entryPoints: [resolve(root, "src/content.ts")],
    outfile: resolve(outDir, "content.js")
  },
  {
    entryPoints: [resolve(root, "src/injected.ts")],
    outfile: resolve(outDir, "injected.js")
  },
  {
    entryPoints: [resolve(root, "src/popup.ts")],
    outfile: resolve(root, "popup/popup.js")
  }
];

if (watch) {
  for (const job of jobs) {
    const ctx = await esbuild.context({ ...common, ...job });
    await ctx.watch();
  }
  console.log("[edge-automation-bridge] watch mode started");
} else {
  await Promise.all(jobs.map((job) => esbuild.build({ ...common, ...job })));
  console.log("[edge-automation-bridge] build done");
}

await copyFile(resolve(root, "src/popup.html"), resolve(root, "popup/popup.html"));
await copyFile(resolve(root, "manifest.json"), resolve(root, "dist/manifest.json"));
