import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const frenchWords = require("an-array-of-french-words");

const ROOT_DIR = process.cwd();
const OUTPUT_PATH = path.join(ROOT_DIR, "src", "data", "frenchWordsByLength.json");
const TARGET_LENGTHS = [5, 6, 7];

const normalizeWord = (word) =>
  word
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();

const wordsByLength = Object.fromEntries(
  TARGET_LENGTHS.map((length) => [length, []]),
);

for (const rawWord of frenchWords) {
  const normalized = normalizeWord(rawWord);
  const length = normalized.length;

  if (!TARGET_LENGTHS.includes(length)) {
    continue;
  }

  wordsByLength[length].push(normalized);
}

for (const length of TARGET_LENGTHS) {
  wordsByLength[length] = Array.from(new Set(wordsByLength[length])).sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
}

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(wordsByLength, null, 2)}\n`, "utf8");

console.log(
  `Dictionnaire genere: ${OUTPUT_PATH}\nMots sources: ${frenchWords.length}\nMots 5 lettres: ${wordsByLength[5].length}\nMots 6 lettres: ${wordsByLength[6].length}\nMots 7 lettres: ${wordsByLength[7].length}`,
);
