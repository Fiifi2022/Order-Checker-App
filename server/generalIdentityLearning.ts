import {createHash} from 'node:crypto';
import {identityPairKey,type IdentityField} from '../src/utils/generalIdentityDecision';
import {normalizeGeneralFacilityName} from '../src/utils/generalFacility';
/** Suggestions are scoped evidence, never customer identity or facility directory aliases. */
export function identityVariationId(field:IdentityField,value:{whatsappValue:string;fulfillmentValue:string},facility:{whatsappValue:string;fulfillmentValue:string}){
 const context=field==='orderer'?[facility.whatsappValue,facility.fulfillmentValue].map(normalizeGeneralFacilityName).sort():[];
 return createHash('sha256').update(JSON.stringify([identityPairKey(field,value.whatsappValue,value.fulfillmentValue),context])).digest('hex');
}
