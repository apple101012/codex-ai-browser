(() => {
  if (window.__codexAiBrowserAcceleratorContentLoaded) {
    return;
  }
  window.__codexAiBrowserAcceleratorContentLoaded = true;

  const script = document.createElement("script");
  script.type = "text/javascript";
  script.textContent = `
    (() => {
      if (window.__codexAiBrowserAcceleratorLoaded) {
        return;
      }
      window.__codexAiBrowserAcceleratorLoaded = true;
      window.dispatchEvent(new CustomEvent("codex-ai-browser-accelerator-ready"));
    })();
  `;
  const target = document.documentElement || document.head || document.body;
  if (target) {
    target.appendChild(script);
    script.remove();
  }
})();
