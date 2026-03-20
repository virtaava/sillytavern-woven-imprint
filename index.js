/**
 * Woven Imprint — SillyTavern UI Extension
 *
 * Hooks into the ST chat pipeline to:
 * 1. Record every user/assistant message to woven-imprint (fire-and-forget)
 * 2. Inject persistent memory context before generation via setExtensionPrompt()
 * 3. Provide a settings panel with enable/disable, injection depth, max memories
 *
 * Talks directly to the woven-imprint sidecar (default http://127.0.0.1:8765).
 * No server plugin required.
 */

const DEFAULT_SIDECAR_URL = 'http://127.0.0.1:8765';

const DEFAULT_SETTINGS = {
    enabled: true,
    sidecarUrl: DEFAULT_SIDECAR_URL,
    injectionDepth: 2,
    maxMemories: 10,
};

let settings = { ...DEFAULT_SETTINGS };

// Track which character names have already been created in woven-imprint
// to avoid redundant creation requests within a session.
const knownCharacters = new Set();

// ---------------------------------------------------------------------------
// Helpers — direct sidecar calls (no server plugin needed)
// ---------------------------------------------------------------------------

function getSidecarUrl() {
    return (settings.sidecarUrl || DEFAULT_SIDECAR_URL).replace(/\/+$/, '');
}

async function sidecarGet(path) {
    const res = await fetch(`${getSidecarUrl()}${path}`);
    return res.json();
}

async function sidecarPost(path, body) {
    const res = await fetch(`${getSidecarUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}

/**
 * Load settings from ST's extension settings store.
 */
function loadSettings() {
    const ctx = SillyTavern.getContext();
    const stored = ctx.extensionSettings['woven_imprint'];
    if (stored) {
        settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    }
    saveSettings();
}

/**
 * Persist settings to ST's extension settings store.
 */
function saveSettings() {
    const ctx = SillyTavern.getContext();
    ctx.extensionSettings['woven_imprint'] = settings;
    ctx.saveSettingsDebounced();
}

/**
 * Get the current character name from ST context, or null.
 */
function getCurrentCharacterName() {
    const ctx = SillyTavern.getContext();
    if (ctx.characterId !== undefined && ctx.characters && ctx.characters[ctx.characterId]) {
        return ctx.characters[ctx.characterId].name;
    }
    return null;
}

/**
 * Ensure the current ST character card exists in woven-imprint.
 * Uses the /characters list endpoint for dedup, creates if missing.
 */
async function ensureCharacterExists(charName) {
    if (!charName || knownCharacters.has(charName)) {
        return;
    }

    try {
        const result = await sidecarGet('/characters');
        const chars = result.characters || result || [];
        const names = Array.isArray(chars) ? chars.map(c => c.name || c) : [];
        if (names.includes(charName)) {
            knownCharacters.add(charName);
            return;
        }

        // Build a minimal character from the ST card
        const ctx = SillyTavern.getContext();
        const card = ctx.characters[ctx.characterId];
        await sidecarPost('/characters', {
            name: charName,
            persona: card?.description || '',
            personality: card?.personality || '',
        });
        knownCharacters.add(charName);
    } catch (err) {
        console.warn('[Woven Imprint] Failed to ensure character:', err);
    }
}

// ---------------------------------------------------------------------------
// Message recording (fire-and-forget)
// ---------------------------------------------------------------------------

function recordMessage(role, content) {
    if (!settings.enabled) return;
    const charName = getCurrentCharacterName();
    if (!charName) return;

    // Fire and forget — errors are swallowed
    sidecarPost('/record', {
        character_id: charName,
        role,
        content,
        user_id: 'st_user',
    }).catch(err => {
        console.warn('[Woven Imprint] Record failed (non-fatal):', err);
    });
}

// ---------------------------------------------------------------------------
// Memory injection via setExtensionPrompt (version-safe approach)
// ---------------------------------------------------------------------------

/**
 * Query woven-imprint for memory context and inject it into the prompt
 * via setExtensionPrompt(). This is the recommended approach used by
 * ST's built-in memory extensions.
 */
async function injectMemoryContext() {
    if (!settings.enabled) return;
    const charName = getCurrentCharacterName();
    if (!charName) return;

    try {
        await ensureCharacterExists(charName);

        const memData = await sidecarGet(
            `/memory?character_id=${encodeURIComponent(charName)}&user_id=st_user&query=recent&limit=${settings.maxMemories}`
        );

        const memoryContext = memData.context || '';
        if (!memoryContext) return;

        const {
            setExtensionPrompt,
            extension_prompt_types,
            extension_prompt_roles,
        } = SillyTavern.getContext();

        setExtensionPrompt(
            'woven_imprint_memory',
            memoryContext,
            extension_prompt_types.IN_CHAT,
            settings.injectionDepth,
            extension_prompt_roles.SYSTEM,
        );
    } catch (err) {
        console.warn('[Woven Imprint] Memory injection failed (non-fatal):', err);
    }
}

// Register the interceptor on globalThis so ST's generation pipeline
// can discover and invoke it.
globalThis.wovenImprintInterceptor = async function () {
    await injectMemoryContext();
};

// ---------------------------------------------------------------------------
// Sidecar health check for the settings panel
// ---------------------------------------------------------------------------

async function checkSidecarStatus() {
    const indicator = document.getElementById('wi-status-indicator');
    const label = document.getElementById('wi-status-label');
    if (!indicator || !label) return;

    try {
        const result = await sidecarGet('/health');
        if (result.status === 'ok') {
            indicator.className = 'wi-status-dot wi-status-ok';
            label.textContent = `Connected (v${result.version || '?'})`;
        } else {
            indicator.className = 'wi-status-dot wi-status-err';
            label.textContent = 'Unexpected response';
        }
    } catch {
        indicator.className = 'wi-status-dot wi-status-err';
        label.textContent = 'Unreachable — run: woven-imprint sidecar';
    }
}

// ---------------------------------------------------------------------------
// Settings panel UI
// ---------------------------------------------------------------------------

function createSettingsPanel() {
    const html = `
    <div id="wi-settings" class="wi-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Woven Imprint</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="wi-status-row">
                    <span>Sidecar:</span>
                    <span id="wi-status-indicator" class="wi-status-dot wi-status-unknown"></span>
                    <span id="wi-status-label">Checking...</span>
                    <button id="wi-refresh-status" class="menu_button" title="Refresh">
                        <i class="fa-solid fa-arrows-rotate"></i>
                    </button>
                </div>
                <hr>
                <label class="checkbox_label">
                    <input id="wi-enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}>
                    <span>Enable memory injection</span>
                </label>
                <div class="wi-setting-row">
                    <label for="wi-sidecar-url">Sidecar URL</label>
                    <input id="wi-sidecar-url" type="text" class="text_pole"
                           value="${settings.sidecarUrl}" placeholder="${DEFAULT_SIDECAR_URL}">
                </div>
                <div class="wi-setting-row">
                    <label for="wi-depth">Injection depth</label>
                    <input id="wi-depth" type="range" min="0" max="10" step="1"
                           value="${settings.injectionDepth}">
                    <span id="wi-depth-val">${settings.injectionDepth}</span>
                </div>
                <div class="wi-setting-row">
                    <label for="wi-max-mem">Max memories</label>
                    <input id="wi-max-mem" type="range" min="1" max="50" step="1"
                           value="${settings.maxMemories}">
                    <span id="wi-max-mem-val">${settings.maxMemories}</span>
                </div>
            </div>
        </div>
    </div>`;

    const container = document.getElementById('extensions_settings');
    if (container) {
        container.insertAdjacentHTML('beforeend', html);
    }

    // Bind events
    document.getElementById('wi-enabled')?.addEventListener('change', (e) => {
        settings.enabled = e.target.checked;
        saveSettings();
    });

    document.getElementById('wi-sidecar-url')?.addEventListener('change', (e) => {
        settings.sidecarUrl = e.target.value.trim() || DEFAULT_SIDECAR_URL;
        saveSettings();
        checkSidecarStatus();
    });

    document.getElementById('wi-depth')?.addEventListener('input', (e) => {
        settings.injectionDepth = parseInt(e.target.value, 10);
        document.getElementById('wi-depth-val').textContent = settings.injectionDepth;
        saveSettings();
    });

    document.getElementById('wi-max-mem')?.addEventListener('input', (e) => {
        settings.maxMemories = parseInt(e.target.value, 10);
        document.getElementById('wi-max-mem-val').textContent = settings.maxMemories;
        saveSettings();
    });

    document.getElementById('wi-refresh-status')?.addEventListener('click', checkSidecarStatus);

    // Initial status check
    checkSidecarStatus();
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

(function main() {
    const ctx = SillyTavern.getContext();

    loadSettings();
    createSettingsPanel();

    // Record user messages
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_SENT, (messageIndex) => {
        const msg = ctx.chat[messageIndex];
        if (msg) {
            recordMessage('user', msg.mes || msg.content || '');
        }
    });

    // Record assistant messages
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_RECEIVED, (messageIndex) => {
        const msg = ctx.chat[messageIndex];
        if (msg) {
            recordMessage('assistant', msg.mes || msg.content || '');
        }
    });

    // Pre-load memory when chat changes
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
        knownCharacters.clear();
        injectMemoryContext();
    });

    // Inject memory before every generation
    ctx.eventSource.on(ctx.eventTypes.GENERATION_STARTED, () => {
        injectMemoryContext();
    });

    console.log('[Woven Imprint] Extension loaded — sidecar:', getSidecarUrl());
})();
