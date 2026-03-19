/**
 * Woven Imprint — SillyTavern Server Plugin
 *
 * Proxies requests from the ST UI extension to the woven-imprint Python
 * sidecar (default http://127.0.0.1:8765). Uses only Node.js built-in
 * modules (no npm dependencies).
 *
 * Every endpoint degrades gracefully on sidecar errors so that ST chat
 * is never blocked or broken by a woven-imprint outage.
 */

const http = require('http');
const { URL } = require('url');

const SIDECAR_URL = process.env.WOVEN_IMPRINT_URL || 'http://127.0.0.1:8765';
const TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// HTTP helper — zero-dependency proxy to the sidecar
// ---------------------------------------------------------------------------

/**
 * Make an HTTP request to the sidecar.
 * @param {string} method
 * @param {string} path   — path appended to SIDECAR_URL
 * @param {object|null} body — JSON body (POST only)
 * @returns {Promise<{status: number, data: any}>}
 */
function sidecarRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, SIDECAR_URL);
        const payload = body != null ? JSON.stringify(body) : null;

        const opts = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            timeout: TIMEOUT_MS,
            headers: {
                'Accept': 'application/json',
            },
        };

        if (payload) {
            opts.headers['Content-Type'] = 'application/json';
            opts.headers['Content-Length'] = Buffer.byteLength(payload);
        }

        const req = http.request(opts, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString();
                let data;
                try {
                    data = JSON.parse(raw);
                } catch {
                    data = raw;
                }
                resolve({ status: res.statusCode, data });
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Sidecar request timed out'));
        });

        req.on('error', (err) => reject(err));

        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

const info = {
    id: 'sillytavern-woven-imprint',
    name: 'Woven Imprint',
    description: 'Persistent character memory bridge via woven-imprint sidecar',
};

/**
 * Called by SillyTavern to register routes.
 * @param {import('express').Router} router
 */
function init(router) {
    // --- Health check ---
    router.get('/health', async (_req, res) => {
        try {
            const result = await sidecarRequest('GET', '/health');
            return res.json({ ok: true, sidecar: result.data });
        } catch (err) {
            return res.json({ ok: false, error: err.message });
        }
    });

    // --- Create character ---
    router.post('/characters', async (req, res) => {
        try {
            const result = await sidecarRequest('POST', '/characters', req.body);
            return res.status(result.status).json(result.data);
        } catch (err) {
            return res.status(502).json({ error: err.message });
        }
    });

    // --- List characters ---
    router.get('/characters', async (_req, res) => {
        try {
            const result = await sidecarRequest('GET', '/characters');
            return res.json(result.data);
        } catch (err) {
            // Graceful degradation — return empty list
            return res.json([]);
        }
    });

    // --- Record message (fire-and-forget friendly) ---
    router.post('/record', async (req, res) => {
        try {
            const result = await sidecarRequest('POST', '/record', req.body);
            return res.status(result.status).json(result.data);
        } catch (err) {
            // Non-blocking: acknowledge even on error
            return res.json({ recorded: false, error: err.message });
        }
    });

    // --- Query memory ---
    router.get('/memory', async (req, res) => {
        try {
            // Forward query params
            const qs = new URLSearchParams(req.query).toString();
            const path = qs ? `/memory?${qs}` : '/memory';
            const result = await sidecarRequest('GET', path);
            return res.json(result.data);
        } catch (err) {
            // Graceful degradation — return empty context
            return res.json({ memories: [], context: '' });
        }
    });

    // --- Get relationship ---
    router.get('/relationships/:charId/:targetId', async (req, res) => {
        try {
            const { charId, targetId } = req.params;
            const result = await sidecarRequest('GET', `/relationships/${encodeURIComponent(charId)}/${encodeURIComponent(targetId)}`);
            return res.json(result.data);
        } catch (err) {
            return res.json({ relationship: null, error: err.message });
        }
    });

    // --- Start session ---
    router.post('/characters/:charId/session', async (req, res) => {
        try {
            const { charId } = req.params;
            const result = await sidecarRequest('POST', `/characters/${encodeURIComponent(charId)}/session`, req.body);
            return res.status(result.status).json(result.data);
        } catch (err) {
            return res.status(502).json({ error: err.message });
        }
    });

    // --- End session ---
    router.delete('/characters/:charId/session', async (req, res) => {
        try {
            const { charId } = req.params;
            const result = await sidecarRequest('DELETE', `/characters/${encodeURIComponent(charId)}/session`);
            return res.status(result.status).json(result.data);
        } catch (err) {
            return res.status(502).json({ error: err.message });
        }
    });

    console.log(`[Woven Imprint] Plugin loaded — sidecar at ${SIDECAR_URL}`);
}

/**
 * Called by SillyTavern on shutdown.
 */
function exit() {
    console.log('[Woven Imprint] Plugin unloaded');
}

module.exports = { init, exit, info };
