const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
function moduleSource(path,requireFn=require){const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;const exports={};vm.runInNewContext(code,{exports,require:requireFn,Buffer,console,URL,process:{env:{}}});return exports;}
const helper=moduleSource('lib/follow-up.ts');
const uuid='11111111-1111-4111-8111-111111111111';
function fixture(options={}){
 const sends=[],inserts=[],entries=[];
 const order={id:uuid,request_number:1,customer_name:'<Customer>',product:'shirts'};
 const review={id:uuid,version:2,public_token:uuid,approved_at:options.approved?'today':null,files:[{path:uuid+'/mockup.png',originalName:'mockup.png'}]};
 const supabase={from(table){let filters={},insert=null;const q={select(){return q},eq(k,v){filters[k]=v;return q},order(){return q},limit(){return q},insert(v){insert=v;inserts.push(v);return q},single(){return q},maybeSingle(){return q},then(resolve,reject){let result=table==='custom_requests'?{data:order}:table==='mockup_review_sends'?{data:options.replaced?{...review,id:'other'}:review}:{data:filters.provider_message_id?(options.replay?{id:'existing'}:null):[]};if(options.logMissing&&table==='notification_email_log')result={error:{message:'missing'},data:null};if(insert)result={error:null};return Promise.resolve(result).then(resolve,reject)}};return q},storage:{from(){return {download:async()=>options.missingFile?{error:{message:'missing'}}:{data:new Blob(['image'])}}}}};
 const route=moduleSource('app/api/admin/follow-up/route.ts',name=>{
 if(name==='next/server')return{NextResponse:{json:(data,options={})=>({data,status:options.status||200})}};
 if(name==='@/lib/auth')return{requireAdminApi:async()=>options.unauthorized?{ok:false,status:403,error:'denied'}:{ok:true,user:{id:uuid}}};
 if(name==='@/lib/email')return{escapeHtml:v=>String(v).replaceAll('<','&lt;'),publicSiteUrl:()=> 'https://mooremade.store',emailShell:(t,b)=>b,sendMooreMadeEmail:async input=>{sends.push(input);return options.failed&&input.to==='failed@example.com'?{ok:false,error:'provider failure'}:{ok:true,id:'email-'+input.to}}};
 if(name==='@/lib/follow-up')return helper;
 if(name==='@/lib/custom-request-types')return{formatRequestNumber:()=> 'MM-000001'};
 if(name==='@/lib/message-server')return{recordCustomerEmailNotification:async input=>{entries.push(input)}};
 if(name==='@/lib/supabase-admin')return{getSupabaseAdmin:()=>supabase,QUOTE_PROOF_BUCKET:'proofs'};
 return require(name);
 });
 return {sends,inserts,entries,post:overrides=>route.POST({json:async()=>({requestId:uuid,reviewId:uuid,sendId:uuid,subject:'Checking in',message:'Any feedback?',recipientEmails:'client@example.com',includeMockups:true,...overrides})})};
}
// Blob lives outside the VM but is returned by the storage stub.
test('rejects invalid recipients rather than silently omitting them',()=>{assert.throws(()=>helper.followUpRecipients('valid@example.com, bad'));assert.deepEqual(Array.from(helper.followUpRecipients('A@example.com, a@example.com')),['a@example.com']);});
test('rejects attachment paths from other orders',()=>assert.throws(()=>helper.followUpProofFiles([{path:'other/proof.png'}],uuid)));
test('admin authorization blocks all sending',async()=>{const f=fixture({unauthorized:true});assert.equal((await f.post()).status,403);assert.equal(f.sends.length,0);});
test('approved and replaced proofs cannot receive follow-ups',async()=>{for(const option of ['approved','replaced']){const f=fixture({[option]:true});assert.equal((await f.post()).status,409);assert.equal(f.sends.length,0);}});
test('missing files or communication history block sends',async()=>{for(const option of ['missingFile','logMissing']){const f=fixture({[option]:true});assert.ok((await f.post()).status>=400);assert.equal(f.sends.length,0);}});
test('reattaches saved proof and preserves approval link without new review records',async()=>{const f=fixture();assert.equal((await f.post()).status,200);assert.equal(f.sends[0].attachments[0].filename,'mockup.png');assert.match(f.sends[0].html,/mockup-approval/);assert.equal(f.inserts.length,1);assert.equal(f.entries.length,1);assert.equal(f.inserts[0].notification_type,'general');});
test('link-only follow-up needs no downloads',async()=>{const f=fixture({missingFile:true});assert.equal((await f.post({includeMockups:false})).status,200);assert.equal(f.sends[0].attachments.length,0);});
test('partial failure logs correct recipients and records only successful messages',async()=>{const f=fixture({failed:true});const r=await f.post({recipientEmails:'client@example.com,failed@example.com'});assert.equal(r.data.sent.length,1);assert.equal(r.data.failed.length,1);assert.equal(f.entries.length,1);assert.equal(f.inserts.filter(x=>x.status==='failed').length,1);});
test('retries use the same provider key and do not duplicate known history',async()=>{const f=fixture({replay:true});await f.post();await f.post();assert.equal(f.sends[0].idempotencyKey,f.sends[1].idempotencyKey);assert.equal(f.inserts.length,0);assert.equal(f.entries.length,0);});
