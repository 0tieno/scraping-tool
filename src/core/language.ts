/**
 * Tiny stop-word language detector for the languages common in African procurement
 * (English, French, Portuguese). Returns null when the text is too short or ambiguous.
 */
const STOPWORDS: Record<string, string[]> = {
  en: ["the", "of", "and", "for", "to", "in", "with", "supply", "services", "consultancy", "provision", "procurement"],
  fr: ["de", "la", "le", "les", "des", "du", "pour", "et", "d'un", "d'une", "recrutement", "cabinet", "fourniture", "travaux", "acquisition", "réalisation", "élaboration"],
  pt: ["de", "da", "do", "das", "dos", "para", "e", "aquisição", "fornecimento", "contratação", "serviços", "consultoria"],
};

export function detectLanguage(text: string): string | null {
  const words = text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .split(/[^\p{L}']+/u)
    .filter(Boolean)
    .slice(0, 300);
  if (words.length < 3) return null;
  const scores = Object.entries(STOPWORDS).map(([lang, list]) => {
    const set = new Set(list);
    return [lang, words.filter((w) => set.has(w)).length] as const;
  });
  scores.sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  if (!best || best[1] < 2) return null;
  // Require a clear margin; French and Portuguese share "de".
  if (second && best[1] < second[1] * 1.5) return null;
  return best[0];
}
