import { catalogProductNames, type CatalogProduct } from '../../shared/productCatalog';
import { CLINICAL_PAIRINGS } from '../../shared/vaccinePairing';
import { isConflictingVaccineAlias } from '../../shared/generalVaccineCatalog';
import { generalMedicalTerminology } from './generalMedicalTerminology';
import { medicalProductAcronyms } from './medicalProductAcronyms';

export type GeneralProductCategory = 'Vaccine' | 'Vaccine Companion' | 'Medical Product' | 'Blood Product' | 'Consumable' | 'Diagnostic Product' | 'Other Product';
let catalog: CatalogProduct[] | undefined;
let categories: Map<string, GeneralProductCategory> | undefined;
let qualifiedCategories: { tokens: string[]; category: GeneralProductCategory }[] = [];

export function setGeneralProductCategories(products: CatalogProduct[]) {
  catalog = products;
  categories = undefined;
}

function categoryFor(name: string, category: string, vaccineScope = false): GeneralProductCategory {
  const kind = category.toLowerCase().trim();
  if (kind === 'blood' || kind === 'blood product') return 'Blood Product';
  if (kind === 'consumable' || kind === 'consumables') return 'Consumable';
  if (kind === 'diagnostic' || /\b(?:rapid diagnostic test|rdt)\b/i.test(name)) return 'Diagnostic Product';
  if (kind === 'companion') return 'Vaccine Companion';
  if (vaccineScope && /\b(?:soloshot|syringes?|needles?)\b/i.test(name)) return 'Consumable';
  if (vaccineScope || kind === 'vaccine') return /\b(?:diluent|dropper)\b/i.test(name) ? 'Vaccine Companion' : 'Vaccine';
  if (['medicine', 'rabies'].includes(kind) && /\bvaccine(?:\s+injection)?$/i.test(name)) return 'Vaccine';
  if (['medicine', 'medical product', 'medical', 'drug', 'fluid', 'rabies', 'antivenom'].includes(kind)) return 'Medical Product';
  return 'Other Product';
}

export function generalProductCategory(name: string, normalize: (name: string) => string, serverCategory?: GeneralProductCategory): GeneralProductCategory {
  // The standalone extension acknowledgement bundle has no loaded catalog;
  // retain the category supplied by the authoritative audit in that case.
  if (!catalog && serverCategory) return serverCategory;
  if (!categories) {
    const candidates = new Map<string, Set<GeneralProductCategory>>();
    const add = (labels: string[], category: GeneralProductCategory) => labels.forEach(label => {
      const key = normalize(label);
      const values = candidates.get(key) || new Set<GeneralProductCategory>();
      values.add(category); candidates.set(key, values);
    });
    if (catalog) {
      for (const product of catalog) add(catalogProductNames(product).filter(label =>
        !product.contextualAliases.includes(label) && !(product.scope === 'vaccine' && isConflictingVaccineAlias(label))), categoryFor(product.name, product.category, product.scope === 'vaccine'));
    } else {
      for (const term of generalMedicalTerminology) add([term.canonicalName, ...term.aliases.filter(alias => !term.contextualAliases.includes(alias))], categoryFor(term.canonicalName, term.category));
      for (const term of medicalProductAcronyms.filter(term => !term.contextual)) add([term.name, ...term.aliases], categoryFor(term.name, term.category));
      for (const [primary, pairing] of Object.entries(CLINICAL_PAIRINGS)) {
        add([primary], 'Vaccine'); add([pairing.name], 'Vaccine Companion');
      }
    }
    categories = new Map([...candidates].map(([key, values]) => {
      const specific = [...values].filter(category => category !== 'Other Product');
      return [key, specific.length === 1 ? specific[0] : 'Other Product'] as const;
    }));
    qualifiedCategories = [...categories].filter(([, category]) => category !== 'Other Product')
      .map(([key, category]) => ({ tokens: key.split('|')[0].split(' ').filter(Boolean), category }))
      .sort((a, b) => b.tokens.length - a.tokens.length);
  }
  const key = normalize(name);
  const exact = categories.get(key);
  if (exact && exact !== 'Other Product') return exact;
  // A catalog identity keeps its category when an input adds strength, form,
  // volume or blood-group qualifiers. This never changes identity matching.
  const tokens = new Set(key.split('|')[0].split(' '));
  const matches = qualifiedCategories.filter(entry => entry.tokens.length && entry.tokens.every(token => tokens.has(token)));
  const best = matches[0];
  if (!best) return 'Other Product';
  return matches.some(entry => entry.tokens.length === best.tokens.length && entry.category !== best.category) ? 'Other Product' : best.category;
}
