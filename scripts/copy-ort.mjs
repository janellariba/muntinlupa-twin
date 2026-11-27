// copy-ort.mjs
// Copies onnxruntime-web's WebAssembly files into public/ort/ before each build, so the detector
// loads them from this site (no outside CDN). public/ort/ is generated: it is in .gitignore.
import { mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const src = "node_modules/onnxruntime-web/dist";
const dst = "public/ort";
mkdirSync(dst, { recursive: true });
const files = readdirSync(src).filter((f) => /^ort-wasm-simd-threaded\.jsep\.(wasm|mjs)$/.test(f));
if (!files.length) throw new Error("onnxruntime-web files not found: run npm install first");
for (const f of files) copyFileSync(join(src, f), join(dst, f));
console.log(`copied ${files.join(", ")} -> ${dst}/`);
