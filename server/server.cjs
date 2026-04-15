"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");

const express = require("express");
const cookieParser = require("cookie-parser");

const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const sql = require("mssql");
const axios = require("axios");

const crypto = require("crypto");

const IST_OFFSET_MINUTES = 330;
const REPORT_EMAIL_RECIPIENTS = [
  "vishnu.hazari@premierenergies.com",
  "ramanjulu@premierenergies.com",
  "aarnav.singh@premierenergies.com",
];

// In-memory OTP + session (MVP; resets on server restart)
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// key: username/email
const otpStore = new Map(); // username -> { otp, expiresAt }

// key: sessionToken (used as BasicAuth "password")
const sessionStore = new Map(); // token -> { user, expiresAt }

function genOtp4() {
  return String(Math.floor(1000 + Math.random() * 9000));
}
function genSessionToken() {
  return crypto.randomBytes(24).toString("hex"); // 48 chars
}

function normalizeEmailForOtp(usernameOrEmail) {
  const raw = String(usernameOrEmail || "").trim();
  if (!raw) return "";
  if (raw.includes("@")) return raw.toLowerCase();
  // convenience: allow login with short usernames
  return `${raw.toLowerCase()}@premierenergies.com`;
}

function splitLoginIdentifier(usernameOrEmail) {
  const raw = String(usernameOrEmail || "").trim();
  const lower = raw.toLowerCase();

  const local = lower.includes("@") ? lower.split("@")[0] : lower;
  const localNoDots = local.replace(/\./g, "");
  const email = lower.includes("@") ? lower : `${lower}@premierenergies.com`;

  return { raw, lower, local, localNoDots, email };
}

async function findUserByIdentifier(pool, usernameOrEmail) {
  const { lower, local, localNoDots, email } =
    splitLoginIdentifier(usernameOrEmail);

  const r = await pool
    .request()
    .input("exact", sql.NVarChar(255), lower)
    .input("local", sql.NVarChar(255), local)
    .input("nodots", sql.NVarChar(255), localNoDots)
    .input("email", sql.NVarChar(255), email).query(`
      SELECT TOP 1 id, username, role, name, company
      FROM dbo.Users
      WHERE LOWER(username) = @exact
         OR LOWER(username) = @email
         OR LOWER(username) = @local
         OR LOWER(username) = @nodots
      ORDER BY CASE
        WHEN LOWER(username) = @exact THEN 0
        WHEN LOWER(username) = @email THEN 1
        WHEN LOWER(username) = @local THEN 2
        WHEN LOWER(username) = @nodots THEN 3
        ELSE 4
      END
    `);

  return r.recordset?.[0] || null;
}

async function findUserForLogin(pool, usernameOrEmail) {
  // 1) First try Users table (your existing logic)
  const u = await findUserByIdentifier(pool, usernameOrEmail);
  if (u) return u;

  // 2) If not found, try Transporter Master (vendor login by email/vendorCode)
  const { lower, email, local, localNoDots } =
    splitLoginIdentifier(usernameOrEmail);

  // (a) match by vendorEmail
  // (a) match by vendorEmail OR vendorEmails (multi list)
  const byEmail = await pool.request().input("email", sql.NVarChar(255), email)
    .query(`
      SELECT TOP 1
        CAST(id AS NVARCHAR(36)) AS id,
        vendorCode,
        vendorName,
        NULLIF(LTRIM(RTRIM(vendorEmail)), '') AS vendorEmail,
        NULLIF(CAST(vendorEmails AS NVARCHAR(MAX)), '') AS vendorEmails
      FROM dbo.Master_Transporters
      WHERE ISNULL(isActive, 1) = 1
        AND (
          (vendorEmail IS NOT NULL AND LOWER(LTRIM(RTRIM(vendorEmail))) = LOWER(@email))
          OR (vendorEmails IS NOT NULL AND CHARINDEX(LOWER(@email), LOWER(CAST(vendorEmails AS NVARCHAR(MAX)))) > 0)
        )
    `);

  const t1 = byEmail.recordset?.[0];
  if (t1?.vendorCode) {
    // prefer exact email used to login (email), else fallback to vendorEmail, else vendorCode
    const loginIdentity =
      (email && email.includes("@") ? email : "") ||
      String(t1.vendorEmail || "")
        .trim()
        .toLowerCase() ||
      String(t1.vendorCode).trim().toLowerCase();

    return {
      id: t1.id || t1.vendorCode,
      username: loginIdentity,
      role: "vendor",
      name: t1.vendorName || t1.vendorCode,
      company: t1.vendorCode, // vendor key everywhere
    };
  }

  // (b) match by vendorCode (if vendor types vendorCode instead of email)
  const byCode = await pool
    .request()
    .input("code1", sql.NVarChar(150), local)
    .input("code2", sql.NVarChar(150), localNoDots).query(`
      SELECT TOP 1
        CAST(id AS NVARCHAR(36)) AS id,
        vendorCode,
        vendorName,
        NULLIF(LTRIM(RTRIM(vendorEmail)), '') AS vendorEmail
      FROM dbo.Master_Transporters
      WHERE ISNULL(isActive, 1) = 1
        AND (
          LOWER(LTRIM(RTRIM(vendorCode))) = LOWER(@code1)
          OR LOWER(LTRIM(RTRIM(vendorCode))) = LOWER(@code2)
        )
    `);

  const t2 = byCode.recordset?.[0];
  if (t2?.vendorCode) {
    return {
      id: t2.id || t2.vendorCode,
      // username MUST be stable; if vendorEmail exists use it, else keep vendorCode
      username: String(t2.vendorEmail || t2.vendorCode || "")
        .trim()
        .toLowerCase(),
      role: "vendor",
      name: t2.vendorName || t2.vendorCode,
      company: t2.vendorCode,
    };
  }

  return null;
}

async function resolveOtpEmailForUser(pool, user) {
  // If user.username is an email, use it
  if (String(user?.username || "").includes("@")) {
    return String(user.username).trim().toLowerCase();
  }

  // Vendor: prefer Transporter Master vendorEmail by vendorCode (= user.company)
  if (String(user?.role || "").toLowerCase() === "vendor") {
    const code = String(user?.company || "").trim();
    if (!code) return "";

    try {
      const em = await pool.request().input("code", sql.NVarChar(150), code)
        .query(`
          SELECT TOP 1
            NULLIF(LTRIM(RTRIM(vendorEmail)), '') AS vendorEmail,
            NULLIF(CAST(vendorEmails AS NVARCHAR(MAX)), '') AS vendorEmails
          FROM dbo.Master_Transporters
          WHERE vendorCode = @code AND ISNULL(isActive, 1) = 1
        `);

      const row = em.recordset?.[0] || {};
      const list = parseEmailList(
        [row.vendorEmail, row.vendorEmails].filter(Boolean).join("\n")
      );

      // OTP goes to the primary email (first in the list)
      return list[0] || "";
    } catch (e) {
      console.error("[OTP] Vendor email lookup failed:", e?.message || e);
      return "";
    }
  }

  // Admin/logistics: infer @premierenergies.com from username
  return normalizeEmailForOtp(user.username);
}

async function sendOtpEmail({ toEmail, otp }) {
  const html = otpEmailTemplate({
    otp,
    ttlSeconds: Math.floor(OTP_TTL_MS / 1000),
    appName: "LEAFI",
    toEmail,
  });

  await graphClient.api(`/users/${SENDER_EMAIL}/sendMail`).post({
    message: {
      subject: `Your LEAFI OTP: ${otp}`,
      body: { contentType: "HTML", content: html },
      toRecipients: [{ emailAddress: { address: toEmail } }],
    },
    saveToSentItems: true,
  });
}

// Microsoft Graph
const { Client } = require("@microsoft/microsoft-graph-client");
const { ClientSecretCredential } = require("@azure/identity");
require("isomorphic-fetch");

// ─────────────────────────────────────────────────────────────────────────────
// HTTPS options (paths as requested)
// ─────────────────────────────────────────────────────────────────────────────
const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, "certs", "mydomain.key")),
  cert: fs.readFileSync(path.join(__dirname, "certs", "d466aacf3db3f299.crt")),
  ca: fs.readFileSync(path.join(__dirname, "certs", "gd_bundle-g2-g1.crt")),
};

const APP_PORT = Number(process.env.PORT || 31443);
const APP_HOST = process.env.HOST || "0.0.0.0";

// ─────────────────────────────────────────────────────────────────────────────
// DB config (same structure as reference; env override allowed)
// ─────────────────────────────────────────────────────────────────────────────
const dbConfig = {
  user: process.env.DB_USER || "PEL_DB",
  password: process.env.DB_PASSWORD || "V@aN3#@VaN",
  server: process.env.DB_SERVER || "10.0.50.17",
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || "leafinbound",
  // --- timeouts (ms) ---
  requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT || 100000),
  connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT || 10000000),
  pool: {
    max: Number(process.env.DB_POOL_MAX || 10),
    min: Number(process.env.DB_POOL_MIN || 0),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE || 300000),
  },
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Exchange-rate API
// Frankfurter is a free ECB-backed API with no key requirement.
// We keep a cached server-side rate so the frontend and quote flows
// continue to use the same /api/rate/usdinr contract without quota issues.
// ─────────────────────────────────────────────────────────────────────────────
const USD_INR_FALLBACK_RATE = Number(process.env.USD_INR_FALLBACK_RATE || 75);
const USD_INR_RATE_URL =
  process.env.USD_INR_RATE_URL ||
  "https://api.frankfurter.app/latest?from=USD&to=INR";
const USD_INR_CACHE_TTL_MS = Number(
  process.env.USD_INR_CACHE_TTL_MS || 60 * 60 * 1000
);
let usdInrRateCache = {
  rate: USD_INR_FALLBACK_RATE,
  asOf: null,
  fetchedAt: 0,
  source: "fallback",
};

async function getUsdToInrRate({ forceRefresh = false } = {}) {
  const now = Date.now();
  const hasFreshCache =
    !forceRefresh &&
    usdInrRateCache.fetchedAt > 0 &&
    now - usdInrRateCache.fetchedAt < USD_INR_CACHE_TTL_MS &&
    Number.isFinite(usdInrRateCache.rate) &&
    usdInrRateCache.rate > 0;

  if (hasFreshCache) {
    return {
      ...usdInrRateCache,
      cached: true,
    };
  }

  try {
    const resp = await axios.get(USD_INR_RATE_URL, {
      timeout: 8000,
      headers: {
        Accept: "application/json",
      },
    });

    const rate = Number(resp.data?.rates?.INR);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Invalid USD/INR rate received");
    }

    usdInrRateCache = {
      rate,
      asOf: resp.data?.date || null,
      fetchedAt: now,
      source: "frankfurter",
    };

    return {
      ...usdInrRateCache,
      cached: false,
    };
  } catch (err) {
    console.error(
      "[FX] USD/INR lookup failed, using cached/fallback rate:",
      err?.message || err
    );

    const fallbackRate =
      Number.isFinite(usdInrRateCache.rate) && usdInrRateCache.rate > 0
        ? usdInrRateCache.rate
        : USD_INR_FALLBACK_RATE;

    return {
      rate: fallbackRate,
      asOf: usdInrRateCache.asOf || null,
      fetchedAt: usdInrRateCache.fetchedAt || now,
      source: usdInrRateCache.fetchedAt ? usdInrRateCache.source : "fallback",
      cached: true,
    };
  }
}

// Historical USD/INR rate by date (YYYY-MM-DD). Cached per date.
// Returns null if the API cannot be reached.
const historicalRateCache = new Map();
async function getHistoricalUsdToInrRate(isoDate) {
  if (!isoDate) return null;
  const key = String(isoDate).slice(0, 10);
  if (historicalRateCache.has(key)) return historicalRateCache.get(key);
  try {
    const resp = await axios.get(
      `https://api.frankfurter.app/${key}?from=USD&to=INR`,
      { timeout: 8000, headers: { Accept: "application/json" } }
    );
    const rate = Number(resp.data?.rates?.INR);
    if (!Number.isFinite(rate) || rate <= 0) {
      historicalRateCache.set(key, null);
      return null;
    }
    const entry = {
      rate,
      source: "frankfurter-historical",
      asOf: resp.data?.date || key,
    };
    historicalRateCache.set(key, entry);
    return entry;
  } catch (err) {
    console.error(
      `[FX] historical rate lookup failed for ${key}:`,
      err?.message || err
    );
    historicalRateCache.set(key, null);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph creds (env override allowed)
// ─────────────────────────────────────────────────────────────────────────────
const CLIENT_ID =
  process.env.GRAPH_CLIENT_ID || "5a58e660-dc7b-49ec-a48c-1fffac02f721";
const CLIENT_SECRET =
  process.env.GRAPH_CLIENT_SECRET || "6_I8Q~U7IbS~NERqNeszoCRs2kETiO1Yc3cXAaup";
const TENANT_ID =
  process.env.GRAPH_TENANT_ID || "1c3de7f3-f8d1-41d3-8583-2517cf3ba3b1";
const SENDER_EMAIL = process.env.SENDER_EMAIL || "leaf@premierenergies.com";

// Build Microsoft Graph client
const credential = new ClientSecretCredential(
  TENANT_ID,
  CLIENT_ID,
  CLIENT_SECRET
);
const graphClient = Client.initWithMiddleware({
  authProvider: {
    getAccessToken: async () => {
      const tokenResponse = await credential.getToken(
        "https://graph.microsoft.com/.default"
      );
      return tokenResponse.token;
    },
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Path to frontend build (Vite default) — identical to reference
// ─────────────────────────────────────────────────────────────────────────────
const FRONTEND_DIST_PATH = path.join(__dirname, "..", "dist");

// ─────────────────────────────────────────────────────────────────────────────
// MSSQL pool singleton — identical concept to reference
// ─────────────────────────────────────────────────────────────────────────────
let poolPromise = null;

async function getPool() {
  if (!poolPromise) {
    poolPromise = (async () => {
      const pool = new sql.ConnectionPool(dbConfig);
      pool.on("error", (err) => console.error("[MSSQL] Pool error", err));
      await pool.connect();
      console.log("[MSSQL] Connected to database:", dbConfig.database);
      await ensureLeafInboundTables(pool);
      await seedUsers(pool);
      return pool;
    })().catch((err) => {
      console.error("[MSSQL] Connection error", err);
      poolPromise = null; // allow retry next time
      throw err;
    });
  }
  return poolPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB ensure (tables + constraints + safe column widening upgrades)
// ─────────────────────────────────────────────────────────────────────────────
async function ensureLeafInboundTables(pool) {
  // IMPORTANT: NVARCHAR max_length in sys.columns is in BYTES (nvarchar = 2 bytes/char)
  // So we compare against desiredChars * 2.
  const ddl = `
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'dbo')
BEGIN
  EXEC('CREATE SCHEMA dbo');
END;

-- Users
IF OBJECT_ID('dbo.Users','U') IS NULL
BEGIN
  CREATE TABLE dbo.Users (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Users PRIMARY KEY DEFAULT NEWID(),
    username NVARCHAR(50) NOT NULL,
    password NVARCHAR(255) NOT NULL,
    role NVARCHAR(20) NOT NULL,
    name NVARCHAR(100) NOT NULL,
    company NVARCHAR(150) NULL
  );
END;

IF OBJECT_ID('dbo.ReportEmailRuns','U') IS NULL
BEGIN
  CREATE TABLE dbo.ReportEmailRuns (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ReportEmailRuns PRIMARY KEY DEFAULT NEWID(),
    runType NVARCHAR(30) NOT NULL,
    runKey NVARCHAR(30) NOT NULL,
    sentAt DATETIME2 NOT NULL CONSTRAINT DF_ReportEmailRuns_sentAt DEFAULT SYSUTCDATETIME()
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_ReportEmailRuns_type_key'
    AND object_id = OBJECT_ID('dbo.ReportEmailRuns')
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX UQ_ReportEmailRuns_type_key
  ON dbo.ReportEmailRuns(runType, runKey);
END;

-- Widen Users.username if needed (vendorCode/email may exceed 50)
IF EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Users')
    AND name = 'username'
    AND max_length > 0
    AND max_length < (255 * 2)
)
BEGIN
  ALTER TABLE dbo.Users ALTER COLUMN username NVARCHAR(255) NOT NULL;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_Users_username'
    AND object_id = OBJECT_ID('dbo.Users')
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX UQ_Users_username ON dbo.Users(username);
END;


-- RFQs (CREATE with larger sizes to avoid truncation)
IF OBJECT_ID('dbo.RFQs','U') IS NULL
BEGIN
  CREATE TABLE dbo.RFQs (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_RFQs PRIMARY KEY DEFAULT NEWID(),
    rfqNumber INT NOT NULL,
itemDescription NVARCHAR(500) NOT NULL,
companyName NVARCHAR(MAX) NOT NULL,

    materialPONumber NVARCHAR(150) NOT NULL,
    supplierName NVARCHAR(255) NOT NULL,
    portOfLoading NVARCHAR(100) NOT NULL,
    portOfDestination NVARCHAR(100) NOT NULL,
    containerType NVARCHAR(50) NOT NULL,
    incoterms NVARCHAR(50) NULL,
    numberOfContainers INT NOT NULL,
    cargoWeight FLOAT NOT NULL,
    cargoReadinessDate DATETIME2 NOT NULL,
    cargoReadinessFrom DATETIME2 NULL,
    cargoReadinessTo DATETIME2 NULL,

    description NVARCHAR(1000) NULL,
    attachments NVARCHAR(MAX) NULL,
    vendors NVARCHAR(MAX) NOT NULL,
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_RFQs_createdAt DEFAULT SYSUTCDATETIME(),
    status NVARCHAR(20) NOT NULL,
    createdBy NVARCHAR(100) NOT NULL
  );
END;

-- ─────────────────────────────────────────────
-- Master tables for dropdowns (Admin-managed)
-- ─────────────────────────────────────────────

-- Item Descriptions
IF OBJECT_ID('dbo.Master_ItemDescriptions','U') IS NULL
BEGIN
  CREATE TABLE dbo.Master_ItemDescriptions (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Master_ItemDescriptions PRIMARY KEY DEFAULT NEWID(),
    value NVARCHAR(500) NOT NULL,
    isActive BIT NOT NULL CONSTRAINT DF_Master_ItemDescriptions_isActive DEFAULT (1),
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_Master_ItemDescriptions_createdAt DEFAULT SYSUTCDATETIME(),
    updatedAt DATETIME2 NULL
  );
  CREATE UNIQUE NONCLUSTERED INDEX UQ_Master_ItemDescriptions_value ON dbo.Master_ItemDescriptions(value);
END;

-- Company Names (NVARCHAR(MAX) - no unique index; we dedupe in queries)
IF OBJECT_ID('dbo.Master_CompanyNames','U') IS NULL
BEGIN
  CREATE TABLE dbo.Master_CompanyNames (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Master_CompanyNames PRIMARY KEY DEFAULT NEWID(),
    value NVARCHAR(MAX) NOT NULL,
    shortName NVARCHAR(100) NULL,          -- ✅ NEW
    isActive BIT NOT NULL CONSTRAINT DF_Master_CompanyNames_isActive DEFAULT (1),
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_Master_CompanyNames_createdAt DEFAULT SYSUTCDATETIME(),
    updatedAt DATETIME2 NULL
  );
END;

-- ✅ Add shortName if table already exists (safe / idempotent)
IF OBJECT_ID('dbo.Master_CompanyNames','U') IS NOT NULL
  AND COL_LENGTH('dbo.Master_CompanyNames','shortName') IS NULL
BEGIN
  ALTER TABLE dbo.Master_CompanyNames ADD shortName NVARCHAR(100) NULL;
END;

-- Incoterms
IF OBJECT_ID('dbo.Master_Incoterms','U') IS NULL
BEGIN
  CREATE TABLE dbo.Master_Incoterms (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Master_Incoterms PRIMARY KEY DEFAULT NEWID(),
    value NVARCHAR(50) NOT NULL,
    isActive BIT NOT NULL CONSTRAINT DF_Master_Incoterms_isActive DEFAULT (1),
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_Master_Incoterms_createdAt DEFAULT SYSUTCDATETIME(),
    updatedAt DATETIME2 NULL
  );
  CREATE UNIQUE NONCLUSTERED INDEX UQ_Master_Incoterms_value ON dbo.Master_Incoterms(value);
END;

-- Supplier Names
IF OBJECT_ID('dbo.Master_Suppliers','U') IS NULL
BEGIN
  CREATE TABLE dbo.Master_Suppliers (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Master_Suppliers PRIMARY KEY DEFAULT NEWID(),
    value NVARCHAR(255) NOT NULL,
    isActive BIT NOT NULL CONSTRAINT DF_Master_Suppliers_isActive DEFAULT (1),
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_Master_Suppliers_createdAt DEFAULT SYSUTCDATETIME(),
    updatedAt DATETIME2 NULL
  );
  CREATE UNIQUE NONCLUSTERED INDEX UQ_Master_Suppliers_value ON dbo.Master_Suppliers(value);
END;

-- Port Of Loading
IF OBJECT_ID('dbo.Master_PortsOfLoading','U') IS NULL
BEGIN
  CREATE TABLE dbo.Master_PortsOfLoading (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Master_PortsOfLoading PRIMARY KEY DEFAULT NEWID(),
    value NVARCHAR(100) NOT NULL,
    country NVARCHAR(100) NULL,            -- ✅ NEW
    isActive BIT NOT NULL CONSTRAINT DF_Master_PortsOfLoading_isActive DEFAULT (1),
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_Master_PortsOfLoading_createdAt DEFAULT SYSUTCDATETIME(),
    updatedAt DATETIME2 NULL
  );
  CREATE UNIQUE NONCLUSTERED INDEX UQ_Master_PortsOfLoading_value ON dbo.Master_PortsOfLoading(value);
END;

-- ✅ Add country if table already exists (safe / idempotent)
IF OBJECT_ID('dbo.Master_PortsOfLoading','U') IS NOT NULL
  AND COL_LENGTH('dbo.Master_PortsOfLoading','country') IS NULL
BEGIN
  ALTER TABLE dbo.Master_PortsOfLoading ADD country NVARCHAR(100) NULL;
END;

-- Port Of Destination
IF OBJECT_ID('dbo.Master_PortsOfDestination','U') IS NULL
BEGIN
  CREATE TABLE dbo.Master_PortsOfDestination (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Master_PortsOfDestination PRIMARY KEY DEFAULT NEWID(),
    value NVARCHAR(100) NOT NULL,
    isActive BIT NOT NULL CONSTRAINT DF_Master_PortsOfDestination_isActive DEFAULT (1),
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_Master_PortsOfDestination_createdAt DEFAULT SYSUTCDATETIME(),
    updatedAt DATETIME2 NULL
  );
  CREATE UNIQUE NONCLUSTERED INDEX UQ_Master_PortsOfDestination_value ON dbo.Master_PortsOfDestination(value);
END;

-- Container Types
IF OBJECT_ID('dbo.Master_ContainerTypes','U') IS NULL
BEGIN
  CREATE TABLE dbo.Master_ContainerTypes (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Master_ContainerTypes PRIMARY KEY DEFAULT NEWID(),
    value NVARCHAR(50) NOT NULL,
    isActive BIT NOT NULL CONSTRAINT DF_Master_ContainerTypes_isActive DEFAULT (1),
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_Master_ContainerTypes_createdAt DEFAULT SYSUTCDATETIME(),
    updatedAt DATETIME2 NULL
  );
  CREATE UNIQUE NONCLUSTERED INDEX UQ_Master_ContainerTypes_value ON dbo.Master_ContainerTypes(value);
END;

-- Transporter Master (Vendor list used as freight options)
IF OBJECT_ID('dbo.Master_Transporters','U') IS NULL
BEGIN
  CREATE TABLE dbo.Master_Transporters (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Master_Transporters PRIMARY KEY DEFAULT NEWID(),
    vendorCode NVARCHAR(150) NOT NULL,     -- what shows as "vendor/company" option (e.g., VENDORA)
    vendorName NVARCHAR(255) NOT NULL,     -- display name
    shortName NVARCHAR(100) NULL,          -- ✅ NEW
    vendorEmail NVARCHAR(255) NULL,        -- for notifications
    vendorEmails NVARCHAR(MAX) NULL,   -- ✅ NEW (multi-email list)
    isActive BIT NOT NULL CONSTRAINT DF_Master_Transporters_isActive DEFAULT (1),
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_Master_Transporters_createdAt DEFAULT SYSUTCDATETIME(),
    updatedAt DATETIME2 NULL
  );

  CREATE UNIQUE NONCLUSTERED INDEX UQ_Master_Transporters_vendorCode
  ON dbo.Master_Transporters(vendorCode);
END;

-- ✅ Add shortName if table already exists (safe / idempotent)
IF OBJECT_ID('dbo.Master_Transporters','U') IS NOT NULL
  AND COL_LENGTH('dbo.Master_Transporters','shortName') IS NULL
BEGIN
  ALTER TABLE dbo.Master_Transporters ADD shortName NVARCHAR(100) NULL;
END;

-- ✅ Add vendorEmails (multi-email list) if table already exists (safe / idempotent)
IF OBJECT_ID('dbo.Master_Transporters','U') IS NOT NULL
  AND COL_LENGTH('dbo.Master_Transporters','vendorEmails') IS NULL
BEGIN
  ALTER TABLE dbo.Master_Transporters ADD vendorEmails NVARCHAR(MAX) NULL;
END;


-- Seed Transporter Master from existing vendor users (insert-only)
IF OBJECT_ID('dbo.Users','U') IS NOT NULL
BEGIN
  INSERT INTO dbo.Master_Transporters(vendorCode, vendorName, vendorEmail, isActive, createdAt)
  SELECT DISTINCT
    ISNULL(NULLIF(LTRIM(RTRIM(u.company)), ''), u.username) AS vendorCode,
    ISNULL(NULLIF(LTRIM(RTRIM(u.name)), ''), u.username) AS vendorName,
    CASE WHEN u.username LIKE '%@%' THEN u.username ELSE NULL END AS vendorEmail,
    1,
    SYSUTCDATETIME()
  FROM dbo.Users u
  WHERE u.role = 'vendor'
    AND ISNULL(NULLIF(LTRIM(RTRIM(u.company)), ''), u.username) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM dbo.Master_Transporters t
      WHERE t.vendorCode = ISNULL(NULLIF(LTRIM(RTRIM(u.company)), ''), u.username)
    );
END;

-- ─────────────────────────────────────────────
-- Seed master values from existing RFQs (insert-only)
-- ─────────────────────────────────────────────
IF OBJECT_ID('dbo.RFQs','U') IS NOT NULL
BEGIN
  INSERT INTO dbo.Master_ItemDescriptions(value)
  SELECT DISTINCT r.itemDescription
  FROM dbo.RFQs r
  WHERE r.itemDescription IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dbo.Master_ItemDescriptions m WHERE m.value = r.itemDescription);

  INSERT INTO dbo.Master_CompanyNames(value)
  SELECT DISTINCT r.companyName
  FROM dbo.RFQs r
  WHERE r.companyName IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dbo.Master_CompanyNames m WHERE m.value = r.companyName);

  INSERT INTO dbo.Master_Suppliers(value)
  SELECT DISTINCT r.supplierName
  FROM dbo.RFQs r
  WHERE r.supplierName IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dbo.Master_Suppliers m WHERE m.value = r.supplierName);

  INSERT INTO dbo.Master_PortsOfLoading(value)
  SELECT DISTINCT r.portOfLoading
  FROM dbo.RFQs r
  WHERE r.portOfLoading IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dbo.Master_PortsOfLoading m WHERE m.value = r.portOfLoading);

  INSERT INTO dbo.Master_PortsOfDestination(value)
  SELECT DISTINCT r.portOfDestination
  FROM dbo.RFQs r
  WHERE r.portOfDestination IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dbo.Master_PortsOfDestination m WHERE m.value = r.portOfDestination);

  INSERT INTO dbo.Master_ContainerTypes(value)
  SELECT DISTINCT r.containerType
  FROM dbo.RFQs r
  WHERE r.containerType IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dbo.Master_ContainerTypes m WHERE m.value = r.containerType);
END;


  -- Incoterms (only if RFQs column exists)
  IF COL_LENGTH('dbo.RFQs','incoterms') IS NOT NULL
  BEGIN
    EXEC(N'
      INSERT INTO dbo.Master_Incoterms(value)
      SELECT DISTINCT r.incoterms
      FROM dbo.RFQs r
      WHERE r.incoterms IS NOT NULL AND LTRIM(RTRIM(r.incoterms)) <> ''''
        AND NOT EXISTS (
          SELECT 1 FROM dbo.Master_Incoterms m WHERE m.value = r.incoterms
        );
    ');
  END;


-- Seed Users from existing active Transporter Master (insert-only)
IF OBJECT_ID('dbo.Master_Transporters','U') IS NOT NULL
  AND OBJECT_ID('dbo.Users','U') IS NOT NULL
BEGIN
  ;WITH T AS (
    SELECT
      vendorCode,
      vendorName,
      NULLIF(LTRIM(RTRIM(vendorEmail)), '') AS vendorEmail
    FROM dbo.Master_Transporters
    WHERE ISNULL(isActive, 1) = 1
  )
  INSERT INTO dbo.Users (username, password, role, name, company)
  SELECT
    ua.username,
    ua.username,
    'vendor',
    ISNULL(NULLIF(LTRIM(RTRIM(t.vendorName)), ''), ua.username),
    t.vendorCode
  FROM T t
  CROSS APPLY (
    SELECT
      CASE
        WHEN t.vendorEmail IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM dbo.Users u2
               WHERE LOWER(u2.username) = LOWER(t.vendorEmail)
             )
          THEN LOWER(t.vendorEmail)
        WHEN NOT EXISTS (
               SELECT 1 FROM dbo.Users u3
               WHERE LOWER(u3.username) = LOWER(t.vendorCode)
             )
          THEN t.vendorCode
        ELSE NULL
      END AS username
  ) ua
  WHERE ua.username IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM dbo.Users u
      WHERE u.role = 'vendor' AND u.company = t.vendorCode
    );
END;

-- ─────────────────────────────────────────────
-- RFQs: SAFE widening upgrades if table already existed with small columns
  /* Drop deprecated columns (safe) */
  IF COL_LENGTH('dbo.RFQs', 'initialQuoteEndTime') IS NOT NULL
  BEGIN
    DECLARE @dc1 NVARCHAR(200);
    SELECT @dc1 = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c
      ON c.default_object_id = dc.object_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.RFQs')
      AND c.name = 'initialQuoteEndTime';

    IF @dc1 IS NOT NULL
BEGIN
  DECLARE @sql1 NVARCHAR(MAX) =
    N'ALTER TABLE dbo.RFQs DROP CONSTRAINT [' + REPLACE(@dc1, ']', ']]') + N']';
  EXEC(@sql1);
END

    ALTER TABLE dbo.RFQs DROP COLUMN initialQuoteEndTime;
  END;

    -- attachments (optional)
  IF COL_LENGTH('dbo.RFQs', 'attachments') IS NULL
  BEGIN
    ALTER TABLE dbo.RFQs ADD attachments NVARCHAR(MAX) NULL;
  END;

  IF COL_LENGTH('dbo.RFQs', 'evaluationEndTime') IS NOT NULL
  BEGIN
    DECLARE @dc2 NVARCHAR(200);
    SELECT @dc2 = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c
      ON c.default_object_id = dc.object_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.RFQs')
      AND c.name = 'evaluationEndTime';

   IF @dc2 IS NOT NULL
BEGIN
  DECLARE @sql2 NVARCHAR(MAX) =
    N'ALTER TABLE dbo.RFQs DROP CONSTRAINT [' + REPLACE(@dc2, ']', ']]') + N']';
  EXEC(@sql2);
END

    ALTER TABLE dbo.RFQs DROP COLUMN evaluationEndTime;
  END;


IF OBJECT_ID('dbo.RFQs','U') IS NOT NULL
BEGIN
  -- itemDescription -> 255
  -- itemDescription -> 500
  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.RFQs')
      AND name = 'itemDescription'
      AND max_length > 0
      AND max_length < (500 * 2)
  )
  BEGIN
    ALTER TABLE dbo.RFQs ALTER COLUMN itemDescription NVARCHAR(500) NOT NULL;
  END;

    -- incoterms (nullable, backward compatible)
  IF COL_LENGTH('dbo.RFQs', 'incoterms') IS NULL
  BEGIN
    ALTER TABLE dbo.RFQs ADD incoterms NVARCHAR(50) NULL;
  END;

  -- incoterms -> 50 (if somehow smaller)
  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.RFQs')
      AND name = 'incoterms'
      AND max_length > 0
      AND max_length < (50 * 2)
  )
  BEGIN
    ALTER TABLE dbo.RFQs ALTER COLUMN incoterms NVARCHAR(50) NULL;
  END;


  -- Cargo readiness range (backward compatible)
  IF COL_LENGTH('dbo.RFQs', 'cargoReadinessFrom') IS NULL
  BEGIN
    ALTER TABLE dbo.RFQs ADD cargoReadinessFrom DATETIME2 NULL;
  END;

  IF COL_LENGTH('dbo.RFQs', 'cargoReadinessTo') IS NULL
  BEGIN
    ALTER TABLE dbo.RFQs ADD cargoReadinessTo DATETIME2 NULL;
  END;

  -- Finalization timestamp on RFQs (when status flips to 'closed')
  IF COL_LENGTH('dbo.RFQs', 'finalizedAt') IS NULL
  BEGIN
    ALTER TABLE dbo.RFQs ADD finalizedAt DATETIME2 NULL;
  END;

  -- USD/INR rate applied at the moment a quote's INR totals were computed.
  -- Nullable — historical rows will not have it until backfilled.
  IF COL_LENGTH('dbo.Quotes', 'appliedUsdInrRate') IS NULL
  BEGIN
    ALTER TABLE dbo.Quotes ADD appliedUsdInrRate FLOAT NULL;
  END;

  -- Audit log for USD/INR backfills (what was changed, when, by whom).
  IF OBJECT_ID('dbo.UsdInrBackfillAudit', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.UsdInrBackfillAudit (
      id               INT IDENTITY(1,1) PRIMARY KEY,
      quoteId          UNIQUEIDENTIFIER NULL,
      oldRate          FLOAT NULL,
      newRate          FLOAT NULL,
      oldHomeTotal     FLOAT NULL,
      newHomeTotal     FLOAT NULL,
      oldMoowrTotal    FLOAT NULL,
      newMoowrTotal    FLOAT NULL,
      historicalDate   NVARCHAR(10) NULL,
      source           NVARCHAR(64) NULL,
      runBy            NVARCHAR(255) NULL,
      runAt            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
  END;

  -- companyName -> MAX (handles long multi-line addresses)
  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.RFQs')
      AND name = 'companyName'
      AND max_length <> -1
  )
  BEGIN
    ALTER TABLE dbo.RFQs ALTER COLUMN companyName NVARCHAR(MAX) NOT NULL;
  END;


  -- materialPONumber -> 150
  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.RFQs')
      AND name = 'materialPONumber'
      AND max_length > 0
      AND max_length < (150 * 2)
  )
  BEGIN
    ALTER TABLE dbo.RFQs ALTER COLUMN materialPONumber NVARCHAR(150) NOT NULL;
  END;

  -- supplierName -> 255
  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.RFQs')
      AND name = 'supplierName'
      AND max_length > 0
      AND max_length < (255 * 2)
  )
  BEGIN
    ALTER TABLE dbo.RFQs ALTER COLUMN supplierName NVARCHAR(255) NOT NULL;
  END;

  -- portOfLoading -> 100
  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.RFQs')
      AND name = 'portOfLoading'
      AND max_length > 0
      AND max_length < (100 * 2)
  )
  BEGIN
    ALTER TABLE dbo.RFQs ALTER COLUMN portOfLoading NVARCHAR(100) NOT NULL;
  END;

  -- portOfDestination -> 100
  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.RFQs')
      AND name = 'portOfDestination'
      AND max_length > 0
      AND max_length < (100 * 2)
  )
  BEGIN
    ALTER TABLE dbo.RFQs ALTER COLUMN portOfDestination NVARCHAR(100) NOT NULL;
  END;

  -- containerType -> 50
  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.RFQs')
      AND name = 'containerType'
      AND max_length > 0
      AND max_length < (50 * 2)
  )
  BEGIN
    ALTER TABLE dbo.RFQs ALTER COLUMN containerType NVARCHAR(50) NOT NULL;
  END;

  -- description -> 1000 (nullable)
  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.RFQs')
      AND name = 'description'
      AND max_length > 0
      AND max_length < (1000 * 2)
  )
  BEGIN
    ALTER TABLE dbo.RFQs ALTER COLUMN description NVARCHAR(1000) NULL;
  END;

  -- createdBy -> 100
  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.RFQs')
      AND name = 'createdBy'
      AND max_length > 0
      AND max_length < (100 * 2)
  )
  BEGIN
    ALTER TABLE dbo.RFQs ALTER COLUMN createdBy NVARCHAR(100) NOT NULL;
  END;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_RFQs_rfqNumber'
    AND object_id = OBJECT_ID('dbo.RFQs')
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX UQ_RFQs_rfqNumber ON dbo.RFQs(rfqNumber);
END;

-- Quotes
IF OBJECT_ID('dbo.Quotes','U') IS NULL
BEGIN
  CREATE TABLE dbo.Quotes (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Quotes PRIMARY KEY DEFAULT NEWID(),
    rfqId UNIQUEIDENTIFIER NOT NULL,
    vendorName NVARCHAR(150) NOT NULL,
    numberOfContainers INT NOT NULL,
    shippingLineName NVARCHAR(150) NOT NULL,
    containerType NVARCHAR(50) NOT NULL,
    vesselName NVARCHAR(150) NOT NULL,
    vesselETD DATETIME2 NOT NULL,
    vesselETA DATETIME2 NOT NULL,
    seaFreightPerContainer FLOAT NOT NULL,
    houseDeliveryOrderPerBOL FLOAT NOT NULL,
    cfsPerContainer FLOAT NOT NULL,
    transportationPerContainer FLOAT NOT NULL,
    chaChargesHome FLOAT NOT NULL,
    chaChargesMOOWR FLOAT NOT NULL,
    ediChargesPerBOE FLOAT NOT NULL,
    mooWRReeWarehousingCharges FLOAT NOT NULL,
    transshipOrDirect NVARCHAR(20) NOT NULL,
    quoteValidityDate DATETIME2 NOT NULL,
    message NVARCHAR(1000) NULL,
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_Quotes_createdAt DEFAULT SYSUTCDATETIME(),
    containersAllottedHome INT NULL,
    containersAllottedMOOWR INT NULL,
    homeTotal FLOAT NULL,
    mooWRTotal FLOAT NULL
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Quotes_RFQs'
)
BEGIN
  ALTER TABLE dbo.Quotes WITH CHECK
  ADD CONSTRAINT FK_Quotes_RFQs FOREIGN KEY (rfqId) REFERENCES dbo.RFQs(id);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_Quotes_rfqId_vendor_createdAt'
    AND object_id = OBJECT_ID('dbo.Quotes')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_Quotes_rfqId_vendor_createdAt
  ON dbo.Quotes(rfqId, vendorName, createdAt DESC);
END;

-- Allocations
IF OBJECT_ID('dbo.Allocations','U') IS NULL
BEGIN
  CREATE TABLE dbo.Allocations (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Allocations PRIMARY KEY DEFAULT NEWID(),
    rfqId UNIQUEIDENTIFIER NOT NULL,
    quoteId UNIQUEIDENTIFIER NOT NULL,
    vendorName NVARCHAR(150) NOT NULL,
    containersAllottedHome INT NOT NULL,
    containersAllottedMOOWR INT NOT NULL,
    reason NVARCHAR(1000) NULL,
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_Allocations_createdAt DEFAULT SYSUTCDATETIME()
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Allocations_RFQs'
)
BEGIN
  ALTER TABLE dbo.Allocations WITH CHECK
  ADD CONSTRAINT FK_Allocations_RFQs FOREIGN KEY (rfqId) REFERENCES dbo.RFQs(id);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Allocations_Quotes'
)
BEGIN
  ALTER TABLE dbo.Allocations WITH CHECK
  ADD CONSTRAINT FK_Allocations_Quotes FOREIGN KEY (quoteId) REFERENCES dbo.Quotes(id);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_Allocations_rfqId_createdAt'
    AND object_id = OBJECT_ID('dbo.Allocations')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_Allocations_rfqId_createdAt
  ON dbo.Allocations(rfqId, createdAt DESC);
END;
`;

  console.log(
    "[DB] Ensuring tables/indexes exist (and widening columns if needed)..."
  );
  await pool.request().batch(ddl);
  console.log("[DB] Schema check done.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed users (INSERT ONLY if not exists — as requested)
// ─────────────────────────────────────────────────────────────────────────────
async function seedUsers(pool) {
  const seedSql = `
IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE username = 'aarnav')
BEGIN
  INSERT dbo.Users (username, password, role, name, company)
  VALUES ('aarnav', 'aarnav1729', 'logistics', 'Aarnav', NULL);
END;

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE username = 'nav')
BEGIN
  INSERT dbo.Users (username, password, role, name, company)
  VALUES ('nav', 'nav', 'vendor', 'Nav', 'LEAFI');
END;

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE username = 'aarnavsingh')
BEGIN
  INSERT dbo.Users (username, password, role, name, company)
  VALUES ('aarnavsingh', 'aarnavsingh', 'admin', 'Aarnav (Admin)', NULL);
END;

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE username = 'van')
BEGIN
  INSERT dbo.Users (username, password, role, name, company)
  VALUES ('van', 'van', 'vendor', 'LEAFO', 'LEAFO');
END;

-- ========================= NEW USERS (insert-only) =========================

-- Admin additions
IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE username = 'vishnu.hazari')
BEGIN
  INSERT dbo.Users (username, password, role, name, company)
  VALUES ('vishnu.hazari', 'vishnu.hazari', 'admin', 'Vishnu Hazari (Admin)', NULL);
END;

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE username = 'vishnu.hazari@premierenergies.com')
BEGIN
  INSERT dbo.Users (username, password, role, name, company)
  VALUES ('vishnu.hazari@premierenergies.com', 'vishnu.hazari@premierenergies.com', 'admin', 'Vishnu Hazari (Admin)', NULL);
END;

-- Logistics additions
IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE username = 'ramanjulu')
BEGIN
  INSERT dbo.Users (username, password, role, name, company)
  VALUES ('ramanjulu', 'ramanjulu', 'logistics', 'Ramanjulu', NULL);
END;

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE username = 'ramanjulu@premierenergies.com')
BEGIN
  INSERT dbo.Users (username, password, role, name, company)
  VALUES ('ramanjulu@premierenergies.com', 'ramanjulu@premierenergies.com', 'logistics', 'Ramanjulu', NULL);
END;

-- Vendor additions
IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE username = 'vendora')
BEGIN
  INSERT dbo.Users (username, password, role, name, company)
  VALUES ('vendora', 'vendora', 'vendor', 'Vendor A', 'VENDORA');
END;

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE username = 'vendorb')
BEGIN
  INSERT dbo.Users (username, password, role, name, company)
  VALUES ('vendorb', 'vendorb', 'vendor', 'Vendor B', 'VENDORB');
END;

`;
  console.log("[DB] Seeding users (insert-only)...");
  await pool.request().batch(seedSql);
  console.log("[DB] User seed done.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
// ========================= Allocation Email CC Lists =========================
const ALLOCATION_CC_ALWAYS = [
  "logistics.imports@premierenergies.com",
  "narayana.b@premierenergies.com",
  "pintu.pradhan@premierenergies.com",
];

const ALLOCATION_CC_WITH_REASON = [
  "aarnav.singh@premierenergies.com",
  "vishnu.hazari@premierenergies.com",
];

function graphRecipientsFromEmails(emails) {
  const seen = new Set();
  const clean = (emails || [])
    .map((e) =>
      String(e || "")
        .trim()
        .toLowerCase()
    )
    .filter((e) => e && e.includes("@") && !seen.has(e) && (seen.add(e), true));

  return clean.map((address) => ({ emailAddress: { address } }));
}

function parseEmailList(input) {
  const raw = Array.isArray(input) ? input.join("\n") : String(input || "");
  const parts = raw
    .replace(/\r\n/g, "\n")
    .split(/[\n,; ]+/g)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const e of parts) {
    if (!e.includes("@")) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function serializeEmailList(emails) {
  const list = parseEmailList(emails);
  return list.length ? list.join("\n") : null; // store newline-separated
}

async function getVendorNotificationEmails(pool, vendorCode) {
  const code = String(vendorCode || "").trim();
  if (!code) return [];

  const r = await pool.request().input("code", sql.NVarChar(150), code).query(`
    SELECT TOP 1
      NULLIF(LTRIM(RTRIM(vendorEmail)), '') AS vendorEmail,
      NULLIF(CAST(vendorEmails AS NVARCHAR(MAX)), '') AS vendorEmails
    FROM dbo.Master_Transporters
    WHERE vendorCode = @code AND ISNULL(isActive, 1) = 1
  `);

  const row = r.recordset?.[0] || {};
  return parseEmailList(
    [row.vendorEmail, row.vendorEmails].filter(Boolean).join("\n")
  );
}

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function normalizeMasterValue(key, value) {
  let v = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();

  // Incoterms are typically uppercase and single-space
  if (key === "incoterms") {
    v = v.replace(/\s+/g, " ").toUpperCase();
  }

  return v;
}

function parseDateInput(v) {
  if (!v) return null;
  if (v instanceof Date) return v;

  const s = String(v).trim();
  if (!s) return null;

  // Handle <input type="date"> => "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Handle "DD-MM-YYYY" or "DD/MM/YYYY"
  if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split(/[-/]/);
    const d2 = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    return Number.isNaN(d2.getTime()) ? null : d2;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function rfqCreationEmailTemplate({
  rfqNumber,
  itemDescription,
  companyName,
  materialPONumber,
  supplierName,
  portOfLoading,
  portOfDestination,
  containerType,
  incoterms,
  numberOfContainers,
  cargoWeight,
  cargoReadinessDate,
  cargoReadinessFrom,
  cargoReadinessTo,

  description,
  attachmentsCount,
  createdBy,
}) {
  const fmtDateTime = (d) =>
    d ? new Date(d).toLocaleString("en-IN", { hour12: true }) : "—";

  const fmtRange = (from, to, legacy) => {
    const f = from || legacy;
    const t = to || from || legacy;
    if (!f) return "—";
    if (!t || String(t) === String(f)) return fmtDateTime(f);
    return `${fmtDateTime(f)} → ${fmtDateTime(t)}`;
  };

  const row = (label, value) => `
    <tr>
      <td style="padding:10px 12px;font-weight:600;color:#1a1b4b;">${label}</td>
      <td style="padding:10px 12px;color:#111827;">${value || "—"}</td>
    </tr>
  `;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Inter,Segoe UI,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:20px 24px;color:white;">
              <div style="font-size:20px;font-weight:700;">LEAFI</div>
              <div style="opacity:0.9;font-size:13px;margin-top:4px;">
                New RFQ Notification
              </div>
            </td>
          </tr>

          <!-- RFQ Number -->
          <tr>
            <td style="padding:24px 24px 8px;">
              <div style="font-size:14px;color:#6b7280;">RFQ Number</div>
              <div style="font-size:28px;font-weight:800;color:#1a1b4b;">
                ${rfqNumber}
              </div>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding:0 24px 20px;color:#374151;font-size:14px;line-height:1.6;">
              A new Request for Quotation has been created and requires your quotation.
            </td>
          </tr>

          <!-- Details table -->
          <tr>
            <td style="padding:0 24px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                ${row("Item Description", itemDescription)}
                ${row("Company Name", companyName)}
                ${row("Material PO Number", materialPONumber)}
                ${row("Supplier Name", supplierName)}
                ${row("Port of Loading", portOfLoading)}
                ${row("Port of Destination", portOfDestination)}
                ${row("Container Type", containerType)}
                ${row("Incoterms", incoterms)}
                ${row("Number of Containers", numberOfContainers)}
                ${row("Cargo Weight (tons)", cargoWeight)}
                                ${row(
                                  "Cargo Readiness Window",
                                  fmtRange(
                                    cargoReadinessFrom,
                                    cargoReadinessTo,
                                    cargoReadinessDate
                                  )
                                )}


                ${row(
                  "Attachments",
                  attachmentsCount ? `${attachmentsCount} file(s)` : "None"
                )}
                ${description ? row("Additional Notes", description) : ""}
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:0 24px 32px;">
              <a href="https://leafi.premierenergies.com"
                 style="display:inline-block;padding:12px 22px;border-radius:10px;
                        background:#22c55e;color:white;font-weight:600;
                        text-decoration:none;font-size:14px;">
                View & Submit Quote
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px;">
              Created for <strong>${createdBy}</strong><br/>
              This is an automated message from LEAFI. Please do not reply.<br/>
              If you have any queries, please reach out to: aarnav.singh@premierenergies.com
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function otpEmailTemplate({ otp, ttlSeconds, appName = "LEAFI", toEmail }) {
  const mins = Math.round((ttlSeconds || 300) / 60);
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Inter,Segoe UI,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:24px;">
        <table width="100%" cellpadding="0" cellspacing="0"
          style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:20px 24px;color:white;">
              <div style="font-size:18px;font-weight:900;letter-spacing:0.2px;">${appName}</div>
              <div style="opacity:0.95;font-size:13px;margin-top:4px;">
                Secure One-Time Password (OTP)
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:22px 24px 8px;">
              <div style="font-size:14px;color:#334155;line-height:1.7;">
                Use the code below to sign in to <strong>${appName}</strong>.
                This OTP is valid for <strong>${mins} minutes</strong>.
              </div>
            </td>
          </tr>

          <!-- OTP Box -->
          <tr>
            <td style="padding:14px 24px 18px;">
              <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center;">
                <div style="font-size:12px;color:#64748b;letter-spacing:0.08em;text-transform:uppercase;">
                  Your OTP
                </div>
                <div style="margin-top:8px;font-size:34px;font-weight:900;letter-spacing:0.25em;color:#0f172a;">
                  ${String(otp || "").trim()}
                </div>
              </div>
            </td>
          </tr>

          <!-- Safety note -->
          <tr>
            <td style="padding:0 24px 18px;color:#475569;font-size:13px;line-height:1.7;">
              If you did not request this code, you can safely ignore this email.
              For security, please do not share this OTP with anyone.
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.6;">
              Sent to <strong>${toEmail || "your email"}</strong><br/>
              This is an automated message from ${appName}. Please do not reply.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function allocationEmailTemplate({
  rfq,
  quote,
  vendorName,
  vendorEmail,
  allocatedHome,
  allocatedMoowr,
  reason,
}) {
  const fmtMoney = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? `₹${n.toFixed(2)}` : "₹0.00";
  };
  const fmtNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const fmtDateTime = (d) =>
    d ? new Date(d).toLocaleString("en-IN", { hour12: true }) : "—";

  const scheme =
    fmtNum(allocatedMoowr) > 0 && fmtNum(allocatedHome) === 0
      ? "moowr"
      : fmtNum(allocatedHome) > 0 && fmtNum(allocatedMoowr) === 0
      ? "home"
      : "mixed";

  const schemeBadge =
    scheme === "home"
      ? "CHA-HOME"
      : scheme === "moowr"
      ? "MOOWR"
      : "HOME + MOOWR";

  // ---- Cost rows (dynamic like FinalizeRFQ logic) ----
  // NOTE: Sea Freight is stored in USD; other charges are INR as per your existing schema.
  // We only INCLUDE the relevant scheme-specific lines as requested.
  const baseRows = [
    [
      "Sea Freight / Container (USD)",
      `${fmtNum(quote?.seaFreightPerContainer).toFixed(2)} USD`,
    ],
    ["HDO / BOL (INR)", fmtMoney(quote?.houseDeliveryOrderPerBOL)],
    ["CFS / Container (INR)", fmtMoney(quote?.cfsPerContainer)],
    [
      "Transportation / Container (INR)",
      fmtMoney(quote?.transportationPerContainer),
    ],
    ["EDI / BOE (INR)", fmtMoney(quote?.ediChargesPerBOE)],
  ];

  const homeOnlyRows = [["CHA-HOME (INR)", fmtMoney(quote?.chaChargesHome)]];

  const moowrOnlyRows = [
    ["CHA-MOOWR (INR)", fmtMoney(quote?.chaChargesMOOWR)],
    [
      "MOOWR Re-warehousing / BOE (INR)",
      fmtMoney(quote?.mooWRReeWarehousingCharges),
    ],
  ];

  let costRows = [...baseRows];
  if (scheme === "home") costRows = [...costRows, ...homeOnlyRows];
  if (scheme === "moowr") costRows = [...costRows, ...moowrOnlyRows];
  if (scheme === "mixed")
    costRows = [...costRows, ...homeOnlyRows, ...moowrOnlyRows]; // safe + transparent

  const costTable = `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th align="left" style="padding:10px 12px;font-size:12px;color:#374151;border-bottom:1px solid #e5e7eb;">Charge</th>
        <th align="right" style="padding:10px 12px;font-size:12px;color:#374151;border-bottom:1px solid #e5e7eb;">Value</th>
      </tr>
      ${costRows
        .map(
          ([k, v]) => `
          <tr>
            <td style="padding:10px 12px;font-size:13px;color:#111827;border-bottom:1px solid #f1f5f9;">${k}</td>
            <td align="right" style="padding:10px 12px;font-size:13px;color:#111827;border-bottom:1px solid #f1f5f9;">${v}</td>
          </tr>
        `
        )
        .join("")}
      <tr style="background:#f9fafb;">
        <td style="padding:10px 12px;font-size:13px;color:#111827;font-weight:700;">Quoted Total (${schemeBadge})</td>
        <td align="right" style="padding:10px 12px;font-size:13px;color:#111827;font-weight:800;">
          ${
            scheme === "home"
              ? fmtMoney(quote?.homeTotal)
              : scheme === "moowr"
              ? fmtMoney(quote?.mooWRTotal)
              : `${fmtMoney(quote?.homeTotal)} / ${fmtMoney(quote?.mooWRTotal)}`
          }
        </td>
      </tr>
    </table>
  `;

  const rfqMetaTable = (rows) => `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      ${rows
        .map(
          ([k, v]) => `
        <tr>
          <td style="padding:10px 12px;font-weight:600;color:#1f2937;border-bottom:1px solid #f1f5f9;width:220px;background:#fafafa;">${k}</td>
          <td style="padding:10px 12px;color:#111827;border-bottom:1px solid #f1f5f9;">${
            v || "—"
          }</td>
        </tr>
      `
        )
        .join("")}
    </table>
  `;

  const rfqRows = [
    ["RFQ Number", rfq?.rfqNumber],
    ["Item Description", rfq?.itemDescription],
    ["Company Name", rfq?.companyName],
    ["Supplier Name", rfq?.supplierName],
    ["Port of Loading", rfq?.portOfLoading],
    ["Port of Destination", rfq?.portOfDestination],
    ["Container Type", rfq?.containerType],
    ["Incoterms", rfq?.incoterms],
    ["Req’d Containers", rfq?.numberOfContainers],
    ["Cargo Readiness Date", fmtDateTime(rfq?.cargoReadinessDate)],
  ];

  const allocRows = [
    ["Allocated Scheme", schemeBadge],
    [
      "Allocated HOME",
      fmtNum(allocatedHome) ? String(fmtNum(allocatedHome)) : "0",
    ],
    [
      "Allocated MOOWR",
      fmtNum(allocatedMoowr) ? String(fmtNum(allocatedMoowr)) : "0",
    ],
    ["Reason / Notes", reason ? String(reason) : "—"],
    ["Vendor", vendorName],
    ["Vendor Email", vendorEmail || "—"],
  ];

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Inter,Segoe UI,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:24px;">
        <table width="100%" cellpadding="0" cellspacing="0"
               style="max-width:720px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0ea5e9,#2563eb);padding:20px 24px;color:white;">
              <div style="font-size:18px;font-weight:800;letter-spacing:0.2px;">LEAFI</div>
              <div style="opacity:0.95;font-size:13px;margin-top:4px;">
                Allocation Notification • <span style="font-weight:700;">${schemeBadge}</span>
              </div>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding:22px 24px 8px;">
              <div style="font-size:12px;color:#6b7280;">RFQ</div>
              <div style="font-size:26px;font-weight:900;color:#0f172a;">
                ${rfq?.rfqNumber || "—"}
              </div>
              <div style="margin-top:6px;font-size:13px;color:#334155;line-height:1.6;">
                Containers have been allocated to your quote. Please find the details below.
              </div>
            </td>
          </tr>

          <!-- Allocation Summary -->
          <tr>
            <td style="padding:0 24px 18px;">
              <div style="font-size:13px;font-weight:800;color:#0f172a;margin:10px 0 10px;">
                Allocation Summary
              </div>
              ${rfqMetaTable(allocRows)}
            </td>
          </tr>

          <!-- RFQ Details -->
          <tr>
            <td style="padding:0 24px 18px;">
              <div style="font-size:13px;font-weight:800;color:#0f172a;margin:10px 0 10px;">
                RFQ Details
              </div>
              ${rfqMetaTable(rfqRows)}
            </td>
          </tr>

          <!-- Cost Breakdown -->
          <tr>
            <td style="padding:0 24px 24px;">
              <div style="font-size:13px;font-weight:800;color:#0f172a;margin:10px 0 10px;">
                Quote Cost Breakdown (Dynamic)
              </div>
              <div style="font-size:12px;color:#64748b;margin-bottom:10px;line-height:1.5;">
                Line items are shown based on the allocated scheme (CHA-HOME vs MOOWR).
              </div>
              ${costTable}
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:0 24px 28px;">
              <a href="https://leafi.premierenergies.com"
                 style="display:inline-block;padding:12px 22px;border-radius:10px;
                        background:#2563eb;color:white;font-weight:700;
                        text-decoration:none;font-size:14px;">
                Open LEAFI
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.5;">
              This is an automated email from LEAFI. Please do not reply to this message.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function allocationDeviationInternalTemplate({
  rfq,
  quote,
  vendorName,
  leafiHome,
  leafiMoowr,
  logisticsHome,
  logisticsMoowr,
  reason,
}) {
  const fmtNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const fmtMoney = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? `₹${n.toFixed(2)}` : "₹0.00";
  };

  const fmtDateTime = (d) =>
    d ? new Date(d).toLocaleString("en-IN", { hour12: true }) : "—";

  const deltaHome = fmtNum(logisticsHome) - fmtNum(leafiHome);
  const deltaMoowr = fmtNum(logisticsMoowr) - fmtNum(leafiMoowr);

  const leafiTotal = fmtNum(leafiHome) + fmtNum(leafiMoowr);
  const logisticsTotal = fmtNum(logisticsHome) + fmtNum(logisticsMoowr);
  const deltaTotal = logisticsTotal - leafiTotal;

  const metaTable = (rows) => `
    <table width="100%" cellpadding="0" cellspacing="0"
      style="border-collapse:separate;border-spacing:0;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      ${rows
        .map(
          ([k, v]) => `
        <tr>
          <td style="padding:10px 12px;font-weight:600;color:#1f2937;border-bottom:1px solid #f1f5f9;width:220px;background:#fafafa;">${k}</td>
          <td style="padding:10px 12px;color:#111827;border-bottom:1px solid #f1f5f9;">${
            v == null || v === "" ? "—" : v
          }</td>
        </tr>
      `
        )
        .join("")}
    </table>
  `;

  const rfqRows = [
    ["RFQ Number", rfq?.rfqNumber],
    ["Item Description", rfq?.itemDescription],
    ["Company Name", rfq?.companyName],
    ["Material PO Number", rfq?.materialPONumber],
    ["Supplier Name", rfq?.supplierName],
    ["Port of Loading", rfq?.portOfLoading],
    ["Port of Destination", rfq?.portOfDestination],
    ["Container Type", rfq?.containerType],
    ["Incoterms", rfq?.incoterms],

    ["Req’d Containers", rfq?.numberOfContainers],
    ["Cargo Weight (tons)", rfq?.cargoWeight],
    ["Cargo Readiness Date", fmtDateTime(rfq?.cargoReadinessDate)],
  ];

  const quoteRows = [
    ["Vendor", vendorName],
    ["Quoted Containers", fmtNum(quote?.numberOfContainers)],
    ["Shipping Line", quote?.shippingLineName || "—"],
    ["Container Type", quote?.containerType || "—"],
    ["Vessel Name", quote?.vesselName || "—"],
    ["ETD", fmtDateTime(quote?.vesselETD)],
    ["ETA", fmtDateTime(quote?.vesselETA)],
    ["Transship / Direct", quote?.transshipOrDirect || "—"],
    ["Quote Validity", fmtDateTime(quote?.quoteValidityDate)],
    ["Quote Submitted At", fmtDateTime(quote?.createdAt)],
    ["Message", quote?.message ? String(quote.message) : "—"],
    ["HOME Total (INR)", fmtMoney(quote?.homeTotal)],
    ["MOOWR Total (INR)", fmtMoney(quote?.mooWRTotal)],
  ];

  const leafiAllocRows = [
    ["Vendor", vendorName],
    ["LEAFI HOME (Auto)", fmtNum(leafiHome)],
    ["LEAFI MOOWR (Auto)", fmtNum(leafiMoowr)],
    ["LEAFI TOTAL (Auto)", leafiTotal],
  ];

  const logisticsAllocRows = [
    ["Vendor", vendorName],
    ["Logistics HOME (Manual)", fmtNum(logisticsHome)],
    ["Logistics MOOWR (Manual)", fmtNum(logisticsMoowr)],
    ["Logistics TOTAL (Manual)", logisticsTotal],
    ["Reason / Notes", reason ? String(reason) : "—"],
  ];

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Inter,Segoe UI,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:24px;">
        <table width="100%" cellpadding="0" cellspacing="0"
          style="max-width:820px;background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,0.08);overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#ef4444,#b91c1c);padding:20px 24px;color:white;">
              <div style="font-size:18px;font-weight:900;">LEAFI</div>
              <div style="font-size:13px;opacity:0.95;margin-top:4px;">
                Allocation Deviation Alert • RFQ <span style="font-weight:900;">${
                  rfq?.rfqNumber || "—"
                }</span>
              </div>
            </td>
          </tr>

          <!-- Top Summary -->
          <tr>
            <td style="padding:18px 24px 8px;">
              <div style="font-size:14px;color:#475569;">
                Vendor: <strong>${vendorName || "—"}</strong>
              </div>
              <div style="margin-top:8px;font-size:13px;color:#334155;line-height:1.6;">
                Logistics allocation differs from LEAFI auto allocation. Full context is attached below (RFQ + Quote + both allocations).
              </div>
            </td>
          </tr>

          <!-- LEAFI Allocation -->
<tr>
  <td style="padding:0 24px 18px;">
    <div style="font-size:13px;font-weight:900;color:#0f172a;margin:10px 0;">
      LEAFI Allocation (Auto Baseline)
    </div>
    ${metaTable(leafiAllocRows)}
  </td>
</tr>


          <!-- Logistics Allocation -->
<tr>
  <td style="padding:0 24px 18px;">
    <div style="font-size:13px;font-weight:900;color:#0f172a;margin:10px 0;">
      Logistics Allocation (Manual)
    </div>
    ${metaTable(logisticsAllocRows)}
  </td>
</tr>


          <!-- RFQ Details -->
          <tr>
            <td style="padding:0 24px 18px;">
              <div style="font-size:13px;font-weight:900;color:#0f172a;margin:10px 0 10px;">
                RFQ Details
              </div>
              ${metaTable(rfqRows)}
            </td>
          </tr>

          <!-- Quote Details -->
          <tr>
            <td style="padding:0 24px 24px;">
              <div style="font-size:13px;font-weight:900;color:#0f172a;margin:10px 0 10px;">
                Quote Details (Latest Quote Used)
              </div>
              ${metaTable(quoteRows)}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.5;">
              Internal LEAFI audit notification • Do not reply
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function quoteSubmissionEmailTemplate({
  rfq,
  vendorName,
  quoteInput,
  computed,
}) {
  const fmtDateTime = (d) =>
    d ? new Date(d).toLocaleString("en-IN", { hour12: true }) : "—";

  const fmtNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const fmtMoney = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? `₹${n.toFixed(2)}` : "₹0.00";
  };

  const fmtUSD = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? `${n.toFixed(2)} USD` : "0.00 USD";
  };

  const metaTable = (rows) => `
    <table width="100%" cellpadding="0" cellspacing="0"
      style="border-collapse:separate;border-spacing:0;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      ${rows
        .map(
          ([k, v]) => `
        <tr>
          <td style="padding:10px 12px;font-weight:600;color:#1f2937;border-bottom:1px solid #f1f5f9;width:220px;background:#fafafa;">${k}</td>
          <td style="padding:10px 12px;color:#111827;border-bottom:1px solid #f1f5f9;">${
            v == null || v === "" ? "—" : v
          }</td>
        </tr>
      `
        )
        .join("")}
    </table>
  `;

  const costRows = [
    ["USD→INR Rate Used", fmtNum(computed?.usdToInr).toFixed(4)],
    ["Sea Freight / Container", fmtUSD(quoteInput?.seaFreightPerContainer)],
    [
      "Sea Freight / Container (INR)",
      fmtMoney(computed?.seaFreightPerContainerInINR),
    ],
    ["HDO / BOL (INR)", fmtMoney(quoteInput?.houseDeliveryOrderPerBOL)],
    ["CFS / Container (INR)", fmtMoney(quoteInput?.cfsPerContainer)],
    [
      "Transportation / Container (INR)",
      fmtMoney(quoteInput?.transportationPerContainer),
    ],
    ["EDI / BOE (INR)", fmtMoney(quoteInput?.ediChargesPerBOE)],
    ["CHA-HOME (INR)", fmtMoney(quoteInput?.chaChargesHome)],
    ["CHA-MOOWR (INR)", fmtMoney(quoteInput?.chaChargesMOOWR)],
    [
      "MOOWR Re-warehousing / BOE (INR)",
      fmtMoney(quoteInput?.mooWRReeWarehousingCharges),
    ],
  ];

  const costTable = `
    <table width="100%" cellpadding="0" cellspacing="0"
      style="border-collapse:separate;border-spacing:0;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th align="left" style="padding:10px 12px;font-size:12px;color:#374151;border-bottom:1px solid #e5e7eb;">Charge</th>
        <th align="right" style="padding:10px 12px;font-size:12px;color:#374151;border-bottom:1px solid #e5e7eb;">Value</th>
      </tr>
      ${costRows
        .map(
          ([k, v]) => `
          <tr>
            <td style="padding:10px 12px;font-size:13px;color:#111827;border-bottom:1px solid #f1f5f9;">${k}</td>
            <td align="right" style="padding:10px 12px;font-size:13px;color:#111827;border-bottom:1px solid #f1f5f9;">${v}</td>
          </tr>
        `
        )
        .join("")}
      <tr style="background:#f9fafb;">
        <td style="padding:10px 12px;font-size:13px;color:#111827;font-weight:800;">HOME Total (INR)</td>
        <td align="right" style="padding:10px 12px;font-size:13px;color:#111827;font-weight:900;">
          ${fmtMoney(computed?.homeTotal)}
        </td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 12px;font-size:13px;color:#111827;font-weight:800;">MOOWR Total (INR)</td>
        <td align="right" style="padding:10px 12px;font-size:13px;color:#111827;font-weight:900;">
          ${fmtMoney(computed?.mooWRTotal)}
        </td>
      </tr>
    </table>
  `;

  const rfqRows = [
    ["RFQ Number", rfq?.rfqNumber],
    ["Item Description", rfq?.itemDescription],
    ["Company Name", rfq?.companyName],
    ["Material PO Number", rfq?.materialPONumber],
    ["Supplier Name", rfq?.supplierName],
    ["Port of Loading", rfq?.portOfLoading],
    ["Port of Destination", rfq?.portOfDestination],
    ["Container Type", rfq?.containerType],
    ["Incoterms", rfq?.incoterms],

    ["Req’d Containers", rfq?.numberOfContainers],
    ["Cargo Weight (tons)", rfq?.cargoWeight],
    ["Cargo Readiness Date", fmtDateTime(rfq?.cargoReadinessDate)],
  ];

  const quoteRows = [
    ["Vendor", vendorName],
    ["Quoted Containers", fmtNum(quoteInput?.numberOfContainers)],
    ["Shipping Line", quoteInput?.shippingLineName || "—"],
    ["Container Type", quoteInput?.containerType || "—"],
    ["Vessel Name", quoteInput?.vesselName || "—"],
    ["ETD", fmtDateTime(quoteInput?.vesselETD)],
    ["ETA", fmtDateTime(quoteInput?.vesselETA)],
    ["Transship / Direct", quoteInput?.transshipOrDirect || "—"],
    ["Quote Validity", fmtDateTime(quoteInput?.quoteValidityDate)],
    ["Message", quoteInput?.message ? String(quoteInput.message) : "—"],
  ];

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Inter,Segoe UI,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:24px;">
        <table width="100%" cellpadding="0" cellspacing="0"
          style="max-width:760px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#a855f7,#6d28d9);padding:20px 24px;color:white;">
              <div style="font-size:18px;font-weight:800;letter-spacing:0.2px;">LEAFI</div>
              <div style="opacity:0.95;font-size:13px;margin-top:4px;">
                Quote Submission Notification
              </div>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding:22px 24px 8px;">
              <div style="font-size:12px;color:#6b7280;">RFQ</div>
              <div style="font-size:26px;font-weight:900;color:#0f172a;">
                ${rfq?.rfqNumber || "—"}
              </div>
              <div style="margin-top:6px;font-size:13px;color:#334155;line-height:1.6;">
                A vendor has submitted a quotation for this RFQ. Details are below.
              </div>
            </td>
          </tr>

          <!-- Vendor summary -->
          <tr>
            <td style="padding:0 24px 18px;">
              <div style="font-size:13px;font-weight:800;color:#0f172a;margin:10px 0 10px;">
                Quote Summary
              </div>
              ${metaTable(quoteRows)}
            </td>
          </tr>

          <!-- RFQ Details -->
          <tr>
            <td style="padding:0 24px 18px;">
              <div style="font-size:13px;font-weight:800;color:#0f172a;margin:10px 0 10px;">
                RFQ Details
              </div>
              ${metaTable(rfqRows)}
            </td>
          </tr>

          <!-- Cost Breakdown -->
          <tr>
            <td style="padding:0 24px 24px;">
              <div style="font-size:13px;font-weight:800;color:#0f172a;margin:10px 0 10px;">
                Cost Breakdown (Computed)
              </div>
              <div style="font-size:12px;color:#64748b;margin-bottom:10px;line-height:1.5;">
                Sea Freight is entered in USD; totals are computed in INR using the live USD→INR rate (fallback applied if API fails).
              </div>
              ${costTable}
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:0 24px 28px;">
              <a href="https://leafi.premierenergies.com"
                 style="display:inline-block;padding:12px 22px;border-radius:10px;
                        background:#6d28d9;color:white;font-weight:800;
                        text-decoration:none;font-size:14px;">
                Open LEAFI
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.5;">
              This is an automated email from LEAFI. Please do not reply to this message.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function rfqDeletionInternalEmailTemplate({
  rfq,
  quotes,
  deletedBy,
  deletedAt,
  reason,
}) {
  const fmtDateTime = (d) =>
    d ? new Date(d).toLocaleString("en-IN", { hour12: true }) : "—";

  const metaTable = (rows) => `
    <table width="100%" cellpadding="0" cellspacing="0"
      style="border-collapse:separate;border-spacing:0;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      ${rows
        .map(
          ([k, v]) => `
        <tr>
          <td style="padding:10px 12px;font-weight:600;color:#1f2937;border-bottom:1px solid #f1f5f9;width:220px;background:#fafafa;">${k}</td>
          <td style="padding:10px 12px;color:#111827;border-bottom:1px solid #f1f5f9;">${
            v == null || v === "" ? "—" : v
          }</td>
        </tr>
      `
        )
        .join("")}
    </table>
  `;

  const quoteSummaryRows =
    (quotes || []).length > 0
      ? (quotes || [])
          .map(
            (quote) => `
              <tr>
                <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#111827;">${
                  quote.vendorName || "—"
                }</td>
                <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#111827;">${
                  quote.numberOfContainers ?? "—"
                }</td>
                <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#111827;">${
                  quote.homeTotal == null
                    ? "—"
                    : `₹${Number(quote.homeTotal).toFixed(2)}`
                }</td>
                <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#111827;">${
                  quote.mooWRTotal == null
                    ? "—"
                    : `₹${Number(quote.mooWRTotal).toFixed(2)}`
                }</td>
              </tr>
            `
          )
          .join("")
      : `
          <tr>
            <td colspan="4" style="padding:12px;color:#6b7280;">No quotes were submitted for this RFQ.</td>
          </tr>
        `;

  const rfqRows = [
    ["RFQ Number", rfq?.rfqNumber],
    ["Item Description", rfq?.itemDescription],
    ["Company Name", rfq?.companyName],
    ["Material PO Number", rfq?.materialPONumber],
    ["Supplier Name", rfq?.supplierName],
    ["Port of Loading", rfq?.portOfLoading],
    ["Port of Destination", rfq?.portOfDestination],
    ["Container Type", rfq?.containerType],
    ["Incoterms", rfq?.incoterms],
    ["Req’d Containers", rfq?.numberOfContainers],
    ["Cargo Weight (tons)", rfq?.cargoWeight],
    ["Cargo Readiness", fmtDateTime(rfq?.cargoReadinessDate)],
    ["Description", rfq?.description],
  ];

  const deletionRows = [
    ["Deleted By", deletedBy],
    ["Deletion Timestamp", fmtDateTime(deletedAt)],
    ["Deletion Reason", reason],
    ["Quotes Deleted", String((quotes || []).length)],
  ];

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Inter,Segoe UI,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:24px;">
        <table width="100%" cellpadding="0" cellspacing="0"
          style="max-width:780px;background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,0.08);overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#f97316,#dc2626);padding:20px 24px;color:white;">
              <div style="font-size:18px;font-weight:900;">LEAFI</div>
              <div style="font-size:13px;opacity:0.95;margin-top:4px;">
                RFQ Deletion Notice • RFQ <span style="font-weight:900;">${
                  rfq?.rfqNumber || "—"
                }</span>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 24px 8px;">
              <div style="font-size:13px;color:#475569;line-height:1.7;">
                An RFQ was deleted before finalization. Full deletion context and the deleted RFQ details are included below.
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:0 24px 18px;">
              <div style="font-size:13px;font-weight:900;color:#0f172a;margin:10px 0;">
                Deletion Details
              </div>
              ${metaTable(deletionRows)}
            </td>
          </tr>

          <tr>
            <td style="padding:0 24px 18px;">
              <div style="font-size:13px;font-weight:900;color:#0f172a;margin:10px 0;">
                RFQ Details
              </div>
              ${metaTable(rfqRows)}
            </td>
          </tr>

          <tr>
            <td style="padding:0 24px 24px;">
              <div style="font-size:13px;font-weight:900;color:#0f172a;margin:10px 0;">
                Deleted Quote Summary
              </div>
              <table width="100%" cellpadding="0" cellspacing="0"
                style="border-collapse:separate;border-spacing:0;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
                <tr style="background:#f9fafb;">
                  <th align="left" style="padding:10px 12px;font-size:12px;color:#374151;border-bottom:1px solid #e5e7eb;">Vendor</th>
                  <th align="left" style="padding:10px 12px;font-size:12px;color:#374151;border-bottom:1px solid #e5e7eb;">Quoted Containers</th>
                  <th align="left" style="padding:10px 12px;font-size:12px;color:#374151;border-bottom:1px solid #e5e7eb;">HOME Total</th>
                  <th align="left" style="padding:10px 12px;font-size:12px;color:#374151;border-bottom:1px solid #e5e7eb;">MOOWR Total</th>
                </tr>
                ${quoteSummaryRows}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.5;">
              Internal LEAFI deletion audit notification • Do not reply
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function rfqDeletionVendorEmailTemplate({ rfq, vendorName }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Inter,Segoe UI,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:24px;">
        <table width="100%" cellpadding="0" cellspacing="0"
          style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:20px 24px;color:white;">
              <div style="font-size:18px;font-weight:900;">LEAFI</div>
              <div style="font-size:13px;opacity:0.95;margin-top:4px;">
                RFQ Deleted
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 24px 10px;">
              <div style="font-size:13px;color:#64748b;">Vendor</div>
              <div style="font-size:24px;font-weight:900;color:#0f172a;">${
                vendorName || "Vendor"
              }</div>
            </td>
          </tr>

          <tr>
            <td style="padding:0 24px 16px;color:#334155;font-size:14px;line-height:1.7;">
              RFQ <strong>${
                rfq?.rfqNumber || "—"
              }</strong> has been deleted in LEAFI. For more information, please contact <strong>ramanjulu@premierenergies.com</strong>.
            </td>
          </tr>

          <tr>
            <td style="padding:0 24px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0"
                style="border-collapse:separate;border-spacing:0;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
                <tr>
                  <td style="padding:10px 12px;font-weight:600;color:#1f2937;border-bottom:1px solid #f1f5f9;width:180px;background:#fafafa;">RFQ Number</td>
                  <td style="padding:10px 12px;color:#111827;border-bottom:1px solid #f1f5f9;">${
                    rfq?.rfqNumber || "—"
                  }</td>
                </tr>
                <tr>
                  <td style="padding:10px 12px;font-weight:600;color:#1f2937;border-bottom:1px solid #f1f5f9;width:180px;background:#fafafa;">Item Description</td>
                  <td style="padding:10px 12px;color:#111827;border-bottom:1px solid #f1f5f9;">${
                    rfq?.itemDescription || "—"
                  }</td>
                </tr>
                <tr>
                  <td style="padding:10px 12px;font-weight:600;color:#1f2937;border-bottom:1px solid #f1f5f9;width:180px;background:#fafafa;">Material PO Number</td>
                  <td style="padding:10px 12px;color:#111827;border-bottom:1px solid #f1f5f9;">${
                    rfq?.materialPONumber || "—"
                  }</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.6;">
              This is an automated message from LEAFI. Please do not reply.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function getIstDate(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
}

function istDayKey(date = new Date()) {
  const d = getIstDate(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function istDateLabel(dateKey) {
  const [yyyy, mm, dd] = String(dateKey || "")
    .split("-")
    .map(Number);
  if (!yyyy || !mm || !dd) return "—";
  const utc = new Date(Date.UTC(yyyy, mm - 1, dd));
  return utc.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function istRangeUtc(dateKeyFrom, dateKeyTo) {
  const [fy, fm, fd] = dateKeyFrom.split("-").map(Number);
  const [ty, tm, td] = dateKeyTo.split("-").map(Number);
  const fromUtc = new Date(
    Date.UTC(fy, fm - 1, fd, 0, -IST_OFFSET_MINUTES, 0, 0)
  );
  const toUtc = new Date(
    Date.UTC(ty, tm - 1, td, 23, 59 - IST_OFFSET_MINUTES, 59, 999)
  );
  return { fromUtc, toUtc };
}

function previousIstDayKey(dateKey, daysBack = 1) {
  const [yyyy, mm, dd] = String(dateKey || "")
    .split("-")
    .map(Number);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  d.setUTCDate(d.getUTCDate() - daysBack);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateTimeIst(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

function formatMoneyInr(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? `₹${n.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : "—";
}

function formatUsd(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)} USD` : "—";
}

function buildReportDigestQuoteTable(quoteRows, scheme) {
  const isHome = scheme === "home";
  const title = isHome ? "HOME Quotes" : "MOOWR Quotes";
  const allocatedField = isHome ? "home" : "moowr";
  const totalValueKey = isHome ? "homeTotal" : "mooWRTotal";
  const chargeValueKey = isHome ? "chaChargesHome" : "chaChargesMOOWR";
  const chargeLabel = isHome ? "CHA HOME" : "CHA MOOWR";
  const colSpan = isHome ? 10 : 11;

  const rows = quoteRows.length
    ? quoteRows
        .map((quote) => {
          const allocation = quote.allocation || {
            home: 0,
            moowr: 0,
            reasons: [],
          };
          const allocatedQty = Number(allocation[allocatedField] || 0);
          const isAllocated = allocatedQty > 0;
          const deviationReasons = Array.from(
            new Set(quote.deviationReasons || allocation.reasons || [])
          );

          return `
            <tr style="${isAllocated ? "background:#ecfdf5;" : ""}">
              <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;">
                <div style="font-weight:700;color:#0f172a;">${
                  quote.vendorName || "—"
                }</div>
                <div style="margin-top:4px;font-size:11px;color:#64748b;">Submitted ${formatDateTimeIst(
                  quote.createdAt
                )}</div>
                <div style="margin-top:4px;font-size:11px;color:#64748b;line-height:1.5;">
                  Containers: ${quote.numberOfContainers ?? "—"}<br />
                  Shipping Line: ${quote.shippingLineName || "—"}<br />
                  Service: ${quote.transshipOrDirect || "—"}
                </div>
              </td>
              <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;">${formatUsd(
                quote.seaFreightPerContainer
              )}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;">${formatMoneyInr(
                quote.houseDeliveryOrderPerBOL
              )}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;">${formatMoneyInr(
                quote.cfsPerContainer
              )}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;">${formatMoneyInr(
                quote.transportationPerContainer
              )}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;">${formatMoneyInr(
                quote.ediChargesPerBOE
              )}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;">${formatMoneyInr(
                quote[chargeValueKey]
              )}</td>
              ${
                isHome
                  ? ""
                  : `<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;">${formatMoneyInr(
                      quote.mooWRReeWarehousingCharges
                    )}</td>`
              }
              <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;font-weight:700;">${formatMoneyInr(
                quote[totalValueKey]
              )}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;">${
                allocatedQty > 0 ? allocatedQty : "—"
              }</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;">
                <div>
                  <span style="display:inline-block;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700;${
                    isAllocated
                      ? "background:#dcfce7;color:#166534;"
                      : "background:#f8fafc;color:#475569;border:1px solid #e2e8f0;"
                  }">
                    ${isAllocated ? "Allocated" : "Quoted"}
                  </span>
                  ${
                    deviationReasons.length
                      ? `<span style="display:inline-block;margin-left:6px;padding:3px 8px;border-radius:999px;background:#fee2e2;color:#b91c1c;font-size:11px;font-weight:700;">Deviation</span>`
                      : ""
                  }
                </div>
                ${
                  deviationReasons.length
                    ? `<div style="margin-top:6px;color:#991b1b;font-size:11px;line-height:1.5;">${deviationReasons.join(
                        " | "
                      )}</div>`
                    : `<div style="margin-top:6px;color:#64748b;font-size:11px;">—</div>`
                }
              </td>
            </tr>
          `;
        })
        .join("")
    : `
      <tr>
        <td colspan="${colSpan}" style="padding:10px;color:#64748b;">No quotes received for this RFQ.</td>
      </tr>
    `;

  return `
    <div style="margin-top:16px;">
      <div style="font-size:13px;font-weight:800;color:#0f172a;margin-bottom:10px;">${title}</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <tr style="background:#f8fafc;">
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;">Vendor / Quote Meta</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;">Sea Freight</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;">HDO / BOL</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;">CFS</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;">Transportation</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;">EDI / BOE</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;">${chargeLabel}</th>
          ${
            isHome
              ? ""
              : `<th align="left" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;">Re-warehousing</th>`
          }
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;">${
            isHome ? "HOME Total" : "MOOWR Total"
          }</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;">Allocated ${
            isHome ? "HOME" : "MOOWR"
          }</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;">Status / Reason</th>
        </tr>
        ${rows}
      </table>
    </div>
  `;
}

function reportDigestEmailTemplate({
  title,
  subtitle,
  dayGroups,
  generatedAt,
}) {
  const renderRfq = (entry) => {
    const rfq = entry.rfq;
    const quoteRows = entry.quoteRows || [];
    const allocationSummary = entry.allocationSummary || [];

    return `
      <div style="margin-top:18px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#ffffff;">
        <div style="padding:16px 18px;border-bottom:1px solid #e5e7eb;background:#f8fafc;">
          <div style="font-size:18px;font-weight:800;color:#0f172a;">RFQ #${
            rfq.rfqNumber
          }</div>
          <div style="margin-top:6px;font-size:13px;color:#334155;">${
            rfq.itemDescription || "—"
          }</div>
          <div style="margin-top:8px;font-size:12px;color:#64748b;line-height:1.7;">
            Company: ${rfq.companyName || "—"} | Material PO: ${
      rfq.materialPONumber || "—"
    } | Route: ${rfq.portOfLoading || "—"} to ${
      rfq.portOfDestination || "—"
    } | Status: ${rfq.status || "—"}
          </div>
          <div style="margin-top:8px;font-size:12px;color:#475569;line-height:1.7;">
            Quotes Received: ${quoteRows.length} | Allocated Vendors: ${
      allocationSummary.length
    } | Containers: ${rfq.numberOfContainers ?? "—"}
          </div>
        </div>

        <div style="padding:16px 18px;">
          ${buildReportDigestQuoteTable(quoteRows, "home")}
          ${buildReportDigestQuoteTable(quoteRows, "moowr")}
        </div>
      </div>
    `;
  };

  const daySections =
    dayGroups.length > 0
      ? dayGroups
          .map(
            (group) => `
        <div style="margin-top:24px;">
          <div style="padding:12px 16px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;">
            <div style="font-size:18px;font-weight:800;color:#1d4ed8;">${
              group.label
            }</div>
            <div style="margin-top:4px;font-size:13px;color:#475569;">${
              group.items.length
            } RFQ(s) floated</div>
          </div>
          ${group.items.map(renderRfq).join("")}
        </div>
      `
          )
          .join("")
      : `
        <div style="margin-top:18px;padding:16px;border-radius:12px;border:1px solid #e5e7eb;background:#ffffff;color:#64748b;">
          No RFQ activity found for this reporting window.
        </div>
      `;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Inter,Segoe UI,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:980px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0ea5e9,#2563eb);padding:22px 26px;color:white;">
              <div style="font-size:20px;font-weight:900;">LEAFI</div>
              <div style="margin-top:4px;font-size:14px;opacity:0.95;">${title}</div>
              <div style="margin-top:6px;font-size:12px;opacity:0.85;">${subtitle}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 24px 0;color:#475569;font-size:13px;line-height:1.7;">
              Generated at ${formatDateTimeIst(generatedAt)} IST
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;">
              ${daySections}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.6;">
              Automated LEAFI report mail. Please do not reply.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

async function getReportDigestDayGroups(pool, dateKeyFrom, dateKeyTo) {
  const { fromUtc, toUtc } = istRangeUtc(dateKeyFrom, dateKeyTo);

  const rfqRes = await pool
    .request()
    .input("fromUtc", sql.DateTime2, fromUtc)
    .input("toUtc", sql.DateTime2, toUtc).query(`
      SELECT *
      FROM dbo.RFQs
      WHERE createdAt >= @fromUtc AND createdAt <= @toUtc
      ORDER BY createdAt DESC
    `);

  const rfqs = rfqRes.recordset || [];
  if (!rfqs.length) return [];

  const rfqIdsCte = rfqs
    .map((_, i) => `SELECT @rfqId${i} AS rfqId`)
    .join(" UNION ALL ");

  let quotesReq = pool.request();
  rfqs.forEach((rfq, i) =>
    quotesReq.input(`rfqId${i}`, sql.UniqueIdentifier, rfq.id)
  );
  const quotesRes = await quotesReq.query(`
    ;WITH R AS (${rfqIdsCte})
    SELECT q.*
    FROM dbo.Quotes q
    INNER JOIN R ON R.rfqId = q.rfqId
    ORDER BY q.createdAt DESC
  `);
  const quotes = quotesRes.recordset || [];

  let allocationsReq = pool.request();
  rfqs.forEach((rfq, i) =>
    allocationsReq.input(`allocRfqId${i}`, sql.UniqueIdentifier, rfq.id)
  );
  const allocIdsCte = rfqs
    .map((_, i) => `SELECT @allocRfqId${i} AS rfqId`)
    .join(" UNION ALL ");
  const allocationsRes = await allocationsReq.query(`
    ;WITH R AS (${allocIdsCte})
    SELECT a.*
    FROM dbo.Allocations a
    INNER JOIN R ON R.rfqId = a.rfqId
    ORDER BY a.createdAt DESC
  `);
  const allocations = allocationsRes.recordset || [];

  const groups = new Map();
  for (const rfq of rfqs) {
    const rfqQuotes = quotes.filter((q) => q.rfqId === rfq.id);
    const rfqAllocations = allocations.filter((a) => a.rfqId === rfq.id);

    const allocationByQuoteId = rfqAllocations.reduce((map, allocation) => {
      const existing = map.get(allocation.quoteId) || {
        home: 0,
        moowr: 0,
        reasons: [],
        vendorName: allocation.vendorName,
      };
      existing.home += Number(allocation.containersAllottedHome || 0);
      existing.moowr += Number(allocation.containersAllottedMOOWR || 0);
      if (allocation.reason && String(allocation.reason).trim()) {
        existing.reasons.push(String(allocation.reason).trim());
      }
      map.set(allocation.quoteId, existing);
      return map;
    }, new Map());

    const quoteRows = rfqQuotes.map((quote) => {
      const allocation = allocationByQuoteId.get(quote.id) || {
        home: 0,
        moowr: 0,
        reasons: [],
        vendorName: quote.vendorName,
      };

      return {
        ...quote,
        allocation,
        deviationReasons: Array.from(new Set(allocation.reasons || [])),
      };
    });

    const allocationSummary = Array.from(
      rfqAllocations.reduce((map, allocation) => {
        const existing = map.get(allocation.vendorName) || {
          vendorName: allocation.vendorName,
          home: 0,
          moowr: 0,
          reasons: [],
        };
        existing.home += Number(allocation.containersAllottedHome || 0);
        existing.moowr += Number(allocation.containersAllottedMOOWR || 0);
        if (allocation.reason && String(allocation.reason).trim()) {
          existing.reasons.push(String(allocation.reason).trim());
        }
        map.set(allocation.vendorName, existing);
        return map;
      }, new Map())
    ).map(([, value]) => ({
      ...value,
      reasons: Array.from(new Set(value.reasons)),
    }));

    const key = istDayKey(rfq.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      rfq,
      quoteRows,
      allocationSummary,
    });
  }

  return Array.from(groups.entries())
    .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
    .map(([key, items]) => ({
      key,
      label: istDateLabel(key),
      items,
    }));
}

async function hasReportRun(pool, runType, runKey) {
  const res = await pool
    .request()
    .input("runType", sql.NVarChar(30), runType)
    .input("runKey", sql.NVarChar(30), runKey).query(`
      SELECT TOP 1 1 AS ok
      FROM dbo.ReportEmailRuns
      WHERE runType = @runType AND runKey = @runKey
    `);
  return Boolean(res.recordset?.[0]?.ok);
}

async function markReportRun(pool, runType, runKey) {
  await pool
    .request()
    .input("runType", sql.NVarChar(30), runType)
    .input("runKey", sql.NVarChar(30), runKey).query(`
      INSERT INTO dbo.ReportEmailRuns (runType, runKey, sentAt)
      VALUES (@runType, @runKey, SYSUTCDATETIME())
    `);
}

async function sendReportDigestEmail({ subject, title, subtitle, dayGroups }) {
  const html = reportDigestEmailTemplate({
    title,
    subtitle,
    dayGroups,
    generatedAt: new Date(),
  });

  await graphClient.api(`/users/${SENDER_EMAIL}/sendMail`).post({
    message: {
      subject,
      body: {
        contentType: "HTML",
        content: html,
      },
      toRecipients: graphRecipientsFromEmails(REPORT_EMAIL_RECIPIENTS),
    },
    saveToSentItems: true,
  });
}

async function maybeSendDailyAndWeeklyDigests() {
  try {
    const now = new Date();
    const istNow = getIstDate(now);
    const hour = istNow.getUTCHours();
    const minute = istNow.getUTCMinutes();

    if (hour !== 23 || minute !== 59) return;

    const pool = await getPool();
    const todayKey = istDayKey(now);

    if (!(await hasReportRun(pool, "daily", todayKey))) {
      const dailyGroups = await getReportDigestDayGroups(
        pool,
        todayKey,
        todayKey
      );
      await sendReportDigestEmail({
        subject: `LEAFI Daily RFQ Report | ${istDateLabel(todayKey)}`,
        title: "Daily RFQ Activity Report",
        subtitle: `RFQs floated, quotes received, and allocated quote details for ${istDateLabel(
          todayKey
        )}`,
        dayGroups: dailyGroups,
      });
      await markReportRun(pool, "daily", todayKey);
      console.log("[REPORT] Daily digest sent for", todayKey);
    }

    const istDayOfWeek = istNow.getUTCDay();
    if (istDayOfWeek === 0 && !(await hasReportRun(pool, "weekly", todayKey))) {
      const weekStartKey = previousIstDayKey(todayKey, 6);
      const weeklyGroups = await getReportDigestDayGroups(
        pool,
        weekStartKey,
        todayKey
      );
      await sendReportDigestEmail({
        subject: `LEAFI Weekly RFQ Summary | ${istDateLabel(
          weekStartKey
        )} to ${istDateLabel(todayKey)}`,
        title: "Weekly RFQ Activity Summary",
        subtitle: `Week ending ${istDateLabel(
          todayKey
        )} (Sunday, 11:59 PM IST)`,
        dayGroups: weeklyGroups,
      });
      await markReportRun(pool, "weekly", todayKey);
      console.log("[REPORT] Weekly digest sent for week ending", todayKey);
    }
  } catch (err) {
    console.error("[REPORT] Scheduled digest failed:", err);
  }
}

function requireBasicAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) return null;

  const raw = Buffer.from(auth.split(" ")[1], "base64").toString();
  const idx = raw.indexOf(":");
  if (idx === -1) return null;

  const username = raw.slice(0, idx);
  const password = raw.slice(idx + 1);
  if (!username || !password) return null;

  return { username, password };
}

function requireAdminOrLogistics(req, res, next) {
  const role = req.user?.role;
  if (role !== "admin" && role !== "logistics") return res.sendStatus(403);
  next();
}
function requireAdmin(req, res, next) {
  const role = req.user?.role;
  if (role !== "admin") return res.sendStatus(403);
  next();
}

const MASTER = {
  itemDescriptions: {
    table: "dbo.Master_ItemDescriptions",
    max: 500,
    extras: [],
  },
  companyNames: {
    table: "dbo.Master_CompanyNames",
    max: sql.MAX,
    extras: ["shortName"],
  },
  suppliers: { table: "dbo.Master_Suppliers", max: 255, extras: [] },
  portsOfLoading: {
    table: "dbo.Master_PortsOfLoading",
    max: 100,
    extras: ["country"],
  },
  portsOfDestination: {
    table: "dbo.Master_PortsOfDestination",
    max: 100,
    extras: [],
  },
  containerTypes: { table: "dbo.Master_ContainerTypes", max: 50, extras: [] },
  incoterms: { table: "dbo.Master_Incoterms", max: 50, extras: [] },
};

function getMasterDef(key) {
  return MASTER[key] || null;
}

async function ensureMasterValue(pool, key, value) {
  const def = getMasterDef(key);
  if (!def) return;

  const v = normalizeMasterValue(key, value);
  if (!v) return;

  const req = pool.request();
  if (def.max === sql.MAX) req.input("v", sql.NVarChar(sql.MAX), v);
  else req.input("v", sql.NVarChar(def.max), v);

  await req.query(`
    IF NOT EXISTS (SELECT 1 FROM ${def.table} WHERE value = @v)
    BEGIN
      INSERT INTO ${def.table}(value, isActive, createdAt)
      VALUES (@v, 1, SYSUTCDATETIME());
    END
  `);
}

async function ensureTransporterFromVendorUser(pool, userLike) {
  const role = String(userLike?.role || "").toLowerCase();
  if (role !== "vendor") return;

  const username = String(userLike?.username || "").trim();
  const name = String(userLike?.name || "").trim();

  // vendorCode MUST come from company (preferred). Fallback to username.
  const vendorCode = String(userLike?.company || "").trim() || username;
  if (!vendorCode) return;

  const vendorName = name || vendorCode;
  const vendorEmail = username.includes("@") ? username.toLowerCase() : null;

  await pool
    .request()
    .input("vendorCode", sql.NVarChar(150), vendorCode)
    .input("vendorName", sql.NVarChar(255), vendorName)
    .input("vendorEmail", sql.NVarChar(255), vendorEmail).query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.Master_Transporters WHERE vendorCode = @vendorCode)
      BEGIN
        INSERT INTO dbo.Master_Transporters (vendorCode, vendorName, vendorEmail, isActive, createdAt)
        VALUES (@vendorCode, @vendorName, @vendorEmail, 1, SYSUTCDATETIME());
      END
      ELSE
      BEGIN
        -- "fill blanks only" to avoid overwriting intentional values
                UPDATE dbo.Master_Transporters
        SET
          vendorName = CASE WHEN NULLIF(LTRIM(RTRIM(vendorName)), '') IS NULL THEN @vendorName ELSE vendorName END,
          vendorEmail = CASE WHEN NULLIF(LTRIM(RTRIM(vendorEmail)), '') IS NULL THEN @vendorEmail ELSE vendorEmail END,

          -- ✅ maintain vendorEmails as a newline-separated list (append if not present)
          vendorEmails = CASE
            WHEN @vendorEmail IS NULL THEN vendorEmails
            WHEN NULLIF(CAST(vendorEmails AS NVARCHAR(MAX)), '') IS NULL THEN @vendorEmail
            WHEN CHARINDEX(LOWER(@vendorEmail), LOWER(CAST(vendorEmails AS NVARCHAR(MAX)))) > 0 THEN vendorEmails
            ELSE CAST(vendorEmails AS NVARCHAR(MAX)) + CHAR(10) + @vendorEmail
          END,

          updatedAt = SYSUTCDATETIME()
        WHERE vendorCode = @vendorCode;
      END
    `);
}

async function ensureVendorUserFromTransporter(pool, transporterLike) {
  const vendorCode = String(transporterLike?.vendorCode || "").trim();
  if (!vendorCode) return;

  const isActive = transporterLike?.isActive;
  if (isActive === false) return; // avoid enabling login for inactive transporters

  const vendorName =
    String(transporterLike?.vendorName || "").trim() || vendorCode;

  const emailRaw = transporterLike?.vendorEmail;
  const vendorEmail =
    emailRaw == null
      ? ""
      : String(emailRaw || "")
          .trim()
          .toLowerCase();

  // username rule: prefer email if present; else vendorCode
  const desiredUsername =
    vendorEmail && vendorEmail.includes("@") ? vendorEmail : vendorCode;

  // Skip if vendor user already exists for this vendorCode
  const existsByCompany = await pool
    .request()
    .input("company", sql.NVarChar(150), vendorCode)
    .query(
      `SELECT TOP 1 1 AS ok FROM dbo.Users WHERE role='vendor' AND company=@company`
    );
  if (existsByCompany.recordset?.length) return;

  // Skip if username already taken (avoid unique violation)
  const existsByUsername = await pool
    .request()
    .input("username", sql.NVarChar(255), desiredUsername)
    .query(
      `SELECT TOP 1 1 AS ok FROM dbo.Users WHERE LOWER(username)=LOWER(@username)`
    );
  if (existsByUsername.recordset?.length) return;

  // Insert vendor user (password is required by schema; OTP login ignores it)
  await pool
    .request()
    .input("username", sql.NVarChar(255), desiredUsername)
    .input("password", sql.NVarChar(255), desiredUsername)
    .input("role", sql.NVarChar(20), "vendor")
    .input("name", sql.NVarChar(100), vendorName)
    .input("company", sql.NVarChar(150), vendorCode).query(`
      INSERT INTO dbo.Users (username, password, role, name, company)
      VALUES (@username, @password, @role, @name, @company)
    `);
}

// ─────────────────────────────────────────────────────────────────────────────
// App & Middleware (match reference style)
// ─────────────────────────────────────────────────────────────────────────────
const app = express();
app.use(cookieParser());

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],

        // model-viewer / three.js decoders can require wasm eval in some builds
        scriptSrc: ["'self'", "'wasm-unsafe-eval'", "'unsafe-eval'"],

        // if model-viewer spins up workers / blobs
        workerSrc: ["'self'", "blob:"],

        // allow model files / textures
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "data:", "blob:"],

        // GLB fetch
        connectSrc: ["'self'"],

        // shadcn/tailwind often ok without inline, but keep if you have inline styles
        styleSrc: ["'self'", "'unsafe-inline'"],

        fontSrc: ["'self'", "data:"],
      },
    },
  })
);

const corsOrigin = process.env.CORS_ORIGIN; // comma-separated if you want
app.use(
  cors({
    origin: corsOrigin
      ? corsOrigin
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : true, // reflect origin
    credentials: true,
  })
);

app.use(compression());
app.use(express.json({ limit: "25mb" }));
app.use(
  morgan("dev", {
    skip: () => process.env.NODE_ENV === "test",
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Basic Auth middleware (uses shared pool)
// ─────────────────────────────────────────────────────────────────────────────
async function authenticate(req, res, next) {
  const creds = requireBasicAuth(req);
  const cookieToken = req.cookies?.leafi_session;

  // Prefer cookie session whenever present (avoids stale Basic header causing 401 loops)
  if (cookieToken) {
    const s = sessionStore.get(cookieToken);
    if (s) {
      if (Date.now() > s.expiresAt) {
        sessionStore.delete(cookieToken);
      } else {
        req.user = s.user;
        return next();
      }
    }
  }

  // Basic-auth fallback
  if (!creds) return res.sendStatus(401);

  // 1) session-token auth (token is sent as BasicAuth password)
  const session = sessionStore.get(creds.password);
  if (session) {
    if (Date.now() > session.expiresAt) {
      sessionStore.delete(creds.password);
      return res.sendStatus(401);
    }
    if (
      String(session.user?.username || "").toLowerCase() !==
      String(creds.username || "").toLowerCase()
    ) {
      return res.sendStatus(401);
    }
    req.user = session.user;
    return next();
  }

  // 2) fallback legacy DB username+password...
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("username", sql.NVarChar, creds.username)
      .input("password", sql.NVarChar, creds.password).query(`
        SELECT TOP 1 id, username, role, name, company
        FROM dbo.Users
        WHERE username = @username AND password = @password
      `);

    if (!result.recordset.length) return res.sendStatus(401);

    req.user = result.recordset[0];
    next();
  } catch (err) {
    console.error("[AUTH] error:", err);
    res.sendStatus(500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// Auth route (same behavior as before, but uses pool)
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username) {
    return res.status(400).json({ message: "username/email required" });
  }

  try {
    const pool = await getPool();

    // Find user by username OR email (case-insensitive)
    const user = await findUserForLogin(pool, username);

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    // Canonical OTP key is ALWAYS the DB username (lowercased)
    const otpKey = String(user.username || "")
      .trim()
      .toLowerCase();

    // STEP 1: request OTP (password empty)
    // STEP 1: request OTP (password empty)
    if (!password) {
      const otp = genOtp4();
      otpStore.set(otpKey, {
        otp,
        expiresAt: Date.now() + OTP_TTL_MS,
      });

      const toEmail = await resolveOtpEmailForUser(pool, user);

      if (!toEmail || !toEmail.includes("@")) {
        otpStore.delete(otpKey);
        return res.status(400).json({
          message:
            "No email configured for this user. For vendors, set vendorEmail in Transporter Master.",
        });
      }

      try {
        await sendOtpEmail({ toEmail, otp });
      } catch (e) {
        console.error("[GRAPH] OTP email failed:", e?.message || e);
        otpStore.delete(otpKey);
        return res
          .status(500)
          .json({ message: "Failed to send OTP email. Try again." });
      }

      return res.json({ ok: true, step: "otp_sent" });
    }

    // STEP 2: verify OTP (password is OTP)
    const rec = otpStore.get(otpKey);
    if (!rec || Date.now() > rec.expiresAt) {
      otpStore.delete(otpKey);
      return res.status(401).json({ message: "OTP expired. Request again." });
    }

    if (String(password) !== String(rec.otp)) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    otpStore.delete(otpKey);

    // Create session token (used as BasicAuth password for all subsequent API calls)
    const sessionToken = genSessionToken();
    sessionStore.set(sessionToken, {
      user,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    // ✅ NEW: set HttpOnly cookie so refresh stays logged-in
    res.cookie("leafi_session", sessionToken, {
      httpOnly: true,
      secure: true, // your server is HTTPS
      sameSite: "lax",
      maxAge: SESSION_TTL_MS,
      path: "/",
    });

    // Optional: non-HttpOnly helper cookie (useful for UI-only checks)
    res.cookie("leafi_user", String(user.username || ""), {
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      maxAge: SESSION_TTL_MS,
      path: "/",
    });

    return res.json({ ok: true, step: "authenticated", user, sessionToken });
  } catch (err) {
    console.error("[API] /api/login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Session bootstrap endpoint (frontend calls this on refresh)
app.get("/api/me", authenticate, (req, res) => {
  return res.json({ ok: true, user: req.user });
});

// ✅ Logout clears cookie + server session
app.post("/api/logout", (req, res) => {
  const token = req.cookies?.leafi_session;
  if (token) sessionStore.delete(token);

  res.clearCookie("leafi_session", { path: "/" });
  res.clearCookie("leafi_user", { path: "/" });

  return res.json({ ok: true });
});

// ========================= ADMIN: MASTERS + TRANSPORTERS =========================
// CMD+F: ADMIN: MASTERS + TRANSPORTERS

app.get(
  "/api/admin/masters",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    try {
      // used by UI only for labels; keep minimal
      return res.json(Object.keys(MASTER).map((k) => ({ key: k, label: k })));
    } catch (e) {
      return res.status(500).json({ message: "Failed to load masters" });
    }
  }
);

app.get(
  "/api/admin/masters/:key",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const key = req.params.key;
    const def = getMasterDef(key);
    if (!def) return res.status(400).json({ message: "Invalid master key" });

    try {
      const pool = await getPool();

      const extraSelect =
        key === "companyNames"
          ? ", CAST(shortName AS NVARCHAR(100)) AS shortName"
          : key === "portsOfLoading"
          ? ", CAST(country AS NVARCHAR(100)) AS country"
          : "";

      const r = await pool.request().query(`
      SELECT
        CAST(id AS NVARCHAR(50)) AS id,
        CAST([value] AS NVARCHAR(MAX)) AS [value]
        ${extraSelect}
        , CAST(isActive AS BIT) AS isActive
        , createdAt
        , updatedAt
      FROM ${def.table}
      ORDER BY createdAt DESC
    `);

      return res.json(r.recordset || []);
    } catch (e) {
      console.error("[ADMIN] GET masters failed:", e?.message || e);
      return res.status(500).json({ message: "Failed to load master rows" });
    }
  }
);

app.post(
  "/api/admin/masters/:key",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const key = req.params.key;
    const def = getMasterDef(key);
    if (!def) return res.status(400).json({ message: "Invalid master key" });

    const value = normalizeMasterValue(key, req.body?.value);
    const isActive = req.body?.isActive === false ? 0 : 1;

    const shortNameRaw = req.body?.shortName;
    const countryRaw = req.body?.country;

    const shortName =
      key === "companyNames"
        ? shortNameRaw == null
          ? null
          : String(shortNameRaw).trim() || null
        : null;

    const country =
      key === "portsOfLoading"
        ? countryRaw == null
          ? null
          : String(countryRaw).trim() || null
        : null;

    if (!value) return res.status(400).json({ message: "value required" });

    try {
      const pool = await getPool();

      // prevent duplicates (case-insensitive)
      const exists = await pool
        .request()
        .input("v", sql.NVarChar(sql.MAX), value)
        .query(
          `SELECT TOP 1 1 AS ok FROM ${def.table} WHERE LOWER(LTRIM(RTRIM([value]))) = LOWER(LTRIM(RTRIM(@v)))`
        );
      if (exists.recordset?.length) {
        return res.status(409).json({ message: "Value already exists" });
      }

      const rq = pool.request();
      if (def.max === sql.MAX) rq.input("v", sql.NVarChar(sql.MAX), value);
      else rq.input("v", sql.NVarChar(def.max), value);

      rq.input("isActive", sql.Bit, isActive);

      if (key === "companyNames")
        rq.input("shortName", sql.NVarChar(100), shortName);
      if (key === "portsOfLoading")
        rq.input("country", sql.NVarChar(100), country);

      const cols = ["value", "isActive", "createdAt"];
      const vals = ["@v", "@isActive", "SYSUTCDATETIME()"];

      if (key === "companyNames") {
        cols.push("shortName");
        vals.push("@shortName");
      }
      if (key === "portsOfLoading") {
        cols.push("country");
        vals.push("@country");
      }

      await rq.query(`
      INSERT INTO ${def.table} (${cols.join(", ")})
      VALUES (${vals.join(", ")})
    `);

      return res.json({ ok: true });
    } catch (e) {
      console.error("[ADMIN] POST masters failed:", e?.message || e);
      return res.status(500).json({ message: "Failed to create master row" });
    }
  }
);

app.put(
  "/api/admin/masters/:key/:id",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const key = req.params.key;
    const def = getMasterDef(key);
    if (!def) return res.status(400).json({ message: "Invalid master key" });

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "id required" });

    const value =
      req.body?.value != null
        ? normalizeMasterValue(key, req.body.value)
        : null;
    const isActive = req.body?.isActive;

    const shortName =
      key === "companyNames" && "shortName" in (req.body || {})
        ? req.body.shortName == null
          ? null
          : String(req.body.shortName).trim() || null
        : undefined;

    const country =
      key === "portsOfLoading" && "country" in (req.body || {})
        ? req.body.country == null
          ? null
          : String(req.body.country).trim() || null
        : undefined;

    try {
      const pool = await getPool();

      const rq = pool.request();
      rq.input("id", sql.UniqueIdentifier, id);

      const sets = [];
      if (value != null) {
        if (!value)
          return res.status(400).json({ message: "value cannot be empty" });

        if (def.max === sql.MAX) rq.input("v", sql.NVarChar(sql.MAX), value);
        else rq.input("v", sql.NVarChar(def.max), value);

        sets.push("[value] = @v");
      }

      if (typeof isActive === "boolean") {
        rq.input("isActive", sql.Bit, isActive);
        sets.push("isActive = @isActive");
      }

      if (shortName !== undefined) {
        rq.input("shortName", sql.NVarChar(100), shortName);
        sets.push("shortName = @shortName");
      }

      if (country !== undefined) {
        rq.input("country", sql.NVarChar(100), country);
        sets.push("country = @country");
      }

      sets.push("updatedAt = SYSUTCDATETIME()");

      await rq.query(`
      UPDATE ${def.table}
      SET ${sets.join(", ")}
      WHERE id = @id
    `);

      return res.json({ ok: true });
    } catch (e) {
      console.error("[ADMIN] PUT masters failed:", e?.message || e);
      return res.status(500).json({ message: "Failed to update master row" });
    }
  }
);

app.delete(
  "/api/admin/masters/:key/:id",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const key = req.params.key;
    const def = getMasterDef(key);
    if (!def) return res.status(400).json({ message: "Invalid master key" });

    try {
      const pool = await getPool();
      await pool.request().input("id", sql.UniqueIdentifier, req.params.id)
        .query(`
        UPDATE ${def.table}
        SET isActive = 0, updatedAt = SYSUTCDATETIME()
        WHERE id = @id
      `);
      return res.json({ ok: true });
    } catch (e) {
      console.error("[ADMIN] DELETE masters failed:", e?.message || e);
      return res.status(500).json({ message: "Failed to disable master row" });
    }
  }
);

// ------------------------- Transporters -------------------------

app.get(
  "/api/admin/transporters",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    try {
      const pool = await getPool();
      const r = await pool.request().query(`
      SELECT
        CAST(id AS NVARCHAR(50)) AS id,
        CAST(vendorCode AS NVARCHAR(150)) AS vendorCode,
        CAST(vendorName AS NVARCHAR(255)) AS vendorName,
        CAST(shortName AS NVARCHAR(100)) AS shortName,
        COALESCE(
          NULLIF(CAST(vendorEmails AS NVARCHAR(MAX)), ''),
          NULLIF(LTRIM(RTRIM(vendorEmail)), '')
        ) AS vendorEmail,
        CAST(isActive AS BIT) AS isActive,
        createdAt,
        updatedAt
      FROM dbo.Master_Transporters
      ORDER BY createdAt DESC
    `);

      return res.json(r.recordset || []);
    } catch (e) {
      console.error("[ADMIN] GET transporters failed:", e?.message || e);
      return res.status(500).json({ message: "Failed to load transporters" });
    }
  }
);

app.post(
  "/api/admin/transporters",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const vendorCode = String(req.body?.vendorCode || "").trim();
    const vendorName = String(req.body?.vendorName || "").trim();
    const shortNameRaw = req.body?.shortName;
    const vendorEmailRaw = req.body?.vendorEmail;

    // Parse multi emails from the same field
    // ✅ Parse multi emails from the same field (UI provides one textbox)
    const emailList = parseEmailList(vendorEmailRaw);
    const vendorEmailPrimary = emailList[0] || null; // primary
    const vendorEmails = emailList.length ? emailList.join("\n") : null; // list

    const shortName =
      shortNameRaw == null ? null : String(shortNameRaw).trim() || null;

    // store primary in vendorEmail, full list in vendorEmails
    const vendorEmail = vendorEmailPrimary;

    const isActive = req.body?.isActive === false ? 0 : 1;

    if (!vendorCode || !vendorName) {
      return res
        .status(400)
        .json({ message: "vendorCode and vendorName required" });
    }

    try {
      const pool = await getPool();

      const exists = await pool
        .request()
        .input("vendorCode", sql.NVarChar(150), vendorCode)
        .query(
          `SELECT TOP 1 1 AS ok FROM dbo.Master_Transporters WHERE vendorCode=@vendorCode`
        );
      if (exists.recordset?.length) {
        return res.status(409).json({ message: "vendorCode already exists" });
      }

      await pool
        .request()
        .input("vendorCode", sql.NVarChar(150), vendorCode)
        .input("vendorName", sql.NVarChar(255), vendorName)
        .input("shortName", sql.NVarChar(100), shortName)
        .input("vendorEmail", sql.NVarChar(255), vendorEmail)
        .input("vendorEmails", sql.NVarChar(sql.MAX), vendorEmails)
        .input("isActive", sql.Bit, isActive).query(`
        INSERT INTO dbo.Master_Transporters
          (vendorCode, vendorName, shortName, vendorEmail, vendorEmails, isActive, createdAt)
        VALUES
          (@vendorCode, @vendorName, @shortName, @vendorEmail, @vendorEmails, @isActive, SYSUTCDATETIME())
      `);

      // keep vendor user in sync (insert-only)
      await ensureVendorUserFromTransporter(pool, {
        vendorCode,
        vendorName,
        vendorEmail: vendorEmailPrimary,
        isActive,
      });

      return res.json({ ok: true });
    } catch (e) {
      console.error("[ADMIN] POST transporters failed:", e?.message || e);
      return res.status(500).json({ message: "Failed to create transporter" });
    }
  }
);

app.put(
  "/api/admin/transporters/:id",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "id required" });

    const vendorCode =
      req.body?.vendorCode != null ? String(req.body.vendorCode).trim() : null;
    const vendorName =
      req.body?.vendorName != null ? String(req.body.vendorName).trim() : null;
    const shortName =
      "shortName" in (req.body || {})
        ? req.body.shortName == null
          ? null
          : String(req.body.shortName).trim() || null
        : undefined;
    // vendorEmail textbox can contain multiple emails
    const vendorEmailInput =
      "vendorEmail" in (req.body || {}) ? req.body.vendorEmail : undefined;

    const vendorEmailParsed =
      vendorEmailInput === undefined
        ? undefined
        : parseEmailList(vendorEmailInput);

    const vendorEmail =
      vendorEmailParsed === undefined
        ? undefined
        : vendorEmailParsed[0] || null;

    const vendorEmails =
      vendorEmailParsed === undefined
        ? undefined
        : vendorEmailParsed.length
        ? vendorEmailParsed.join("\n")
        : null;

    const isActive = req.body?.isActive;

    try {
      const pool = await getPool();

      const rq = pool.request();
      rq.input("id", sql.UniqueIdentifier, id);

      const sets = [];
      if (vendorCode != null) {
        if (!vendorCode)
          return res
            .status(400)
            .json({ message: "vendorCode cannot be empty" });
        rq.input("vendorCode", sql.NVarChar(150), vendorCode);
        sets.push("vendorCode=@vendorCode");
      }
      if (vendorName != null) {
        if (!vendorName)
          return res
            .status(400)
            .json({ message: "vendorName cannot be empty" });
        rq.input("vendorName", sql.NVarChar(255), vendorName);
        sets.push("vendorName=@vendorName");
      }
      if (shortName !== undefined) {
        rq.input("shortName", sql.NVarChar(100), shortName);
        sets.push("shortName=@shortName");
      }
      if (vendorEmail !== undefined) {
        rq.input("vendorEmail", sql.NVarChar(255), vendorEmail);
        rq.input("vendorEmails", sql.NVarChar(sql.MAX), vendorEmails);

        sets.push("vendorEmail=@vendorEmail");
        sets.push("vendorEmails=@vendorEmails");
      }

      if (typeof isActive === "boolean") {
        rq.input("isActive", sql.Bit, isActive);
        sets.push("isActive=@isActive");
      }

      sets.push("updatedAt=SYSUTCDATETIME()");

      await rq.query(`
      UPDATE dbo.Master_Transporters
      SET ${sets.join(", ")}
      WHERE id=@id
    `);

      // best-effort: keep vendor user insert-only
      const after = await pool.request().input("id", sql.UniqueIdentifier, id)
        .query(`
      SELECT TOP 1 vendorCode, vendorName, vendorEmail, isActive
      FROM dbo.Master_Transporters WHERE id=@id
    `);
      await ensureVendorUserFromTransporter(pool, after.recordset?.[0]);

      return res.json({ ok: true });
    } catch (e) {
      console.error("[ADMIN] PUT transporters failed:", e?.message || e);
      return res.status(500).json({ message: "Failed to update transporter" });
    }
  }
);

app.delete(
  "/api/admin/transporters/:id",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    try {
      const pool = await getPool();
      await pool.request().input("id", sql.UniqueIdentifier, req.params.id)
        .query(`
        UPDATE dbo.Master_Transporters
        SET isActive=0, updatedAt=SYSUTCDATETIME()
        WHERE id=@id
      `);
      return res.json({ ok: true });
    } catch (e) {
      console.error("[ADMIN] DELETE transporters failed:", e?.message || e);
      return res.status(500).json({ message: "Failed to disable transporter" });
    }
  }
);

// ========================= ADMIN: REPORTS =========================
// CMD+F: ADMIN: REPORTS

app.get(
  "/api/admin/reports/ocean-freight-top3",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    try {
      const pool = await getPool();
      const basis = String(req.query.dateBasis || "quote").toLowerCase();

      // "displayDate" is what the UI labels (and sorts ties by). It switches based on ?dateBasis.
      const displayExpr =
        basis === "rfq"
          ? "r.createdAt"
          : basis === "finalized"
          ? "r.finalizedAt"
          : "q.createdAt";

      const q = await pool.request().query(`
        ;WITH LatestPerVendor AS (
          SELECT
            r.portOfLoading AS portOfLoading,
            COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType) AS containerType,
            CAST(r.numberOfContainers AS INT) AS containersQty,
            CAST(q.seaFreightPerContainer AS FLOAT) AS oceanFreightUsd,
            q.createdAt AS quoteDate,
            r.createdAt AS rfqCreatedAt,
            r.finalizedAt AS rfqFinalizedAt,
            ${displayExpr} AS displayDate,
            q.vendorName AS vendorName,
            CAST(r.rfqNumber AS INT) AS rfqNumber,
            CAST(r.id AS NVARCHAR(50)) AS rfqId,
            CAST(q.id AS NVARCHAR(50)) AS quoteId,
            ROW_NUMBER() OVER (
              PARTITION BY
                q.vendorName,
                r.portOfLoading,
                COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType)
              ORDER BY q.createdAt DESC
            ) AS rnLatest
          FROM dbo.Quotes q
          INNER JOIN dbo.RFQs r ON r.id = q.rfqId
          WHERE
            r.portOfLoading IS NOT NULL
            AND COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType) IS NOT NULL
            AND q.seaFreightPerContainer IS NOT NULL
            AND q.seaFreightPerContainer > 0
        ),
        Ranked AS (
          SELECT
            portOfLoading, containerType, containersQty, oceanFreightUsd,
            quoteDate, rfqCreatedAt, rfqFinalizedAt, displayDate,
            vendorName, rfqNumber, rfqId, quoteId,
            ROW_NUMBER() OVER (
              PARTITION BY portOfLoading, containerType
              ORDER BY oceanFreightUsd ASC, quoteDate DESC
            ) AS rn
          FROM LatestPerVendor
          WHERE rnLatest = 1
        )
        SELECT
          portOfLoading, containerType, containersQty, oceanFreightUsd,
          quoteDate, rfqCreatedAt, rfqFinalizedAt, displayDate,
          vendorName, rfqNumber, rfqId, quoteId
        FROM Ranked
        WHERE rn <= 3
        ORDER BY portOfLoading ASC, containerType ASC, oceanFreightUsd ASC, quoteDate DESC;
      `);

      return res.json(q.recordset || []);
    } catch (e) {
      console.error("[ADMIN] ocean-freight-top3 failed:", e?.message || e);
      return res.status(500).json({ message: "Failed to load report" });
    }
  }
);

// Drill-down: every quote considered for a given (port, containerType),
// with each vendor's latest-first rank (rank 1 = the row used in Top 3).
app.get(
  "/api/admin/reports/ocean-freight-top3/drill",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    try {
      const pool = await getPool();
      const portOfLoading = String(
        req.query.portOfLoading || req.query.port || ""
      ).trim();
      const containerType = String(req.query.containerType || "").trim();
      if (!portOfLoading || !containerType) {
        return res
          .status(400)
          .json({ message: "portOfLoading and containerType are required" });
      }

      const q = await pool
        .request()
        .input("pol", sql.NVarChar, portOfLoading)
        .input("ct", sql.NVarChar, containerType).query(`
          ;WITH Ranked AS (
            SELECT
              CAST(q.id AS NVARCHAR(50)) AS quoteId,
              CAST(r.id AS NVARCHAR(50)) AS rfqId,
              CAST(r.rfqNumber AS INT) AS rfqNumber,
              q.vendorName AS vendorName,
              r.portOfLoading AS portOfLoading,
              COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType) AS containerType,
              CAST(q.seaFreightPerContainer AS FLOAT) AS oceanFreightUsd,
              q.createdAt AS quoteDate,
              r.createdAt AS rfqCreatedAt,
              r.finalizedAt AS rfqFinalizedAt,
              r.status AS rfqStatus,
              r.numberOfContainers AS rfqContainers,
              q.appliedUsdInrRate AS appliedUsdInrRate,
              ROW_NUMBER() OVER (
                PARTITION BY q.vendorName
                ORDER BY q.createdAt DESC
              ) AS vendorLatestRank
            FROM dbo.Quotes q
            INNER JOIN dbo.RFQs r ON r.id = q.rfqId
            WHERE r.portOfLoading = @pol
              AND COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType) = @ct
              AND q.seaFreightPerContainer IS NOT NULL
              AND q.seaFreightPerContainer > 0
          )
          SELECT *,
                 CASE WHEN vendorLatestRank = 1 THEN 1 ELSE 0 END AS isLatestForVendor
            FROM Ranked
           ORDER BY vendorName ASC, vendorLatestRank ASC;
        `);

      return res.json(q.recordset || []);
    } catch (e) {
      console.error(
        "[ADMIN] ocean-freight-top3 drill failed:",
        e?.message || e
      );
      return res.status(500).json({ message: "Failed to load drill-down" });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: USD/INR fallback backfill (preview + apply)
// Identify quotes whose INR totals were computed using the emergency fallback
// rate (≈75) and recompute them with the historical rate for the quote's date.
// ─────────────────────────────────────────────────────────────────────────────
const USD_INR_FALLBACK_CANDIDATES = [75, 74]; // user-mentioned values
const FALLBACK_MATCH_TOLERANCE = 0.05;

function computeImpliedRate(q) {
  // Implied USD/INR rate = (homeTotal - sum of INR charges) / seaFreightPerContainer
  // We divide by seaFreightPerContainer because that is the only USD input.
  const sea = Number(q.seaFreightPerContainer || 0);
  if (!(sea > 0)) return null;
  const inrCharges =
    Number(q.houseDeliveryOrderPerBOL || 0) +
    Number(q.cfsPerContainer || 0) +
    Number(q.transportationPerContainer || 0) +
    Number(q.chaChargesHome || 0) +
    Number(q.ediChargesPerBOE || 0);
  const homeTotal = Number(q.homeTotal || 0);
  if (!(homeTotal > 0)) return null;
  return (homeTotal - inrCharges) / sea;
}

function isFallbackCandidate(rate) {
  if (!Number.isFinite(rate)) return false;
  return USD_INR_FALLBACK_CANDIDATES.some(
    (v) => Math.abs(rate - v) <= FALLBACK_MATCH_TOLERANCE
  );
}

async function findFallbackCandidates(pool) {
  const r = await pool.request().query(`
    SELECT id, rfqId, vendorName, createdAt,
           seaFreightPerContainer, houseDeliveryOrderPerBOL, cfsPerContainer,
           transportationPerContainer, chaChargesHome, chaChargesMOOWR,
           ediChargesPerBOE, mooWRReeWarehousingCharges,
           homeTotal, mooWRTotal, appliedUsdInrRate
      FROM dbo.Quotes
     WHERE seaFreightPerContainer IS NOT NULL
       AND seaFreightPerContainer > 0
  `);
  const candidates = [];
  for (const q of r.recordset || []) {
    // Prefer explicit appliedUsdInrRate if present
    let rate = Number(q.appliedUsdInrRate);
    if (!Number.isFinite(rate) || rate <= 0) rate = computeImpliedRate(q);
    if (isFallbackCandidate(rate)) {
      candidates.push({ ...q, impliedRate: rate });
    }
  }
  return candidates;
}

function recomputeTotals(q, rate) {
  const sea = Number(q.seaFreightPerContainer || 0);
  const inrCommon =
    Number(q.houseDeliveryOrderPerBOL || 0) +
    Number(q.cfsPerContainer || 0) +
    Number(q.transportationPerContainer || 0) +
    Number(q.ediChargesPerBOE || 0);
  const newHome = sea * rate + inrCommon + Number(q.chaChargesHome || 0);
  const newMoowr =
    sea * rate +
    inrCommon +
    Number(q.chaChargesMOOWR || 0) +
    Number(q.mooWRReeWarehousingCharges || 0);
  return { newHome, newMoowr };
}

app.get(
  "/api/admin/maintenance/usd-inr-backfill/preview",
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const pool = await getPool();
      const candidates = await findFallbackCandidates(pool);

      const sample = candidates.slice(0, 25);
      const enriched = [];
      for (const c of sample) {
        const iso = c.createdAt
          ? new Date(c.createdAt).toISOString().slice(0, 10)
          : null;
        const hist = iso ? await getHistoricalUsdToInrRate(iso) : null;
        let useRate = hist?.rate;
        let source = hist?.source;
        if (!useRate) {
          const live = await getUsdToInrRate();
          useRate = live.rate;
          source = `live-today (${live.source})`;
        }
        enriched.push({
          quoteId: c.id,
          vendorName: c.vendorName,
          quoteDate: iso,
          impliedRate: c.impliedRate,
          historicalRate: useRate,
          historicalDate: hist?.asOf || null,
          source,
        });
      }

      return res.json({
        ok: true,
        candidateCount: candidates.length,
        sampleRows: enriched,
      });
    } catch (e) {
      console.error("[ADMIN] backfill preview failed:", e?.message || e);
      return res.status(500).json({ ok: false, error: e?.message || "failed" });
    }
  }
);

app.post(
  "/api/admin/maintenance/usd-inr-backfill/apply",
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const dryRun = !!req.body?.dryRun;
      const pool = await getPool();
      const candidates = await findFallbackCandidates(pool);

      let updated = 0;
      let skipped = 0;
      let failed = 0;

      for (const c of candidates) {
        const iso = c.createdAt
          ? new Date(c.createdAt).toISOString().slice(0, 10)
          : null;
        const hist = iso ? await getHistoricalUsdToInrRate(iso) : null;
        let newRate = hist?.rate;
        let source = hist?.source || "historical-unavailable";
        if (!Number.isFinite(newRate) || newRate <= 0) {
          const live = await getUsdToInrRate();
          newRate = live.rate;
          source = `live-today (${live.source})`;
        }
        if (!Number.isFinite(newRate) || newRate <= 0) {
          failed += 1;
          continue;
        }

        const { newHome, newMoowr } = recomputeTotals(c, newRate);
        try {
          if (!dryRun) {
            await pool
              .request()
              .input("id", sql.UniqueIdentifier, c.id)
              .input("rate", sql.Float, newRate)
              .input("home", sql.Float, newHome)
              .input("moowr", sql.Float, newMoowr).query(`
                UPDATE dbo.Quotes
                   SET appliedUsdInrRate = @rate,
                       homeTotal = @home,
                       mooWRTotal = @moowr
                 WHERE id = @id
              `);
            await pool
              .request()
              .input("quoteId", sql.UniqueIdentifier, c.id)
              .input("oldRate", sql.Float, Number(c.impliedRate) || null)
              .input("newRate", sql.Float, newRate)
              .input("oldHome", sql.Float, Number(c.homeTotal) || null)
              .input("newHome", sql.Float, newHome)
              .input("oldMoowr", sql.Float, Number(c.mooWRTotal) || null)
              .input("newMoowr", sql.Float, newMoowr)
              .input("histDate", sql.NVarChar, hist?.asOf || iso || null)
              .input("source", sql.NVarChar, source)
              .input(
                "runBy",
                sql.NVarChar,
                req.user?.email || req.user?.username || null
              ).query(`
                INSERT INTO dbo.UsdInrBackfillAudit
                  (quoteId, oldRate, newRate, oldHomeTotal, newHomeTotal,
                   oldMoowrTotal, newMoowrTotal, historicalDate, source, runBy)
                VALUES
                  (@quoteId, @oldRate, @newRate, @oldHome, @newHome,
                   @oldMoowr, @newMoowr, @histDate, @source, @runBy)
              `);
          }
          updated += 1;
        } catch (err) {
          console.error("[ADMIN] backfill apply row failed:", err?.message);
          failed += 1;
        }
      }

      skipped = 0; // no current "skip" path; all candidates are attempted
      return res.json({
        ok: true,
        dryRun,
        totalCandidates: candidates.length,
        updated,
        skipped,
        failed,
      });
    } catch (e) {
      console.error("[ADMIN] backfill apply failed:", e?.message || e);
      return res.status(500).json({ ok: false, error: e?.message || "failed" });
    }
  }
);

// ✅ Master: Ports of Loading (value + country) for Dashboard Country filter
app.get("/api/master/ports-of-loading-meta", async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT
        value,
        NULLIF(LTRIM(RTRIM(country)), '') AS country
      FROM dbo.Master_PortsOfLoading
      WHERE ISNULL(isActive, 1) = 1
      ORDER BY value
    `);
    res.json(r.recordset || []);
  } catch (e) {
    console.error("[master] ports-of-loading-meta failed:", e?.message || e);
    res.status(500).json({ error: "ports_of_loading_meta_failed" });
  }
});

// Master lookups for dropdowns (any authenticated user)
// ========================= LOOKUPS (masters for RFQ create modal) =========================
// CMD+F: app.get("/vendors"
// Master lookups for dropdowns (any authenticated user)
// CMD+F: app.get("/lookups"
app.get("/api/lookups", authenticate, async (req, res) => {
  try {
    const pool = await getPool();

    // CMD+F: async function fetchSimple(table, valueType = sql.NVarChar)
    async function fetchSimple(table, extraSelect = "") {
      const r = await pool.request().query(`
    SELECT
      CAST(id AS NVARCHAR(50)) AS id,
      CAST([value] AS NVARCHAR(MAX)) AS [value]
      ${extraSelect ? "," + extraSelect : ""}
    FROM ${table}
    WHERE ISNULL(isActive, 1) = 1
    ORDER BY [value] ASC
  `);
      return r.recordset || [];
    }

    // CompanyNames can have duplicates (no unique index), so return DISTINCT by value
    // CMD+F: async function fetchCompanyNamesDistinct()
    async function fetchCompanyNamesDistinct() {
      const r = await pool.request().query(`
    SELECT
      MIN(CAST(id AS NVARCHAR(50))) AS id,
      CAST([value] AS NVARCHAR(MAX)) AS [value],
      MAX(CAST(shortName AS NVARCHAR(100))) AS shortName
    FROM dbo.Master_CompanyNames
    WHERE ISNULL(isActive, 1) = 1
    GROUP BY [value]
    ORDER BY [value] ASC
  `);
      return r.recordset || [];
    }

    const [
      itemDescriptions,
      companyNames,
      suppliers,
      portsOfLoading,
      portsOfDestination,
      containerTypes,
      incoterms,
    ] = await Promise.all([
      fetchSimple("dbo.Master_ItemDescriptions"),
      fetchCompanyNamesDistinct(),
      fetchSimple("dbo.Master_Suppliers"),
      fetchSimple(
        "dbo.Master_PortsOfLoading",
        "CAST(country AS NVARCHAR(100)) AS country"
      ),
      fetchSimple("dbo.Master_PortsOfDestination"),
      fetchSimple("dbo.Master_ContainerTypes"),
      fetchSimple("dbo.Master_Incoterms"),
    ]);

    return res.json({
      itemDescriptions,
      companyNames,
      suppliers,
      portsOfLoading,
      portsOfDestination,
      containerTypes,
      incoterms,
    });
  } catch (err) {
    console.error("[API] GET /api/lookups failed:", err);
    return res.status(500).json({ error: "Failed to load lookups" });
  }
});

// List RFQs
app.get("/api/rfqs", authenticate, async (req, res) => {
  try {
    const pool = await getPool();
    const all = (await pool.request().query("SELECT * FROM dbo.RFQs"))
      .recordset;

    if (req.user.role === "vendor") {
      const filtered = all.filter((r) => {
        const vendors = safeJsonParse(r.vendors, []);
        return Array.isArray(vendors) && vendors.includes(req.user.company);
      });
      return res.json(filtered);
    }

    res.json(all);
  } catch (err) {
    console.error("[API] Fetch RFQs error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Single RFQ
app.get("/api/rfqs/:id", authenticate, async (req, res) => {
  try {
    const pool = await getPool();
    const rfq = (
      await pool
        .request()
        .input("id", sql.UniqueIdentifier, req.params.id)
        .query("SELECT * FROM dbo.RFQs WHERE id = @id")
    ).recordset[0];

    if (!rfq) return res.sendStatus(404);
    res.json(rfq);
  } catch (err) {
    console.error("[API] Fetch RFQ error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Create RFQ (logistics and admin)
app.post("/api/rfqs", authenticate, async (req, res) => {
  if (req.user.role !== "logistics" && req.user.role !== "admin") {
    return res.sendStatus(403);
  }

  const {
    itemDescription,
    companyName,
    materialPONumber,
    supplierName,
    portOfLoading,
    portOfDestination,
    containerType,
    incoterms,
    numberOfContainers,
    cargoWeight,
    cargoReadinessDate, // legacy
    cargoReadinessFrom,
    cargoReadinessTo,

    description,
    vendors,
    attachments,
  } = req.body || {};

  // Cargo readiness range (backward compatible)
  const legacyRaw = cargoReadinessDate;

  let fromRaw = cargoReadinessFrom;
  let toRaw = cargoReadinessTo;

  // ✅ accept legacy "from|to" string from older frontend
  if (
    (!fromRaw || !toRaw) &&
    typeof legacyRaw === "string" &&
    legacyRaw.includes("|")
  ) {
    const [a, b] = legacyRaw.split("|").map((s) => String(s || "").trim());
    if (!fromRaw) fromRaw = a;
    if (!toRaw) toRaw = b;
  }

  const incotermsSafe = String(incoterms || "").trim() || null;

  const crFromRaw = fromRaw || legacyRaw;
  const crToRaw = toRaw || fromRaw || legacyRaw;

  // ✅ parse to JS Date objects (avoid ISO string -> SQL conversion issues)
  const crFrom = parseDateInput(crFromRaw);
  const crTo = parseDateInput(crToRaw);

  // ✅ always define here (was scoped wrong before)
  const safeAttachments = Array.isArray(attachments) ? attachments : [];

  // Normalize vendors (accept ["VENDORA"] OR [{company:"VENDORA"}] etc.)
  // Normalize vendors (accept ["VENDORA"] OR [{company:"VENDORA"}] OR "VENDORA,VENDORB")
  const vendorsArr = (() => {
    if (Array.isArray(vendors)) {
      return vendors
        .map((v) => {
          if (typeof v === "string") return v.trim();
          if (v && typeof v === "object") {
            return String(v.company || v.value || v.vendorCode || "").trim();
          }
          return "";
        })
        .filter(Boolean);
    }

    if (typeof vendors === "string") {
      return vendors
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    return [];
  })();

  const numContainers = Number(numberOfContainers);
  const weight = Number(cargoWeight);

  const missing = [];
  if (!itemDescription) missing.push("itemDescription");
  if (!companyName) missing.push("companyName");
  if (!materialPONumber) missing.push("materialPONumber");
  if (!supplierName) missing.push("supplierName");
  if (!portOfLoading) missing.push("portOfLoading");
  if (!portOfDestination) missing.push("portOfDestination");
  if (!containerType) missing.push("containerType");

  if (!Number.isFinite(numContainers) || numContainers <= 0)
    missing.push("numberOfContainers");
  if (!Number.isFinite(weight) || weight <= 0) missing.push("cargoWeight");

  if (!vendorsArr.length) missing.push("vendors");

  // Cargo readiness range (backward compatible)

  if (!crFrom) missing.push("cargoReadinessFrom|cargoReadinessDate");
  if (!crTo)
    missing.push("cargoReadinessTo|cargoReadinessFrom|cargoReadinessDate");

  if (missing.length) {
    console.log("[RFQ] Invalid payload (missing/invalid):", {
      missing,
      received: req.body,
    });

    return res.status(400).json({
      message: "Missing/invalid required fields",
      missing,
      received: {
        numberOfContainers,
        cargoWeight,
        cargoReadinessFrom,
        cargoReadinessTo,
        cargoReadinessDate,
        vendorsType: Array.isArray(vendors) ? "array" : typeof vendors,
        vendorsExample: Array.isArray(vendors) ? vendors[0] : vendors,
      },
    });
  }

  if (crTo.getTime() < crFrom.getTime()) {
    return res
      .status(400)
      .json({ message: "Cargo Readiness To cannot be before From" });
  }

  try {
    const pool = await getPool();

    // keep masters in sync (insert-only) so RFQ creation never breaks
    await ensureMasterValue(pool, "itemDescriptions", itemDescription);
    await ensureMasterValue(pool, "companyNames", companyName);
    await ensureMasterValue(pool, "suppliers", supplierName);
    await ensureMasterValue(pool, "portsOfLoading", portOfLoading);
    await ensureMasterValue(pool, "portsOfDestination", portOfDestination);
    await ensureMasterValue(pool, "containerTypes", containerType);
    if (incotermsSafe)
      await ensureMasterValue(pool, "incoterms", incotermsSafe);

    // next RFQ number
    const maxRes = await pool
      .request()
      .query("SELECT MAX(rfqNumber) AS maxNum FROM dbo.RFQs");
    const nextNum = (maxRes.recordset[0]?.maxNum || 1000) + 1;

    await pool
      .request()
      .input("rfqNumber", sql.Int, nextNum)
      .input("itemDescription", sql.NVarChar(500), itemDescription)
      .input("companyName", sql.NVarChar(sql.MAX), companyName)

      .input("materialPONumber", sql.NVarChar(150), materialPONumber)
      .input("supplierName", sql.NVarChar(255), supplierName)
      .input("portOfLoading", sql.NVarChar(100), portOfLoading)

      .input("portOfDestination", sql.NVarChar(100), portOfDestination)

      .input("containerType", sql.NVarChar(50), containerType)
      .input("incoterms", sql.NVarChar(50), incotermsSafe)

      .input("numberOfContainers", sql.Int, Number(numberOfContainers))
      .input("cargoWeight", sql.Float, Number(cargoWeight))
      // ✅ send JS Date objects to mssql driver
      .input("cargoReadinessDate", sql.DateTime2, crFrom) // legacy = FROM
      .input("cargoReadinessFrom", sql.DateTime2, crFrom)
      .input("cargoReadinessTo", sql.DateTime2, crTo)

      .input(
        "attachments",
        sql.NVarChar(sql.MAX),
        safeAttachments.length ? JSON.stringify(safeAttachments) : null
      )

      .input("description", sql.NVarChar(1000), description || null)
      .input("vendors", sql.NVarChar(sql.MAX), JSON.stringify(vendorsArr))

      .input("status", sql.NVarChar, "initial")
      .input("createdBy", sql.NVarChar(100), req.user.username).query(`
INSERT INTO dbo.RFQs
  (rfqNumber, itemDescription, companyName, materialPONumber,
   supplierName, portOfLoading, portOfDestination, containerType, incoterms,
   numberOfContainers, cargoWeight, cargoReadinessDate, cargoReadinessFrom, cargoReadinessTo, description, attachments, vendors,
   status, createdBy, createdAt)
VALUES
  (@rfqNumber, @itemDescription, @companyName, @materialPONumber,
   @supplierName, @portOfLoading, @portOfDestination, @containerType, @incoterms,
   @numberOfContainers, @cargoWeight, @cargoReadinessDate, @cargoReadinessFrom, @cargoReadinessTo, @description, @attachments, @vendors,
   @status, @createdBy, SYSUTCDATETIME())

      `);

    // fetch vendor emails
    // fetch vendor emails (prefer Master_Transporters.vendorEmail)
    const codesCte = vendorsArr
      .map((_, i) => `SELECT @c${i} AS code`)
      .join(" UNION ALL ");
    let req2 = pool.request();
    vendorsArr.forEach((c, i) => req2.input(`c${i}`, sql.NVarChar, c));

    const emRes = await req2.query(`
      ;WITH V AS (${codesCte})
      SELECT
        V.code AS vendorCode,
        NULLIF(LTRIM(RTRIM(t.vendorEmail)), '') AS vendorEmail,
        NULLIF(CAST(t.vendorEmails AS NVARCHAR(MAX)), '') AS vendorEmails,
        CASE WHEN u.username LIKE '%@%' THEN u.username ELSE NULL END AS userEmail
      FROM V
      LEFT JOIN dbo.Master_Transporters t
        ON t.vendorCode = V.code AND ISNULL(t.isActive, 1) = 1
      LEFT JOIN dbo.Users u
        ON u.company = V.code AND u.role = 'vendor'
    `);

    const emails = (() => {
      const all = [];
      for (const r of emRes.recordset || []) {
        const list = parseEmailList(
          [r.vendorEmail, r.vendorEmails, r.userEmail]
            .filter(Boolean)
            .join("\n")
        );
        all.push(...list);
      }
      return parseEmailList(all); // dedupe + normalize
    })();

    // notify vendors (best-effort) — NEVER fail RFQ creation if email fails
    if (emails.length) {
      const html = rfqCreationEmailTemplate({
        rfqNumber: nextNum,
        itemDescription,
        companyName,
        materialPONumber,
        supplierName,
        portOfLoading,
        portOfDestination,
        containerType,
        incoterms: incotermsSafe,
        numberOfContainers,
        cargoWeight,
        cargoReadinessDate,
        cargoReadinessFrom: crFrom.toISOString(),
        cargoReadinessTo: crTo.toISOString(),

        description,
        attachmentsCount: safeAttachments.length,
        createdBy: req.user.username,
      });

      try {
        await Promise.all(
          emails.map((email) =>
            graphClient.api(`/users/${SENDER_EMAIL}/sendMail`).post({
              message: {
                subject: `RFQ ${nextNum} | ${itemDescription} | ${materialPONumber}`,

                body: {
                  contentType: "HTML",
                  content: html,
                },
                toRecipients: [{ emailAddress: { address: email } }],
              },
              saveToSentItems: true,
            })
          )
        );
      } catch (e) {
        console.error(
          "[GRAPH] RFQ creation email failed (ignored):",
          e?.message || e
        );
      }
    }

    res.json({ message: "RFQ created", rfqNumber: nextNum });
  } catch (err) {
    console.error("[API] Create RFQ error:", err);
    res.status(500).json({
      message: "Server error",
      error: err?.message || String(err),
      code: err?.code,
      number: err?.number,
    });
  }
});

app.delete(
  "/api/rfqs/:id",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const { id } = req.params;
    const reason = String(req.body?.reason || "").trim();

    if (!reason) {
      return res.status(400).json({ message: "Deletion reason is required" });
    }

    try {
      const pool = await getPool();
      const tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

      let rolledBack = false;
      let rfq = null;
      let quotes = [];
      let uniqueVendors = [];
      let deletedAtIso = new Date().toISOString();

      try {
        const rfqRes = await tx
          .request()
          .input("id", sql.UniqueIdentifier, id)
          .query("SELECT TOP 1 * FROM dbo.RFQs WHERE id = @id");

        rfq = rfqRes.recordset[0] || null;
        if (!rfq) {
          await tx.rollback();
          rolledBack = true;
          return res.status(404).json({ message: "RFQ not found" });
        }

        if (rfq.status === "closed") {
          await tx.rollback();
          rolledBack = true;
          return res.status(409).json({
            message: "Finalized RFQs cannot be deleted",
          });
        }

        const quoteRes = await tx
          .request()
          .input("rfqId", sql.UniqueIdentifier, id)
          .query(
            "SELECT * FROM dbo.Quotes WHERE rfqId = @rfqId ORDER BY createdAt DESC"
          );
        quotes = quoteRes.recordset || [];
        uniqueVendors = [
          ...new Set(
            quotes.map((q) => String(q.vendorName || "").trim()).filter(Boolean)
          ),
        ];

        await tx
          .request()
          .input("rfqId", sql.UniqueIdentifier, id)
          .query("DELETE FROM dbo.Allocations WHERE rfqId = @rfqId");

        await tx
          .request()
          .input("rfqId", sql.UniqueIdentifier, id)
          .query("DELETE FROM dbo.Quotes WHERE rfqId = @rfqId");

        await tx
          .request()
          .input("id", sql.UniqueIdentifier, id)
          .query("DELETE FROM dbo.RFQs WHERE id = @id");

        deletedAtIso = new Date().toISOString();
        await tx.commit();
      } catch (innerErr) {
        if (!rolledBack) {
          await tx.rollback().catch(() => undefined);
        }
        throw innerErr;
      }

      const deletedBy = [req.user?.name, req.user?.username]
        .filter(Boolean)
        .join(" • ");

      try {
        const internalHtml = rfqDeletionInternalEmailTemplate({
          rfq,
          quotes,
          deletedBy: deletedBy || req.user?.username || "Unknown user",
          deletedAt: deletedAtIso,
          reason,
        });

        await graphClient.api(`/users/${SENDER_EMAIL}/sendMail`).post({
          message: {
            subject: `RFQ Deleted | RFQ ${rfq?.rfqNumber || "—"} | ${
              rfq?.materialPONumber || "—"
            }`,
            body: {
              contentType: "HTML",
              content: internalHtml,
            },
            toRecipients: graphRecipientsFromEmails([
              "vishnu.hazari@premierenergies.com",
              "ramanjulu@premierenergies.com",
              "aarnav.singh@premierenergies.com",
            ]),
          },
          saveToSentItems: true,
        });
      } catch (e) {
        console.error(
          "[GRAPH] RFQ deletion internal email failed (ignored):",
          e?.message || e
        );
      }

      if (uniqueVendors.length) {
        const codesCte = uniqueVendors
          .map((_, i) => `SELECT @c${i} AS code`)
          .join(" UNION ALL ");

        let req2 = pool.request();
        uniqueVendors.forEach((code, i) =>
          req2.input(`c${i}`, sql.NVarChar(150), code)
        );

        try {
          const vendorEmailRes = await req2.query(`
          ;WITH V AS (${codesCte})
          SELECT
            V.code AS vendorCode,
            NULLIF(LTRIM(RTRIM(t.vendorEmail)), '') AS vendorEmail,
            NULLIF(CAST(t.vendorEmails AS NVARCHAR(MAX)), '') AS vendorEmails,
            CASE WHEN u.username LIKE '%@%' THEN u.username ELSE NULL END AS userEmail
          FROM V
          LEFT JOIN dbo.Master_Transporters t
            ON t.vendorCode = V.code AND ISNULL(t.isActive, 1) = 1
          LEFT JOIN dbo.Users u
            ON u.company = V.code AND u.role = 'vendor'
        `);

          for (const row of vendorEmailRes.recordset || []) {
            const vendorEmailList = parseEmailList(
              [row.vendorEmail, row.vendorEmails, row.userEmail]
                .filter(Boolean)
                .join("\n")
            );
            if (!vendorEmailList.length) continue;

            const vendorHtml = rfqDeletionVendorEmailTemplate({
              rfq,
              vendorName: row.vendorCode,
            });

            await graphClient.api(`/users/${SENDER_EMAIL}/sendMail`).post({
              message: {
                subject: `RFQ Deleted | RFQ ${rfq?.rfqNumber || "—"}`,
                body: {
                  contentType: "HTML",
                  content: vendorHtml,
                },
                toRecipients: graphRecipientsFromEmails(vendorEmailList),
              },
              saveToSentItems: true,
            });
          }
        } catch (e) {
          console.error(
            "[GRAPH] RFQ deletion vendor email failed (ignored):",
            e?.message || e
          );
        }
      }

      return res.json({ message: "RFQ deleted successfully" });
    } catch (err) {
      console.error("[API] Delete RFQ error:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// List quotes for RFQ
app.get("/api/quotes/:rfqId", authenticate, async (req, res) => {
  try {
    const pool = await getPool();
    const quotes = (
      await pool
        .request()
        .input("rfqId", sql.UniqueIdentifier, req.params.rfqId).query(`
          SELECT
            q.*,
            COALESCE(NULLIF(LTRIM(RTRIM(t.shortName)), ''), q.vendorName) AS vendorDisplayName
          FROM dbo.Quotes q
          LEFT JOIN dbo.Master_Transporters t
            ON t.vendorCode = q.vendorName
          WHERE q.rfqId = @rfqId
        `)
    ).recordset;

    res.json(quotes);
  } catch (err) {
    console.error("[API] Fetch quotes error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get latest quote for THIS vendor for an RFQ (vendor only)
// CMD+F: app.get("/api/quotes/:rfqId", authenticate
app.get("/api/quotes/:rfqId/my-latest", authenticate, async (req, res) => {
  try {
    if (req.user.role !== "vendor") return res.sendStatus(403);

    const pool = await getPool();
    const quote = (
      await pool
        .request()
        .input("rfqId", sql.UniqueIdentifier, req.params.rfqId)
        .input("vendorName", sql.NVarChar, req.user.company).query(`
          SELECT TOP 1
            q.*,
            COALESCE(NULLIF(LTRIM(RTRIM(t.shortName)), ''), q.vendorName) AS vendorDisplayName
          FROM dbo.Quotes q
          LEFT JOIN dbo.Master_Transporters t
            ON t.vendorCode = q.vendorName
          WHERE q.rfqId = @rfqId AND q.vendorName = @vendorName
          ORDER BY q.createdAt DESC
        `)
    ).recordset[0];

    if (!quote) return res.status(404).json({ message: "No quote found" });
    return res.json(quote);
  } catch (err) {
    console.error("[API] Fetch my-latest quote error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Submit quote (vendor only)
app.post("/api/quotes", authenticate, async (req, res) => {
  if (req.user.role !== "vendor") return res.sendStatus(403);

  const d = req.body || {};
  if (!d.rfqId) return res.status(400).json({ message: "rfqId required" });

  try {
    const pool = await getPool();

    const { rate: USD_TO_INR } = await getUsdToInrRate();

    const seaInINR = Number(d.seaFreightPerContainer || 0) * USD_TO_INR;
    const homeTotal =
      seaInINR +
      Number(d.houseDeliveryOrderPerBOL || 0) +
      Number(d.cfsPerContainer || 0) +
      Number(d.transportationPerContainer || 0) +
      Number(d.ediChargesPerBOE || 0) +
      Number(d.chaChargesHome || 0);

    const mooWRTotal =
      homeTotal +
      Number(d.mooWRReeWarehousingCharges || 0) +
      Number(d.chaChargesMOOWR || 0);
    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    let action = "created";
    let rfq;
    let rolledBack = false;

    try {
      const rfqRes = await tx
        .request()
        .input("id", sql.UniqueIdentifier, d.rfqId).query(`
          SELECT id, status, rfqNumber, itemDescription, companyName, materialPONumber,
                 supplierName, portOfLoading, portOfDestination, containerType, incoterms,
                 numberOfContainers, cargoWeight, cargoReadinessDate, cargoReadinessFrom, cargoReadinessTo,
                 description
          FROM dbo.RFQs
          WHERE id = @id
        `);

      rfq = rfqRes.recordset[0];
      if (!rfq) {
        await tx.rollback();
        rolledBack = true;
        return res.status(404).json({ message: "RFQ not found" });
      }

      if (rfq.status === "closed") {
        await tx.rollback();
        rolledBack = true;
        return res.status(409).json({
          message:
            "This RFQ has already been finalized. Quotes can no longer be updated.",
        });
      }

      const request = tx
        .request()
        .input("rfqId", sql.UniqueIdentifier, d.rfqId)
        .input("vendorName", sql.NVarChar, req.user.company)
        .input("numberOfContainers", sql.Int, Number(d.numberOfContainers || 0))
        .input("shippingLineName", sql.NVarChar, d.shippingLineName || "")
        .input("containerType", sql.NVarChar, d.containerType || "")
        .input("vesselName", sql.NVarChar, d.vesselName || "")
        .input("vesselETD", sql.DateTime2, d.vesselETD)
        .input("vesselETA", sql.DateTime2, d.vesselETA)
        .input(
          "seaFreightPerContainer",
          sql.Float,
          Number(d.seaFreightPerContainer || 0)
        )
        .input(
          "houseDeliveryOrderPerBOL",
          sql.Float,
          Number(d.houseDeliveryOrderPerBOL || 0)
        )
        .input("cfsPerContainer", sql.Float, Number(d.cfsPerContainer || 0))
        .input(
          "transportationPerContainer",
          sql.Float,
          Number(d.transportationPerContainer || 0)
        )
        .input("chaChargesHome", sql.Float, Number(d.chaChargesHome || 0))
        .input("chaChargesMOOWR", sql.Float, Number(d.chaChargesMOOWR || 0))
        .input("ediChargesPerBOE", sql.Float, Number(d.ediChargesPerBOE || 0))
        .input(
          "mooWRReeWarehousingCharges",
          sql.Float,
          Number(d.mooWRReeWarehousingCharges || 0)
        )
        .input("transshipOrDirect", sql.NVarChar, d.transshipOrDirect || "")
        .input("quoteValidityDate", sql.DateTime2, d.quoteValidityDate)
        .input("message", sql.NVarChar, d.message || null)
        .input("homeTotal", sql.Float, homeTotal)
        .input("mooWRTotal", sql.Float, mooWRTotal)
        .input("appliedUsdInrRate", sql.Float, USD_TO_INR);

      const existingQuote = (
        await tx
          .request()
          .input("rfqId", sql.UniqueIdentifier, d.rfqId)
          .input("vendorName", sql.NVarChar, req.user.company).query(`
            SELECT TOP 1 id
            FROM dbo.Quotes WITH (UPDLOCK, HOLDLOCK)
            WHERE rfqId = @rfqId AND vendorName = @vendorName
            ORDER BY createdAt DESC
          `)
      ).recordset[0];

      if (existingQuote?.id) {
        action = "updated";
        await request.input("quoteId", sql.UniqueIdentifier, existingQuote.id)
          .query(`
            UPDATE dbo.Quotes
            SET numberOfContainers = @numberOfContainers,
                shippingLineName = @shippingLineName,
                containerType = @containerType,
                vesselName = @vesselName,
                vesselETD = @vesselETD,
                vesselETA = @vesselETA,
                seaFreightPerContainer = @seaFreightPerContainer,
                houseDeliveryOrderPerBOL = @houseDeliveryOrderPerBOL,
                cfsPerContainer = @cfsPerContainer,
                transportationPerContainer = @transportationPerContainer,
                chaChargesHome = @chaChargesHome,
                chaChargesMOOWR = @chaChargesMOOWR,
                ediChargesPerBOE = @ediChargesPerBOE,
                mooWRReeWarehousingCharges = @mooWRReeWarehousingCharges,
                transshipOrDirect = @transshipOrDirect,
                quoteValidityDate = @quoteValidityDate,
                message = @message,
                createdAt = SYSUTCDATETIME(),
                homeTotal = @homeTotal,
                mooWRTotal = @mooWRTotal,
                appliedUsdInrRate = @appliedUsdInrRate
            WHERE id = @quoteId
          `);
      } else {
        await request.query(`
          INSERT INTO dbo.Quotes
            (rfqId, vendorName, numberOfContainers, shippingLineName, containerType,
             vesselName, vesselETD, vesselETA, seaFreightPerContainer,
             houseDeliveryOrderPerBOL, cfsPerContainer, transportationPerContainer,
             chaChargesHome, chaChargesMOOWR, ediChargesPerBOE,
             mooWRReeWarehousingCharges, transshipOrDirect, quoteValidityDate,
             message, createdAt, homeTotal, mooWRTotal, appliedUsdInrRate)
          VALUES
            (@rfqId, @vendorName, @numberOfContainers, @shippingLineName, @containerType,
             @vesselName, @vesselETD, @vesselETA, @seaFreightPerContainer,
             @houseDeliveryOrderPerBOL, @cfsPerContainer, @transportationPerContainer,
             @chaChargesHome, @chaChargesMOOWR, @ediChargesPerBOE,
             @mooWRReeWarehousingCharges, @transshipOrDirect, @quoteValidityDate,
             @message, SYSUTCDATETIME(), @homeTotal, @mooWRTotal, @appliedUsdInrRate)
        `);
      }

      await tx.request().input("rfqId", sql.UniqueIdentifier, d.rfqId).query(`
          UPDATE dbo.RFQs
          SET status = 'evaluation'
          WHERE id = @rfqId AND status = 'initial'
        `);

      await tx.commit();
    } catch (innerErr) {
      if (!rolledBack) {
        await tx.rollback().catch(() => undefined);
      }
      throw innerErr;
    }

    if (rfq) {
      const rfqRows = [
        ["RFQ Number", rfq.rfqNumber],
        ["Item Description", rfq.itemDescription],
        ["Company Name", rfq.companyName],
        ["Material PO Number", rfq.materialPONumber],
        ["Supplier Name", rfq.supplierName],
        ["Port of Loading", rfq.portOfLoading],
        ["Port of Destination", rfq.portOfDestination],
        ["Container Type", rfq.containerType],
        ["Incoterms", rfq.incoterms || ""],
        ["Number of Containers", rfq.numberOfContainers],
        ["Cargo Weight", rfq.cargoWeight],
        [
          "Cargo Readiness Date",
          new Date(rfq.cargoReadinessDate).toLocaleString(),
        ],

        ["Description", rfq.description || ""],
      ];

      const quoteRows = [
        ["Vendor", req.user.company],
        ["Containers", d.numberOfContainers],
        ["Shipping Line", d.shippingLineName],
        ["Container Type", d.containerType],
        ["Vessel Name", d.vesselName],
        ["ETD", new Date(d.vesselETD).toLocaleString()],
        ["ETA", new Date(d.vesselETA).toLocaleString()],
        ["Sea Freight/Container", d.seaFreightPerContainer],
        ["HDO per BOL", d.houseDeliveryOrderPerBOL],
        ["CFS per Container", d.cfsPerContainer],
        ["Transportation/Container", d.transportationPerContainer],
        ["CHA Home", d.chaChargesHome],
        ["CHA MOOWR", d.chaChargesMOOWR],
        ["EDI per BOE", d.ediChargesPerBOE],
        ["Warehousing Charges", d.mooWRReeWarehousingCharges],
        ["Transship/Direct", d.transshipOrDirect],
        ["Quote Validity", new Date(d.quoteValidityDate).toLocaleString()],
        ["Message", d.message || ""],
        ["Home Total (INR)", homeTotal],
        ["MOOWR Total (INR)", mooWRTotal],
      ];

      const makeTable = (rows) => `
        <table border="1" cellpadding="5" cellspacing="0">
          <tr><th align="left">Field</th><th align="left">Value</th></tr>
          ${rows
            .map(([f, v]) => `<tr><td>${f}</td><td>${v}</td></tr>`)
            .join("")}
        </table>
      `;

      const html = quoteSubmissionEmailTemplate({
        rfq,
        vendorName: req.user.company,
        quoteInput: {
          numberOfContainers: d.numberOfContainers,
          shippingLineName: d.shippingLineName,
          containerType: d.containerType,
          vesselName: d.vesselName,
          vesselETD: d.vesselETD,
          vesselETA: d.vesselETA,
          seaFreightPerContainer: d.seaFreightPerContainer,
          houseDeliveryOrderPerBOL: d.houseDeliveryOrderPerBOL,
          cfsPerContainer: d.cfsPerContainer,
          transportationPerContainer: d.transportationPerContainer,
          chaChargesHome: d.chaChargesHome,
          chaChargesMOOWR: d.chaChargesMOOWR,
          ediChargesPerBOE: d.ediChargesPerBOE,
          mooWRReeWarehousingCharges: d.mooWRReeWarehousingCharges,
          transshipOrDirect: d.transshipOrDirect,
          quoteValidityDate: d.quoteValidityDate,
          message: d.message,
        },
        computed: {
          usdToInr: USD_TO_INR,
          seaFreightPerContainerInINR: seaInINR,
          homeTotal,
          mooWRTotal,
        },
      });

      await graphClient.api(`/users/${SENDER_EMAIL}/sendMail`).post({
        message: {
          subject: `Quote Submitted | RFQ ${rfq.rfqNumber} | ${req.user.company}`,
          body: {
            contentType: "HTML",
            content: html,
          },
          toRecipients: [{ emailAddress: { address: SENDER_EMAIL } }],

          // Optional: match your allocation mail style (if you want CC here too)
          // ccRecipients: [
          //   { emailAddress: { address: "ramanjulu@premierenergies.com" } },
          // ],
        },
        saveToSentItems: true,
      });
    }

    res.json({
      action,
      message:
        action === "updated"
          ? "Quote updated successfully"
          : "Quote submitted successfully",
    });
  } catch (err) {
    console.error("[API] Submit quote error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put(
  "/api/quotes/:quoteId/logistics-pricing",
  authenticate,
  async (req, res) => {
    if (req.user.role !== "logistics" && req.user.role !== "admin") {
      return res.sendStatus(403);
    }

    const { quoteId } = req.params;
    const body = req.body || {};

    try {
      const pool = await getPool();

      const existingQuoteRes = await pool
        .request()
        .input("quoteId", sql.UniqueIdentifier, quoteId)
        .query("SELECT TOP 1 * FROM dbo.Quotes WHERE id = @quoteId");

      const existingQuote = existingQuoteRes.recordset[0];
      if (!existingQuote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      const rfqRes = await pool
        .request()
        .input("rfqId", sql.UniqueIdentifier, existingQuote.rfqId)
        .query("SELECT TOP 1 status FROM dbo.RFQs WHERE id = @rfqId");

      const rfq = rfqRes.recordset[0];
      if (!rfq) {
        return res.status(404).json({ message: "RFQ not found" });
      }

      if (rfq.status === "closed") {
        return res.status(409).json({
          message:
            "This RFQ has already been finalized. Logistics pricing can no longer be edited.",
        });
      }

      let usdToInr = Number(body.usdToInr);
      if (!Number.isFinite(usdToInr) || usdToInr <= 0) {
        const fx = await getUsdToInrRate();
        usdToInr = fx.rate;
      }

      const num = (incoming, fallback) => {
        const parsed = Number(incoming);
        return Number.isFinite(parsed) ? parsed : Number(fallback || 0);
      };

      const seaFreightPerContainer = num(
        body.seaFreightPerContainer,
        existingQuote.seaFreightPerContainer
      );
      const houseDeliveryOrderPerBOL = num(
        body.houseDeliveryOrderPerBOL,
        existingQuote.houseDeliveryOrderPerBOL
      );
      const cfsPerContainer = num(
        body.cfsPerContainer,
        existingQuote.cfsPerContainer
      );
      const transportationPerContainer = num(
        body.transportationPerContainer,
        existingQuote.transportationPerContainer
      );
      const ediChargesPerBOE = num(
        body.ediChargesPerBOE,
        existingQuote.ediChargesPerBOE
      );
      const chaChargesHome = num(
        body.chaChargesHome,
        existingQuote.chaChargesHome
      );
      const chaChargesMOOWR = num(
        body.chaChargesMOOWR,
        existingQuote.chaChargesMOOWR
      );
      const mooWRReeWarehousingCharges = num(
        body.mooWRReeWarehousingCharges,
        existingQuote.mooWRReeWarehousingCharges
      );

      const seaInINR = seaFreightPerContainer * usdToInr;
      const homeTotal =
        seaInINR +
        houseDeliveryOrderPerBOL +
        cfsPerContainer +
        transportationPerContainer +
        ediChargesPerBOE +
        chaChargesHome;
      const mooWRTotal =
        seaInINR +
        houseDeliveryOrderPerBOL +
        cfsPerContainer +
        transportationPerContainer +
        ediChargesPerBOE +
        chaChargesMOOWR +
        mooWRReeWarehousingCharges;

      const updatedQuote = (
        await pool
          .request()
          .input("quoteId", sql.UniqueIdentifier, quoteId)
          .input("seaFreightPerContainer", sql.Float, seaFreightPerContainer)
          .input(
            "houseDeliveryOrderPerBOL",
            sql.Float,
            houseDeliveryOrderPerBOL
          )
          .input("cfsPerContainer", sql.Float, cfsPerContainer)
          .input(
            "transportationPerContainer",
            sql.Float,
            transportationPerContainer
          )
          .input("ediChargesPerBOE", sql.Float, ediChargesPerBOE)
          .input("chaChargesHome", sql.Float, chaChargesHome)
          .input("chaChargesMOOWR", sql.Float, chaChargesMOOWR)
          .input(
            "mooWRReeWarehousingCharges",
            sql.Float,
            mooWRReeWarehousingCharges
          )
          .input("homeTotal", sql.Float, homeTotal)
          .input("mooWRTotal", sql.Float, mooWRTotal)
          .input("appliedUsdInrRate", sql.Float, usdToInr).query(`
          UPDATE dbo.Quotes
          SET seaFreightPerContainer = @seaFreightPerContainer,
              houseDeliveryOrderPerBOL = @houseDeliveryOrderPerBOL,
              cfsPerContainer = @cfsPerContainer,
              transportationPerContainer = @transportationPerContainer,
              ediChargesPerBOE = @ediChargesPerBOE,
              chaChargesHome = @chaChargesHome,
              chaChargesMOOWR = @chaChargesMOOWR,
              mooWRReeWarehousingCharges = @mooWRReeWarehousingCharges,
              homeTotal = @homeTotal,
              mooWRTotal = @mooWRTotal,
              appliedUsdInrRate = @appliedUsdInrRate
          OUTPUT INSERTED.*
          WHERE id = @quoteId
        `)
      ).recordset[0];

      return res.json({
        message: "Logistics pricing saved",
        quote: updatedQuote,
      });
    } catch (err) {
      console.error("[API] Logistics quote pricing update error:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// Allocate containers (logistics and admin)
app.post("/api/allocations", authenticate, async (req, res) => {
  if (req.user.role !== "logistics" && req.user.role !== "admin") {
    return res.sendStatus(403);
  }

  const {
    rfqId,
    quoteId,
    vendorName,
    containersAllottedHome,
    containersAllottedMOOWR,
    reason,
  } = req.body || {};

  if (!rfqId || !quoteId || !vendorName) {
    return res
      .status(400)
      .json({ message: "rfqId, quoteId, vendorName required" });
  }

  try {
    const pool = await getPool();

    await pool
      .request()
      .input("rfqId", sql.UniqueIdentifier, rfqId)
      .input("quoteId", sql.UniqueIdentifier, quoteId)
      .input("vendorName", sql.NVarChar, vendorName)
      .input(
        "containersAllottedHome",
        sql.Int,
        Number(containersAllottedHome || 0)
      )
      .input(
        "containersAllottedMOOWR",
        sql.Int,
        Number(containersAllottedMOOWR || 0)
      )
      .input("reason", sql.NVarChar, reason || null).query(`
        INSERT INTO dbo.Allocations
          (rfqId, quoteId, vendorName, containersAllottedHome, containersAllottedMOOWR, reason, createdAt)
        VALUES
          (@rfqId, @quoteId, @vendorName, @containersAllottedHome, @containersAllottedMOOWR, @reason, SYSUTCDATETIME())
      `);

    const sumRes = await pool
      .request()
      .input("rfqId", sql.UniqueIdentifier, rfqId).query(`
        SELECT SUM(containersAllottedHome + containersAllottedMOOWR) AS total
        FROM dbo.Allocations
        WHERE rfqId = @rfqId
      `);
    const totalAllocated = Number(sumRes.recordset[0]?.total || 0);

    const rfqRes = await pool
      .request()
      .input("rfqId", sql.UniqueIdentifier, rfqId).query(`
        SELECT rfqNumber, itemDescription, companyName, materialPONumber,
               supplierName, portOfLoading, portOfDestination, containerType, incoterms,
               numberOfContainers, cargoWeight, cargoReadinessDate, cargoReadinessFrom, cargoReadinessTo,
               description
        FROM dbo.RFQs
        WHERE id = @rfqId
      `);
    const rfq = rfqRes.recordset[0];

    const quoteRes = await pool
      .request()
      .input("quoteId", sql.UniqueIdentifier, quoteId)
      .query(`SELECT TOP 1 * FROM dbo.Quotes WHERE id = @quoteId`);

    const quote = quoteRes.recordset[0];

    // ─────────────────────────────────────────────
    // LEAFI SYSTEM ALLOCATION (LOWEST PRICE BASELINE)
    // ─────────────────────────────────────────────
    const leafiQuoteRes = await pool
      .request()
      .input("rfqId", sql.UniqueIdentifier, rfqId)
      .input("vendorName", sql.NVarChar, vendorName).query(`
      SELECT TOP 1 *
      FROM dbo.Quotes
      WHERE rfqId = @rfqId AND vendorName = @vendorName
      ORDER BY createdAt DESC
    `);

    const leafiQuote = leafiQuoteRes.recordset[0];

    // Default LEAFI allocation = full RFQ qty on cheapest scheme
    let leafiHome = 0;
    let leafiMoowr = 0;

    if (leafiQuote && rfq) {
      const cheapestIsHome =
        leafiQuote.homeTotal != null &&
        (leafiQuote.mooWRTotal == null ||
          leafiQuote.homeTotal <= leafiQuote.mooWRTotal);

      if (cheapestIsHome) {
        leafiHome = Number(rfq.numberOfContainers || 0);
        leafiMoowr = 0;
      } else {
        leafiHome = 0;
        leafiMoowr = Number(rfq.numberOfContainers || 0);
      }
    }

    // Logistics (manual) allocation
    const logisticsHome = Number(containersAllottedHome || 0);
    const logisticsMoowr = Number(containersAllottedMOOWR || 0);

    // Deviation check
    const hasDeviation =
      logisticsHome !== leafiHome || logisticsMoowr !== leafiMoowr;

    console.log("[DEV] Deviation check", {
      rfqId,
      vendorName,
      hasDeviation,
      leafiHome,
      leafiMoowr,
      logisticsHome,
      logisticsMoowr,
    });

    const emailRes = await pool
      .request()
      .input("company", sql.NVarChar, vendorName).query(`
        SELECT TOP 1
          NULLIF(LTRIM(RTRIM(t.vendorEmail)), '') AS vendorEmail,
          NULLIF(CAST(t.vendorEmails AS NVARCHAR(MAX)), '') AS vendorEmails,
          CASE WHEN u.username LIKE '%@%' THEN u.username ELSE NULL END AS userEmail
        FROM dbo.Master_Transporters t
        FULL OUTER JOIN dbo.Users u
          ON u.company = t.vendorCode AND u.role = 'vendor'
        WHERE (t.vendorCode = @company OR u.company = @company)
      `);

    const vendorEmailList = parseEmailList(
      [
        emailRes.recordset?.[0]?.vendorEmail,
        emailRes.recordset?.[0]?.vendorEmails,
        emailRes.recordset?.[0]?.userEmail,
      ]
        .filter(Boolean)
        .join("\n")
    );

    // for template display, show the primary
    const vendorEmail = vendorEmailList[0] || "";

    if (rfq && totalAllocated >= Number(rfq.numberOfContainers || 0)) {
      await pool.request().input("rfqId", sql.UniqueIdentifier, rfqId).query(`
          UPDATE dbo.RFQs
          SET status = 'closed',
              finalizedAt = COALESCE(finalizedAt, SYSUTCDATETIME())
          WHERE id = @rfqId
        `);
    }

    if (rfq && quote) {
      const rfqRows = [
        ["RFQ Number", rfq.rfqNumber],
        ["Item Description", rfq.itemDescription],
        ["Company Name", rfq.companyName],
        ["Material PO Number", rfq.materialPONumber],
        ["Supplier Name", rfq.supplierName],
        ["Port of Loading", rfq.portOfLoading],
        ["Port of Destination", rfq.portOfDestination],
        ["Container Type", rfq.containerType],
        ["Req’d Containers", rfq.numberOfContainers],
        ["Cargo Weight", rfq.cargoWeight],
        [
          "Cargo Readiness Date",
          new Date(rfq.cargoReadinessDate).toLocaleString(),
        ],

        ["Description", rfq.description || ""],
      ];

      const quoteRows2 = [
        ["Vendor", vendorName],
        ["Quoted Containers", quote.numberOfContainers],
        ["Shipping Line", quote.shippingLineName],
        ["Container Type", quote.containerType],
        ["Vessel Name", quote.vesselName],
        ["ETD", new Date(quote.vesselETD).toLocaleString()],
        ["ETA", new Date(quote.vesselETA).toLocaleString()],
        ["Sea Freight/Container", quote.seaFreightPerContainer],
        ["HDO/BOL", quote.houseDeliveryOrderPerBOL],
        ["CFS/Container", quote.cfsPerContainer],
        ["Transport/Container", quote.transportationPerContainer],
        ["CHA Home", quote.chaChargesHome],
        ["CHA MOOWR", quote.chaChargesMOOWR],
        ["EDI/BOE", quote.ediChargesPerBOE],
        ["Warehousing", quote.mooWRReeWarehousingCharges],
        ["Transship/Direct", quote.transshipOrDirect],
        ["Quote Validity", new Date(quote.quoteValidityDate).toLocaleString()],
        ["Message", quote.message || ""],
        ["Home Total", quote.homeTotal],
        ["MOOWR Total", quote.mooWRTotal],
      ];

      const finalRows = [
        ["Allocated Home", containersAllottedHome],
        ["Allocated MOOWR", containersAllottedMOOWR],
        ["Reason", reason || ""],
      ];

      const makeTbl = (rows) => `
        <table border="1" cellpadding="5" cellspacing="0">
          <tr><th align="left">Field</th><th align="left">Value</th></tr>
          ${rows
            .map(([f, v]) => `<tr><td>${f}</td><td>${v}</td></tr>`)
            .join("")}
        </table>
      `;

      try {
        const allocatedHome = Number(containersAllottedHome || 0);
        const allocatedMoowr = Number(containersAllottedMOOWR || 0);

        // Build professional dynamic email (scheme-aware)
        const materialPONumberSafe = String(rfq?.materialPONumber || "").trim();

        const html = allocationEmailTemplate({
          rfq,
          quote,
          vendorName,
          vendorEmail,
          allocatedHome,
          allocatedMoowr,
          reason,
        });

        // Choose TO: vendorEmail (fallback to SENDER_EMAIL to avoid crashing if not found)
        const toList = vendorEmailList.length
          ? graphRecipientsFromEmails(vendorEmailList)
          : [{ emailAddress: { address: SENDER_EMAIL } }];

        await graphClient.api(`/users/${SENDER_EMAIL}/sendMail`).post({
          message: {
            subject: `Allocation | RFQ ${rfq.rfqNumber} | ${vendorName} | ${
              materialPONumberSafe || "—"
            }`,

            body: {
              contentType: "HTML",
              content: html,
            },
            toRecipients: toList,
            ccRecipients: graphRecipientsFromEmails([
              "ramanjulu@premierenergies.com",
              ...ALLOCATION_CC_ALWAYS,
              ...(String(reason || "").trim() ? ALLOCATION_CC_WITH_REASON : []),
            ]),
          },
          saveToSentItems: true,
        });
      } catch (e) {
        console.error(
          "[GRAPH] Finalization email failed (ignored):",
          e?.message || e
        );
      }
    }

    // ─────────────────────────────────────────────
    // INTERNAL deviation email (ONLY if deviation)
    // ─────────────────────────────────────────────
    if (hasDeviation) {
      // Always log deviation decisions (so you can prove the trigger)
      console.log("[DEV] Allocation deviation detected", {
        rfqId,
        vendorName,
        leafiHome,
        leafiMoowr,
        logisticsHome,
        logisticsMoowr,
      });

      try {
        const rfqNumberSafe = rfq?.rfqNumber ?? "(unknown)";
        const internalHtml = allocationDeviationInternalTemplate({
          rfq,
          quote,
          vendorName,
          leafiHome,
          leafiMoowr,
          logisticsHome,
          logisticsMoowr,
          reason,
        });

        await graphClient.api(`/users/${SENDER_EMAIL}/sendMail`).post({
          message: {
            subject: `⚠️ Allocation Deviation | RFQ ${rfqNumberSafe} | ${vendorName}`,
            body: { contentType: "HTML", content: internalHtml },
            toRecipients: [
              { emailAddress: { address: "aarnav.singh@premierenergies.com" } },
            ],
            ccRecipients: graphRecipientsFromEmails([
              "ramanjulu@premierenergies.com",
              ...ALLOCATION_CC_ALWAYS,
              ...(String(reason || "").trim() ? ALLOCATION_CC_WITH_REASON : []),
            ]),
          },
          saveToSentItems: true,
        });

        console.log("[GRAPH] Internal deviation email sent", {
          rfqNumber: rfqNumberSafe,
          vendorName,
        });
      } catch (e) {
        // Log the full object (Graph errors often hide useful info in nested fields)
        console.error("[GRAPH] Internal deviation email failed (ignored):", e);
      }
    }

    res.json({
      message: "Allocation recorded and notifications sent",
      totalAllocated,
    });
  } catch (err) {
    console.error("[API] Allocation error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ========================= Admin: master keys/meta =========================
// ========================= Admin: Users CRUD =========================
// ========================= Admin: Transporters CRUD =========================
app.get(
  "/api/admin/transporters",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    try {
      const pool = await getPool();
      const r = await pool.request().query(`
SELECT id, vendorCode, vendorName, shortName, vendorEmail, isActive, createdAt, updatedAt
FROM dbo.Master_Transporters
ORDER BY vendorName ASC

      `);
      res.json(r.recordset || []);
    } catch (err) {
      console.error("[API] GET /api/admin/transporters error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

app.post(
  "/api/admin/transporters",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const vendorCode = String(req.body?.vendorCode || "").trim();
    const vendorName = String(req.body?.vendorName || "").trim();
    const vendorEmailRaw = req.body?.vendorEmail;
    const vendorEmail =
      vendorEmailRaw == null
        ? null
        : String(vendorEmailRaw || "").trim() || null;
    const isActive =
      typeof req.body?.isActive === "boolean" ? req.body.isActive : true;
    const shortName =
      req.body?.shortName == null
        ? null
        : String(req.body.shortName || "").trim() || null;

    if (!vendorCode)
      return res.status(400).json({ message: "vendorCode required" });
    if (!vendorName)
      return res.status(400).json({ message: "vendorName required" });

    try {
      const pool = await getPool();

      const exists = await pool
        .request()
        .input("vendorCode", sql.NVarChar(150), vendorCode)
        .query(
          `SELECT TOP 1 1 AS ok FROM dbo.Master_Transporters WHERE vendorCode = @vendorCode`
        );

      if (exists.recordset?.length) {
        return res.status(409).json({ message: "vendorCode already exists" });
      }

      await pool
        .request()
        .input("vendorCode", sql.NVarChar(150), vendorCode)
        .input("vendorName", sql.NVarChar(255), vendorName)
        .input("vendorEmail", sql.NVarChar(255), vendorEmail)
        .input("isActive", sql.Bit, isActive)
        .input("shortName", sql.NVarChar(100), shortName).query(`
  INSERT INTO dbo.Master_Transporters (vendorCode, vendorName, shortName, vendorEmail, isActive, createdAt)
  VALUES (@vendorCode, @vendorName, @shortName, @vendorEmail, @isActive, SYSUTCDATETIME())
`);

      // ✅ Sync: Master_Transporters -> Users (vendor)
      if (isActive) {
        await ensureVendorUserFromTransporter(pool, {
          vendorCode,
          vendorName,
          vendorEmail: vendorEmailPrimary,
          isActive,
        });
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("[API] POST /api/admin/transporters error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

app.put(
  "/api/admin/transporters/:id",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const { id } = req.params;

    const hasVendorCode = typeof req.body?.vendorCode === "string";
    const hasVendorName = typeof req.body?.vendorName === "string";
    const hasVendorEmail = "vendorEmail" in (req.body || {});
    const hasShortName = "shortName" in (req.body || {});

    const hasIsActive = typeof req.body?.isActive === "boolean";

    if (
      !hasVendorCode &&
      !hasVendorName &&
      !hasVendorEmail &&
      !hasShortName &&
      !hasIsActive
    ) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    try {
      const pool = await getPool();

      const sets = [];
      const r = pool.request().input("id", sql.UniqueIdentifier, id);

      if (hasVendorCode) {
        const vendorCode = String(req.body.vendorCode || "").trim();
        if (!vendorCode)
          return res
            .status(400)
            .json({ message: "vendorCode cannot be empty" });
        r.input("vendorCode", sql.NVarChar(150), vendorCode);
        sets.push("vendorCode = @vendorCode");
      }

      if (hasVendorName) {
        const vendorName = String(req.body.vendorName || "").trim();
        if (!vendorName)
          return res
            .status(400)
            .json({ message: "vendorName cannot be empty" });
        r.input("vendorName", sql.NVarChar(255), vendorName);
        sets.push("vendorName = @vendorName");
      }

      if (hasVendorEmail) {
        const vendorEmailRaw = req.body.vendorEmail;
        const vendorEmail =
          vendorEmailRaw == null
            ? null
            : String(vendorEmailRaw || "").trim() || null;
        r.input("vendorEmail", sql.NVarChar(255), vendorEmail);
        sets.push("vendorEmail = @vendorEmail");
      }

      if (hasIsActive) {
        r.input("isActive", sql.Bit, req.body.isActive);
        sets.push("isActive = @isActive");
      }

      if (hasShortName) {
        const shortName =
          req.body.shortName == null
            ? null
            : String(req.body.shortName || "").trim() || null;
        r.input("shortName", sql.NVarChar(100), shortName);
        sets.push("shortName = @shortName");
      }

      sets.push("updatedAt = SYSUTCDATETIME()");

      await r.query(`
        UPDATE dbo.Master_Transporters
        SET ${sets.join(", ")}
        WHERE id = @id
      `);

      // ✅ Sync after update: if transporter is active, ensure vendor user exists
      const t = await pool.request().input("id", sql.UniqueIdentifier, id)
        .query(`
SELECT TOP 1 vendorCode, vendorName, shortName, vendorEmail, isActive
FROM dbo.Master_Transporters
WHERE id=@id

`);

      const tr = t.recordset?.[0];
      if (tr && tr.isActive !== false) {
        await ensureVendorUserFromTransporter(pool, tr);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("[API] PUT /api/admin/transporters/:id error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

app.delete(
  "/api/admin/transporters/:id",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const { id } = req.params;
    try {
      const pool = await getPool();
      await pool.request().input("id", sql.UniqueIdentifier, id).query(`
        UPDATE dbo.Master_Transporters
        SET isActive = 0, updatedAt = SYSUTCDATETIME()
        WHERE id = @id
      `);
      res.json({ ok: true });
    } catch (err) {
      console.error("[API] DELETE /api/admin/transporters/:id error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Admin-only users management

app.get("/api/admin/users", authenticate, requireAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        CAST(id AS NVARCHAR(36)) AS id,
        username,
        role,
        name,
        company
      FROM dbo.Users
      ORDER BY role ASC, username ASC
    `);
    return res.json(result.recordset || []);
  } catch (err) {
    console.error("[API] GET /api/admin/users error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/admin/users", authenticate, requireAdmin, async (req, res) => {
  const { username, password, role, name, company } = req.body || {};

  const u = String(username || "").trim();
  const p = String(password || "").trim();
  const r = String(role || "").trim();
  const n = String(name || "").trim();
  const c = company == null ? null : String(company || "").trim();

  if (!u) return res.status(400).json({ message: "username required" });
  if (!n) return res.status(400).json({ message: "name required" });
  if (!p) return res.status(400).json({ message: "password required" });
  if (!["admin", "logistics", "vendor"].includes(r)) {
    return res.status(400).json({ message: "invalid role" });
  }
  if (r === "vendor" && !c) {
    return res.status(400).json({ message: "company required for vendor" });
  }

  try {
    const pool = await getPool();

    // Unique username check
    const exists = await pool
      .request()
      .input("username", sql.NVarChar(50), u)
      .query(`SELECT TOP 1 1 AS ok FROM dbo.Users WHERE username = @username`);
    if (exists.recordset?.length) {
      return res.status(409).json({ message: "username already exists" });
    }

    await pool
      .request()
      .input("username", sql.NVarChar(50), u)
      .input("password", sql.NVarChar(255), p)
      .input("role", sql.NVarChar(20), r)
      .input("name", sql.NVarChar(100), n)
      .input("company", sql.NVarChar(150), c).query(`
        INSERT INTO dbo.Users (username, password, role, name, company)
        VALUES (@username, @password, @role, @name, @company)
      `);

    // ✅ Sync: Users (vendor) -> Master_Transporters
    await ensureTransporterFromVendorUser(pool, {
      username: u,
      role: r,
      name: n,
      company: c,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[API] POST /api/admin/users error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

app.put(
  "/api/admin/users/:id",
  authenticate,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { password, role, name, company } = req.body || {};

    const hasPassword = typeof password === "string" && String(password).trim();
    const hasRole = typeof role === "string" && String(role).trim();
    const hasName = typeof name === "string" && String(name).trim();
    const hasCompany = "company" in (req.body || {});

    if (!hasPassword && !hasRole && !hasName && !hasCompany) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    try {
      const pool = await getPool();

      // Ensure user exists
      const existing = await pool
        .request()
        .input("id", sql.UniqueIdentifier, id)
        .query(`SELECT TOP 1 username, role FROM dbo.Users WHERE id = @id`);
      if (!existing.recordset?.length) return res.sendStatus(404);

      const updates = [];
      const r = pool.request().input("id", sql.UniqueIdentifier, id);

      if (hasName) {
        r.input("name", sql.NVarChar(100), String(name).trim());
        updates.push("name = @name");
      }
      if (hasRole) {
        const rr = String(role).trim();
        if (!["admin", "logistics", "vendor"].includes(rr)) {
          return res.status(400).json({ message: "invalid role" });
        }
        r.input("role", sql.NVarChar(20), rr);
        updates.push("role = @role");
      }
      if (hasCompany) {
        const c = company == null ? null : String(company || "").trim() || null;
        r.input("company", sql.NVarChar(150), c);
        updates.push("company = @company");
      }
      if (hasPassword) {
        r.input("password", sql.NVarChar(255), String(password).trim());
        updates.push("password = @password");
      }

      // If role is vendor, company must be set (enforce after role change)
      // We'll validate by checking incoming role or existing role.
      const effectiveRole = hasRole
        ? String(role).trim()
        : String(existing.recordset[0].role || "").trim();

      if (effectiveRole === "vendor") {
        const effectiveCompany = hasCompany
          ? company == null
            ? ""
            : String(company || "").trim()
          : null;

        if (hasCompany && !effectiveCompany) {
          return res
            .status(400)
            .json({ message: "company required for vendor" });
        }
      }

      await r.query(`
      UPDATE dbo.Users
      SET ${updates.join(", ")}
      WHERE id = @id
    `);

      // ✅ Sync after update: if vendor, ensure transporter exists
      const updated = await pool
        .request()
        .input("id", sql.UniqueIdentifier, id)
        .query(
          `SELECT TOP 1 username, role, name, company FROM dbo.Users WHERE id=@id`
        );

      const row = updated.recordset?.[0];
      if (row) {
        await ensureTransporterFromVendorUser(pool, row);
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error("[API] PUT /api/admin/users/:id error:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

app.delete(
  "/api/admin/users/:id",
  authenticate,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;

    try {
      const pool = await getPool();

      // Prevent self-delete
      const meIdRes = await pool
        .request()
        .input("username", sql.NVarChar(50), req.user.username)
        .query(`SELECT TOP 1 id FROM dbo.Users WHERE username = @username`);
      const meId = meIdRes.recordset?.[0]?.id;
      if (meId && String(meId).toLowerCase() === String(id).toLowerCase()) {
        return res.status(400).json({ message: "Cannot delete your own user" });
      }

      const delRes = await pool
        .request()
        .input("id", sql.UniqueIdentifier, id)
        .query(`DELETE FROM dbo.Users WHERE id = @id`);

      // Note: mssql returns rowsAffected
      if (!delRes.rowsAffected?.[0]) return res.sendStatus(404);

      return res.json({ ok: true });
    } catch (err) {
      console.error("[API] DELETE /api/admin/users/:id error:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// CMD+F: // Admin CRUD for master dropdowns
app.get(
  "/api/admin/masters",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    // keep labels here so frontend can render sections without hardcoding
    return res.json([
      { key: "itemDescriptions", label: "Item Descriptions" },
      { key: "companyNames", label: "Company Names" },
      { key: "suppliers", label: "Suppliers" },
      { key: "portsOfLoading", label: "Ports of Loading" },
      { key: "portsOfDestination", label: "Ports of Destination" },
      { key: "containerTypes", label: "Container Types" },
      { key: "incoterms", label: "Incoterms" },
    ]);
  }
);

// Admin CRUD for master dropdowns
app.get(
  "/api/admin/masters/:key",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const key = String(req.params.key || "").trim();
    const def = getMasterDef(key);
    if (!def) return res.status(400).json({ message: "Invalid master key" });

    try {
      const pool = await getPool();

      const extraSelect = [];
      if (key === "companyNames") {
        extraSelect.push("CAST(shortName AS NVARCHAR(100)) AS shortName");
      }
      if (key === "portsOfLoading") {
        extraSelect.push("CAST(country AS NVARCHAR(100)) AS country");
      }

      const sqlText = `
        SELECT
          CAST(id AS NVARCHAR(50)) AS id,
          CAST([value] AS NVARCHAR(MAX)) AS [value],
          isActive,
          createdAt,
          updatedAt
          ${extraSelect.length ? ", " + extraSelect.join(", ") : ""}
        FROM ${def.table}
        ORDER BY CONVERT(NVARCHAR(4000), [value]) ASC
      `;

      const rows = (await pool.request().query(sqlText)).recordset || [];
      return res.json(rows);
    } catch (err) {
      console.error("[API] admin list master error:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

app.post(
  "/api/admin/masters/:key",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const key = String(req.params.key || "").trim();
    const def = getMasterDef(key);
    if (!def) return res.status(400).json({ message: "Invalid master key" });

    const valueRaw = req.body?.value;
    const value = normalizeMasterValue(key, valueRaw);
    if (!value) return res.status(400).json({ message: "value required" });

    const isActive =
      typeof req.body?.isActive === "boolean" ? req.body.isActive : true;

    const shortName =
      key === "companyNames"
        ? req.body?.shortName == null
          ? null
          : String(req.body.shortName || "").trim() || null
        : null;

    const country =
      key === "portsOfLoading"
        ? req.body?.country == null
          ? null
          : String(req.body.country || "").trim() || null
        : null;

    try {
      const pool = await getPool();

      const r = pool.request();

      // value param sizing
      if (def.max === sql.MAX) r.input("value", sql.NVarChar(sql.MAX), value);
      else r.input("value", sql.NVarChar(def.max), value);

      r.input("isActive", sql.Bit, isActive);

      const cols = ["value", "isActive", "createdAt"];
      const vals = ["@value", "@isActive", "SYSUTCDATETIME()"];

      if (key === "companyNames") {
        r.input("shortName", sql.NVarChar(100), shortName);
        cols.push("shortName");
        vals.push("@shortName");
      }

      if (key === "portsOfLoading") {
        r.input("country", sql.NVarChar(100), country);
        cols.push("country");
        vals.push("@country");
      }

      await r.query(`
        INSERT INTO ${def.table} (${cols.join(", ")})
        VALUES (${vals.join(", ")})
      `);

      return res.json({ ok: true });
    } catch (err) {
      // Unique-index masters (most tables except companyNames) may throw duplicate key
      if (err && (err.number === 2627 || err.number === 2601)) {
        return res.status(409).json({ message: "value already exists" });
      }
      console.error("[API] POST /api/admin/masters/:key error:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

app.put(
  "/api/admin/masters/:key/:id",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const key = String(req.params.key || "").trim();
    const { id } = req.params;

    const def = getMasterDef(key);
    if (!def) return res.status(400).json({ message: "Invalid master key" });

    const hasValue = "value" in (req.body || {});
    const hasIsActive = typeof req.body?.isActive === "boolean";
    const hasShortName =
      key === "companyNames" && "shortName" in (req.body || {});
    const hasCountry =
      key === "portsOfLoading" && "country" in (req.body || {});

    if (!hasValue && !hasIsActive && !hasShortName && !hasCountry) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    try {
      const pool = await getPool();
      const r = pool.request().input("id", sql.UniqueIdentifier, id);

      const sets = [];

      if (hasValue) {
        const value = normalizeMasterValue(key, req.body?.value);
        if (!value)
          return res.status(400).json({ message: "value cannot be empty" });

        if (def.max === sql.MAX) r.input("value", sql.NVarChar(sql.MAX), value);
        else r.input("value", sql.NVarChar(def.max), value);

        sets.push("[value] = @value");
      }

      if (hasIsActive) {
        r.input("isActive", sql.Bit, req.body.isActive);
        sets.push("isActive = @isActive");
      }

      if (hasShortName) {
        const shortName =
          req.body.shortName == null
            ? null
            : String(req.body.shortName || "").trim() || null;
        r.input("shortName", sql.NVarChar(100), shortName);
        sets.push("shortName = @shortName");
      }

      if (hasCountry) {
        const country =
          req.body.country == null
            ? null
            : String(req.body.country || "").trim() || null;
        r.input("country", sql.NVarChar(100), country);
        sets.push("country = @country");
      }

      sets.push("updatedAt = SYSUTCDATETIME()");

      const q = `
        UPDATE ${def.table}
        SET ${sets.join(", ")}
        WHERE id = @id
      `;

      const out = await r.query(q);
      if (!out.rowsAffected?.[0]) return res.sendStatus(404);

      return res.json({ ok: true });
    } catch (err) {
      if (err && (err.number === 2627 || err.number === 2601)) {
        return res.status(409).json({ message: "value already exists" });
      }
      console.error("[API] PUT /api/admin/masters/:key/:id error:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// Soft-delete (disable)
app.delete(
  "/api/admin/masters/:key/:id",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const def = getMasterDef(req.params.key);
    if (!def) return res.status(400).json({ message: "Invalid master key" });

    try {
      const pool = await getPool();
      await pool.request().input("id", sql.UniqueIdentifier, req.params.id)
        .query(`
        UPDATE ${def.table}
        SET isActive = 0, updatedAt = SYSUTCDATETIME()
        WHERE id = @id
      `);

      res.json({ ok: true });
    } catch (err) {
      console.error("[API] admin delete master error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Vendor list
// Vendor list (freight options) - backed by Transporter Master
app.get("/api/vendors", authenticate, async (req, res) => {
  try {
    const pool = await getPool();

    try {
      const r = await pool.request().query(`
SELECT
  vendorEmail AS username,
  vendorName AS name,
  shortName AS shortName,
  vendorCode AS company

        FROM dbo.Master_Transporters
        WHERE ISNULL(isActive, 1) = 1
        ORDER BY vendorName ASC
      `);

      // Keep response shape compatible with existing frontend:
      // { username, name, company }
      return res.json(
        (r.recordset || []).map((x) => ({
          username: x.username || "",
          name: x.name,
          company: x.company,
          shortName: x.shortName || null, // ✅ NEW
        }))
      );
    } catch (e) {
      // Fallback if table not present for some reason
      const result = await pool.request().query(`
        SELECT username, name, company
        FROM dbo.Users
        WHERE role = 'vendor'
      `);
      return res.json(result.recordset || []);
    }
  } catch (err) {
    console.error("[API] Fetch vendors error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Allocations by RFQ
app.get("/api/allocations/:rfqId", authenticate, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("rfqId", sql.UniqueIdentifier, req.params.rfqId)
      .query("SELECT * FROM dbo.Allocations WHERE rfqId = @rfqId");
    res.json(result.recordset);
  } catch (err) {
    console.error("[API] Fetch allocations error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// =========================
// ADMIN — PURGE ALL DATA (EXCEPT USERS + MASTERS)
// =========================
app.post(
  "/api/admin/purge-data",
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const pool = await getPool();

      // IMPORTANT: order matters because of foreign keys
      const purgeSql = `
        BEGIN TRAN;

        DELETE FROM dbo.Allocations;
        DELETE FROM dbo.Quotes;
        DELETE FROM dbo.RFQs;

        COMMIT TRAN;
      `;

      await pool.request().batch(purgeSql);

      return res.json({
        ok: true,
        message:
          "All transactional data purged (RFQs, Quotes, Allocations). Masters and Users untouched.",
      });
    } catch (err) {
      console.error("[ADMIN] purge-data failed:", err);
      return res.status(500).json({
        ok: false,
        message: "Failed to purge data",
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN CHAT / NL ANALYTICS (hybrid deterministic engine + optional Ollama)
// ─────────────────────────────────────────────────────────────────────────────
// Environment:
//   OLLAMA_URL   — base URL (default http://127.0.0.1:11434)
//   OLLAMA_MODEL — model name (default llama3.2, recommended alt: qwen2.5)
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";

const CHAT_RECENT_RFQ_LIMIT = 40;
const CHAT_RECENT_QUOTE_LIMIT = 150;
const CHAT_RECENT_ALLOCATION_LIMIT = 150;

const CHAT_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "show",
  "tell",
  "the",
  "to",
  "was",
  "what",
  "which",
  "who",
  "with",
  "you",
  "your",
  "me",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "this",
  "that",
  "these",
  "those",
  "about",
  "please",
  "can",
  "could",
  "would",
  "should",
  "will",
  "all",
  "any",
  "into",
  "than",
  "then",
  "their",
  "there",
  "when",
  "where",
]);

function fmtInr(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? `₹${n.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : "—";
}

function fmtUsd(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "—";
}

function fmtPct(num, den) {
  const n = Number(num || 0);
  const d = Number(den || 0);
  if (!d) return "0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeForSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForSearch(value) {
  return normalizeForSearch(value)
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length > 2)
    .filter((x) => !CHAT_STOPWORDS.has(x));
}

function uniqStrings(values) {
  const seen = new Set();
  const out = [];
  for (const v of values || []) {
    const raw = String(v || "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function buildAliases(...values) {
  return uniqStrings(
    values.flatMap((v) => {
      const raw = String(v || "").trim();
      if (!raw) return [];
      const norm = normalizeForSearch(raw);
      return uniqStrings([raw, norm]);
    })
  );
}

function aliasMatches(questionNorm, aliases) {
  const hay = ` ${questionNorm} `;
  for (const alias of aliases || []) {
    const a = normalizeForSearch(alias);
    if (!a || a.length < 3) continue;
    if (hay.includes(` ${a} `)) return true;
    if (a.length >= 6 && questionNorm.includes(a)) return true;
  }
  return false;
}

function sortByAliasSpecificity(items) {
  return [...items].sort((a, b) => {
    const aMax = Math.max(
      0,
      ...(a.aliases || []).map((x) => normalizeForSearch(x).length)
    );
    const bMax = Math.max(
      0,
      ...(b.aliases || []).map((x) => normalizeForSearch(x).length)
    );
    return bMax - aMax;
  });
}

function monthLabel(monthKey) {
  const [yyyy, mm] = String(monthKey || "").split("-");
  if (!yyyy || !mm) return monthKey || "—";
  const d = new Date(`${yyyy}-${mm}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return monthKey || "—";
  return d.toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
}

function compactText(value, max = 180) {
  const s = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function extractRfqNumbers(question) {
  const matches = String(question || "").match(/\b\d{3,}\b/g) || [];
  return Array.from(new Set(matches.map((x) => Number(x)).filter(Boolean)));
}

function bestKeywordScore(questionTokens, text) {
  if (!questionTokens.length) return 0;
  const hay = tokenizeForSearch(text);
  if (!hay.length) return 0;
  const haySet = new Set(hay);
  let score = 0;
  for (const tok of questionTokens) {
    if (haySet.has(tok)) score += 1;
  }
  return score;
}

async function buildAnalyticsContext() {
  const pool = await getPool();

  const [
    countsRes,
    statusCountsRes,
    vendorsRes,
    portsRes,
    companiesRes,
    containerTypesRes,
    incotermsRes,
    recentRfqsRes,
    recentQuotesRes,
    recentAllocationsRes,
    laneStatsRes,
    monthlyRfqsRes,
    monthlyQuotesRes,
    monthlyAllocationsRes,
  ] = await Promise.all([
    pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.RFQs) AS totalRFQs,
        (SELECT COUNT(*) FROM dbo.Quotes) AS totalQuotes,
        (SELECT COUNT(*) FROM dbo.Allocations) AS totalAllocations,
        (SELECT ISNULL(SUM(numberOfContainers),0) FROM dbo.RFQs) AS totalContainersRequested,
        (SELECT ISNULL(SUM(ISNULL(containersAllottedHome,0) + ISNULL(containersAllottedMOOWR,0)),0) FROM dbo.Allocations) AS totalContainersAllocated,
        (SELECT COUNT(*) FROM dbo.Master_Transporters WHERE ISNULL(isActive,1)=1) AS activeVendors,
        (SELECT COUNT(*) FROM dbo.Master_PortsOfLoading WHERE ISNULL(isActive,1)=1) AS activePortsOfLoading,
        (SELECT COUNT(*) FROM dbo.Master_CompanyNames WHERE ISNULL(isActive,1)=1) AS activeCompanies,
        (SELECT COUNT(*) FROM dbo.Master_ContainerTypes WHERE ISNULL(isActive,1)=1) AS activeContainerTypes
    `),

    pool.request().query(`
      SELECT status, COUNT(*) AS rfqCount
      FROM dbo.RFQs
      GROUP BY status
      ORDER BY rfqCount DESC, status ASC
    `),

    pool.request().query(`
      SELECT
        CAST(t.vendorCode AS NVARCHAR(150)) AS vendorCode,
        CAST(t.vendorName AS NVARCHAR(255)) AS vendorName,
        CAST(t.shortName AS NVARCHAR(100)) AS shortName,
        COALESCE(NULLIF(CAST(t.vendorEmails AS NVARCHAR(MAX)), ''), NULLIF(LTRIM(RTRIM(t.vendorEmail)), '')) AS vendorEmails,
        ISNULL((
          SELECT COUNT(*) FROM dbo.Quotes q WHERE q.vendorName = t.vendorCode
        ), 0) AS quoteCount,
        ISNULL((
          SELECT COUNT(DISTINCT q.rfqId) FROM dbo.Quotes q WHERE q.vendorName = t.vendorCode
        ), 0) AS quotedRFQCount,
        ISNULL((
          SELECT COUNT(*) FROM dbo.Allocations a WHERE a.vendorName = t.vendorCode
        ), 0) AS allocationCount,
        ISNULL((
          SELECT SUM(ISNULL(a.containersAllottedHome,0) + ISNULL(a.containersAllottedMOOWR,0))
          FROM dbo.Allocations a WHERE a.vendorName = t.vendorCode
        ), 0) AS allocatedContainers,
        ISNULL((
          SELECT SUM(
            ISNULL(a.containersAllottedHome,0) * ISNULL(q.homeTotal,0) +
            ISNULL(a.containersAllottedMOOWR,0) * ISNULL(q.mooWRTotal,0)
          )
          FROM dbo.Allocations a
          INNER JOIN dbo.Quotes q ON q.id = a.quoteId
          WHERE a.vendorName = t.vendorCode
        ), 0) AS amountWon,
        (
          SELECT AVG(CAST(q.seaFreightPerContainer AS FLOAT))
          FROM dbo.Quotes q
          WHERE q.vendorName = t.vendorCode
            AND q.seaFreightPerContainer IS NOT NULL
            AND q.seaFreightPerContainer > 0
        ) AS avgSeaFreightUsd,
        (
          SELECT MAX(q.createdAt) FROM dbo.Quotes q WHERE q.vendorName = t.vendorCode
        ) AS lastQuoteAt,
        (
          SELECT MAX(a.createdAt) FROM dbo.Allocations a WHERE a.vendorName = t.vendorCode
        ) AS lastAllocationAt
      FROM dbo.Master_Transporters t
      WHERE ISNULL(t.isActive,1) = 1
      ORDER BY allocatedContainers DESC, amountWon DESC, vendorName ASC
    `),

    pool.request().query(`
      SELECT
        CAST(p.value AS NVARCHAR(100)) AS value,
        CAST(p.country AS NVARCHAR(100)) AS country,
        ISNULL((
          SELECT COUNT(*) FROM dbo.RFQs r WHERE r.portOfLoading = p.value
        ), 0) AS rfqCount,
        (
          SELECT AVG(CAST(q.seaFreightPerContainer AS FLOAT))
          FROM dbo.Quotes q
          INNER JOIN dbo.RFQs r ON r.id = q.rfqId
          WHERE r.portOfLoading = p.value
            AND q.seaFreightPerContainer IS NOT NULL
            AND q.seaFreightPerContainer > 0
        ) AS avgSeaFreightUsd
      FROM dbo.Master_PortsOfLoading p
      WHERE ISNULL(p.isActive,1) = 1
      ORDER BY rfqCount DESC, value ASC
    `),

    pool.request().query(`
      SELECT
        CAST(c.value AS NVARCHAR(MAX)) AS value,
        CAST(c.shortName AS NVARCHAR(100)) AS shortName,
        ISNULL((
          SELECT COUNT(*) FROM dbo.RFQs r WHERE r.companyName = c.value
        ), 0) AS rfqCount,
        ISNULL((
          SELECT SUM(r.numberOfContainers) FROM dbo.RFQs r WHERE r.companyName = c.value
        ), 0) AS requestedContainers
      FROM dbo.Master_CompanyNames c
      WHERE ISNULL(c.isActive,1) = 1
      ORDER BY rfqCount DESC, value ASC
    `),

    pool.request().query(`
      SELECT
        CAST(ct.value AS NVARCHAR(50)) AS value,
        ISNULL((
          SELECT COUNT(*) FROM dbo.RFQs r WHERE r.containerType = ct.value
        ), 0) AS rfqCount,
        ISNULL((
          SELECT COUNT(*) FROM dbo.Quotes q WHERE q.containerType = ct.value
        ), 0) AS quoteCount
      FROM dbo.Master_ContainerTypes ct
      WHERE ISNULL(ct.isActive,1) = 1
      ORDER BY rfqCount DESC, value ASC
    `),

    pool.request().query(`
      SELECT CAST(value AS NVARCHAR(50)) AS value
      FROM dbo.Master_Incoterms
      WHERE ISNULL(isActive,1) = 1
      ORDER BY value ASC
    `),

    pool.request().query(`
      SELECT TOP ${CHAT_RECENT_RFQ_LIMIT}
        CAST(r.id AS NVARCHAR(50)) AS id,
        r.rfqNumber,
        CAST(r.itemDescription AS NVARCHAR(500)) AS itemDescription,
        CAST(r.companyName AS NVARCHAR(MAX)) AS companyName,
        CAST(r.materialPONumber AS NVARCHAR(150)) AS materialPONumber,
        CAST(r.supplierName AS NVARCHAR(255)) AS supplierName,
        CAST(r.portOfLoading AS NVARCHAR(100)) AS portOfLoading,
        CAST(r.portOfDestination AS NVARCHAR(100)) AS portOfDestination,
        CAST(r.containerType AS NVARCHAR(50)) AS containerType,
        CAST(r.incoterms AS NVARCHAR(50)) AS incoterms,
        r.numberOfContainers,
        r.cargoWeight,
        r.status,
        r.createdAt,
        r.finalizedAt,
        ISNULL((
          SELECT COUNT(*) FROM dbo.Quotes q WHERE q.rfqId = r.id
        ), 0) AS quoteCount,
        ISNULL((
          SELECT COUNT(*) FROM dbo.Allocations a WHERE a.rfqId = r.id
        ), 0) AS allocationCount,
        ISNULL((
          SELECT SUM(ISNULL(a.containersAllottedHome,0) + ISNULL(a.containersAllottedMOOWR,0))
          FROM dbo.Allocations a WHERE a.rfqId = r.id
        ), 0) AS allocatedContainers,
        (
          SELECT MIN(q.createdAt) FROM dbo.Quotes q WHERE q.rfqId = r.id
        ) AS firstQuoteAt,
        (
          SELECT MAX(q.createdAt) FROM dbo.Quotes q WHERE q.rfqId = r.id
        ) AS lastQuoteAt
      FROM dbo.RFQs r
      ORDER BY r.createdAt DESC
    `),

    pool.request().query(`
      SELECT TOP ${CHAT_RECENT_QUOTE_LIMIT}
        CAST(q.id AS NVARCHAR(50)) AS id,
        CAST(q.rfqId AS NVARCHAR(50)) AS rfqId,
        q.vendorName,
        COALESCE(NULLIF(LTRIM(RTRIM(t.shortName)), ''), NULLIF(LTRIM(RTRIM(t.vendorName)), ''), q.vendorName) AS vendorLabel,
        r.rfqNumber,
        CAST(r.portOfLoading AS NVARCHAR(100)) AS portOfLoading,
        CAST(r.portOfDestination AS NVARCHAR(100)) AS portOfDestination,
        COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType) AS containerType,
        q.numberOfContainers,
        q.shippingLineName,
        q.transshipOrDirect,
        CAST(q.seaFreightPerContainer AS FLOAT) AS seaFreightPerContainer,
        CAST(q.homeTotal AS FLOAT) AS homeTotal,
        CAST(q.mooWRTotal AS FLOAT) AS mooWRTotal,
        q.createdAt
      FROM dbo.Quotes q
      INNER JOIN dbo.RFQs r ON r.id = q.rfqId
      LEFT JOIN dbo.Master_Transporters t ON t.vendorCode = q.vendorName
      ORDER BY q.createdAt DESC
    `),

    pool.request().query(`
      SELECT TOP ${CHAT_RECENT_ALLOCATION_LIMIT}
        CAST(a.id AS NVARCHAR(50)) AS id,
        CAST(a.rfqId AS NVARCHAR(50)) AS rfqId,
        CAST(a.quoteId AS NVARCHAR(50)) AS quoteId,
        a.vendorName,
        COALESCE(NULLIF(LTRIM(RTRIM(t.shortName)), ''), NULLIF(LTRIM(RTRIM(t.vendorName)), ''), a.vendorName) AS vendorLabel,
        r.rfqNumber,
        CAST(r.portOfLoading AS NVARCHAR(100)) AS portOfLoading,
        CAST(r.portOfDestination AS NVARCHAR(100)) AS portOfDestination,
        COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType) AS containerType,
        a.containersAllottedHome,
        a.containersAllottedMOOWR,
        a.reason,
        a.createdAt,
        CAST(q.homeTotal AS FLOAT) AS homeTotal,
        CAST(q.mooWRTotal AS FLOAT) AS mooWRTotal
      FROM dbo.Allocations a
      INNER JOIN dbo.RFQs r ON r.id = a.rfqId
      LEFT JOIN dbo.Quotes q ON q.id = a.quoteId
      LEFT JOIN dbo.Master_Transporters t ON t.vendorCode = a.vendorName
      ORDER BY a.createdAt DESC
    `),

    pool.request().query(`
      SELECT TOP 100
        CAST(r.portOfLoading AS NVARCHAR(100)) AS portOfLoading,
        CAST(r.portOfDestination AS NVARCHAR(100)) AS portOfDestination,
        COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType) AS containerType,
        COUNT(DISTINCT r.id) AS rfqCount,
        COUNT(DISTINCT q.id) AS quoteCount,
        MIN(CAST(q.seaFreightPerContainer AS FLOAT)) AS minFreightUsd,
        AVG(CAST(q.seaFreightPerContainer AS FLOAT)) AS avgFreightUsd,
        MAX(CAST(q.seaFreightPerContainer AS FLOAT)) AS maxFreightUsd
      FROM dbo.RFQs r
      INNER JOIN dbo.Quotes q ON q.rfqId = r.id
      WHERE q.seaFreightPerContainer IS NOT NULL
        AND q.seaFreightPerContainer > 0
      GROUP BY
        r.portOfLoading,
        r.portOfDestination,
        COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType)
      ORDER BY quoteCount DESC, rfqCount DESC, portOfLoading ASC
    `),

    pool.request().query(`
      SELECT
        FORMAT(createdAt, 'yyyy-MM') AS monthKey,
        COUNT(*) AS rfqCount,
        ISNULL(SUM(numberOfContainers),0) AS requestedContainers
      FROM dbo.RFQs
      GROUP BY FORMAT(createdAt, 'yyyy-MM')
      ORDER BY monthKey DESC
    `),

    pool.request().query(`
      SELECT
        FORMAT(createdAt, 'yyyy-MM') AS monthKey,
        COUNT(*) AS quoteCount
      FROM dbo.Quotes
      GROUP BY FORMAT(createdAt, 'yyyy-MM')
      ORDER BY monthKey DESC
    `),

    pool.request().query(`
      SELECT
        FORMAT(createdAt, 'yyyy-MM') AS monthKey,
        COUNT(*) AS allocationCount,
        ISNULL(SUM(ISNULL(containersAllottedHome,0) + ISNULL(containersAllottedMOOWR,0)),0) AS allocatedContainers
      FROM dbo.Allocations
      GROUP BY FORMAT(createdAt, 'yyyy-MM')
      ORDER BY monthKey DESC
    `),
  ]);

  const summary = countsRes.recordset?.[0] || {};
  const statusBreakdown = statusCountsRes.recordset || [];

  const vendors = (vendorsRes.recordset || []).map((r) => ({
    vendorCode: r.vendorCode,
    vendorName: r.vendorName,
    shortName: r.shortName || null,
    vendorEmails: r.vendorEmails || null,
    quoteCount: safeNum(r.quoteCount),
    quotedRFQCount: safeNum(r.quotedRFQCount),
    allocationCount: safeNum(r.allocationCount),
    allocatedContainers: safeNum(r.allocatedContainers),
    amountWon: safeNum(r.amountWon),
    avgSeaFreightUsd: safeNum(r.avgSeaFreightUsd, null),
    lastQuoteAt: r.lastQuoteAt || null,
    lastAllocationAt: r.lastAllocationAt || null,
    aliases: buildAliases(r.vendorCode, r.vendorName, r.shortName),
  }));

  const portsOfLoading = (portsRes.recordset || []).map((r) => ({
    value: r.value,
    country: r.country || null,
    rfqCount: safeNum(r.rfqCount),
    avgSeaFreightUsd: safeNum(r.avgSeaFreightUsd, null),
    aliases: buildAliases(r.value, r.country),
  }));

  const companies = (companiesRes.recordset || []).map((r) => ({
    value: r.value,
    shortName: r.shortName || null,
    rfqCount: safeNum(r.rfqCount),
    requestedContainers: safeNum(r.requestedContainers),
    aliases: buildAliases(r.value, r.shortName),
  }));

  const containerTypes = (containerTypesRes.recordset || []).map((r) => ({
    value: r.value,
    rfqCount: safeNum(r.rfqCount),
    quoteCount: safeNum(r.quoteCount),
    aliases: buildAliases(r.value),
  }));

  const incoterms = (incotermsRes.recordset || []).map((r) => ({
    value: r.value,
    aliases: buildAliases(r.value),
  }));

  const recentRFQs = (recentRfqsRes.recordset || []).map((r) => ({
    ...r,
    aliases: buildAliases(
      `rfq ${r.rfqNumber}`,
      String(r.rfqNumber || ""),
      r.itemDescription,
      r.materialPONumber,
      r.companyName,
      r.portOfLoading,
      r.portOfDestination,
      r.containerType,
      r.status
    ),
  }));

  const recentQuotes = (recentQuotesRes.recordset || []).map((r) => ({
    ...r,
    aliases: buildAliases(
      r.vendorName,
      r.vendorLabel,
      `rfq ${r.rfqNumber}`,
      String(r.rfqNumber || ""),
      r.portOfLoading,
      r.portOfDestination,
      r.containerType,
      r.shippingLineName
    ),
  }));

  const recentAllocations = (recentAllocationsRes.recordset || []).map((r) => ({
    ...r,
    amountWon:
      safeNum(r.containersAllottedHome) * safeNum(r.homeTotal) +
      safeNum(r.containersAllottedMOOWR) * safeNum(r.mooWRTotal),
    aliases: buildAliases(
      r.vendorName,
      r.vendorLabel,
      `rfq ${r.rfqNumber}`,
      String(r.rfqNumber || ""),
      r.portOfLoading,
      r.portOfDestination,
      r.containerType,
      r.reason
    ),
  }));

  const laneStats = (laneStatsRes.recordset || []).map((r) => ({
    portOfLoading: r.portOfLoading,
    portOfDestination: r.portOfDestination,
    containerType: r.containerType,
    rfqCount: safeNum(r.rfqCount),
    quoteCount: safeNum(r.quoteCount),
    minFreightUsd: safeNum(r.minFreightUsd, null),
    avgFreightUsd: safeNum(r.avgFreightUsd, null),
    maxFreightUsd: safeNum(r.maxFreightUsd, null),
    aliases: buildAliases(
      r.portOfLoading,
      r.portOfDestination,
      r.containerType,
      `${r.portOfLoading} ${r.portOfDestination}`,
      `${r.portOfLoading} ${r.containerType}`,
      `${r.portOfLoading} to ${r.portOfDestination}`
    ),
  }));

  const monthMap = new Map();

  for (const row of monthlyRfqsRes.recordset || []) {
    const k = String(row.monthKey || "");
    if (!k) continue;
    monthMap.set(k, {
      monthKey: k,
      label: monthLabel(k),
      rfqCount: safeNum(row.rfqCount),
      requestedContainers: safeNum(row.requestedContainers),
      quoteCount: 0,
      allocationCount: 0,
      allocatedContainers: 0,
      aliases: buildAliases(k, monthLabel(k)),
    });
  }

  for (const row of monthlyQuotesRes.recordset || []) {
    const k = String(row.monthKey || "");
    if (!k) continue;
    const existing = monthMap.get(k) || {
      monthKey: k,
      label: monthLabel(k),
      rfqCount: 0,
      requestedContainers: 0,
      quoteCount: 0,
      allocationCount: 0,
      allocatedContainers: 0,
      aliases: buildAliases(k, monthLabel(k)),
    };
    existing.quoteCount = safeNum(row.quoteCount);
    monthMap.set(k, existing);
  }

  for (const row of monthlyAllocationsRes.recordset || []) {
    const k = String(row.monthKey || "");
    if (!k) continue;
    const existing = monthMap.get(k) || {
      monthKey: k,
      label: monthLabel(k),
      rfqCount: 0,
      requestedContainers: 0,
      quoteCount: 0,
      allocationCount: 0,
      allocatedContainers: 0,
      aliases: buildAliases(k, monthLabel(k)),
    };
    existing.allocationCount = safeNum(row.allocationCount);
    existing.allocatedContainers = safeNum(row.allocatedContainers);
    monthMap.set(k, existing);
  }

  const monthlyStats = Array.from(monthMap.values()).sort((a, b) =>
    String(b.monthKey).localeCompare(String(a.monthKey))
  );

  const platform = {
    name: "LEAFI",
    purpose:
      "LEAFI manages ocean-freight procurement from RFQ creation through vendor quotation, evaluation, container allocation, finalization, reporting, and vendor notification.",
    coreEntities: [
      "RFQs",
      "Quotes",
      "Allocations",
      "Transporter master",
      "Ports of loading",
      "Ports of destination",
      "Container types",
      "Companies",
      "Incoterms",
    ],
    whatDataIsCollected: [
      "RFQ metadata: item description, company, material PO, supplier, route, container type, incoterms, requested containers, cargo readiness, creator, timestamps, status",
      "Quote economics: sea freight, HDO/BOL, CFS, transportation, EDI, CHA HOME, CHA MOOWR, re-warehousing, home total, MOOWR total, vessel schedule, shipping line",
      "Allocation decisions: vendor, HOME containers, MOOWR containers, reason for deviation, timestamp",
      "Master-data semantics: vendor codes, vendor display names, short names, emails, port countries, company short names",
    ],
    whatTheDataCanTellYou: [
      "Who wins the most volume and spend",
      "Which vendors are cheapest or most expensive on each lane",
      "Which lanes have the widest freight spread",
      "How quickly vendors respond after RFQ creation",
      "How RFQ/quote/allocation activity trends month over month",
      "Which RFQs are stuck open or under-allocated",
      "Which routes, ports, companies, and container types dominate demand",
    ],
    recommendedImprovements: [
      "Add a first-class RFQ event history table for every status change and user action",
      "Store quote revisions explicitly instead of overwriting the latest row in place",
      "Capture why a vendor declined or did not quote",
      "Capture landed-cost variance against final awarded cost",
      "Capture SLA timestamps: RFQ sent, first vendor response, quote completeness, finalization latency",
      "Add route-normalization and lane IDs so analytics are cleaner across spelling variants",
      "Add vendor performance dimensions: hit rate, quote responsiveness, award rate, cost competitiveness",
    ],
  };

  const capabilities = [
    "Exact RFQ lookup by RFQ number",
    "Vendor performance, winnings, quote participation, and lane coverage",
    "Lane analysis by port-of-loading, destination, and container type",
    "Monthly trend analysis for RFQs, quotes, and allocations",
    "Closure and allocation coverage analysis",
    "Platform/data-dictionary explanations in plain English",
  ];

  return {
    platform,
    capabilities,
    summary,
    entityCounts: {
      vendors: vendors.length,
      portsOfLoading: portsOfLoading.length,
      companies: companies.length,
      containerTypes: containerTypes.length,
      incoterms: incoterms.length,
      lanes: laneStats.length,
      months: monthlyStats.length,
    },
    statusBreakdown,
    vendors,
    portsOfLoading,
    companies,
    containerTypes,
    incoterms,
    recentRFQs,
    recentQuotes,
    recentAllocations,
    laneStats,
    monthlyStats,
    generatedAt: new Date().toISOString(),
  };
}

function buildSuggestedQuestions(ctx) {
  const topVendor = ctx?.vendors?.[0];
  const topPort = ctx?.portsOfLoading?.[0];
  const topLane = ctx?.laneStats?.[0];
  const latestRfq = ctx?.recentRFQs?.[0];

  const out = [
    "What does this platform do, what data does it collect, and what can that data tell me?",
    "Which vendor is winning the most volume and spend?",
    "Which RFQs are still open, under-quoted, or under-allocated?",
    "Which lanes have the widest freight spread between cheapest and costliest quote?",
    "What trends do you see month over month in RFQs, quotes, and allocations?",
  ];

  if (topVendor?.vendorCode) {
    out.push(
      `How is ${topVendor.vendorCode} performing across quotes, allocations, and winnings?`
    );
  }
  if (topPort?.value) {
    out.push(
      `What do our data points say about ${topPort.value} as a port of loading?`
    );
  }
  if (topLane?.portOfLoading && topLane?.containerType) {
    out.push(
      `What are the cheapest and costliest quotes on ${topLane.portOfLoading} for ${topLane.containerType}?`
    );
  }
  if (latestRfq?.rfqNumber) {
    out.push(`Give me a full summary of RFQ ${latestRfq.rfqNumber}.`);
  }

  return out.slice(0, 8);
}

function resolveEntities(question, ctx) {
  const qNorm = normalizeForSearch(question);
  const rfqNumbers = extractRfqNumbers(question);

  const vendor =
    sortByAliasSpecificity(
      (ctx.vendors || []).filter((v) => aliasMatches(qNorm, v.aliases))
    )[0] || null;

  const portOfLoading =
    sortByAliasSpecificity(
      (ctx.portsOfLoading || []).filter((p) => aliasMatches(qNorm, p.aliases))
    )[0] || null;

  const company =
    sortByAliasSpecificity(
      (ctx.companies || []).filter((c) => aliasMatches(qNorm, c.aliases))
    )[0] || null;

  const containerType =
    sortByAliasSpecificity(
      (ctx.containerTypes || []).filter((c) => aliasMatches(qNorm, c.aliases))
    )[0] || null;

  const month =
    sortByAliasSpecificity(
      (ctx.monthlyStats || []).filter((m) => aliasMatches(qNorm, m.aliases))
    )[0] || null;

  const status = /\bclosed\b/.test(qNorm)
    ? "closed"
    : /\bevaluation\b/.test(qNorm)
    ? "evaluation"
    : /\binitial\b/.test(qNorm) || /\bopen\b/.test(qNorm)
    ? "initial"
    : null;

  return {
    questionNorm: qNorm,
    rfqNumbers,
    vendor,
    portOfLoading,
    company,
    containerType,
    month,
    status,
  };
}

async function fetchRfqDeep(pool, rfqNumber) {
  const rfqRes = await pool.request().input("rfqNumber", sql.Int, rfqNumber)
    .query(`
      SELECT TOP 1
        CAST(r.id AS NVARCHAR(50)) AS id,
        r.rfqNumber,
        CAST(r.itemDescription AS NVARCHAR(500)) AS itemDescription,
        CAST(r.companyName AS NVARCHAR(MAX)) AS companyName,
        CAST(r.materialPONumber AS NVARCHAR(150)) AS materialPONumber,
        CAST(r.supplierName AS NVARCHAR(255)) AS supplierName,
        CAST(r.portOfLoading AS NVARCHAR(100)) AS portOfLoading,
        CAST(r.portOfDestination AS NVARCHAR(100)) AS portOfDestination,
        CAST(r.containerType AS NVARCHAR(50)) AS containerType,
        CAST(r.incoterms AS NVARCHAR(50)) AS incoterms,
        r.numberOfContainers,
        r.cargoWeight,
        r.status,
        r.createdAt,
        r.finalizedAt,
        ISNULL((
          SELECT COUNT(*) FROM dbo.Quotes q WHERE q.rfqId = r.id
        ), 0) AS quoteCount,
        ISNULL((
          SELECT COUNT(*) FROM dbo.Allocations a WHERE a.rfqId = r.id
        ), 0) AS allocationCount,
        ISNULL((
          SELECT SUM(ISNULL(a.containersAllottedHome,0) + ISNULL(a.containersAllottedMOOWR,0))
          FROM dbo.Allocations a WHERE a.rfqId = r.id
        ), 0) AS allocatedContainers,
        (
          SELECT MIN(q.createdAt) FROM dbo.Quotes q WHERE q.rfqId = r.id
        ) AS firstQuoteAt,
        (
          SELECT MAX(q.createdAt) FROM dbo.Quotes q WHERE q.rfqId = r.id
        ) AS lastQuoteAt
      FROM dbo.RFQs r
      WHERE r.rfqNumber = @rfqNumber
    `);

  const rfq = rfqRes.recordset?.[0] || null;
  if (!rfq) return null;

  const quotesRes = await pool
    .request()
    .input("rfqId", sql.UniqueIdentifier, rfq.id).query(`
      SELECT
        CAST(q.id AS NVARCHAR(50)) AS id,
        q.vendorName,
        COALESCE(NULLIF(LTRIM(RTRIM(t.shortName)), ''), NULLIF(LTRIM(RTRIM(t.vendorName)), ''), q.vendorName) AS vendorLabel,
        q.numberOfContainers,
        q.shippingLineName,
        q.transshipOrDirect,
        CAST(q.seaFreightPerContainer AS FLOAT) AS seaFreightPerContainer,
        CAST(q.homeTotal AS FLOAT) AS homeTotal,
        CAST(q.mooWRTotal AS FLOAT) AS mooWRTotal,
        q.createdAt,
        ISNULL((
          SELECT SUM(ISNULL(a.containersAllottedHome,0)) FROM dbo.Allocations a WHERE a.quoteId = q.id
        ), 0) AS allocatedHome,
        ISNULL((
          SELECT SUM(ISNULL(a.containersAllottedMOOWR,0)) FROM dbo.Allocations a WHERE a.quoteId = q.id
        ), 0) AS allocatedMoowr
      FROM dbo.Quotes q
      LEFT JOIN dbo.Master_Transporters t ON t.vendorCode = q.vendorName
      WHERE q.rfqId = @rfqId
      ORDER BY q.createdAt DESC
    `);

  const allocationsRes = await pool
    .request()
    .input("rfqId", sql.UniqueIdentifier, rfq.id).query(`
      SELECT
        CAST(a.id AS NVARCHAR(50)) AS id,
        a.vendorName,
        COALESCE(NULLIF(LTRIM(RTRIM(t.shortName)), ''), NULLIF(LTRIM(RTRIM(t.vendorName)), ''), a.vendorName) AS vendorLabel,
        a.containersAllottedHome,
        a.containersAllottedMOOWR,
        a.reason,
        a.createdAt
      FROM dbo.Allocations a
      LEFT JOIN dbo.Master_Transporters t ON t.vendorCode = a.vendorName
      WHERE a.rfqId = @rfqId
      ORDER BY a.createdAt DESC
    `);

  return {
    rfq,
    quotes: quotesRes.recordset || [],
    allocations: allocationsRes.recordset || [],
  };
}

async function fetchVendorDeep(pool, vendorCode) {
  const aggRes = await pool
    .request()
    .input("vendorCode", sql.NVarChar(150), vendorCode).query(`
      SELECT TOP 1
        CAST(t.vendorCode AS NVARCHAR(150)) AS vendorCode,
        CAST(t.vendorName AS NVARCHAR(255)) AS vendorName,
        CAST(t.shortName AS NVARCHAR(100)) AS shortName,
        COALESCE(NULLIF(CAST(t.vendorEmails AS NVARCHAR(MAX)), ''), NULLIF(LTRIM(RTRIM(t.vendorEmail)), '')) AS vendorEmails,
        ISNULL((
          SELECT COUNT(*) FROM dbo.Quotes q WHERE q.vendorName = t.vendorCode
        ), 0) AS quoteCount,
        ISNULL((
          SELECT COUNT(DISTINCT q.rfqId) FROM dbo.Quotes q WHERE q.vendorName = t.vendorCode
        ), 0) AS quotedRFQCount,
        ISNULL((
          SELECT COUNT(*) FROM dbo.Allocations a WHERE a.vendorName = t.vendorCode
        ), 0) AS allocationCount,
        ISNULL((
          SELECT SUM(ISNULL(a.containersAllottedHome,0) + ISNULL(a.containersAllottedMOOWR,0))
          FROM dbo.Allocations a WHERE a.vendorName = t.vendorCode
        ), 0) AS allocatedContainers,
        ISNULL((
          SELECT SUM(
            ISNULL(a.containersAllottedHome,0) * ISNULL(q.homeTotal,0) +
            ISNULL(a.containersAllottedMOOWR,0) * ISNULL(q.mooWRTotal,0)
          )
          FROM dbo.Allocations a
          INNER JOIN dbo.Quotes q ON q.id = a.quoteId
          WHERE a.vendorName = t.vendorCode
        ), 0) AS amountWon,
        (
          SELECT AVG(CAST(q.seaFreightPerContainer AS FLOAT))
          FROM dbo.Quotes q
          WHERE q.vendorName = t.vendorCode
            AND q.seaFreightPerContainer IS NOT NULL
            AND q.seaFreightPerContainer > 0
        ) AS avgSeaFreightUsd,
        (
          SELECT MAX(q.createdAt) FROM dbo.Quotes q WHERE q.vendorName = t.vendorCode
        ) AS lastQuoteAt,
        (
          SELECT MAX(a.createdAt) FROM dbo.Allocations a WHERE a.vendorName = t.vendorCode
        ) AS lastAllocationAt
      FROM dbo.Master_Transporters t
      WHERE t.vendorCode = @vendorCode
    `);

  const summary = aggRes.recordset?.[0] || null;
  if (!summary) return null;

  const laneRes = await pool
    .request()
    .input("vendorCode", sql.NVarChar(150), vendorCode).query(`
      SELECT TOP 8
        CAST(r.portOfLoading AS NVARCHAR(100)) AS portOfLoading,
        CAST(r.portOfDestination AS NVARCHAR(100)) AS portOfDestination,
        COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType) AS containerType,
        COUNT(*) AS quoteCount,
        AVG(CAST(q.seaFreightPerContainer AS FLOAT)) AS avgSeaFreightUsd,
        ISNULL(SUM(ISNULL(a.containersAllottedHome,0) + ISNULL(a.containersAllottedMOOWR,0)),0) AS allocatedContainers
      FROM dbo.Quotes q
      INNER JOIN dbo.RFQs r ON r.id = q.rfqId
      LEFT JOIN dbo.Allocations a ON a.quoteId = q.id
      WHERE q.vendorName = @vendorCode
      GROUP BY
        r.portOfLoading,
        r.portOfDestination,
        COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType)
      ORDER BY allocatedContainers DESC, quoteCount DESC, portOfLoading ASC
    `);

  const recentQuotesRes = await pool
    .request()
    .input("vendorCode", sql.NVarChar(150), vendorCode).query(`
      SELECT TOP 5
        r.rfqNumber,
        CAST(r.portOfLoading AS NVARCHAR(100)) AS portOfLoading,
        CAST(r.portOfDestination AS NVARCHAR(100)) AS portOfDestination,
        COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType) AS containerType,
        CAST(q.seaFreightPerContainer AS FLOAT) AS seaFreightPerContainer,
        CAST(q.homeTotal AS FLOAT) AS homeTotal,
        CAST(q.mooWRTotal AS FLOAT) AS mooWRTotal,
        q.createdAt
      FROM dbo.Quotes q
      INNER JOIN dbo.RFQs r ON r.id = q.rfqId
      WHERE q.vendorName = @vendorCode
      ORDER BY q.createdAt DESC
    `);

  const recentAllocationsRes = await pool
    .request()
    .input("vendorCode", sql.NVarChar(150), vendorCode).query(`
      SELECT TOP 5
        r.rfqNumber,
        CAST(r.portOfLoading AS NVARCHAR(100)) AS portOfLoading,
        CAST(r.portOfDestination AS NVARCHAR(100)) AS portOfDestination,
        a.containersAllottedHome,
        a.containersAllottedMOOWR,
        a.reason,
        a.createdAt
      FROM dbo.Allocations a
      INNER JOIN dbo.RFQs r ON r.id = a.rfqId
      WHERE a.vendorName = @vendorCode
      ORDER BY a.createdAt DESC
    `);

  return {
    summary,
    lanes: laneRes.recordset || [],
    recentQuotes: recentQuotesRes.recordset || [],
    recentAllocations: recentAllocationsRes.recordset || [],
  };
}

async function fetchLaneDeep(pool, portOfLoading, containerType) {
  const request = pool
    .request()
    .input("portOfLoading", sql.NVarChar(100), portOfLoading)
    .input(
      "containerType",
      sql.NVarChar(50),
      containerType ? String(containerType) : null
    );

  const summaryRes = await request.query(`
    SELECT
      CAST(r.portOfLoading AS NVARCHAR(100)) AS portOfLoading,
      COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType) AS containerType,
      COUNT(DISTINCT r.id) AS rfqCount,
      COUNT(DISTINCT q.id) AS quoteCount,
      MIN(CAST(q.seaFreightPerContainer AS FLOAT)) AS minFreightUsd,
      AVG(CAST(q.seaFreightPerContainer AS FLOAT)) AS avgFreightUsd,
      MAX(CAST(q.seaFreightPerContainer AS FLOAT)) AS maxFreightUsd
    FROM dbo.RFQs r
    INNER JOIN dbo.Quotes q ON q.rfqId = r.id
    WHERE r.portOfLoading = @portOfLoading
      AND (@containerType IS NULL OR COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType) = @containerType)
      AND q.seaFreightPerContainer IS NOT NULL
      AND q.seaFreightPerContainer > 0
    GROUP BY
      r.portOfLoading,
      COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType)
  `);

  const summary = summaryRes.recordset?.[0] || null;
  if (!summary) return null;

  const quotesRes = await pool
    .request()
    .input("portOfLoading", sql.NVarChar(100), portOfLoading)
    .input(
      "containerType",
      sql.NVarChar(50),
      containerType ? String(containerType) : null
    ).query(`
      SELECT TOP 10
        r.rfqNumber,
        q.vendorName,
        COALESCE(NULLIF(LTRIM(RTRIM(t.shortName)), ''), NULLIF(LTRIM(RTRIM(t.vendorName)), ''), q.vendorName) AS vendorLabel,
        CAST(r.portOfDestination AS NVARCHAR(100)) AS portOfDestination,
        COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType) AS containerType,
        CAST(q.seaFreightPerContainer AS FLOAT) AS seaFreightPerContainer,
        CAST(q.homeTotal AS FLOAT) AS homeTotal,
        CAST(q.mooWRTotal AS FLOAT) AS mooWRTotal,
        q.createdAt
      FROM dbo.Quotes q
      INNER JOIN dbo.RFQs r ON r.id = q.rfqId
      LEFT JOIN dbo.Master_Transporters t ON t.vendorCode = q.vendorName
      WHERE r.portOfLoading = @portOfLoading
        AND (@containerType IS NULL OR COALESCE(NULLIF(LTRIM(RTRIM(q.containerType)), ''), r.containerType) = @containerType)
      ORDER BY q.seaFreightPerContainer ASC, q.createdAt DESC
    `);

  return {
    summary,
    quotes: quotesRes.recordset || [],
  };
}

function buildPlatformAnswer(ctx) {
  const s = ctx.summary || {};
  const statusLines = (ctx.statusBreakdown || [])
    .map((r) => `${r.status}: ${r.rfqCount}`)
    .join(" · ");

  return [
    `**What the platform does**`,
    `${
      ctx.platform?.purpose ||
      "This is an RFQ and allocation analytics platform."
    }`,
    ``,
    `**What data is collected**`,
    ...(ctx.platform?.whatDataIsCollected || []).map((x) => `• ${x}`),
    ``,
    `**What the current data tells you**`,
    ...(ctx.platform?.whatTheDataCanTellYou || []).map((x) => `• ${x}`),
    ``,
    `**Current snapshot**`,
    `• RFQs: ${s.totalRFQs || 0}`,
    `• Quotes: ${s.totalQuotes || 0}`,
    `• Allocations: ${s.totalAllocations || 0}`,
    `• Requested containers: ${s.totalContainersRequested || 0}`,
    `• Allocated containers: ${s.totalContainersAllocated || 0} (${fmtPct(
      s.totalContainersAllocated,
      s.totalContainersRequested
    )})`,
    `• Active vendors: ${s.activeVendors || 0}`,
    `• RFQ status mix: ${statusLines || "—"}`,
    ``,
    `**How to improve further**`,
    ...(ctx.platform?.recommendedImprovements || []).map((x) => `• ${x}`),
  ].join("\n");
}

function buildSummaryAnswer(ctx) {
  const s = ctx.summary || {};
  const topVendor = ctx.vendors?.[0];
  const topPort = ctx.portsOfLoading?.[0];
  const latestMonth = ctx.monthlyStats?.[0];

  return [
    `**LEAFI snapshot**`,
    `• RFQs: ${s.totalRFQs || 0}`,
    `• Quotes: ${s.totalQuotes || 0}`,
    `• Allocations: ${s.totalAllocations || 0}`,
    `• Requested containers: ${s.totalContainersRequested || 0}`,
    `• Allocated containers: ${s.totalContainersAllocated || 0} (${fmtPct(
      s.totalContainersAllocated,
      s.totalContainersRequested
    )})`,
    `• Top winning vendor: ${topVendor?.vendorCode || "—"} with ${
      topVendor?.allocatedContainers || 0
    } allocated containers and ${fmtInr(topVendor?.amountWon || 0)} won`,
    `• Busiest port of loading: ${topPort?.value || "—"} with ${
      topPort?.rfqCount || 0
    } RFQs`,
    latestMonth
      ? `• Latest month in dataset: ${latestMonth.label} — ${latestMonth.rfqCount} RFQs, ${latestMonth.quoteCount} quotes, ${latestMonth.allocatedContainers} allocated containers`
      : `• Latest month in dataset: —`,
  ].join("\n");
}

function buildOpenClosedAnswer(ctx, status) {
  const s = ctx.summary || {};
  const recentOpen = (ctx.recentRFQs || [])
    .filter((r) => r.status !== "closed")
    .slice(0, 5);

  if (status === "closed") {
    return `Closed RFQs: ${
      s.totalRFQs
        ? ctx.statusBreakdown.find((x) => x.status === "closed")?.rfqCount || 0
        : 0
    }`;
  }

  return [
    `**Open / not-finalized RFQs**`,
    `• Initial: ${
      ctx.statusBreakdown.find((x) => x.status === "initial")?.rfqCount || 0
    }`,
    `• Evaluation: ${
      ctx.statusBreakdown.find((x) => x.status === "evaluation")?.rfqCount || 0
    }`,
    `• Closed: ${
      ctx.statusBreakdown.find((x) => x.status === "closed")?.rfqCount || 0
    }`,
    ``,
    `**Recent still-open RFQs**`,
    ...(recentOpen.length
      ? recentOpen.map(
          (r) =>
            `• RFQ ${r.rfqNumber} · ${r.portOfLoading} → ${r.portOfDestination} · ${r.containerType} · ${r.status} · ${r.quoteCount} quote(s)`
        )
      : ["• None found in recent RFQs"]),
  ].join("\n");
}

function buildMonthlyAnswer(ctx) {
  const rows = (ctx.monthlyStats || []).slice(0, 6).reverse();
  if (!rows.length) return "No monthly trend data found.";
  return [
    `**Monthly trend**`,
    ...rows.map(
      (r) =>
        `• ${r.label}: ${r.rfqCount} RFQs, ${r.quoteCount} quotes, ${r.allocationCount} allocations, ${r.requestedContainers} requested containers, ${r.allocatedContainers} allocated containers`
    ),
  ].join("\n");
}

function buildVendorAnswer(detail) {
  const s = detail.summary || {};
  const laneLines = (detail.lanes || [])
    .slice(0, 5)
    .map(
      (l) =>
        `• ${l.portOfLoading} → ${l.portOfDestination} · ${l.containerType} · ${
          l.quoteCount
        } quote(s) · ${
          l.allocatedContainers
        } allocated containers · avg freight ${fmtUsd(l.avgSeaFreightUsd)}`
    );

  const quoteLines = (detail.recentQuotes || [])
    .slice(0, 4)
    .map(
      (q) =>
        `• RFQ ${q.rfqNumber} · ${q.portOfLoading} → ${q.portOfDestination} · ${
          q.containerType
        } · freight ${fmtUsd(q.seaFreightPerContainer)} · HOME ${fmtInr(
          q.homeTotal
        )} · MOOWR ${fmtInr(q.mooWRTotal)}`
    );

  const allocLines = (detail.recentAllocations || [])
    .slice(0, 4)
    .map(
      (a) =>
        `• RFQ ${a.rfqNumber} · HOME ${a.containersAllottedHome || 0} · MOOWR ${
          a.containersAllottedMOOWR || 0
        }${a.reason ? ` · reason: ${compactText(a.reason, 80)}` : ""}`
    );

  return [
    `**Vendor performance · ${s.vendorCode}**`,
    `• Display name: ${s.vendorName || s.vendorCode}`,
    s.shortName ? `• Short name: ${s.shortName}` : null,
    `• Quotes submitted: ${s.quoteCount || 0}`,
    `• RFQs quoted: ${s.quotedRFQCount || 0}`,
    `• Allocation records: ${s.allocationCount || 0}`,
    `• Allocated containers: ${s.allocatedContainers || 0}`,
    `• Amount won: ${fmtInr(s.amountWon || 0)}`,
    `• Average sea freight quoted: ${fmtUsd(s.avgSeaFreightUsd)}`,
    s.lastQuoteAt
      ? `• Last quote at: ${formatDateTimeIst(s.lastQuoteAt)}`
      : null,
    s.lastAllocationAt
      ? `• Last allocation at: ${formatDateTimeIst(s.lastAllocationAt)}`
      : null,
    ``,
    `**Top lanes**`,
    ...(laneLines.length ? laneLines : ["• No lane data found"]),
    ``,
    `**Recent quotes**`,
    ...(quoteLines.length ? quoteLines : ["• No quotes found"]),
    ``,
    `**Recent allocations**`,
    ...(allocLines.length ? allocLines : ["• No allocations found"]),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRfqAnswer(detail) {
  const r = detail.rfq;
  const quotes = detail.quotes || [];
  const allocations = detail.allocations || [];

  const cheapestByFreight = [...quotes]
    .filter((q) => safeNum(q.seaFreightPerContainer) > 0)
    .sort(
      (a, b) =>
        safeNum(a.seaFreightPerContainer) - safeNum(b.seaFreightPerContainer)
    )[0];

  const lowestHome = [...quotes]
    .filter((q) => safeNum(q.homeTotal) > 0)
    .sort((a, b) => safeNum(a.homeTotal) - safeNum(b.homeTotal))[0];

  const lowestMoowr = [...quotes]
    .filter((q) => safeNum(q.mooWRTotal) > 0)
    .sort((a, b) => safeNum(a.mooWRTotal) - safeNum(b.mooWRTotal))[0];

  const quoteLines = quotes
    .slice(0, 6)
    .map(
      (q) =>
        `• ${q.vendorLabel || q.vendorName} · freight ${fmtUsd(
          q.seaFreightPerContainer
        )} · HOME ${fmtInr(q.homeTotal)} · MOOWR ${fmtInr(
          q.mooWRTotal
        )} · allocated HOME ${q.allocatedHome || 0} · allocated MOOWR ${
          q.allocatedMoowr || 0
        }`
    );

  const allocationLines = allocations
    .slice(0, 6)
    .map(
      (a) =>
        `• ${a.vendorLabel || a.vendorName} · HOME ${
          a.containersAllottedHome || 0
        } · MOOWR ${a.containersAllottedMOOWR || 0}${
          a.reason ? ` · reason: ${compactText(a.reason, 90)}` : ""
        }`
    );

  return [
    `**RFQ ${r.rfqNumber}**`,
    `• Item: ${r.itemDescription || "—"}`,
    `• Company: ${r.companyName || "—"}`,
    `• Material PO: ${r.materialPONumber || "—"}`,
    `• Supplier: ${r.supplierName || "—"}`,
    `• Route: ${r.portOfLoading || "—"} → ${r.portOfDestination || "—"}`,
    `• Container type: ${r.containerType || "—"}`,
    r.incoterms ? `• Incoterms: ${r.incoterms}` : null,
    `• Requested containers: ${r.numberOfContainers || 0}`,
    `• Status: ${r.status || "—"}`,
    `• Created at: ${formatDateTimeIst(r.createdAt)}`,
    r.finalizedAt
      ? `• Finalized at: ${formatDateTimeIst(r.finalizedAt)}`
      : null,
    `• Quotes received: ${r.quoteCount || 0}`,
    `• Allocation records: ${r.allocationCount || 0}`,
    `• Allocated containers: ${r.allocatedContainers || 0} / ${
      r.numberOfContainers || 0
    }`,
    r.firstQuoteAt
      ? `• First quote at: ${formatDateTimeIst(r.firstQuoteAt)}`
      : null,
    r.lastQuoteAt
      ? `• Last quote at: ${formatDateTimeIst(r.lastQuoteAt)}`
      : null,
    cheapestByFreight
      ? `• Cheapest sea freight: ${
          cheapestByFreight.vendorLabel || cheapestByFreight.vendorName
        } at ${fmtUsd(cheapestByFreight.seaFreightPerContainer)}`
      : null,
    lowestHome
      ? `• Lowest HOME total: ${
          lowestHome.vendorLabel || lowestHome.vendorName
        } at ${fmtInr(lowestHome.homeTotal)}`
      : null,
    lowestMoowr
      ? `• Lowest MOOWR total: ${
          lowestMoowr.vendorLabel || lowestMoowr.vendorName
        } at ${fmtInr(lowestMoowr.mooWRTotal)}`
      : null,
    ``,
    `**Quotes**`,
    ...(quoteLines.length ? quoteLines : ["• No quotes found"]),
    ``,
    `**Allocations**`,
    ...(allocationLines.length ? allocationLines : ["• No allocations found"]),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildLaneAnswer(detail) {
  const s = detail.summary || {};
  const quotes = detail.quotes || [];
  const cheapest = quotes[0] || null;
  const costliest = quotes.length
    ? [...quotes].sort(
        (a, b) =>
          safeNum(b.seaFreightPerContainer) - safeNum(a.seaFreightPerContainer)
      )[0]
    : null;

  return [
    `**Lane analysis · ${s.portOfLoading} · ${
      s.containerType || "all container types"
    }**`,
    `• RFQs on this lane: ${s.rfqCount || 0}`,
    `• Quotes on this lane: ${s.quoteCount || 0}`,
    `• Min sea freight: ${fmtUsd(s.minFreightUsd)}`,
    `• Avg sea freight: ${fmtUsd(s.avgFreightUsd)}`,
    `• Max sea freight: ${fmtUsd(s.maxFreightUsd)}`,
    cheapest
      ? `• Cheapest quote: ${
          cheapest.vendorLabel || cheapest.vendorName
        } on RFQ ${cheapest.rfqNumber} at ${fmtUsd(
          cheapest.seaFreightPerContainer
        )}`
      : null,
    costliest
      ? `• Costliest quote: ${
          costliest.vendorLabel || costliest.vendorName
        } on RFQ ${costliest.rfqNumber} at ${fmtUsd(
          costliest.seaFreightPerContainer
        )}`
      : null,
    ``,
    `**Top quote examples**`,
    ...quotes
      .slice(0, 6)
      .map(
        (q) =>
          `• ${q.vendorLabel || q.vendorName} · RFQ ${q.rfqNumber} · ${
            q.portOfDestination
          } · freight ${fmtUsd(q.seaFreightPerContainer)} · HOME ${fmtInr(
            q.homeTotal
          )} · MOOWR ${fmtInr(q.mooWRTotal)}`
      ),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTopVendorAnswer(ctx) {
  const rows = (ctx.vendors || []).slice(0, 5);
  const totalAllocated = rows.reduce(
    (s, r) => s + safeNum(r.allocatedContainers),
    0
  );

  return [
    `**Top vendors by allocated volume**`,
    ...rows.map(
      (r, i) =>
        `${i + 1}. ${r.vendorCode} (${r.vendorName || r.vendorCode}) — ${
          r.allocatedContainers
        } allocated containers · ${fmtInr(r.amountWon)} won · ${fmtPct(
          r.allocatedContainers,
          totalAllocated
        )} of top-5 allocated volume`
    ),
  ].join("\n");
}

function buildTopPortsAnswer(ctx) {
  const rows = (ctx.portsOfLoading || []).slice(0, 5);
  return [
    `**Top ports of loading**`,
    ...rows.map(
      (r, i) =>
        `${i + 1}. ${r.value}${r.country ? `, ${r.country}` : ""} — ${
          r.rfqCount
        } RFQs${
          Number.isFinite(r.avgSeaFreightUsd)
            ? ` · avg freight ${fmtUsd(r.avgSeaFreightUsd)}`
            : ""
        }`
    ),
  ].join("\n");
}

function buildKeywordFallbackAnswer(question, ctx) {
  const qTokens = tokenizeForSearch(question);
  if (!qTokens.length) return null;

  const rfqMatches = (ctx.recentRFQs || [])
    .map((r) => ({
      type: "RFQ",
      score: bestKeywordScore(
        qTokens,
        [
          r.rfqNumber,
          r.itemDescription,
          r.companyName,
          r.materialPONumber,
          r.supplierName,
          r.portOfLoading,
          r.portOfDestination,
          r.containerType,
          r.status,
        ].join(" ")
      ),
      label: `RFQ ${r.rfqNumber} · ${r.itemDescription} · ${r.portOfLoading} → ${r.portOfDestination}`,
    }))
    .filter((x) => x.score > 0);

  const quoteMatches = (ctx.recentQuotes || [])
    .map((q) => ({
      type: "Quote",
      score: bestKeywordScore(
        qTokens,
        [
          q.vendorName,
          q.vendorLabel,
          q.rfqNumber,
          q.portOfLoading,
          q.portOfDestination,
          q.containerType,
          q.shippingLineName,
        ].join(" ")
      ),
      label: `Quote · RFQ ${q.rfqNumber} · ${q.vendorLabel || q.vendorName} · ${
        q.portOfLoading
      } → ${q.portOfDestination} · ${q.containerType}`,
    }))
    .filter((x) => x.score > 0);

  const allocMatches = (ctx.recentAllocations || [])
    .map((a) => ({
      type: "Allocation",
      score: bestKeywordScore(
        qTokens,
        [
          a.vendorName,
          a.vendorLabel,
          a.rfqNumber,
          a.portOfLoading,
          a.portOfDestination,
          a.containerType,
          a.reason,
        ].join(" ")
      ),
      label: `Allocation · RFQ ${a.rfqNumber} · ${
        a.vendorLabel || a.vendorName
      } · HOME ${a.containersAllottedHome || 0} · MOOWR ${
        a.containersAllottedMOOWR || 0
      }`,
    }))
    .filter((x) => x.score > 0);

  const combined = [...rfqMatches, ...quoteMatches, ...allocMatches]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (!combined.length) return null;

  return [
    `I could not map that to one exact metric, but these look like the closest matching data points in the current dataset snapshot:`,
    ...combined.map((x) => `• ${x.type}: ${x.label}`),
    ``,
    `Try asking more specifically with a vendor name, RFQ number, port, company, month, or container type.`,
  ].join("\n");
}

async function answerAnalyticsQuestion(question, ctx, pool) {
  const resolved = resolveEntities(question, ctx);
  const qNorm = resolved.questionNorm;

  if (
    /what does.*platform|what does leafi do|what is leafi|what data.*collect|what.*data.*tell|how.*improv|improvement|blind spots|dataset knowledge|platform does/i.test(
      qNorm
    )
  ) {
    return {
      answer: buildPlatformAnswer(ctx),
      source: "deterministic:platform",
      resolved,
      llmContext: {
        type: "platform",
        platform: ctx.platform,
        summary: ctx.summary,
        statusBreakdown: ctx.statusBreakdown,
      },
    };
  }

  if (/summary|overview|dashboard|snapshot|portfolio/i.test(qNorm)) {
    return {
      answer: buildSummaryAnswer(ctx),
      source: "deterministic:summary",
      resolved,
      llmContext: {
        type: "summary",
        summary: ctx.summary,
        topVendors: ctx.vendors?.slice(0, 5),
        topPortsOfLoading: ctx.portsOfLoading?.slice(0, 5),
        monthlyStats: ctx.monthlyStats?.slice(0, 6),
      },
    };
  }

  if (
    /open|closed|finalized|still open|under.?allocated|allocation coverage|closure rate/i.test(
      qNorm
    )
  ) {
    return {
      answer: buildOpenClosedAnswer(ctx, resolved.status),
      source: "deterministic:open-closed",
      resolved,
      llmContext: {
        type: "open-closed",
        summary: ctx.summary,
        statusBreakdown: ctx.statusBreakdown,
        recentRFQs: ctx.recentRFQs?.slice(0, 10),
      },
    };
  }

  if (
    /month|monthly|trend|over time|last 6 months|month over month|mom/i.test(
      qNorm
    )
  ) {
    return {
      answer: buildMonthlyAnswer(ctx),
      source: "deterministic:monthly",
      resolved,
      llmContext: {
        type: "monthly",
        monthlyStats: ctx.monthlyStats?.slice(0, 12),
      },
    };
  }

  if (
    /top vendor|most containers|winning the most|most volume|most spend|vendor performance/i.test(
      qNorm
    ) &&
    !resolved.vendor
  ) {
    return {
      answer: buildTopVendorAnswer(ctx),
      source: "deterministic:top-vendors",
      resolved,
      llmContext: {
        type: "top-vendors",
        vendors: ctx.vendors?.slice(0, 10),
      },
    };
  }

  if (
    /top port|busiest port|port of loading|ports of loading/i.test(qNorm) &&
    !resolved.portOfLoading
  ) {
    return {
      answer: buildTopPortsAnswer(ctx),
      source: "deterministic:top-ports",
      resolved,
      llmContext: {
        type: "top-ports",
        portsOfLoading: ctx.portsOfLoading?.slice(0, 10),
      },
    };
  }

  if (resolved.rfqNumbers?.length) {
    const detail = await fetchRfqDeep(pool, resolved.rfqNumbers[0]);
    if (detail) {
      return {
        answer: buildRfqAnswer(detail),
        source: "deterministic:rfq",
        resolved,
        llmContext: {
          type: "rfq-detail",
          rfqDetail: detail,
        },
      };
    }
  }

  if (resolved.vendor) {
    const detail = await fetchVendorDeep(pool, resolved.vendor.vendorCode);
    if (detail) {
      return {
        answer: buildVendorAnswer(detail),
        source: "deterministic:vendor",
        resolved,
        llmContext: {
          type: "vendor-detail",
          vendorDetail: detail,
        },
      };
    }
  }

  if (
    resolved.portOfLoading &&
    /lane|route|freight|quotes|price|pricing|sea freight|cheapest|lowest|highest|spread|vendor/i.test(
      qNorm
    )
  ) {
    const detail = await fetchLaneDeep(
      pool,
      resolved.portOfLoading.value,
      resolved.containerType?.value || null
    );
    if (detail) {
      return {
        answer: buildLaneAnswer(detail),
        source: "deterministic:lane",
        resolved,
        llmContext: {
          type: "lane-detail",
          laneDetail: detail,
        },
      };
    }
  }

  const keywordFallback = buildKeywordFallbackAnswer(question, ctx);
  if (keywordFallback) {
    return {
      answer: keywordFallback,
      source: "deterministic:keyword-fallback",
      resolved,
      llmContext: {
        type: "keyword-fallback",
        recentRFQs: ctx.recentRFQs?.slice(0, 12),
        recentQuotes: ctx.recentQuotes?.slice(0, 12),
        recentAllocations: ctx.recentAllocations?.slice(0, 12),
      },
    };
  }

  return {
    answer: null,
    source: "no-match",
    resolved,
    llmContext: {
      type: "generic",
      platform: ctx.platform,
      summary: ctx.summary,
      vendors: ctx.vendors?.slice(0, 10),
      portsOfLoading: ctx.portsOfLoading?.slice(0, 10),
      recentRFQs: ctx.recentRFQs?.slice(0, 10),
      laneStats: ctx.laneStats?.slice(0, 10),
    },
  };
}

// GET /api/admin/chat/status — checks Ollama reachability + model availability
app.get(
  "/api/admin/chat/status",
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const r = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 2000 });
      const models = Array.isArray(r.data?.models) ? r.data.models : [];
      const names = models.map((m) => m?.name || "").filter(Boolean);
      const hasModel = names.some(
        (n) => n === OLLAMA_MODEL || n.startsWith(`${OLLAMA_MODEL}:`)
      );
      res.json({
        ok: true,
        reachable: true,
        url: OLLAMA_URL,
        model: OLLAMA_MODEL,
        modelInstalled: hasModel,
        installedModels: names,
      });
    } catch (err) {
      res.json({
        ok: true,
        reachable: false,
        url: OLLAMA_URL,
        model: OLLAMA_MODEL,
        modelInstalled: false,
        installedModels: [],
        error: err?.message || String(err),
        hint:
          "Install Ollama and run `ollama serve`, then `ollama pull " +
          OLLAMA_MODEL +
          "`.",
      });
    }
  }
);

// POST /api/admin/chat/setup — pull the configured model into Ollama
app.post(
  "/api/admin/chat/setup",
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const r = await axios.post(
        `${OLLAMA_URL}/api/pull`,
        { name: OLLAMA_MODEL, stream: false },
        { timeout: 1000 * 60 * 15 }
      );
      res.json({ ok: true, model: OLLAMA_MODEL, result: r.data });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err?.message || "Ollama pull failed",
      });
    }
  }
);

// GET /api/admin/chat/context — return richer dataset + platform semantics
app.get(
  "/api/admin/chat/context",
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const ctx = await buildAnalyticsContext();
      res.json({
        ok: true,
        context: ctx,
        suggestedQuestions: buildSuggestedQuestions(ctx),
      });
    } catch (err) {
      console.error("[CHAT] context failed:", err?.message || err);
      res
        .status(500)
        .json({ ok: false, error: err?.message || "context failed" });
    }
  }
);

// POST /api/admin/chat/ask — deterministic answer first, Ollama phrasing second
app.post(
  "/api/admin/chat/ask",
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const { question, history } = req.body || {};
      if (!question || typeof question !== "string") {
        return res.status(400).json({ ok: false, error: "question required" });
      }

      const pool = await getPool();
      const ctx = await buildAnalyticsContext();
      const deterministic = await answerAnalyticsQuestion(question, ctx, pool);

      let llmAnswer = null;
      let llmSource = null;

      try {
        const tags = await axios.get(`${OLLAMA_URL}/api/tags`, {
          timeout: 1500,
        });
        const models = Array.isArray(tags.data?.models) ? tags.data.models : [];
        const hasModel = models.some(
          (m) =>
            (m?.name || "") === OLLAMA_MODEL ||
            (m?.name || "").startsWith(`${OLLAMA_MODEL}:`)
        );

        if (hasModel) {
          const messages = [];
          const systemPrompt = [
            "You are a CXO-grade logistics analytics assistant for LEAFI.",
            "You MUST answer only from the provided JSON facts.",
            "Do not invent data. Do not add assumptions that are not in the facts.",
            "If the facts are incomplete, say exactly what is missing.",
            "Use plain business language, compact bullets, and direct numbers.",
            "",
            "=== PLATFORM + DATASET FACTS ===",
            JSON.stringify(
              {
                platform: ctx.platform,
                summary: ctx.summary,
                entityCounts: ctx.entityCounts,
                matchedFacts: deterministic.llmContext || null,
                deterministicAnswer: deterministic.answer || null,
              },
              null,
              2
            ),
            "=== END FACTS ===",
          ].join("\n");

          messages.push({ role: "system", content: systemPrompt });

          if (Array.isArray(history)) {
            for (const m of history.slice(-8)) {
              if (
                m &&
                typeof m.content === "string" &&
                (m.role === "user" || m.role === "assistant")
              ) {
                messages.push({ role: m.role, content: m.content });
              }
            }
          }

          messages.push({ role: "user", content: question });

          const r = await axios.post(
            `${OLLAMA_URL}/api/chat`,
            {
              model: OLLAMA_MODEL,
              messages,
              stream: false,
              options: {
                temperature: 0.1,
              },
            },
            { timeout: 1000 * 60 * 2 }
          );

          const maybe = r.data?.message?.content || r.data?.response || "";
          if (maybe && maybe.trim()) {
            llmAnswer = maybe.trim();
            llmSource = OLLAMA_MODEL;
          }
        }
      } catch (err) {
        // Best-effort only. Deterministic answer still returns.
      }

      if (llmAnswer) {
        return res.json({
          ok: true,
          answer: llmAnswer,
          source: `llm:${llmSource}`,
          deterministicSource: deterministic.source,
          matchedEntities: deterministic.resolved,
          contextGeneratedAt: ctx.generatedAt,
        });
      }

      if (deterministic.answer) {
        return res.json({
          ok: true,
          answer: deterministic.answer,
          source: deterministic.source,
          matchedEntities: deterministic.resolved,
          contextGeneratedAt: ctx.generatedAt,
        });
      }

      return res.json({
        ok: true,
        answer: [
          `I could not confidently map that question to an exact metric or entity in the current dataset.`,
          `I can answer well when you mention one or more of these:`,
          `• RFQ number`,
          `• vendor code or vendor name`,
          `• port of loading`,
          `• company`,
          `• container type`,
          `• month or trend`,
          `• open / evaluation / closed status`,
          ``,
          `Examples:`,
          `• "Give me a full summary of RFQ 1047"`,
          `• "How is VENDORA performing?"`,
          `• "What does the data say about Chennai 40HC?"`,
          `• "Which vendor is winning the most volume and spend?"`,
          `• "What does this platform do and what data does it collect?"`,
        ].join("\n"),
        source: "no-match",
        contextGeneratedAt: ctx.generatedAt,
      });
    } catch (err) {
      const message = err?.message || "ask failed";
      console.error("[CHAT] ask failed:", message);
      res.status(500).json({ ok: false, error: message });
    }
  }
);

// Exchange rate endpoint
app.get("/api/rate/usdinr", async (req, res) => {
  try {
    const fx = await getUsdToInrRate();
    res.json({
      rate: fx.rate,
      asOf: fx.asOf,
      source: fx.source,
    });
  } catch (err) {
    console.error("[API] Exchange API error, fallback to 75:", err.message);
    res.json({ rate: USD_INR_FALLBACK_RATE, source: "fallback" });
  }
});

// 404 fallback for unknown API routes (match reference)
app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, error: "API route not found" });
});

// ─────────────────────────────────────────────────────────────────────────────
// FRONTEND STATIC (identical idea to reference)
// ─────────────────────────────────────────────────────────────────────────────
if (fs.existsSync(FRONTEND_DIST_PATH)) {
  console.log("[FE] Serving static files from:", FRONTEND_DIST_PATH);
  app.use(
    express.static(FRONTEND_DIST_PATH, {
      setHeaders(res, filePath) {
        if (filePath.endsWith(".glb")) {
          res.setHeader("Content-Type", "model/gltf-binary");
        }
      },
    })
  );

  // Ensure GLB is served (avoid SPA fallback returning index.html)
  app.get("/fs.glb", (req, res) => {
    const p = path.join(FRONTEND_DIST_PATH, "fs.glb");
    return res.sendFile(p);
  });

  // Serve index at root
  app.get("/", (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST_PATH, "index.html"));
  });

  // SPA fallback (avoid "*" which crashes path-to-regexp in newer stacks)
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST_PATH, "index.html"));
  });
} else {
  console.warn(
    "[FE] Frontend dist folder not found at",
    FRONTEND_DIST_PATH,
    "— build FE before running server."
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// START HTTPS SERVER (match reference)
// ─────────────────────────────────────────────────────────────────────────────
const httpsServer = https.createServer(httpsOptions, app);

httpsServer.listen(APP_PORT, APP_HOST, () => {
  console.log(
    `[LEAFINBOUND] HTTPS server listening on https://${APP_HOST}:${APP_PORT} (env: ${
      process.env.NODE_ENV || "development"
    })`
  );
});

// Warm up DB at boot (like reference behavior)
getPool().catch((err) => {
  console.error("[BOOT] DB warmup failed:", err);
});

const reportScheduler = setInterval(() => {
  void maybeSendDailyAndWeeklyDigests();
}, 60 * 1000);

void maybeSendDailyAndWeeklyDigests();

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN (match reference)
// ─────────────────────────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`[LEAFINBOUND] Received ${signal}, shutting down gracefully...`);
  clearInterval(reportScheduler);
  httpsServer.close(() => {
    console.log("[LEAFINBOUND] HTTPS server closed.");
    if (poolPromise) {
      poolPromise
        .then((pool) => pool.close())
        .then(() => {
          console.log("[MSSQL] Pool closed.");
          process.exit(0);
        })
        .catch((err) => {
          console.error("[MSSQL] Error closing pool", err);
          process.exit(1);
        });
    } else {
      process.exit(0);
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
