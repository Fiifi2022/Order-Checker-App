import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Suggestions from '../src/components/GeneralCatalogueSuggestions';
import {generalFsProductSuggestionOptions} from '../src/utils/generalFsProductSuggestions';
import type {ProductResearchSuggestion} from '../shared/productResearch';

const group:ProductResearchSuggestion={alias:'Folic acid',customerValue:'Folic acid',
  fulfillmentValue:"Thank you Francis from Akokoaso HC. Folic acid 5mg Tablet [1/1]; Ringer's Lactate [10/10]; Dextrose [0/1]",
  status:'suggested',researchStatus:'catalogue',options:[
    {kind:'source',sourceName:'Folic acid 5mg Tablet',productId:'source:folic5',name:'Folic acid 5mg Tablet',reason:'Same ingredient, verify the presentation.'},
    {productId:'folic1',name:'Folic acid 1mg Tablet',reason:'A catalogue alternative absent from this FS order.'}
  ]};
const fsProducts=[{name:'Folic acid 5mg Tablet',canonicalId:'folic5'},
  {name:"Ringer's Lactate Solution, 500 ml",canonicalId:'rl'},
  {name:'Dextrose 5% Infusion, 500mL',canonicalId:'d5'}];

test('a product suggestion displays only its relevant FS candidate, never the full FS confirmation',()=>{
  const html=renderToStaticMarkup(createElement(Suggestions,{suggestions:[group],fsProducts,onAction:async()=>{}}));
  assert.match(html,/Customer requested: Folic acid/);
  assert.match(html,/Possible FS match: Folic acid 5mg Tablet/);
  assert.match(html,/Decision: Confirm match or mark as discrepancy/);
  assert.doesNotMatch(html,/Thank you|Francis|Akokoaso|Ringer|Dextrose|1mg Tablet|FS Confirmation:/);
  assert.match(html,/Quantity differences remain checked separately/);
  assert.match(html,/Confirm match and resume/);assert.match(html,/Mark discrepancy/);
});
test('multiple relevant FS presentations remain selectable while unrelated FS entries stay excluded',()=>{
  const suggestions=[{...group,options:[...group.options,
    {kind:'source' as const,sourceName:'Absent FS product',productId:'source:absent',name:'Absent FS product',reason:'Stale source candidate'}]}];
  const html=renderToStaticMarkup(createElement(Suggestions,{suggestions,fsProducts:[...fsProducts,{name:'Folic acid 1mg Tablet',canonicalId:'folic1'}]}));
  assert.match(html,/Possible FS matches:/);assert.match(html,/Folic acid 5mg Tablet/);assert.match(html,/Folic acid 1mg Tablet/);
  assert.doesNotMatch(html,/Absent FS product|Ringer|Dextrose|Thank you/);
});
test('catalogue candidates use actual FS product wording and retain their decision IDs',()=>{
  const original=[{productId:'folic5',name:'Folic acid tablet 5 mg',reason:'Verify presentation'}];
  const snapshot=JSON.stringify(original);
  const options=generalFsProductSuggestionOptions(original,fsProducts);
  assert.deepEqual(options,[{...original[0],name:'Folic acid 5mg Tablet'}]);
  assert.equal(options[0].productId,'folic5');assert.equal(JSON.stringify(original),snapshot);
});
test('no relevant FS candidate leaves confirmation unavailable instead of showing the entire confirmation',()=>{
  const html=renderToStaticMarkup(createElement(Suggestions,{suggestions:[group],fsProducts:[],onAction:async()=>{}}));
  assert.match(html,/Possible FS match: No supported candidate yet/);
  assert.match(html,/aria-label="Confirm match and resume" disabled=""/);
  assert.doesNotMatch(html,/Folic acid 5mg Tablet|Ringer|Dextrose|Thank you/);
  assert.match(html,/Mark discrepancy/);assert.match(html,/Search Again/);
});
