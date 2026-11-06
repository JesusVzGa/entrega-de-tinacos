import { cpSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
const target = path.resolve("public/ocr");
mkdirSync(target + "/core", { recursive: true });
mkdirSync(target + "/lang", { recursive: true });
cpSync("node_modules/tesseract.js/dist/worker.min.js", target + "/worker.min.js");
for (const file of readdirSync("node_modules/tesseract.js-core")) {
  if (file.endsWith(".wasm") || file.endsWith(".wasm.js")) cpSync("node_modules/tesseract.js-core/" + file, target + "/core/" + file);
}
cpSync("node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz", target + "/lang/spa.traineddata.gz");
console.log("OCR assets ready.");
