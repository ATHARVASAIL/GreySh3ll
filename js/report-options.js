/* =========================================================
   report-options.js  —  the "Generate client report" dialog
   (assessment.html). Lets the assessor scope the PDF before it
   is built: which domains, which severities, confirmed-findings-
   only, and full vs summary depth. The chosen options are handed
   to buildReportHTML(opts) in assessment.js.

   CSP-safe: no inline styles; severity dot colour comes from the
   data-sev / --sev-c mechanism, checkbox/switch state from CSS.
========================================================= */
(function(){
  'use strict';

  var overlay, domainsWrap, sevWrap, failedOnlyEl, previewEl;

  /* Build the domain checkboxes and severity chips once. */
  function buildControls(){
    domainsWrap = document.getElementById('roDomains');
    sevWrap = document.getElementById('roSeverities');
    if(!domainsWrap || !sevWrap) return;

    var check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="5,12 10,17 19,7"/></svg>';

    domainsWrap.innerHTML = CATEGORIES.map(function(c, i){
      var n = allData.filter(function(d){ return d.domain === c.code; }).length;
      return '<label class="ro-check">'
        + '<input type="checkbox" class="ro-domain" value="' + c.code + '" checked>'
        + '<span class="box">' + check + '</span>'
        + '<span class="lbl"><b>' + escapeHtml(c.code) + '</b><small>' + n + ' cases</small></span>'
        + '</label>';
    }).join('');

    sevWrap.innerHTML = SEVERITIES.map(function(s){
      return '<label class="ro-chip active" data-key="' + s.key + '">'
        + '<input type="checkbox" class="ro-sev" value="' + s.key + '" checked>'
        + '<span class="dot" data-sev="' + s.key + '"></span>' + escapeHtml(s.label)
        + '</label>';
    }).join('');

    // chip active-state follows its checkbox
    sevWrap.addEventListener('change', function(e){
      if(e.target.classList.contains('ro-sev')){
        e.target.closest('.ro-chip').classList.toggle('active', e.target.checked);
        updatePreview();
      }
    });
    domainsWrap.addEventListener('change', updatePreview);
    failedOnlyEl = document.getElementById('roFailedOnly');
    if(failedOnlyEl) failedOnlyEl.addEventListener('change', updatePreview);
    var detailWrap = document.getElementById('roDetail');
    if(detailWrap) detailWrap.addEventListener('change', updatePreview);

    document.getElementById('roDomainsAll').addEventListener('click', function(){
      domainsWrap.querySelectorAll('.ro-domain').forEach(function(c){ c.checked = true; }); updatePreview();
    });
    document.getElementById('roDomainsNone').addEventListener('click', function(){
      domainsWrap.querySelectorAll('.ro-domain').forEach(function(c){ c.checked = false; }); updatePreview();
    });
  }

  /* Read the current dialog state into a plain options object. */
  function readOptions(){
    var domains = Array.prototype.map.call(
      domainsWrap.querySelectorAll('.ro-domain:checked'), function(c){ return c.value; });
    var severities = Array.prototype.map.call(
      sevWrap.querySelectorAll('.ro-sev:checked'), function(c){ return c.value; });
    var detail = (document.querySelector('input[name="roDetail"]:checked') || {}).value || 'full';
    return {
      domains: domains,
      severities: severities,
      failedOnly: !!(failedOnlyEl && failedOnlyEl.checked),
      detail: detail
    };
  }

  /* The set of cases a report with these options would actually include. */
  function selectedCases(opts){
    return allData.filter(function(d){
      if(opts.domains.indexOf(d.domain) === -1) return false;
      if(opts.severities.indexOf(d.severity) === -1) return false;
      if(opts.failedOnly) return d.status === 'tested-fail' || d.flagged;
      return true;
    });
  }

  function updatePreview(){
    if(!previewEl) previewEl = document.getElementById('roPreview');
    if(!previewEl) return;
    var opts = readOptions();
    var cases = selectedCases(opts);
    var findings = cases.filter(function(d){ return d.status === 'tested-fail' || d.flagged; });
    if(!opts.domains.length){
      previewEl.classList.add('empty');
      previewEl.innerHTML = 'Select at least one domain to include in the report.';
      return;
    }
    if(!cases.length){
      previewEl.classList.add('empty');
      previewEl.innerHTML = opts.failedOnly
        ? 'No confirmed findings match this selection. Turn off <b>Confirmed findings only</b>, or widen the domains/severities.'
        : 'No cases match this selection.';
      return;
    }
    previewEl.classList.remove('empty');
    var scope = opts.domains.length === CATEGORIES.length ? 'all domains'
      : opts.domains.join(', ');
    previewEl.innerHTML = 'This report will cover <b>' + scope + '</b> and include <b>'
      + cases.length + '</b> ' + (opts.failedOnly ? 'confirmed finding' + (cases.length===1?'':'s')
        : 'test case' + (cases.length===1?'':'s'))
      + (opts.failedOnly ? '' : ' (of which <b>' + findings.length + '</b> ' + (findings.length===1?'is a':'are') + ' confirmed finding' + (findings.length===1?'':'s') + ')')
      + ', as a <b>' + (opts.detail === 'full' ? 'full detailed report' : 'summary') + '</b>.';
  }

  function open(){
    if(!overlay) overlay = document.getElementById('reportOptionsOverlay');
    if(!overlay) return;
    if(!domainsWrap) buildControls();
    updatePreview();
    overlay.classList.add('open');
  }
  function close(){
    if(overlay) overlay.classList.remove('open');
  }

  /* Wire up. The topbar "Report" button now opens this dialog instead of
     printing immediately; assessment.js exposes generateReport(opts). */
  function init(){
    overlay = document.getElementById('reportOptionsOverlay');
    if(!overlay) return;

    var printBtn = document.getElementById('printBtn');
    if(printBtn){
      // replace the node to drop assessment.js's original direct-print handler,
      // then bind our dialog opener.
      var fresh = printBtn.cloneNode(true);
      printBtn.parentNode.replaceChild(fresh, printBtn);
      fresh.addEventListener('click', open);
    }

    document.getElementById('reportOptionsClose').addEventListener('click', close);
    document.getElementById('reportOptionsCancel').addEventListener('click', close);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && overlay.classList.contains('open')) close();
    });

    document.getElementById('reportOptionsGenerate').addEventListener('click', function(){
      var opts = readOptions();
      if(!opts.domains.length || !selectedCases(opts).length){ updatePreview(); return; }
      close();
      if(typeof generateReport === 'function') generateReport(opts);
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
