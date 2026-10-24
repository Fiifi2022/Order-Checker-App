import { setGeneralProductNameAliases, type GeneralProductAliasState } from '../../shared/generalProductAliases';
import { catalogProductNames, type CatalogProduct } from '../../shared/productCatalog';
import { setGeneralMedicalTerminology } from './generalMedicalTerminology';
import { setMedicalProductAcronyms } from './medicalProductAcronyms';
import { setVaccinePairingCatalog } from '../../shared/vaccinePairing';
import { setGeneralVaccineCatalog } from '../../shared/generalVaccineCatalog';
import { setGeneralProductCategories } from './generalProductCategory';

export function applyGeneralCatalog(products: CatalogProduct[], aliases?: GeneralProductAliasState) {
  setGeneralProductNameAliases(aliases, products);
  setVaccinePairingCatalog(products);
  setGeneralVaccineCatalog(products);
  setGeneralProductCategories(products);
  const general = products.filter(product => product.scope === 'general');
  setGeneralMedicalTerminology(general.map(product => ({
    canonicalName: product.name, normalizationName: product.name, genericName: product.name,
    acronyms: [], brandNames: [], formulation: null, strength: null, ageGroup: null,
    ...product.terminology, aliases: catalogProductNames(product), contextualAliases: product.contextualAliases,
    category: product.category, note: product.note,
  })));
  setMedicalProductAcronyms(general.filter(product => product.acronym).map(product => ({
    name: product.name, aliases: (product.acronym!.aliases || []).filter(alias => product.aliases.includes(alias) && !product.contextualAliases.includes(alias)),
    category: product.acronym!.category, contextual: product.acronym!.contextual, note: product.note,
  })));
}
