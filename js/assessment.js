/* VAPT CONSOLE — assessment.js: toast notifications, export/import, and the domain context editor. Depends on core.js + rendering.js. */

/* =========================================================
   TOAST
========================================================= */
function showToast(msg){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=> t.classList.remove('show'), 2800);
}

/* =========================================================
   EXPORT / IMPORT
========================================================= */
document.getElementById('exportJsonBtn').addEventListener('click', ()=>{
  /* An item is worth exporting if ANY part of its notes has content —
     not just the findings text. Filtering on findings alone silently
     dropped items where the assessor had only attached a screenshot or
     filled in endpoints, which is real evidence loss on re-import. */
  const hasNotes = (d)=>{
    const n = d.assessorNotes;
    if(!n) return false;
    return !!(n.findings || n.pocDetails
      || (n.evidenceLinks && n.evidenceLinks.length)
      || (n.affectedEndpoints && n.affectedEndpoints.length)
      || (n.attachments && n.attachments.length)
      || (n.remediation && (n.remediation.state !== 'open' || n.remediation.retestedAt || n.remediation.note)));
  };
  const payload = {
    tester: document.getElementById('testerName').value || '',
    exportedAt: new Date().toISOString(),
    statuses: Object.fromEntries(allData.filter(d=>d.status && d.status !== 'not-tested').map(d=>[d.id, d.status])),
    notes: Object.fromEntries(allData.filter(hasNotes).map(d=>[d.id, JSON.stringify(d.assessorNotes)])),
    flagged: allData.filter(d=>d.flagged).map(d=>d.id),
    /* Custom cases and chains live in their own storage keys, so without
       exporting them here a re-import would restore progress against test
       cases that no longer exist, and drop the analyst's own authored
       content entirely. */
    customCases: (typeof loadCustomCases === 'function') ? loadCustomCases() : [],
    chains: (typeof loadChains === 'function') ? loadChains() : [],
  };
  downloadFile(`greysh3ll-progress-${Date.now()}.json`, JSON.stringify(payload,null,2), 'application/json');
  showToast('Progress saved to file.');
});
document.getElementById('exportCsvBtn').addEventListener('click', async ()=>{
  /* The CSV includes each case's reference standard and tools, which live in
     the lazily-fetched detail files — pull every domain before building it,
     otherwise those columns silently export empty for unopened domains. */
  showToast('Preparing export…');
  try{ await ensureAllDetail(); }
  catch(err){ showToast('Could not load all test case detail — export cancelled.'); return; }
  const tester = document.getElementById('testerName').value || '(unspecified)';
  const header = 'DomainCaseNo,Tester,Domain,ID,Vulnerability,Severity,Status,Flagged,CWE,Standard,Tools,Notes,Remediation,RetestedOn,RetestNotes\n';
  const esc = (s)=> `"${String(s==null?'':s).replace(/"/g,'""')}"`;
  const rows = allData.slice().sort((a,b)=>a.sequence-b.sequence).map(d=>{
    const ref = d.reference || {};
    const tools = Array.isArray(ref.tools) ? ref.tools.join(', ') : (ref.tools || '');
    return [d.domainIndex, esc(tester), esc(d.domain), esc(d.id), esc(d.title), esc(d.severityLabel||d.severity),
      esc(d.status), d.flagged?'YES':'NO', esc(d.cwe||''), esc(ref.standard||''),
      esc(tools), esc(d.assessorNotes?.findings||''),
      esc(d.status==='tested-fail' ? getRemediationObj((d.assessorNotes?.remediation||{}).state).label : ''),
      esc((d.assessorNotes?.remediation||{}).retestedAt||''),
      esc((d.assessorNotes?.remediation||{}).note||'')].join(',');
  }).join('\n');
  downloadFile(`greysh3ll-findings-${Date.now()}.csv`, header+rows, 'text/csv');
  showToast('CSV exported.');
});
/* generateReport(opts) — builds and prints the report scoped to the options
   chosen in the Report Options dialog (js/report-options.js). Called by that
   dialog's "Generate PDF" button. The topbar "Report" button opens the dialog
   rather than printing directly, so the assessor always scopes the PDF first.
   opts = { domains:[...], severities:[...], failedOnly:bool, detail:'full'|'summary' }.
   With no opts (fallback), the full unfiltered report is produced. */
async function generateReport(opts){
  /* The report prints descriptions, impact, steps and mitigations for every
     included case, so all detail must be resident before it is built. */
  showToast('Building report…');
  try{ await ensureAllDetail(); }
  catch(err){ showToast('Could not load all test case detail — report cancelled.'); return; }
  document.getElementById('reportRoot').innerHTML = buildReportHTML(opts);
  const originalTitle = document.title;
  const dateForFilename = new Date().toISOString().slice(0,10);
  document.title = `GreySh3ll-Security-Assessment-Report-${dateForFilename}`;
  window.print();
  setTimeout(()=>{ document.title = originalTitle; }, 500);
}
/* Kept for any code path that still expects the old direct-print button; the
   dialog in report-options.js normally replaces this handler at load. */
(function(){
  const btn = document.getElementById('printBtn');
  if(btn) btn.addEventListener('click', ()=> generateReport(null));
})();

/* =========================================================
   REPORT GENERATION
   Builds a proper cover-page → executive-summary → findings →
   appendix report instead of just printing the interactive
   checklist UI. Only runs at print time (see printBtn above);
   @media print hides everything on the page except #reportRoot.
========================================================= */
/* Report severity palette — canonical hexes. These are applied via the
   .rsev-* / .rsev-text-* classes in the print block of responsive-performance.css
   (not inline style=, which the strict CSP forbids). Kept here as the single
   documented reference; if these change, update those CSS classes to match:
   critical #B91C1C · high #C2410C · medium #A16207 · low #15803D · info #0369A1 */
const REPORT_STATUS_LABEL = { 'not-tested':'Not Tested', 'in-progress':'In Progress', 'tested-pass':'Pass', 'tested-fail':'Fail', 'not-applicable':'N/A' };

function buildReportHTML(opts){
  /* Normalise options. Null/undefined => the full, unfiltered report. */
  const allDomains = CATEGORIES.map(c => c.code);
  const allSevs = SEVERITIES.map(s => s.key);
  const O = {
    domains:    (opts && opts.domains && opts.domains.length)       ? opts.domains    : allDomains,
    severities: (opts && opts.severities && opts.severities.length) ? opts.severities : allSevs,
    failedOnly: !!(opts && opts.failedOnly),
    detail:     (opts && opts.detail === 'summary') ? 'summary' : 'full'
  };
  const inScope = d => O.domains.indexOf(d.domain) !== -1 && O.severities.indexOf(d.severity) !== -1;
  /* scopeData = every case the report is allowed to talk about (domain+severity).
     reportData additionally honours "confirmed findings only". */
  const scopeData  = allData.filter(inScope);
  const reportData = O.failedOnly ? scopeData.filter(d => d.status==='tested-fail' || d.flagged) : scopeData;
  /* The categories/coverage sections only show the selected domains. */
  const scopeCats  = CATEGORIES.filter(c => O.domains.indexOf(c.code) !== -1);

  const tester = (document.getElementById('testerName').value || '').trim() || 'Unspecified';
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });

  /* Stats are computed over the scoped data so the numbers match what's in
     the report, not the whole 817-case corpus. */
  const total = scopeData.length;
  const byStatus = { 'tested-pass':0, 'tested-fail':0, 'not-applicable':0, 'in-progress':0, 'not-tested':0 };
  scopeData.forEach(d => { byStatus[d.status] = (byStatus[d.status]||0) + 1; });
  const pct = total ? Math.round(byStatus['tested-pass']/total*100) : 0;
  const findings = scopeData
    .filter(d => d.status === 'tested-fail' || d.flagged)
    .sort((a,b) => (SEV_ORDER[a.severity]-SEV_ORDER[b.severity]) || (a.sequence-b.sequence));

  const domainContext = loadDomainContext();
  const domainsWithContext = scopeCats.filter(c => {
    const ctx = domainContext[c.code];
    return ctx && (ctx.scopeNotes || ctx.targetDetails || ctx.engagementDates || ctx.authorizationRef);
  });

  const sevCounts = SEVERITIES.filter(s => O.severities.indexOf(s.key) !== -1).map(s => ({
    ...s, total: scopeData.filter(d=>d.severity===s.key).length,
    open: scopeData.filter(d=>d.severity===s.key && d.status==='tested-fail').length
  }));

  /* A human label for the scope line on the cover. */
  const scopeLabel = O.domains.length === allDomains.length
    ? `${scopeCats.length} domains · ${total} test cases`
    : `${scopeCats.map(c=>c.code).join(', ')} · ${total} test cases`;

  return `
    <section class="report-page report-cover">
      <div class="report-cover-inner">
        <div class="report-cover-eyebrow">GreySh3ll — Vulnerability Assessment &amp; Penetration Testing</div>
        <h1 class="report-cover-title">Security Assessment<br>Report</h1>
        <div class="report-cover-rule"></div>
        <table class="report-cover-meta">
          <tr><td>Prepared by</td><td>${escapeHtml(tester)}</td></tr>
          <tr><td>Report date</td><td>${escapeHtml(dateStr)}</td></tr>
          <tr><td>Scope</td><td>${escapeHtml(scopeLabel)}</td></tr>
          <tr><td>Overall completion</td><td>${pct}% (${byStatus['tested-pass']}/${total} passed)</td></tr>
          <tr><td>Open findings</td><td>${findings.length}</td></tr>
        </table>
      </div>
      <div class="report-cover-footer">
        <strong>CONFIDENTIAL</strong> — Prepared for the intended recipient only. This report
        documents the results of an authorized security assessment and may contain
        sensitive technical detail. Distribute only to individuals with a legitimate
        need to know.
      </div>
    </section>

    <section class="report-page">
      <h2 class="report-h2">Executive Summary</h2>
      <p class="report-body">
        This report documents the results of a security assessment covering
        <strong>${scopeCats.length} testing domain${scopeCats.length===1?'':'s'}</strong> —
        ${scopeCats.map(c=>escapeHtml(c.name)).join(', ')} — comprising
        <strong>${total} individual test case${total===1?'':'s'}</strong>, executed and tracked
        by ${escapeHtml(tester)} using the GreySh3ll assessment methodology.
        ${O.failedOnly ? `This report is scoped to <strong>confirmed findings only</strong>; test cases that passed or were not applicable are summarised in the coverage table but not detailed individually. ` : ''}Each
        test case was identified, exploited where applicable, and
        assessed against its corresponding CWE, OWASP, and/or MITRE ATT&amp;CK
        reference.
      </p>

      <div class="report-stat-row">
        <div class="report-stat-box"><b>${total}</b><span>Total test cases</span></div>
        <div class="report-stat-box"><b>${byStatus['tested-pass']}</b><span>Passed</span></div>
        <div class="report-stat-box report-stat-warn"><b>${byStatus['tested-fail']}</b><span>Failed / open findings</span></div>
        <div class="report-stat-box"><b>${byStatus['not-applicable']}</b><span>Not applicable</span></div>
        <div class="report-stat-box"><b>${pct}%</b><span>Overall completion</span></div>
      </div>

      <h3 class="report-h3">Risk Summary by Severity</h3>
      <table class="report-table">
        <thead><tr><th>Severity</th><th>Total cases</th><th>Open findings</th><th>Status</th></tr></thead>
        <tbody>
          ${sevCounts.map(s => `<tr>
            <td><span class="report-sev-chip rsev-${s.key}">${escapeHtml(s.label)}</span></td>
            <td>${s.total}</td>
            <td>${s.open}</td>
            <td>${s.open > 0 ? `<strong class="rsev-text-${s.key}">Action required</strong>` : 'Clear'}</td>
          </tr>`).join('')}
        </tbody>
      </table>

      ${domainsWithContext.length ? `
      <h3 class="report-h3">Engagement Details</h3>
      <table class="report-table report-table-context">
        <thead><tr><th>Domain</th><th>Scope</th><th>Target(s)</th><th>Dates</th><th>Authorization</th></tr></thead>
        <tbody>
          ${domainsWithContext.map(c => {
            const ctx = domainContext[c.code];
            return `<tr>
              <td><strong>${escapeHtml(c.code)}</strong></td>
              <td>${escapeHtml(ctx.scopeNotes||'—')}</td>
              <td>${escapeHtml(ctx.targetDetails||'—')}</td>
              <td>${escapeHtml(ctx.engagementDates||'—')}</td>
              <td>${escapeHtml(ctx.authorizationRef||'—')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : ''}
    </section>

    <section class="report-page">
      <h2 class="report-h2">Testing Coverage</h2>
      <p class="report-body">The table below summarizes coverage across ${scopeCats.length===1?'the':'the'} ${scopeCats.length} domain${scopeCats.length===1?'':'s'} in scope, in engagement order.</p>
      <table class="report-table">
        <thead><tr><th>#</th><th>Domain</th><th>Total</th><th>Pass</th><th>Fail</th><th>N/A</th><th>Not tested</th></tr></thead>
        <tbody>
          ${scopeCats.map((c,i) => {
            const items = scopeData.filter(d=>d.domain===c.code);
            const t = items.length;
            const p = items.filter(d=>d.status==='tested-pass').length;
            const f = items.filter(d=>d.status==='tested-fail').length;
            const na = items.filter(d=>d.status==='not-applicable').length;
            const nt = items.filter(d=>d.status==='not-tested'||d.status==='in-progress').length;
            return `<tr><td>${i+1}</td><td>${escapeHtml(c.name)} (${c.code})</td><td>${t}</td><td>${p}</td><td>${f?`<strong class="rsev-text-critical">${f}</strong>`:'0'}</td><td>${na}</td><td>${nt}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>

    ${findings.length ? (O.detail === 'summary' ? `
    <section class="report-page">
      <h2 class="report-h2">Findings Summary</h2>
      <p class="report-body">
        The following ${findings.length} finding${findings.length===1?' was':'s were'} identified during testing or flagged
        by the assessor for follow-up, ordered by severity. See the interactive workspace for full technical detail on each.
      </p>
      <table class="report-table">
        <thead><tr><th>Severity</th><th>ID</th><th>Finding</th><th>Domain</th><th>CWE</th><th>Status</th></tr></thead>
        <tbody>
          ${findings.map(item => {
            const catMeta = DOMAIN_META.find(c=>c.code===item.domain);
            return `<tr>
              <td><span class="report-sev-chip rsev-${item.severity}">${escapeHtml(item.severityLabel||item.severity)}</span></td>
              <td>${escapeHtml(item.id)}</td>
              <td>${escapeHtml(item.title)}</td>
              <td>${escapeHtml(catMeta ? catMeta.code : item.domain)}</td>
              <td>${escapeHtml(item.cwe||'—')}</td>
              <td>${item.flagged ? 'Flagged' : escapeHtml(REPORT_STATUS_LABEL[item.status]||item.status)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>` : `
    <section class="report-page">
      <h2 class="report-h2">Detailed Findings</h2>
      <p class="report-body">
        The following ${findings.length} finding${findings.length===1?' was':'s were'} identified during testing or flagged
        by the assessor for follow-up, ordered by severity. Each is documented with its description,
        business impact, how to reproduce it, the evidence recorded, and recommended remediation.
      </p>
      ${findings.map((item, fi) => {
        const catMeta = DOMAIN_META.find(c=>c.code===item.domain);
        const notes = item.assessorNotes || {};
        /* Steps to reproduce: prefer the assessor's own PoC; always include the
           methodology's identification + exploitation steps as the reproduction path. */
        const idSteps  = (item.stepsToIdentify||[]);
        const expSteps = (item.exploitationSteps||[]);
        const payloads = (item.examplePayloads||[]);
        return `
        <div class="report-finding">
          <div class="report-finding-head">
            <span class="report-finding-num">Finding ${fi+1}</span>
            <span class="report-sev-chip rsev-${item.severity}">${escapeHtml(item.severityLabel||item.severity)}</span>
            <span class="report-finding-id">${escapeHtml(item.id)}</span>
            <span class="report-finding-status">${item.flagged ? 'FLAGGED' : REPORT_STATUS_LABEL[item.status]}</span>
          </div>
          <h3 class="report-finding-title">${escapeHtml(item.title)}</h3>
          <div class="report-finding-meta">${escapeHtml(catMeta ? catMeta.name : item.domain)} &middot; ${escapeHtml(item.cwe||'')} ${item.reference?.standard ? '&middot; '+escapeHtml(item.reference.standard) : ''}${item.difficulty ? ' &middot; '+escapeHtml(item.difficulty) : ''}</div>

          <div class="report-field"><div class="report-field-label">Description</div><p>${escapeHtml(item.whatItIs||'')}</p></div>
          ${item.rootCause ? `<div class="report-field"><div class="report-field-label">Root Cause</div><p>${escapeHtml(item.rootCause)}</p></div>` : ''}
          <div class="report-field"><div class="report-field-label">Business Impact</div><p>${escapeHtml(item.impact||'')}</p></div>
          ${notes.findings ? `<div class="report-field"><div class="report-field-label">Assessor Findings (this engagement)</div><p>${escapeHtml(notes.findings)}</p></div>` : ''}
          ${notes.pocDetails ? `<div class="report-field"><div class="report-field-label">Proof of Concept</div><p>${escapeHtml(notes.pocDetails)}</p></div>` : ''}
          ${(notes.affectedEndpoints && notes.affectedEndpoints.length) ? `<div class="report-field"><div class="report-field-label">Affected Endpoints / Assets</div><ul>${notes.affectedEndpoints.map(e=>`<li>${escapeHtml(e)}</li>`).join('')}</ul></div>` : ''}

          ${(idSteps.length || expSteps.length) ? `<div class="report-field"><div class="report-field-label">Steps to Reproduce</div>
            <ol class="report-steps">${idSteps.concat(expSteps).map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ol></div>` : ''}
          ${payloads.length ? `<div class="report-field"><div class="report-field-label">Example Payloads / Commands</div>
            ${payloads.map(p=>{const lab=(p&&p.label)||''; const cmd=(p&&p.command)||(typeof p==='string'?p:''); return `<div class="report-payload"><div class="report-payload-label">${escapeHtml(lab)}</div><pre class="report-payload-cmd">${escapeHtml(cmd)}</pre></div>`;}).join('')}</div>` : ''}

          ${item.mitigationClientFacing ? `<div class="report-field"><div class="report-field-label">What This Means &amp; What To Do</div><p>${escapeHtml(item.mitigationClientFacing)}</p></div>` : ''}
          <div class="report-field"><div class="report-field-label">Recommended Remediation (Technical)</div>
            <ul>${(item.mitigation||[]).map(m=>`<li>${escapeHtml(m)}</li>`).join('')}</ul>
          </div>
          <div class="report-field"><div class="report-field-label">Risk Rating &amp; Industry Mapping</div>
            <ul>
              <li>Severity: <strong class="rsev-text-${item.severity}">${escapeHtml(item.severityLabel||item.severity)}</strong></li>
              ${item.cwe ? `<li>${escapeHtml(item.cwe)}</li>` : ''}
              ${item.categoryCode ? `<li>${escapeHtml(item.categoryStandard||'')}: ${escapeHtml(item.categoryCode)} ${escapeHtml(item.categoryName||'')}</li>` : ''}
              ${(item.attack||[]).map(a=>`<li>MITRE ATT&amp;CK ${escapeHtml(a.id)} ${escapeHtml(a.name)}</li>`).join('')}
              ${(item.frameworks||[]).map(f=>`<li>${escapeHtml(f.standard)}: ${escapeHtml(f.code)} ${escapeHtml(f.name)}</li>`).join('')}
            </ul>
          </div>
          ${(notes.evidenceLinks && notes.evidenceLinks.length) ? `<div class="report-field"><div class="report-field-label">Evidence</div><ul>${notes.evidenceLinks.map(e=>`<li>${escapeHtml(e)}</li>`).join('')}</ul></div>` : ''}
          ${(notes.remediation && notes.remediation.state && notes.remediation.state!=='open') ? `<div class="report-field"><div class="report-field-label">Remediation Status</div><p>${escapeHtml(getRemediationObj(notes.remediation.state).label)}${notes.remediation.retestedAt?` &middot; retested ${escapeHtml(notes.remediation.retestedAt)}`:''}${notes.remediation.note?` &mdash; ${escapeHtml(notes.remediation.note)}`:''}</p></div>` : ''}
          ${(notes.attachments && notes.attachments.length) ? `<div class="report-field"><div class="report-field-label">Evidence Attachments</div>
            <div class="report-attachments">${notes.attachments.map(a=>`<img src="${a.dataUrl}" alt="${escapeHtml(a.name||'evidence')}" class="report-attachment-img">`).join('')}</div>
          </div>` : ''}
        </div>`;
      }).join('')}
    </section>`) : `
    <section class="report-page">
      <h2 class="report-h2">Detailed Findings</h2>
      <p class="report-body">No failed or flagged test cases were recorded within the selected scope at the time this report was generated.</p>
    </section>`}

    ${(typeof buildChainSequences === 'function' && buildChainSequences().length) ? `
    <section class="report-page">
      <h2 class="report-h2">Attack Chain Analysis</h2>
      <p class="report-body">The following finding sequences were identified during testing, showing how individual issues combine into a broader compromise path.</p>
      ${buildChainSequences().map(seq => `
        <div class="report-finding u-no-break">
          <div class="report-chain-path">
            ${seq.map((edge,i)=>{
              const fromItem = allData.find(d=>d.id===edge.fromId);
              const toItem = allData.find(d=>d.id===edge.toId);
              return `${i===0?`<div class="report-chain-node"><strong>${escapeHtml(edge.fromId)}</strong> — ${escapeHtml(fromItem?fromItem.title:'')}</div>`:''}
                <div class="report-chain-arrow">↓${edge.note?` <em>${escapeHtml(edge.note)}</em>`:''}</div>
                <div class="report-chain-node"><strong>${escapeHtml(edge.toId)}</strong> — ${escapeHtml(toItem?toItem.title:'')}</div>`;
            }).join('')}
          </div>
        </div>
      `).join('')}
    </section>` : ''}

    ${O.detail === 'full' ? `
    <section class="report-page">
      <h2 class="report-h2">Appendix — Test Log</h2>
      <p class="report-body">Record of every test case ${O.domains.length===allDomains.length?'':'within the selected scope '}executed as part of this engagement, in testing order.</p>
      <table class="report-table report-table-compact">
        <thead><tr><th>ID</th><th>Domain</th><th>Test Case</th><th>Severity</th><th>Status</th></tr></thead>
        <tbody>
          ${scopeData.slice().sort((a,b)=>a.sequence-b.sequence).map(d => `<tr>
            <td>${escapeHtml(d.id)}</td>
            <td>${escapeHtml(d.domain)}</td>
            <td>${escapeHtml(d.title)}</td>
            <td>${escapeHtml(d.severityLabel||d.severity)}</td>
            <td>${d.flagged ? 'Flagged' : escapeHtml(REPORT_STATUS_LABEL[d.status]||d.status)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="report-footnote">Report generated by GreySh3ll on ${escapeHtml(dateStr)}. This document reflects the assessment state at the time of generation and does not update automatically.</p>
    </section>` : `
    <section class="report-page">
      <p class="report-footnote">Report generated by GreySh3ll on ${escapeHtml(dateStr)}. This document reflects the assessment state at the time of generation and does not update automatically.</p>
    </section>`}
  `;
}
document.getElementById('importBtn').addEventListener('click', ()=>{
  document.getElementById('importInput').click();
});
document.getElementById('importInput').addEventListener('change', (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = (evt)=>{
    let payload;
    try{
      payload = JSON.parse(evt.target.result);
    }catch(err){
      showToast('That file is not valid JSON — pick a progress file exported from GreySh3ll.');
      return;
    }

    // Reject anything that is not actually a GreySh3ll export, with the
    // specific reason, rather than importing nothing and reporting success.
    const check = validateProgressPayload(payload);
    if(!check.ok){
      showToast(check.errors[0] || 'That file is not a valid GreySh3ll export.');
      console.error('GreySh3ll: import rejected —', check.errors);
      return;
    }

    /* Importing overwrites the current engagement's statuses and notes, which
       is destructive and was previously unguarded. Show exactly what is in the
       file — including how many entries refer to cases this build does not
       have — so the decision is informed rather than blind. */
    const s = check.summary;
    const lines = [
      'Import this progress file into the current engagement?',
      '',
      `  ${s.statuses} test case statuses`,
      `  ${s.notes} sets of assessor notes`,
      `  ${s.flagged} flagged cases`,
      `  ${s.customCases} custom test cases`,
      `  ${s.chains} attack chain links`,
    ];
    if(s.tester) lines.push(`  Tester: ${s.tester}`);
    if(s.exportedAt) lines.push(`  Exported: ${s.exportedAt.slice(0,10)}`);
    if(s.unmatched) lines.push('', `${s.unmatched} entr${s.unmatched===1?'y refers':'ies refer'} to test cases not in this build and will be skipped.`);
    lines.push('', 'This overwrites matching entries in your current engagement.');
    if(!confirm(lines.join('\n'))) return;

    try{
      applyProgress(payload);
      if(payload.tester) document.getElementById('testerName').value = payload.tester;
      detailCache.clear();
      saveProgress(); renderAll();
      showToast(`Imported ${s.statuses} statuses, ${s.customCases} custom cases and ${s.chains} chain links.`);
    }catch(err){
      console.error('GreySh3ll: import failed', err);
      showToast('Import failed partway through. Check the browser console, then re-import.');
    }
  };
  reader.readAsText(file); e.target.value = '';
});
function downloadFile(filename, content, type){
  const blob = new Blob([content],{type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* =========================================================
   DOMAIN CONTEXT EDITOR
========================================================= */
function renderDomainContext(){
  const code = state.activeDomain;
  const domainMeta = DOMAIN_META.find(c => c.code === code);
  const panel = document.getElementById('domainContextPanel');
  if(!panel) return;
  if(!code || !domainMeta) {
    panel.classList.add('u-hidden');
    return;
  }
  let ctx = loadDomainContext();
  if(!ctx[code]) ctx[code] = { scopeNotes:'', targetDetails:'', engagementDates:'', authorizationRef:'' };

  panel.classList.remove('u-hidden');
  panel.querySelector('.ctx-domain-name').textContent = `${domainMeta.code} — ${domainMeta.name}`;

  ['scopeNotes','targetDetails','engagementDates','authorizationRef'].forEach(field => {
    const input = document.getElementById('ctx-'+field);
    if(input) input.value = ctx[code][field] || '';
  });
}

function saveDomainContextFromUI(){
  const code = state.activeDomain;
  if(!code) return;

  let ctx = loadDomainContext();
  if(!ctx[code]) ctx[code] = {};
  ['scopeNotes','targetDetails','engagementDates','authorizationRef'].forEach(field => {
    const input = document.getElementById('ctx-'+field);
    if(input) ctx[code][field] = input.value;
  });
  saveDomainContext(ctx);
}

function bindDomainContextEvents(){
  ['scopeNotes','targetDetails','engagementDates','authorizationRef'].forEach(field => {
    const input = document.getElementById('ctx-'+field);
    if(input) input.addEventListener('input', ()=> saveDomainContextFromUI());
  });
}

