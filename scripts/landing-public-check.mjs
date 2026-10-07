import { createHash } from "node:crypto";
const base = process.argv[2] || "https://oceanseo.gellaronline.cc";
if (new URL(base).protocol !== "https:") throw Error("HTTPS required");
const expected = new Map([
  ["/", 200],
  ["/privacy/", 200],
  ["/health", 200],
  ["/v1/vault", 401],
  ["/metrics", 401],
  ["/not-a-page", 404],
  ["/.env", 404],
  ["/src/App.tsx", 404],
  ["/connection.json", 404],
  ["/media/hero-desktop.webp", 200],
  ["/media/hero-mobile.webp", 200],
  ["/media/app-chat.webp", 200],
  ["/media/app-calendar.webp", 200],
  ["/media/app-delivery.webp", 200],
  ["/media/download-qr.png", 200],
  ["/fonts/outfit.ttf", 200],
  ["/THIRD_PARTY_NOTICES.txt", 200],
]);
for (const [path, status] of expected) {
  const response = await fetch(`${base}${path}`, { redirect: "error" });
  if (response.status !== status)
    throw Error(`${path}: ${response.status}, expected ${status}`);
  if (
    ["/v1/vault", "/metrics"].includes(path) &&
    !response.headers
      .get("cache-control")
      ?.split(",")
      .map((x) => x.trim())
      .includes("no-store")
  )
    throw Error("Private API cache policy");
  if (path === "/" && !response.headers.get("content-security-policy"))
    throw Error("CSP missing");
  const bytes = await response.arrayBuffer();
  if (
    path === "/" &&
    new TextDecoder().decode(bytes).includes("cloudflareinsights")
  )
    throw Error("Unexpected analytics injection");
  console.log(`${status} ${path}`);
}
for (const path of ["/downloads/", "/media/", "/fonts/"]) {
  const response = await fetch(`${base}${path}`, { redirect: "error" });
  if (![403, 404].includes(response.status))
    throw Error(`Directory exposed: ${path}`);
  await response.arrayBuffer();
  console.log(`${response.status} ${path} (no listing)`);
}
for (const [name, size, checksum] of [
  [
    "Tideplan_0.18.0_android_arm64_internal.apk",
    67073867,
    "37f013e8da37afaee137b14fbf15651647e492b4d31c5bbdf97a7347c6b12adf",
  ],
  [
    "Tideplan_0.18.0_amd64.deb",
    9090852,
    "267b4c53afddaa2f1c113cb5e2af8678aa276ca9c1874e1b6b4502bf406ec7d3",
  ],
]) {
  const url = `${base}/downloads/${name}`;
  const response = await fetch(url, { redirect: "error" });
  if (
    response.status !== 200 ||
    !response.headers.get("content-disposition")?.startsWith("attachment")
  )
    throw Error("Download headers");
  const hash = createHash("sha256");
  let received = 0;
  for await (const chunk of response.body) {
    hash.update(chunk);
    received += chunk.length;
  }
  if (received !== size || hash.digest("hex") !== checksum)
    throw Error(`${name}: hash/size mismatch`);
  const range = await fetch(url, {
    headers: { Range: "bytes=0-1023" },
    redirect: "error",
  });
  if (range.status !== 206 || (await range.arrayBuffer()).byteLength !== 1024)
    throw Error("Range download unsupported");
  const publishedHash = await (
    await fetch(`${url}.sha256`, { redirect: "error" })
  ).text();
  if (!publishedHash.startsWith(checksum))
    throw Error("Published checksum mismatch");
  console.log(`${name}: ${received} bytes, SHA-256 verified, range 206`);
}
