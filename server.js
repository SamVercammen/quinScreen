const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SESSION_FILE = './quinyx-session.json';

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="nl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Quinyx Login Test</title>
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
        <button type="submit">Test Aanmelden</button>
      </form>
    </body>
    </html>
  `);
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // Op Render altijd headless: true; lokaal eventueel op false zetten om mee te kijken
  const isHeadless = process.env.HEADLESS === 'false' ? false : true;

  const browser = await chromium.launch({
    headless: isHeadless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    await page.goto('https://web.quinyx.com/', { waitUntil: 'networkidle' });

    // Stap 1: E-mailadres invullen en doorgaan naar het wachtwoordscherm
    const emailInput = page.locator('input[type="email"], input[name="username"], input[name="email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 15000 });
    await emailInput.fill(username);

    const nextButton = page.locator('button[type="submit"], button:has-text("Next"), button:has-text("Volgende"), button:has-text("Continue")').first();
    await nextButton.click();

    // Stap 2: Wachtwoordveld afwachten en invullen
    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.waitFor({ state: 'visible', timeout: 15000 });
    await passwordInput.fill(password);

    const loginButton = page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Inloggen"), button:has-text("Sign in")').first();
    await loginButton.click();

    // Wacht tot we op web.quinyx.com zitten
    await page.waitForURL('**/web.quinyx.com/**', { timeout: 30000 });
    await page.waitForLoadState('networkidle');

    await context.storageState({ path: SESSION_FILE });
    const huidigeUrl = page.url();

    await browser.close();

    res.json({
      gelukt: true,
      urlNaLogin: huidigeUrl,
      sessieOpgeslagen: true
    });
  } catch (err) {
    // Maak bij een fout een screenshot zodat je op Render/headless ziet waar hij bleef hangen
    let foutScreenshot = null;
    try {
      const buf = await page.screenshot({ fullPage: true });
      foutScreenshot = `data:image/png;base64,${buf.toString('base64')}`;
    } catch (_) {}

    await browser.close();

    res.status(500).json({
      gelukt: false,
      foutmelding: err.message,
      foutScreenshot
    });
  }
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server draait op poort ${PORT}`);
});
