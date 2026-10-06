import { normalizeGeneralProductName, stripGeneralListPrefix } from './generalAuditor';

type Alias = { name: string; aliases: string[]; contextual?: boolean; note?: string };
const generic = new Set('need want please pls send give supply pack packed me we have of for today tomorrow adult child children paediatric pediatric syrup tablet capsule suspension injection solution cream oral intravenous vaccine diluent dropper bottle bottles units unit ml mg mcg iu the'.split(' '));
const words = (name: string) => {
  // Catalog facility prefixes are packaging metadata, not medicine families.
  const product = name.replace(/^\([^)]*\b(?:chps|hc|clinic|hospital|health cent(?:re|er))\)\s*/i, '');
  return new Set((normalizeGeneralProductName(product).match(/[a-z]{2,}|[a-z]\d+[a-z]*/g) || []).filter(word => !generic.has(word)));
};
const tokenKey = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const includesAlias = (text: string, alias: string) => tokenKey(text).includes(tokenKey(alias));

function nearby(a: string, b: string) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1) return false;
  // Retrieval only: a spelling neighbour never authorizes a product equivalence.
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) <= 1;
}

// Keep every strength/form/age variant of each retrieved family. Unknown or
// broad intentions get the full catalog, so retrieval cannot force a guess.
export function selectGeneralSemanticContext(customer: string, fulfilment: string, catalog: string[], aliases: readonly Alias[], vaccineAliases: Record<string, string[]>, retrievalCatalog = catalog) {
  const allAliases = [...aliases, ...Object.entries(vaccineAliases).map(([name, values]) => ({ name, aliases: values }))];
  const families = retrievalCatalog.map(name => ({ name, words: words(name) }));
  const selected = new Set<string>();
  let full = false;
  for (const raw of `${customer}\n${fulfilment}`.split(/\r?\n/)) {
    const line = stripGeneralListPrefix(raw);
    if (!line || /^(?:facility|orderer|requester|customer name|name|phone|contact|telephone)\s*:/i.test(line) ||
      /^(?:we are currently out of stock|we can prepare the following|thank you|hello\b|hi\b)/i.test(line)) continue;
    if (/\b(?:cough (?:syrup|medicine)|pain ?killers?|antibiotics?)\b/i.test(line)) { full = true; break; }
    const tokens = words(line);
    for (const entry of allAliases) if ([entry.name, ...entry.aliases].some(alias => includesAlias(line, alias))) {
      for (const word of words(entry.name)) tokens.add(word);
      selected.add(entry.name);
    }
    const matches = families.filter(family => [...family.words].some(word => [...tokens].some(token => nearby(word, token))));
    if (!matches.length) { full = true; break; }
    matches.forEach(family => selected.add(family.name));
  }
  const selectedWords = new Set([...selected].flatMap(name => [...words(name)]));
  const names = full || !selected.size ? catalog : catalog.filter(name => selected.has(name) || [...words(name)].some(word => selectedWords.has(word)));
  const familyWords = new Set(names.flatMap(name => [...words(name)]));
  const referencedWords = new Set(allAliases.filter(entry => [entry.name, ...entry.aliases].some(alias => includesAlias(`${customer}\n${fulfilment}`, alias)))
    .flatMap(entry => [...words(entry.name)]));
  const relevant = (entry: Alias) => names.includes(entry.name) || [...words(entry.name)].some(word => familyWords.has(word) || referencedWords.has(word)) ||
    entry.aliases.some(alias => includesAlias(`${customer}\n${fulfilment}`, alias));
  return {
    knownProductCatalog: names,
    aliases: aliases.filter(relevant),
    supportedVaccineAliases: Object.fromEntries(Object.entries(vaccineAliases).filter(([name, values]) => relevant({ name, aliases: values })))
  };
}
