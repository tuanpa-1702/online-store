// Glass dropdown: replace native <select> popup with a styled panel (keeps the <select> for form value)
(function () {
  function closeAll() {
    document.querySelectorAll('.gs-panel').forEach(function (p) { p.remove(); });
    document.querySelectorAll('.gs-btn.gs-open').forEach(function (b) { b.classList.remove('gs-open'); });
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.gs-panel') && !e.target.closest('.gs-btn')) closeAll();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });
  window.addEventListener('resize', closeAll);
  window.addEventListener('scroll', closeAll, true);

  function enhance(sel) {
    if (sel.dataset.gs || sel.multiple) return;
    sel.dataset.gs = '1';
    sel.style.display = 'none';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = sel.className + ' gs-btn';
    function label() { var o = sel.options[sel.selectedIndex]; return o ? o.text : ''; }
    function render() {
      btn.innerHTML = '<span class="gs-label"></span><span class="material-symbols-outlined gs-caret">expand_more</span>';
      btn.querySelector('.gs-label').textContent = label();
    }
    render();
    sel.insertAdjacentElement('afterend', btn);

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (btn.classList.contains('gs-open')) { closeAll(); return; }
      closeAll();
      btn.classList.add('gs-open');
      var r = btn.getBoundingClientRect();
      var panel = document.createElement('div');
      panel.className = 'gs-panel';
      panel.style.position = 'fixed';
      panel.style.left = r.left + 'px';
      panel.style.top = (r.bottom + 6) + 'px';
      panel.style.minWidth = Math.max(r.width, 190) + 'px';
      Array.from(sel.options).forEach(function (o, i) {
        var it = document.createElement('button');
        it.type = 'button';
        it.className = 'gs-opt' + (i === sel.selectedIndex ? ' gs-sel' : '');
        var check = i === sel.selectedIndex
          ? '<span class="material-symbols-outlined gs-check">check</span>'
          : '<span class="gs-check-sp"></span>';
        it.innerHTML = check + '<span></span>';
        it.querySelector('span:last-child').textContent = o.text;
        it.addEventListener('click', function () {
          sel.value = o.value;
          render();
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          closeAll();
        });
        panel.appendChild(it);
      });
      document.body.appendChild(panel);
      var pr = panel.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) panel.style.left = Math.max(8, window.innerWidth - 8 - pr.width) + 'px';
      if (pr.bottom > window.innerHeight - 8) panel.style.top = Math.max(8, r.top - 6 - pr.height) + 'px';
    });

    sel.addEventListener('change', render);
  }

  function init() { document.querySelectorAll('select').forEach(enhance); }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
  // Re-scan when details/forms reveal new selects
  document.addEventListener('toggle', function (e) {
    if (e.target && e.target.tagName === 'DETAILS' && e.target.open) {
      e.target.querySelectorAll('select').forEach(enhance);
    }
  }, true);
})();
