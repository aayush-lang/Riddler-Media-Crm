import { SUPABASE_URL, SUPABASE_ANON_KEY, RESEND_API_KEY, FROM_EMAIL } from './supabase.js';
import { initBriefs } from './briefs.js';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const STAGES = ['Fresh Lead','Contacted','Interested','Brief Expected','Brief Received','Plan Shared','Closed','Not Interested','In House Team'];
const SOURCES = ['Ads','LinkedIn','Apollo','Naukri','Shopify','Website','Referral','WhatsApp','Other'];
const STAGE_COLORS = {
  'Fresh Lead':'#6366F1','Contacted':'#3B82F6','Interested':'#10B981',
  'Brief Expected':'#F59E0B','Brief Received':'#F97316','Plan Shared':'#8B5CF6',
  'Closed':'#22C55E','Not Interested':'#EF4444','In House Team':'#64748B'
};

let state = {
  user:null,profile:null,profiles:[],leads:[],filteredLeads:[],reminders:[],briefs:[],
  config:{services:[],sources:SOURCES,stages:STAGES},
  page:1,pageSize:20,sortCol:'created_at',sortDir:'desc',
  selectedLeads:new Set(),currentReminderFilter:'pending',
  editLeadId:null,editReminderId:null,activeView:'dashboard',filterDebounce:null,
};

let briefsModule = null;

async function handleLogin() {
  const email=document.getElementById('login-email').value.trim();
  const pw=document.getElementById('login-pw').value;
  const btn=document.getElementById('login-btn');
  const errEl=document.getElementById('auth-error');
  if(!email||!pw){showAuthError('Please enter your email and password.');return;}
  btn.disabled=true;btn.textContent='Signing in…';errEl.style.display='none';
  try {
    const{data,error}=await db.auth.signInWithPassword({email,password:pw});
    if(error){showAuthError(error.message||'Invalid credentials.');btn.disabled=false;btn.textContent='Sign in';return;}
    await initApp(data.user);
  } catch(e) {
    showAuthError('Connection error. Please try again.');btn.disabled=false;btn.textContent='Sign in';
  }
}
async function handleLogout(){await db.auth.signOut();document.getElementById('app').style.display='none';document.getElementById('auth-screen').style.display='flex';state.user=null;}
function showAuthError(msg){const el=document.getElementById('auth-error');el.textContent=msg;el.style.display='block';}
function showForgot(){const email=prompt('Enter your registered email:');if(!email)return;db.auth.resetPasswordForEmail(email).then(()=>alert('Password reset email sent!'));}

async function initApp(user) {
  state.user=user;
  const{data:prof}=await db.from('profiles').select('*').eq('id',user.id).single();
  state.profile=prof;
  document.getElementById('user-name').textContent=prof?.name?.split(' ')[0]||'You';
  document.getElementById('user-avatar').textContent=prof?.avatar_initials||'?';
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('app').style.display='flex';
  await Promise.all([loadConfig(),loadProfiles(),loadLeads(),loadReminders()]);
  renderDashboard();renderLeads();renderReminders();

  briefsModule = initBriefs(db, state, esc, formatDate);
  await briefsModule.loadBriefs();
  briefsModule.renderBriefs();
  const isPublic = await briefsModule.checkPublicShare();
  if(isPublic) return;

  document.querySelectorAll('.nav-btn').forEach(btn=>{btn.addEventListener('click',()=>switchView(btn.dataset.view,btn));});
  document.querySelectorAll('th.sortable').forEach(th=>{th.addEventListener('click',()=>handleSort(th.dataset.col));});
  document.getElementById('dash-date').textContent=new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  checkReminderPopups();
  setInterval(checkReminderPopups,60000);
  db.channel('leads-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'leads'},()=>loadLeads().then(renderLeads))
    .on('postgres_changes',{event:'*',schema:'public',table:'reminders'},()=>loadReminders().then(renderReminders))
    .subscribe();
}

async function loadConfig(){const{data}=await db.from('config').select('*');if(data){data.forEach(row=>{state.config[row.key]=row.value;});}state.config.stages=STAGES;state.config.sources=SOURCES;populateSelects();}
async function loadProfiles(){const{data}=await db.from('profiles').select('*').order('name');if(data)state.profiles=data;populateAssignedSelects();}
async function loadLeads(){const{data,error}=await db.from('leads').select('*, assigned_profile:profiles!leads_assigned_to_fkey(name,avatar_initials)').order(state.sortCol,{ascending:state.sortDir==='asc'});if(!error&&data){state.leads=data;applyFilters();}}
async function loadReminders(){const{data}=await db.from('reminders').select('*, lead:leads(name,company), assignee:profiles!reminders_assigned_to_fkey(name)').order('due_date',{ascending:true}).order('due_time',{ascending:true});if(data){state.reminders=data;updateReminderBadge();}}

function populateSelects(){
  const svcs=state.config.services||[];
  const fsvc=document.getElementById('f-service');const fsrc=document.getElementById('f-source');const fstage=document.getElementById('f-stage');
  if(fstage)fstage.innerHTML='<option value="">All stages</option>'+STAGES.map(s=>`<option>${s}</option>`).join('');
  if(fsvc)fsvc.innerHTML='<option value="">All services</option>'+svcs.map(s=>`<option>${s}</option>`).join('');
  if(fsrc)fsrc.innerHTML='<option value="">All sources</option>'+SOURCES.map(s=>`<option>${s}</option>`).join('');
  const lfsvc=document.getElementById('lf-service');const lfsrc=document.getElementById('lf-source');const lfstage=document.getElementById('lf-stage');
  if(lfstage)lfstage.innerHTML=STAGES.map(s=>`<option>${s}</option>`).join('');
  if(lfsvc)lfsvc.innerHTML='<option value=""></option>'+svcs.map(s=>`<option>${s}</option>`).join('');
  if(lfsrc)lfsrc.innerHTML='<option value=""></option>'+SOURCES.map(s=>`<option>${s}</option>`).join('');
  const svl=document.getElementById('services-list');const sol=document.getElementById('sources-list');
  if(svl)svl.innerHTML=svcs.map(s=>`<span class="config-tag">${s}</span>`).join('');
  if(sol)sol.innerHTML=SOURCES.map(s=>`<span class="config-tag">${s}</span>`).join('');
}

function populateAssignedSelects(){
  const opts=state.profiles.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const emptyOpt='<option value="">Unassigned</option>';
  ['f-assigned','lf-assigned','rf-assigned'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=emptyOpt+opts;});
  const tl=document.getElementById('team-list');
  if(tl)tl.innerHTML=state.profiles.map(p=>`<div class="team-member-row"><div class="tm-info"><div class="tm-avatar">${p.avatar_initials||'?'}</div><div><div style="font-weight:500">${p.name}</div><div style="font-size:11px;color:var(--text-3)">${p.email}</div></div></div><span class="tm-role">${p.role}</span></div>`).join('');
}

function switchView(viewName,btn){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById(`view-${viewName}`)?.classList.add('active');
  btn?.classList.add('active');state.activeView=viewName;
  if(viewName==='pipeline')renderKanban();
  if(viewName==='briefs'){briefsModule?.renderBriefs();}
  if(viewName==='settings'){loadProfiles().then(()=>populateAssignedSelects());}
}

function renderDashboard(){
  const leads=state.leads;const won=leads.filter(l=>l.stage==='Closed');
  const totalVal=leads.reduce((s,l)=>s+(+l.value||0),0);
  const wonVal=won.reduce((s,l)=>s+(+l.value||0),0);
  const conv=leads.length?Math.round(won.length/leads.length*100):0;
  const today=new Date().toISOString().split('T')[0];
  document.getElementById('metrics-row').innerHTML=`
    <div class="metric-card"><div class="metric-label">Total leads</div><div class="metric-value purple">${leads.length.toLocaleString('en-IN')}</div><div class="metric-sub">All time</div></div>
    <div class="metric-card"><div class="metric-label">Pipeline value</div><div class="metric-value amber">₹${formatINR(totalVal)}</div><div class="metric-sub">Estimated retainers</div></div>
    <div class="metric-card"><div class="metric-label">Conversion rate</div><div class="metric-value green">${conv}%</div><div class="metric-sub">${won.length} closed</div></div>
    <div class="metric-card"><div class="metric-label">Won revenue</div><div class="metric-value green">₹${formatINR(wonVal)}</div><div class="metric-sub">Closed deals</div></div>`;
  const max=Math.max(...STAGES.map(s=>leads.filter(l=>l.stage===s).length),1);
  document.getElementById('stage-bars').innerHTML=STAGES.map(s=>{const c=leads.filter(l=>l.stage===s).length;return`<div class="stage-bar-row"><span class="stage-bar-label" style="width:110px">${s}</span><div class="stage-bar-track"><div class="stage-bar-fill" style="width:${Math.round(c/max*100)}%;background:${STAGE_COLORS[s]}"></div></div><span class="stage-bar-count">${c}</span></div>`;}).join('');
  const srcMap={};leads.forEach(l=>{if(l.source)srcMap[l.source]=(srcMap[l.source]||0)+1;});
  document.getElementById('source-chart').innerHTML=Object.entries(srcMap).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([s,c])=>`<div class="source-row"><span>${s}</span><span class="source-pill">${c}</span></div>`).join('')||'<div class="empty-state">No source data yet</div>';
  const due=leads.filter(l=>l.followup_date===today);
  document.getElementById('followups-today').innerHTML=due.length?due.slice(0,5).map(l=>`<div class="followup-row"><div><div class="followup-name">${l.name}</div><div class="followup-company">${l.company||''}</div></div><button class="btn-sm" onclick="openLeadDetail('${l.id}')">View</button></div>`).join(''):'<div class="empty-state"><div class="empty-state-icon">✓</div>No follow-ups today</div>';
  const perfMap={};leads.forEach(l=>{if(!l.assigned_to)return;const prof=state.profiles.find(p=>p.id===l.assigned_to);const name=prof?.name||'Unknown';if(!perfMap[name])perfMap[name]={total:0,won:0};perfMap[name].total++;if(l.stage==='Closed')perfMap[name].won++;});
  document.getElementById('team-perf').innerHTML=Object.entries(perfMap).sort((a,b)=>b[1].total-a[1].total).map(([name,p])=>`<div class="team-row"><span style="font-weight:500">${name}</span><div class="team-stats"><div class="team-stat"><div class="team-stat-num">${p.total}</div><div class="team-stat-lbl">Leads</div></div><div class="team-stat"><div class="team-stat-num">${p.won}</div><div class="team-stat-lbl">Closed</div></div><div class="team-stat"><div class="team-stat-num">${p.total?Math.round(p.won/p.total*100):0}%</div><div class="team-stat-lbl">Conv.</div></div></div></div>`).join('')||'<div class="empty-state">Assign leads to see stats</div>';
}

function applyFilters(){
  const q=(document.getElementById('search-q')?.value||'').toLowerCase();
  const stage=document.getElementById('f-stage')?.value||'';
  const type=document.getElementById('f-type')?.value||'';
  const service=document.getElementById('f-service')?.value||'';
  const source=document.getElementById('f-source')?.value||'';
  const assigned=document.getElementById('f-assigned')?.value||'';
  state.filteredLeads=state.leads.filter(l=>{
    if(q&&!`${l.name}${l.company}${l.email}${l.phone}${l.city}`.toLowerCase().includes(q))return false;
    if(stage&&l.stage!==stage)return false;
    if(type&&l.type!==type)return false;
    if(service&&l.service!==service)return false;
    if(source&&l.source!==source)return false;
    if(assigned&&l.assigned_to!==assigned)return false;
    return true;
  });
  state.page=1;state.selectedLeads.clear();renderLeads();
}
function debounceFilter(){clearTimeout(state.filterDebounce);state.filterDebounce=setTimeout(applyFilters,250);}
function clearFilters(){['search-q','f-stage','f-type','f-service','f-source','f-assigned'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});applyFilters();}
function handleSort(col){if(state.sortCol===col){state.sortDir=state.sortDir==='asc'?'desc':'asc';}else{state.sortCol=col;state.sortDir='asc';}document.querySelectorAll('th.sortable').forEach(th=>{th.classList.remove('sort-asc','sort-desc');if(th.dataset.col===col)th.classList.add(state.sortDir==='asc'?'sort-asc':'sort-desc');});loadLeads().then(renderLeads);}

function renderLeads(){
  const fl=state.filteredLeads;const total=fl.length;
  const pages=Math.max(1,Math.ceil(total/state.pageSize));
  const start=(state.page-1)*state.pageSize;const slice=fl.slice(start,start+state.pageSize);
  document.getElementById('leads-count-label').textContent=`${total.toLocaleString('en-IN')} leads${total!==state.leads.length?` (filtered from ${state.leads.length.toLocaleString('en-IN')})`:''}`; 
  const tbody=document.getElementById('leads-tbody');
  if(!slice.length){tbody.innerHTML=`<tr><td colspan="11" class="empty-row"><div class="empty-state-icon">🔍</div><div>No leads found</div></td></tr>`;}
  else{
    tbody.innerHTML=slice.map(l=>{
      const prof=l.assigned_profile;const fu=l.followup_date;const today=new Date().toISOString().split('T')[0];
      const fuClass=fu&&fu<today?'color:var(--red)':fu===today?'color:var(--amber)':'';
      const stageColor=STAGE_COLORS[l.stage]||'#6366F1';
      const createdDate=l.created_at?formatDate(l.created_at.split('T')[0]):'—';
      return`<tr data-id="${l.id}" class="${state.selectedLeads.has(l.id)?'selected':''}">
        <td><input type="checkbox" ${state.selectedLeads.has(l.id)?'checked':''} onchange="toggleSelect('${l.id}',this)"/></td>
        <td><div class="lead-name">${esc(l.name)}</div><div class="lead-company">${esc(l.company||'')}</div></td>
        <td><div class="lead-email">${esc(l.email||'—')}</div><div class="lead-phone">${esc(l.phone||'')}</div></td>
        <td><span class="stage-badge" style="background:${stageColor}22;color:${stageColor}">${l.stage}</span></td>
        <td style="font-size:12px;color:var(--text-2)">${esc(l.service||'—')}</td>
        <td style="font-size:12px;color:var(--text-3)">${esc(l.source||'—')}</td>
        <td style="font-size:12px;font-family:'DM Mono',monospace">₹${(+l.value||0).toLocaleString('en-IN')}</td>
        <td>${prof?`<div style="display:flex;align-items:center;gap:5px;font-size:12px"><div class="user-avatar" style="width:20px;height:20px;font-size:9px">${prof.avatar_initials||'?'}</div>${prof.name.split(' ')[0]}</div>`:'<span style="font-size:12px;color:var(--text-3)">—</span>'}</td>
        <td style="font-size:12px;${fuClass}">${fu?formatDate(fu):'—'}</td>
        <td style="font-size:12px;color:var(--text-3)">${createdDate}</td>
        <td><div style="display:flex;gap:4px"><button class="btn-sm" onclick="openLeadDetail('${l.id}')">View</button><button class="btn-sm" onclick="openEditLead('${l.id}')">Edit</button></div></td>
      </tr>`;
    }).join('');
  }
  const pag=document.getElementById('pagination');
  pag.innerHTML=`<span class="page-info">${start+1}–${Math.min(start+state.pageSize,total)} of ${total}</span>`;
  if(pages>1){
    pag.innerHTML+=`<button class="page-btn" onclick="goPage(${state.page-1})" ${state.page===1?'disabled':''}>←</button>`;
    for(let i=Math.max(1,state.page-2);i<=Math.min(pages,state.page+2);i++){pag.innerHTML+=`<button class="page-btn ${i===state.page?'active':''}" onclick="goPage(${i})">${i}</button>`;}
    pag.innerHTML+=`<button class="page-btn" onclick="goPage(${state.page+1})" ${state.page===pages?'disabled':''}>→</button>`;
  }
  const bulk=document.getElementById('bulk-actions');const selCount=state.selectedLeads.size;
  bulk.style.display=selCount>0?'flex':'none';
  document.getElementById('selected-count').textContent=`${selCount} selected`;
  document.getElementById('select-all').checked=slice.length>0&&slice.every(l=>state.selectedLeads.has(l.id));
}

function goPage(p){state.page=p;renderLeads();}
function toggleSelect(id,cb){if(cb.checked)state.selectedLeads.add(id);else state.selectedLeads.delete(id);renderLeads();}
function toggleSelectAll(cb){const fl=state.filteredLeads;const start=(state.page-1)*state.pageSize;const slice=fl.slice(start,start+state.pageSize);if(cb.checked)slice.forEach(l=>state.selectedLeads.add(l.id));else slice.forEach(l=>state.selectedLeads.delete(l.id));renderLeads();}
async function bulkMoveStage(){const stage=document.getElementById('bulk-stage').value;if(!stage||!state.selectedLeads.size)return;const ids=[...state.selectedLeads];await db.from('leads').update({stage,updated_at:new Date().toISOString()}).in('id',ids);state.selectedLeads.clear();await loadLeads();renderLeads();renderDashboard();}
async function bulkDelete(){if(!state.selectedLeads.size)return;if(!confirm(`Delete ${state.selectedLeads.size} leads?`))return;const ids=[...state.selectedLeads];await db.from('leads').delete().in('id',ids);state.selectedLeads.clear();await loadLeads();renderLeads();renderDashboard();}

function openModal(id){document.getElementById(id).style.display='flex';}
function closeModal(id){document.getElementById(id).style.display='none';}
function overlayClose(e,el){if(e.target===el)el.style.display='none';}

function openAddLead(){
  state.editLeadId=null;
  document.getElementById('lead-modal-title').textContent='Add new lead';
  document.getElementById('edit-lead-id').value='';
  ['lf-name','lf-company','lf-email','lf-phone','lf-city','lf-notes','lf-value','lf-followup'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('lf-stage').value='Fresh Lead';
  document.getElementById('lf-type').value='Prospect';
  document.getElementById('lf-service').value='';
  document.getElementById('lf-source').value='';
  document.getElementById('lf-assigned').value=state.user?.id||'';
  openModal('add-lead-modal');
}

function openEditLead(id){
  const l=state.leads.find(x=>x.id===id);if(!l)return;
  state.editLeadId=id;
  document.getElementById('lead-modal-title').textContent='Edit lead';
  document.getElementById('edit-lead-id').value=id;
  document.getElementById('lf-name').value=l.name||'';
  document.getElementById('lf-company').value=l.company||'';
  document.getElementById('lf-email').value=l.email||'';
  document.getElementById('lf-phone').value=l.phone||'';
  document.getElementById('lf-stage').value=l.stage||'Fresh Lead';
  document.getElementById('lf-type').value=l.type||'Prospect';
  document.getElementById('lf-service').value=l.service||'';
  document.getElementById('lf-source').value=l.source||'';
  document.getElementById('lf-value').value=l.value||'';
  document.getElementById('lf-city').value=l.city||'';
  document.getElementById('lf-notes').value=l.notes||'';
  document.getElementById('lf-followup').value=l.followup_date||'';
  document.getElementById('lf-assigned').value=l.assigned_to||'';
  openModal('add-lead-modal');
}

async function saveLead(){
  const name=document.getElementById('lf-name').value.trim();if(!name){alert('Name is required');return;}
  const payload={name,company:document.getElementById('lf-company').value,email:document.getElementById('lf-email').value,phone:document.getElementById('lf-phone').value,stage:document.getElementById('lf-stage').value,type:document.getElementById('lf-type').value,service:document.getElementById('lf-service').value,source:document.getElementById('lf-source').value,value:+document.getElementById('lf-value').value||0,city:document.getElementById('lf-city').value,notes:document.getElementById('lf-notes').value,followup_date:document.getElementById('lf-followup').value||null,assigned_to:document.getElementById('lf-assigned').value||null,updated_at:new Date().toISOString()};
  const editId=state.editLeadId;
  if(editId){
    const old=state.leads.find(l=>l.id===editId);await db.from('leads').update(payload).eq('id',editId);
    if(old&&old.stage!==payload.stage){await db.from('activities').insert({lead_id:editId,user_id:state.user.id,type:'stage_change',text:`Stage changed from ${old.stage} to ${payload.stage}`});}
    else{await db.from('activities').insert({lead_id:editId,user_id:state.user.id,type:'edit',text:'Lead updated'});}
    if(old&&old.assigned_to!==payload.assigned_to){const newOwner=state.profiles.find(p=>p.id===payload.assigned_to);await db.from('activities').insert({lead_id:editId,user_id:state.user.id,type:'edit',text:`Lead assigned to ${newOwner?.name||'someone'}`});}
  }else{
    payload.created_by=state.user.id;const{data}=await db.from('leads').insert(payload).select().single();
    if(data){await db.from('activities').insert({lead_id:data.id,user_id:state.user.id,type:'created',text:'Lead created'});}
  }
  closeModal('add-lead-modal');await loadLeads();renderLeads();renderDashboard();if(state.activeView==='pipeline')renderKanban();
}

async function deleteLead(id){if(!confirm('Delete this lead?'))return;await db.from('leads').delete().eq('id',id);document.getElementById('lead-detail-overlay').style.display='none';await loadLeads();renderLeads();renderDashboard();if(state.activeView==='pipeline')renderKanban();}

async function openLeadDetail(id){
  const l=state.leads.find(x=>x.id===id);if(!l)return;
  const{data:acts}=await db.from('activities').select('*, user:profiles(name,avatar_initials)').eq('lead_id',id).order('created_at',{ascending:false});
  const stageColor=STAGE_COLORS[l.stage]||'#6366F1';
  document.getElementById('lead-detail-panel').innerHTML=`
    <div class="panel-header">
      <div>
        <div style="font-size:17px;font-weight:600">${esc(l.name)}</div>
        <div style="font-size:13px;color:var(--text-3)">${esc(l.company||'')}</div>
        <div style="margin-top:8px"><span class="stage-badge" style="background:${stageColor}22;color:${stageColor}">${l.stage}</span></div>
      </div>
      <button class="modal-close" onclick="document.getElementById('lead-detail-overlay').style.display='none'">✕</button>
    </div>
    <div class="panel-section">
      <div class="panel-section-title">Contact details</div>
      <div class="info-grid">
        <div class="info-field"><div class="info-label">Email</div><div class="info-value">${esc(l.email||'—')}</div></div>
        <div class="info-field"><div class="info-label">Phone</div><div class="info-value">${esc(l.phone||'—')}</div></div>
        <div class="info-field"><div class="info-label">City</div><div class="info-value">${esc(l.city||'—')}</div></div>
        <div class="info-field"><div class="info-label">Service</div><div class="info-value">${esc(l.service||'—')}</div></div>
        <div class="info-field"><div class="info-label">Source</div><div class="info-value">${esc(l.source||'—')}</div></div>
        <div class="info-field"><div class="info-label">Deal value</div><div class="info-value" style="font-family:'DM Mono',monospace;color:var(--purple)">₹${(+l.value||0).toLocaleString('en-IN')}</div></div>
        <div class="info-field"><div class="info-label">Follow-up</div><div class="info-value">${l.followup_date?formatDate(l.followup_date):'—'}</div></div>
        <div class="info-field"><div class="info-label">Created on</div><div class="info-value">${l.created_at?formatDate(l.created_at.split('T')[0]):'—'}</div></div>
      </div>
      ${l.notes?`<div style="margin-top:10px;font-size:13px;color:var(--text-2);background:var(--surface-2);padding:10px;border-radius:var(--radius-sm)">${esc(l.notes)}</div>`:''}
    </div>
    <div class="panel-section">
      <div class="panel-section-title">Move stage</div>
      <div class="stage-switcher">${STAGES.map(s=>`<button class="stage-switch-btn ${l.stage===s?'active':''}" onclick="changeStageFromPanel('${l.id}','${s}')" style="${l.stage===s?`background:${STAGE_COLORS[s]};border-color:${STAGE_COLORS[s]};color:white`:''}">${s}</button>`).join('')}</div>
    </div>
    <div class="panel-section">
      <div class="panel-section-title">Assign owner</div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="assign-select" style="flex:1;padding:8px 10px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface-2);color:var(--text-1);font-size:13px;outline:none">
          <option value="">Unassigned</option>
          ${state.profiles.map(p=>`<option value="${p.id}" ${p.id===l.assigned_to?'selected':''}>${p.name}</option>`).join('')}
        </select>
        <button class="btn-primary" onclick="assignLead('${l.id}')">Assign</button>
      </div>
    </div>
    <div class="panel-section">
      <div class="panel-section-title">Quick actions</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-sm" onclick="openEditLead('${l.id}');document.getElementById('lead-detail-overlay').style.display='none'">Edit lead</button>
        <button class="btn-sm" onclick="openReminderForLead('${l.id}')">+ Reminder</button>
        <button class="btn-sm" onclick="openBriefModal('${l.id}',true)">+ Brief</button>
        <button class="btn-danger-sm" onclick="deleteLead('${l.id}')">Delete</button>
      </div>
    </div>
    <div class="panel-section">
      <div class="panel-section-title">Activity & comments</div>
      <div class="activity-list">
        ${(acts||[]).map(a=>`<div class="activity-item"><div class="activity-dot ${a.type}"></div><div class="activity-content"><div class="activity-text">${a.type==='comment'?'💬 ':''}${esc(a.text)}</div><div class="activity-author">${a.user?.name||'System'} · ${formatDateTime(a.created_at)}</div></div></div>`).join('')||'<div style="font-size:13px;color:var(--text-3)">No activity yet</div>'}
      </div>
      <div class="comment-composer">
        <textarea class="comment-input" id="comment-input-${id}" rows="2" placeholder="Add a comment or note…"></textarea>
        <button class="btn-primary" style="align-self:flex-end" onclick="postComment('${l.id}')">Post</button>
      </div>
    </div>`;
  document.getElementById('lead-detail-overlay').style.display='flex';
}

async function assignLead(leadId){const newOwner=document.getElementById('assign-select').value;const ownerName=state.profiles.find(p=>p.id===newOwner)?.name||'Unassigned';await db.from('leads').update({assigned_to:newOwner||null,updated_at:new Date().toISOString()}).eq('id',leadId);await db.from('activities').insert({lead_id:leadId,user_id:state.user.id,type:'edit',text:`Lead assigned to ${ownerName}`});await loadLeads();renderLeads();openLeadDetail(leadId);}
async function changeStageFromPanel(leadId,stage){const old=state.leads.find(l=>l.id===leadId);await db.from('leads').update({stage,updated_at:new Date().toISOString()}).eq('id',leadId);await db.from('activities').insert({lead_id:leadId,user_id:state.user.id,type:'stage_change',text:`Stage changed from ${old?.stage||'?'} to ${stage}`});await loadLeads();renderLeads();renderDashboard();if(state.activeView==='pipeline')renderKanban();openLeadDetail(leadId);}
async function postComment(leadId){const inp=document.getElementById(`comment-input-${leadId}`);const text=inp?.value.trim();if(!text)return;await db.from('activities').insert({lead_id:leadId,user_id:state.user.id,type:'comment',text});inp.value='';openLeadDetail(leadId);}

function renderKanban(){
  document.getElementById('kanban-board').innerHTML=STAGES.map(stage=>{
    const cards=state.leads.filter(l=>l.stage===stage);
    return`<div class="kanban-col" data-stage="${stage}" ondragover="kanbanDragOver(event,this)" ondrop="kanbanDrop(event,'${stage}')" ondragleave="kanbanDragLeave(this)">
      <div class="col-header"><div class="col-title-wrap"><div class="col-accent" style="background:${STAGE_COLORS[stage]}"></div><span class="col-name">${stage}</span></div><span class="col-count">${cards.length}</span></div>
      <div class="col-cards">${cards.map(l=>`<div class="kanban-card" draggable="true" data-id="${l.id}" ondragstart="kanbanDragStart(event,'${l.id}')" ondragend="kanbanDragEnd(event)" onclick="openLeadDetail('${l.id}')"><div class="kcard-name">${esc(l.name)}</div><div class="kcard-company">${esc(l.company||'—')}</div><div class="kcard-footer"><span class="kcard-value">${l.value?'₹'+(+l.value).toLocaleString('en-IN'):''}</span><span class="kcard-service">${esc(l.service||'')}</span></div></div>`).join('')}</div>
    </div>`;
  }).join('');
}

let draggedLeadId=null;
function kanbanDragStart(e,id){draggedLeadId=id;e.target.classList.add('dragging');e.dataTransfer.effectAllowed='move';}
function kanbanDragEnd(e){e.target.classList.remove('dragging');}
function kanbanDragOver(e,col){e.preventDefault();col.classList.add('drag-target');}
function kanbanDragLeave(col){col.classList.remove('drag-target');}
async function kanbanDrop(e,stage){e.preventDefault();document.querySelectorAll('.kanban-col').forEach(c=>c.classList.remove('drag-target'));if(!draggedLeadId)return;const old=state.leads.find(l=>l.id===draggedLeadId);if(old?.stage===stage)return;await db.from('leads').update({stage,updated_at:new Date().toISOString()}).eq('id',draggedLeadId);await db.from('activities').insert({lead_id:draggedLeadId,user_id:state.user.id,type:'stage_change',text:`Stage moved to ${stage} via Kanban`});draggedLeadId=null;await loadLeads();renderKanban();renderDashboard();}

function renderReminders(){
  const today=new Date().toISOString().split('T')[0];const filter=state.currentReminderFilter;
  let items=state.reminders.filter(r=>{if(filter==='done')return r.done;if(filter==='overdue')return!r.done&&r.due_date<today;if(filter==='today')return!r.done&&r.due_date===today;return!r.done;});
  const list=document.getElementById('reminders-list');
  list.innerHTML=items.length?items.map(r=>{const cls=r.done?'done':r.due_date<today?'overdue':r.due_date===today?'today':'upcoming';const icons={overdue:'⚠️',today:'📅',upcoming:'🔔',done:'✅'};return`<div class="reminder-item ${cls}"><div class="rem-icon ${cls}">${icons[cls]}</div><div class="rem-body"><div class="rem-title">${esc(r.title)}</div><div class="rem-meta">${formatDate(r.due_date)} at ${r.due_time}${r.lead?` · ${r.lead.name}`:''}${r.assignee?` · ${r.assignee.name}`:''}</div>${r.notes?`<div class="rem-notes">${esc(r.notes)}</div>`:''}<div class="rem-actions">${!r.done?`<button class="btn-sm" onclick="markReminderDone('${r.id}')">✓ Done</button>`:''}<button class="btn-sm" onclick="openEditReminder('${r.id}')">Edit</button>${r.lead?`<button class="btn-sm" onclick="openLeadDetail('${r.lead_id}')">View lead</button>`:''}<button class="btn-danger-sm" onclick="deleteReminder('${r.id}')">Delete</button></div></div></div>`;}).join(''):`<div class="empty-state"><div class="empty-state-icon">🔔</div><div>No ${filter} reminders</div></div>`;
  document.querySelectorAll('.rem-tab').forEach(btn=>{btn.onclick=()=>{document.querySelectorAll('.rem-tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');state.currentReminderFilter=btn.dataset.filter;renderReminders();};});
}

function updateReminderBadge(){const today=new Date().toISOString().split('T')[0];const overdue=state.reminders.filter(r=>!r.done&&r.due_date<=today).length;const badge=document.getElementById('reminder-count');if(overdue>0){badge.style.display='inline-block';badge.textContent=overdue;}else badge.style.display='none';}
function openAddReminder(){state.editReminderId=null;document.getElementById('reminder-modal-title').textContent='Add reminder';document.getElementById('edit-reminder-id').value='';document.getElementById('rf-title').value='';document.getElementById('rf-notes').value='';document.getElementById('rf-date').value='';document.getElementById('rf-time').value='10:00';document.getElementById('rf-lead').innerHTML='<option value="">— none —</option>'+state.leads.map(l=>`<option value="${l.id}">${esc(l.name)} — ${esc(l.company||'')}</option>`).join('');document.getElementById('rf-assigned').value=state.user.id||'';openModal('add-reminder-modal');}
function openReminderForLead(leadId){openAddReminder();document.getElementById('rf-lead').value=leadId;document.getElementById('lead-detail-overlay').style.display='none';}
function openEditReminder(id){const r=state.reminders.find(x=>x.id===id);if(!r)return;state.editReminderId=id;document.getElementById('reminder-modal-title').textContent='Edit reminder';document.getElementById('edit-reminder-id').value=id;document.getElementById('rf-title').value=r.title||'';document.getElementById('rf-notes').value=r.notes||'';document.getElementById('rf-date').value=r.due_date||'';document.getElementById('rf-time').value=r.due_time||'10:00';document.getElementById('rf-lead').innerHTML='<option value="">— none —</option>'+state.leads.map(l=>`<option value="${l.id}" ${l.id===r.lead_id?'selected':''}>${esc(l.name)} — ${esc(l.company||'')}</option>`).join('');document.getElementById('rf-assigned').value=r.assigned_to||'';openModal('add-reminder-modal');}
async function saveReminder(){const title=document.getElementById('rf-title').value.trim();if(!title){alert('Title is required');return;}const date=document.getElementById('rf-date').value;if(!date){alert('Date is required');return;}const payload={title,lead_id:document.getElementById('rf-lead').value||null,assigned_to:document.getElementById('rf-assigned').value||null,due_date:date,due_time:document.getElementById('rf-time').value||'10:00',notes:document.getElementById('rf-notes').value,done:false};const editId=state.editReminderId;if(editId){await db.from('reminders').update(payload).eq('id',editId);}else{payload.created_by=state.user.id;await db.from('reminders').insert(payload);}closeModal('add-reminder-modal');await loadReminders();renderReminders();}
async function markReminderDone(id){await db.from('reminders').update({done:true}).eq('id',id);await loadReminders();renderReminders();}
async function deleteReminder(id){if(!confirm('Delete this reminder?'))return;await db.from('reminders').delete().eq('id',id);await loadReminders();renderReminders();}

let currentPopupReminder=null;
function checkReminderPopups(){const now=new Date();const today=now.toISOString().split('T')[0];const hhmm=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;const due=state.reminders.find(r=>{if(r.done||r._popupShown)return false;if(r.due_date>today)return false;if(r.due_date<today)return true;return r.due_time<=hhmm;});if(!due)return;due._popupShown=true;currentPopupReminder=due;const lead=state.leads.find(l=>l.id===due.lead_id);document.getElementById('toast-title').textContent=due.title;document.getElementById('toast-sub').textContent=[lead?`Lead: ${lead.name}`:'',due.notes].filter(Boolean).join(' · ');document.getElementById('reminder-toast').style.display='flex';sendReminderEmail(due,lead);}
function closeToast(){document.getElementById('reminder-toast').style.display='none';}
async function doneReminderToast(){if(currentPopupReminder)await markReminderDone(currentPopupReminder.id);closeToast();}
function snoozeReminder(){if(!currentPopupReminder)return;const snooze=new Date(Date.now()+3600000);const r=currentPopupReminder;r._popupShown=false;r.due_date=snooze.toISOString().split('T')[0];r.due_time=`${String(snooze.getHours()).padStart(2,'0')}:${String(snooze.getMinutes()).padStart(2,'0')}`;db.from('reminders').update({due_date:r.due_date,due_time:r.due_time}).eq('id',r.id);closeToast();}

async function sendReminderEmail(reminder,lead){if(!RESEND_API_KEY||RESEND_API_KEY==='YOUR_RESEND_API_KEY')return;const assignee=state.profiles.find(p=>p.id===reminder.assigned_to);if(!assignee?.email)return;const body=`<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px"><div style="background:#4F46E5;color:white;padding:16px 24px;border-radius:8px 8px 0 0"><strong>Riddler CRM</strong> · Reminder</div><div style="background:#f8f7ff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb"><h2 style="margin:0 0 12px;color:#1e1b4b">${reminder.title}</h2>${lead?`<p style="color:#4b5563"><strong>Lead:</strong> ${lead.name}${lead.company?` (${lead.company})`:''}</p>`:''}${reminder.notes?`<p style="color:#4b5563"><strong>Notes:</strong> ${reminder.notes}</p>`:''}<p style="color:#9ca3af;font-size:12px;margin-top:16px">Due: ${formatDate(reminder.due_date)} at ${reminder.due_time}</p><a href="https://aayush-lang.github.io/Riddler-Media-Crm" style="display:inline-block;margin-top:16px;background:#4F46E5;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px">Open CRM</a></div></div>`;await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:FROM_EMAIL,to:[assignee.email],subject:`🔔 Reminder: ${reminder.title}`,html:body})});}

function exportCSV(){const headers=['Name','Company','Email','Phone','Stage','Type','Service','Source','Value','City','Follow-up Date','Created On','Notes'];const rows=state.leads.map(l=>[l.name,l.company,l.email,l.phone,l.stage,l.type,l.service,l.source,l.value,l.city,l.followup_date,l.created_at?.split('T')[0],l.notes].map(v=>`"${(v||'').toString().replace(/"/g,'""')}"`).join(','));const csv=[headers.join(','),...rows].join('\n');const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download=`riddler_leads_${new Date().toISOString().split('T')[0]}.csv`;a.click();}

function importCSV(event){
  const file=event.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async e=>{
    const lines=e.target.result.split('\n').filter(l=>l.trim());
    const headers=lines[0].split(',').map(h=>h.replace(/"/g,'').toLowerCase().trim());
    const fieldMap={
      name:['name','full name','contact name'],
      company:['company','business','company name'],
      email:['email','email address'],
      phone:['phone','mobile','contact number','phone number'],
      stage:['stage'],
      type:['type'],
      service:['service','service interest'],
      source:['source','lead source'],
      value:['value','deal value','amount'],
      city:['city','location'],
    };
    const colIndex={};
    Object.entries(fieldMap).forEach(([key,aliases])=>{
      const idx=headers.findIndex(h=>aliases.includes(h));
      if(idx!==-1)colIndex[key]=idx;
    });
    const rows=lines.slice(1).map(line=>{
      const cells=line.match(/("([^"]|"")*"|[^,]*)/g)?.map(c=>c.replace(/^"|"$/g,'').replace(/""/g,'"').trim())||[];
      return cells;
    });
    const toInsert=rows
      .filter(r=>r.length>=1&&r[colIndex.name??0]?.trim())
      .map(r=>({
        name:(r[colIndex.name]||'Unknown').trim(),
        company:(r[colIndex.company]!=null?r[colIndex.company]:'').trim(),
        email:(r[colIndex.email]!=null?r[colIndex.email]:'').trim(),
        phone:(r[colIndex.phone]!=null?r[colIndex.phone]:'').trim(),
        stage:STAGES.includes((r[colIndex.stage]||'').trim())?(r[colIndex.stage]||'').trim():(r[colIndex.stage]||'').trim()==='Fresh'?'Fresh Lead':'Fresh Lead',
        type:(r[colIndex.type]||'').trim()==='Client'?'Client':'Prospect',
        service:(r[colIndex.service]!=null?r[colIndex.service]:'').trim(),
        source:(r[colIndex.source]!=null?r[colIndex.source]:'').trim(),
        value:+(r[colIndex.value]||0)||0,
        city:(r[colIndex.city]!=null?r[colIndex.city]:'').trim(),
        created_by:state.user.id,
      }));
    if(!toInsert.length){alert('No valid rows found in CSV.');return;}
    if(!confirm(`Import ${toInsert.length} leads?`))return;
    let imported=0,errors=0;
    for(let i=0;i<toInsert.length;i+=100){
      const batch=toInsert.slice(i,i+100);
      const{error}=await db.from('leads').insert(batch);
      if(error){console.error('Batch error:',error);errors+=batch.length;}
      else{imported+=batch.length;}
    }
    await loadLeads();renderLeads();renderDashboard();
    alert(errors>0?`Imported ${imported} leads.\n${errors} rows failed.`:`✓ Imported ${imported} leads successfully!`);
  };
  reader.readAsText(file);
  event.target.value='';
}

async function inviteTeamMember(){const email=document.getElementById('invite-email').value.trim();if(!email)return;alert(`Create their account from Supabase dashboard → Auth → Users → Invite user.\n\nEmail: ${email}`);document.getElementById('invite-email').value='';}

function esc(str){return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function formatINR(n){if(n>=100000)return(n/100000).toFixed(1)+'L';if(n>=1000)return(n/1000).toFixed(0)+'K';return n.toLocaleString('en-IN');}
function formatDate(dateStr){if(!dateStr)return'';const d=new Date(dateStr+'T00:00:00');return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});}
function formatDateTime(isoStr){if(!isoStr)return'';return new Date(isoStr).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}

window.handleLogin=handleLogin;window.handleLogout=handleLogout;window.showForgot=showForgot;window.openModal=openModal;window.closeModal=closeModal;window.overlayClose=overlayClose;window.openAddLead=openAddLead;window.openEditLead=openEditLead;window.saveLead=saveLead;window.deleteLead=deleteLead;window.openLeadDetail=openLeadDetail;window.changeStageFromPanel=changeStageFromPanel;window.assignLead=assignLead;window.postComment=postComment;window.openAddReminder=openAddReminder;window.openReminderForLead=openReminderForLead;window.openEditReminder=openEditReminder;window.saveReminder=saveReminder;window.markReminderDone=markReminderDone;window.deleteReminder=deleteReminder;window.doneReminderToast=doneReminderToast;window.snoozeReminder=snoozeReminder;window.closeToast=closeToast;window.exportCSV=exportCSV;window.importCSV=importCSV;window.inviteTeamMember=inviteTeamMember;window.applyFilters=applyFilters;window.debounceFilter=debounceFilter;window.clearFilters=clearFilters;window.goPage=goPage;window.toggleSelect=toggleSelect;window.toggleSelectAll=toggleSelectAll;window.bulkMoveStage=bulkMoveStage;window.bulkDelete=bulkDelete;window.kanbanDragStart=kanbanDragStart;window.kanbanDragEnd=kanbanDragEnd;window.kanbanDragOver=kanbanDragOver;window.kanbanDragLeave=kanbanDragLeave;window.kanbanDrop=kanbanDrop;

(async()=>{
  const{data:{session}}=await db.auth.getSession();
  if(session?.user){await initApp(session.user);}
})();
