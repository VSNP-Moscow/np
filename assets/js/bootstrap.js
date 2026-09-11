(async function () {
  "use strict";
  if (location.hostname === "vsnp-moscow.github.io") {
    try {
      const registry = "https://raw.githubusercontent.com/VSNP-Moscow/np/gh-pages/endpoint.json";
      const response = await fetch(registry + "?t=" + Date.now(), {
        cache: "no-store", signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Endpoint unavailable");
      const config = await response.json();
      const url = new URL(config.apiBase);
      const allowedHost = [".trycloudflare.com", ".lhr.life", ".localhost.run"].some(suffix => url.hostname.endsWith(suffix));
      if (url.protocol !== "https:" || !allowedHost || url.pathname !== "/api" || url.username || url.password || url.port) {
        throw new Error("Invalid API endpoint");
      }
      window.NP_API_BASE = url.href;
    } catch (error) {
      const notice = document.createElement("p");
      notice.setAttribute("role", "alert");
      notice.textContent = "Сервер временно недоступен. Повторите попытку через минуту.";
      notice.style.cssText = "padding:16px;text-align:center;background:#fff1f2;color:#991b1b";
      document.body.prepend(notice);
      return;
    }
  }
  for (const file of ["api.js", "icons.js", "app.js"]) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "assets/js/" + file;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }
})();
