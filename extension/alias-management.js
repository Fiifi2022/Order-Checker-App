// Review UI only. Product identity and alias validation stay on the shared backend.
export function setupAliasManagement({ root, request, onUpdated }) {
 const document=root.ownerDocument;
 const toggle=document.createElement('button');toggle.type='button';toggle.className='btn-small';toggle.textContent='Alias Management';
 const section=document.createElement('section');section.hidden=true;section.setAttribute('aria-label','Alias Management');section.className='block';
 section.innerHTML='<h3>Alias Management</h3><p>Only verified, approved aliases are used for matching.</p><input type="search" aria-label="Search aliases" placeholder="Search alias or product"><select aria-label="Alias status"><option>pending</option><option>approved</option><option>rejected</option><option>inactive</option><option>all</option></select><button type="button" data-refresh>Refresh</button><form data-create hidden><input name="alias" required maxlength="160" aria-label="Alias text" placeholder="Alias text"><select name="product" required aria-label="Canonical product"></select><label><input type="checkbox" name="confirmed"> I verified the product identity and any specification mapping.</label><button type="submit">Add alias for review</button><button type="button" data-cancel hidden>Cancel correction</button></form><p role="status"></p><div data-rows></div><button type="button" data-history hidden>Alias history</button><ol data-events></ol><button type="button" data-more hidden>Earlier history</button>';
 root.append(toggle,section);
 const $=selector=>section.querySelector(selector),form=$('form'),search=$('input[type=search]'),filter=$('select[aria-label="Alias status"]');
 let data=null,selected=null,busy=false,cursor='',generation=0;
 const message=value=>{$('[role=status]').textContent=value;};
 const button=(label,action,disabled=false)=>{const node=document.createElement('button');node.type='button';node.textContent=label;node.disabled=disabled;node.addEventListener('click',action);return node;};
 const render=()=>{
  const rows=$('[data-rows]');rows.replaceChildren();if(!data)return;
  const names=new Map(data.products.map(product=>[product.id,product.name]));
  form.hidden=!data.canEdit;$('[data-history]').hidden=!data.canEdit;
  const choice=form.querySelector('[name=product]'),value=choice.value;choice.replaceChildren();
  for(const product of [{id:'',name:'Choose existing product'},...data.products]) {const option=document.createElement('option');option.value=product.id;option.textContent=product.name;choice.append(option);}choice.value=value;
  for(const record of data.records) {
   const statusMatches=filter.value==='all'||(filter.value==='inactive'?!record.active&&record.status==='approved':record.status===filter.value);
   if(!statusMatches||!`${record.text} ${names.get(record.productId)||''}`.toLowerCase().includes(search.value.toLowerCase()))continue;
   const row=document.createElement('article');row.className='general-product';
   const title=document.createElement('strong');title.textContent=record.text;row.append(title);
   const description=document.createElement('p');description.textContent=`${names.get(record.productId)||record.productId} · ${record.status}${record.active?'':' · inactive'} · ${record.source}${record.confidence!==undefined?` · confidence ${Math.round(record.confidence*100)}%`:''}`;row.append(description);
   const dates=document.createElement('p');dates.textContent=`Created: ${record.createdAt||'Imported catalogue alias'}${record.approvedBy?` · Approved by ${record.approvedBy}`:''}`;row.append(dates);
   if(record.clinicalUncertainty&&record.status==='pending'){const warning=document.createElement('p');warning.textContent='Clinical identity needs verification before approval.';row.append(warning);}
   if(record.ambiguous){const warning=document.createElement('p');warning.textContent='Competing product mappings require review.';row.append(warning);}
   if(data.canEdit){
    if(record.status==='pending')row.append(button('Approve verified alias',()=>void change('approve',record),busy||!form.querySelector('[name=confirmed]').checked),button('Reject',()=>void change('reject',record),busy));
    if(record.status==='approved'&&record.active)row.append(button('Deactivate',()=>void change('deactivate',record),busy));
    row.append(button('Correct mapping',()=>{selected=record;form.querySelector('[name=alias]').value=record.text;choice.value=record.productId;form.querySelector('[name=confirmed]').checked=false;form.querySelector('[type=submit]').textContent='Save verified correction';$('[data-cancel]').hidden=false;render();},busy));
   }
   rows.append(row);
  }
  if(!rows.children.length)rows.textContent='No aliases in this view.';
 };
 const load=async()=>{const epoch=++generation;try{const next=await request('/api/products/aliases');if(epoch!==generation)return;data=next;if(!data.canEdit)filter.value='approved';render();}catch(error){if(epoch===generation)message(error.message);}};
 const clearForm=()=>{selected=null;form.reset();form.querySelector('[type=submit]').textContent='Add alias for review';$('[data-cancel]').hidden=true;};
 const change=async(action,record)=>{
  if(busy||!data?.canEdit)return;const epoch=generation;busy=true;message('');
  try{await request('/api/products/aliases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:data.revision,action,id:record?.id,
   text:action==='propose'||action==='correct'?form.querySelector('[name=alias]').value:record?.text,productId:action==='propose'||action==='correct'?form.querySelector('[name=product]').value:record?.productId,identityConfirmed:form.querySelector('[name=confirmed]').checked})});
   if(epoch!==generation)return;clearForm();await load();onUpdated();message('Saved. New audits use the current approved aliases.');
  }catch(error){if(epoch===generation)message(error.message);}finally{busy=false;render();}
 };
 const history=async(more=false)=>{if(busy||!data?.canEdit)return;const epoch=generation;busy=true;
  try{const page=await request('/api/products/aliases/history'+(more&&cursor?`?cursor=${encodeURIComponent(cursor)}`:''));if(epoch!==generation)return;
   if(!more)$('[data-events]').replaceChildren();for(const event of page.events){const row=document.createElement('li');row.textContent=`${event.at} · ${event.action} · ${event.before&&event.before.text!==event.after.text?`${event.before.text} → ${event.after.text}`:event.after.text} · ${data.products.find(product=>product.id===event.after.productId)?.name||'Product'} · ${event.actor}`;$('[data-events]').append(row);}cursor=page.nextCursor;$('[data-more]').hidden=!cursor;
  }catch(error){if(epoch===generation)message(error.message);}finally{busy=false;}
 };
 toggle.addEventListener('click',()=>{section.hidden=!section.hidden;if(!section.hidden)void load();});
 search.addEventListener('input',render);filter.addEventListener('change',render);form.querySelector('[name=confirmed]').addEventListener('change',render);
 form.addEventListener('submit',event=>{event.preventDefault();if(selected&&!form.querySelector('[name=confirmed]').checked){message('Verify the product identity before approving.');return;}void change(selected?'correct':'propose',selected);});
 $('[data-refresh]').addEventListener('click',()=>void load());$('[data-cancel]').addEventListener('click',()=>{clearForm();render();});$('[data-history]').addEventListener('click',()=>void history());$('[data-more]').addEventListener('click',()=>void history(true));
 return {reset(){generation++;data=null;selected=null;busy=false;section.hidden=true;clearForm();$('[data-rows]').replaceChildren();$('[data-events]').replaceChildren();message('');}};
}
