  /* --- toast (§7 / A11): one node in the HUD shadow root, textContent swapped, hide timer in state.toastTimer --- */
  function toast(text) {
    const n = hudEls.toast;
    if (!n) return;
    try {
      n.textContent = text;
      n.classList.add('show');
      if (hudEls.fallback) n.style.display = 'block';
      cancelAnimsOf(n);
      trackAnim(n.animate([{ opacity: 0, transform: 'translate(-50%, -8px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 220, easing: 'ease-out', fill: 'forwards' }));
    } catch (e) { /* ignore */ }
    untrack(state.toastTimer);
    state.toastTimer = later(() => { state.toastTimer = 0; hideToast(true); }, 220 + 1800);
  }
  function hideToast(fade) {
    const n = hudEls.toast;
    if (!n) return;
    untrack(state.toastTimer); state.toastTimer = 0;
    const off = () => { try { n.classList.remove('show'); } catch (e) { /* ignore */ } if (hudEls.fallback) n.style.display = 'none'; };
    cancelAnimsOf(n);
    if (!fade || reducedMotion()) { off(); return; }
    try { const a = trackAnim(n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' })); a.addEventListener('finish', off); a.addEventListener('cancel', off); } catch (e) { off(); }
  }
