import { SUPABASE_URL, SUPABASE_ANON_KEY, RESEND_API_KEY, FROM_EMAIL } from './supabase.js';
import { initBriefs } from './briefs.js';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
const STAGES = ['Fresh Lead','Contacted','Interested','Brief Expected','Brief Received','Plan Shared','Closed','Not Interested','In House Team','DNP'];
const SOURCES = ['Ads','LinkedIn','Apollo','Naukri','Shopify','Website','Referral','WhatsApp','Other'];
const STAGE_COLORS = {
  'Fresh Lead':'#6366F1','Contacted':'#3B82F6','Interested':'#10B981',
  'Brief Expected':'#F59E0B','Brief Received':'#F97316','Plan Shared':'#8B5CF6',
  'Closed':'#22C55E','Not Interested':'#EF4444','In House Team':'#64748B','DNP':'#DC2626'
};
let state = {
  user:null,profile:null,profiles:[],leads:[],filteredLeads:[],reminders:[],briefs:[],
  activities:[],inboundLeads:[],
  config:{services:[],sources:SOURCES,stages:STAGES},
  page:1,pageSize:20,sortCol:'created_at',sortDir:'desc',
  selectedLeads:new Set(),currentReminderFilter:'pending',
  editLeadId:null,editReminderId:null,activeView:'dashboard',filterDebounce:null,
  dashPeriod:'all',
  adminLeadFilter: '',
  adminBriefFilter: '',
  adminReminderFilter: '',
  adminDashFilter: '',
};
let briefsModule = null;
// ── HELPERS ──
function isAdmin() { return state.profile?.role === 'admin'; }
function visibleLeads() {
  if (isAdmin()) {
    if (state.adminLeadFilter) return state.leads.filter(l => l.assigned_to === state.adminLeadFilter);
    return state.leads;
  }
  return state.leads.filter(l => l.assigned_to === state.user.id);
}
function visibleReminders() {
  if (isAdmin()) {
    if (state.adminReminderFilter) return state.reminders.filter(r => r.assigned_to === state.adminReminderFilter);
    return state.reminders;
  }
  return state.reminders.filter(r => r.assigned_to === state.user.id);
}
function visibleBriefs() {
  if (isAdmin()) {
    if (state.adminBriefFilter) return state.briefs.filter(b => b.created_by === state.adminBriefFilter);
    return state.briefs;
  }
  return state.briefs.filter(b => b.created_by === state.user.id);
}
function dashLeads() {
  if (isAdmin()) {
    if (state.adminDashFilter) return state.leads.filter(l => l.assigned_to === state.adminDashFilter);
    return state.leads;
  }
  return state.leads.filter(l => l.assigned_to === state.user.id);
}
// ── AUTH ──
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
  await Promise.all([loadConfig(),loadProfiles(),loadLeads(),loadReminders(),loadActivities(),loadInbound()]);
  renderDashboard();renderLeads();renderReminders();
  briefsModule = initBriefs(db, state, esc, formatDate, isAdmin, visibleBriefs);
  await briefsModule.loadBriefs();
  briefsModule.renderBriefs();
  const isPublic = await briefsModule.checkPublicShare();
  if(isPublic) return;
  injectAdminFilterBars();
  document.querySelectorAll('.nav-btn').forEach(btn=>{btn.addEventListener('click',()=>switchView(btn.dataset.view,btn));});
  document.querySelectorAll('th.sortable').forEach(th=>{th.addEventListener('click',()=>handleSort(th.dataset.col));});
  document.getElementById('dash-date').textContent=new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  checkReminderPopups();
  setInterval(checkReminderPopups,60000);
  db.channel('leads-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'leads'},()=>loadLeads().then(()=>{renderLeads();renderDashboard();}))
    .on('postgres_changes',{event:'*',schema:'public',table:'reminders'},()=>loadReminders().then(renderReminders))
    .on('postgres_changes',{event:'*',schema:'public',table:'activities'},()=>loadActivities().then(()=>renderDashboard()))
    .on('postgres_changes',{event:'*',schema:'public',table:'leads_raw'},()=>loadInbound())
    .subscribe();
}
// ── ADMIN FILTER BARS ──
function injectAdminFilterBars() {
  if (!isAdmin()) return;
  const memberOpts = () => '<option value="">All members</option>' +
    state.profiles.map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
  const dashFilter = document.getElementById('dash-period-filter');
  if (dashFilter) {
    const adminSel = document.createElement('div');
    adminSel.id = 'dash-admin-filter-wrap';
    adminSel.style.cssText = 'margin-bottom:12px';
    adminSel.innerHTML = '<select id="dash-admin-sel" class="filter-sel" style="min-width:160px">' + memberOpts() + '</select>';
    dashFilter.parentNode.insertBefore(adminSel, dashFilter);
    document.getElementById('dash-admin-sel').addEventListener('change', function() {
      state.adminDashFilter = this.value;
      renderDashboard();
    });
  }
  const fAssigned = document.getElementById('f-assigned');
  if (fAssigned) {
    fAssigned.addEventListener('change', function() {
      state.adminLeadFilter = this.value;
      applyFilters();
    });
  }
  const remHeader = document.querySelector('#view-reminders .view-header');
  if (remHeader) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px';
    wrap.innerHTML = '<select id="rem-admin-sel" class="filter-sel" style="min-width:160px">' + memberOpts() + '</select>';
    remHeader.after(wrap);
    document.getElementById('rem-admin-sel').addEventListener('change', function() {
      state.adminReminderFilter = this.value;
      renderReminders();
    });
  }
  const briefsHeader = document.querySelector('#view-briefs .view-header');
  if (briefsHeader) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px';
    wrap.innerHTML = '<select id="briefs-admin-sel" class="filter-sel" style="min-width:160px">' + memberOpts() + '</select>';
    briefsHeader.after(wrap);
    document.getElementById('briefs-admin-sel').addEventListener('change', function() {
      state.adminBriefFilter = this.value;
      briefsModule?.renderBriefs();
    });
  }
  const settingsGrid = document.querySelector('.settings-grid');
  if (settingsGrid) {
    const card = document.createElement('div');
    card.className = 'settings-card';
    card.innerHTML = '<div class="settings-card-title">Bulk assign leads</div>'
      + '<p style="font-size:12px;color:var(--text-2);margin-bottom:12px">Assign all unassigned leads to a team member in one click. This only affects leads with no current owner.</p>'
      + '<div style="display:flex;gap:8px;align-items:center">'
      + '<select id="bulk-assign-member" class="filter-sel" style="flex:1">'
      + state.profiles.filter(p=>p.id!==state.user.id).map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('')
      + '</select>'
      + '<button class="btn-primary" onclick="bulkAssignUnassigned()">Assign</button>'
      + '</div>'
      + '<div id="bulk-assign-result" style="margin-top:8px;font-size:12px;color:var(--green)"></div>';
    settingsGrid.appendChild(card);
  }
}
// ── BULK ASSIGN UNASSIGNED ──
async function bulkAssignUnassigned() {
  const memberId = document.getElementById('bulk-assign-member').value;
  if (!memberId) return;
  const member = state.profiles.find(p => p.id === memberId);
  const unassigned = state.leads.filter(l => !l.assigned_to);
  if (!unassigned.length) {
    document.getElementById('bulk-assign-result').textContent = 'No unassigned leads found.';
    return;
  }
  if (!confirm('Assign ' + unassigned.length + ' unassigned leads to ' + (member?.name || 'selected member') + '?')) return;
  const { error } = await db.from('leads').update({ assigned_to: memberId, updated_at: new Date().toISOString() }).is('assigned_to', null);
  if (error) {
    document.getElementById('bulk-assign-result').textContent = 'Error: ' + error.message;
    return;
  }
  document.getElementById('bulk-assign-result').textContent = '✓ Assigned ' + unassigned.length + ' leads to ' + (member?.name || 'member');
  await loadLeads();
  renderLeads();
  renderDashboard();
}
async function loadConfig(){const{data}=await db.from('config').select('*');if(data){data.forEach(row=>{state.config[row.key]=row.value;});}state.config.stages=STAGES;state.config.sources=SOURCES;populateSelects();}
async function loadProfiles(){const{data}=await db.from('profiles').select('*').order('name');if(data)state.profiles=data;populateAssignedSelects();}
async function loadLeads(){
  let all=[];let from=0;const chunk=1000;
  while(true){
    const{data,error}=await db.from('leads')
      .select('*, assigned_profile:profiles!leads_assigned_to_fkey(name,avatar_initials)')
      .order(state.sortCol,{ascending:state.sortDir==='asc'})
      .range(from,from+chunk-1);
    if(error||!data||!data.length)break;
    all=[...all,...data];
    if(data.length<chunk)break;
    from+=chunk;
  }
  state.leads=all;applyFilters();
}
async function loadReminders(){const{data}=await db.from('reminders').select('*, lead:leads(name,company), assignee:profiles!reminders_assigned_to_fkey(name)').order('due_date',{ascending:true}).order('due_time',{ascending:true});if(data){state.reminders=data;updateReminderBadge();}}
async function loadActivities(){const{data}=await db.from('activities').select('*').order('created_at',{ascending:true});if(data)state.activities=data;}

// ── INBOUND LEADS ──
async function loadInbound() {
  const { data } = await db.from('leads_raw').select('*').order('created_at', { ascending: false });
  state.inboundLeads = data || [];
  updateInboundBadge();
  if (state.activeView === 'inbound') renderInbound();
}

function updateInboundBadge() {
  const count = (state.inboundLeads || []).length;
  const badge = document.getElementById('inbound-count');
  if (badge) {
    if (count > 0) { badge.style.display = 'inline-block'; badge.textContent = count; }
    else badge.style.display = 'none';
  }
  const label = document.getElementById('inbound-count-label');
  if (label) label.textContent = count + ' leads auto-captured from LinkedIn, Reddit, Google';
}

function renderInbound() {
  const source = document.getElementById('inbound-source-filter')?.value || '';
  const vertical = document.getElementById('inbound-vertical-filter')?.value || '';
  const scoreRange = document.getElementById('inbound-score-filter')?.value || '';

  let items = (state.inboundLeads || []).filter(l => {
    if (source && l.source !== source) return false;
    if (vertical && l.vertical !== vertical) return false;
    if (scoreRange === 'high' && (l.claude_score || 0) < 7) return false;
    if (scoreRange === 'mid' && ((l.claude_score || 0) < 4 || (l.claude_score || 0) > 6)) return false;
    if (scoreRange === 'low' && (l.claude_score || 0) > 3) return false;
    return true;
  });

  const list = document.getElementById('inbound-list');
  if (!list) return;

  if (!items.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📡</div><div>No inbound leads yet. The pipeline runs 5x/day automatically.</div></div>';
    return;
  }

  list.innerHTML = items.map(l => {
    const score = l.claude_score || 0;
    const scoreColor = score >= 7 ? 'var(--green)' : score >= 4 ? 'var(--amber)' : 'var(--text-3)';
    const scoreBg = score >= 7 ? 'var(--green-light)' : score >= 4 ? 'var(--amber-light)' : 'var(--surface-2)';
    const sourceIcon = { linkedin: '💼', reddit: '🟠', twitter: '🐦', facebook: '👥', google: '🔍' }[l.source] || '🌐';
    const date = l.created_at ? new Date(l.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

    return '<div class="inbound-card">'
      + '<div class="inbound-card-top">'
      + '<div style="display:flex;align-items:center;gap:10px;flex:1">'
      + '<span style="font-size:18px">' + sourceIcon + '</span>'
      + '<div style="flex:1">'
      + '<div style="font-size:13px;font-weight:500">' + esc(l.contact_name || 'Unknown') + (l.company ? ' · ' + esc(l.company) : '') + '</div>'
      + '<div style="font-size:11px;color:var(--text-3);margin-top:2px">' + esc(l.source || '') + (l.vertical ? ' · ' + l.vertical : '') + ' · ' + date + '</div>'
      + '</div>'
      + '</div>'
      + '<span style="background:' + scoreBg + ';color:' + scoreColor + ';font-size:12px;font-weight:600;padding:3px 10px;border-radius:12px;flex-shrink:0">' + score + '/10</span>'
      + '</div>'
      + '<div style="font-size:12px;color:var(--text-2);margin:10px 0;line-height:1.5;padding:10px;background:var(--surface-2);border-radius:var(--radius-sm)">' + esc((l.text_snippet || '').slice(0, 200)) + ((l.text_snippet || '').length > 200 ? '…' : '') + '</div>'
      + (l.claude_reason ? '<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">AI reason: ' + esc(l.claude_reason) + '</div>' : '')
      + (l.draft_message ? '<div style="font-size:12px;color:var(--purple);background:var(--purple-light);padding:10px;border-radius:var(--radius-sm);margin-bottom:10px;line-height:1.5"><strong>Draft outreach:</strong> ' + esc(l.draft_message) + '</div>' : '')
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      + (l.url ? '<a href="' + esc(l.url) + '" target="_blank" class="btn-sm">View post ↗</a>' : '')
      + '<button class="btn-primary" style="font-size:12px;padding:5px 12px" onclick="promoteInboundLead(\'' + l.id + '\')">+ Add to CRM</button>'
      + '<button class="btn-danger-sm" onclick="deleteInboundLead(\'' + l.id + '\')">Remove</button>'
      + '</div>'
      + '</div>';
  }).join('');
}

async function promoteInboundLead(id) {
  const lead = (state.inboundLeads || []).find(l => l.id === id);
  if (!lead) return;
  const payload = {
    name: lead.contact_name || 'Unknown',
    company: lead.company || '',
    source: lead.source === 'linkedin' ? 'LinkedIn' : lead.source || 'Other',
    stage: 'Fresh Lead',
    type: 'Prospect',
    notes: (lead.text_snippet || '').slice(0, 500) + (lead.draft_message ? '\n\nDraft outreach: ' + lead.draft_message : ''),
    assigned_to: state.user.id,
    created_by: state.user.id,
  };
  const { data } = await db.from('leads').insert(payload).select().single();
  if (data) {
    await db.from('activities').insert({ lead_id: data.id, user_id: state.user.id, type: 'created', text: 'Promoted from inbound lead (' + (lead.source || 'auto') + ')' });
    await db.from('leads_raw').delete().eq('id', id);
    state.inboundLeads = (state.inboundLeads || []).filter(l => l.id !== id);
    updateInboundBadge();
    renderInbound();
    await loadLeads();
    renderDashboard();
    alert('✓ Added to CRM as Fresh Lead');
  }
}

async function deleteInboundLead(id) {
  if (!confirm('Remove this lead from inbound?')) return;
  await db.from('leads_raw').delete().eq('id', id);
  state.inboundLeads = (state.inboundLeads || []).filter(l => l.id !== id);
  updateInboundBadge();
  renderInbound();
}

function getDashRange(period){
  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  let start=null;
  if(period==='today'){start=today;}
  else if(period==='week'){const d=new Date(today);d.setDate(d.getDate()-d.getDay());start=d;}
  else if(period==='month'){start=new Date(now.getFullYear(),now.getMonth(),1);}
  else if(period==='quarter'){const q=Math.floor(now.getMonth()/3);start=new Date(now.getFullYear(),q*3,1);}
  return start?start.toISOString():null;
}
function filterByPeriod(items,dateField,period){
  const start=getDashRange(period);
  if(!start)return items;
  return items.filter(i=>i[dateField]&&i[dateField]>=start);
}
function getChartBuckets(period){
  const now=new Date();
  const buckets=[];
  if(period==='today'){
    for(let h=0;h<24;h++)buckets.push({label:h+':00',key:String(h).padStart(2,'0')});
  } else if(period==='week'){
    const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const start=new Date();start.setDate(start.getDate()-start.getDay());
    for(let i=0;i<7;i++){const d=new Date(start);d.setDate(d.getDate()+i);buckets.push({label:days[d.getDay()],key:d.toISOString().split('T')[0]});}
  } else if(period==='month'){
    const dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    for(let d=1;d<=dim;d++)buckets.push({label:String(d),key:now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(d).padStart(2,'0')});
  } else if(period==='quarter'){
    const q=Math.floor(now.getMonth()/3);
    for(let m=q*3;m<q*3+3;m++){const mn=new Date(now.getFullYear(),m,1).toLocaleDateString('en-IN',{month:'short'});buckets.push({label:mn,key:now.getFullYear()+'-'+String(m+1).padStart(2,'0')});}
  } else {
    for(let i=11;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);buckets.push({label:d.toLocaleDateString('en-IN',{month:'short',year:'2-digit'}),key:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')});}
  }
  return buckets;
}
function getItemKey(isoStr,period){
  if(!isoStr)return '';
  if(period==='today')return isoStr.substring(11,13);
  if(period==='week'||period==='month')return isoStr.substring(0,10);
  return isoStr.substring(0,7);
}
function renderBarChart(containerId,buckets,counts,color){
  const max=Math.max(...Object.values(counts),1);
  const container=document.getElementById(containerId);
  if(!container)return;
  const showEvery=buckets.length>15?Math.ceil(buckets.length/10):1;
  let barsHtml='';
  for(let i=0;i<buckets.length;i++){
    const b=buckets[i];
    const val=counts[b.key]||0;
    const h=max>0?Math.round((val/max)*90):0;
    const showLabel=i%showEvery===0;
    const valLabel=val>0?'<span style="font-size:8px;color:var(--text-2);margin-bottom:2px">'+val+'</span>':'<span style="font-size:8px;color:transparent">0</span>';
    barsHtml+='<div style="flex:1;display:flex;flex-direction:column;align-items:center;position:relative">'
      +valLabel
      +'<div title="'+b.label+': '+val+'" style="width:100%;background:'+color+';border-radius:3px 3px 0 0;height:'+h+'px;min-height:'+(val>0?'2':'0')+'px;transition:height 0.3s"></div>'
      +'<span style="font-size:9px;color:var(--text-3);position:absolute;bottom:-18px;white-space:nowrap;'+(showLabel?'':'visibility:hidden')+'">'+b.label+'</span>'
      +'</div>';
  }
  container.innerHTML=
    '<div style="display:flex;gap:2px;margin-bottom:4px">'
    +'<div style="width:24px;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;padding-bottom:20px">'
    +'<span style="font-size:9px;color:var(--text-3)">'+max+'</span>'
    +'<span style="font-size:9px;color:var(--text-3)">'+Math.round(max/2)+'</span>'
    +'<span style="font-size:9px;color:var(--text-3)">0</span>'
    +'</div>'
    +'<div style="flex:1;position:relative">'
    +'<div style="position:absolute;top:0;left:0;right:0;bottom:20px;display:flex;flex-direction:column;justify-content:space-between;pointer-events:none">'
    +'<div style="border-top:1px dashed var(--border);width:100%"></div>'
    +'<div style="border-top:1px dashed var(--border);width:100%"></div>'
    +'<div style="border-top:1px solid var(--border);width:100%"></div>'
    +'</div>'
    +'<div style="display:flex;align-items:flex-end;gap:3px;height:120px;padding-bottom:20px;position:relative">'
    +barsHtml
    +'</div></div></div>';
}
function renderDashboard(){
  const period=state.dashPeriod;
  const allLeads=dashLeads();
  const filteredLeads=filterByPeriod(allLeads,'created_at',period);
  const visibleLeadIds = new Set(allLeads.map(l=>l.id));
  const allActivities = (state.activities||[]).filter(a => !a.lead_id || visibleLeadIds.has(a.lead_id));
  const filteredActivities=filterByPeriod(allActivities,'created_at',period);
  const followedUpLeadIds=new Set(filteredActivities.map(a=>a.lead_id).filter(Boolean));
  const followedUpCount=followedUpLeadIds.size;
  const won=filteredLeads.filter(l=>l.stage==='Closed');
  const totalVal=filteredLeads.reduce((s,l)=>s+(+l.value||0),0);
  const conv=filteredLeads.length?Math.round(won.length/filteredLeads.length*100):0;
  const today=new Date().toISOString().split('T')[0];
  const periodLabels={today:'Today',week:'This week',month:'This month',quarter:'This quarter',all:'All time'};
  document.getElementById('metrics-row').innerHTML=
    '<div class="metric-card"><div class="metric-label">Total leads</div><div class="metric-value purple">'+filteredLeads.length.toLocaleString('en-IN')+'</div><div class="metric-sub">'+periodLabels[period]+'</div></div>'
    +'<div class="metric-card"><div class="metric-label">Followed up</div><div class="metric-value" style="color:var(--blue)">'+followedUpCount.toLocaleString('en-IN')+'</div><div class="metric-sub">Leads with activity</div></div>'
    +'<div class="metric-card"><div class="metric-label">Conversion rate</div><div class="metric-value green">'+conv+'%</div><div class="metric-sub">'+won.length+' closed</div></div>'
    +'<div class="metric-card"><div class="metric-label">Pipeline value</div><div class="metric-value amber">₹'+formatINR(totalVal)+'</div><div class="metric-sub">Estimated retainers</div></div>';
  const filterEl=document.getElementById('dash-period-filter');
  if(filterEl){
    let tabsHtml='<div class="dash-period-tabs">';
    ['today','week','month','quarter','all'].forEach(function(p){tabsHtml+='<button class="dash-period-btn '+(period===p?'active':'')+'" onclick="setDashPeriod(\''+p+'\')">'+periodLabels[p]+'</button>';});
    tabsHtml+='</div>';
    filterEl.innerHTML=tabsHtml;
  }
  const maxS=Math.max(...STAGES.map(s=>filteredLeads.filter(l=>l.stage===s).length),1);
  document.getElementById('stage-bars').innerHTML=STAGES.map(s=>{const c=filteredLeads.filter(l=>l.stage===s).length;return'<div class="stage-bar-row"><span class="stage-bar-label" style="width:110px">'+s+'</span><div class="stage-bar-track"><div class="stage-bar-fill" style="width:'+Math.round(c/maxS*100)+'%;background:'+STAGE_COLORS[s]+'"></div></div><span class="stage-bar-count">'+c+'</span></div>';}).join('');
  const srcMap={};filteredLeads.forEach(l=>{if(l.source){const src=l.source.trim();srcMap[src]=(srcMap[src]||0)+1;}});
  document.getElementById('source-chart').innerHTML=Object.entries(srcMap).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([s,c])=>'<div class="source-row"><span>'+s+'</span><span class="source-pill">'+c+'</span></div>').join('')||'<div class="empty-state">No source data yet</div>';
  const buckets=getChartBuckets(period);
  const createdCounts={};
  buckets.forEach(b=>{createdCounts[b.key]=0;});
  filteredLeads.forEach(l=>{const key=getItemKey(l.created_at,period);if(key in createdCounts)createdCounts[key]++;});
  renderBarChart('leads-created-chart-inner',buckets,createdCounts,'#6366F1');
  const followupCounts={};
  const bucketLeadSets={};
  buckets.forEach(b=>{followupCounts[b.key]=0;bucketLeadSets[b.key]=new Set();});
  filteredActivities.forEach(a=>{if(!a.lead_id)return;const key=getItemKey(a.created_at,period);if(key in bucketLeadSets)bucketLeadSets[key].add(a.lead_id);});
  buckets.forEach(b=>{followupCounts[b.key]=bucketLeadSets[b.key].size;});
  renderBarChart('leads-followup-chart-inner',buckets,followupCounts,'#10B981');
  const due=allLeads.filter(l=>l.followup_date===today);
  document.getElementById('followups-today').innerHTML=due.length?due.slice(0,5).map(l=>'<div class="followup-row"><div><div class="followup-name">'+l.name+'</div><div class="followup-company">'+(l.company||'')+'</div></div><button class="btn-sm" onclick="openLeadDetail(\''+l.id+'\')">View</button></div>').join(''):'<div class="empty-state"><div class="empty-state-icon">✓</div>No follow-ups today</div>';
  const perfMap={};filteredLeads.forEach(l=>{if(!l.assigned_to)return;const prof=state.profiles.find(p=>p.id===l.assigned_to);const name=prof?.name||'Unknown';if(!perfMap[name])perfMap[name]={total:0,won:0};perfMap[name].total++;if(l.stage==='Closed')perfMap[name].won++;});
  document.getElementById('team-perf').innerHTML=Object.entries(perfMap).sort((a,b)=>b[1].total-a[1].total).map(([name,p])=>'<div class="team-row"><span style="font-weight:500">'+name+'</span><div class="team-stats"><div class="team-stat"><div class="team-stat-num">'+p.total+'</div><div class="team-stat-lbl">Leads</div></div><div class="team-stat"><div class="team-stat-num">'+p.won+'</div><div class="team-stat-lbl">Closed</div></div><div class="team-stat"><div class="team-stat-num">'+(p.total?Math.round(p.won/p.total*100):0)+'%</div><div class="team-stat-lbl">Conv.</div></div></div></div>').join('')||'<div class="empty-state">Assign leads to see stats</div>';
}
function setDashPeriod(period){state.dashPeriod=period;renderDashboard();}
function populateSelects(){
  const svcs=state.config.services||[];
  const fsvc=document.getElementById('f-service');const fsrc=document.getElementById('f-source');const fstage=document.getElementById('f-stage');
  if(fstage)fstage.innerHTML='<option value="">All stages</option>'+STAGES.map(s=>'<option>'+s+'</option>').join('');
  if(fsvc)fsvc.innerHTML='<option value="">All services</option>'+svcs.map(s=>'<option>'+s+'</option>').join('');
  if(fsrc)fsrc.innerHTML='<option value="">All sources</option>'+SOURCES.map(s=>'<option>'+s+'</option>').join('');
  const lfsvc=document.getElementById('lf-service');const lfsrc=document.getElementById('lf-source');const lfstage=document.getElementById('lf-stage');
  if(lfstage)lfstage.innerHTML=STAGES.map(s=>'<option>'+s+'</option>').join('');
  if(lfsvc)lfsvc.innerHTML='<option value=""></option>'+svcs.map(s=>'<option>'+s+'</option>').join('');
  if(lfsrc)lfsrc.innerHTML='<option value=""></option>'+SOURCES.map(s=>'<option>'+s+'</option>').join('');
  const svl=document.getElementById('services-list');const sol=document.getElementById('sources-list');
  if(svl)svl.innerHTML=svcs.map(s=>'<span class="config-tag">'+s+'</span>').join('');
  if(sol)sol.innerHTML=SOURCES.map(s=>'<span class="config-tag">'+s+'</span>').join('');
}
function populateAssignedSelects(){
  const opts=state.profiles.map(p=>'<option value="'+p.id+'">'+p.name+'</option>').join('');
  const emptyOpt='<option value="">Unassigned</option>';
  const fAssigned = document.getElementById('f-assigned');
  if (fAssigned) {
    if (isAdmin()) {
      fAssigned.innerHTML = '<option value="">All members</option>' + opts;
      fAssigned.style.display = '';
    } else {
      fAssigned.style.display = 'none';
    }
  }
  const rfAssigned = document.getElementById('rf-assigned');
  if (rfAssigned) {
    if (isAdmin()) {
      rfAssigned.innerHTML = emptyOpt + opts;
    } else {
      rfAssigned.innerHTML = '<option value="' + state.user.id + '">' + (state.profile?.name || 'Me') + '</option>';
    }
  }
  const lfAssigned = document.getElementById('lf-assigned');
  if (lfAssigned) {
    if (isAdmin()) {
      lfAssigned.innerHTML = emptyOpt + opts;
    } else {
      lfAssigned.innerHTML = '<option value="' + state.user.id + '">' + (state.profile?.name || 'Me') + '</option>';
    }
  }
  const tl=document.getElementById('team-list');
  if(tl)tl.innerHTML=state.profiles.map(p=>'<div class="team-member-row"><div class="tm-info"><div class="tm-avatar">'+(p.avatar_initials||'?')+'</div><div><div style="font-weight:500">'+p.name+'</div><div style="font-size:11px;color:var(--text-3)">'+p.email+'</div></div></div><span class="tm-role">'+p.role+'</span></div>').join('');
}
function switchView(viewName,btn){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('view-'+viewName)?.classList.add('active');
  btn?.classList.add('active');state.activeView=viewName;
  if(viewName==='pipeline')renderKanban();
  if(viewName==='briefs'){briefsModule?.renderBriefs();}
  if(viewName==='inbound'){renderInbound();}
  if(viewName==='settings'){loadProfiles().then(()=>populateAssignedSelects());}
}
function applyFilters(){
  const q=(document.getElementById('search-q')?.value||'').toLowerCase();
  const stage=document.getElementById('f-stage')?.value||'';
  const type=document.getElementById('f-type')?.value||'';
  const service=document.getElementById('f-service')?.value||'';
  const source=document.getElementById('f-source')?.value||'';
  let base = visibleLeads();
  state.filteredLeads=base.filter(l=>{
    if(q&&!(l.name+l.company+l.email+l.phone+l.city).toLowerCase().includes(q))return false;
    if(stage&&l.stage!==stage)return false;
    if(type&&l.type!==type)return false;
    if(service&&l.service!==service)return false;
    if(source&&l.source!==source)return false;
    return true;
  });
  state.page=1;state.selectedLeads.clear();renderLeads();
}
function debounceFilter(){clearTimeout(state.filterDebounce);state.filterDebounce=setTimeout(applyFilters,250);}
function clearFilters(){
  ['search-q','f-stage','f-type','f-service','f-source'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  if(isAdmin()){
    const fa=document.getElementById('f-assigned');if(fa)fa.value='';
    state.adminLeadFilter='';
  }
  applyFilters();
}
function handleSort(col){if(state.sortCol===col){state.sortDir=state.sortDir==='asc'?'desc':'asc';}else{state.sortCol=col;state.sortDir='asc';}document.querySelectorAll('th.sortable').forEach(th=>{th.classList.remove('sort-asc','sort-desc');if(th.dataset.col===col)th.classList.add(state.sortDir==='asc'?'sort-asc':'sort-desc');});loadLeads().then(renderLeads);}
function renderLeads(){
  const fl=state.filteredLeads;const total=fl.length;
  const pages=Math.max(1,Math.ceil(total/state.pageSize));
  const start=(state.page-1)*state.pageSize;const slice=fl.slice(start,start+state.pageSize);
  const totalVisible = visibleLeads().length;
  document.getElementById('leads-count-label').textContent=total.toLocaleString('en-IN')+' leads'+(total!==totalVisible?' (filtered from '+totalVisible.toLocaleString('en-IN')+')':'');
  const tbody=document.getElementById('leads-tbody');
  if(!slice.length){tbody.innerHTML='<tr><td colspan="11" class="empty-row"><div class="empty-state-icon">🔍</div><div>No leads found</div></td></tr>';}
  else{
    tbody.innerHTML=slice.map(l=>{
      const prof=l.assigned_profile;const fu=l.followup_date;const today=new Date().toISOString().split('T')[0];
      const fuClass=fu&&fu<today?'color:var(--red)':fu===today?'color:var(--amber)':'';
      const stageColor=STAGE_COLORS[l.stage]||'#6366F1';
      const createdDate=l.created_at?formatDate(l.created_at.split('T')[0]):'—';
      return'<tr data-id="'+l.id+'" class="'+(state.selectedLeads.has(l.id)?'selected':'')+'">'
        +'<td><input type="checkbox" '+(state.selectedLeads.has(l.id)?'checked':'')+' onchange="toggleSelect(\''+l.id+'\',this)"/></td>'
        +'<td><div class="lead-name">'+esc(l.name)+'</div><div class="lead-company">'+esc(l.company||'')+'</div></td>'
        +'<td><div class="lead-email">'+esc(l.email||'—')+'</div><div class="lead-phone">'+esc(l.phone||'')+'</div></td>'
        +'<td><span class="stage-badge" style="background:'+stageColor+'22;color:'+stageColor+'">'+l.stage+'</span></td>'
        +'<td style="font-size:12px;color:var(--text-2)">'+esc(l.service||'—')+'</td>'
        +'<td style="font-size:12px;color:var(--text-3)">'+esc(l.source||'—')+'</td>'
        +'<td style="font-size:12px;font-family:\'DM Mono\',monospace">₹'+(+l.value||0).toLocaleString('en-IN')+'</td>'
        +'<td>'+(prof?'<div style="display:flex;align-items:center;gap:5px;font-size:12px"><div class="user-avatar" style="width:20px;height:20px;font-size:9px">'+(prof.avatar_initials||'?')+'</div>'+prof.name.split(' ')[0]+'</div>':'<span style="font-size:12px;color:var(--text-3)">—</span>')+'</td>'
        +'<td style="font-size:12px;'+fuClass+'">'+(fu?formatDate(fu):'—')+'</td>'
        +'<td style="font-size:12px;color:var(--text-3)">'+createdDate+'</td>'
        +'<td><div style="display:flex;gap:4px"><button class="btn-sm" onclick="openLeadDetail(\''+l.id+'\')">View</button><button class="btn-sm" onclick="openEditLead(\''+l.id+'\')">Edit</button></div></td>'
        +'</tr>';
    }).join('');
  }
  const pag=document.getElementById('pagination');
  pag.innerHTML='<span class="page-info">'+(start+1)+'–'+Math.min(start+state.pageSize,total)+' of '+total+'</span>';
  if(pages>1){
    pag.innerHTML+='<button class="page-btn" onclick="goPage('+(state.page-1)+')" '+(state.page===1?'disabled':'')+'>←</button>';
    for(let i=Math.max(1,state.page-2);i<=Math.min(pages,state.page+2);i++){pag.innerHTML+='<button class="page-btn '+(i===state.page?'active':'')+'" onclick="goPage('+i+')">'+i+'</button>';}
    pag.innerHTML+='<button class="page-btn" onclick="goPage('+(state.page+1)+')" '+(state.page===pages?'disabled':'')+'>→</button>';
  }
  const bulk=document.getElementById('bulk-actions');const selCount=state.selectedLeads.size;
  bulk.style.display=selCount>0?'flex':'none';
  document.getElementById('selected-count').textContent=selCount+' selected';
  document.getElementById('select-all').checked=slice.length>0&&slice.every(l=>state.selectedLeads.has(l.id));
  renderBulkReassignBar();
}
function renderBulkReassignBar() {
  if (!isAdmin()) return;
  const bulk = document.getElementById('bulk-actions');
  if (!bulk) return;
  if (!document.getElementById('bulk-reassign-sel')) {
    const sel = document.createElement('select');
    sel.id = 'bulk-reassign-sel';
    sel.className = 'filter-sel';
    sel.innerHTML = '<option value="">Reassign to…</option>' +
      state.profiles.map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn-secondary';
    applyBtn.textContent = 'Reassign';
    applyBtn.onclick = bulkReassign;
    bulk.appendChild(sel);
    bulk.appendChild(applyBtn);
  }
}
async function bulkReassign() {
  const memberId = document.getElementById('bulk-reassign-sel')?.value;
  if (!memberId || !state.selectedLeads.size) return;
  const member = state.profiles.find(p => p.id === memberId);
  if (!confirm('Reassign ' + state.selectedLeads.size + ' leads to ' + (member?.name || 'selected member') + '?')) return;
  const ids = [...state.selectedLeads];
  await db.from('leads').update({ assigned_to: memberId, updated_at: new Date().toISOString() }).in('id', ids);
  state.selectedLeads.clear();
  await loadLeads();
  renderLeads();
  renderDashboard();
}
function goPage(p){state.page=p;renderLeads();}
function toggleSelect(id,cb){if(cb.checked)state.selectedLeads.add(id);else state.selectedLeads.delete(id);renderLeads();}
function toggleSelectAll(cb){const fl=state.filteredLeads;const start=(state.page-1)*state.pageSize;const slice=fl.slice(start,start+state.pageSize);if(cb.checked)slice.forEach(l=>state.selectedLeads.add(l.id));else slice.forEach(l=>state.selectedLeads.delete(l.id));renderLeads();}
async function bulkMoveStage(){const stage=document.getElementById('bulk-stage').value;if(!stage||!state.selectedLeads.size)return;const ids=[...state.selectedLeads];await db.from('leads').update({stage,updated_at:new Date().toISOString()}).in('id',ids);state.selectedLeads.clear();await loadLeads();renderLeads();renderDashboard();}
async function bulkDelete(){if(!state.selectedLeads.size)return;if(!confirm('Delete '+state.selectedLeads.size+' leads?'))return;const ids=[...state.selectedLeads];await db.from('leads').delete().in('id',ids);state.selectedLeads.clear();await loadLeads();renderLeads();renderDashboard();}
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
  const assignedTo = isAdmin()
    ? (document.getElementById('lf-assigned').value||null)
    : state.user.id;
  const payload={name,company:document.getElementById('lf-company').value,email:document.getElementById('lf-email').value,phone:document.getElementById('lf-phone').value,stage:document.getElementById('lf-stage').value,type:document.getElementById('lf-type').value,service:document.getElementById('lf-service').value,source:document.getElementById('lf-source').value,value:+document.getElementById('lf-value').value||0,city:document.getElementById('lf-city').value,notes:document.getElementById('lf-notes').value,followup_date:document.getElementById('lf-followup').value||null,assigned_to:assignedTo,updated_at:new Date().toISOString()};
  const editId=state.editLeadId;
  if(editId){
    const old=state.leads.find(l=>l.id===editId);await db.from('leads').update(payload).eq('id',editId);
    if(old&&old.stage!==payload.stage){await db.from('activities').insert({lead_id:editId,user_id:state.user.id,type:'stage_change',text:'Stage changed from '+old.stage+' to '+payload.stage});}
    else{await db.from('activities').insert({lead_id:editId,user_id:state.user.id,type:'edit',text:'Lead updated'});}
    if(old&&old.assigned_to!==payload.assigned_to){const newOwner=state.profiles.find(p=>p.id===payload.assigned_to);await db.from('activities').insert({lead_id:editId,user_id:state.user.id,type:'edit',text:'Lead assigned to '+(newOwner?.name||'someone')});}
  }else{
    payload.created_by=state.user.id;const{data}=await db.from('leads').insert(payload).select().single();
    if(data){await db.from('activities').insert({lead_id:data.id,user_id:state.user.id,type:'created',text:'Lead created'});}
  }
  closeModal('add-lead-modal');await loadLeads();await loadActivities();renderLeads();renderDashboard();if(state.activeView==='pipeline')renderKanban();
}
async function deleteLead(id){if(!confirm('Delete this lead?'))return;await db.from('leads').delete().eq('id',id);document.getElementById('lead-detail-overlay').style.display='none';await loadLeads();renderLeads();renderDashboard();if(state.activeView==='pipeline')renderKanban();}
async function openLeadDetail(id){
  const l=state.leads.find(x=>x.id===id);if(!l)return;
  const{data:acts}=await db.from('activities').select('*, user:profiles(name,avatar_initials)').eq('lead_id',id).order('created_at',{ascending:false});
  const stageColor=STAGE_COLORS[l.stage]||'#6366F1';
  const actsHtml=(acts||[]).map(a=>'<div class="activity-item"><div class="activity-dot '+a.type+'"></div><div class="activity-content"><div class="activity-text">'+(a.type==='comment'?'💬 ':'')+esc(a.text)+'</div><div class="activity-author">'+(a.user?.name||'System')+' · '+formatDateTime(a.created_at)+'</div></div></div>').join('')||'<div style="font-size:13px;color:var(--text-3)">No activity yet</div>';
  const stageButtons=STAGES.map(s=>'<button class="stage-switch-btn '+(l.stage===s?'active':'')+'" onclick="changeStageFromPanel(\''+l.id+'\',\''+s+'\')" style="'+(l.stage===s?'background:'+STAGE_COLORS[s]+';border-color:'+STAGE_COLORS[s]+';color:white':'')+'">'+s+'</button>').join('');
  const profileOpts=state.profiles.map(p=>'<option value="'+p.id+'" '+(p.id===l.assigned_to?'selected':'')+'>'+p.name+'</option>').join('');
  const assignSection = isAdmin()
    ? '<div class="panel-section"><div class="panel-section-title">Assign owner</div><div style="display:flex;gap:8px;align-items:center"><select id="assign-select" style="flex:1;padding:8px 10px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface-2);color:var(--text-1);font-size:13px;outline:none"><option value="">Unassigned</option>'+profileOpts+'</select><button class="btn-primary" onclick="assignLead(\''+l.id+'\')">Assign</button></div></div>'
    : '';
  document.getElementById('lead-detail-panel').innerHTML=
    '<div class="panel-header"><div>'
    +'<div style="font-size:17px;font-weight:600">'+esc(l.name)+'</div>'
    +'<div style="font-size:13px;color:var(--text-3)">'+esc(l.company||'')+'</div>'
    +'<div style="margin-top:8px"><span class="stage-badge" style="background:'+stageColor+'22;color:'+stageColor+'">'+l.stage+'</span></div>'
    +'</div><button class="modal-close" onclick="document.getElementById(\'lead-detail-overlay\').style.display=\'none\'">✕</button></div>'
    +'<div class="panel-section"><div class="panel-section-title">Contact details</div><div class="info-grid">'
    +'<div class="info-field"><div class="info-label">Email</div><div class="info-value">'+esc(l.email||'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Phone</div><div class="info-value">'+esc(l.phone||'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">City</div><div class="info-value">'+esc(l.city||'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Service</div><div class="info-value">'+esc(l.service||'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Source</div><div class="info-value">'+esc(l.source||'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Deal value</div><div class="info-value" style="font-family:\'DM Mono\',monospace;color:var(--purple)">₹'+(+l.value||0).toLocaleString('en-IN')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Follow-up</div><div class="info-value">'+(l.followup_date?formatDate(l.followup_date):'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Created on</div><div class="info-value">'+(l.created_at?formatDate(l.created_at.split('T')[0]):'—')+'</div></div>'
    +'</div>'+(l.notes?'<div style="margin-top:10px;font-size:13px;color:var(--text-2);background:var(--surface-2);padding:10px;border-radius:var(--radius-sm)">'+esc(l.notes)+'</div>':'')+'</div>'
    +'<div class="panel-section"><div class="panel-section-title">Move stage</div><div class="stage-switcher">'+stageButtons+'</div></div>'
    +assignSection
    +'<div class="panel-section"><div class="panel-section-title">Quick actions</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-sm" onclick="openEditLead(\''+l.id+'\');document.getElementById(\'lead-detail-overlay\').style.display=\'none\'">Edit lead</button><button class="btn-sm" onclick="openReminderForLead(\''+l.id+'\')">+ Reminder</button><button class="btn-sm" onclick="openBriefModal(\''+l.id+'\',true)">+ Brief</button>'+(isAdmin()?'<button class="btn-danger-sm" onclick="deleteLead(\''+l.id+'\')">Delete</button>':'')+'</div></div>'
    +'<div class="panel-section"><div class="panel-section-title">Activity & comments</div><div class="activity-list">'+actsHtml+'</div><div class="comment-composer"><textarea class="comment-input" id="comment-input-'+id+'" rows="2" placeholder="Add a comment or note…"></textarea><button class="btn-primary" style="align-self:flex-end" onclick="postComment(\''+l.id+'\')">Post</button></div></div>';
  document.getElementById('lead-detail-overlay').style.display='flex';
}
async function assignLead(leadId){const newOwner=document.getElementById('assign-select').value;const ownerName=state.profiles.find(p=>p.id===newOwner)?.name||'Unassigned';await db.from('leads').update({assigned_to:newOwner||null,updated_at:new Date().toISOString()}).eq('id',leadId);await db.from('activities').insert({lead_id:leadId,user_id:state.user.id,type:'edit',text:'Lead assigned to '+ownerName});await loadLeads();renderLeads();openLeadDetail(leadId);}
async function changeStageFromPanel(leadId,stage){const old=state.leads.find(l=>l.id===leadId);await db.from('leads').update({stage,updated_at:new Date().toISOString()}).eq('id',leadId);await db.from('activities').insert({lead_id:leadId,user_id:state.user.id,type:'stage_change',text:'Stage changed from '+(old?.stage||'?')+' to '+stage});await loadLeads();await loadActivities();renderLeads();renderDashboard();if(state.activeView==='pipeline')renderKanban();openLeadDetail(leadId);}
async function postComment(leadId){const inp=document.getElementById('comment-input-'+leadId);const text=inp?.value.trim();if(!text)return;await db.from('activities').insert({lead_id:leadId,user_id:state.user.id,type:'comment',text});inp.value='';await loadActivities();renderDashboard();openLeadDetail(leadId);}
function renderKanban(){
  const leadsPool = visibleLeads();
  const filteredPool = (isAdmin() && state.adminLeadFilter)
    ? leadsPool.filter(l => l.assigned_to === state.adminLeadFilter)
    : leadsPool;
  document.getElementById('kanban-board').innerHTML=STAGES.map(stage=>{
    const cards=filteredPool.filter(l=>l.stage===stage);
    return'<div class="kanban-col" data-stage="'+stage+'" ondragover="kanbanDragOver(event,this)" ondrop="kanbanDrop(event,\''+stage+'\')" ondragleave="kanbanDragLeave(this)">'
      +'<div class="col-header"><div class="col-title-wrap"><div class="col-accent" style="background:'+STAGE_COLORS[stage]+'"></div><span class="col-name">'+stage+'</span></div><span class="col-count">'+cards.length+'</span></div>'
      +'<div class="col-cards">'+cards.map(l=>'<div class="kanban-card" draggable="true" data-id="'+l.id+'" ondragstart="kanbanDragStart(event,\''+l.id+'\')" ondragend="kanbanDragEnd(event)" onclick="openLeadDetail(\''+l.id+'\')"><div class="kcard-name">'+esc(l.name)+'</div><div class="kcard-company">'+esc(l.company||'—')+'</div><div class="kcard-footer"><span class="kcard-value">'+(l.value?'₹'+(+l.value).toLocaleString('en-IN'):'')+'</span><span class="kcard-service">'+esc(l.service||'')+'</span></div></div>').join('')+'</div>'
      +'</div>';
  }).join('');
  if (isAdmin()) {
    const board = document.getElementById('kanban-board');
    let filterWrap = document.getElementById('kanban-admin-filter');
    if (!filterWrap) {
      filterWrap = document.createElement('div');
      filterWrap.id = 'kanban-admin-filter';
      filterWrap.style.cssText = 'position:sticky;top:0;z-index:5;background:var(--bg);padding:8px 0 12px;display:flex;gap:8px;align-items:center';
      filterWrap.innerHTML = '<span style="font-size:12px;color:var(--text-2)">Filter by:</span>'
        + '<select id="kanban-member-sel" class="filter-sel" style="min-width:160px">'
        + '<option value="">All members</option>'
        + state.profiles.map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('')
        + '</select>';
      board.parentNode.insertBefore(filterWrap, board);
      document.getElementById('kanban-member-sel').addEventListener('change', function() {
        state.adminLeadFilter = this.value;
        renderKanban();
      });
    }
    const kanbanSel = document.getElementById('kanban-member-sel');
    if (kanbanSel) kanbanSel.value = state.adminLeadFilter;
  }
}
let draggedLeadId=null;
function kanbanDragStart(e,id){draggedLeadId=id;e.target.classList.add('dragging');e.dataTransfer.effectAllowed='move';}
function kanbanDragEnd(e){e.target.classList.remove('dragging');}
function kanbanDragOver(e,col){e.preventDefault();col.classList.add('drag-target');}
function kanbanDragLeave(col){col.classList.remove('drag-target');}
async function kanbanDrop(e,stage){e.preventDefault();document.querySelectorAll('.kanban-col').forEach(c=>c.classList.remove('drag-target'));if(!draggedLeadId)return;const old=state.leads.find(l=>l.id===draggedLeadId);if(old?.stage===stage)return;await db.from('leads').update({stage,updated_at:new Date().toISOString()}).eq('id',draggedLeadId);await db.from('activities').insert({lead_id:draggedLeadId,user_id:state.user.id,type:'stage_change',text:'Stage moved to '+stage+' via Kanban'});draggedLeadId=null;await loadLeads();renderKanban();renderDashboard();}
function renderReminders(){
  const today=new Date().toISOString().split('T')[0];const filter=state.currentReminderFilter;
  let items=visibleReminders().filter(r=>{
    if(filter==='done')return r.done;
    if(filter==='overdue')return!r.done&&r.due_date<today;
    if(filter==='today')return!r.done&&r.due_date===today;
    return!r.done;
  });
  const list=document.getElementById('reminders-list');
  list.innerHTML=items.length?items.map(r=>{const cls=r.done?'done':r.due_date<today?'overdue':r.due_date===today?'today':'upcoming';const icons={overdue:'⚠️',today:'📅',upcoming:'🔔',done:'✅'};return'<div class="reminder-item '+cls+'"><div class="rem-icon '+cls+'">'+icons[cls]+'</div><div class="rem-body"><div class="rem-title">'+esc(r.title)+'</div><div class="rem-meta">'+formatDate(r.due_date)+' at '+r.due_time+(r.lead?' · '+r.lead.name:'')+(r.assignee?' · '+r.assignee.name:'')+'</div>'+(r.notes?'<div class="rem-notes">'+esc(r.notes)+'</div>':'')+'<div class="rem-actions">'+(!r.done?'<button class="btn-sm" onclick="markReminderDone(\''+r.id+'\')">✓ Done</button>':'')+'<button class="btn-sm" onclick="openEditReminder(\''+r.id+'\')">Edit</button>'+(r.lead?'<button class="btn-sm" onclick="openLeadDetail(\''+r.lead_id+'\')">View lead</button>':'')+'<button class="btn-danger-sm" onclick="deleteReminder(\''+r.id+'\')">Delete</button></div></div></div>';}).join(''):'<div class="empty-state"><div class="empty-state-icon">🔔</div><div>No '+filter+' reminders</div></div>';
  document.querySelectorAll('.rem-tab').forEach(btn=>{btn.onclick=()=>{document.querySelectorAll('.rem-tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');state.currentReminderFilter=btn.dataset.filter;renderReminders();};});
}
function updateReminderBadge(){
  const today=new Date().toISOString().split('T')[0];
  const overdue=visibleReminders().filter(r=>!r.done&&r.due_date<=today).length;
  const badge=document.getElementById('reminder-count');
  if(overdue>0){badge.style.display='inline-block';badge.textContent=overdue;}else badge.style.display='none';
}
function openAddReminder(){
  state.editReminderId=null;
  document.getElementById('reminder-modal-title').textContent='Add reminder';
  document.getElementById('edit-reminder-id').value='';
  document.getElementById('rf-title').value='';
  document.getElementById('rf-notes').value='';
  document.getElementById('rf-date').value='';
  document.getElementById('rf-time').value='10:00';
  const leadsOpts = visibleLeads().map(l=>'<option value="'+l.id+'">'+esc(l.name)+' — '+esc(l.company||'')+'</option>').join('');
  document.getElementById('rf-lead').innerHTML='<option value="">— none —</option>'+leadsOpts;
  document.getElementById('rf-assigned').value=state.user.id||'';
  openModal('add-reminder-modal');
}
function openReminderForLead(leadId){openAddReminder();document.getElementById('rf-lead').value=leadId;document.getElementById('lead-detail-overlay').style.display='none';}
function openEditReminder(id){
  const r=state.reminders.find(x=>x.id===id);if(!r)return;
  state.editReminderId=id;
  document.getElementById('reminder-modal-title').textContent='Edit reminder';
  document.getElementById('edit-reminder-id').value=id;
  document.getElementById('rf-title').value=r.title||'';
  document.getElementById('rf-notes').value=r.notes||'';
  document.getElementById('rf-date').value=r.due_date||'';
  document.getElementById('rf-time').value=r.due_time||'10:00';
  const leadsOpts = visibleLeads().map(l=>'<option value="'+l.id+'" '+(l.id===r.lead_id?'selected':'')+'>'+esc(l.name)+' — '+esc(l.company||'')+'</option>').join('');
  document.getElementById('rf-lead').innerHTML='<option value="">— none —</option>'+leadsOpts;
  document.getElementById('rf-assigned').value=r.assigned_to||'';
  openModal('add-reminder-modal');
}
async function saveReminder(){
  const title=document.getElementById('rf-title').value.trim();if(!title){alert('Title is required');return;}
  const date=document.getElementById('rf-date').value;if(!date){alert('Date is required');return;}
  const assignedTo = isAdmin()
    ? (document.getElementById('rf-assigned').value||null)
    : state.user.id;
  const payload={title,lead_id:document.getElementById('rf-lead').value||null,assigned_to:assignedTo,due_date:date,due_time:document.getElementById('rf-time').value||'10:00',notes:document.getElementById('rf-notes').value,done:false};
  const editId=state.editReminderId;
  if(editId){await db.from('reminders').update(payload).eq('id',editId);}
  else{payload.created_by=state.user.id;await db.from('reminders').insert(payload);}
  closeModal('add-reminder-modal');await loadReminders();renderReminders();
}
async function markReminderDone(id){await db.from('reminders').update({done:true}).eq('id',id);await loadReminders();renderReminders();}
async function deleteReminder(id){if(!confirm('Delete this reminder?'))return;await db.from('reminders').delete().eq('id',id);await loadReminders();renderReminders();}
let currentPopupReminder=null;
function checkReminderPopups(){
  const now=new Date();const today=now.toISOString().split('T')[0];
  const hhmm=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const due=visibleReminders().find(r=>{
    if(r.done||r._popupShown)return false;
    if(r.due_date>today)return false;
    if(r.due_date<today)return true;
    return r.due_time<=hhmm;
  });
  if(!due)return;
  due._popupShown=true;currentPopupReminder=due;
  const lead=state.leads.find(l=>l.id===due.lead_id);
  document.getElementById('toast-title').textContent=due.title;
  document.getElementById('toast-sub').textContent=[lead?'Lead: '+lead.name:'',due.notes].filter(Boolean).join(' · ');
  document.getElementById('reminder-toast').style.display='flex';
  sendReminderEmail(due,lead);
}
function closeToast(){document.getElementById('reminder-toast').style.display='none';}
async function doneReminderToast(){if(currentPopupReminder)await markReminderDone(currentPopupReminder.id);closeToast();}
function snoozeReminder(){if(!currentPopupReminder)return;const snooze=new Date(Date.now()+3600000);const r=currentPopupReminder;r._popupShown=false;r.due_date=snooze.toISOString().split('T')[0];r.due_time=String(snooze.getHours()).padStart(2,'0')+':'+String(snooze.getMinutes()).padStart(2,'0');db.from('reminders').update({due_date:r.due_date,due_time:r.due_time}).eq('id',r.id);closeToast();}
async function sendReminderEmail(reminder,lead){if(!RESEND_API_KEY||RESEND_API_KEY==='YOUR_RESEND_API_KEY')return;const assignee=state.profiles.find(p=>p.id===reminder.assigned_to);if(!assignee?.email)return;const body='<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px"><div style="background:#4F46E5;color:white;padding:16px 24px;border-radius:8px 8px 0 0"><strong>Riddler CRM</strong> · Reminder</div><div style="background:#f8f7ff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb"><h2 style="margin:0 0 12px;color:#1e1b4b">'+reminder.title+'</h2>'+(lead?'<p style="color:#4b5563"><strong>Lead:</strong> '+lead.name+(lead.company?' ('+lead.company+')':'')+'</p>':'')+(reminder.notes?'<p style="color:#4b5563"><strong>Notes:</strong> '+reminder.notes+'</p>':'')+'<p style="color:#9ca3af;font-size:12px;margin-top:16px">Due: '+formatDate(reminder.due_date)+' at '+reminder.due_time+'</p><a href="https://aayush-lang.github.io/Riddler-Media-Crm" style="display:inline-block;margin-top:16px;background:#4F46E5;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px">Open CRM</a></div></div>';await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':'Bearer '+RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:FROM_EMAIL,to:[assignee.email],subject:'🔔 Reminder: '+reminder.title,html:body})});}
function exportCSV(){
  const rows=visibleLeads().map(l=>[l.name,l.company,l.email,l.phone,l.stage,l.type,l.service,l.source,l.value,l.city,l.followup_date,l.created_at?.split('T')[0],l.notes].map(v=>'"'+(v||'').toString().replace(/"/g,'""')+'"').join(','));
  const headers=['Name','Company','Email','Phone','Stage','Type','Service','Source','Value','City','Follow-up Date','Created On','Notes'];
  const csv=[headers.join(','),...rows].join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='riddler_leads_'+new Date().toISOString().split('T')[0]+'.csv';a.click();
}
function parseCSVLine(line){
  const cells=[];let cur='',inQ=false;
  for(let i=0;i<=line.length;i++){
    const ch=line[i];
    if(ch==='"'&&!inQ){inQ=true;}
    else if(ch==='"'&&inQ&&line[i+1]==='"'){cur+='"';i++;}
    else if(ch==='"'&&inQ){inQ=false;}
    else if((ch===','||i===line.length)&&!inQ){cells.push(cur.trim());cur='';}
    else{cur+=ch||'';}
  }
  return cells;
}
function importCSV(event){
  const file=event.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async function(e){
    const lines=e.target.result.split('\n').filter(l=>l.trim());
    const headers=parseCSVLine(lines[0]).map(h=>h.toLowerCase().trim());
    const fieldMap={name:['name','full name','contact name'],company:['company','business','company name'],email:['email','email address'],phone:['phone','mobile','contact number','phone number'],stage:['stage'],type:['type'],service:['service','service interest'],source:['source','lead source'],value:['value','deal value','amount'],city:['city','location'],followup_date:['follow-up date','followup date','follow up date','follow-up'],notes:['notes','note','comments']};
    const colIndex={};
    Object.entries(fieldMap).forEach(function(entry){const key=entry[0];const aliases=entry[1];const idx=headers.findIndex(h=>aliases.includes(h));if(idx!==-1)colIndex[key]=idx;});
    const rows=lines.slice(1).map(line=>parseCSVLine(line));
    const toInsert=rows.filter(r=>r.length>=1&&r[colIndex.name||0]?.trim()).map(r=>({
      name:(r[colIndex.name]||'Unknown').trim(),company:(r[colIndex.company]!=null?r[colIndex.company]:'').trim(),email:(r[colIndex.email]!=null?r[colIndex.email]:'').trim(),phone:(r[colIndex.phone]!=null?r[colIndex.phone]:'').trim(),
      stage:STAGES.includes((r[colIndex.stage]||'').trim())?(r[colIndex.stage]||'').trim():'Fresh Lead',
      type:(r[colIndex.type]||'').trim()==='Client'?'Client':'Prospect',
      service:(r[colIndex.service]!=null?r[colIndex.service]:'').trim(),source:(r[colIndex.source]!=null?r[colIndex.source]:'').trim(),value:+(r[colIndex.value]||0)||0,city:(r[colIndex.city]!=null?r[colIndex.city]:'').trim(),followup_date:(r[colIndex.followup_date]||'').trim()||null,notes:(r[colIndex.notes]!=null?r[colIndex.notes]:'').trim(),
      created_by:state.user.id,
      assigned_to:state.user.id,
    }));
    if(!toInsert.length){alert('No valid rows found in CSV.');return;}
    if(!confirm('Import '+toInsert.length+' leads?'))return;
    let imported=0,errors=0;
    for(let i=0;i<toInsert.length;i+=100){const batch=toInsert.slice(i,i+100);const result=await db.from('leads').insert(batch);if(result.error){console.error('Batch error:',result.error);errors+=batch.length;}else{imported+=batch.length;}}
    await loadLeads();renderLeads();renderDashboard();
    alert(errors>0?'Imported '+imported+' leads.\n'+errors+' rows failed.':'✓ Imported '+imported+' leads successfully!');
  };
  reader.readAsText(file);event.target.value='';
}
async function inviteTeamMember(){const email=document.getElementById('invite-email').value.trim();if(!email)return;alert('Create their account from Supabase dashboard → Auth → Users → Invite user.\n\nEmail: '+email);document.getElementById('invite-email').value='';}
function esc(str){return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function formatINR(n){if(n>=100000)return(n/100000).toFixed(1)+'L';if(n>=1000)return(n/1000).toFixed(0)+'K';return n.toLocaleString('en-IN');}
function formatDate(dateStr){if(!dateStr)return'';const d=new Date(dateStr+'T00:00:00');return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});}
function formatDateTime(isoStr){if(!isoStr)return'';return new Date(isoStr).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}
window.handleLogin=handleLogin;window.handleLogout=handleLogout;window.showForgot=showForgot;window.openModal=openModal;window.closeModal=closeModal;window.overlayClose=overlayClose;window.openAddLead=openAddLead;window.openEditLead=openEditLead;window.saveLead=saveLead;window.deleteLead=deleteLead;window.openLeadDetail=openLeadDetail;window.changeStageFromPanel=changeStageFromPanel;window.assignLead=assignLead;window.postComment=postComment;window.openAddReminder=openAddReminder;window.openReminderForLead=openReminderForLead;window.openEditReminder=openEditReminder;window.saveReminder=saveReminder;window.markReminderDone=markReminderDone;window.deleteReminder=deleteReminder;window.doneReminderToast=doneReminderToast;window.snoozeReminder=snoozeReminder;window.closeToast=closeToast;window.exportCSV=exportCSV;window.importCSV=importCSV;window.inviteTeamMember=inviteTeamMember;window.applyFilters=applyFilters;window.debounceFilter=debounceFilter;window.clearFilters=clearFilters;window.goPage=goPage;window.toggleSelect=toggleSelect;window.toggleSelectAll=toggleSelectAll;window.bulkMoveStage=bulkMoveStage;window.bulkDelete=bulkDelete;window.bulkReassign=bulkReassign;window.bulkAssignUnassigned=bulkAssignUnassigned;window.kanbanDragStart=kanbanDragStart;window.kanbanDragEnd=kanbanDragEnd;window.kanbanDragOver=kanbanDragOver;window.kanbanDragLeave=kanbanDragLeave;window.kanbanDrop=kanbanDrop;window.setDashPeriod=setDashPeriod;
window.loadInbound=loadInbound;window.renderInbound=renderInbound;window.promoteInboundLead=promoteInboundLead;window.deleteInboundLead=deleteInboundLead;
(async()=>{
  const{data:{session}}=await db.auth.getSession();
  if(session?.user){await initApp(session.user);}
})();
