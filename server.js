const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SESSION_FILE = './quinyx-session.json';
const WORKERS_URL = 'https://web.quinyx.com/extapi/v1/employee/workersof/by-group/328231';

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const key of ['workers', 'employees', 'items', 'data', 'content', 'results']) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    return [payload];
  }
  return [];
}

function renderWorkersTableHtml(rawData, targetUrl) {
  const rows = extractRows(rawData);
  const columns = Array.from(
    rows.reduce((set, row) => {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        Object.keys(row).forEach((k) => set.add(k));
      }
      return set;
    }, new Set())
  );

  const theadHtml =
    columns.length > 0
      ? `<tr>${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join('')}</tr>`
      : '<tr><th>Data</th></tr>';

  const tbodyHtml =
    rows.length > 0
      ? rows
          .map((row) => {
            if (!row || typeof row !== 'object') {
              return `<tr><td>${escapeHtml(row)}</td></tr>`;
            }
            const cells = columns
              .map((col) => `<td>${escapeHtml(row[col])}</td>`)
              .join('');
            return `<tr>${cells}</tr>`;
          })
          .join('')
      : `<tr><td>Geen rijen gevonden in response</td></tr>`;

  return `
    <!DOCTYPE html>
    <html lang="nl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Quinyx Workers - Groep 328231</title>
      <style>
        body {
          font-family: system-ui, -apple-system, sans-serif;
          background: #121212;
          color: #ececec;
          margin: 0;
          padding: 2rem;
        }
        .card {
          background: #1c1c1e;
          border: 1px solid #2c2c2e;
          border-radius: 14px;
          padding: 1.5rem;
          max-width: 100%;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        }
        .header {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1.25rem;
        }
        h2 { margin: 0; font-size: 1.25rem; }
        .meta { color: #9a9aa0; font-size: 0.85rem; }
        a.btn {
          background: #2563eb;
          color: #fff;
          text-decoration: none;
          padding: 0.55rem 0.95rem;
          border-radius: 8px;
          font-size: 0.9rem;
          font-weight: 600;
        }
        .table-wrap {
          overflow-x: auto;
          border-radius: 10px;
          border: 1px solid #2c2c2e;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.88rem;
        }
        th, td {
          padding: 0.65rem 0.85rem;
          text-align: left;
          border-bottom: 1px solid #28282b;
          white-space: nowrap;
        }
        th {
          background: #242428;
          color: #f4f4f6;
          position: sticky;
          top: 0;
        }
        tr:hover td { background: #232327; }
        details {
          margin-top: 1.25rem;
          background: #161618;
          border: 1px solid #2a2a2d;
          border-radius: 10px;
          padding: 0.75rem 1rem;
        }
        summary { cursor: pointer; color: #93c5fd; font-weight: 600; }
        pre {
          margin-top: 0.75rem;
          overflow-x: auto;
          font-size: 0.8rem;
          color: #cbd5e1;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <div>
            <h2>Workers — Groep 328231 (${rows.length})</h2>
            <div class="meta">${escapeHtml(targetUrl)}</div>
          </div>
          <a class="btn" href="/">Opnieuw inloggen / verversen</a>
        </div>
        <div class="table-wrap">
          <table>
            <thead>${theadHtml}</thead>
            <tbody>${tbodyHtml}</tbody>
          </table>
        </div>
        <details>
          <summary>Ruwe JSON bekijken</summary>
          <pre>${escapeHtml(JSON.stringify(rawData, null, 2))}</pre>
        </details>
      </div>
    </body>
    </html>
  `;
}

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="nl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Quinyx Login & Workers</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #121212; color: #eee; display: grid; place-items: center; min-height: 100vh; margin: 0; }
        form { background: #1e1e1e; padding: 2rem; border-radius: 12px; width: 320px; display: flex; flex-direction: column; gap: 1rem; border: 1px solid #2e2e2e; }
        input, button { padding: 0.75rem; border-radius: 8px; border: 1px solid #383838; background: #282828; color: #fff; font-size: 0.95rem; }
        button { background: #2563eb; border: none; font-weight: 600; cursor: pointer; }
        button:hover { background: #1d4ed8; }
      </style>
    </head>
    <body>
      <form method="POST" action="/login">
        <h2>Quinyx Aanmelden</h2>
        <input type="email" name="username" placeholder="E-mailadres" required />
        <input type="password" name="password" placeholder="Wachtwoord" required />
        <button type="submit">Inloggen & Tabel Laden</button>
      </form>
    </body>
    </html>
  `);
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const isHeadless = process.env.HEADLESS === 'false' ? false : true;

  const browser = await chromium.launch({
    headless: isHeadless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  const context = await browser.newContext(
    Object.assign(
      {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      },
      fs.existsSync(SESSION_FILE) ? { storageState: SESSION_FILE } : {}
    )
  );

  const page = await context.newPage();

  try {
    await page.goto('https://web.quinyx.com/', { waitUntil: 'domcontentloaded' });

    // Alleen inloggen als we op de loginpagina terechtkomen
    if (page.url().includes('login.quinyx.com')) {
      const emailInput = page.locator('[data-test-id="emailOrProviderId"], #emailOrProviderId').first();
      await emailInput.waitFor({ state: 'visible', timeout: 20000 });
      await emailInput.fill(username);

      const continueButton = page.locator('[data-test-id="continue-btn"]').first();
      await continueButton.waitFor({ state: 'visible', timeout: 10000 });
      await continueButton.click();

      const passwordInput = page.locator('#password, input[type="password"]').first();
      await passwordInput.waitFor({ state: 'visible', timeout: 20000 });
      await passwordInput.fill(password);

      const loginButton = page.locator('[data-test-id="login-btn"]').first();
      await loginButton.waitFor({ state: 'visible', timeout: 10000 });
      await loginButton.click();

      await page.waitForURL('**/web.quinyx.com/**', { timeout: 30000 });
    }

    await page.waitForLoadState('networkidle');
    await context.storageState({ path: SESSION_FILE }).catch(() => {});

    // Haal het workers-endpoint op binnen de ingelogde browsercontext
    const apiResult = await page.evaluate(async (url) => {
      const resp = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json, text/plain, */*' }
      });
      const text = await resp.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_) {}
      return {
        status: resp.status,
        ok: resp.ok,
        json,
        text
      };
    }, WORKERS_URL);

    await browser.close();

    if (!apiResult.ok) {
      return res.status(apiResult.status || 500).send(`
        <body style="background:#121212;color:#eee;font-family:sans-serif;padding:2rem;">
          <h3>API fout (${apiResult.status}) bij ophalen van workers</h3>
          <pre>${escapeHtml(apiResult.text)}</pre>
        </body>
      `);
    }

    const payload = apiResult.json !== null ? apiResult.json : apiResult.text;
    res.send(renderWorkersTableHtml(payload, WORKERS_URL));
  } catch (err) {
    const buf = await page.screenshot({ fullPage: true }).catch(() => null);
    const imgTag = buf
      ? `<img src="data:image/png;base64,${buf.toString('base64')}" style="max-width:100%;border:1px solid #444;" />`
      : '';

    await browser.close().catch(() => {});

    res.status(500).send(`
      <body style="background:#121212;color:#eee;font-family:sans-serif;padding:1.5rem;">
        <h3>Fout: ${escapeHtml(err.message)}</h3>
        ${imgTag}
      </body>
    `);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server actief op poort ${PORT}`);
});
