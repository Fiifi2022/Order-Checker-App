import type { CatalogProduct } from '../../shared/productCatalog';
import { setGeneralMedicalTerminology } from './generalMedicalTerminology';
import { setMedicalProductAcronyms } from './medicalProductAcronyms';

export function applyGeneralCatalog(products: CatalogProduct[]) {
  const general = products.filter(product => product.scope === 'general');
  setGeneralMedicalTerminology(general.map(product => ({
    canonicalName: product.name, normalizationName: product.name, genericName: product.name,
    acronyms: [], brandNames: [], formulation: null, strength: null, ageGroup: null,
    ...product.terminology, aliases: product.aliases, contextualAliases: product.contextualAliases,
    category: product.category, note: product.note,
  })));
  setMedicalProductAcronyms(general.filter(product => product.acronym).map(product => ({
    name: product.name, aliases: (product.acronym!.aliases || []).filter(alias => product.aliases.includes(alias) && !product.contextualAliases.includes(alias)),
    category: product.acronym!.category, contextual: product.acronym!.contextual, note: product.note,
  })));
}
