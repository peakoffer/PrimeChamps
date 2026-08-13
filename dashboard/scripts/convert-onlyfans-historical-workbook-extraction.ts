import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  convertOnlyFansHistoricalWorkbookExtraction,
  type HistoricalWorkbookExtraction,
} from "../src/lib/research/historical-workbook-converter.ts";

const argumentsList = process.argv.slice(2);
const valueFor = (flag: string) => {
  const index = argumentsList.indexOf(flag);
  return index >= 0 ? argumentsList[index + 1] || "" : "";
};
const inputPath = valueFor("--input");
const baselinePath = valueFor("--baseline");
const outputPath = valueFor("--output");
if (!inputPath || !baselinePath || !outputPath) {
  throw new Error("Usage: node --experimental-strip-types scripts/convert-onlyfans-historical-workbook-extraction.ts --input enriched.raw.json --baseline baseline.raw.json --output records.json");
}

const read = async (filePath: string) => JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")) as HistoricalWorkbookExtraction;
const converted = convertOnlyFansHistoricalWorkbookExtraction({
  enriched: await read(inputPath),
  baseline: await read(baselinePath),
});
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(path.resolve(outputPath), JSON.stringify({
  validation: converted.validation,
  records: converted.records,
}, null, 2));
console.log(JSON.stringify({ output: path.resolve(outputPath), ...converted.validation }, null, 2));
