// Isolated examples: these values are not assertions about live Firestore balances.
export const fsContextSheets = [
  { id: 'fixture-east', district: 'East Mamprusi', region: 'North East', month: 'October 2026', rows: [
    { id: 'tuni', facility: 'Tuni CHPS', vaccines: {
      'BCG Vaccine 0.05 mL': { allocation: 10, distributed: 4, balance: '6' },
      'Amoxicillin 125 mg / 5 ml Suspension 100 ml': { allocation: 8, distributed: 3 },
    } },
  ] },
  { id: 'fixture-talensi', district: 'Talensi', region: 'Upper East', month: 'October 2026', rows: [
    { id: 'namolgo', facility: 'Presbyterian Health Center', subDistrict: 'Namolgo', vaccines: {} },
  ] },
];
export const fsContextCases = {
  a: { facility: { id: '', name: 'Tuni CHPS', district: 'East Mamprusi', region: 'North East' }, products: [{ id: '', name: 'BCG Vaccine 0.05mL', quantity: '1' }], manualFacilityId: '' },
  b: { facility: { id: '', name: 'Presbyterian HC, Namolgo', district: 'Talensi', region: 'Upper East' }, products: [], manualFacilityId: '' },
  c: { facility: { id: '', name: 'Tuni CHPS', district: 'East Mamprusi', region: 'North East' }, products: [{ id: '', name: 'Unallocated Product', quantity: '1' }], manualFacilityId: '' },
};
