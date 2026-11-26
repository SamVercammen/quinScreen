const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const QUINYX_LOGIN_URL =
  process.env.QUINYX_LOGIN_URL || "https://web.quinyx.com/extapi/v1/login";
const QUINYX_WORKERS_URL =
  process.env.QUINYX_WORKERS_URL ||
  "https://web.quinyx.com/extapi/v1/employee/workersof/by-group/328231";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Request- en foutlogger voor Render logs
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Sessiestatus in geheugen (reset wanneer Render free service in slaap valt/herstart)
let quinyxSession = {
  token: null,
  cookieHeader: null,
  updatedAt: null
};

function logError(context, err, extra = {}) {
  console.error(`[ERROR][${context}]`, {
    message: err?.message || String(err),
    stack: err?.stack || null,
    ...extra
  });
}

function extractCookieHeader(response) {
  if (typeof response.headers.getSetCookie === "function") {
    const cookies = response.headers.getSetCookie();
    if (cookies && cookies.length > 0) {
      return cookies.map((c) => c.split(";")[0]).join("; ");
    }
  }
  const raw = response.headers.get("set-cookie");
  return raw ? raw.split(";")[0] : null;
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    console.warn("[WARN][/api/login] Ontbrekende username of password");
    return res
      .status(400)
      .json({ error: "Gebruikersnaam en wachtwoord zijn verplicht." });
  }

  try {
    console.log(`[INFO][/api/login] Login-poging naar ${QUINYX_LOGIN_URL}`);

    const quinyxRes = await fetch(QUINYX_LOGIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (compatible; QuinyxProxy/1.0)"
      },
      // Pas sleutels aan indien Quinyx bv. "email" of "userName" verwacht
      body: JSON.stringify({ username, password })
    });

    const payload = await parseResponseBody(quinyxRes);

    if (!quinyxRes.ok) {
      console.error("[ERROR][/api/login] Quinyx wees login af", {
        status: quinyxRes.status,
        statusText: quinyxRes.statusText,
        payload
      });
      return res.status(quinyxRes.status).json({
        error: `Login bij Quinyx mislukt (HTTP ${quinyxRes.status}).`,
        details: payload
      });
    }

    const token =
      payload?.token ||
      payload?.accessToken ||
      payload?.sessionId ||
      payload?.data?.token ||
      null;

    const cookieHeader = extractCookieHeader(quinyxRes);

    quinyxSession = {
      token,
      cookieHeader,
      updatedAt: new Date().toISOString()
    };

    console.log("[INFO][/api/login] Login geslaagd", {
      hasToken: Boolean(token),
      hasCookie: Boolean(cookieHeader),
      updatedAt: quinyxSession.updatedAt
    });

    return res.json({
      authenticated: true,
      hasToken: Boolean(token),
      hasCookie: Boolean(cookieHeader),
      updatedAt: quinyxSession.updatedAt
    });
  } catch (err) {
    logError("/api/login", err, { loginUrl: QUINYX_LOGIN_URL });
    return res.status(502).json({
      error: "Kon geen verbinding maken met Quinyx login-endpoint.",
      message: err.message
    });
  }
});

app.get("/api/session", (_req, res) => {
  const active = Boolean(quinyxSession.token || quinyxSession.cookieHeader);
  res.json({
    authenticated: active,
    hasToken: Boolean(quinyxSession.token),
    hasCookie: Boolean(quinyxSession.cookieHeader),
    updatedAt: quinyxSession.updatedAt
  });
});

app.get("/api/workers", async (_req, res) => {
  if (!quinyxSession.token && !quinyxSession.cookieHeader) {
    console.warn("[WARN][/api/workers] Geen actieve sessie op server");
    return res
      .status(401)
      .json({ error: "Geen actieve Quinyx-sessie. Log eerst in." });
  }

  const headers = {
    Accept: "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (compatible; QuinyxProxy/1.0)"
  };

  if (quinyxSession.token) {
    headers["Authorization"] = `Bearer ${quinyxSession.token}`;
  }
  if (quinyxSession.cookieHeader) {
    headers["Cookie"] = quinyxSession.cookieHeader;
  }

  try {
    console.log(`[INFO][/api/workers] Ophalen van ${QUINYX_WORKERS_URL}`);

    const quinyxRes = await fetch(QUINYX_WORKERS_URL, {
      method: "GET",
      headers
    });

    const data = await parseResponseBody(quinyxRes);

    if (quinyxRes.status === 401 || quinyxRes.status === 403) {
      console.warn("[WARN][/api/workers] Sessie verlopen of geweigerd", {
        status: quinyxRes.status,
        data
      });
      quinyxSession = { token: null, cookieHeader: null, updatedAt: null };
      return res.status(401).json({
        error: "Quinyx-sessie verlopen of geweigerd. Log opnieuw in.",
        details: data
      });
    }

    if (!quinyxRes.ok) {
      console.error("[ERROR][/api/workers] Fout van Quinyx API", {
        status: quinyxRes.status,
        statusText: quinyxRes.statusText,
        data
      });
      return res.status(quinyxRes.status).json({
        error: `Fout bij ophalen van workers (HTTP ${quinyxRes.status}).`,
        details: data
      });
    }

    console.log("[INFO][/api/workers] Workers succesvol opgehaald");
    return res.json(data);
  } catch (err) {
    logError("/api/workers", err, { workersUrl: QUINYX_WORKERS_URL });
    return res.status(502).json({
      error: "Proxy-fout bij ophalen van workers.",
      message: err.message
    });
  }
});

app.post("/api/logout", (_req, res) => {
  quinyxSession = { token: null, cookieHeader: null, updatedAt: null };
  console.log("[INFO][/api/logout] Sessie gewist");
  res.json({ authenticated: false });
});

// Centrale error handler voor onverwachte Express-fouten
app.use((err, _req, res, _next) => {
  logError("express-middleware", err);
  res.status(500).json({
    error: "Onverwachte serverfout in proxy.",
    message: err?.message || "Onbekende fout"
  });
});

process.on("unhandledRejection", (reason) => {
  logError("unhandledRejection", reason);
});

process.on("uncaughtException", (err) => {
  logError("uncaughtException", err);
});

app.listen(PORT, () => {
  console.log(`[INFO] Quinyx proxy luistert op poort ${PORT}`);
  console.log(`[INFO] Login URL:   ${QUINYX_LOGIN_URL}`);
  console.log(`[INFO] Workers URL: ${QUINYX_WORKERS_URL}`);
});
