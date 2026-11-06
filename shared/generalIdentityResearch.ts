type ResearchIdentity = {
 whatsappValue?:string;
 fulfillmentValue?:string;
 identityDecision?:{action:string;revision?:number};
};

/** Reset retains history but reopens the comparison; it is not an approval. */
export function hasActiveIdentityDecision(value:ResearchIdentity|undefined|null){
 return Boolean(value?.identityDecision&&value.identityDecision.action!=='reset');
}

export function identityResearchGeneration(details:{facility?:ResearchIdentity;orderer?:ResearchIdentity}|undefined){
 return (['facility','orderer'] as const).map(field=>details?.[field]?.identityDecision?.revision||0);
}

/** A result belongs to the exact decision generation it started from. */
export function canApplyIdentityResearch(current:ResearchIdentity|undefined,original:ResearchIdentity|undefined){
 return Boolean(current&&original&&!hasActiveIdentityDecision(current)&&
  current.whatsappValue===original.whatsappValue&&current.fulfillmentValue===original.fulfillmentValue&&
  (current.identityDecision?.revision||0)===(original.identityDecision?.revision||0));
}
