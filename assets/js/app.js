/* ============================================================
   НавигаторПедагога — приложение (роутинг + рендер), на реальном API
   ============================================================ */
(function () {
  "use strict";
  const API = window.API;
  const appIcon = (name, size) => window.NPIcon(name, size);

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const el = (tag, attrs, children) => {
    const e = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    (children || []).forEach(c => { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  };
  function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function mdLite(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|\s)_([^_\n]+?)_(?=\s|$)/g, "$1<em>$2</em>").replace(/\n/g, "<br>"); }
  function toast(msg, isError) {
    const t = el("div", { class: "toast", style: isError ? "background:var(--magenta-ink);" : "" }, [msg]);
    $("#toastWrap").appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }
  function apiErr(e) { toast(e.message || "Что-то пошло не так", true); console.error(e); }
  const COLOR_HEX = { purple: "var(--purple)", magenta: "var(--magenta)", yellow: "var(--yellow)", green: "var(--green)" };

  /* =========================== LANDING =========================== */
  function renderLandingStatics() {
    const accWrap = $("#demoAccounts");
    accWrap.innerHTML = "";
    const demo = [
      { email: "user@np.ru", role: "Педагог", badge: "badge-magenta", name: "Молодой педагог", desc: "Диалог с ИИ, дорожная карта, мероприятия" },
      { email: "mentor@np.ru", role: "Наставник", badge: "badge-purple", name: "Наставник", desc: "Ведение подопечных, чат, заметки" },
      { email: "admin@np.ru", role: "Администратор", badge: "badge-yellow", name: "Администратор", desc: "Управление педагогами и мероприятиями" },
    ];
    demo.forEach(d => {
      const card = el("div", { class: "account-card" }, [
        el("span", { class: "badge " + d.badge }, [d.role]),
        el("h5", {}, [d.name]),
        el("p", {}, [d.email + " · 123456"]),
        el("p", { style: "margin-top:8px; font-family:var(--font-body); color:var(--ink-soft);" }, [d.desc]),
      ]);
      card.addEventListener("click", () => quickLogin(d.email));
      accWrap.appendChild(card);
    });

  }

  async function quickLogin(email) {
    try { await API.login(email, "123456"); await enterApp(); }
    catch (e) { apiErr(e); }
  }

  function openAuth(tab) { setAuthTab(tab || "login"); $("#authModal").scrollIntoView({ behavior: "smooth", block: "center" }); }
  function closeAuth() { $("#authError").innerHTML = ""; }
  function setAuthTab(tab) {
    $("#tabLogin").classList.toggle("active", tab === "login");
    $("#tabRegister").classList.toggle("active", tab === "register");
    $(".auth-tabs").classList.toggle("hidden", !["login", "register"].includes(tab));
    $("#loginForm").classList.toggle("hidden", tab !== "login");
    $("#registerForm").classList.toggle("hidden", tab !== "register");
    $("#verifyForm").classList.toggle("hidden", tab !== "verify");
    $("#resetForm").classList.toggle("hidden", tab !== "reset");
    $("#authError").innerHTML = "";
  }

  function bindLanding() {
    renderLandingStatics();
    API.authOptions().then((options) => {
      const select = $("#regOrganization");
      (options.organizations || []).forEach((organization) => select.appendChild(el("option", { value: organization.id }, [organization.name])));
      select.addEventListener("change", () => {
        const organization = options.organizations.find((item) => item.id === select.value);
        if (organization?.region) $("#regRegion").value = organization.region;
      });
    }).catch(() => {});
    $("#tabLogin").addEventListener("click", () => setAuthTab("login"));
    $("#tabRegister").addEventListener("click", () => setAuthTab("register"));
    $("#changeVerificationEmail").addEventListener("click", () => {
      $("#regEmail").value = $("#verifyEmail").value;
      setAuthTab("register");
      $("#regEmail").focus();
    });

    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await API.login($("#loginEmail").value.trim(), $("#loginPass").value);
        closeAuth(); await enterApp();
      } catch (err) {
        if (err.code === "EMAIL_NOT_VERIFIED") {
          $("#verifyEmail").value = $("#loginEmail").value.trim();
          setAuthTab("verify");
        }
        $("#authError").innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
      }
    });

    $("#registerForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        fullName: $("#regName").value.trim(), email: $("#regEmail").value.trim(), password: $("#regPass").value,
        subject: $("#regSubject").value.trim(), yearsExperience: parseInt($("#regYears").value || "0", 10),
        school: $("#regOrganization").selectedOptions[0]?.value ? $("#regOrganization").selectedOptions[0].textContent.trim() : "",
        region: $("#regRegion").value.trim(), role: $("#regRole").value,
        organizationId: $("#regOrganization").value || null,
      };
      if (payload.password.length < 8) { $("#authError").innerHTML = '<div class="form-error">Пароль должен быть не короче 8 символов.</div>'; return; }
      if (!payload.region) { $("#authError").innerHTML = '<div class="form-error">Укажите регион — по нему ИИ будет искать мероприятия.</div>'; return; }
      try {
        const result = await API.register(payload);
        $("#verifyEmail").value = result.email;
        setAuthTab("verify");
        $("#authError").innerHTML = result.mailSent ? '<div class="form-success">Письмо принято почтовым сервисом. Проверьте «Входящие» и «Спам»; доставка может занять до 2 минут.</div>' : '<div class="form-error">Аккаунт создан, но письмо не было принято почтовым сервисом. Повторите отправку.</div>';
      } catch (err) { $("#authError").innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
    });

    $("#verifyForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await API.verifyEmail($("#verifyEmail").value, $("#verifyCode").value.trim());
        closeAuth(); await enterApp();
      } catch (err) { $("#authError").innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
    });
    $("#resendVerification").addEventListener("click", async () => {
      const button = $("#resendVerification");
      try {
        button.disabled = true;
        const result = await API.resendVerification($("#verifyEmail").value);
        $("#authError").innerHTML = result.mailSent === false
          ? '<div class="form-error">Почтовый сервис не принял письмо. Повторите попытку позже.</div>'
          : '<div class="form-success">Новый код передан почтовому сервису. Проверьте также папку «Спам».</div>';
        setTimeout(() => { button.disabled = false; }, 30_000);
      } catch (err) {
        button.disabled = false;
        $("#authError").innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
      }
    });

    let resetCodeRequested = false;
    $("#forgotPasswordLink").addEventListener("click", () => {
      $("#resetEmail").value = $("#loginEmail").value.trim();
      resetCodeRequested = false;
      $("#resetCodeFields").classList.add("hidden");
      $("#resetSubmit").textContent = "Получить код";
      setAuthTab("reset");
    });
    $("#backToLogin").addEventListener("click", () => setAuthTab("login"));
    $("#resetForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        if (!resetCodeRequested) {
          const result = await API.forgotPassword($("#resetEmail").value.trim());
          resetCodeRequested = true;
          $("#resetCodeFields").classList.remove("hidden");
          $("#resetSubmit").textContent = "Сохранить новый пароль";
          $("#authError").innerHTML = '<div class="form-success">Если аккаунт существует, код отправлен на почту.</div>';
        } else {
          await API.resetPassword($("#resetEmail").value.trim(), $("#resetCode").value.trim(), $("#resetNewPass").value);
          setAuthTab("login");
          $("#loginEmail").value = $("#resetEmail").value.trim();
          $("#authError").innerHTML = '<div class="form-success">Пароль обновлён. Теперь можно войти.</div>';
        }
      } catch (err) { $("#authError").innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
    });
  }

  /* =========================== APP SHELL / ROUTER =========================== */
  const NAV = {
    user: [
      { id: "dashboard", label: "Обзор", icon: "home" }, { id: "leaderboard", label: "Рейтинг педагогов", icon: "trophy" }, { id: "assistant", label: "ИИ-наставник", icon: "bot" },
      { id: "roadmap", label: "Дорожная карта", icon: "map" }, { id: "events", label: "Мероприятия", icon: "calendar" },
      { id: "assignments", label: "Задания", icon: "inbox" },
      { id: "mentor", label: "Мой наставник", icon: "userCheck" }, { id: "portfolio", label: "Портфолио", icon: "graduation" },
      { id: "files", label: "Файлы", icon: "paperclip" }, { id: "reports", label: "Отчёты", icon: "chart" },
      { id: "notifications", label: "Уведомления", icon: "bell" }, { id: "notes", label: "Заметки", icon: "note" }, { id: "profile", label: "Профиль", icon: "settings" },
    ],
    mentor: [
      { id: "dashboard", label: "Обзор", icon: "home" }, { id: "leaderboard", label: "Рейтинг педагогов", icon: "trophy" }, { id: "mentees", label: "Мои педагоги", icon: "graduation" },
      { id: "groups", label: "Группы", icon: "users" }, { id: "assignments", label: "Задания", icon: "inbox" }, { id: "tests", label: "Конструктор тестов", icon: "clipboard" },
      { id: "events", label: "Мероприятия", icon: "calendar" }, { id: "files", label: "Файлы", icon: "paperclip" },
      { id: "reports", label: "Отчёты", icon: "chart" }, { id: "notifications", label: "Уведомления", icon: "bell" },
      { id: "notes", label: "Заметки", icon: "note" }, { id: "profile", label: "Профиль", icon: "settings" },
    ],
    admin: [
      { id: "dashboard", label: "Обзор", icon: "home" }, { id: "leaderboard", label: "Рейтинг педагогов", icon: "trophy" }, { id: "users", label: "Педагоги и наставники", icon: "users" },
      { id: "organizations", label: "Организации и дизайн", icon: "building" },
      { id: "groups", label: "Группы", icon: "users" }, { id: "tests", label: "Тесты", icon: "clipboard" },
      { id: "assignments", label: "Задания", icon: "inbox" }, { id: "events", label: "Мероприятия", icon: "calendar" },
      { id: "reports", label: "Отчёты", icon: "chart" }, { id: "activity", label: "Журнал действий", icon: "activity" },
      { id: "notifications", label: "Уведомления", icon: "bell" }, { id: "notes", label: "Заметки", icon: "note" }, { id: "profile", label: "Профиль", icon: "settings" },
    ],
  };

  let currentView = "dashboard";
  let currentSub = null;
  let AI_LIVE = false;
  let chatPollTimer = null;
  let notificationPollTimer = null;
  let lastUnreadCount = 0;
  let renderEpoch = 0;

  async function enterApp() {
    $("#landing").classList.add("hidden");
    $("#shell").classList.remove("hidden");
    const hash = location.hash.replace("#/", "");
    currentView = hash.split("/")[0] || "dashboard";
    currentSub = hash.split("/")[1] || null;
    const currentUser = API.getCurUser();
    if (currentUser?.organizationId) {
      try { applyOrganizationTheme(await API.getOrganizationTheme(currentUser.organizationId)); } catch {}
    }
    if (currentUser?.role === "user" && !API.hasScores(currentUser)) {
      currentView = "assistant";
      currentSub = null;
      location.hash = "/assistant";
    }
    try {
      const st = await API.aiStatus();
      AI_LIVE = st.liveMode;
      window.__NP_AI_PROVIDER = st.provider;
      window.__NP_AI_MODEL = st.model;
    } catch (e) { AI_LIVE = false; }
    await renderShell();
    startNotificationPolling();
  }

  function applyOrganizationTheme(theme) {
    if (!theme) return;
    const root = document.documentElement;
    root.style.setProperty("--purple", theme.primaryColor);
    root.style.setProperty("--magenta", theme.accentColor);
    root.style.setProperty("--surface", theme.surfaceColor);
    root.style.fontSize = `${16 * Number(theme.fontScale || 1)}px`;
    document.body.classList.toggle("compact-mode", Boolean(theme.compactMode));
    document.title = theme.productName || "НавигаторПедагога";
  }

  function logout() {
    clearInterval(chatPollTimer);
    clearInterval(notificationPollTimer);
    API.logout();
    $("#shell").classList.add("hidden");
    $("#landing").classList.remove("hidden");
    location.hash = "";
  }

  async function go(view, sub) {
    const currentUser = API.getCurUser();
    if (currentUser?.role === "user" && !API.hasScores(currentUser) && !["assistant", "profile"].includes(view)) {
      view = "assistant";
      sub = null;
      toast("Сначала завершите стартовую диагностику");
    }
    currentView = view; currentSub = sub || null;
    location.hash = "/" + view + (sub ? "/" + sub : "");
    $$(".nav-link").forEach(n => n.classList.toggle("active", n.dataset.view === view));
    document.getElementById("sidebar")?.classList.remove("open");
    await renderMain();
  }

  async function renderShell() {
    const user = API.getCurUser();
    if (!user) { logout(); return; }
    const shell = $("#shell");
    shell.innerHTML = "";
    const onboardingRequired = user.role === "user" && !API.hasScores(user);
    const navItems = onboardingRequired ? NAV.user.filter((item) => ["assistant", "profile"].includes(item.id)) : (NAV[user.role] || NAV.user);
    let unread = 0;
    try { unread = (await API.getNotifications()).unread || 0; } catch (e) { /* notifications are non-blocking */ }
    lastUnreadCount = unread;

    const sidebar = el("div", { class: "sidebar", id: "sidebar" });
    sidebar.appendChild(el("div", { class: "brand" }, [el("span", { class: "brand-mark" }, [appIcon("compass", 20)]), "НавигаторПедагога"]));
    const su = el("div", { class: "side-user" });
    su.appendChild(avatarNode(user));
    su.appendChild(el("div", { class: "info" }, [el("b", {}, [user.fullName]), el("span", {}, [API.roleLabel(user.role)])]));
    sidebar.appendChild(su);

    if (user.role === "user") sidebar.appendChild(coinWidget(user));
    if (onboardingRequired) sidebar.appendChild(el("div", { class: "onboarding-side-note" }, ["Сначала завершите диагностику. Остальные разделы откроются автоматически."]));

    if (!AI_LIVE) {
      sidebar.appendChild(el("div", { class: "badge badge-yellow", style: "margin-bottom:14px; width:100%; box-sizing:border-box; text-align:center; padding:8px;" }, ["⚠️ Офлайн-режим ИИ"]));
    }

    navItems.forEach(n => {
      const children = [el("span", { class: "ic" }, [appIcon(n.icon, 19)]), el("span", { class: "nav-label" }, [n.label])];
      if (n.id === "notifications" && unread) children.push(el("span", { class: "nav-count" }, [String(unread)]));
      const link = el("div", { class: "nav-link" + (n.id === currentView ? " active" : ""), "data-view": n.id }, children);
      link.addEventListener("click", () => go(n.id));
      sidebar.appendChild(link);
    });
    sidebar.appendChild(el("div", { class: "nav-spacer" }));
    const foot = el("div", { class: "nav-foot" });
    const logoutLink = el("div", { class: "nav-link" }, [el("span", { class: "ic" }, [appIcon("logout", 19)]), "Выйти"]);
    logoutLink.addEventListener("click", logout);
    foot.appendChild(logoutLink);
    sidebar.appendChild(foot);

    const mobileTop = el("div", { class: "mobile-topbar" }, [el("div", { class: "brand", style: "font-size:16px;" }, [el("span", { class: "brand-mark", style: "width:30px;height:30px;font-size:14px;" }, [appIcon("compass", 17)]), "Навигатор"])]);
    const burger = el("button", { class: "btn btn-secondary btn-sm" }, [appIcon("menu", 18), "Меню"]);
    burger.addEventListener("click", () => sidebar.classList.toggle("open"));
    mobileTop.appendChild(burger);

    const main = el("div", { class: "main", id: "mainArea" });
    shell.appendChild(sidebar);
    shell.appendChild(el("div", {}, [mobileTop, main]));

    await renderMain();
  }

  function startNotificationPolling() {
    clearInterval(notificationPollTimer);
    notificationPollTimer = setInterval(async () => {
      if (document.hidden || !API.isLoggedIn()) return;
      try {
        const data = await API.getNotifications();
        const count = data.unread || 0;
        const link = document.querySelector('.nav-link[data-view="notifications"]');
        let badge = link?.querySelector(".nav-count");
        if (count && link && !badge) { badge = el("span", { class: "nav-count" }); link.appendChild(badge); }
        if (badge) { badge.textContent = String(count); badge.classList.toggle("hidden", !count); }
        if (count > lastUnreadCount && data.notifications[0]) {
          toast(data.notifications[0].title);
          if (window.Notification?.permission === "granted") new Notification(data.notifications[0].title, { body: data.notifications[0].body });
        }
        lastUnreadCount = count;
      } catch (e) { /* background refresh should stay quiet */ }
    }, 15000);
  }

  function coinWidget(user) {
    const xp = user.xp || 0;
    const level = Math.floor(xp / 100) + 1;
    const pct = xp % 100;
    return el("div", { class: "coin-widget" }, [
      el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;" }, [
        el("span", { style: "font-weight:700; font-size:13px;" }, ["🪙 " + (user.coins || 0)]),
        el("span", { style: "font-size:11px; color:var(--ink-faint); font-weight:700;" }, ["Уровень " + level]),
      ]),
      el("div", { class: "xp-bar" }, [el("div", { class: "xp-bar-fill", style: `width:${pct}%;` })]),
    ]);
  }

  function avatarNode(user, size) {
    const children = user?.hasAvatar ? [el("img", { src: API.avatarUrl(user), alt: "" })] : [API.initials(user)];
    const a = el("div", { class: "avatar" + (size ? " " + size : "") }, children);
    a.style.background = COLOR_HEX[user.avatarColor || "purple"];
    return a;
  }

  async function renderMain() {
    const epoch = ++renderEpoch;
    clearInterval(chatPollTimer);
    chatPollTimer = null;
    const mainArea = $("#mainArea");
    if (!mainArea) return;
    const user = API.getCurUser();
    if (!user) { logout(); return; }
    if (user.role === "user" && !API.hasScores(user) && !["assistant", "profile"].includes(currentView)) {
      currentView = "assistant"; currentSub = null; location.hash = "/assistant";
    }
    mainArea.innerHTML = "";
    const main = el("div", { class: "view-root" });
    mainArea.appendChild(main);
    main.appendChild(el("div", { class: "empty-state" }, [el("div", { class: "typing-dots" }, [el("span"), el("span"), el("span")])]));

    try {
      const view = currentView;
      main.innerHTML = "";
      if (view === "dashboard") return await renderDashboard(main, user);
      if (view === "leaderboard") return await renderLeaderboard(main, user);
      if (view === "assistant") return await renderAssistant(main, user);
      if (view === "roadmap") return await renderRoadmap(main, user);
      if (view === "events") return await renderEvents(main, user);
      if (view === "notes") return await renderNotes(main, user);
      if (view === "mentor") return await renderMentorView(main, user);
      if (view === "mentees") return await renderMenteesView(main, user);
      if (view === "groups") return await renderGroupsView(main, user);
      if (view === "tests") return await renderTestsView(main, user);
      if (view === "assignments") return await renderAssignmentsView(main, user);
      if (view === "users") return await renderUsersView(main, user);
      if (view === "organizations") return await renderOrganizations(main, user);
      if (view === "activity") return await renderActivity(main, user);
      if (view === "portfolio") return await renderPortfolio(main, user);
      if (view === "files") return await renderFiles(main, user);
      if (view === "reports") return await renderReports(main, user);
      if (view === "notifications") return await renderNotifications(main, user);
      if (view === "profile") return await renderProfile(main, user);
      await renderDashboard(main, user);
    } catch (e) {
      if (epoch !== renderEpoch) return;
      main.innerHTML = "";
      apiErr(e);
      main.appendChild(emptyState("⚠️", "Не удалось загрузить данные", e.message));
    }
  }

  function topbar(main, title, sub, actions) {
    const cleanTitle = String(title).replace(/^[^\p{L}\p{N}]+/u, "");
    const navIcon = (NAV[API.getCurUser()?.role] || NAV.user).find((item) => item.id === currentView)?.icon || "compass";
    const bar = el("div", { class: "topbar" }, [el("div", {}, [el("h1", {}, [appIcon(navIcon, 25), cleanTitle]), sub ? el("div", { class: "sub" }, [sub]) : null])]);
    if (actions) { const a = el("div", { class: "topbar-actions" }); actions.forEach(x => a.appendChild(x)); bar.appendChild(a); }
    main.appendChild(bar);
  }

  /* =========================== DASHBOARD =========================== */
  async function renderDashboard(main, user) {
    if (user.role === "admin") return renderAdminDashboard(main, user);
    if (user.role === "mentor") return renderMentorDashboard(main, user);

    topbar(main, `Привет, ${user.fullName.split(" ")[0]} 👋`, `${user.subject} · ${API.roleLabel(user.role)} · стаж ${user.yearsExperience} лет · ${user.region || "регион не указан"}`);

    const has = API.hasScores(user);
    const grid = el("div", { class: "grid-4" });
    grid.appendChild(statTile("purple", "Средний балл", has ? API.avgScore(user).toFixed(1) + "/5" : "—"));
    grid.appendChild(statTile("magenta", "Этап алгоритма", (user.currentStage || 1) + "/6"));
    const events = await API.listEvents();
    grid.appendChild(statTile("yellow", "Мероприятий доступно", String(events.filter(e => !e.completed).length)));
    const mentor = user.mentorId ? await API.getUser(user.mentorId).catch(() => null) : null;
    grid.appendChild(statTile("green", "Наставник", mentor ? mentor.fullName.split(" ")[0] : "не назначен"));
    main.appendChild(grid);

    const nudge = await API.getNudge();
    if (nudge.suggestion) {
      main.appendChild(el("div", { class: "card", style: "margin-top:16px; border-color:var(--yellow-pastel-2); display:flex; gap:12px; align-items:center;" }, [
        el("span", { style: "font-size:22px;" }, ["👋"]),
        el("p", { style: "font-size:13.5px; color:var(--ink-soft);" }, [nudge.suggestion]),
      ]));
    }
    if (has) {
      const digestCard = el("div", { class: "card", style: "margin-top:16px; background:var(--gradient-brand); color:#fff;" }, [
        el("div", { style: "font-size:12px; font-weight:700; opacity:.85; margin-bottom:6px;" }, ["🤖 ИИ-НАСТАВНИК · ЧТО ДАЛЬШЕ"]),
      ]);
      const digestText = el("p", { style: "font-size:14px; line-height:1.4;" }, ["Загружаю…"]);
      digestCard.appendChild(digestText);
      main.appendChild(digestCard);
      API.getDigest().then(d => { digestText.textContent = d.text; }).catch(() => { digestText.textContent = "Не удалось загрузить дайджест."; });
    }

    const cols = el("div", { class: "grid-2", style: "margin-top:18px; align-items:start;" });
    const aiCta = el("div", { class: "roadmap-cta" }, [
      el("div", { class: "big" }, ["🤖"]),
      el("h4", {}, [has ? "Поговорить с ИИ-наставником" : "Пройти диалоговую диагностику"]),
      el("p", {}, [has ? "Задайте вопрос или предложите корректировку утверждённого плана" : "Ответьте своими словами на 18 рабочих ситуаций"]),
    ]);
    aiCta.addEventListener("click", () => go("assistant"));
    const leftCol = el("div", {}, [aiCta]);
    const compCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["📊 Компетенции"])]);
    if (!has) compCard.appendChild(el("p", { style: "color:var(--ink-soft); font-size:13.5px;" }, ["Пока нет данных — пройдите диагностику с ИИ-наставником."]));
    else API.COMPETENCIES.forEach(c => compCard.appendChild(miniScoreRow(c, user.scores[c.id])));
    leftCol.appendChild(compCard);
    cols.appendChild(leftCol);

    const rightCol = el("div", {});
    const evCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["📅 Ближайшие мероприятия"])]);
    const upcoming = events.filter(e => !e.completed).slice(0, 3);
    if (!upcoming.length) evCard.appendChild(el("p", { style: "color:var(--ink-soft); font-size:13.5px;" }, ["Мероприятий пока нет."]));
    upcoming.forEach(e => evCard.appendChild(smallEventRow(e)));
    const evAllBtn = el("button", { class: "btn btn-ghost btn-sm", style: "margin-top:6px;" }, ["Все мероприятия →"]);
    evAllBtn.addEventListener("click", () => go("events"));
    evCard.appendChild(evAllBtn);
    rightCol.appendChild(evCard);

    const notes = await API.listNotes();
    const noteCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["📝 Последние заметки"])]);
    if (!notes.length) noteCard.appendChild(el("p", { style: "color:var(--ink-soft); font-size:13.5px;" }, ["Заметок ещё нет."]));
    notes.slice(0, 3).forEach(n => noteCard.appendChild(el("div", { style: "padding:10px 0; border-bottom:1px solid var(--border);" }, [el("b", { style: "font-size:13.5px;" }, [n.title]), el("div", { style: "font-size:12px; color:var(--ink-faint); margin-top:2px;" }, [n.category])])));
    rightCol.appendChild(noteCard);
    cols.appendChild(rightCol);
    main.appendChild(cols);
  }

  function statTile(color, label, value) {
    return el("div", { class: `stat-tile stat-${color}`, style: `background:var(--${color}-pastel); color:var(--${color}-ink);` }, [el("b", {}, [value]), el("span", {}, [label.toUpperCase()])]);
  }
  function miniScoreRow(c, score) {
    const pct = score ? (score / 5) * 100 : 0;
    return el("div", { style: "margin-bottom:12px;" }, [
      el("div", { style: "display:flex; justify-content:space-between; font-size:13px; margin-bottom:5px;" }, [el("span", {}, [c.icon + " " + c.label]), el("span", { class: "mono", style: "color:var(--ink-faint);" }, [score ? score + "/5" : "—"])]),
      el("div", { class: "progress-track" }, [el("div", { class: "progress-fill", style: `width:${pct}%;` })]),
    ]);
  }
  function smallEventRow(e) {
    const comp = API.competency(e.area);
    return el("div", { style: "padding:9px 0; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; gap:10px; align-items:center;" }, [
      el("div", {}, [el("div", { style: "font-size:13.5px; font-weight:700;" }, [e.title]), el("div", { style: "font-size:12px; color:var(--ink-faint);" }, [`${e.date} · ${e.time || ""}`])]),
      el("span", { class: "badge badge-" + comp.color }, [comp.icon]),
    ]);
  }

  async function renderLeaderboard(main, currentUser) {
    topbar(main, "Рейтинг педагогов", "Уровень определяется накопленным опытом; при равенстве выше педагог с большим числом койнов");
    const leaders = await API.getLeaderboard();
    if (!leaders.length) { main.appendChild(emptyState("", "Рейтинг пока пуст", "Первые позиции появятся после выполнения заданий и мероприятий.")); return; }

    const podium = el("div", { class: "leader-podium" });
    leaders.slice(0, 3).forEach((leader) => podium.appendChild(el("article", { class: `leader-card rank-${leader.rank}` }, [
      el("div", { class: "leader-rank" }, [String(leader.rank)]),
      avatarNode(leader, "lg"),
      el("div", { class: "leader-name" }, [leader.fullName]),
      el("div", { class: "leader-subject" }, [leader.subject || "Предмет не указан"]),
      el("div", { class: "leader-score" }, [el("b", {}, [`Уровень ${leader.level}`]), el("span", {}, [`${leader.coins || 0} койнов · ${leader.xp || 0} XP`])]),
    ])));
    main.appendChild(podium);

    const list = el("div", { class: "leader-list" });
    leaders.forEach((leader) => list.appendChild(el("div", { class: `leader-row${leader.id === currentUser.id ? " is-me" : ""}` }, [
      el("b", { class: "leader-position" }, [String(leader.rank)]),
      avatarNode(leader, "sm"),
      el("div", { class: "leader-person" }, [el("b", {}, [leader.fullName]), el("span", {}, [`${leader.subject || "Без предмета"} · ${leader.region || "Регион не указан"}`])]),
      el("div", { class: "leader-level" }, [el("b", {}, [`Уровень ${leader.level}`]), el("span", {}, [`${leader.xp || 0} XP`])]),
      el("b", { class: "leader-coins" }, [`${leader.coins || 0} койнов`]),
    ])));
    main.appendChild(list);
  }

  async function renderMentorDashboard(main, user) {
    topbar(main, `Здравствуйте, ${user.fullName.split(" ")[0]} 👋`, `Наставник · ${user.subject}`);
    const mentees = await API.listUsers("user");
    const pending = await API.pendingMentees();
    const grid = el("div", { class: "grid-4" });
    grid.appendChild(statTile("purple", "Подопечных", String(mentees.length)));
    const avgAll = mentees.length ? (mentees.reduce((s, m) => s + API.avgScore(m), 0) / mentees.length).toFixed(1) : "—";
    grid.appendChild(statTile("magenta", "Средний балл группы", avgAll === "—" ? "—" : avgAll + "/5"));
    const weakCount = mentees.reduce((s, m) => s + API.COMPETENCIES.filter(c => (m.scores[c.id] || 0) > 0 && m.scores[c.id] <= 2).length, 0);
    grid.appendChild(statTile("yellow", "Точек роста всего", String(weakCount)));
    const events = await API.listEvents();
    grid.appendChild(statTile("green", "Мероприятий в каталоге", String(events.length)));
    main.appendChild(grid);

    if (pending.length) {
      const pCard = el("div", { class: "card", style: "margin-top:18px; border-color:var(--yellow-pastel-2);" }, [el("div", { class: "card-title" }, [`⏳ Заявки на наставничество (${pending.length})`])]);
      pending.forEach(p => {
        const row = el("div", { style: "display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--border);" }, [
          avatarNode(p, "sm"),
          el("div", { style: "flex:1;" }, [el("b", { style: "font-size:14px;" }, [p.fullName]), el("div", { style: "font-size:12px; color:var(--ink-faint);" }, [p.subject + " · " + (p.region || "без региона")])]),
        ]);
        const ok = el("button", { class: "btn btn-primary btn-sm" }, ["Принять"]);
        ok.addEventListener("click", async () => { await API.confirmMentee(p.id); renderMain(); toast("Пара создана"); });
        const no = el("button", { class: "btn btn-ghost btn-sm" }, ["Отклонить"]);
        no.addEventListener("click", async () => { await API.declineMentee(p.id); renderMain(); });
        row.appendChild(ok); row.appendChild(no);
        pCard.appendChild(row);
      });
      main.appendChild(pCard);
    }

    const card = el("div", { class: "card", style: "margin-top:18px;" }, [el("div", { class: "card-title" }, ["🎓 Мои подопечные"])]);
    if (!mentees.length) card.appendChild(el("p", { style: "color:var(--ink-soft); font-size:13.5px;" }, ["Педагоги пока не закреплены за вами."]));
    mentees.forEach(m => card.appendChild(menteeRow(m, () => go("mentees", m.id))));
    main.appendChild(card);
  }

  function menteeRow(m, onClick) {
    const row = el("div", { style: "display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--border); cursor:pointer;" });
    row.appendChild(avatarNode(m, "sm"));
    row.appendChild(el("div", { style: "flex:1;" }, [el("div", { style: "font-weight:700; font-size:14px;" }, [m.fullName]), el("div", { style: "font-size:12px; color:var(--ink-faint);" }, [`${m.subject} · ${m.region || "без региона"} · балл ${API.hasScores(m) ? API.avgScore(m).toFixed(1) : "—"}`])]));
    row.appendChild(el("span", { class: "badge badge-purple" }, ["Открыть →"]));
    row.addEventListener("click", onClick);
    return row;
  }

  async function renderAdminDashboard(main, user) {
    topbar(main, "Панель администратора", user.school || "");
    const [teachers, mentors, events] = await Promise.all([API.listUsers("user"), API.listUsers("mentor"), API.listEvents()]);
    const grid = el("div", { class: "grid-4" });
    grid.appendChild(statTile("purple", "Молодых педагогов", String(teachers.length)));
    grid.appendChild(statTile("magenta", "Наставников", String(mentors.length)));
    grid.appendChild(statTile("yellow", "Мероприятий", String(events.length)));
    grid.appendChild(statTile("green", "Без наставника", String(teachers.filter(t => !t.mentorId).length)));
    main.appendChild(grid);
    if (!AI_LIVE) {
      main.appendChild(el("div", { class: "card", style: "margin-top:18px; border-color:var(--yellow-pastel-2);" }, [
        el("div", { class: "card-title" }, ["⚠️ ИИ работает в офлайн-режиме"]),
        el("p", { style: "font-size:13.5px; color:var(--ink-soft);" }, ["Поиск реальных мероприятий по регионам недоступен. Проверьте ключ AI-провайдера в настройках Render и перезапустите сервис."]),
      ]));
    }
    const card = el("div", { class: "card", style: "margin-top:18px;" }, [el("div", { class: "card-title" }, ["👥 Молодые педагоги"])]);
    if (!teachers.length) card.appendChild(el("p", { style: "color:var(--ink-soft); font-size:13.5px;" }, ["Педагогов пока нет."]));
    teachers.forEach(t => card.appendChild(menteeRow(t, () => go("users", t.id))));
    main.appendChild(card);
  }

  /* =========================== AI ASSISTANT =========================== */
  let diagnosticActiveFlag = false;

  async function renderAssistant(main, user) {
    const onboarding = user.role === "user" && !API.hasScores(user);
    topbar(main, onboarding ? "Стартовая диагностика" : "🤖 ИИ-ассистент пары", onboarding ? "Обязательный первый шаг · отвечайте своими словами" : "ИИ предлагает изменения, наставник проверяет и утверждает");

    const shellDiv = el("div", { class: "chat-shell" });
    const scroll = el("div", { class: "chat-scroll", id: "chatScroll" });
    shellDiv.appendChild(scroll);
    main.appendChild(shellDiv);

    let chatData = await API.getAiChat();
    let history = chatData.messages || [];
    if (onboarding && !history.length && !chatData.diagnosticActive) {
      history = await API.startDiagnostic();
      chatData = await API.getAiChat();
      history = chatData.messages || history;
    }
    const diagActive = chatData.diagnosticActive;
    diagnosticActiveFlag = diagActive;

    if (chatData.diagnosticProgress?.started && !chatData.diagnosticProgress.done) {
      shellDiv.insertBefore(diagnosticProgressNode(chatData.diagnosticProgress), scroll);
    }

    if (!history.length && !API.hasScores(user) && !diagActive) {
      scroll.appendChild(introCard(user));
    } else {
      if (!history.length) {
        const st = await API.aiStatus();
        history = [{ role: "ai", text: `С возвращением, ${user.fullName.split(" ")[0]}! 👋 Выберите быстрое действие ниже или напишите, что вас беспокоит.` }];
      }
      history.forEach(m => scroll.appendChild(renderMsg(m)));
    }

    const quickRow = el("div", { class: "chat-quick", id: "chatQuick" });
    if (!diagActive && API.hasScores(user)) {
      const actions = await API.quickActions();
      actions.forEach(q => {
        const chip = el("button", { class: "chip" }, [q.label]);
        chip.addEventListener("click", () => sendFromUser(user, q.prompt, scroll, q.id === "map"));
        quickRow.appendChild(chip);
      });
      const redo = el("button", { class: "chip" }, ["🔁 Пройти диагностику заново"]);
      redo.addEventListener("click", () => beginDiagnostic(user, scroll));
      quickRow.appendChild(redo);
    }
    shellDiv.appendChild(quickRow);

    const inputBar = el("div", { class: "chat-input-bar" });
    const input = el("input", { type: "text", placeholder: diagActive ? "Ответьте своими словами…" : "Спросите что угодно, например: как справиться с шумным классом?" });
    const sendBtn = el("button", { class: "chat-send" }, ["➤"]);
    const doSend = () => { const v = input.value.trim(); if (!v) return; input.value = ""; sendFromUser(user, v, scroll); };
    sendBtn.addEventListener("click", doSend);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });
    inputBar.appendChild(input); inputBar.appendChild(sendBtn);
    shellDiv.appendChild(inputBar);
    scroll.scrollTop = scroll.scrollHeight;
  }

  function introCard(user) {
    const card = el("div", { class: "card", style: "max-width:560px;" }, [
      el("div", { style: "font-size:38px; margin-bottom:10px;" }, ["🤖"]),
      el("h3", { style: "margin-bottom:8px;" }, ["Здравствуйте, " + user.fullName.split(" ")[0] + "!"]),
      el("p", { style: "color:var(--ink-soft); font-size:14.5px; margin-bottom:18px;" }, [
        `Я — ваш ИИ-наставник. Разберём 18 реальных рабочих ситуаций по 6 направлениям компетенций. Можно отвечать своими словами: ИИ оценит контекст, уточнит затруднения и ${AI_LIVE ? "подберёт мероприятия для региона «" + (user.region || "не указан") + "»" : "соберёт персональный профиль"}.`,
      ]),
    ]);
    const btn = el("button", { class: "btn btn-primary" }, ["Начать диагностику 💬"]);
    btn.addEventListener("click", () => beginDiagnostic(user, $("#chatScroll")));
    card.appendChild(btn);
    return card;
  }

  function diagnosticProgressNode(progress) {
    const competency = API.competency(progress.competency);
    return el("div", { class: "diagnostic-progress", id: "diagnosticProgress" }, [
      el("div", { class: "diagnostic-progress-head" }, [
        el("span", { id: "diagnosticProgressLabel" }, [`${competency?.icon || "🧭"} Вопрос ${progress.current} из ${progress.total}`]),
        el("b", { id: "diagnosticProgressPercent" }, [`${progress.percent}%`]),
      ]),
      el("div", { class: "diagnostic-progress-track" }, [el("div", { id: "diagnosticProgressFill", style: `width:${progress.percent}%;` })]),
    ]);
  }

  function updateDiagnosticProgress(progress) {
    if (!progress?.started) return;
    const competency = API.competency(progress.competency);
    const label = $("#diagnosticProgressLabel");
    const percent = $("#diagnosticProgressPercent");
    const fill = $("#diagnosticProgressFill");
    if (label) label.textContent = `${competency?.icon || "🧭"} Вопрос ${progress.current} из ${progress.total}`;
    if (percent) percent.textContent = `${progress.percent}%`;
    if (fill) fill.style.width = `${progress.percent}%`;
  }

  async function beginDiagnostic(user, scroll) {
    scroll.innerHTML = "";
    try {
      const msgs = await API.startDiagnostic();
      diagnosticActiveFlag = true;
      msgs.forEach(m => scroll.appendChild(renderMsg(m)));
      scroll.scrollTop = scroll.scrollHeight;
      await renderMain();
    } catch (e) { apiErr(e); }
  }

  function renderMsg(m) {
    const row = el("div", { class: "msg-row " + (m.role === "user" ? "me" : "ai") });
    if (m.role !== "user") row.appendChild(el("div", { class: "msg-avatar ai" }, ["🤖"]));
    row.appendChild(el("div", { class: "msg-bubble", html: mdLite(m.text) }));
    const wrap = el("div", {}, [row]);
    if (!diagnosticActiveFlag && m.chips && m.chips.length) {
      const chipsWrap = el("div", { class: "msg-chips" });
      m.chips.forEach(c => {
        const chip = el("button", { class: "chip reply-chip" }, [c]);
        chip.addEventListener("click", () => { chipsWrap.querySelectorAll(".chip").forEach(b => b.disabled = true); sendFromUser(API.getCurUser(), c, $("#chatScroll")); });
        chipsWrap.appendChild(chip);
      });
      wrap.appendChild(chipsWrap);
    }
    return wrap;
  }

  function typingBubble(text) {
    return el("div", { class: "msg-row ai" }, [
      el("div", { class: "msg-avatar ai" }, ["🤖"]),
      el("div", { class: "msg-bubble" }, [text ? text + " " : "", el("span", { class: "typing-dots" }, [el("span"), el("span"), el("span")])]),
    ]);
  }

  async function sendFromUser(user, text, scroll, isRoadmapAction) {
    scroll.appendChild(renderMsg({ role: "user", text }));
    scroll.scrollTop = scroll.scrollHeight;

    const wasDiagnosticActive = diagnosticActiveFlag;
    const typing = typingBubble(wasDiagnosticActive ? "" : (isRoadmapAction ? "🔎 Ищу мероприятия в интернете, это может занять до минуты…" : ""));
    scroll.appendChild(typing);
    scroll.scrollTop = scroll.scrollHeight;

    try {
      if (wasDiagnosticActive) {
        const res = await API.replyDiagnostic(text);
        diagnosticActiveFlag = res.diagnosticActive;
        updateDiagnosticProgress(res.diagnosticProgress);
        typing.remove();
        res.messages.forEach(m => scroll.appendChild(renderMsg(m)));
        scroll.scrollTop = scroll.scrollHeight;
        if (!res.diagnosticActive) {
          if (!res.roadmap) await autoGenerateRoadmap(user, scroll);
          await API.fetchMe();
          if (res.roadmap) scroll.appendChild(renderMsg({ role: "ai", text: "Проект карты создан и отправлен наставнику на согласование." }));
          await renderShell();
        }
      } else if (isRoadmapAction) {
        const rm = await API.generateRoadmap(user.region);
        typing.remove();
        const summary = rm.mode === "live" ? `✅ Готово! Нашёл мероприятия для региона «${rm.region}». Подробности — на вкладке «Дорожная карта».` : rm.mode === "ai" ? `🤖 Готово! ИИ-наставник собрал карту из каталога платформы для региона «${rm.region}».` : `⚠️ ${rm.summary}`;
        scroll.appendChild(renderMsg({ role: "ai", text: summary }));
        scroll.scrollTop = scroll.scrollHeight;
      } else {
        const msgs = await API.chatWithAi(text);
        typing.remove();
        msgs.forEach(m => scroll.appendChild(renderMsg(m)));
        scroll.scrollTop = scroll.scrollHeight;
      }
    } catch (e) {
      typing.remove();
      scroll.appendChild(renderMsg({ role: "ai", text: "Не удалось получить ответ: " + e.message }));
    }
  }

  async function autoGenerateRoadmap(user, scroll) {
    const typing = typingBubble("🔎 Ищу реальные мероприятия для региона «" + (user.region || "—") + "»…");
    scroll.appendChild(typing);
    scroll.scrollTop = scroll.scrollHeight;
    try {
      const rm = await API.generateRoadmap(user.region);
      typing.remove();
      const text = rm.mode === "live"
        ? `🗺️ Дорожная карта готова! Нашёл мероприятия для региона «${rm.region}». Откройте вкладку «Дорожная карта», чтобы посмотреть.`
        : rm.mode === "ai"
          ? `🗺️ Дорожная карта готова: ИИ-наставник обработал каталог платформы для региона «${rm.region}».`
          : `🗺️ Дорожная карта готова (офлайн-режим — мероприятия из общего каталога). ${rm.summary}`;
      scroll.appendChild(renderMsg({ role: "ai", text }));
      scroll.scrollTop = scroll.scrollHeight;
    } catch (e) {
      typing.remove();
      scroll.appendChild(renderMsg({ role: "ai", text: "Не удалось построить карту: " + e.message }));
    }
  }

  /* =========================== ROADMAP =========================== */
  async function renderRoadmap(main, user) {
    topbar(main, "🗺️ Дорожная карта", `Регион: ${user.region || "не указан"}`, [
      (() => { const b = el("button", { class: "btn btn-primary btn-sm" }, ["🔎 Обновить (поиск в интернете)"]); b.addEventListener("click", () => regenerateRoadmap(user)); return b; })(),
    ]);
    if (!API.hasScores(user)) {
      main.appendChild(emptyState("🗺️", "Дорожная карта не сформирована", "Пройдите диалоговую диагностику с ИИ-наставником — маршрут соберётся автоматически.", "Начать диагностику", () => go("assistant")));
      return;
    }
    const rm = await API.getRoadmap();
    if (!rm) {
      main.appendChild(emptyState("🗺️", "Карта ещё не построена", "Нажмите «Обновить», чтобы ИИ нашёл мероприятия под ваши баллы.", "Построить карту", () => regenerateRoadmap(user)));
      return;
    }
    const progress = await API.listProgress();
    renderRoadmapContent(main, rm, progress, user.currentStage);

    // "постоянно обновляющийся список мероприятий": если карта старше 4 дней, тихо обновляем в фоне,
    // Не более раза в сутки на клиенте, чтобы бережно расходовать квоту AI-провайдера.
    const todayKey = "np-auto-refresh-" + new Date().toISOString().slice(0, 10);
    if (rm.stale && !localStorage.getItem(todayKey)) {
      localStorage.setItem(todayKey, "1");
      const badge = el("div", { class: "mode-badge offline", style: "margin-bottom:10px;" }, ["🔄 Карта могла устареть — обновляю в фоне…"]);
      main.insertBefore(badge, main.firstChild);
      API.generateRoadmap(user.region).then(async (fresh) => {
        if (currentView !== "roadmap") return; // пользователь уже ушёл со страницы — не перерисовываем поверх другого экрана
        const freshProgress = await API.listProgress();
        main.innerHTML = "";
        topbar(main, "🗺️ Дорожная карта", `Регион: ${fresh.region}`, [
          (() => { const b = el("button", { class: "btn btn-primary btn-sm" }, ["🔎 Обновить (поиск в интернете)"]); b.addEventListener("click", () => regenerateRoadmap(user)); return b; })(),
        ]);
        renderRoadmapContent(main, fresh, freshProgress, user.currentStage);
      }).catch(() => badge.remove());
    }
  }

  async function regenerateRoadmap(user) {
    const main = $("#mainArea");
    main.innerHTML = "";
    topbar(main, "🗺️ Дорожная карта", `Регион: ${user.region || "не указан"}`);
    main.appendChild(el("div", { class: "card empty-state" }, [
      el("div", { class: "typing-dots", style: "justify-content:center;" }, [el("span"), el("span"), el("span")]),
      el("p", { style: "margin-top:14px;" }, [AI_LIVE ? "Ищу реальные мероприятия в интернете — это может занять до минуты…" : "Строю карту из общего каталога…"]),
    ]));
    try {
      const rm = await API.generateRoadmap(user.region);
      const progress = await API.listProgress();
      main.innerHTML = "";
      topbar(main, "🗺️ Дорожная карта", `Регион: ${rm.region}`, [
        (() => { const b = el("button", { class: "btn btn-primary btn-sm" }, ["🔎 Обновить (поиск в интернете)"]); b.addEventListener("click", () => regenerateRoadmap(user)); return b; })(),
      ]);
      renderRoadmapContent(main, rm, progress, user.currentStage);
    } catch (e) { apiErr(e); await renderMain(); }
  }

  function renderRoadmapContent(main, rm, progress, currentStage) {
    progress = progress || [];
    const approved = rm.status === "approved";
    const statusLabel = approved ? `Утверждено наставником · версия ${rm.version || 1}` : rm.status === "changes_requested" ? "Наставник запросил доработку" : "Проект ИИ ожидает проверки наставника";
    main.appendChild(el("div", { class: "roadmap-workflow " + (approved ? "approved" : "pending") }, [
      el("div", { class: "workflow-mark" }, [approved ? "✓" : "↻"]),
      el("div", { class: "workflow-copy" }, [el("b", {}, [statusLabel]), el("span", {}, [approved ? (rm.mentorComment || "Можно приступать к мероприятиям и фиксировать прогресс.") : (rm.mentorComment || "До публикации карта доступна для просмотра, но не запускает рабочий маршрут.")])]),
    ]));
    if (rm.proposal) main.appendChild(el("div", { class: "roadmap-workflow pending" }, [el("div", { class: "workflow-mark" }, ["AI"]), el("div", { class: "workflow-copy" }, [el("b", {}, ["Новая редакция находится у наставника"]), el("span", {}, ["Вы продолжаете работать по утверждённой версии, пока наставник не опубликует следующую."])])]));
    main.appendChild(el("div", { class: "mode-badge " + (rm.mode === "live" || rm.mode === "ai" ? "live" : "offline") }, [rm.mode === "live" ? "✅ Найдено в интернете" : rm.mode === "ai" ? "🤖 Обработано ИИ из каталога" : "⚠️ Офлайн-каталог"]));
    if (rm.searchStatus?.searchedAt) main.appendChild(el("div", { class: "search-audit" }, [`Поиск: проверено ${rm.searchStatus.checked || 0}, добавлено ${rm.searchStatus.found || 0} · ${new Date(rm.searchStatus.searchedAt).toLocaleString("ru-RU")}`]));

    if (rm.summary) main.appendChild(el("div", { class: "card" }, [el("div", { class: "card-title" }, ["💬 Комментарий ИИ-наставника"]), el("p", { style: "font-size:14px; color:var(--ink-soft);" }, [rm.summary])]));

    const algoCard = el("section", { class: "card algorithm-card" }, [
      el("div", { class: "section-inline-head" }, [el("div", {}, [
        el("h3", {}, ["Этапы профессионального развития"]),
        el("p", {}, ["Выберите текущий этап. Изменение сохранится в профиле и отчётах."]),
      ])]),
    ]);
    const diagram = el("div", { class: "route-diagram editable-stages", role: "list", "aria-label": "Этапы алгоритма" });
    const stageIdx = (currentStage || 1) - 1;
    API.ALGO_STAGES.forEach((s, i) => {
      const node = el("button", { type: "button", role: "listitem", class: "route-node " + (i === stageIdx ? "current" : i < stageIdx ? "done" : ""), "aria-current": i === stageIdx ? "step" : "false" }, [
        el("div", { class: "route-dot " + (i === stageIdx ? "current" : i < stageIdx ? "done" : "") }, [i < stageIdx ? "✓" : String(i + 1)]),
        el("div", { class: "label" }, [el("b", {}, [s]), el("span", {}, [i === stageIdx ? "Текущий этап" : i < stageIdx ? "Завершён" : "Запланирован"])]),
      ]);
      node.addEventListener("click", async () => {
        if (i === stageIdx) return;
        $$(".editable-stages .route-node").forEach((button) => { button.disabled = true; });
        try {
          await API.updateMe({ currentStage: i + 1 });
          toast(`Текущий этап: ${i + 1} из 6`);
          await renderMain();
        } catch (error) { apiErr(error); $$(".editable-stages .route-node").forEach((button) => { button.disabled = false; }); }
      });
      diagram.appendChild(node);
    });
    algoCard.appendChild(diagram);
    main.appendChild(algoCard);

    main.appendChild(el("h3", { style: "margin:26px 0 4px; font-size:18px; text-align:center;" }, ["Ваш путь обучения"]));
    main.appendChild(renderJourneyMap(rm, progress, approved));

    main.appendChild(el("h3", { style: "margin:30px 0 4px; font-size:18px;" }, ["Мероприятия по компетенциям"]));
    (rm.priorities || []).forEach(p => main.appendChild(roadmapCompCard(p, approved)));

    if (rm.sources && rm.sources.length) {
      const srcCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["🔗 Источники поиска"])]);
      rm.sources.slice(0, 12).forEach(u => srcCard.appendChild(el("a", { class: "source-link", href: u, target: "_blank", rel: "noopener" }, [u])));
      main.appendChild(srcCard);
    }
  }

  // Карта пути в стиле Duolingo: каждый шаг = одно мероприятие дорожной карты, в порядке
  // приоритета (сначала самые слабые компетенции). Состояние узла берётся из roadmap_progress
  // пользователя (отчёт сдан/оценён = пройдено, взято в работу = текущий, иначе — следующий шаг).
  function renderJourneyMap(rm, progress, canAct = true) {
    const steps = [];
    (rm.priorities || []).forEach(p => (p.events || []).forEach(ev => steps.push({ competency: p.competency, ev })));
    const map = el("div", { class: "journey-map" });
    if (!steps.length) { map.appendChild(el("p", { style: "text-align:center; color:var(--ink-faint); font-size:13.5px;" }, ["Мероприятия появятся здесь после обновления карты."])); return map; }

    const byTitle = new Map(progress.map(p => [p.event_title.trim().toLowerCase(), p]));
    let currentAssigned = false;
    steps.forEach((step, i) => {
      const match = byTitle.get(step.ev.title.trim().toLowerCase());
      let state = "locked";
      if (match && (match.status === "reported" || match.status === "rated")) state = "done";
      else if (match && match.status === "open") { state = "current"; currentAssigned = true; }
      if (state === "locked" && !currentAssigned) { state = "current"; currentAssigned = true; }

      const comp = API.competency(step.competency) || { icon: "❓", label: step.competency };
      const row = el("div", { class: "journey-row pos-" + (i % 4) });
      const node = el("div", { class: "journey-node " + state }, [state === "done" ? "✅" : comp.icon]);
      if (state === "done") node.appendChild(el("span", { class: "check-badge" }, ["✓"]));
      if (canAct) node.addEventListener("click", () => openJourneyNodeModal(step.competency, step.ev, match));
      else node.title = "Доступно после утверждения наставником";
      const col = el("div", { class: "journey-node-col" }, [
        node,
        el("span", { class: "journey-comp-tag" }, [comp.label]),
        el("span", { class: "journey-label" }, [step.ev.title]),
      ]);
      row.appendChild(col);
      map.appendChild(row);
    });
    return map;
  }

  function openJourneyNodeModal(competencyId, ev, existing) {
    if (!existing) return openProgressReportModal(competencyId, ev);
    const backdrop = el("div", { class: "modal-backdrop" });
    const modal = el("div", { class: "modal" }, [
      el("h3", { style: "margin-bottom:10px;" }, [ev.title]),
      el("div", { class: "chip", style: "cursor:default; margin-bottom:12px;" }, [existing.status === "rated" ? "✅ Оценено наставником" : existing.status === "reported" ? "📝 Отчёт на проверке" : "📌 В работе"]),
    ]);
    if (existing.report_text) modal.appendChild(el("p", { style: "font-size:13.5px; color:var(--ink-soft); margin-bottom:8px;" }, [existing.report_text]));
    if (existing.usefulness_rating) modal.appendChild(el("p", { style: "font-size:12.5px; color:var(--ink-faint);" }, [`Ваша оценка полезности: ${existing.usefulness_rating}/5`]));
    if (existing.mentor_rating) modal.appendChild(el("p", { style: "font-size:12.5px; color:var(--ink-faint);" }, [`Оценка наставника: ${existing.mentor_rating}/5`]));
    if (existing.mentor_feedback) modal.appendChild(el("div", { class: "mentor-feedback-note" }, [el("b", {}, ["Обратная связь наставника"]), el("p", {}, [existing.mentor_feedback])]));
    if (ev.url) modal.appendChild(el("a", { href: ev.url, target: "_blank", rel: "noopener", style: "display:block; margin-top:8px; font-size:12.5px; color:var(--purple-ink); font-weight:700;" }, ["Открыть источник →"]));
    const close = el("button", { class: "btn btn-ghost btn-sm", style: "margin-top:14px;" }, ["Закрыть"]);
    close.addEventListener("click", () => backdrop.remove());
    modal.appendChild(close);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  function roadmapCompCard(p, canAct = true) {
    const comp = API.competency(p.competency) || { icon: "❓", label: p.competency, color: "purple" };
    const weak = p.score > 0 && p.score <= 2;
    const card = el("div", { class: "card" });
    card.appendChild(el("div", { style: "display:flex; align-items:center; gap:12px; margin-bottom:12px;" }, [
      el("div", { style: "font-size:24px;" }, [comp.icon]),
      el("div", { style: "flex:1;" }, [el("div", { style: "font-weight:800; font-size:15px;" }, [comp.label]), weak ? el("span", { class: "badge badge-warn" }, ["⚠️ Дефицит — приоритет"]) : null]),
      el("div", { class: "mono", style: `font-size:19px; font-weight:700; color:${weak ? "var(--magenta-ink)" : "var(--purple-ink)"};` }, [p.score ? p.score + "/5" : "—"]),
    ]));
    const tipsBtn = el("button", { class: "btn btn-ghost btn-sm", style: "margin-bottom:12px;" }, ["💡 Советы Минпросвещения по этому направлению"]);
    const tipsBox = el("div", { style: "display:none; font-size:12.5px; color:var(--ink-soft); background:var(--bg-alt); padding:10px 14px; border-radius:12px; margin-bottom:12px; white-space:pre-line;" });
    tipsBtn.addEventListener("click", async () => {
      if (tipsBox.style.display === "block") { tipsBox.style.display = "none"; return; }
      tipsBox.style.display = "block"; tipsBox.textContent = "Загружаю…";
      const t = await API.getTips(p.competency);
      tipsBox.textContent = t.text;
    });
    card.appendChild(tipsBtn);
    card.appendChild(tipsBox);
    if (!p.events || !p.events.length) {
      card.appendChild(el("p", { style: "font-size:13px; color:var(--ink-faint);" }, ["Мероприятий по этому направлению в регионе не найдено."]));
    } else {
      p.events.forEach(ev => {
        const row = el("div", { style: "padding:10px 0; border-bottom:1px solid var(--border);" }, [
          el("div", { style: "font-weight:700; font-size:13.5px;" }, [ev.title]),
          el("div", { style: "font-size:12px; color:var(--ink-faint); margin:3px 0;" }, [[ev.date, ev.source].filter(Boolean).join(" · ")]),
          ev.description ? el("div", { style: "font-size:12.5px; color:var(--ink-soft);" }, [ev.description]) : null,
        ]);
        if (ev.url) { const a = el("a", { href: ev.url, target: "_blank", rel: "noopener", style: "font-size:12px; color:var(--purple-ink); font-weight:700;" }, ["Открыть источник →"]); row.appendChild(a); }
        const takeAttrs = { class: "btn btn-ghost btn-sm", style: "margin-top:6px;" };
        if (!canAct) takeAttrs.disabled = "disabled";
        const takeBtn = el("button", takeAttrs, [canAct ? "📌 Взять в работу и отчитаться" : "Ожидает утверждения"]);
        if (canAct) takeBtn.addEventListener("click", () => openProgressReportModal(p.competency, ev));
        row.appendChild(takeBtn);
        card.appendChild(row);
      });
    }
    return card;
  }

  // Наставляемый берёт мероприятие в работу и сразу может написать отчёт (или сохранить как "в работе" и вернуться позже).
  async function openQuizModal(ev) {
    const backdrop = el("div", { class: "modal-backdrop" });
    const modal = el("div", { class: "modal quiz-modal" }, [
      el("div", { class: "quiz-loading" }, [
        el("span", { class: "quiz-kicker" }, ["ПРОВЕРКА РЕЗУЛЬТАТА"]),
        el("h3", {}, ["Загрузка теста"]),
        el("p", {}, ["Подбираем вопросы по материалам мероприятия"]),
      ]),
      el("div", { class: "typing-dots" }, [el("span"), el("span"), el("span")]),
    ]);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);

    let data;
    try { data = await API.getQuiz(ev.id); } catch (e) { modal.querySelector(".typing-dots").replaceWith(el("p", {}, ["Не удалось загрузить тест."])); return; }

    const questions = data.questions || [];
    const answers = Array(questions.length).fill(-1);
    let current = 0;

    function renderQuestion() {
      modal.innerHTML = "";
      const header = el("div", { class: "quiz-header" }, [
        el("div", {}, [el("span", { class: "quiz-kicker" }, ["ПРОВЕРКА РЕЗУЛЬТАТА"]), el("h3", {}, [ev.title]), el("p", { class: "quiz-subtitle" }, ["Ответьте на вопросы и закрепите главное из мероприятия."])]),
        el("button", { class: "icon-btn quiz-close", type: "button", title: "Закрыть тест" }, ["×"]),
      ]);
      header.querySelector(".quiz-close").addEventListener("click", () => backdrop.remove());
      modal.appendChild(header);
      const progress = el("div", { class: "quiz-progress" }, [
        el("div", { class: "quiz-progress-meta" }, [el("span", {}, [`Вопрос ${current + 1} из ${questions.length}`]), el("b", {}, [`${Math.round(((current + 1) / questions.length) * 100)}%`])]),
        el("div", { class: "quiz-progress-track" }, [el("div", { style: `width:${((current + 1) / questions.length) * 100}%;` })]),
      ]);
      modal.appendChild(progress);

      const layout = el("div", { class: "quiz-layout" });
      const rail = el("aside", { class: "quiz-rail" }, [el("span", {}, ["Ваши ответы"])]);
      questions.forEach((q, index) => {
        const item = el("button", { class: "quiz-rail-item" + (index === current ? " active" : "") + (answers[index] >= 0 ? " answered" : ""), type: "button", title: `Вопрос ${index + 1}` }, [String(index + 1)]);
        item.addEventListener("click", () => { current = index; renderQuestion(); });
        rail.appendChild(item);
      });
      layout.appendChild(rail);
      const q = questions[current];
      const panel = el("main", { class: "quiz-question" }, [
        el("span", { class: "quiz-question-label" }, ["ВОПРОС " + String(current + 1).padStart(2, "0")]),
        el("h4", {}, [q.q]),
        el("p", { class: "quiz-hint" }, ["Выберите один вариант ответа"]),
      ]);
      const options = el("div", { class: "quiz-options" });
      (q.options || []).forEach((option, index) => {
        const choice = el("button", { class: "quiz-option" + (answers[current] === index ? " selected" : ""), type: "button" }, [
          el("span", { class: "quiz-option-letter" }, [String.fromCharCode(65 + index)]),
          el("span", { class: "quiz-option-text" }, [option]),
          el("span", { class: "quiz-option-check" }, [answers[current] === index ? "✓" : ""]),
        ]);
        choice.addEventListener("click", () => { answers[current] = index; renderQuestion(); });
        options.appendChild(choice);
      });
      panel.appendChild(options);
      const footer = el("div", { class: "quiz-footer" });
      const previousAttrs = { class: "btn btn-ghost", type: "button" };
      if (current === 0) previousAttrs.disabled = "disabled";
      const previous = el("button", previousAttrs, ["← Назад"]);
      if (current > 0) previous.addEventListener("click", () => { current -= 1; renderQuestion(); });
      const next = current === questions.length - 1
        ? el("button", { class: "btn btn-primary", type: "button" }, ["Завершить тест"])
        : el("button", { class: "btn btn-primary", type: "button" }, ["Следующий вопрос →"]);
      next.addEventListener("click", async () => {
        if (answers[current] < 0) { toast("Выберите вариант ответа", true); return; }
        if (current < questions.length - 1) { current += 1; renderQuestion(); return; }
        next.disabled = true; next.textContent = "Проверяем…";
        try { renderQuizResult(await API.submitQuiz(ev.id, answers)); } catch (e) { apiErr(e); next.disabled = false; next.textContent = "Повторить"; }
      });
      footer.appendChild(previous); footer.appendChild(next); panel.appendChild(footer);
      layout.appendChild(panel); modal.appendChild(layout);
    }

    function renderQuizResult(result) {
      modal.innerHTML = "";
      const percent = result.total ? Math.round((result.score / result.total) * 100) : 0;
      const close = el("button", { class: "icon-btn quiz-close", type: "button", title: "Закрыть результат" }, ["×"]);
      close.addEventListener("click", () => backdrop.remove());
      modal.appendChild(el("div", { class: "quiz-result-head" }, [close, el("span", { class: "quiz-kicker" }, ["ТЕСТ ЗАВЕРШЁН"]), el("h3", {}, [percent >= 70 ? "Отличный результат" : "Есть что закрепить"]), el("p", {}, [`${result.score} из ${result.total} правильных ответов`]), el("div", { class: "quiz-score" }, [el("b", {}, [String(percent)]), el("span", {}, ["%"])]), el("p", { class: "quiz-result-note" }, [percent >= 70 ? "Вы хорошо усвоили ключевые идеи мероприятия." : "Вернитесь к материалам мероприятия и обсудите сложные вопросы с наставником."])]));
      const details = el("div", { class: "quiz-result-list" });
      result.details.forEach((detail) => details.appendChild(el("div", { class: "quiz-result-item " + (detail.yourAnswer === detail.correctIndex ? "correct" : "wrong") }, [el("span", { class: "quiz-result-mark" }, [detail.yourAnswer === detail.correctIndex ? "✓" : "!" ]), el("div", {}, [el("b", {}, [detail.q]), el("p", {}, [detail.explain])])] )));
      modal.appendChild(details);
      const done = el("button", { class: "btn btn-primary quiz-result-close", type: "button" }, ["Вернуться к мероприятиям"]);
      done.addEventListener("click", () => backdrop.remove()); modal.appendChild(done);
    }

    if (!questions.length) { modal.innerHTML = ""; modal.appendChild(el("p", {}, ["Вопросы для этого мероприятия пока недоступны."])); return; }
    renderQuestion();
  }

  async function openProgressReportModal(competencyId, ev) {
    const backdrop = el("div", { class: "modal-backdrop" });
    const modal = el("div", { class: "modal" }, [
      el("h3", { style: "margin-bottom:4px;" }, ["📌 " + ev.title]),
      el("p", { style: "font-size:12.5px; color:var(--ink-faint); margin-bottom:14px;" }, ["Отчёт увидит ваш наставник и сможет оценить его."]),
    ]);
    const report = document.createElement("textarea");
    report.placeholder = "Что узнали нового? Что будете использовать в работе? (можно оставить пустым и заполнить позже)";
    report.style.cssText = "width:100%; min-height:90px; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); font-family:var(--font-body); margin-bottom:10px;";
    modal.appendChild(report);
    const reviewBtn = el("button", { class: "btn btn-ghost btn-sm", style: "margin-bottom:10px;" }, ["🤖 Проверить отчёт с ИИ"]);
    const reviewOut = el("p", { style: "font-size:12.5px; color:var(--purple-ink); margin-bottom:10px; display:none;" });
    reviewBtn.addEventListener("click", async () => {
      if (!report.value.trim()) { toast("Сначала напишите черновик отчёта"); return; }
      reviewBtn.disabled = true; reviewBtn.textContent = "Проверяю…";
      const { feedback } = await API.reviewReport(report.value.trim());
      reviewOut.textContent = "💡 " + feedback;
      reviewOut.style.display = "block";
      reviewBtn.disabled = false; reviewBtn.textContent = "🤖 Проверить отчёт с ИИ";
    });
    modal.appendChild(reviewBtn);
    modal.appendChild(reviewOut);
    modal.appendChild(el("label", { style: "font-size:12.5px; color:var(--ink-soft);" }, ["Оцените полезность (1-5)"]));
    const rating = document.createElement("select");
    [1, 2, 3, 4, 5].forEach(v => rating.appendChild(new Option(String(v), v, v === 5, v === 5)));
    rating.style.cssText = "padding:8px 12px; border-radius:10px; border:1.5px solid var(--border); margin:6px 0 14px; display:block;";
    modal.appendChild(rating);
    const row = el("div", { style: "display:flex; gap:10px; justify-content:flex-end;" });
    const cancel = el("button", { class: "btn btn-ghost btn-sm" }, ["Отмена"]);
    const save = el("button", { class: "btn btn-primary btn-sm" }, ["Сохранить"]);
    cancel.addEventListener("click", () => backdrop.remove());
    save.addEventListener("click", async () => {
      const item = await API.addProgress({ competencyId, eventTitle: ev.title, eventUrl: ev.url, weight: 1 });
      if (report.value.trim()) await API.reportProgress(item.id, report.value.trim(), parseInt(rating.value, 10));
      backdrop.remove();
      toast("Сохранено — наставник увидит отчёт");
    });
    row.appendChild(cancel); row.appendChild(save);
    modal.appendChild(row);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  function emptyState(emoji, title, desc, btnLabel, onClick) {
    const es = el("div", { class: "card empty-state" }, [el("div", { class: "emoji" }, [emoji]), el("h3", {}, [title]), el("p", {}, [desc])]);
    if (btnLabel) { const btn = el("button", { class: "btn btn-primary" }, [btnLabel]); btn.addEventListener("click", onClick); es.appendChild(btn); }
    return es;
  }

  /* =========================== EVENTS =========================== */
  let eventFilter = "all";
  let eventSearch = "";
  let eventType = "all";
  let eventRegion = "all";
  let eventStatus = "all";
  let eventSearchTimer = null;
  async function renderEvents(main, user) {
    const isAdmin = user.role === "admin";
    const actions = [];
    if (isAdmin) actions.push(addBtn("+ Добавить", () => openEventModal(null)));
    if (user.role === "user" && API.hasScores(user)) {
      const webSearch = el("button", { class: "btn btn-primary btn-sm" }, [appIcon("search", 18), "Найти в интернете"]);
      webSearch.addEventListener("click", async () => {
        webSearch.disabled = true;
        webSearch.replaceChildren(appIcon("search", 18), document.createTextNode("Ищу мероприятия..."));
        try {
          const roadmap = await API.generateRoadmap(user.region);
          const proposal = roadmap.proposal || roadmap;
          const found = (proposal.priorities || []).reduce((sum, priority) => sum + (priority.events || []).length, 0);
          toast(user.mentorId ? `Найдено ${found}. Предложение отправлено наставнику.` : `Найдено ${found}. Выберите наставника для согласования.`);
          await renderMain();
        } catch (error) { apiErr(error); webSearch.disabled = false; webSearch.replaceChildren(appIcon("search", 18), document.createTextNode("Найти в интернете")); }
      });
      actions.push(webSearch);
    }
    topbar(main, "Мероприятия", "Каталог и интернет-подборка с обязательной проверкой наставника", actions.length ? actions : null);

    if (user.role === "user") {
      const roadmap = await API.getRoadmap().catch(() => null);
      const proposal = roadmap?.proposal || (roadmap?.status && roadmap.status !== "approved" ? roadmap : null);
      const proposedEvents = (proposal?.priorities || []).flatMap((priority) => (priority.events || []).map((event) => ({ ...event, competency: priority.competency })));
      if (proposal && proposedEvents.length && (proposal.mode === "live" || proposal.searchStatus?.provider?.includes("web") || proposal.searchStatus?.provider === "ai-search")) {
        const review = el("section", { class: "web-event-review" }, [
          el("div", { class: "web-event-review-head" }, [
            el("div", {}, [el("span", { class: "eyebrow" }, ["ИНТЕРНЕТ-ПОИСК"]), el("h3", {}, ["Найдено и отправлено наставнику"]), el("p", {}, ["До подтверждения эти мероприятия не попадут в общий каталог и рабочую дорожную карту."])]),
            el("span", { class: "badge badge-yellow" }, [`На согласовании · ${proposedEvents.length}`]),
          ]),
        ]);
        proposedEvents.slice(0, 8).forEach((event) => {
          const comp = API.competency(event.competency);
          const row = el("div", { class: "web-event-row" }, [
            el("div", {}, [el("b", {}, [event.title]), el("span", {}, [`${comp?.label || "Компетенция"}${event.source ? " · " + event.source : ""}`])]),
          ]);
          if (event.url) row.appendChild(el("a", { href: event.url, target: "_blank", rel: "noopener", class: "text-link" }, ["Проверить источник"]));
          review.appendChild(row);
        });
        main.appendChild(review);
      }
    }

    const searchWrap = el("form", { class: "event-search" });
    const searchField = el("label", { class: "event-search-field" }, [appIcon("search", 19)]);
    const searchInput = el("input", { type: "search", value: eventSearch, placeholder: "Поиск по названию, описанию, источнику или региону", "aria-label": "Поиск мероприятий" });
    searchField.appendChild(searchInput);
    const searchBtn = el("button", { class: "btn btn-primary btn-sm", type: "submit" }, [appIcon("search", 18), "Найти"]);
    const clearBtn = el("button", { class: "btn btn-secondary btn-sm", type: "button", title: "Сбросить все фильтры" }, ["Сбросить"]);
    searchWrap.appendChild(searchField); searchWrap.appendChild(searchBtn); searchWrap.appendChild(clearBtn);
    searchWrap.addEventListener("submit", (e) => { e.preventDefault(); eventSearch = searchInput.value.trim(); renderMain(); });
    searchInput.addEventListener("input", () => {
      clearTimeout(eventSearchTimer);
      eventSearchTimer = setTimeout(() => { eventSearch = searchInput.value.trim(); renderMain(); }, 350);
    });
    clearBtn.addEventListener("click", () => { eventSearch = ""; eventFilter = "all"; eventType = "all"; eventRegion = "all"; eventStatus = "all"; renderMain(); });
    main.appendChild(searchWrap);

    const filterBar = el("div", { class: "event-filter-bar" });
    const typeSelect = el("select", { "aria-label": "Формат мероприятия" }, [new Option("Любой формат", "all"), new Option("Онлайн", "online"), new Option("Очно", "offline")]);
    const regionSelect = el("select", { "aria-label": "Регион мероприятия" }, [new Option("Все регионы", "all"), new Option(`Мой регион: ${user.region || "не указан"}`, "mine")]);
    const statusSelect = el("select", { "aria-label": "Статус прохождения" }, [new Option("Любой статус", "all"), new Option("Не пройдено", "open"), new Option("Пройдено", "completed")]);
    typeSelect.value = eventType; regionSelect.value = eventRegion; statusSelect.value = eventStatus;
    [[typeSelect, (value) => { eventType = value; }], [regionSelect, (value) => { eventRegion = value; }], [statusSelect, (value) => { eventStatus = value; }]].forEach(([select, assign]) => {
      select.addEventListener("change", () => { assign(select.value); renderMain(); });
      filterBar.appendChild(select);
    });
    main.appendChild(filterBar);

    const filters = ["all", ...API.COMPETENCIES.map(c => c.id)];
    const chipRow = el("div", { class: "chip-row", style: "margin-bottom:18px;" });
    filters.forEach(f => {
      const comp = f === "all" ? null : API.competency(f);
      const chip = el("button", { class: "chip" + (eventFilter === f ? " active" : "") }, [f === "all" ? "Все" : comp.icon + " " + comp.short]);
      chip.addEventListener("click", () => { eventFilter = f; renderMain(); });
      chipRow.appendChild(chip);
    });
    main.appendChild(chipRow);

    const list = await API.listEvents(eventFilter, eventSearch, { type: eventType, region: eventRegion === "mine" ? user.region : "", status: eventStatus });
    main.appendChild(el("div", { class: "event-results-meta", "aria-live": "polite" }, [
      list.length ? `Найдено: ${list.length}` : "По вашему запросу результатов нет",
    ]));
    if (!list.length) { main.appendChild(emptyState("📅", "Ничего не найдено", "Измените запрос или выберите другую компетенцию.")); return; }
    list.forEach(e => main.appendChild(eventCard(e, user)));
  }

  function addBtn(label, onClick) { const b = el("button", { class: "btn btn-primary btn-sm" }, [label]); b.addEventListener("click", onClick); return b; }

  function eventCard(e, user) {
    const comp = API.competency(e.area);
    const parts = (e.date || "").split(" ");
    const card = el("div", { class: "card event-card" });
    card.appendChild(el("div", { class: "event-date" }, [el("div", { class: "d" }, [parts[0] || "?"]), el("div", { class: "m" }, [parts[1] || ""])]));
    const body = el("div", { class: "event-body" }, [
      el("h4", {}, [e.title]),
      el("p", { class: "desc" }, [e.description]),
      el("div", { class: "event-meta" }, [
        el("span", { class: "badge badge-" + comp.color }, [comp.icon + " " + comp.label]),
        el("span", { class: "badge badge-purple" }, [e.type === "online" ? "🌐 Онлайн" : "📍 Очно"]),
        el("span", {}, [e.time || ""]),
        e.completed ? el("span", { class: "badge badge-green" }, ["✓ Пройдено"]) : null,
      ]),
    ]);
    if (e.url) body.appendChild(el("a", { href: e.url, target: "_blank", rel: "noopener", style: "font-size:12px; color:var(--purple-ink); font-weight:700; display:inline-block; margin-top:6px;" }, ["Открыть →"]));
    card.appendChild(body);
    const actions = el("div", { class: "event-actions" });
    if (user.role === "user" || user.role === "mentor") {
      const btn = el("button", { class: "btn " + (e.completed ? "btn-secondary" : "btn-primary") + " btn-sm" }, [e.completed ? "Отменить" : "Отметить пройденным"]);
      btn.addEventListener("click", async () => {
        if (!e.completed) openReflectionModal(e);
        else { await API.completeEvent(e.id, false, ""); renderMain(); }
      });
      actions.appendChild(btn);
      if (e.completed) {
        const quizBtn = el("button", { class: "btn btn-primary btn-sm", style: "margin-left:8px;" }, ["🧠 Пройти тест"]);
        quizBtn.addEventListener("click", () => openQuizModal(e));
        actions.appendChild(quizBtn);
      }
    }
    if (user.role === "admin") {
      const editBtn = el("button", { class: "btn btn-secondary btn-sm" }, ["✏️"]);
      editBtn.addEventListener("click", () => openEventModal(e));
      const delBtn = el("button", { class: "btn btn-danger btn-sm", style: "margin-left:8px;" }, ["🗑️"]);
      delBtn.addEventListener("click", async () => { if (confirm("Удалить мероприятие?")) { await API.deleteEvent(e.id); renderMain(); } });
      actions.appendChild(editBtn); actions.appendChild(delBtn);
    }
    card.appendChild(actions);
    return card;
  }

  function openReflectionModal(e) {
    const backdrop = el("div", { class: "modal-backdrop" });
    const card = el("div", { class: "modal-card" }, [
      el("h3", {}, ["Отметить как пройденное"]),
      el("p", { style: "font-size:13.5px; color:var(--ink-soft); margin-bottom:14px;" }, [e.title]),
      el("div", { class: "field" }, [el("label", {}, ["Короткая рефлексия (необязательно)"]), el("textarea", { id: "reflInput", rows: "3" })]),
    ]);
    const btns = el("div", { style: "display:flex; gap:10px; margin-top:6px;" });
    const cancel = el("button", { class: "btn btn-secondary btn-block" }, ["Отмена"]);
    const save = el("button", { class: "btn btn-primary btn-block" }, ["Сохранить"]);
    cancel.addEventListener("click", () => backdrop.remove());
    save.addEventListener("click", async () => { await API.completeEvent(e.id, true, $("#reflInput").value.trim()); backdrop.remove(); renderMain(); toast("Мероприятие отмечено пройденным"); });
    btns.appendChild(cancel); btns.appendChild(save);
    card.appendChild(btns);
    backdrop.appendChild(card);
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  function openEventModal(existing) {
    const backdrop = el("div", { class: "modal-backdrop" });
    const card = el("div", { class: "modal-card" });
    card.appendChild(el("h3", {}, [existing ? "Редактировать мероприятие" : "Новое мероприятие"]));
    const title = fieldInput("Название", existing?.title || "");
    const desc = fieldInput("Описание", existing?.description || "", "textarea");
    const date = fieldInput("Дата (например «12 октября»)", existing?.date || "");
    const time = fieldInput("Время", existing?.time || "18:00");
    const region = fieldInput("Регион (или «Все регионы»)", existing?.region || "Все регионы");
    const url = fieldInput("Ссылка (необязательно)", existing?.url || "");
    const typeSel = fieldSelect("Формат", [["online", "Онлайн"], ["offline", "Очно"]], existing?.type || "online");
    const areaSel = fieldSelect("Направление", API.COMPETENCIES.map(c => [c.id, c.icon + " " + c.label]), existing?.area || "subject");
    [title, desc, date, time, region, url, typeSel, areaSel].forEach(f => card.appendChild(f.wrap));
    const btns = el("div", { style: "display:flex; gap:10px; margin-top:10px;" });
    const cancel = el("button", { class: "btn btn-secondary btn-block" }, ["Отмена"]);
    const save = el("button", { class: "btn btn-primary btn-block" }, ["Сохранить"]);
    cancel.addEventListener("click", () => backdrop.remove());
    save.addEventListener("click", async () => {
      const payload = { title: title.input.value.trim(), description: desc.input.value.trim(), date: date.input.value.trim(), time: time.input.value.trim(), region: region.input.value.trim(), url: url.input.value.trim(), type: typeSel.input.value, area: areaSel.input.value };
      if (!payload.title || !payload.date) { toast("Заполните название и дату", true); return; }
      try {
        if (existing) await API.updateEvent(existing.id, payload); else await API.createEvent(payload);
        backdrop.remove(); renderMain(); toast(existing ? "Мероприятие обновлено" : "Мероприятие добавлено");
      } catch (e) { apiErr(e); }
    });
    btns.appendChild(cancel); btns.appendChild(save);
    card.appendChild(btns);
    backdrop.appendChild(card);
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  function fieldInput(label, value, tag) {
    const wrap = el("div", { class: "field" }, [el("label", {}, [label])]);
    const input = document.createElement(tag === "textarea" ? "textarea" : "input");
    if (tag !== "textarea") input.type = "text";
    input.value = value || "";
    if (tag === "textarea") input.rows = 3;
    wrap.appendChild(input);
    return { wrap, input };
  }
  function fieldSelect(label, options, value) {
    const wrap = el("div", { class: "field" }, [el("label", {}, [label])]);
    const input = document.createElement("select");
    options.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; if (v === value) o.selected = true; input.appendChild(o); });
    wrap.appendChild(input);
    return { wrap, input };
  }

  /* =========================== NOTES =========================== */
  async function renderNotes(main, user) {
    topbar(main, "📝 Заметки", "Личные записи, рефлексия, наблюдения", [addBtn("+ Новая заметка", () => openNoteModal(null))]);
    const notes = await API.listNotes();
    if (!notes.length) { main.appendChild(emptyState("📝", "Заметок пока нет", "Записывайте мысли после уроков и мероприятий.")); return; }
    const grid = el("div", { class: "grid-2" });
    notes.forEach(n => {
      const catColor = { "Личное": "purple", "Урок": "green", "Наставничество": "magenta", "Мероприятие": "yellow", "Рефлексия": "purple", "Администрирование": "magenta" }[n.category] || "purple";
      const card = el("div", { class: "card note-card" }, [
        el("h4", {}, [n.title]), el("p", {}, [n.content]),
        el("div", { class: "note-meta" }, [el("span", { class: "badge badge-" + catColor }, [n.category]), el("span", { style: "font-size:11.5px; color:var(--ink-faint);" }, [new Date(n.updatedAt).toLocaleDateString("ru-RU")])]),
      ]);
      card.addEventListener("click", () => openNoteModal(n));
      grid.appendChild(card);
    });
    main.appendChild(grid);
  }

  function openNoteModal(existing) {
    const backdrop = el("div", { class: "modal-backdrop" });
    const card = el("div", { class: "modal-card" });
    card.appendChild(el("h3", {}, [existing ? "Редактировать заметку" : "Новая заметка"]));
    const title = fieldInput("Заголовок", existing?.title || "");
    const cat = fieldSelect("Категория", API.NOTE_CATS.map(c => [c, c]), existing?.category || "Личное");
    const content = fieldInput("Текст", existing?.content || "", "textarea");
    content.input.rows = 5;
    [title, cat, content].forEach(f => card.appendChild(f.wrap));
    const btns = el("div", { style: "display:flex; gap:10px; margin-top:10px;" });
    const cancel = el("button", { class: "btn btn-secondary btn-block" }, ["Отмена"]);
    const save = el("button", { class: "btn btn-primary btn-block" }, ["Сохранить"]);
    cancel.addEventListener("click", () => backdrop.remove());
    save.addEventListener("click", async () => {
      const payload = { title: title.input.value.trim(), category: cat.input.value, content: content.input.value.trim() };
      if (!payload.title) { toast("Введите заголовок", true); return; }
      try {
        if (existing) await API.updateNote(existing.id, payload); else await API.createNote(payload);
        backdrop.remove(); renderMain(); toast("Заметка сохранена");
      } catch (e) { apiErr(e); }
    });
    btns.appendChild(cancel); btns.appendChild(save);
    card.appendChild(btns);
    if (existing) {
      const del = el("button", { class: "btn btn-danger btn-block", style: "margin-top:8px;" }, ["Удалить заметку"]);
      del.addEventListener("click", async () => { await API.deleteNote(existing.id); backdrop.remove(); renderMain(); });
      card.appendChild(del);
    }
    backdrop.appendChild(card);
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  /* =========================== MENTOR (for user role) =========================== */
  async function renderMentorView(main, user) {
    topbar(main, "🤝 Мой наставник");
    const mentor = user.mentorId ? await API.getUser(user.mentorId).catch(() => null) : null;

    if (mentor && user.mentorStatus === "pending") {
      main.appendChild(el("div", { class: "card", style: "border-color:var(--yellow-pastel-2);" }, [
        el("div", { style: "display:flex; gap:14px; align-items:center;" }, [avatarNode(mentor, "lg"), el("div", {}, [
          el("h3", { style: "font-size:18px;" }, [mentor.fullName]),
          el("p", { style: "color:var(--ink-soft); font-size:13.5px;" }, ["⏳ Заявка отправлена — ждём подтверждения наставника."]),
        ])]),
      ]));
      return;
    }

    if (!mentor) {
      main.appendChild(emptyState("🤝", "Наставник ещё не назначен", "Выберите наставника из списка ниже — он должен подтвердить пару."));
      const mentors = await API.listUsers("mentor");
      const list = el("div", { class: "grid-2", style: "margin-top:16px;" });
      mentors.forEach(m => {
        const card = el("div", { class: "card" }, [el("div", { style: "display:flex; gap:12px; align-items:center; margin-bottom:10px;" }, [avatarNode(m), el("div", {}, [el("b", {}, [m.fullName]), el("div", { style: "font-size:12px; color:var(--ink-faint);" }, [m.subject + " · стаж " + m.yearsExperience + " лет"])])])]);
        const btn = el("button", { class: "btn btn-primary btn-sm" }, ["Отправить заявку"]);
        btn.addEventListener("click", async () => { const u = await API.requestMentor(m.id); Object.assign(user, u); renderMain(); toast("Заявка отправлена наставнику"); });
        card.appendChild(btn);
        list.appendChild(card);
      });
      main.appendChild(list);
      return;
    }
    main.appendChild(el("div", { class: "card" }, [el("div", { style: "display:flex; gap:14px; align-items:center;" }, [avatarNode(mentor, "lg"), el("div", {}, [el("h3", { style: "font-size:18px;" }, [mentor.fullName]), el("p", { style: "color:var(--ink-soft); font-size:13.5px;" }, [`${mentor.subject} · стаж ${mentor.yearsExperience} лет`])])])]));
    main.appendChild(await chatCard(mentor));
  }

  async function chatCard(otherUser) {
    const card = el("div", { class: "card", style: "margin-top:16px; padding:0; overflow:hidden;" });
    const head = el("div", { class: "chat-peer-head" }, [
      el("div", {}, [el("div", { class: "card-title" }, ["💬 Чат с " + otherUser.fullName.split(" ")[0]]), el("div", { class: "chat-live-status" }, ["● Обновляется автоматически"])]),
    ]);
    const video = el("button", { class: "btn btn-secondary btn-sm", title: "Начать видеовстречу" }, ["🎥 Видеовстреча"]);
    video.addEventListener("click", () => {
      const backdrop = el("div", { class: "modal-backdrop" });
      const dialog = el("div", { class: "modal-card video-provider-dialog" }, [
        el("div", { class: "video-dialog-icon" }, ["🎥"]),
        el("h3", {}, ["Начать видеовстречу"]),
        el("p", { class: "muted" }, ["Основной вариант работает в России. Резервный канал создаёт готовую общую комнату автоматически."]),
      ]);
      const options = el("div", { class: "video-options" });
      const telemost = el("button", { class: "video-option primary" }, [
        el("b", {}, ["Яндекс Телемост"]),
        el("span", {}, ["Откроется сервис Яндекса. Создайте встречу и отправьте полученную ссылку в чат."]),
        el("small", {}, ["Основной · доступен в РФ"]),
      ]);
      const jitsi = el("button", { class: "video-option" }, [
        el("b", {}, ["Резервная комната"]),
        el("span", {}, ["Ссылка появится в чате автоматически. Используется Jitsi Meet."]),
        el("small", {}, ["Без регистрации"]),
      ]);
      const launch = async (provider) => {
        const callWindow = window.open("about:blank", "_blank");
        try {
          const data = await API.startVideoCall(otherUser.id, provider);
          if (callWindow) callWindow.location.href = data.launchUrl; else window.open(data.launchUrl, "_blank", "noopener");
          backdrop.remove();
          if (provider === "telemost") {
            input.value = "Ссылка на встречу: ";
            input.focus();
            toast("Вставьте ссылку Телемоста в сообщение и отправьте её");
          } else {
            renderMessages(await API.listMessages(otherUser.id));
            toast("Ссылка на резервную комнату отправлена в чат");
          }
        } catch (e) { if (callWindow) callWindow.close(); apiErr(e); }
      };
      telemost.addEventListener("click", () => launch("telemost"));
      jitsi.addEventListener("click", () => launch("jitsi"));
      options.appendChild(telemost); options.appendChild(jitsi); dialog.appendChild(options);
      const cancel = el("button", { class: "btn btn-ghost btn-block" }, ["Отмена"]);
      cancel.addEventListener("click", () => backdrop.remove()); dialog.appendChild(cancel);
      backdrop.appendChild(dialog); backdrop.addEventListener("click", (event) => { if (event.target === backdrop) backdrop.remove(); });
      document.body.appendChild(backdrop);
    });
    head.appendChild(video);
    card.appendChild(head);
    const scroll = el("div", { class: "peer-chat-scroll" });
    const myId = API.getCurUser().id;
    let latestMessageId = null;
    const renderMessages = (msgs) => {
      const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 70;
      scroll.innerHTML = "";
      if (!msgs.length) scroll.appendChild(el("p", { class: "chat-empty" }, ["Сообщений пока нет — начните разговор."]));
      msgs.forEach(m => {
        const mine = m.from === myId;
        const bubble = el("div", { class: "msg-bubble" }, [m.text]);
        if (m.attachment) {
          const fileBtn = el("button", { class: "message-file", title: "Скачать файл" }, [
            el("span", { class: "message-file-icon" }, ["📎"]),
            el("span", {}, [el("b", {}, [m.attachment.name]), el("small", {}, [formatFileSize(m.attachment.size)])]),
          ]);
          fileBtn.addEventListener("click", () => API.downloadFile(m.attachment.id, m.attachment.name).catch(apiErr));
          bubble.appendChild(fileBtn);
        }
        const time = new Date(m.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
        bubble.appendChild(el("span", { class: "message-time" }, [time + (mine && m.readAt ? " · прочитано" : "")]));
        scroll.appendChild(el("div", { class: "msg-row " + (mine ? "me" : "ai") }, [bubble]));
      });
      latestMessageId = msgs[msgs.length - 1]?.id || null;
      if (nearBottom || !scroll.dataset.ready) scroll.scrollTop = scroll.scrollHeight;
      scroll.dataset.ready = "1";
    };
    renderMessages(await API.listMessages(otherUser.id));
    card.appendChild(scroll);
    const composer = el("div", { class: "peer-chat-composer" });
    const selected = el("div", { class: "selected-file hidden" });
    const bar = el("div", { class: "peer-chat-bar" });
    const input = el("input", { type: "text", placeholder: "Написать сообщение…" });
    const fileInput = el("input", { type: "file", class: "hidden", accept: "image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt" });
    const attach = el("button", { class: "icon-btn", title: "Прикрепить файл", "aria-label": "Прикрепить файл" }, ["📎"]);
    const send = el("button", { class: "btn btn-primary btn-sm" }, ["Отправить"]);
    let attachment = null;
    attach.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { toast("Максимальный размер файла — 5 МБ", true); fileInput.value = ""; return; }
      try {
        const data = await readFileData(file);
        attachment = { name: file.name, type: file.type || "application/octet-stream", size: file.size, data };
        selected.textContent = `📎 ${file.name} · ${formatFileSize(file.size)} · нажмите, чтобы убрать`;
        selected.classList.remove("hidden");
      } catch (e) { apiErr(e); }
    });
    selected.addEventListener("click", () => { attachment = null; fileInput.value = ""; selected.classList.add("hidden"); });
    const doSend = async () => {
      const value = input.value.trim();
      if (!value && !attachment) return;
      send.disabled = true;
      try {
        await API.sendMessage(otherUser.id, value, attachment);
        input.value = ""; attachment = null; fileInput.value = ""; selected.classList.add("hidden");
        renderMessages(await API.listMessages(otherUser.id));
      } catch (e) { apiErr(e); }
      finally { send.disabled = false; input.focus(); }
    };
    send.addEventListener("click", doSend);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });
    bar.appendChild(attach); bar.appendChild(input); bar.appendChild(send); bar.appendChild(fileInput);
    composer.appendChild(selected); composer.appendChild(bar); card.appendChild(composer);
    setTimeout(() => { scroll.scrollTop = scroll.scrollHeight; }, 0);
    chatPollTimer = setInterval(async () => {
      if (document.hidden || !["mentor", "mentees"].includes(currentView)) return;
      try {
        const messages = await API.listMessages(otherUser.id);
        if ((messages[messages.length - 1]?.id || null) !== latestMessageId) renderMessages(messages);
      } catch (e) { /* transient polling errors stay quiet */ }
    }, 5000);
    return card;
  }

  function formatFileSize(bytes) {
    if (!bytes) return "0 Б";
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  }

  function readFileData(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
      reader.readAsDataURL(file);
    });
  }

  /* =========================== MENTEES (for mentor role) =========================== */
  async function renderMenteesView(main, user) {
    const mentees = await API.listUsers("user");
    if (currentSub) {
      const m = await API.getUser(currentSub).catch(() => null);
      if (m) return renderMenteeDetail(main, m);
    }
    topbar(main, "🎓 Мои педагоги", `${mentees.length} подопечных`);

    const reports = await API.menteeReports();
    const reviewSection = el("section", { class: "mentor-review-section" }, [
      el("div", { class: "section-inline-head" }, [el("div", {}, [el("h2", {}, ["Проверка отчётов"]), el("p", {}, [reports.length ? `${reports.length} отчёта ждут вашего решения` : "Очередь пуста · новые отчёты появятся после мероприятий"])])])
    ]);
    if (!reports.length) reviewSection.appendChild(el("div", { class: "review-empty" }, [el("span", {}, ["✓"]), el("div", {}, [el("b", {}, ["Все отчёты проверены"]), el("p", {}, ["Здесь можно поставить оценку, написать обратную связь или вернуть отчёт педагогу на доработку."])])]));
    reports.forEach(r => {
      const row = el("div", { class: "report-review-row" }, [
        el("div", { class: "report-review-head" }, [el("div", {}, [el("b", {}, [r.mentee_name]), el("span", {}, [r.event_title])]), el("span", { class: "report-status" }, ["На проверке"])]),
        el("p", { class: "report-review-text" }, [r.report_text || "Педагог не добавил текст отчёта."]),
        el("span", { class: "report-review-meta" }, ["Полезность по мнению педагога: " + (r.usefulness_rating || "—") + "/5"]),
      ]);
      const feedback = el("textarea", { class: "report-feedback", rows: "2", placeholder: "Обратная связь педагогу: что получилось и что улучшить" });
      const rateRow = el("div", { class: "report-review-actions" });
      const sel = document.createElement("select");
      [1, 2, 3, 4, 5].forEach(v => sel.appendChild(new Option(String(v), v, v === 5, v === 5)));
      const approve = el("button", { class: "btn btn-primary btn-sm" }, ["Принять отчёт"]);
      const revise = el("button", { class: "btn btn-ghost btn-sm" }, ["Вернуть на доработку"]);
      approve.addEventListener("click", async () => { try { await API.mentorRateProgress(r.id, parseInt(sel.value, 10), feedback.value.trim(), "approve"); toast("Отчёт принят"); await renderMain(); } catch (e) { apiErr(e); } });
      revise.addEventListener("click", async () => { try { await API.mentorRateProgress(r.id, parseInt(sel.value, 10), feedback.value.trim(), "revision"); toast("Отчёт возвращён педагогу"); await renderMain(); } catch (e) { apiErr(e); } });
      rateRow.appendChild(el("span", { class: "report-rate-label" }, ["Оценка"])); rateRow.appendChild(sel); rateRow.appendChild(approve); rateRow.appendChild(revise);
      row.appendChild(feedback); row.appendChild(rateRow); reviewSection.appendChild(row);
    });
    main.appendChild(reviewSection);

    if (!mentees.length) { main.appendChild(emptyState("🎓", "Пока нет подопечных", "Педагоги появятся здесь после подтверждения заявки на наставничество.")); return; }
    const grid = el("div", { class: "grid-2" });
    mentees.forEach(m => {
      const card = el("div", { class: "card", style: "cursor:pointer;" }, [el("div", { style: "display:flex; gap:12px; align-items:center; margin-bottom:12px;" }, [avatarNode(m), el("div", {}, [el("b", {}, [m.fullName]), el("div", { style: "font-size:12px; color:var(--ink-faint);" }, [m.subject + " · этап " + m.currentStage + "/6"])])])]);
      if (API.hasScores(m)) API.COMPETENCIES.forEach(c => card.appendChild(miniScoreRow(c, m.scores[c.id])));
      else card.appendChild(el("p", { style: "font-size:12.5px; color:var(--ink-faint);" }, ["Диагностика ещё не пройдена"]));
      card.addEventListener("click", () => go("mentees", m.id));
      grid.appendChild(card);
    });
    main.appendChild(grid);
  }

  async function renderMenteeDetail(main, m) {
    const back = el("button", { class: "btn btn-ghost btn-sm", style: "margin-bottom:12px;" }, ["← Все педагоги"]);
    back.addEventListener("click", () => go("mentees"));
    main.appendChild(back);
    topbar(main, m.fullName, `${m.subject} · стаж ${m.yearsExperience} лет · этап ${m.currentStage}/6 · ${m.region || "без региона"}`);
    if (API.hasScores(m)) {
      const card = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["📊 Компетенции"])]);
      API.COMPETENCIES.forEach(c => card.appendChild(miniScoreRow(c, m.scores[c.id])));
      main.appendChild(card);
    } else main.appendChild(emptyState("📊", "Диагностика ещё не пройдена", "Педагог пока не завершил обязательный стартовый диалог."));
    if (API.hasScores(m)) await renderMentorRoadmapEditor(main, m);
    main.appendChild(await chatCard(m));
  }

  async function renderMentorRoadmapEditor(main, mentee) {
    const workflow = await API.getMenteeRoadmap(mentee.id);
    const roadmap = workflow.draft || workflow.active;
    const section = el("section", { class: "mentor-roadmap" });
    const heading = el("div", { class: "mentor-roadmap-head" }, [
      el("div", {}, [el("div", { class: "eyebrow" }, ["СОВМЕСТНАЯ РАБОТА ИИ + НАСТАВНИК"]), el("h2", {}, ["План развития и дорожная карта"]), el("p", {}, ["ИИ собирает предложение из диагностики и прогресса. Вы проверяете содержание, редактируете шаги и публикуете рабочую версию."])])
    ]);
    const aiBtn = el("button", { class: "btn btn-secondary btn-sm" }, [roadmap ? "Запросить новую редакцию у ИИ" : "Создать проект с ИИ"]);
    aiBtn.addEventListener("click", async () => {
      aiBtn.disabled = true; aiBtn.textContent = "ИИ анализирует данные…";
      try { await API.reviseMenteeRoadmap(mentee.id); toast("Новая редакция готова к вашей проверке"); await renderMain(); }
      catch (e) { apiErr(e); aiBtn.disabled = false; aiBtn.textContent = "Повторить запрос"; }
    });
    heading.appendChild(aiBtn);
    section.appendChild(heading);
    if (!roadmap) {
      section.appendChild(el("div", { class: "roadmap-workflow pending" }, [el("div", { class: "workflow-mark" }, ["1"]), el("div", { class: "workflow-copy" }, [el("b", {}, ["Проект ещё не создан"]), el("span", {}, ["Запустите анализ ИИ, затем проверьте и утвердите результат."])])]));
      main.appendChild(section);
      return;
    }

    const status = workflow.draft ? (workflow.draft.status === "changes_requested" ? "Возвращён на доработку" : "Ожидает вашего решения") : `Опубликована версия ${workflow.active.version || 1}`;
    section.appendChild(el("div", { class: "roadmap-workflow " + (workflow.draft ? "pending" : "approved") }, [
      el("div", { class: "workflow-mark" }, [workflow.draft ? "AI" : "✓"]),
      el("div", { class: "workflow-copy" }, [el("b", {}, [status]), el("span", {}, [roadmap.changeReason || "Последняя редакция сохранена в системе."])])
    ]));

    const form = el("div", { class: "roadmap-editor" });
    const summaryLabel = el("label", { class: "editor-field wide" }, [el("span", {}, ["Обоснование и цель плана"])]);
    const summary = el("textarea", { rows: "4", placeholder: "Кратко зафиксируйте цели и логику маршрута" });
    summary.value = roadmap.summary || "";
    summaryLabel.appendChild(summary); form.appendChild(summaryLabel);

    const priorities = el("div", { class: "roadmap-priority-list" });
    (roadmap.priorities || []).forEach((priority) => priorities.appendChild(mentorPriorityEditor(priority)));
    form.appendChild(priorities);
    const addEventBar = el("div", { class: "add-event-bar" }, [el("span", {}, ["Добавить мероприятие в план"])]);
    const addCompetency = document.createElement("select");
    API.COMPETENCIES.forEach((comp) => addCompetency.appendChild(new Option(`${comp.icon} ${comp.label}`, comp.id)));
    const addEvent = el("button", { class: "btn btn-secondary btn-sm", type: "button" }, ["+ Добавить мероприятие"]);
    addEvent.addEventListener("click", () => {
      let block = $(`.roadmap-edit-block[data-competency="${addCompetency.value}"]`, priorities);
      if (!block) { block = mentorPriorityEditor({ competency: addCompetency.value, score: mentee.scores?.[addCompetency.value] || 0, events: [] }); priorities.appendChild(block); }
      const events = $(".roadmap-edit-events", block); events.appendChild(mentorEventEditor({})); events.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    addEventBar.appendChild(addCompetency); addEventBar.appendChild(addEvent); form.appendChild(addEventBar);

    const commentLabel = el("label", { class: "editor-field wide" }, [el("span", {}, ["Комментарий наставника педагогу и ИИ"])]);
    const comment = el("textarea", { rows: "3", placeholder: "Что принято, что изменить и на что обратить внимание" });
    comment.value = roadmap.mentorComment || "";
    commentLabel.appendChild(comment); form.appendChild(commentLabel);

    const actions = el("div", { class: "roadmap-editor-actions" });
    const save = el("button", { class: "btn btn-secondary" }, ["Сохранить черновик"]);
    const changes = el("button", { class: "btn btn-ghost" }, ["Вернуть на доработку"]);
    const approve = el("button", { class: "btn btn-primary" }, ["Утвердить и опубликовать"]);
    const payload = () => ({ summary: summary.value.trim(), mentorComment: comment.value.trim(), priorities: collectMentorPriorities(priorities, mentee.scores) });
    save.addEventListener("click", async () => { try { await API.saveMenteeRoadmap(mentee.id, payload()); toast("Черновик сохранён"); await renderMain(); } catch (e) { apiErr(e); } });
    changes.addEventListener("click", async () => { if (!comment.value.trim()) return toast("Добавьте комментарий для ИИ и педагога", true); try { await API.saveMenteeRoadmap(mentee.id, payload()); await API.requestMenteeRoadmapChanges(mentee.id, comment.value.trim()); toast("План возвращён на доработку"); await renderMain(); } catch (e) { apiErr(e); } });
    approve.addEventListener("click", async () => { try { await API.saveMenteeRoadmap(mentee.id, payload()); const approved = await API.approveMenteeRoadmap(mentee.id, comment.value.trim()); toast(`Версия ${approved.version} опубликована`); await renderMain(); } catch (e) { apiErr(e); } });
    actions.appendChild(save); actions.appendChild(changes); actions.appendChild(approve); form.appendChild(actions);
    section.appendChild(form);

    if (workflow.history?.length) {
      const history = el("div", { class: "roadmap-history" }, [el("b", {}, ["История решений"])]);
      workflow.history.slice(0, 5).forEach((item) => history.appendChild(el("span", {}, [`v${item.version} · ${formatDate(item.approvedAt)}${item.mentorComment ? " · " + item.mentorComment : ""}`])));
      section.appendChild(history);
    }
    main.appendChild(section);
  }

  function mentorPriorityEditor(priority) {
    const comp = API.competency(priority.competency) || { icon: "•", label: priority.competency };
    const block = el("div", { class: "roadmap-edit-block", "data-competency": priority.competency, "data-score": priority.score || 0 }, [
      el("div", { class: "roadmap-edit-title" }, [el("span", {}, [`${comp.icon} ${comp.label}`]), el("b", {}, [`${priority.score || "—"}/5`])])
    ]);
    const events = el("div", { class: "roadmap-edit-events" });
    (priority.events || []).forEach((event) => events.appendChild(mentorEventEditor(event)));
    const add = el("button", { class: "btn btn-ghost btn-sm", type: "button" }, ["+ Добавить шаг"]);
    add.addEventListener("click", () => events.appendChild(mentorEventEditor({})));
    block.appendChild(events); block.appendChild(add);
    return block;
  }

  function mentorEventEditor(event) {
    const row = el("div", { class: "roadmap-event-editor" });
    const fields = [
      ["title", "Название шага", event.title], ["date", "Дата / период", event.date],
      ["source", "Организация", event.source], ["url", "Ссылка", event.url], ["description", "Ожидаемый результат", event.description],
    ];
    fields.forEach(([name, placeholder, value]) => { const input = el("input", { name, placeholder }); input.value = value || ""; row.appendChild(input); });
    const controls = el("div", { class: "roadmap-event-controls" });
    const up = el("button", { class: "icon-btn", type: "button", title: "Переместить выше" }, ["↑"]);
    const down = el("button", { class: "icon-btn", type: "button", title: "Переместить ниже" }, ["↓"]);
    const remove = el("button", { class: "icon-btn danger", type: "button", title: "Удалить шаг" }, ["×"]);
    up.addEventListener("click", () => row.previousElementSibling && row.parentElement.insertBefore(row, row.previousElementSibling));
    down.addEventListener("click", () => row.nextElementSibling && row.parentElement.insertBefore(row.nextElementSibling, row));
    remove.addEventListener("click", () => row.remove());
    controls.appendChild(up); controls.appendChild(down); controls.appendChild(remove); row.appendChild(controls);
    return row;
  }

  function collectMentorPriorities(root, scores) {
    return $$(".roadmap-edit-block", root).map((block) => ({
      competency: block.dataset.competency,
      score: Number(block.dataset.score || scores?.[block.dataset.competency] || 0),
      events: $$(".roadmap-event-editor", block).map((row) => Object.fromEntries($$("input", row).map((input) => [input.name, input.value.trim()]))).filter((event) => event.title),
    }));
  }

  /* =========================== MENTOR: GROUPS =========================== */
  async function renderGroupsView(main, user) {
    if (currentSub) {
      const g = await API.getGroup(currentSub).catch(() => null);
      if (g) return renderGroupDetail(main, user, g);
    }
    const groups = await API.listGroups();
    topbar(main, "👨‍👩‍👧‍👦 Группы", `${groups.length} групп`, [
      (() => { const b = el("button", { class: "btn btn-primary btn-sm" }, ["+ Новая группа"]); b.addEventListener("click", () => openCreateGroupModal()); return b; })(),
    ]);
    if (!groups.length) { main.appendChild(emptyState("👨‍👩‍👧‍👦", "Групп пока нет", "Объедините подопечных в группу, чтобы выдавать им задания и тесты сразу всем.")); return; }
    const grid = el("div", { class: "grid-2" });
    groups.forEach(g => {
      const card = el("div", { class: "card", style: "cursor:pointer;" }, [
        el("b", {}, [g.name]),
        el("p", { style: "font-size:12.5px; color:var(--ink-faint); margin:6px 0;" }, [g.description || "Без описания"]),
        el("div", { class: "chip", style: "cursor:default;" }, [`${g.memberCount} педагогов`]),
      ]);
      card.addEventListener("click", () => go("groups", g.id));
      grid.appendChild(card);
    });
    main.appendChild(grid);
  }

  function openCreateGroupModal() {
    const backdrop = el("div", { class: "modal-backdrop" });
    const name = document.createElement("input");
    name.placeholder = "Название группы";
    name.style.cssText = "width:100%; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); margin-bottom:10px;";
    const desc = document.createElement("textarea");
    desc.placeholder = "Описание (необязательно)";
    desc.style.cssText = "width:100%; min-height:70px; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); margin-bottom:14px;";
    const modal = el("div", { class: "modal" }, [el("h3", { style: "margin-bottom:12px;" }, ["Новая группа"]), name, desc]);
    const row = el("div", { style: "display:flex; gap:10px; justify-content:flex-end;" });
    const cancel = el("button", { class: "btn btn-ghost btn-sm" }, ["Отмена"]);
    const save = el("button", { class: "btn btn-primary btn-sm" }, ["Создать"]);
    cancel.addEventListener("click", () => backdrop.remove());
    save.addEventListener("click", async () => {
      if (!name.value.trim()) { toast("Введите название"); return; }
      const g = await API.createGroup(name.value.trim(), desc.value.trim());
      backdrop.remove();
      go("groups", g.id);
    });
    row.appendChild(cancel); row.appendChild(save);
    modal.appendChild(row);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  async function renderGroupDetail(main, user, g) {
    topbar(main, "👨‍👩‍👧‍👦 " + g.group.name, g.group.description, [
      (() => { const b = el("button", { class: "btn btn-ghost btn-sm" }, ["← Назад"]); b.addEventListener("click", () => go("groups")); return b; })(),
    ]);
    const mentees = await API.listUsers("user");
    const memberIds = new Set(g.members.map(m => m.id));

    const card = el("div", { class: "card" }, [el("div", { class: "card-title" }, [`Участники (${g.members.length})`])]);
    if (!g.members.length) card.appendChild(el("p", { style: "font-size:13px; color:var(--ink-faint);" }, ["Пока никого нет — добавьте подопечных ниже."]));
    g.members.forEach(m => {
      const row = el("div", { style: "display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border);" }, [avatarNode(m, "sm"), el("div", { style: "flex:1; font-size:13.5px; font-weight:700;" }, [m.fullName])]);
      const rm = el("button", { class: "btn btn-ghost btn-sm" }, ["Убрать"]);
      rm.addEventListener("click", async () => { await API.removeGroupMember(g.group.id, m.id); renderMain(); });
      row.appendChild(rm);
      card.appendChild(row);
    });
    main.appendChild(card);

    const addable = mentees.filter(m => !memberIds.has(m.id));
    if (addable.length) {
      const addCard = el("div", { class: "card", style: "margin-top:14px;" }, [el("div", { class: "card-title" }, ["Добавить подопечного"])]);
      addable.forEach(m => {
        const row = el("div", { style: "display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border);" }, [avatarNode(m, "sm"), el("div", { style: "flex:1; font-size:13.5px;" }, [m.fullName])]);
        const add = el("button", { class: "btn btn-primary btn-sm" }, ["Добавить"]);
        add.addEventListener("click", async () => { await API.addGroupMember(g.group.id, m.id); renderMain(); });
        row.appendChild(add);
        addCard.appendChild(row);
      });
      main.appendChild(addCard);
    }
    const del = el("button", { class: "btn btn-ghost btn-sm", style: "margin-top:16px; color:var(--magenta-ink);" }, ["Удалить группу"]);
    del.addEventListener("click", async () => { if (confirm("Удалить группу? Задания останутся у уже назначенных педагогов.")) { await API.deleteGroup(g.group.id); go("groups"); } });
    main.appendChild(del);
  }

  /* =========================== MENTOR: TEST CONSTRUCTOR =========================== */
  async function renderTestsView(main, user) {
    if (currentSub === "new") return renderTestBuilder(main, null);
    if (currentSub) {
      const t = await API.getTest(currentSub).catch(() => null);
      if (t) return renderTestBuilder(main, t);
    }
    const tests = await API.listTests();
    topbar(main, "🧩 Конструктор тестов", `${tests.length} тестов`, [
      (() => { const b = el("button", { class: "btn btn-primary btn-sm" }, ["+ Новый тест"]); b.addEventListener("click", () => go("tests", "new")); return b; })(),
    ]);
    if (!tests.length) { main.appendChild(emptyState("🧩", "Тестов пока нет", "Соберите тест из вопросов с вариантами ответа — потом назначите его как задание.")); return; }
    tests.forEach(t => {
      const card = el("div", { class: "card" }, [
        el("div", { style: "display:flex; justify-content:space-between; align-items:center;" }, [
          el("b", {}, [t.title]),
          el("span", { style: "font-size:12px; color:var(--ink-faint);" }, [(t.questions?.length || 0) + " вопросов"]),
        ]),
      ]);
      const editBtn = el("button", { class: "btn btn-ghost btn-sm", style: "margin-top:8px;" }, ["Изменить"]);
      editBtn.addEventListener("click", () => go("tests", t.id));
      const delBtn = el("button", { class: "btn btn-ghost btn-sm", style: "margin-top:8px; margin-left:8px; color:var(--magenta-ink);" }, ["Удалить"]);
      delBtn.addEventListener("click", async () => { if (confirm("Удалить тест?")) { await API.deleteTest(t.id); renderMain(); } });
      card.appendChild(editBtn); card.appendChild(delBtn);
      main.appendChild(card);
    });
  }

  function renderTestBuilder(main, existing) {
    topbar(main, existing ? "✏️ Изменить тест" : "🧩 Новый тест", "", [
      (() => { const b = el("button", { class: "btn btn-ghost btn-sm" }, ["← Назад"]); b.addEventListener("click", () => go("tests")); return b; })(),
    ]);
    const title = document.createElement("input");
    title.placeholder = "Название теста"; title.value = existing?.title || "";
    title.style.cssText = "width:100%; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); margin-bottom:10px; font-weight:700;";
    const desc = document.createElement("textarea");
    desc.placeholder = "Описание (необязательно)"; desc.value = existing?.description || "";
    desc.style.cssText = "width:100%; min-height:56px; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border);";
    main.appendChild(el("div", { class: "card" }, [title, desc]));

    const qList = el("div", {});
    main.appendChild(qList);
    const questions = [];

    function addQuestionRow(existingQ) {
      const radioName = "correct" + Date.now() + Math.random().toString(36).slice(2);
      const qInput = document.createElement("input");
      qInput.placeholder = "Текст вопроса"; qInput.value = existingQ?.q || "";
      qInput.style.cssText = "width:100%; padding:8px 12px; border-radius:10px; border:1.5px solid var(--border); margin-bottom:8px; font-weight:700;";
      const optWrap = el("div", {});
      const optInputs = [], correctRadios = [];
      const opts = existingQ?.options?.length ? existingQ.options : ["", "", "", ""];
      opts.forEach((optVal, oi) => {
        const row = el("div", { style: "display:flex; gap:8px; align-items:center; margin-bottom:6px;" });
        const radio = document.createElement("input"); radio.type = "radio"; radio.name = radioName; radio.value = String(oi);
        if (existingQ && existingQ.correctIndex === oi) radio.checked = true;
        const optInput = document.createElement("input"); optInput.placeholder = "Вариант " + (oi + 1); optInput.value = optVal || "";
        optInput.style.cssText = "flex:1; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border);";
        row.appendChild(radio); row.appendChild(optInput);
        optWrap.appendChild(row);
        optInputs.push(optInput); correctRadios.push(radio);
      });
      const points = document.createElement("input");
      points.type = "number"; points.min = "1"; points.value = existingQ?.points || 1;
      points.style.cssText = "width:70px; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border);";
      const pointsLabel = el("label", { style: "font-size:11.5px; color:var(--ink-faint); display:block; margin-top:6px;" }, ["Баллов за вопрос: "]);
      pointsLabel.appendChild(points);
      const removeBtn = el("button", { class: "btn btn-ghost btn-sm", style: "margin-top:6px; color:var(--magenta-ink);" }, ["Удалить вопрос"]);
      const block = el("div", { class: "card", style: "margin-bottom:12px;" }, [qInput, optWrap, pointsLabel, removeBtn]);
      removeBtn.addEventListener("click", () => { block.remove(); const i = questions.findIndex(x => x.block === block); if (i >= 0) questions.splice(i, 1); });
      qList.appendChild(block);
      questions.push({ block, qInput, optInputs, correctRadios, points });
    }

    (existing?.questions?.length ? existing.questions : [null]).forEach(q => addQuestionRow(q));

    const addBtn = el("button", { class: "btn btn-ghost btn-sm" }, ["+ Добавить вопрос"]);
    addBtn.addEventListener("click", () => addQuestionRow(null));
    main.appendChild(addBtn);

    const saveBtn = el("button", { class: "btn btn-primary btn-sm", style: "margin-left:10px;" }, [existing ? "Сохранить" : "Создать тест"]);
    saveBtn.addEventListener("click", async () => {
      if (!title.value.trim()) { toast("Введите название теста"); return; }
      const payload = questions.map(q => {
        const correct = q.correctRadios.find(r => r.checked);
        return { q: q.qInput.value.trim(), options: q.optInputs.map(o => o.value.trim()).filter(Boolean), correctIndex: correct ? parseInt(correct.value, 10) : -1, points: parseInt(q.points.value, 10) || 1 };
      });
      if (payload.some(q => !q.q || q.options.length < 2 || q.correctIndex < 0)) { toast("В каждом вопросе: текст, минимум 2 варианта и отмеченный верный ответ"); return; }
      try {
        if (existing) await API.updateTest(existing.id, { title: title.value.trim(), description: desc.value.trim(), questions: payload });
        else await API.createTest(title.value.trim(), desc.value.trim(), payload);
        toast("Сохранено"); go("tests");
      } catch (e) { apiErr(e); }
    });
    main.appendChild(saveBtn);
  }

  /* =========================== ЗАДАНИЯ (наставник создаёт/оценивает, педагог сдаёт) =========================== */
  function statusLabel(status, score, total) {
    if (status === "assigned") return "⏳ Не сдано";
    if (status === "submitted") return "📤 На проверке";
    if (status === "graded") return `✅ Оценено${score != null ? `: ${score}/${total}` : ""}`;
    return "";
  }

  async function renderAssignmentsView(main, user) {
    if (currentSub) {
      const data = await API.getAssignment(currentSub).catch(() => null);
      if (data) return renderAssignmentDetail(main, user, data);
    }
    const list = await API.listAssignments();
    const actions = [];
    if (user.role === "mentor") {
      const b = el("button", { class: "btn btn-primary btn-sm" }, ["+ Новое задание"]);
      b.addEventListener("click", () => openCreateAssignmentModal());
      actions.push(b);
    }
    topbar(main, "📮 Задания", `${list.length}`, actions);
    if (!list.length) {
      main.appendChild(emptyState("📮", "Заданий пока нет", user.role === "mentor" ? "Создайте задание или тест и назначьте группе или отдельным педагогам." : "Наставник ещё не назначил вам заданий."));
      return;
    }
    list.forEach(a => {
      const card = el("div", { class: "card", style: "cursor:pointer;" }, [
        el("div", { style: "display:flex; justify-content:space-between; align-items:center;" }, [
          el("b", {}, [a.title]),
          el("span", { class: "chip", style: "cursor:default;" }, [a.testId ? "🧩 Тест" : "📝 Задание"]),
        ]),
        el("p", { style: "font-size:12.5px; color:var(--ink-faint); margin-top:6px;" }, [
          user.role === "mentor" ? `Сдали: ${a.submittedCount}/${a.targetCount}` : statusLabel(a.myStatus, a.myScore, a.myTotal),
        ]),
      ]);
      card.addEventListener("click", () => go("assignments", a.id));
      main.appendChild(card);
    });
  }

  async function openCreateAssignmentModal() {
    const [tests, groups, mentees] = await Promise.all([API.listTests(), API.listGroups(), API.listUsers("user")]);
    const backdrop = el("div", { class: "modal-backdrop" });
    const modal = el("div", { class: "modal" }, [el("h3", { style: "margin-bottom:12px;" }, ["Новое задание"])]);
    const title = document.createElement("input");
    title.placeholder = "Название"; title.style.cssText = "width:100%; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); margin-bottom:10px;";
    const desc = document.createElement("textarea");
    desc.placeholder = "Описание / инструкция"; desc.style.cssText = "width:100%; min-height:60px; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); margin-bottom:10px;";
    modal.appendChild(title); modal.appendChild(desc);

    modal.appendChild(el("label", { style: "font-size:12px; color:var(--ink-soft);" }, ["Тест (необязательно — иначе свободный текстовый ответ)"]));
    const testSel = document.createElement("select");
    testSel.style.cssText = "width:100%; padding:8px 12px; border-radius:10px; border:1.5px solid var(--border); margin:6px 0 12px;";
    testSel.appendChild(new Option("— Без теста (свободный ответ) —", ""));
    tests.forEach(t => testSel.appendChild(new Option(t.title, t.id)));
    modal.appendChild(testSel);

    modal.appendChild(el("label", { style: "font-size:12px; color:var(--ink-soft);" }, ["Группа (необязательно)"]));
    const groupSel = document.createElement("select");
    groupSel.style.cssText = "width:100%; padding:8px 12px; border-radius:10px; border:1.5px solid var(--border); margin:6px 0 12px;";
    groupSel.appendChild(new Option("— Без группы —", ""));
    groups.forEach(g => groupSel.appendChild(new Option(g.name, g.id)));
    modal.appendChild(groupSel);

    modal.appendChild(el("label", { style: "font-size:12px; color:var(--ink-soft);" }, ["Или выберите педагогов вручную"]));
    const checks = [];
    const menteeBox = el("div", { style: "max-height:120px; overflow-y:auto; margin:6px 0 12px;" });
    mentees.forEach(m => {
      const label = el("label", { style: "display:flex; gap:8px; align-items:center; font-size:13px; padding:4px 0;" });
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.value = m.id;
      label.appendChild(cb); label.appendChild(document.createTextNode(m.fullName));
      menteeBox.appendChild(label);
      checks.push(cb);
    });
    modal.appendChild(menteeBox);

    modal.appendChild(el("label", { style: "font-size:12px; color:var(--ink-soft);" }, ["🪙 Награда в монетах"]));
    const coins = document.createElement("input");
    coins.type = "number"; coins.value = "10"; coins.style.cssText = "width:100%; padding:8px 12px; border-radius:10px; border:1.5px solid var(--border); margin:6px 0 14px;";
    modal.appendChild(coins);

    const row = el("div", { style: "display:flex; gap:10px; justify-content:flex-end;" });
    const cancel = el("button", { class: "btn btn-ghost btn-sm" }, ["Отмена"]);
    const save = el("button", { class: "btn btn-primary btn-sm" }, ["Создать"]);
    cancel.addEventListener("click", () => backdrop.remove());
    save.addEventListener("click", async () => {
      if (!title.value.trim()) { toast("Введите название"); return; }
      const userIds = checks.filter(c => c.checked).map(c => c.value);
      if (!groupSel.value && !userIds.length) { toast("Выберите группу или хотя бы одного педагога"); return; }
      try {
        const a = await API.createAssignment({ title: title.value.trim(), description: desc.value.trim(), testId: testSel.value || null, groupId: groupSel.value || null, userIds, coinReward: parseInt(coins.value, 10) || 10 });
        backdrop.remove();
        go("assignments", a.id);
      } catch (e) { apiErr(e); }
    });
    row.appendChild(cancel); row.appendChild(save);
    modal.appendChild(row);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  async function renderAssignmentDetail(main, user, data) {
    const a = data.assignment;
    topbar(main, "📮 " + a.title, a.description, [
      (() => { const b = el("button", { class: "btn btn-ghost btn-sm" }, ["← Назад"]); b.addEventListener("click", () => go("assignments")); return b; })(),
    ]);

    if (user.role === "mentor") {
      const card = el("div", { class: "card" }, [el("div", { class: "card-title" }, [`Сдачи (${data.targets.length})`])]);
      if (!data.targets.length) card.appendChild(el("p", { style: "font-size:13px; color:var(--ink-faint);" }, ["Пока никто не назначен."]));
      data.targets.forEach(t => {
        const row = el("div", { style: "padding:10px 0; border-bottom:1px solid var(--border);" }, [
          el("div", { style: "display:flex; justify-content:space-between; align-items:center;" }, [el("b", { style: "font-size:13.5px;" }, [t.userName]), el("span", { class: "chip", style: "cursor:default;" }, [statusLabel(t.status, t.score, t.total)])]),
        ]);
        if (t.answerText) row.appendChild(el("p", { style: "font-size:12.5px; color:var(--ink-soft); margin-top:6px;" }, [t.answerText]));
        if (t.status === "submitted" && !a.testId) {
          const scoreInput = document.createElement("input"); scoreInput.type = "number"; scoreInput.placeholder = "балл";
          scoreInput.style.cssText = "width:60px; padding:6px; border-radius:8px; border:1.5px solid var(--border); margin-top:6px;";
          const totalInput = document.createElement("input"); totalInput.type = "number"; totalInput.placeholder = "из"; totalInput.value = "10";
          totalInput.style.cssText = "width:60px; padding:6px; border-radius:8px; border:1.5px solid var(--border); margin-top:6px; margin-left:6px;";
          const fb = document.createElement("input"); fb.placeholder = "Комментарий";
          fb.style.cssText = "width:100%; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border); margin-top:6px;";
          const gradeBtn = el("button", { class: "btn btn-primary btn-sm", style: "margin-top:6px;" }, ["Оценить"]);
          gradeBtn.addEventListener("click", async () => { await API.gradeAssignment(a.id, t.userId, parseInt(scoreInput.value, 10) || 0, parseInt(totalInput.value, 10) || 10, fb.value); renderMain(); });
          row.appendChild(scoreInput); row.appendChild(totalInput); row.appendChild(fb); row.appendChild(gradeBtn);
        }
        if (t.mentorFeedback) row.appendChild(el("p", { style: "font-size:12px; color:var(--purple-ink); margin-top:6px;" }, ["💬 " + t.mentorFeedback]));
        card.appendChild(row);
      });
      main.appendChild(card);
      return;
    }

    const mt = data.myTarget;
    if (mt.status !== "assigned") {
      main.appendChild(el("div", { class: "card" }, [
        el("div", { class: "chip", style: "cursor:default; margin-bottom:10px;" }, [statusLabel(mt.status, mt.score, mt.total)]),
        mt.answerText ? el("p", { style: "font-size:13.5px; color:var(--ink-soft);" }, [mt.answerText]) : null,
        mt.mentorFeedback ? el("p", { style: "font-size:12.5px; color:var(--purple-ink); margin-top:8px;" }, ["💬 " + mt.mentorFeedback]) : null,
      ]));
      return;
    }

    if (data.questions) {
      const inputs = [];
      const card = el("div", { class: "card" });
      data.questions.forEach((q, qi) => {
        const block = el("div", { style: "margin-bottom:14px;" }, [el("p", { style: "font-weight:700; font-size:13.5px; margin-bottom:6px;" }, [`${qi + 1}. ${q.q}`])]);
        const group = [];
        q.options.forEach((opt, oi) => {
          const label = el("label", { style: "display:flex; gap:8px; align-items:center; font-size:13px; padding:4px 0;" });
          const radio = document.createElement("input"); radio.type = "radio"; radio.name = "aq" + qi; radio.value = String(oi);
          label.appendChild(radio); label.appendChild(document.createTextNode(opt));
          block.appendChild(label); group.push(radio);
        });
        inputs.push(group);
        card.appendChild(block);
      });
      const submitBtn = el("button", { class: "btn btn-primary btn-sm" }, ["Сдать тест"]);
      submitBtn.addEventListener("click", async () => {
        const answers = inputs.map(g => { const p = g.find(r => r.checked); return p ? parseInt(p.value, 10) : -1; });
        await API.submitAssignment(a.id, { testAnswers: answers });
        toast("Сдано!"); renderMain();
      });
      card.appendChild(submitBtn);
      main.appendChild(card);
    } else {
      const ta = document.createElement("textarea");
      ta.placeholder = "Ваш ответ"; ta.style.cssText = "width:100%; min-height:120px; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); margin-bottom:12px;";
      const submitBtn = el("button", { class: "btn btn-primary btn-sm" }, ["Сдать"]);
      submitBtn.addEventListener("click", async () => {
        if (!ta.value.trim()) { toast("Введите ответ"); return; }
        await API.submitAssignment(a.id, { answerText: ta.value.trim() });
        toast("Сдано!"); renderMain();
      });
      main.appendChild(el("div", { class: "card" }, [ta, submitBtn]));
    }
  }

  /* =========================== ADMIN: USERS =========================== */
  let userRoleFilter = "user";
  async function renderUsersView(main, admin) {
    if (currentSub) {
      const u = await API.getUser(currentSub).catch(() => null);
      if (u) return renderUserDetail(main, u);
    }
    topbar(main, "👥 Педагоги и наставники");
    const chipRow = el("div", { class: "chip-row", style: "margin-bottom:18px;" });
    [["user", "Педагоги"], ["mentor", "Наставники"], ["admin", "Администраторы"]].forEach(([v, l]) => {
      const chip = el("button", { class: "chip" + (userRoleFilter === v ? " active" : "") }, [l]);
      chip.addEventListener("click", () => { userRoleFilter = v; renderMain(); });
      chipRow.appendChild(chip);
    });
    main.appendChild(chipRow);

    const list = await API.listUsers(userRoleFilter);
    if (!list.length) { main.appendChild(emptyState("👥", "Никого нет", "Пока в этой категории нет пользователей.")); return; }
    for (const u of list) {
      const row = el("div", { class: "card", style: "display:flex; align-items:center; gap:14px; cursor:pointer;" });
      row.appendChild(avatarNode(u));
      const info = el("div", { style: "flex:1;" }, [el("b", {}, [u.fullName]), el("div", { style: "font-size:12px; color:var(--ink-faint);" }, [`${u.subject} · ${u.email} · ${u.region || "без региона"}` + (userRoleFilter === "user" ? ` · балл ${API.hasScores(u) ? API.avgScore(u).toFixed(1) : "—"}` : "")])]);
      row.appendChild(info);
      if (userRoleFilter === "user") {
        const mentorName = u.mentorId ? (await API.getUser(u.mentorId).catch(() => null))?.fullName || "—" : "не назначен";
        row.appendChild(el("span", { class: "badge badge-purple" }, ["Наставник: " + mentorName.split(" ")[0]]));
      }
      row.addEventListener("click", () => go("users", u.id));
      main.appendChild(row);
    }
  }

  async function renderUserDetail(main, u) {
    const back = el("button", { class: "btn btn-ghost btn-sm", style: "margin-bottom:12px;" }, ["← Все пользователи"]);
    back.addEventListener("click", () => go("users"));
    main.appendChild(back);
    topbar(main, u.fullName, `${API.roleLabel(u.role)} · ${u.subject} · ${u.email} · ${u.region || "без региона"}`);

    if (u.role !== "admin") {
      const approvalCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["✅ Подтверждение профиля"])]);
      approvalCard.appendChild(el("p", { style: "font-size:13px; color:var(--ink-soft); margin-bottom:10px;" }, [u.approvedByAdmin ? "Профиль подтверждён администрацией." : "Профиль ожидает подтверждения администрацией."]));
      const approvalBtn = el("button", { class: "btn " + (u.approvedByAdmin ? "btn-ghost" : "btn-primary") + " btn-sm" }, [u.approvedByAdmin ? "Снять подтверждение" : "Подтвердить профиль"]);
      approvalBtn.addEventListener("click", async () => { await API.setApproval(u.id, !u.approvedByAdmin); toast("Статус профиля обновлён"); renderMain(); });
      approvalCard.appendChild(approvalBtn);
      main.appendChild(approvalCard);
    }

    const accessCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["Доступ и организация"])]);
    const roleField = fieldSelect("Роль", [["user", "Молодой педагог"], ["mentor", "Наставник"], ["admin", "Администратор"]], u.role);
    const organizationWrap = el("div", { class: "field" }, [el("label", {}, ["Организация"])]);
    const organizationSelect = el("select");
    organizationSelect.appendChild(new Option("Без организации", ""));
    (await API.listOrganizations()).forEach((organization) => organizationSelect.appendChild(new Option(organization.name, organization.id, false, organization.id === u.organizationId)));
    organizationWrap.appendChild(organizationSelect);
    const accessSave = el("button", { class: "btn btn-primary btn-sm" }, ["Сохранить доступ"]);
    accessSave.addEventListener("click", async () => {
      await API.adminUpdateUser(u.id, { role: roleField.input.value, organizationId: organizationSelect.value || null, approved: u.approvedByAdmin });
      toast("Права и организация обновлены"); renderMain();
    });
    accessCard.appendChild(roleField.wrap); accessCard.appendChild(organizationWrap); accessCard.appendChild(accessSave);
    main.appendChild(accessCard);

    if (u.role === "user") {
      const mentorCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["🤝 Наставник"])]);
      const sel = document.createElement("select");
      sel.appendChild(new Option("— не назначен —", ""));
      const mentors = await API.listUsers("mentor");
      mentors.forEach(m => sel.appendChild(new Option(m.fullName, m.id, m.id === u.mentorId, m.id === u.mentorId)));
      sel.style.cssText = "padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); font-family:var(--font-body); width:100%; margin-bottom:10px;";
      const saveBtn = el("button", { class: "btn btn-primary btn-sm" }, ["Сохранить"]);
      saveBtn.addEventListener("click", async () => { await API.setMentor(u.id, sel.value || null); toast("Наставник обновлён"); renderMain(); });
      mentorCard.appendChild(sel); mentorCard.appendChild(saveBtn);
      main.appendChild(mentorCard);
      if (API.hasScores(u)) {
        const compCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["📊 Компетенции"])]);
        API.COMPETENCIES.forEach(c => compCard.appendChild(miniScoreRow(c, u.scores[c.id])));
        main.appendChild(compCard);
      }
    }
    const delCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["⚠️ Опасная зона"]), el("p", { style: "font-size:13px; color:var(--ink-soft); margin-bottom:12px;" }, ["Удаление аккаунта необратимо."])]);
    const delBtn = el("button", { class: "btn btn-danger btn-sm" }, ["Удалить пользователя"]);
    delBtn.addEventListener("click", async () => { if (confirm("Удалить " + u.fullName + "?")) { await API.deleteUser(u.id); go("users"); toast("Пользователь удалён"); } });
    delCard.appendChild(delBtn);
    main.appendChild(delCard);
  }

  /* =========================== ADMIN: ORGANIZATIONS =========================== */
  let selectedOrganizationId = null;
  async function renderOrganizations(main, admin) {
    if (admin.role !== "admin") return;
    const create = el("button", { class: "btn btn-primary btn-sm" }, ["+ Организация"]);
    create.addEventListener("click", openOrganizationModal);
    topbar(main, "Организации и дизайн", "Управление доступом, процессами и фирменным интерфейсом", [create]);
    const organizations = await API.listOrganizations();
    if (!organizations.length) {
      main.appendChild(emptyState("🏫", "Организаций пока нет", "Добавьте первую образовательную организацию."));
      return;
    }
    if (!selectedOrganizationId || !organizations.some((item) => item.id === selectedOrganizationId)) selectedOrganizationId = organizations[0].id;
    const workspace = el("div", { class: "organization-workspace" });
    const list = el("div", { class: "organization-list" });
    organizations.forEach((organization) => {
      const button = el("button", { class: "organization-item" + (organization.id === selectedOrganizationId ? " active" : "") }, [
        el("b", {}, [organization.name]),
        el("span", {}, [organization.region || "Регион не указан"]),
        !organization.active ? el("small", {}, ["Архив"]) : null,
      ]);
      button.addEventListener("click", () => { selectedOrganizationId = organization.id; renderMain(); });
      list.appendChild(button);
    });
    workspace.appendChild(list);

    const organization = organizations.find((item) => item.id === selectedOrganizationId);
    const [theme, overview] = await Promise.all([API.getOrganizationTheme(organization.id), API.organizationOverview(organization.id)]);
    const editor = el("section", { class: "organization-editor" });
    const organizationActions = el("div", { class: "organization-head-actions" });
    const editOrganization = el("button", { class: "btn btn-secondary btn-sm" }, ["Редактировать"]);
    editOrganization.addEventListener("click", () => openOrganizationModal(organization));
    organizationActions.appendChild(editOrganization);
    if (organization.active) {
      const archiveOrganization = el("button", { class: "btn btn-danger btn-sm" }, ["В архив"]);
      archiveOrganization.addEventListener("click", async () => {
        if (!confirm("Перевести организацию в архив? Пользователи сохранятся.")) return;
        await API.archiveOrganization(organization.id); toast("Организация перемещена в архив"); renderMain();
      });
      organizationActions.appendChild(archiveOrganization);
    }
    editor.appendChild(el("div", { class: "organization-editor-head" }, [
      el("div", {}, [el("h2", {}, [organization.name]), el("p", {}, [organization.domain || "Домен не задан"])]),
      organizationActions,
    ]));
    const metrics = el("div", { class: "process-metrics" });
    [["Пользователи", overview.total], ["Педагоги", overview.teachers], ["Наставники", overview.mentors], ["Ожидают подтверждения", overview.pending], ["Карты развития", overview.roadmaps], ["Отчёты", overview.reports]].forEach(([label, value]) => {
      metrics.appendChild(el("div", {}, [el("b", {}, [String(Number(value || 0))]), el("span", {}, [label])]));
    });
    editor.appendChild(metrics);
    editor.appendChild(el("h3", { class: "section-heading" }, ["Визуальное оформление"]));

    const form = el("div", { class: "theme-editor" });
    const product = fieldInput("Название сервиса", theme.productName);
    const welcome = fieldInput("Приветствие организации", theme.welcomeText, "textarea");
    const colorGrid = el("div", { class: "theme-colors" });
    const colorFields = [
      ["Основной", "primaryColor"], ["Акцент", "accentColor"], ["Фон панелей", "surfaceColor"],
    ].map(([label, key]) => {
      const wrap = el("label", { class: "color-field" }, [el("span", {}, [label])]);
      const input = el("input", { type: "color", value: theme[key], "aria-label": label });
      wrap.appendChild(input); colorGrid.appendChild(wrap); return [key, input];
    });
    const scaleWrap = el("label", { class: "range-field" }, [el("span", {}, ["Масштаб текста"]), el("output", {}, [String(theme.fontScale)])]);
    const scale = el("input", { type: "range", min: "0.9", max: "1.15", step: "0.05", value: String(theme.fontScale) });
    scale.addEventListener("input", () => scaleWrap.querySelector("output").textContent = scale.value);
    scaleWrap.appendChild(scale);
    const compactLabel = el("label", { class: "toggle-field" }, [el("input", { type: "checkbox" }), el("span", {}, ["Компактный режим"])]);
    compactLabel.querySelector("input").checked = theme.compactMode;
    const preview = el("div", { class: "theme-preview" }, [el("small", {}, ["Предпросмотр"]), el("h3", {}, [theme.productName]), el("p", {}, [theme.welcomeText || "Рабочее пространство педагога"]), el("button", { type: "button" }, ["Основное действие"])]);
    const updatePreview = () => {
      const colors = Object.fromEntries(colorFields.map(([key, input]) => [key, input.value]));
      preview.style.setProperty("--preview-primary", colors.primaryColor);
      preview.style.setProperty("--preview-accent", colors.accentColor);
      preview.style.background = colors.surfaceColor;
      preview.querySelector("h3").textContent = product.input.value || "НавигаторПедагога";
      preview.querySelector("p").textContent = welcome.input.value || "Рабочее пространство педагога";
    };
    product.input.addEventListener("input", updatePreview); welcome.input.addEventListener("input", updatePreview);
    colorFields.forEach(([, input]) => input.addEventListener("input", updatePreview)); updatePreview();
    const save = el("button", { class: "btn btn-primary" }, ["Опубликовать оформление"]);
    save.addEventListener("click", async () => {
      const colors = Object.fromEntries(colorFields.map(([key, input]) => [key, input.value]));
      await API.saveOrganizationTheme(organization.id, { productName: product.input.value.trim(), welcomeText: welcome.input.value.trim(), ...colors, fontScale: Number(scale.value), compactMode: compactLabel.querySelector("input").checked });
      toast("Оформление опубликовано");
    });
    form.appendChild(product.wrap); form.appendChild(welcome.wrap); form.appendChild(colorGrid); form.appendChild(scaleWrap); form.appendChild(compactLabel); form.appendChild(save);
    editor.appendChild(el("div", { class: "theme-layout" }, [form, preview]));
    workspace.appendChild(editor); main.appendChild(workspace);
  }

  function openOrganizationModal(existing) {
    const backdrop = el("div", { class: "modal-backdrop" });
    const card = el("div", { class: "modal-card" }, [el("h3", {}, [existing ? "Редактирование организации" : "Новая организация"])]);
    const name = fieldInput("Полное название", existing?.name || "");
    const shortName = fieldInput("Короткое название", existing?.shortName || "");
    const region = fieldInput("Регион", existing?.region || "");
    const domain = fieldInput("Домен почты", existing?.domain || "");
    [name, shortName, region, domain].forEach((field) => card.appendChild(field.wrap));
    const buttons = el("div", { class: "modal-actions" });
    const cancel = el("button", { class: "btn btn-secondary" }, ["Отмена"]);
    const save = el("button", { class: "btn btn-primary" }, [existing ? "Сохранить" : "Добавить"]);
    cancel.addEventListener("click", () => backdrop.remove());
    save.addEventListener("click", async () => {
      try {
        const payload = { name: name.input.value.trim(), shortName: shortName.input.value.trim(), region: region.input.value.trim(), domain: domain.input.value.trim(), active: existing?.active !== false };
        const organization = existing ? await API.updateOrganization(existing.id, payload) : await API.createOrganization(payload);
        selectedOrganizationId = organization.id; backdrop.remove(); renderMain();
      } catch (error) { apiErr(error); }
    });
    buttons.appendChild(cancel); buttons.appendChild(save); card.appendChild(buttons); backdrop.appendChild(card); document.body.appendChild(backdrop);
  }

  async function renderActivity(main, user) {
    if (user.role !== "admin") return;
    topbar(main, "Журнал действий", "Изменения данных и административные операции");
    const items = await API.listActivity(150);
    if (!items.length) return main.appendChild(emptyState("🧾", "Действий пока нет", "Журнал заполнится после изменений в системе."));
    const table = el("div", { class: "data-table activity-table" }, [
      el("div", { class: "data-table-head" }, ["Пользователь", "Операция", "Раздел", "Статус", "Время"].map((value) => el("span", {}, [value]))),
    ]);
    items.forEach((item) => table.appendChild(el("div", { class: "data-table-row" }, [
      el("span", { "data-label": "Пользователь" }, [item.userName || "Система"]),
      el("b", { "data-label": "Операция" }, [item.method]),
      el("span", { "data-label": "Раздел", class: "mono" }, [item.path]),
      el("span", { "data-label": "Статус" }, [String(item.statusCode)]),
      el("span", { "data-label": "Время" }, [new Date(item.createdAt).toLocaleString("ru-RU")]),
    ])));
    main.appendChild(table);
  }

  /* =========================== PORTFOLIO =========================== */
  async function renderPortfolio(main, user) {
    if (user.role !== "user") { main.appendChild(emptyState("🎓", "Портфолио педагога", "Откройте профиль конкретного подопечного, чтобы посмотреть его результаты.")); return; }
    const pdfBtn = el("button", { class: "btn btn-primary btn-sm" }, ["⬇ PDF"]);
    pdfBtn.addEventListener("click", async () => {
      pdfBtn.disabled = true; pdfBtn.textContent = "Собираю PDF…";
      try { await API.downloadPortfolioPdf(); toast("PDF-портфолио готово"); }
      catch (e) { apiErr(e); }
      finally { pdfBtn.disabled = false; pdfBtn.textContent = "⬇ PDF"; }
    });
    const addBtn = el("button", { class: "btn btn-secondary btn-sm" }, ["+ Достижение"]);
    addBtn.addEventListener("click", openPortfolioItemModal);
    topbar(main, "🎓 Профессиональное портфолио", "Профиль компетенций, подтверждённые результаты и рефлексия", [addBtn, pdfBtn]);

    const portfolio = await API.getPortfolio();
    const portfolioIdentity = el("div", { class: "portfolio-identity" }, [
      avatarNode(user, "portfolio-avatar"),
      el("div", { class: "portfolio-cover-copy" }, [
        el("span", { class: "portfolio-kicker" }, ["ЦИФРОВОЕ ПОРТФОЛИО · ЭТАП 6"]),
        el("h2", {}, [portfolio.profile.fullName]),
        el("p", {}, [`${portfolio.profile.subject} · ${portfolio.profile.school} · ${portfolio.profile.region}`]),
      ]),
    ]);
    const cover = el("div", { class: "portfolio-cover" }, [
      portfolioIdentity,
      el("div", { class: "portfolio-stage" }, [el("b", {}, [String(portfolio.profile.stage)]), el("span", {}, ["этап из 6"])]),
    ]);
    main.appendChild(cover);

    const metrics = el("div", { class: "grid-4 portfolio-metrics" });
    [["green", "Мероприятий", portfolio.metrics.completedEvents], ["magenta", "Отчётов", portfolio.metrics.submittedReports], ["yellow", "Заданий", portfolio.metrics.completedAssignments], ["purple", "Материалов", portfolio.metrics.portfolioItems]].forEach(([color, label, value]) => metrics.appendChild(statTile(color, label, String(value))));
    main.appendChild(metrics);

    const overview = el("div", { class: "grid-2 portfolio-overview" });
    const summary = el("div", { class: "card portfolio-summary" }, [
      el("div", { class: "card-title" }, ["Профессиональный профиль"]),
      el("p", {}, [portfolio.summary]),
      el("div", { class: "portfolio-tags" }, [
        ...portfolio.strengths.map((item) => el("span", { class: "badge badge-green" }, ["Сильная сторона · " + item])),
        ...portfolio.growthAreas.map((item) => el("span", { class: "badge badge-yellow" }, ["Точка роста · " + item])),
      ]),
    ]);
    const scores = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["Профиль компетенций"])]);
    portfolio.scores.forEach((score) => scores.appendChild(miniScoreRow(score, score.value)));
    overview.appendChild(summary); overview.appendChild(scores); main.appendChild(overview);

    const evidence = el("div", { class: "portfolio-section" }, [el("div", { class: "section-inline-head" }, [el("div", {}, [el("h3", {}, ["Подтверждённые достижения"]), el("p", {}, ["Добавляйте сертификаты, разработки, публикации и результаты учеников."])])])]);
    if (!portfolio.evidence.items.length) evidence.appendChild(emptyState("📁", "Пока пусто", "Добавьте первое достижение — оно войдёт в PDF."));
    portfolio.evidence.items.forEach((item) => {
      const row = el("article", { class: "portfolio-item" }, [
        el("div", { class: "portfolio-item-mark" }, [item.category === "publication" ? "П" : item.category === "certificate" ? "С" : item.category === "project" ? "ПР" : "Д"]),
        el("div", { class: "portfolio-item-body" }, [el("span", { class: "portfolio-item-meta" }, [(item.date ? new Date(item.date).toLocaleDateString("ru-RU") : "Без даты") + " · " + portfolioCategory(item.category)]), el("h4", {}, [item.title]), el("p", {}, [item.description || "Без описания"])]),
      ]);
      if (item.url) row.querySelector(".portfolio-item-body").appendChild(el("a", { href: item.url, target: "_blank", rel: "noopener", class: "text-link" }, ["Открыть материал ↗"]));
      const del = el("button", { class: "icon-btn", title: "Удалить", "aria-label": "Удалить достижение" }, ["×"]);
      del.addEventListener("click", async () => { if (confirm("Удалить достижение из портфолио?")) { await API.deletePortfolioItem(item.id); renderMain(); } });
      row.appendChild(del); evidence.appendChild(row);
    });
    main.appendChild(evidence);

    const activity = el("div", { class: "grid-2 portfolio-activity" });
    activity.appendChild(portfolioEvidenceCard("Завершённые мероприятия", portfolio.evidence.events.map((item) => ({ title: item.title, text: item.reflection || "Участие подтверждено", date: item.completed_at }))));
    activity.appendChild(portfolioEvidenceCard("Отчёты и рефлексия", portfolio.evidence.reports.map((item) => ({ title: item.event_title, text: item.report_text, date: item.updated_at }))));
    main.appendChild(activity);
  }

  function portfolioCategory(value) {
    return ({ achievement: "Достижение", certificate: "Сертификат", publication: "Публикация", project: "Проект", method: "Методическая разработка" })[value] || "Материал";
  }

  function portfolioEvidenceCard(title, items) {
    const card = el("div", { class: "card evidence-card" }, [el("div", { class: "card-title" }, [title])]);
    if (!items.length) card.appendChild(el("p", { class: "muted" }, ["Данных пока нет."]));
    items.slice(0, 8).forEach((item) => card.appendChild(el("div", { class: "evidence-row" }, [el("b", {}, [item.title]), el("p", {}, [item.text || "Подтверждено"]), el("span", {}, [formatDate(item.date)])])));
    return card;
  }

  function openPortfolioItemModal() {
    const backdrop = el("div", { class: "modal-backdrop" });
    const card = el("div", { class: "modal-card" }, [el("h3", {}, ["Добавить достижение"])]);
    const category = fieldSelect("Тип материала", [["achievement", "Достижение"], ["certificate", "Сертификат"], ["publication", "Публикация"], ["project", "Проект"], ["method", "Методическая разработка"]], "achievement");
    const title = fieldInput("Название", "");
    const description = fieldInput("Описание и результат", "", "textarea");
    const date = fieldInput("Дата (ГГГГ-ММ-ДД)", "");
    const url = fieldInput("Ссылка на подтверждение (необязательно)", "");
    [category, title, description, date, url].forEach((field) => card.appendChild(field.wrap));
    const buttons = el("div", { class: "modal-actions" });
    const cancel = el("button", { class: "btn btn-secondary" }, ["Отмена"]);
    const save = el("button", { class: "btn btn-primary" }, ["Добавить"]);
    cancel.addEventListener("click", () => backdrop.remove());
    save.addEventListener("click", async () => {
      if (!title.input.value.trim()) { toast("Укажите название", true); return; }
      try {
        await API.addPortfolioItem({ category: category.input.value, title: title.input.value.trim(), description: description.input.value.trim(), date: date.input.value.trim() || null, url: url.input.value.trim() });
        backdrop.remove(); renderMain(); toast("Достижение добавлено в портфолио");
      } catch (e) { apiErr(e); }
    });
    buttons.appendChild(cancel); buttons.appendChild(save); card.appendChild(buttons); backdrop.appendChild(card);
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  /* =========================== FILES =========================== */
  async function renderFiles(main) {
    topbar(main, "📎 Файлы", "Документы и материалы, отправленные в чатах");
    const files = await API.listFiles();
    if (!files.length) { main.appendChild(emptyState("📎", "Файлов пока нет", "Откройте чат с наставником или педагогом и прикрепите файл к сообщению.")); return; }
    const list = el("div", { class: "file-list" });
    files.forEach((file) => {
      const row = el("div", { class: "file-row" }, [
        el("div", { class: "file-kind" }, [file.type?.includes("pdf") ? "PDF" : file.type?.startsWith("image/") ? "IMG" : "DOC"]),
        el("div", { class: "file-info" }, [el("b", {}, [file.name]), el("span", {}, [`${file.senderName} · ${formatFileSize(file.size)} · ${formatDate(file.createdAt)}`])]),
      ]);
      const download = el("button", { class: "btn btn-secondary btn-sm" }, ["Скачать"]);
      download.addEventListener("click", () => API.downloadFile(file.id, file.name).catch(apiErr));
      row.appendChild(download); list.appendChild(row);
    });
    main.appendChild(list);
  }

  /* =========================== REPORTS =========================== */
  async function renderReports(main) {
    const csv = el("button", { class: "btn btn-secondary btn-sm" }, ["⬇ CSV"]);
    csv.addEventListener("click", () => API.downloadReportCsv().catch(apiErr));
    topbar(main, "📊 Отчёты", "Актуальная сводка по данным платформы", [csv]);
    const report = await API.getReport();
    const colors = ["purple", "magenta", "yellow", "green", "purple", "magenta"];
    const stats = el("div", { class: "grid-3 report-stats" });
    report.stats.forEach((stat, index) => stats.appendChild(statTile(colors[index], stat.label, String(stat.value))));
    main.appendChild(stats);
    const detail = el("div", { class: "grid-2 report-detail" });
    const comp = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["Средний профиль компетенций"])]);
    report.competencies.forEach((item) => comp.appendChild(miniScoreRow({ id: item.id, label: item.label, icon: API.competency(item.id)?.icon || "•" }, item.value)));
    const note = el("div", { class: "report-note" }, [el("span", {}, ["Срез"]), el("b", {}, [formatDate(report.generatedAt)]), el("p", {}, [report.scope === "admin" ? "Сводка по всей платформе" : report.scope === "mentor" ? `В отчёте ${report.meta.trackedPeople} подопечных` : "Ваш индивидуальный отчёт"])]);
    detail.appendChild(comp); detail.appendChild(note); main.appendChild(detail);
    if (report.scope !== "user" && report.people.length) {
      const table = el("div", { class: "data-table" }, [el("div", { class: "data-table-head" }, ["Педагог", "Предмет", "Регион", "Этап", "Балл"].map((value) => el("span", {}, [value])))]);
      report.people.forEach((person) => table.appendChild(el("div", { class: "data-table-row" }, [
        el("b", { "data-label": "Педагог" }, [person.name]), el("span", { "data-label": "Предмет" }, [person.subject]), el("span", { "data-label": "Регион" }, [person.region]), el("span", { "data-label": "Этап" }, [`${person.stage}/6`]), el("span", { "data-label": "Балл", class: "mono" }, [person.average ? `${person.average}/5` : "—"]),
      ])));
      main.appendChild(table);
    }
  }

  /* =========================== NOTIFICATIONS =========================== */
  async function renderNotifications(main) {
    const markAll = el("button", { class: "btn btn-secondary btn-sm" }, ["Прочитать все"]);
    markAll.addEventListener("click", async () => { await API.readAllNotifications(); lastUnreadCount = 0; renderMain(); });
    const actions = [markAll];
    if ("Notification" in window && Notification.permission !== "granted") {
      const desktop = el("button", { class: "btn btn-primary btn-sm" }, ["Включить системные"]);
      desktop.addEventListener("click", async () => { const result = await Notification.requestPermission(); toast(result === "granted" ? "Системные уведомления включены" : "Разрешение не выдано", result !== "granted"); });
      actions.push(desktop);
    }
    topbar(main, "🔔 Уведомления", "Сообщения, задания, отчёты и видеовстречи", actions);
    const data = await API.getNotifications();
    lastUnreadCount = data.unread || 0;
    if (!data.notifications.length) { main.appendChild(emptyState("🔔", "Всё спокойно", "Здесь появятся новые сообщения, задания и приглашения.")); return; }
    const list = el("div", { class: "notification-list" });
    data.notifications.forEach((notification) => {
      const row = el("button", { class: "notification-row" + (notification.read ? "" : " unread") }, [
        el("span", { class: "notification-icon" }, [({ message: "💬", file: "📎", video: "🎥", assignment: "📮", report: "📝", mentor: "🤝" })[notification.type] || "🔔"]),
        el("span", { class: "notification-copy" }, [el("b", {}, [notification.title]), el("span", {}, [notification.body]), el("small", {}, [formatDate(notification.createdAt)])]),
        el("span", { class: "notification-arrow" }, ["→"]),
      ]);
      row.addEventListener("click", async () => {
        if (!notification.read) await API.readNotification(notification.id);
        if (notification.link?.startsWith("#/")) {
          const parts = notification.link.slice(2).split("/");
          go(parts[0], parts[1]);
        } else renderMain();
      });
      list.appendChild(row);
    });
    main.appendChild(list);
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  }

  /* =========================== PROFILE =========================== */
  async function renderProfile(main, user) {
    topbar(main, "⚙️ Профиль");
    const card = el("div", { class: "card" }, [el("div", { style: "display:flex; align-items:center; gap:14px; margin-bottom:18px;" }, [avatarNode(user, "lg"), el("div", {}, [el("h3", { style: "font-size:18px;" }, [user.fullName]), el("p", { style: "color:var(--ink-soft); font-size:13px;" }, [API.roleLabel(user.role) + " · " + user.email])])])]);
    const photoControls = el("div", { class: "profile-photo-actions" });
    const photoInput = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp", class: "visually-hidden" });
    const uploadPhoto = el("button", { class: "btn btn-secondary btn-sm", type: "button" }, ["Выбрать фото"]);
    uploadPhoto.addEventListener("click", () => photoInput.click());
    photoInput.addEventListener("change", async () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) return toast("Фотография должна быть не более 2 МБ", true);
      const dataBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file);
      });
      try { await API.uploadAvatar(dataBase64, file.type); toast("Фотография обновлена"); renderShell(); } catch (error) { apiErr(error); }
    });
    photoControls.appendChild(photoInput); photoControls.appendChild(uploadPhoto);
    if (user.hasAvatar) {
      const removePhoto = el("button", { class: "btn btn-danger btn-sm", type: "button" }, ["Удалить фото"]);
      removePhoto.addEventListener("click", async () => { await API.deleteAvatar(); toast("Фотография удалена"); renderShell(); });
      photoControls.appendChild(removePhoto);
    }
    card.appendChild(photoControls);
    const name = fieldInput("Полное имя", user.fullName);
    const subject = fieldInput("Предмет", user.subject);
    const region = fieldInput("Регион (используется ИИ для поиска мероприятий)", user.region);
    const years = fieldInput("Стаж (лет)", String(user.yearsExperience || 0));
    [name, subject, region, years].forEach(f => card.appendChild(f.wrap));
    const saveBtn = el("button", { class: "btn btn-primary" }, ["Сохранить изменения"]);
    saveBtn.addEventListener("click", async () => {
      try {
        await API.updateMe({ fullName: name.input.value.trim(), subject: subject.input.value.trim(), region: region.input.value.trim(), yearsExperience: parseInt(years.input.value || "0", 10) });
        await renderShell();
        toast("Профиль обновлён");
      } catch (e) { apiErr(e); }
    });
    card.appendChild(saveBtn);
    main.appendChild(card);

    if (user.role === "user" && API.hasScores(user)) {
      const pCard = el("div", { class: "card", style: "margin-top:18px;" }, [
        el("div", { class: "card-title" }, ["🎓 Профессиональное портфолио"]),
        el("p", { style: "font-size:13.5px; color:var(--ink-soft); margin-bottom:12px;" }, ["Расширенный профиль, достижения, мероприятия, отчёты и экспорт готового документа в PDF."]),
      ]);
      const openBtn = el("button", { class: "btn btn-primary btn-sm" }, ["Открыть портфолио"]);
      openBtn.addEventListener("click", () => go("portfolio"));
      pCard.appendChild(openBtn);
      main.appendChild(pCard);
    }
  }

  /* =========================== BOOT =========================== */
  window.addEventListener("hashchange", () => {
    const hash = location.hash.replace("#/", "");
    if (hash && API.isLoggedIn()) {
      const nextView = hash.split("/")[0];
      const nextSub = hash.split("/")[1] || null;
      if (nextView === currentView && nextSub === currentSub) return;
      currentView = nextView;
      currentSub = nextSub;
      renderMain();
    }
  });

  async function boot() {
    bindLanding();
    $("#landing").inert = false;
    $("#landing").setAttribute("aria-busy", "false");
    if (API.isLoggedIn()) {
      const user = await API.fetchMe();
      if (user) await enterApp();
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
