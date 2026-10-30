import test from 'node:test';
import assert from 'node:assert/strict';
import {saveCatalogProduct,productCatalogHandlers} from './productCatalog';
import {trackCatalogueAliasEdits} from './catalogAliasLearning';
import type {ProductCatalog} from '../shared/productCatalog';
const catalog:ProductCatalog={revision:7,products:[
 {id:'general-a',scope:'general',name:'Fixture product',category:'consumable',aliases:['Fixture abbreviation'],contextualAliases:[],note:'',linkedProductId:'vaccine-a'},
 {id:'vaccine-a',scope:'vaccine',name:'Fixture counterpart',category:'companion',aliases:['Counterpart alias'],contextualAliases:[],note:'',linkedProductId:'general-a'},
]};
test('delete removes only selected product, unlinks counterpart and deactivates aliases with history',()=>{
 const before=JSON.stringify(catalog);
 const result=trackCatalogueAliasEdits(catalog,saveCatalogProduct(catalog,{action:'delete',id:'general-a',revision:7},'editor@example.com'),'editor@example.com');
 assert.equal(result.catalog.revision,8);assert.equal(result.catalog.products.length,1);
 assert.equal(result.catalog.products[0].id,'vaccine-a');assert.equal(result.catalog.products[0].linkedProductId,'');
 assert.deepEqual(result.catalog.products[0].aliases,['Counterpart alias']);
 assert.equal(result.events.length,1);assert.equal(result.events[0].action,'deactivate');assert.equal(result.events[0].after.active,false);
 assert.equal(result.catalog.aliasRecords?.filter(row=>row.productId==='general-a'&&row.active).length,0);
 assert.equal(JSON.stringify(catalog),before);
});
test('delete rejects stale revisions, missing products and absent IDs',()=>{
 assert.throws(()=>saveCatalogProduct(catalog,{action:'delete',id:'general-a',revision:6},'editor'),{status:409});
 assert.throws(()=>saveCatalogProduct(catalog,{action:'delete',id:'unknown',revision:7},'editor'),{status:404});
 assert.throws(()=>saveCatalogProduct(catalog,{action:'delete',revision:7},'editor'),{status:400});
});
test('existing catalogue save endpoint enforces editing permissions for deletion and publishes updated catalogue',async()=>{
 let writes=0,status=200,body:any;
 const handler=productCatalogHandlers({read:async()=>catalog,save:async(input,actor)=>{writes++;return saveCatalogProduct(catalog,input,actor);}}).save;
 const response:any={locals:{authUser:{email:'cca@example.com',role:'cca'}},setHeader(){},status(value:number){status=value;return this;},json(value:any){body=value;}};
 const request:any={body:{action:'delete',id:'general-a',revision:7}};
 await handler(request,response,()=>{});assert.equal(status,403);assert.equal(writes,0);
 response.locals.authUser={email:'editor@example.com',role:'warehouse'};status=200;
 await handler(request,response,()=>{});assert.equal(status,200);assert.equal(writes,1);assert.equal(body.canEdit,true);assert.equal(body.products.length,1);
});
