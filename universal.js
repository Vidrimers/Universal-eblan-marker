// ==UserScript==
// @name         Universal Eblan Marker
// @namespace    http://tampermonkey.net/
// @version      6.1
// @description  Универсальная подсветка ников + надписи на профилях. Работает на любом сайте.
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_listValues
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  // ========== КОНСТАНТЫ ==========
  const DOMAIN = location.hostname.replace(/^www\./, "");
  const STORAGE_KEY = `vm_${DOMAIN}`;
  const MARKER_ATTR = "data-vm-marked";

  // ========== ХРАНИЛИЩЕ ==========
  function loadData() {
    const raw = GM_getValue(STORAGE_KEY, null);
    if (raw) return JSON.parse(raw);
    return {
      nicknames: {},
      profileMessages: {},
      settings: {
        nickColor: "#ff4444",
        nickBold: true,
        centerColor: "#ff4444",
        centerBg: "rgba(10,10,10,0.92)",
        centerSize: "42px",
        centerBorder: "#ff4444",
        showForever: true,
        autoHideSeconds: 5,
        userIdPatterns: ["[?&]u=(\\d+)", "/profile/(\\d+)", "/member/(\\d+)"],
      },
    };
  }

  function saveData(data) {
    GM_setValue(STORAGE_KEY, JSON.stringify(data));
  }

  let DATA = loadData();

  // ========== ОПРЕДЕЛЕНИЕ ID ПРОФИЛЯ ==========
  // Берём ПОСЛЕДНЮЮ capture-группу — это позволяет паттернам типа
  // /seller/([^/]+)/(\d+) правильно извлекать числовой ID из конца URL

  function getUserIdFromUrl() {
    const url = location.href;
    const patterns = DATA.settings.userIdPatterns || ["[?&]u=(\\d+)"];
    for (const pat of patterns) {
      try {
        const re = new RegExp(pat);
        const m = url.match(re);
        if (m && m.length >= 2) {
          // Берём последнюю непустую группу
          for (let i = m.length - 1; i >= 1; i--) {
            if (m[i]) return m[i];
          }
        }
      } catch (e) {}
    }
    return null;
  }

  // ========== ЦЕНТРИРОВАННАЯ НАДПИСЬ ==========

  function showCenterMessage(text) {
    const s = DATA.settings;
    const overlay = document.createElement("div");
    overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 2147483647;
            pointer-events: none; display: flex;
            align-items: center; justify-content: center;
        `;
    const msg = document.createElement("div");
    msg.textContent = text;
    msg.style.cssText = `
            font-weight: 800;
            text-align: center;
            text-transform: uppercase;
            padding: 24px 48px;
            border-radius: 16px;
            box-shadow: 0 0 60px rgba(0,0,0,0.5);
            animation: vm-pulse 2s ease-in-out infinite;
            color: ${s.centerColor};
            font-size: ${s.centerSize};
            background: ${s.centerBg};
            border: 3px solid ${s.centerBorder};
        `;
    overlay.appendChild(msg);
    document.body.appendChild(overlay);
    if (!s.showForever) {
      setTimeout(() => overlay.remove(), s.autoHideSeconds * 1000);
    }
  }

  // ========== ПОДСВЕТКА НИКОВ ==========

  const SKIP_TAGS = new Set([
    "TEXTAREA",
    "INPUT",
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "SVG",
  ]);

  function buildPattern() {
    const keys = Object.keys(DATA.nicknames);
    if (!keys.length) return null;
    const escaped = keys.map(
      (k) => `\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    );
    return new RegExp(escaped.join("|"), "gi");
  }

  let pattern = buildPattern();

  function getLabelFor(nick) {
    const low = nick.toLowerCase();
    for (const [k, v] of Object.entries(DATA.nicknames)) {
      if (k.toLowerCase() === low) return v;
    }
    return "";
  }

  function processNode(node) {
    if (!pattern) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.hasAttribute(MARKER_ATTR) || SKIP_TAGS.has(node.tagName)) return;
      node.childNodes.forEach((ch) => processNode(ch));
      return;
    }
    if (node.nodeType !== Node.TEXT_NODE) return;

    const text = node.textContent;
    if (!text.trim()) return;

    const lower = text.toLowerCase();
    const hasMatch = Object.keys(DATA.nicknames).some((k) =>
      lower.includes(k.toLowerCase()),
    );
    if (!hasMatch) return;

    const parent = node.parentElement;
    if (
      !parent ||
      parent.hasAttribute(MARKER_ATTR) ||
      SKIP_TAGS.has(parent.tagName)
    )
      return;

    const parts = [];
    let lastIdx = 0;
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      if (m.index > lastIdx)
        parts.push({ t: "text", c: text.slice(lastIdx, m.index) });
      parts.push({ t: "nick", c: m[0], label: getLabelFor(m[0]) });
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length)
      parts.push({ t: "text", c: text.slice(lastIdx) });
    if (parts.length <= 1 && parts[0]?.t === "text") return;

    const span = document.createElement("span");
    span.setAttribute(MARKER_ATTR, "1");
    for (const p of parts) {
      if (p.t === "text") {
        span.appendChild(document.createTextNode(p.c));
      } else {
        span.appendChild(document.createTextNode(p.c));
        const tag = document.createElement("span");
        tag.textContent = ` (${p.label})`;
        tag.style.color = DATA.settings.nickColor;
        if (DATA.settings.nickBold) tag.style.fontWeight = "bold";
        span.appendChild(tag);
      }
    }
    parent.replaceChild(span, node);
  }

  // ========== УТИЛИТЫ ==========

  function escapeHtml(s) {
    if (!s) return "";
    return String(s).replace(
      /[&<>"]/g,
      (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m],
    );
  }

  // ========== SHADOW DOM UI ==========
  // Вся модалка живёт внутри Shadow DOM — CSS сайта не может туда пролезть

  function createUI() {
    // Контейнер для Shadow DOM — вешаем на <html>, чтобы SPA-страницы
    // не удаляли наш хост при замене body.
    const host = document.createElement("div");
    host.setAttribute(MARKER_ATTR, "1");
    host.style.cssText =
      "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });

    // Все стили внутри Shadow DOM — изолированы полностью
    const style = document.createElement("style");
    style.textContent = `
            *, *::before, *::after { box-sizing: border-box; }

            /* ===== Toast ===== */
            .vm-toast {
                position: fixed;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%) translateY(20px);
                background: linear-gradient(135deg, #1e1e2e, #2a2a3e);
                color: #fff;
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 12px;
                padding: 12px 24px;
                font: 600 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                z-index: 2147483647;
                box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                opacity: 0;
                transition: opacity 0.3s, transform 0.3s;
                backdrop-filter: blur(10px);
                max-width: 340px;
                text-align: center;
                pointer-events: none;
            }
            .vm-toast.show {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
            .vm-toast.error { border-color: #ff4444; }

            /* ===== FAB Button ===== */
            .vm-fab {
                position: fixed;
                bottom: 24px;
                left: 24px;
                width: 30px;
                height: 20px;
                border-radius: 12px;
                background: linear-gradient(135deg, rgba(255,65,108,0.2), rgba(255,75,43,0.5));
                border: none;
                color: white;
                font-size: 14px;
                cursor: pointer;
                z-index: 2147483646;
                box-shadow: 0 4px 24px rgba(255,65,108,0.4);
                transition: transform 0.25s cubic-bezier(.4,2,.6,1), box-shadow 0.3s;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                animation: vm-fab-pulse 3s ease-in-out infinite;
                pointer-events: auto;
            }
            .vm-fab:hover {
                transform: scale(1.12) rotate(-5deg);
                box-shadow: 0 8px 32px rgba(255,65,108,0.6), 0 0 0 6px rgba(255,65,108,0.15);
            }
            .vm-fab:active { transform: scale(0.95); }

            @keyframes vm-fab-pulse {
                0%, 100% { box-shadow: 0 4px 24px rgba(255,65,108,0.4), 0 0 0 0 rgba(255,65,108,0); }
                50% { box-shadow: 0 4px 24px rgba(255,65,108,0.4), 0 0 0 8px rgba(255,65,108,0.08); }
            }

            /* ===== Overlay ===== */
            .vm-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.4);
                z-index: 2147483644;
                opacity: 0;
                transition: opacity 0.3s;
                display: none;
                pointer-events: none;
            }
            .vm-overlay.open { display: block; opacity: 1; pointer-events: auto; }

            /* ===== Modal ===== */
            .vm-modal {
                position: fixed;
                top: 50%;
                right: 10%;
                transform: translate(20%, -50%) scale(0.95);
                pointer-events: auto;
                width: 520px;
                max-width: 92vw;
                max-height: 75vh;
                overflow-y: auto;
                background: linear-gradient(160deg, #1a1a2e, #16213e);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 20px;
                padding: 28px;
                z-index: 2147483645;
                color: #e0e0e0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                font-size: 14px;
                line-height: 1.4;
                box-shadow: 0 24px 80px rgba(0,0,0,0.6);
                opacity: 0;
                transition: opacity 0.3s, transform 0.3s;
                display: none;
            }
            .vm-modal.open {
                display: block;
                opacity: 1;
                transform: translate(20%, -50%) scale(1);
            }

            .vm-modal h2 {
                margin: 0 0 20px;
                font-size: 20px;
                font-weight: 700;
                color: #fff;
                display: flex;
                flex-direction: row;
                align-items: center;
                gap: 10px;
            }
            .vm-domain {
                font-size: 12px;
                background: rgba(102,126,234,0.2);
                color: #a3b1ff;
                padding: 3px 10px;
                border-radius: 20px;
                font-weight: 500;
            }

            /* ===== Tabs ===== */
            .vm-tabs {
                display: flex;
                flex-direction: row;
                gap: 4px;
                margin-bottom: 20px;
                background: rgba(0,0,0,0.3);
                border-radius: 10px;
                padding: 4px;
            }
            .vm-tab {
                flex: 1;
                padding: 10px 12px;
                border: none;
                background: transparent;
                color: #888;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                border-radius: 8px;
                transition: all 0.2s;
            }
            .vm-tab.active {
                background: rgba(102,126,234,0.2);
                color: #a3b1ff;
            }
            .vm-tab:hover:not(.active) { color: #ccc; }

            /* ===== Tab Content ===== */
            .vm-tab-content { display: none; }
            .vm-tab-content.active {
                display: flex;
                flex-direction: column;
            }

            /* ===== Inputs & Buttons ===== */
            .vm-input {
                width: 100%;
                padding: 10px 14px;
                background: rgba(0,0,0,0.4);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 8px;
                color: #fff;
                font-size: 13px;
                outline: none;
                transition: border-color 0.2s;
                font-family: inherit;
            }
            .vm-input:focus { border-color: rgba(102,126,234,0.5); }
            .vm-input::placeholder { color: #555; }

            .vm-btn {
                padding: 10px 18px;
                border: none;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                font-family: inherit;
                white-space: nowrap;
            }
            .vm-btn-primary { background: linear-gradient(135deg, #667eea, #764ba2); color: white; }
            .vm-btn-primary:hover { opacity: 0.85; transform: translateY(-1px); }
            .vm-btn-success { background: #2ecc71; color: white; }
            .vm-btn-warning { background: #f39c12; color: white; }
            .vm-btn-danger { background: #e74c3c; color: white; }
            .vm-btn-ghost {
                background: rgba(255,255,255,0.05);
                color: #aaa;
                border: 1px solid rgba(255,255,255,0.1);
            }
            .vm-btn-ghost:hover { background: rgba(255,255,255,0.1); color: #fff; }

            /* ===== List Items ===== */
            .vm-list {
                max-height: 180px;
                overflow-y: auto;
                margin-bottom: 12px;
                padding: 4px;
                background: rgba(0,0,0,0.2);
                border-radius: 10px;
            }
            .vm-list::-webkit-scrollbar { width: 6px; }
            .vm-list::-webkit-scrollbar-track { background: transparent; }
            .vm-list::-webkit-scrollbar-thumb {
                background: rgba(102,126,234,0.3);
                border-radius: 3px;
            }
            .vm-list-item {
                display: flex;
                flex-direction: row;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                border-radius: 8px;
                margin-bottom: 4px;
                background: rgba(255,255,255,0.03);
                transition: background 0.2s;
            }
            .vm-list-item:hover { background: rgba(255,255,255,0.06); }
            .vm-list-item-text {
                font-size: 13px;
                word-break: break-all;
                flex: 1;
            }
            .vm-list-item-text strong { color: #a3b1ff; }
            .vm-arrow { color: #555; margin: 0 6px; }

            .vm-delete-btn, .vm-edit-btn {
                border: none;
                width: 28px;
                height: 28px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
            }
            .vm-delete-btn { background: rgba(231,76,60,0.15); color: #e74c3c; }
            .vm-delete-btn:hover { background: rgba(231,76,60,0.3); }
            .vm-edit-btn { background: rgba(102,126,234,0.15); color: #667eea; }
            .vm-edit-btn:hover { background: rgba(102,126,234,0.3); }
            .vm-item-actions { display: flex; flex-direction: row; gap: 4px; flex-shrink: 0; }

            .vm-edit-row {
                display: flex;
                flex-direction: row;
                gap: 6px;
                padding: 8px 12px;
                border-radius: 8px;
                margin-bottom: 4px;
                background: rgba(102,126,234,0.08);
                border: 1px solid rgba(102,126,234,0.2);
            }
            .vm-edit-row .vm-input { flex: 1; padding: 6px 10px; font-size: 12px; }
            .vm-edit-row .vm-btn { padding: 6px 10px; font-size: 12px; }

            /* ===== Add Row ===== */
            .vm-add-row {
                display: flex;
                flex-direction: row;
                gap: 8px;
                margin-top: 8px;
            }
            .vm-add-row .vm-input { flex: 1; }

            /* ===== Settings ===== */
            .vm-setting-row {
                display: flex;
                flex-direction: row;
                align-items: center;
                justify-content: space-between;
                padding: 10px 0;
                border-bottom: 1px solid rgba(255,255,255,0.05);
            }
            .vm-setting-label { font-size: 13px; color: #aaa; flex: 1; }
            .vm-color-input {
                width: 40px; height: 30px;
                border: none; border-radius: 6px;
                cursor: pointer; background: none;
                flex-shrink: 0;
            }

            /* ===== Close btn ===== */
            .vm-close {
                position: absolute;
                top: 16px;
                right: 20px;
                background: none;
                border: none;
                color: #666;
                font-size: 24px;
                cursor: pointer;
                transition: color 0.2s;
                line-height: 1;
                padding: 0;
            }
            .vm-close:hover { color: #fff; }

            /* ===== Footer buttons ===== */
            .vm-footer {
                display: flex;
                flex-direction: row;
                gap: 8px;
                margin-top: 20px;
                flex-wrap: wrap;
            }
            .vm-footer .vm-btn { flex: 1; min-width: 120px; text-align: center; }

            /* ===== Help ===== */
            .vm-help { font-size: 13px; line-height: 1.7; color: #ccc; }
            .vm-help h3 { color: #fff; margin: 0 0 12px; font-size: 15px; }
            .vm-help p { margin: 0 0 8px; }
            .vm-help ul { padding-left: 18px; margin: 6px 0; }
            .vm-help li { margin-bottom: 4px; }
            .vm-help .vm-code {
                background: rgba(0,0,0,0.3);
                padding: 8px 12px;
                border-radius: 8px;
                font-family: monospace;
                font-size: 12px;
            }
        `;
    shadow.appendChild(style);

    // ===== FAB =====
    const fab = document.createElement("button");
    fab.className = "vm-fab";
    fab.textContent = "💀";
    fab.title = "Eblan Marker";
    shadow.appendChild(fab);

    // ===== Overlay =====
    const overlay = document.createElement("div");
    overlay.className = "vm-overlay";
    shadow.appendChild(overlay);

    // ===== Modal =====
    const modal = document.createElement("div");
    modal.className = "vm-modal";
    modal.innerHTML = `
            <button class="vm-close">&times;</button>
            <h2>💀 Eblan Marker <span class="vm-domain">${escapeHtml(DOMAIN)}</span></h2>

            <div class="vm-tabs">
                <button class="vm-tab active" data-tab="nicks">👤 Ники</button>
                <button class="vm-tab" data-tab="profiles">💀 Профили</button>
                <button class="vm-tab" data-tab="settings">⚙️ Настройки</button>
                <button class="vm-tab" data-tab="help">? Помощь</button>
            </div>

            <div class="vm-tab-content active" data-tab="nicks">
                <div class="vm-list" id="vmNickList"></div>
                <div class="vm-add-row">
                    <input class="vm-input" id="vmNewNick" placeholder="Ник">
                    <input class="vm-input" id="vmNewLabel" placeholder="Метка">
                    <button class="vm-btn vm-btn-primary" id="vmAddNick">+</button>
                </div>
            </div>

            <div class="vm-tab-content" data-tab="profiles">
                <div class="vm-list" id="vmProfileList"></div>
                <div class="vm-add-row">
                    <input class="vm-input" id="vmNewProfId" placeholder="ID пользователя">
                    <input class="vm-input" id="vmNewProfText" placeholder="Текст надписи">
                    <button class="vm-btn vm-btn-primary" id="vmAddProf">+</button>
                </div>
            </div>

            <div class="vm-tab-content" data-tab="settings">
                <div class="vm-setting-row">
                    <span class="vm-setting-label">Цвет метки ника</span>
                    <input type="color" class="vm-color-input" id="vmNickColor" value="${DATA.settings.nickColor}">
                </div>
                <div class="vm-setting-row">
                    <span class="vm-setting-label">Цвет надписи (центр)</span>
                    <input type="color" class="vm-color-input" id="vmCenterColor" value="${DATA.settings.centerColor}">
                </div>
                <div class="vm-setting-row">
                    <span class="vm-setting-label">Цвет рамки</span>
                    <input type="color" class="vm-color-input" id="vmCenterBorder" value="${DATA.settings.centerBorder}">
                </div>
                <div class="vm-setting-row">
                    <span class="vm-setting-label">Размер шрифта (центр)</span>
                    <input class="vm-input" id="vmCenterSize" value="${DATA.settings.centerSize}" style="width:80px;flex:unset;">
                </div>
                <div class="vm-setting-row">
                    <span class="vm-setting-label">Показывать всегда</span>
                    <input type="checkbox" id="vmShowForever" ${DATA.settings.showForever ? "checked" : ""}>
                </div>
                <div class="vm-setting-row" style="border-bottom:none;">
                    <span class="vm-setting-label">Паттерны URL для ID (по одному на строку)</span>
                </div>
                <textarea class="vm-input" id="vmPatterns" rows="3" style="resize:vertical;margin-top:6px;">${(DATA.settings.userIdPatterns || []).join("\n")}</textarea>
            </div>

            <div class="vm-tab-content" data-tab="help">
                <div class="vm-help">
                    <h3>Как пользоваться</h3>
                    <p><strong style="color:#a3b1ff;">👤 Ники</strong> — подсветка ников на странице. Добавь ник и метку, и рядом с каждым упоминанием появится твой текст.</p>
                    <p class="vm-code">Пример: <strong>beex</strong> → <strong>scammer</strong><br>Результат: beex <span style="color:#ff4444;font-weight:bold;">(scammer)</span></p>
                    <p style="margin-top:12px;"><strong style="color:#a3b1ff;">💀 Профили</strong> — большая надпись по центру при заходе на профиль. Укажи ID и текст.</p>
                    <p class="vm-code">Пример: ID <strong>1179730</strong> → <strong>ЕБЛАН</strong><br>При открытии /seller/beex/1179730 появится надпись</p>
                    <p style="margin-top:12px;"><strong style="color:#a3b1ff;">⚙️ Паттерны URL</strong> — regex для извлечения ID.<br>
                    Если в паттерне несколько групп — берётся последняя.<br>
                    Для plati.market: <code style="background:rgba(0,0,0,0.4);padding:2px 6px;border-radius:4px;">/seller/[^/]+/(\d+)</code></p>
                    <p style="margin-top:12px;"><strong style="color:#a3b1ff;">📥📤 Экспорт/Импорт</strong> — данные хранятся отдельно для каждого сайта.</p>
                    <p style="margin-top:8px;color:#666;font-size:11px;">Данные в Tampermonkey (GM_storage), не пропадут при очистке кук.</p>
                </div>
            </div>

            <div class="vm-footer">
                <button class="vm-btn vm-btn-success" id="vmExport">📥 Экспорт</button>
                <button class="vm-btn vm-btn-warning" id="vmImport">📤 Импорт</button>
                <button class="vm-btn vm-btn-ghost" id="vmRefresh">🔄 Обновить</button>
            </div>
            <div class="vm-footer" style="margin-top:8px;">
                <button class="vm-btn vm-btn-success" id="vmExportAll" style="opacity:0.8;">📥 Все сайты</button>
                <button class="vm-btn vm-btn-warning" id="vmImportAll" style="opacity:0.8;">📤 Все сайты</button>
            </div>
        `;
    shadow.appendChild(modal);

    // ========== FAB: восстановление на YouTube и других SPA ==========
    // YouTube пересоздаёт DOM при навигации и может удалять наш host-элемент
    const fabObserver = new MutationObserver(() => {
      if (!document.documentElement.contains(host)) {
        document.documentElement.appendChild(host);
      }
    });
    fabObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // ========== TOAST (внутри Shadow DOM) ==========
    function showToast(msg, isError = false) {
      const old = shadow.querySelector(".vm-toast");
      if (old) old.remove();
      const t = document.createElement("div");
      t.className = "vm-toast" + (isError ? " error" : "");
      t.textContent = msg;
      shadow.appendChild(t);
      requestAnimationFrame(() => t.classList.add("show"));
      setTimeout(() => {
        t.classList.remove("show");
        setTimeout(() => t.remove(), 300);
      }, 3000);
    }

    // ========== EVENTS ==========
    fab.onclick = () => openModal();
    modal.querySelector(".vm-close").onclick = () => closeModal();
    overlay.onclick = () => closeModal();

    function openModal() {
      overlay.classList.add("open");
      modal.classList.add("open");
      renderLists();
    }
    function closeModal() {
      overlay.classList.remove("open");
      modal.classList.remove("open");
    }

    // Tabs
    modal.querySelectorAll(".vm-tab").forEach((tab) => {
      tab.onclick = () => {
        modal
          .querySelectorAll(".vm-tab")
          .forEach((t) => t.classList.remove("active"));
        modal
          .querySelectorAll(".vm-tab-content")
          .forEach((c) => c.classList.remove("active"));
        tab.classList.add("active");
        modal
          .querySelector(`.vm-tab-content[data-tab="${tab.dataset.tab}"]`)
          .classList.add("active");
      };
    });

    // Render lists
    function renderLists() {
      const nickList = modal.querySelector("#vmNickList");
      const profList = modal.querySelector("#vmProfileList");

      nickList.innerHTML =
        Object.entries(DATA.nicknames)
          .map(
            ([nick, label]) => `
                <div class="vm-list-item">
                    <span class="vm-list-item-text"><strong>${escapeHtml(nick)}</strong><span class="vm-arrow">→</span>${escapeHtml(label)}</span>
                    <span class="vm-item-actions">
                        <button class="vm-edit-btn" data-nick="${escapeHtml(nick)}" data-label="${escapeHtml(label)}">✎</button>
                        <button class="vm-delete-btn" data-nick="${escapeHtml(nick)}">✕</button>
                    </span>
                </div>
            `,
          )
          .join("") ||
        '<div style="padding:12px;text-align:center;color:#555;">Пусто</div>';

      profList.innerHTML =
        Object.entries(DATA.profileMessages)
          .map(
            ([id, text]) => `
                <div class="vm-list-item">
                    <span class="vm-list-item-text"><strong>${escapeHtml(id)}</strong><span class="vm-arrow">→</span>${escapeHtml(text)}</span>
                    <span class="vm-item-actions">
                        <button class="vm-edit-btn" data-prof="${escapeHtml(id)}" data-label="${escapeHtml(text)}">✎</button>
                        <button class="vm-delete-btn" data-prof="${escapeHtml(id)}">✕</button>
                    </span>
                </div>
            `,
          )
          .join("") ||
        '<div style="padding:12px;text-align:center;color:#555;">Пусто</div>';

      // Nick edit handlers
      nickList.querySelectorAll(".vm-edit-btn").forEach((btn) => {
        btn.onclick = () => {
          const oldNick = btn.dataset.nick;
          const oldLabel = btn.dataset.label;
          btn.closest(".vm-list-item").outerHTML = `
                        <div class="vm-edit-row" data-editing-nick="${escapeHtml(oldNick)}">
                            <input class="vm-input vm-edit-nick" value="${escapeHtml(oldNick)}" placeholder="Ник">
                            <input class="vm-input vm-edit-label" value="${escapeHtml(oldLabel)}" placeholder="Метка">
                            <button class="vm-btn vm-btn-primary vm-save-nick">✓</button>
                            <button class="vm-btn vm-btn-ghost vm-cancel-nick">✕</button>
                        </div>
                    `;
          const row = nickList.querySelector(
            `[data-editing-nick="${escapeHtml(oldNick)}"]`,
          );
          row.querySelector(".vm-save-nick").onclick = () => {
            const newNick = row.querySelector(".vm-edit-nick").value.trim();
            const newLabel = row.querySelector(".vm-edit-label").value.trim();
            if (!newNick || !newLabel)
              return showToast("Заполните оба поля", true);
            delete DATA.nicknames[oldNick];
            DATA.nicknames[newNick] = newLabel;
            saveData(DATA);
            pattern = buildPattern();
            renderLists();
            showToast("✓ Изменено");
          };
          row.querySelector(".vm-cancel-nick").onclick = () => renderLists();
        };
      });

      // Profile edit handlers
      profList.querySelectorAll(".vm-edit-btn").forEach((btn) => {
        btn.onclick = () => {
          const oldId = btn.dataset.prof;
          const oldLabel = btn.dataset.label;
          btn.closest(".vm-list-item").outerHTML = `
                        <div class="vm-edit-row" data-editing-prof="${escapeHtml(oldId)}">
                            <input class="vm-input vm-edit-id" value="${escapeHtml(oldId)}" placeholder="ID">
                            <input class="vm-input vm-edit-text" value="${escapeHtml(oldLabel)}" placeholder="Текст">
                            <button class="vm-btn vm-btn-primary vm-save-prof">✓</button>
                            <button class="vm-btn vm-btn-ghost vm-cancel-prof">✕</button>
                        </div>
                    `;
          const row = profList.querySelector(
            `[data-editing-prof="${escapeHtml(oldId)}"]`,
          );
          row.querySelector(".vm-save-prof").onclick = () => {
            const newId = row.querySelector(".vm-edit-id").value.trim();
            const newText = row.querySelector(".vm-edit-text").value.trim();
            if (!newId || !newText)
              return showToast("Заполните оба поля", true);
            delete DATA.profileMessages[oldId];
            DATA.profileMessages[newId] = newText;
            saveData(DATA);
            renderLists();
            showToast("✓ Изменено");
          };
          row.querySelector(".vm-cancel-prof").onclick = () => renderLists();
        };
      });

      // Delete handlers
      nickList.querySelectorAll(".vm-delete-btn").forEach((btn) => {
        btn.onclick = () => {
          delete DATA.nicknames[btn.dataset.nick];
          saveData(DATA);
          pattern = buildPattern();
          renderLists();
          showToast("Удалено");
        };
      });
      profList.querySelectorAll(".vm-delete-btn").forEach((btn) => {
        btn.onclick = () => {
          delete DATA.profileMessages[btn.dataset.prof];
          saveData(DATA);
          renderLists();
          showToast("Удалено");
        };
      });
    }

    // Add nick
    modal.querySelector("#vmAddNick").onclick = () => {
      const nick = modal.querySelector("#vmNewNick").value.trim();
      const label = modal.querySelector("#vmNewLabel").value.trim();
      if (!nick || !label) return showToast("Заполните оба поля", true);
      DATA.nicknames[nick] = label;
      saveData(DATA);
      pattern = buildPattern();
      modal.querySelector("#vmNewNick").value = "";
      modal.querySelector("#vmNewLabel").value = "";
      renderLists();
      showToast("✓ Ник добавлен");
    };

    // Add profile
    modal.querySelector("#vmAddProf").onclick = () => {
      const id = modal.querySelector("#vmNewProfId").value.trim();
      const text = modal.querySelector("#vmNewProfText").value.trim();
      if (!id || !text) return showToast("Заполните оба поля", true);
      DATA.profileMessages[id] = text;
      saveData(DATA);
      modal.querySelector("#vmNewProfId").value = "";
      modal.querySelector("#vmNewProfText").value = "";
      renderLists();
      showToast("✓ Профиль добавлен");
    };

    // Settings
    const saveSettings = () => {
      DATA.settings.nickColor = modal.querySelector("#vmNickColor").value;
      DATA.settings.centerColor = modal.querySelector("#vmCenterColor").value;
      DATA.settings.centerBorder = modal.querySelector("#vmCenterBorder").value;
      DATA.settings.centerSize = modal.querySelector("#vmCenterSize").value;
      DATA.settings.showForever = modal.querySelector("#vmShowForever").checked;
      DATA.settings.userIdPatterns = modal
        .querySelector("#vmPatterns")
        .value.split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      saveData(DATA);
      showToast("✓ Настройки сохранены");
    };

    modal.querySelector("#vmNickColor").onchange = saveSettings;
    modal.querySelector("#vmCenterColor").onchange = saveSettings;
    modal.querySelector("#vmCenterBorder").onchange = saveSettings;
    modal.querySelector("#vmCenterSize").onchange = saveSettings;
    modal.querySelector("#vmShowForever").onchange = saveSettings;
    modal.querySelector("#vmPatterns").onblur = saveSettings;

    // Export
    modal.querySelector("#vmExport").onclick = () => {
      const json = JSON.stringify(DATA, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `eblan_marker_${DOMAIN}_${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast("💾 Сохраните файл...");
    };

    // Import
    modal.querySelector("#vmImport").onclick = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = (e) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const imported = JSON.parse(ev.target.result);
            if (imported.nicknames) DATA.nicknames = imported.nicknames;
            if (imported.profileMessages)
              DATA.profileMessages = imported.profileMessages;
            if (imported.settings)
              Object.assign(DATA.settings, imported.settings);
            saveData(DATA);
            pattern = buildPattern();
            renderLists();
            showToast("✓ Импорт успешен! Обновите страницу.");
          } catch (err) {
            showToast("Ошибка: " + err.message, true);
          }
        };
        reader.readAsText(e.target.files[0]);
      };
      input.click();
    };

    // Export All Sites
    modal.querySelector("#vmExportAll").onclick = () => {
      const allKeys = GM_listValues().filter((k) => k.startsWith("vm_"));
      const allData = {};
      for (const key of allKeys) {
        const raw = GM_getValue(key, null);
        if (raw) allData[key] = JSON.parse(raw);
      }
      const json = JSON.stringify(allData, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `eblan_marker_ALL_${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(`💾 Сохраните файл (${allKeys.length} сайтов)...`);
    };

    // Import All Sites
    modal.querySelector("#vmImportAll").onclick = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = (e) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const allData = JSON.parse(ev.target.result);
            let count = 0;
            for (const [key, val] of Object.entries(allData)) {
              if (key.startsWith("vm_") && val) {
                GM_setValue(key, JSON.stringify(val));
                count++;
              }
            }
            const currentRaw = GM_getValue(STORAGE_KEY, null);
            if (currentRaw) {
              const parsed = JSON.parse(currentRaw);
              Object.assign(DATA, parsed);
              pattern = buildPattern();
              renderLists();
            }
            showToast(`✓ Импортировано ${count} сайтов! Обновите страницу.`);
          } catch (err) {
            showToast("Ошибка: " + err.message, true);
          }
        };
        reader.readAsText(e.target.files[0]);
      };
      input.click();
    };

    // Refresh
    modal.querySelector("#vmRefresh").onclick = () => location.reload();
  }

  // ========== ЗАПУСК ==========

  const userId = getUserIdFromUrl();
  if (userId && DATA.profileMessages[userId]) {
    setTimeout(() => showCenterMessage(DATA.profileMessages[userId]), 300);
  }

  processNode(document.body);

  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (el && el.closest(`[${MARKER_ATTR}]`)) continue;
        processNode(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  createUI();
})();
