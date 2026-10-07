import { build as viteBuild } from "vite";
import { build } from "esbuild";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToString } from "react-dom/server";

await viteBuild({ configFile: resolve("landing/vite.config.ts") });
const notices = [
  "Oceanseo download website: third-party notices",
  "GSAP 3.15.0 / ScrollTrigger: Copyright (c) GreenSock. Standard no-charge license. https://gsap.com/standard-license/",
  "Vanta and React Bits are not distributed in this website.",
];
for (const path of [
  "node_modules/react/LICENSE",
  "node_modules/react-dom/LICENSE",
  "node_modules/scheduler/LICENSE",
  "node_modules/lenis/LICENSE",
  "node_modules/lucide-react/LICENSE",
  "node_modules/qrcode/license",
  "landing/public/fonts/OFL.txt",
]) {
  notices.push(`\n--- ${path} ---\n${await readFile(path, "utf8")}`);
}
await writeFile("dist-landing/THIRD_PARTY_NOTICES.txt", notices.join("\n\n"));
// Static HTML keeps download/privacy content usable without client JavaScript.
await mkdir("node_modules/.cache", { recursive: true });
const temp = await mkdtemp(resolve("node_modules/.cache/landing-"));
try {
  await build({
    entryPoints: ["landing/src/App.tsx"],
    outfile: `${temp}/app.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    packages: "external",
  });
  const { default: App } = await import(pathToFileURL(`${temp}/app.mjs`));
  const html = await readFile("dist-landing/index.html", "utf8");
  await writeFile(
    "dist-landing/index.html",
    html.replace("<!--app-html-->", renderToString(React.createElement(App))),
  );
  await mkdir("dist-landing/privacy", { recursive: true });
  await writeFile(
    "dist-landing/privacy/index.html",
    html
      .replace(
        "<!--app-html-->",
        renderToString(React.createElement(App, { privacy: true })),
      )
      .replace(
        "<title>Oceanseo · 个人生活中枢</title>",
        "<title>数据与隐私 · Oceanseo</title>",
      )
      .replace(
        'href="https://oceanseo.gellaronline.cc/"',
        'href="https://oceanseo.gellaronline.cc/privacy/"',
      ),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
