import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(process.cwd(), "..", "..");
const distDir = resolve(rootDir, "apps/extension/dist");

const requiredPaths = [
  "manifest.json",
  "worker.js",
  "extractor.js",
  "popup.js",
  "src/popup/popup.html"
];

for (const relativePath of requiredPaths) {
  const absolutePath = resolve(distDir, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing extension artifact: ${relativePath}`);
  }
}

const manifestPath = resolve(distDir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.manifest_version !== 3) {
  throw new Error("Manifest validation failed: manifest_version must be 3.");
}

if (manifest?.background?.service_worker !== "worker.js") {
  throw new Error("Manifest validation failed: background.service_worker must be worker.js.");
}

if (!Array.isArray(manifest.permissions) || !manifest.permissions.includes("scripting")) {
  throw new Error("Manifest validation failed: scripting permission is required.");
}

if (!Array.isArray(manifest.host_permissions) || !manifest.host_permissions.includes("<all_urls>")) {
  throw new Error("Manifest validation failed: <all_urls> host permission is required.");
}

if (Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0) {
  throw new Error("Manifest validation failed: declarative content_scripts must not be configured.");
}

const extractorPath = resolve(distDir, "extractor.js");
const extractorSizeBytes = statSync(extractorPath).size;
const maxExtractorSizeBytes = 5 * 1024 * 1024;
if (extractorSizeBytes > maxExtractorSizeBytes) {
  throw new Error(
    `Extractor bundle is too large: ${extractorSizeBytes} bytes (max ${maxExtractorSizeBytes} bytes).`
  );
}

const extractorSource = readFileSync(extractorPath, "utf8");
if (/^\s*import\s/m.test(extractorSource)) {
  throw new Error("Extractor validation failed: injected content script must not contain top-level ESM imports.");
}

console.log("extension dist smoke validation passed.");
