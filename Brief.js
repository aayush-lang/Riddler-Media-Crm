// ============================================================
//  RIDDLER MEDIA CRM — briefs.js
//  Brief creation, viewing, sharing, PDF export
// ============================================================

export function initBriefs(db, state, esc, formatDate) {

  // ── LOAD BRIEFS ──
  async function loadBriefs() {
    const { data } = await db.from('briefs').select('*').order('created_at', { ascending: false });
    if (data) state.briefs = data;
  }

  // ── RENDER BRIEFS LIST ──
  function renderBriefs() {
    const list = document.getElementById('briefs-list');
    if (!list) return;
    if (!state.briefs?.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div>No briefs yet. Create one from a lead or click "+ New brief".</div></div>`;
      return;
    }
    list.innerHTML = state.briefs.map(b => {
      const tags = [b.requirement_type, b.sales_poc].filter(Boolean);
      return `<div class="brief-card">
        <div class="brief-card-left">
          <div class="brief-card-title">${esc(b.brand_name || 'Untitled Brief')}</div>
          <div class="brief-card-meta">${b.brief_date ? formatDate(b.brief_date) : '—'} · ${esc(b.industry || '—')} · ${esc(b.client_poc_name || '—')}</div>
          <div class="brief-card-tags">
            ${tags.map(t => `<span class="brief-tag">${esc(t)}</span>`).join('')}
            ${b.lead_name ? `<span class="brief-tag" style="background:var(--green-light);color:var(--green)">Lead: ${esc(b.lead_name)}</span>` : ''}
          </div>
        </div>
        <div class="brief-card-actions">
          <button class="btn-sm" onclick="viewBrief('${b.id}')">View</button>
          <button class="btn-sm" onclick="openBriefModal('${b.id}')">Edit</button>
          <button class="btn-sm" onclick="shareBrief('${b.share_token}')">🔗 Share</button>
          <button class="btn-sm" onclick="downloadBriefPDF('${b.id}')">↓ PDF</button>
          <button class="btn-danger-sm" onclick="deleteBrief('${b.id}')">Delete</button>
        </div>
      </div>`;
    }).join('');
  }

  // ── BRIEF FORM HTML ──
  function buildBriefForm(brief) {
    const v = brief || {};
    const chk = (arr, val) => (arr || []).includes(val) ? 'checked' : '';
    const sel = (val, opt) => val === opt ? 'checked' : '';

    function checkboxGroup(name, options, selected) {
      return `<div class="checkbox-group">
        ${options.map(o => `<label class="checkbox-item ${(selected||[]).includes(o)?'checked':''}">
          <input type="checkbox" name="${name}" value="${o}" ${(selected||[]).includes(o)?'checked':''} onchange="toggleCheck(this)"/>
          ${o}
        </label>`).join('')}
      </div>`;
    }

    function radioGroup(name, options, selected) {
      return `<div class="radio-group">
        ${options.map(o => `<label class="radio-item ${selected===o?'checked':''}">
          <input type="radio" name="${name}" value="${o}" ${selected===o?'checked':''} onchange="toggleRadio(this)"/>
          ${o}
        </label>`).join('')}
      </div>`;
    }

    return `
      <input type="hidden" id="bf-id" value="${v.id||''}" />
      <input type="hidden" id="bf-lead-id" value="${v.lead_id||''}" />
      <input type="hidden" id="bf-lead-name" value="${v.lead_name||''}" />

      <!-- Section 1: Basic Info -->
      <div class="brief-section">
        <div class="brief-section-title">Basic Information</div>
        <div class="brief-form-grid">
          <div class="form-field"><label>Brief Date</label><input id="bf-date" type="date" value="${v.brief_date||''}" /></div>
          <div class="form-field"><label>Brand / Agency Name</label><input id="bf-brand" value="${esc(v.brand_name||'')}" /></div>
          <div class="form-field"><label>Industry Type</label><input id="bf-industry" value="${esc(v.industry||'')}" /></div>
          <div class="form-field"><label>Client POC Name</label><input id="bf-poc-name" value="${esc(v.client_poc_name||'')}" /></div>
          <div class="form-field full"><label>Client POC Email & Phone</label><input id="bf-poc-contact" value="${esc(v.client_poc_contact||'')}" /></div>
          <div class="form-field"><label>Sales POC</label>
            ${radioGroup('sales_poc', ['Shivangi', 'Aayush'], v.sales_poc)}
          </div>
        </div>
      </div>

      <!-- Section 2: Requirement Type -->
      <div class="brief-section">
        <div class="brief-section-title">Requirement Type</div>
        <div class="form-field">
          ${radioGroup('requirement_type', ['Influencer Marketing', '360° Marketing', 'Performance Marketing', 'Social Media Management', 'SEO / Website'], v.requirement_type)}
        </div>
      </div>

      <!-- Section 3: Influencer Marketing -->
      <div class="brief-section">
        <div class="brief-section-title">Influencer Marketing</div>
        <div class="brief-form-grid">
          <div class="form-field"><label>Platform</label>${checkboxGroup('platforms', ['Instagram','YouTube','Twitter','LinkedIn'], v.platforms)}</div>
          <div class="form-field"><label>Influencer Tier</label>${checkboxGroup('influencer_tier', ['Nano','Micro','Mid','Macro','Celebrity'], v.influencer_tier)}</div>
          <div class="form-field"><label>Number of Influencers</label><input id="bf-num-influencers" value="${esc(v.num_influencers||'')}" /></div>
          <div class="form-field"><label>Content Type</label><input id="bf-content-type" value="${esc(v.content_type||'')}" /></div>
          <div class="form-field full"><label>Genre / Category</label>${checkboxGroup('genre', ['Fashion','Beauty','Tech','Finance','Comedy','Lifestyle','Education','Spiritual'], v.genre)}</div>
          <div class="form-field"><label>Deliverables</label><input id="bf-deliverables" value="${esc(v.deliverables||'')}" /></div>
          <div class="form-field"><label>Campaign Timeline</label><input id="bf-campaign-timeline" value="${esc(v.campaign_timeline||'')}" /></div>
          <div class="form-field full"><label>Content Format</label>${checkboxGroup('content_format', ['Reel','Story','Static Post','YouTube Integration','Shorts'], v.content_format)}</div>
          <div class="form-field full"><label>Client Brief</label><textarea id="bf-client-brief" rows="3">${esc(v.client_brief||'')}</textarea></div>
        </div>
      </div>

      <!-- Section 4: 360 Marketing -->
      <div class="brief-section">
        <div class="brief-section-title">360° Marketing</div>
        <div class="brief-form-grid">
          <div class="form-field"><label>Business Objective</label>${checkboxGroup('business_objective', ['Brand Awareness','Lead Generation','Sales','Website Traffic'], v.business_objective)}</div>
          <div class="form-field"><label>Channels Required</label>${checkboxGroup('channels_required', ['Influencer Marketing','Performance Marketing','Social Media','SEO','Website'], v.channels_required)}</div>
          <div class="form-field"><label>Campaign Timeline</label><input id="bf-timeline-360" value="${esc(v.timeline_360||'')}" /></div>
          <div class="form-field"><label>Expected Deliverables</label><input id="bf-deliverables-360" value="${esc(v.deliverables_360||'')}" /></div>
          <div class="form-field full"><label>Client Brief</label><textarea id="bf-brief-360" rows="3">${esc(v.brief_360||'')}</textarea></div>
        </div>
      </div>

      <!-- Section 5: Performance Marketing -->
      <div class="brief-section">
        <div class="brief-section-title">Performance Marketing</div>
        <div class="brief-form-grid">
          <div class="form-field"><label>Primary Goal</label>${checkboxGroup('primary_goal', ['Sales','Leads','App Installs','Website Traffic'], v.primary_goal)}</div>
          <div class="form-field"><label>Platforms Required</label>${checkboxGroup('platforms_perf', ['Meta Ads','Google Ads','YouTube Ads','LinkedIn Ads'], v.platforms_perf)}</div>
          <div class="form-field"><label>Monthly Ad Spend Budget</label><input id="bf-ad-spend" value="${esc(v.ad_spend_budget||'')}" /></div>
          <div class="form-field"><label>Pixel / Tracking Status</label>${radioGroup('pixel_status', ['Installed','Not Installed','Not Sure'], v.pixel_status)}</div>
          <div class="form-field"><label>Timeline</label><input id="bf-timeline-perf" value="${esc(v.timeline_perf||'')}" /></div>
          <div class="form-field full"><label>Client Brief</label><textarea id="bf-brief-perf" rows="3">${esc(v.brief_perf||'')}</textarea></div>
        </div>
      </div>

      <!-- Section 6: Client Assets & Budget -->
      <div class="brief-section">
        <div class="brief-section-title">Client Assets & Budget</div>
        <div class="brief-form-grid">
          <div class="form-field"><label>Client Website</label><input id="bf-website" value="${esc(v.client_website||'')}" /></div>
          <div class="form-field"><label>Brand Social Handles</label><input id="bf-social" value="${esc(v.social_handles||'')}" /></div>
          <div class="form-field"><label>Product / App Link</label><input id="bf-product-link" value="${esc(v.product_link||'')}" /></div>
          <div class="form-field"><label>Reference Campaigns</label><input id="bf-references" value="${esc(v.reference_campaigns||'')}" /></div>
          <div class="form-field"><label>Total Campaign Budget</label><input id="bf-total-budget" value="${esc(v.total_budget||'')}" /></div>
          <div class="form-field"><label>Budget Allocation Preference</label><input id="bf-budget-alloc" value="${esc(v.budget_allocation||'')}" /></div>
        </div>
      </div>

      <!-- Section 7: SEO / Website -->
      <div class="brief-section">
        <div class="brief-section-title">SEO / Website</div>
        <div class="brief-form-grid">
          <div class="form-field"><label>Website Platform</label>${radioGroup('website_platform', ['Shopify','WordPress','Webflow','Custom'], v.website_platform)}</div>
          <div class="form-field"><label>Primary Objective</label>${radioGroup('primary_objective', ['Organic Traffic','Keyword Ranking','Lead Generation','E-commerce Sales'], v.primary_objective)}</div>
          <div class="form-field full"><label>Target Keywords</label><input id="bf-keywords" value="${esc(v.target_keywords||'')}" /></div>
          <div class="form-field"><label>Competitors</label><input id="bf-competitors" value="${esc(v.competitors||'')}" /></div>
          <div class="form-field"><label>Current Monthly Organic Traffic</label><input id="bf-traffic" value="${esc(v.monthly_traffic||'')}" /></div>
          <div class="form-field"><label>SEO Scope</label>${radioGroup('seo_scope', ['Technical SEO','On-page SEO','Content SEO','Backlinks'], v.seo_scope)}</div>
          <div class="form-field"><label>Blog Strategy Required</label>${radioGroup('blog_strategy', ['Yes','No'], v.blog_strategy)}</div>
          <div class="form-field"><label>Website Optimization</label>${radioGroup('website_optimization', ['Speed Optimization','Conversion Optimization','UX Improvements'], v.website_optimization)}</div>
          <div class="form-field"><label>Timeline</label><input id="bf-timeline-seo" value="${esc(v.timeline_seo||'')}" /></div>
        </div>
      </div>`;
  }

  // ── OPEN BRIEF MODAL ──
  window.openBriefModal = async function(briefIdOrLeadId, isLead = false) {
    let existing = null;
    let leadData = null;

    if (briefIdOrLeadId && !isLead) {
      // Editing existing brief
      existing = state.briefs?.find(b => b.id === briefIdOrLeadId);
    } else if (briefIdOrLeadId && isLead) {
      // Creating from lead
      leadData = state.leads?.find(l => l.id === briefIdOrLeadId);
      existing = { lead_id: leadData?.id, lead_name: leadData?.name, brand_name: leadData?.company };
    }

    document.getElementById('brief-modal-title').textContent = existing?.id ? 'Edit Brief' : 'New Brief';
    document.getElementById('brief-modal-body').innerHTML = buildBriefForm(existing);
    document.getElementById('brief-modal').style.display = 'flex';
  };

  // ── TOGGLE CHECKBOX/RADIO ──
  window.toggleCheck = function(el) {
    el.closest('.checkbox-item').classList.toggle('checked', el.checked);
  };
  window.toggleRadio = function(el) {
    document.querySelectorAll(`input[name="${el.name}"]`).forEach(r => {
      r.closest('.radio-item').classList.remove('checked');
    });
    el.closest('.radio-item').classList.add('checked');
  };

  // ── GET CHECKED VALUES ──
  function getChecked(name) {
    return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
  }
  function getRadio(name) {
    return document.querySelector(`input[name="${name}"]:checked`)?.value || '';
  }

  // ── SAVE BRIEF ──
  window.saveBrief = async function() {
    const payload = {
      lead_id: document.getElementById('bf-lead-id').value || null,
      lead_name: document.getElementById('bf-lead-name').value || null,
      brief_date: document.getElementById('bf-date').value || null,
      brand_name: document.getElementById('bf-brand').value,
      industry: document.getElementById('bf-industry').value,
      client_poc_name: document.getElementById('bf-poc-name').value,
      client_poc_contact: document.getElementById('bf-poc-contact').value,
      sales_poc: getRadio('sales_poc'),
      requirement_type: getRadio('requirement_type'),
      platforms: getChecked('platforms'),
      influencer_tier: getChecked('influencer_tier'),
      num_influencers: document.getElementById('bf-num-influencers').value,
      content_type: document.getElementById('bf-content-type').value,
      genre: getChecked('genre'),
      deliverables: document.getElementById('bf-deliverables').value,
      campaign_timeline: document.getElementById('bf-campaign-timeline').value,
      content_format: getChecked('content_format'),
      client_brief: document.getElementById('bf-client-brief').value,
      business_objective: getChecked('business_objective'),
      channels_required: getChecked('channels_required'),
      timeline_360: document.getElementById('bf-timeline-360').value,
      deliverables_360: document.getElementById('bf-deliverables-360').value,
      brief_360: document.getElementById('bf-brief-360').value,
      primary_goal: getChecked('primary_goal'),
      platforms_perf: getChecked('platforms_perf'),
      ad_spend_budget: document.getElementById('bf-ad-spend').value,
      pixel_status: getRadio('pixel_status'),
      timeline_perf: document.getElementById('bf-timeline-perf').value,
      brief_perf: document.getElementById('bf-brief-perf').value,
      client_website: document.getElementById('bf-website').value,
      social_handles: document.getElementById('bf-social').value,
      product_link: document.getElementById('bf-product-link').value,
      reference_campaigns: document.getElementById('bf-references').value,
      total_budget: document.getElementById('bf-total-budget').value,
      budget_allocation: document.getElementById('bf-budget-alloc').value,
      website_platform: getRadio('website_platform'),
      primary_objective: getRadio('primary_objective'),
      target_keywords: document.getElementById('bf-keywords').value,
      competitors: document.getElementById('bf-competitors').value,
      monthly_traffic: document.getElementById('bf-traffic').value,
      seo_scope: getRadio('seo_scope'),
      blog_strategy: getRadio('blog_strategy'),
      website_optimization: getRadio('website_optimization'),
      timeline_seo: document.getElementById('bf-timeline-seo').value,
      updated_at: new Date().toISOString(),
    };

    const editId = document.getElementById('bf-id').value;
    if (editId) {
      await db.from('briefs').update(payload).eq('id', editId);
    } else {
      payload.created_by = state.user.id;
      await db.from('briefs').insert(payload);
    }

    document.getElementById('brief-modal').style.display = 'none';
    await loadBriefs();
    renderBriefs();
  };

  // ── VIEW BRIEF ──
  window.viewBrief = function(id) {
    const b = state.briefs?.find(x => x.id === id);
    if (!b) return;

    function row(label, value) {
      if (!value || (Array.isArray(value) && !value.length)) return '';
      const display = Array.isArray(value) ? `<div class="brief-tags-display">${value.map(v => `<span class="brief-tag">${esc(v)}</span>`).join('')}</div>` : esc(value);
      return `<div class="brief-view-row"><span class="brief-view-label">${label}</span><span class="brief-view-value">${display}</span></div>`;
    }

    document.getElementById('brief-view-panel').innerHTML = `
      <div class="panel-header" id="brief-print">
        <div>
          <div style="font-size:17px;font-weight:600">${esc(b.brand_name || 'Brief')}</div>
          <div style="font-size:13px;color:var(--text-3)">${b.brief_date ? formatDate(b.brief_date) : ''}</div>
        </div>
        <button class="modal-close" onclick="document.getElementById('brief-view-overlay').style.display='none'">✕</button>
      </div>

      <div class="brief-view-section">
        <div class="brief-view-title">Basic Information</div>
        ${row('Brand / Agency', b.brand_name)}
        ${row('Brief Date', b.brief_date ? formatDate(b.brief_date) : '')}
        ${row('Industry', b.industry)}
        ${row('Client POC', b.client_poc_name)}
        ${row('POC Contact', b.client_poc_contact)}
        ${row('Sales POC', b.sales_poc)}
        ${row('Requirement Type', b.requirement_type)}
      </div>

      ${(b.platforms?.length || b.influencer_tier?.length || b.num_influencers) ? `
      <div class="brief-view-section">
        <div class="brief-view-title">Influencer Marketing</div>
        ${row('Platforms', b.platforms)}
        ${row('Influencer Tier', b.influencer_tier)}
        ${row('No. of Influencers', b.num_influencers)}
        ${row('Content Type', b.content_type)}
        ${row('Genre / Category', b.genre)}
        ${row('Deliverables', b.deliverables)}
        ${row('Campaign Timeline', b.campaign_timeline)}
        ${row('Content Format', b.content_format)}
        ${row('Client Brief', b.client_brief)}
      </div>` : ''}

      ${(b.business_objective?.length || b.channels_required?.length) ? `
      <div class="brief-view-section">
        <div class="brief-view-title">360° Marketing</div>
        ${row('Business Objective', b.business_objective)}
        ${row('Channels Required', b.channels_required)}
        ${row('Campaign Timeline', b.timeline_360)}
        ${row('Expected Deliverables', b.deliverables_360)}
        ${row('Client Brief', b.brief_360)}
      </div>` : ''}

      ${(b.primary_goal?.length || b.platforms_perf?.length) ? `
      <div class="brief-view-section">
        <div class="brief-view-title">Performance Marketing</div>
        ${row('Primary Goal', b.primary_goal)}
        ${row('Platforms', b.platforms_perf)}
        ${row('Monthly Ad Spend', b.ad_spend_budget)}
        ${row('Pixel Status', b.pixel_status)}
        ${row('Timeline', b.timeline_perf)}
        ${row('Client Brief', b.brief_perf)}
      </div>` : ''}

      ${(b.client_website || b.total_budget) ? `
      <div class="brief-view-section">
        <div class="brief-view-title">Client Assets & Budget</div>
        ${row('Client Website', b.client_website)}
        ${row('Social Handles', b.social_handles)}
        ${row('Product / App Link', b.product_link)}
        ${row('Reference Campaigns', b.reference_campaigns)}
        ${row('Total Budget', b.total_budget)}
        ${row('Budget Allocation', b.budget_allocation)}
      </div>` : ''}

      ${(b.website_platform || b.target_keywords) ? `
      <div class="brief-view-section">
        <div class="brief-view-title">SEO / Website</div>
        ${row('Website Platform', b.website_platform)}
        ${row('Primary Objective', b.primary_objective)}
        ${row('Target Keywords', b.target_keywords)}
        ${row('Competitors', b.competitors)}
        ${row('Monthly Traffic', b.monthly_traffic)}
        ${row('SEO Scope', b.seo_scope)}
        ${row('Blog Strategy', b.blog_strategy)}
        ${row('Website Optimization', b.website_optimization)}
        ${row('Timeline', b.timeline_seo)}
      </div>` : ''}

      <div class="brief-view-section">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-primary" onclick="downloadBriefPDF('${b.id}')">↓ Download PDF</button>
          <button class="btn-secondary" onclick="shareBrief('${b.share_token}')">🔗 Copy share link</button>
          <button class="btn-sm" onclick="openBriefModal('${b.id}')">Edit brief</button>
        </div>
      </div>`;

    document.getElementById('brief-view-overlay').style.display = 'flex';
  };

  // ── SHARE BRIEF ──
  window.shareBrief = function(token) {
    const url = `${window.location.origin}${window.location.pathname}?brief=${token}`;
    navigator.clipboard.writeText(url).then(() => {
      alert(`✓ Share link copied!\n\n${url}\n\nAnyone with this link can view the brief without logging in.`);
    }).catch(() => {
      prompt('Copy this link:', url);
    });
  };

  // ── DOWNLOAD PDF ──
  window.downloadBriefPDF = function(id) {
    viewBrief(id);
    setTimeout(() => {
      const panel = document.getElementById('brief-view-panel');
      const opt = {
        margin: [10, 10, 10, 10],
        filename: `riddler-brief-${id.slice(0,8)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      html2pdf().set(opt).from(panel).save();
    }, 500);
  };

  // ── DELETE BRIEF ──
  window.deleteBrief = async function(id) {
    if (!confirm('Delete this brief?')) return;
    await db.from('briefs').delete().eq('id', id);
    await loadBriefs();
    renderBriefs();
  };

  // ── CHECK FOR PUBLIC SHARE LINK ──
  async function checkPublicShare() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('brief');
    if (!token) return false;

    const { data } = await db.from('briefs').select('*').eq('share_token', token).single();
    if (!data) { alert('Brief not found or link expired.'); return false; }

    // Show brief publicly without login
    document.getElementById('auth-screen').style.display = 'none';
    document.body.innerHTML = buildPublicBriefView(data);
    return true;
  }

  function buildPublicBriefView(b) {
    function row(label, value) {
      if (!value || (Array.isArray(value) && !value.length)) return '';
      const display = Array.isArray(value) ? value.join(', ') : value;
      return `<tr><td style="padding:8px 12px;color:#666;width:180px;border-bottom:1px solid #f0f0f0">${label}</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-weight:500">${display}</td></tr>`;
    }

    return `<!DOCTYPE html>
    <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Brief - ${b.brand_name || 'Riddler Media'}</title>
    <style>
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:20px;background:#f8f7ff;color:#1e1b4b}
      .container{max-width:720px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(79,70,229,0.1)}
      .header{background:#4F46E5;color:white;padding:24px 32px}
      .header h1{margin:0 0 4px;font-size:22px}
      .header p{margin:0;opacity:0.8;font-size:14px}
      .section{padding:20px 32px;border-bottom:1px solid #f0f0f0}
      .section h2{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#4F46E5;margin:0 0 12px}
      table{width:100%;border-collapse:collapse;font-size:14px}
      .footer{padding:16px 32px;background:#f8f7ff;font-size:12px;color:#9ca3af;text-align:center}
      .tag{display:inline-block;background:#EEF2FF;color:#4F46E5;padding:2px 8px;border-radius:12px;font-size:12px;margin:2px}
      @media print{body{background:white}.footer{display:none}}
    </style>
    </head><body>
    <div class="container">
      <div class="header">
        <h1>${b.brand_name || 'Marketing Brief'}</h1>
        <p>Riddler Media · ${b.brief_date || ''} · ${b.requirement_type || ''}</p>
      </div>
      <div class="section"><h2>Basic Information</h2>
        <table>
          ${row('Brand / Agency', b.brand_name)}
          ${row('Industry', b.industry)}
          ${row('Client POC', b.client_poc_name)}
          ${row('POC Contact', b.client_poc_contact)}
          ${row('Sales POC', b.sales_poc)}
          ${row('Requirement Type', b.requirement_type)}
        </table>
      </div>
      ${(b.platforms?.length||b.num_influencers)?`<div class="section"><h2>Influencer Marketing</h2><table>
        ${row('Platforms', b.platforms?.join(', '))}
        ${row('Influencer Tier', b.influencer_tier?.join(', '))}
        ${row('No. of Influencers', b.num_influencers)}
        ${row('Content Type', b.content_type)}
        ${row('Genre', b.genre?.join(', '))}
        ${row('Deliverables', b.deliverables)}
        ${row('Campaign Timeline', b.campaign_timeline)}
        ${row('Content Format', b.content_format?.join(', '))}
        ${row('Client Brief', b.client_brief)}
      </table></div>`:''}
      ${(b.business_objective?.length)?`<div class="section"><h2>360° Marketing</h2><table>
        ${row('Business Objective', b.business_objective?.join(', '))}
        ${row('Channels Required', b.channels_required?.join(', '))}
        ${row('Timeline', b.timeline_360)}
        ${row('Deliverables', b.deliverables_360)}
        ${row('Client Brief', b.brief_360)}
      </table></div>`:''}
      ${(b.primary_goal?.length)?`<div class="section"><h2>Performance Marketing</h2><table>
        ${row('Primary Goal', b.primary_goal?.join(', '))}
        ${row('Platforms', b.platforms_perf?.join(', '))}
        ${row('Monthly Ad Spend', b.ad_spend_budget)}
        ${row('Pixel Status', b.pixel_status)}
        ${row('Timeline', b.timeline_perf)}
        ${row('Client Brief', b.brief_perf)}
      </table></div>`:''}
      ${(b.client_website||b.total_budget)?`<div class="section"><h2>Client Assets & Budget</h2><table>
        ${row('Website', b.client_website)}
        ${row('Social Handles', b.social_handles)}
        ${row('Product Link', b.product_link)}
        ${row('Reference Campaigns', b.reference_campaigns)}
        ${row('Total Budget', b.total_budget)}
        ${row('Budget Allocation', b.budget_allocation)}
      </table></div>`:''}
      ${(b.website_platform||b.target_keywords)?`<div class="section"><h2>SEO / Website</h2><table>
        ${row('Platform', b.website_platform)}
        ${row('Primary Objective', b.primary_objective)}
        ${row('Target Keywords', b.target_keywords)}
        ${row('Competitors', b.competitors)}
        ${row('Monthly Traffic', b.monthly_traffic)}
        ${row('SEO Scope', b.seo_scope)}
        ${row('Blog Strategy', b.blog_strategy)}
        ${row('Website Optimization', b.website_optimization)}
        ${row('Timeline', b.timeline_seo)}
      </table></div>`:''}
      <div class="footer">Prepared by Riddler Media · <a href="https://riddlermedia.in">riddlermedia.in</a> · <button onclick="window.print()" style="background:#4F46E5;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px">Print / Save PDF</button></div>
    </div>
    </body></html>`;
  }

  return { loadBriefs, renderBriefs, checkPublicShare };
}