// ==UserScript==
// @name         forzajuve.ru
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  Центрированная надпись по ID профиля + подсветка ников
// @match        forzajuve.ru/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ========== НАСТРОЙКИ ==========

    // Список ников и их прозвищ для подсветки
    let nicknames = {
        // "sergunka79": "КОММЕНТАРИЙ"
        // Добавляйте другие ники сюда
    };

    // ⚡⚡⚡ СПИСОК ПРОФИЛЕЙ ДЛЯ ЦЕНТРИРОВАННОЙ НАДПИСИ ⚡⚡⚡
    // Формат: "ID_пользователя": "Текст надписи"
    let profileMessages = {
        //"5820922": "ВАТНИК-ДОЛБОЕБ", // satwalker
    };

    // Настройки подсветки ников
    const nickConfig = {
        color: "#ff0000",        // Цвет текста в скобках
        bold: true,              // Жирный шрифт
        spaceBefore: true,       // Пробел перед скобками
        caseInsensitive: true    // Искать независимо от регистра
    };

    // Настройки центрированной надписи
    const centerConfig = {
        showForever: true,        // true = всегда, false = скрыть через N секунд
        autoHideSeconds: 5,       // Если showForever = false
        style: {
            color: "#ff0000",
            fontSize: "48px",
            backgroundColor: "#000",
            borderColor: "#ff0000"
        }
    };

    // ========== КОД ==========

    // Функция сохранения в localStorage
    function saveToStorage() {
        localStorage.setItem('nnm_nicknames', JSON.stringify(nicknames));
        localStorage.setItem('nnm_profileMessages', JSON.stringify(profileMessages));
    }

    // Функция загрузки из localStorage
    function loadFromStorage() {
        const savedNicknames = localStorage.getItem('nnm_nicknames');
        const savedProfileMessages = localStorage.getItem('nnm_profileMessages');

        if (savedNicknames) {
            Object.assign(nicknames, JSON.parse(savedNicknames));
        }
        if (savedProfileMessages) {
            Object.assign(profileMessages, JSON.parse(savedProfileMessages));
        }
    }

    // ⚡ ИСПРАВЛЕНИЕ: загружаем сохранённые данные ПЕРВЫМ ДЕЛОМ,
    // до построения паттерна и до любой обработки страницы
    loadFromStorage();

    // Функция для получения ID пользователя из URL
    function getUserIdFromUrl(url) {
        const match = url.match(/[?&]u=(\d+)/);
        return match ? match[1] : null;
    }

    // Показ центрированной надписи
    function showCenterMessage(text) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 10000;
            pointer-events: none;
        `;

        const message = document.createElement('div');
        message.textContent = text;
        message.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: ${centerConfig.style.color};
            font-size: ${centerConfig.style.fontSize};
            font-weight: bold;
            font-family: Arial, sans-serif;
            text-align: center;
            white-space: nowrap;
            padding: 20px 40px;
            background-color: rgba(0, 0, 0, 0.85);
            border: 3px solid ${centerConfig.style.borderColor};
            border-radius: 15px;
            box-shadow: 0 0 30px rgba(0,0,0,0.5);
            z-index: 10001;
            text-transform: uppercase;
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(message);

        if (!centerConfig.showForever) {
            setTimeout(() => {
                overlay.remove();
                message.remove();
            }, centerConfig.autoHideSeconds * 1000);
        }
    }

    // ⚡ ИСПРАВЛЕНИЕ: строим паттерн ПОСЛЕ загрузки данных из localStorage,
    // чтобы добавленные через панель ники тоже попали в поиск
    function buildSearchPattern() {
        const keys = Object.keys(nicknames);
        if (keys.length === 0) return null;
        const flags = nickConfig.caseInsensitive ? 'gi' : 'g';
        return new RegExp(`(${keys.join('|')})`, flags);
    }

    let searchPattern = buildSearchPattern();

    function getNickname(matchedNick) {
        const lowerNick = matchedNick.toLowerCase();
        for (let [nick, label] of Object.entries(nicknames)) {
            if (nick.toLowerCase() === lowerNick) {
                return label;
            }
        }
        return "";
    }

    // Теги, внутри которых нельзя трогать текст
    const SKIP_TAGS = new Set(['TEXTAREA', 'INPUT', 'SCRIPT', 'STYLE', 'NOSCRIPT']);

    function processNode(node) {
        if (!searchPattern) return;

        if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute('data-nnm-watcher')) {
            return;
        }

        // Пропускаем элементы, которые нельзя оборачивать в span
        if (node.nodeType === Node.ELEMENT_NODE && SKIP_TAGS.has(node.tagName)) {
            return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            const nicksList = Object.keys(nicknames);
            let hasAnyNick = false;
            for (let nick of nicksList) {
                const searchText = nickConfig.caseInsensitive ? text.toLowerCase() : text;
                const nickLower = nickConfig.caseInsensitive ? nick.toLowerCase() : nick;
                if (searchText.includes(nickLower)) {
                    hasAnyNick = true;
                    break;
                }
            }

            if (hasAnyNick) {
                const parent = node.parentElement;
                // Дополнительно проверяем родителя — вдруг текстовый узел прямой ребёнок textarea/input
                if (parent && !parent.hasAttribute('data-nnm-watcher') && !SKIP_TAGS.has(parent.tagName)) {
                    const parts = [];
                    let lastIndex = 0;
                    searchPattern.lastIndex = 0;
                    let match;
                    const textCopy = text;

                    while ((match = searchPattern.exec(textCopy)) !== null) {
                        if (match.index > lastIndex) {
                            parts.push({
                                type: 'text',
                                content: textCopy.substring(lastIndex, match.index)
                            });
                        }

                        const foundNick = match[0];
                        parts.push({
                            type: 'nick',
                            content: foundNick,
                            label: getNickname(foundNick)
                        });

                        lastIndex = match.index + match[0].length;
                    }

                    if (lastIndex < textCopy.length) {
                        parts.push({
                            type: 'text',
                            content: textCopy.substring(lastIndex)
                        });
                    }

                    const span = document.createElement('span');
                    span.setAttribute('data-nnm-watcher', 'true');

                    for (let part of parts) {
                        if (part.type === 'text') {
                            span.appendChild(document.createTextNode(part.content));
                        } else {
                            span.appendChild(document.createTextNode(part.content));
                            const suffixSpan = document.createElement('span');
                            const space = nickConfig.spaceBefore ? " " : "";
                            suffixSpan.textContent = `${space}(${part.label})`;
                            suffixSpan.style.color = nickConfig.color;
                            if (nickConfig.bold) {
                                suffixSpan.style.fontWeight = "bold";
                            }
                            span.appendChild(suffixSpan);
                        }
                    }

                    parent.replaceChild(span, node);
                }
            }
        }
        else if (node.nodeType === Node.ELEMENT_NODE && node.childNodes) {
            node.childNodes.forEach(child => processNode(child));
        }
    }

    // ========== ЗАПУСК ==========

    // Проверяем ID профиля и показываем надпись
    const currentUrl = window.location.href;
    const userId = getUserIdFromUrl(currentUrl);

    if (userId && profileMessages[userId]) {
        setTimeout(() => {
            showCenterMessage(profileMessages[userId]);
        }, 300);
    }

    // Запускаем подсветку ников
    processNode(document.body);

    // Наблюдатель за новым контентом
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                // Пропускаем узлы внутри модалки и других защищённых элементов
                const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
                if (el && el.closest('[data-nnm-watcher]')) return;

                if (node.nodeType === Node.ELEMENT_NODE) {
                    processNode(node);
                } else if (node.nodeType === Node.TEXT_NODE) {
                    processNode(node);
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });


    // ========== ПАНЕЛЬ УПРАВЛЕНИЯ ==========

    // Кастомное уведомление вместо alert
    function showToast(message, isError = false) {
        const existing = document.getElementById('nnmToast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'nnmToast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 20px;
            background: #1a1a1a;
            color: ${isError ? '#ff6666' : '#ffffff'};
            border: 2px solid ${isError ? '#ff4444' : '#ff0000'};
            border-radius: 8px;
            padding: 12px 20px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            font-weight: bold;
            z-index: 10010;
            box-shadow: 0 0 20px rgba(0,0,0,0.6);
            opacity: 0;
            transition: opacity 0.3s ease;
            max-width: 300px;
        `;
        document.body.appendChild(toast);

        // Плавное появление
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
        });

        // Плавное исчезновение через 3 секунды
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Экспорт данных
    function exportData() {
        const data = {
            nicknames: nicknames,
            profileMessages: profileMessages,
            date: new Date().toISOString()
        };
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nnm_backup_${Date.now()}.json`;

        // Уведомление только после реального клика (т.е. после инициации скачивания)
        a.addEventListener('click', () => {
            setTimeout(() => {
                URL.revokeObjectURL(url);
                showToast('✅ Данные экспортированы!');
            }, 500);
        });

        a.click();
    }

    // Импорт данных
    function importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    Object.keys(nicknames).forEach(key => delete nicknames[key]);
                    Object.keys(profileMessages).forEach(key => delete profileMessages[key]);
                    Object.assign(nicknames, data.nicknames);
                    Object.assign(profileMessages, data.profileMessages);
                    saveToStorage();
                    if (typeof updateListsDisplay === 'function') {
                        updateListsDisplay();
                    }
                    showToast('✅ Данные восстановлены! Обновите страницу.');
                } catch(err) {
                    showToast('❌ Ошибка при импорте: ' + err.message, true);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // Функция экранирования HTML
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

    // Функция обновления списков в модалке
    function updateListsDisplay() {
        const nickDiv = document.getElementById('nicknamesList');
        const profileDiv = document.getElementById('profileList');

        if (!nickDiv || !profileDiv) return;

        nickDiv.innerHTML = '';
        for (const [nick, label] of Object.entries(nicknames)) {
            nickDiv.innerHTML += `
                <div style="display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px solid #333;">
                    <span style="word-break:break-all;"><strong>${escapeHtml(nick)}</strong> → ${escapeHtml(label)}</span>
                    <button data-nick="${escapeHtml(nick)}" class="deleteNick" style="background:#ff0000; color:white; border:none; border-radius:3px; padding:0 5px; cursor:pointer;">✖</button>
                </div>
            `;
        }

        profileDiv.innerHTML = '';
        for (const [id, text] of Object.entries(profileMessages)) {
            profileDiv.innerHTML += `
                <div style="display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px solid #333;">
                    <span style="word-break:break-all;"><strong>${escapeHtml(id)}</strong> → ${escapeHtml(text)}</span>
                    <button data-id="${escapeHtml(id)}" class="deleteProfile" style="background:#ff0000; color:white; border:none; border-radius:3px; padding:0 5px; cursor:pointer;">✖</button>
                </div>
            `;
        }

        document.querySelectorAll('.deleteNick').forEach(btn => {
            btn.onclick = () => {
                delete nicknames[btn.dataset.nick];
                saveToStorage();
                updateListsDisplay();
            };
        });

        document.querySelectorAll('.deleteProfile').forEach(btn => {
            btn.onclick = () => {
                delete profileMessages[btn.dataset.id];
                saveToStorage();
                updateListsDisplay();
            };
        });
    }

    // Функция создания панели
    function createAdminPanel() {
        if (document.getElementById('nnmAdminBtn')) return;

        const adminBtn = document.createElement('button');
        adminBtn.id = 'nnmAdminBtn';
        adminBtn.textContent = '⚙️';
        adminBtn.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            width: 45px;
            height: 45px;
            border-radius: 50%;
            background-color: #333;
            color: white;
            border: 2px solid #ff0000;
            font-size: 24px;
            cursor: pointer;
            z-index: 10002;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            transition: all 0.3s;
        `;
        adminBtn.onmouseover = () => adminBtn.style.transform = 'scale(1.1)';
        adminBtn.onmouseout = () => adminBtn.style.transform = 'scale(1)';

        const modal = document.createElement('div');
        modal.id = 'nnmAdminModal';
        modal.setAttribute('data-nnm-watcher', 'true');
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 450px;
            max-width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            background: #1a1a1a;
            border: 2px solid #ff0000;
            border-radius: 10px;
            padding: 20px;
            z-index: 10003;
            display: none;
            color: white;
            font-family: Arial, sans-serif;
            box-shadow: 0 0 50px rgba(0,0,0,0.8);
        `;

        modal.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                <h3 style="margin: 0; color: #ff0000;">⚙️ Управление списками</h3>
                <button id="closeModal" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer;">✖</button>
            </div>

            <div style="margin-bottom: 20px;">
                <h4>📝 Подсветка ников (nicknames)</h4>
                <div id="nicknamesList" style="max-height: 150px; overflow-y: auto; margin-bottom: 10px; font-size: 12px; background:#0d0d0d; padding:5px; border-radius:5px;"></div>
                <div style="display: flex; gap: 5px;">
                    <input type="text" id="newNick" placeholder="НИК" style="flex:1; padding:5px; background:#333; color:white; border:1px solid #666; border-radius:3px;">
                    <input type="text" id="newNickLabel" placeholder="ТЕКСТ" style="flex:1; padding:5px; background:#333; color:white; border:1px solid #666; border-radius:3px;">
                    <button id="addNick" style="background:#ff0000; color:white; border:none; padding:5px 10px; border-radius:3px; cursor:pointer;">+</button>
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <h4>🎯 Центрированные надписи в профиле</h4>
                <div id="profileList" style="max-height: 150px; overflow-y: auto; margin-bottom: 10px; font-size: 12px; background:#0d0d0d; padding:5px; border-radius:5px;"></div>
                <div style="display: flex; gap: 5px;">
                    <input type="text" id="newProfileId" placeholder="ID (например 5820922)" style="flex:1; padding:5px; background:#333; color:white; border:1px solid #666; border-radius:3px;">
                    <input type="text" id="newProfileText" placeholder="ТЕКСТ" style="flex:1; padding:5px; background:#333; color:white; border:1px solid #666; border-radius:3px;">
                    <button id="addProfile" style="background:#ff0000; color:white; border:none; padding:5px 10px; border-radius:3px; cursor:pointer;">+</button>
                </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 8px;">
                <button id="exportData" style="background:#00aa00; color:white; border:none; padding:8px; border-radius:5px; cursor:pointer;">📥 Экспорт (сохранить в файл)</button>
                <button id="importData" style="background:#ffaa00; color:black; border:none; padding:8px; border-radius:5px; cursor:pointer;">📤 Импорт (восстановить из файла)</button>
                <button id="refreshPage" style="background:#333; color:white; border:1px solid #ff0000; padding:8px; border-radius:5px; cursor:pointer;">🔄 Обновить страницу (применить)</button>
            </div>
        `;

        document.body.appendChild(adminBtn);
        document.body.appendChild(modal);

        document.getElementById('closeModal').onclick = () => modal.style.display = 'none';
        document.getElementById('addNick').onclick = () => {
            const nick = document.getElementById('newNick').value.trim();
            const label = document.getElementById('newNickLabel').value.trim();
            if (nick && label) {
                nicknames[nick] = label;
                saveToStorage();
                updateListsDisplay();
                document.getElementById('newNick').value = '';
                document.getElementById('newNickLabel').value = '';
            } else {
                alert('Заполните оба поля');
            }
        };
        document.getElementById('addProfile').onclick = () => {
            const id = document.getElementById('newProfileId').value.trim();
            const text = document.getElementById('newProfileText').value.trim();
            if (id && text) {
                profileMessages[id] = text;
                saveToStorage();
                updateListsDisplay();
                document.getElementById('newProfileId').value = '';
                document.getElementById('newProfileText').value = '';
            } else {
                alert('Заполните оба поля');
            }
        };
        document.getElementById('refreshPage').onclick = () => location.reload();
        document.getElementById('exportData').onclick = exportData;
        document.getElementById('importData').onclick = importData;

        adminBtn.onclick = () => {
            updateListsDisplay();
            modal.style.display = 'block';
        };

        window.addEventListener('click', (event) => {
            if (event.target === modal) modal.style.display = 'none';
        });
    }

    // Авторезервное копирование (раз в день)
    setInterval(() => {
        const lastBackup = localStorage.getItem('nnm_lastBackup');
        const now = Date.now();
        if (!lastBackup || now - parseInt(lastBackup) > 86400000) {
            const data = {
                nicknames: nicknames,
                profileMessages: profileMessages
            };
            localStorage.setItem('nnm_hiddenBackup', JSON.stringify(data));
            localStorage.setItem('nnm_lastBackup', now.toString());
            console.log('[NNM] Авторезервное копирование выполнено');
        }
    }, 3600000);

    // Запуск панели
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createAdminPanel);
    } else {
        createAdminPanel();
    }

})();