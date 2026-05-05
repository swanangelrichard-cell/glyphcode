import frenchWordsByLength from "./data/frenchWordsByLength.json";

export type SupportedWordLength = 5 | 6 | 7;

type DictionaryByLength = Record<SupportedWordLength, string[]>;

const dictionaryByLength = frenchWordsByLength as DictionaryByLength;

const buildPreferredWords = (
  words: readonly string[],
  validWordSet: ReadonlySet<string>,
) => words.filter((word) => validWordSet.has(word));

const PREFERRED_SECRET_WORDS: Record<SupportedWordLength, readonly string[]> = {
  5: [
    "POMME",
    "TABLE",
    "FLEUR",
    "SUCRE",
    "ROUTE",
    "PLAGE",
    "MONDE",
    "RIVET",
    "CABLE",
    "SALON",
    "CHIEN",
    "LIVRE",
    "TERRE",
    "TRACE",
    "NOEUD",
    "BRISE",
    "CHUTE",
    "CORDE",
    "PLUME",
    "FROID",
    "MOTIF",
    "NUAGE",
    "VAGUE",
    "BRUIT",
    "PIANO",
    "FRUIT",
    "GLACE",
    "PHARE",
    "RAYON",
  ],
  6: [
    "ANANAS",
    "BATEAU",
    "BUREAU",
    "CHANSON",
    "CHEVAL",
    "CITRON",
    "DESSIN",
    "ETOILE",
    "FLECHE",
    "FORETS",
    "FROMAG",
    "GARAGE",
    "JARDIN",
    "LAPINS",
    "MUSIQUE",
    "ORANGE",
    "PAPIER",
    "POESIE",
    "RIVAGE",
    "SOLEIL",
    "TOMATE",
    "VALISE",
    "VOYAGE",
    "ZEBRES",
  ],
  7: [
    "ABRITER",
    "BAGUETTE",
    "BATEAUX",
    "BONHEUR",
    "CAPTURE",
    "CERISES",
    "CHANSON",
    "CHATEAU",
    "CUISINE",
    "DOUCEUR",
    "ECLAIRE",
    "ENCREUR",
    "FAMILLE",
    "FERMIER",
    "JOURNEE",
    "LUMIERE",
    "NATUREL",
    "ORAGEUX",
    "PAYSAGE",
    "POETIQUE",
    "RIVIERE",
    "SAVOURE",
    "TENDRES",
    "VOYAGER",
  ],
};

const validWordsByLength: DictionaryByLength = {
  5: dictionaryByLength[5],
  6: dictionaryByLength[6],
  7: dictionaryByLength[7],
};

const secretWordsByLength: DictionaryByLength = {
  5: buildPreferredWords(PREFERRED_SECRET_WORDS[5], new Set(validWordsByLength[5])),
  6: buildPreferredWords(PREFERRED_SECRET_WORDS[6], new Set(validWordsByLength[6])),
  7: buildPreferredWords(PREFERRED_SECRET_WORDS[7], new Set(validWordsByLength[7])),
};

for (const length of [5, 6, 7] as const) {
  if (secretWordsByLength[length].length === 0) {
    secretWordsByLength[length] = validWordsByLength[length];
  }
}

export const VALID_WORDS_BY_LENGTH = validWordsByLength;
export const SECRET_WORDS_BY_LENGTH = secretWordsByLength;
