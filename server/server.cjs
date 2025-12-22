"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const sql = require("mssql");
const axios = require("axios");

const crypto = require("crypto");

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

const APP_PORT = Number(process.env.PORT || 30443);
const APP_HOST = process.env.HOST || "0.0.0.0";

// ─────────────────────────────────────────────────────────────────────────────
// DB config (same structure as reference; env override allowed)
// ─────────────────────────────────────────────────────────────────────────────
const dbConfig = {
  user: process.env.DB_USER || "PEL_DB",
  password: process.env.DB_PASSWORD || "Pel@0184",
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
// ─────────────────────────────────────────────────────────────────────────────
const EXCHANGE_API_KEY =
  process.env.EXCHANGE_API_KEY || "d2406e1855e3251be1c691b4";
const EXCHANGE_URL = `https://v6.exchangerate-api.com/v6/${EXCHANGE_API_KEY}/pair/USD/INR`;

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
    numberOfContainers INT NOT NULL,
    cargoWeight FLOAT NOT NULL,
    cargoReadinessDate DATETIME2 NOT NULL,

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
    isActive BIT NOT NULL CONSTRAINT DF_Master_CompanyNames_isActive DEFAULT (1),
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_Master_CompanyNames_createdAt DEFAULT SYSUTCDATETIME(),
    updatedAt DATETIME2 NULL
  );
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
    isActive BIT NOT NULL CONSTRAINT DF_Master_PortsOfLoading_isActive DEFAULT (1),
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_Master_PortsOfLoading_createdAt DEFAULT SYSUTCDATETIME(),
    updatedAt DATETIME2 NULL
  );
  CREATE UNIQUE NONCLUSTERED INDEX UQ_Master_PortsOfLoading_value ON dbo.Master_PortsOfLoading(value);
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
`;
  console.log("[DB] Seeding users (insert-only)...");
  await pool.request().batch(seedSql);
  console.log("[DB] User seed done.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
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

const MASTER = {
  itemDescriptions: { table: "dbo.Master_ItemDescriptions", max: 500 },
  companyNames: { table: "dbo.Master_CompanyNames", max: sql.MAX },
  suppliers: { table: "dbo.Master_Suppliers", max: 255 },
  portsOfLoading: { table: "dbo.Master_PortsOfLoading", max: 100 },
  portsOfDestination: { table: "dbo.Master_PortsOfDestination", max: 100 },
  containerTypes: { table: "dbo.Master_ContainerTypes", max: 50 },
};

function getMasterDef(key) {
  return MASTER[key] || null;
}

async function ensureMasterValue(pool, key, value) {
  const def = getMasterDef(key);
  if (!def) return;
  const v = String(value || "").trim();
  if (!v) return;

  const req = pool.request();
  if (def.max === sql.MAX) req.input("v", sql.NVarChar(sql.MAX), v);
  else req.input("v", sql.NVarChar(def.max), v);

  // insert-only (do not change isActive if exists)
  await req.query(`
    IF NOT EXISTS (SELECT 1 FROM ${def.table} WHERE value = @v)
    BEGIN
      INSERT INTO ${def.table}(value, isActive, createdAt)
      VALUES (@v, 1, SYSUTCDATETIME());
    END
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// App & Middleware (match reference style)
// ─────────────────────────────────────────────────────────────────────────────
const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
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
  if (!creds) return res.sendStatus(401);

  // 1) NEW: session-token auth (token is sent as BasicAuth password)
  const session = sessionStore.get(creds.password);
  if (session) {
    if (Date.now() > session.expiresAt) {
      sessionStore.delete(creds.password);
      return res.sendStatus(401);
    }
    // Ensure username matches the logged-in user
    if (
      String(session.user?.username || "").toLowerCase() !==
      String(creds.username || "").toLowerCase()
    ) {
      return res.sendStatus(401);
    }
    req.user = session.user;
    return next();
  }

  // 2) fallback legacy: username+password from DB (optional compatibility)

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

    // Ensure user exists
    const userRes = await pool
      .request()
      .input("username", sql.NVarChar, username).query(`
        SELECT TOP 1 id, username, role, name, company
        FROM dbo.Users
        WHERE username = @username
      `);

    if (!userRes.recordset.length) {
      return res.status(401).json({ message: "User not found" });
    }

    const user = userRes.recordset[0];

    // STEP 1: request OTP (password empty)
    if (!password) {
      const otp = genOtp4();
      otpStore.set(String(username).toLowerCase(), {
        otp,
        expiresAt: Date.now() + OTP_TTL_MS,
      });

      // MVP: show OTP in console only
      console.log(`[OTP] ${username} -> ${otp} (valid ${OTP_TTL_MS / 1000}s)`);

      return res.json({ ok: true, step: "otp_sent" });
    }

    // STEP 2: verify OTP (password is OTP)
    const rec = otpStore.get(String(username).toLowerCase());
    if (!rec || Date.now() > rec.expiresAt) {
      otpStore.delete(String(username).toLowerCase());
      return res.status(401).json({ message: "OTP expired. Request again." });
    }

    if (String(password) !== String(rec.otp)) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    otpStore.delete(String(username).toLowerCase());

    // Create session token (used as BasicAuth password for all subsequent API calls)
    const sessionToken = genSessionToken();
    sessionStore.set(sessionToken, {
      user,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    return res.json({ ok: true, step: "authenticated", user, sessionToken });
  } catch (err) {
    console.error("[API] /api/login error:", err);
    res.status(500).json({ message: "Server error" });
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

    async function fetchSimple(table, valueType = sql.NVarChar) {
      const r = await pool.request().query(`
        SELECT
          CAST(id AS NVARCHAR(50)) AS id,
          CAST([value] AS NVARCHAR(MAX)) AS [value]
        FROM ${table}
        WHERE ISNULL(isActive, 1) = 1
        ORDER BY [value] ASC
      `);
      return r.recordset || [];
    }

    // CompanyNames can have duplicates (no unique index), so return DISTINCT by value
    async function fetchCompanyNamesDistinct() {
      const r = await pool.request().query(`
        SELECT
          MIN(CAST(id AS NVARCHAR(50))) AS id,
          CAST([value] AS NVARCHAR(MAX)) AS [value]
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
    ] = await Promise.all([
      fetchSimple("dbo.Master_ItemDescriptions"),
      fetchCompanyNamesDistinct(),
      fetchSimple("dbo.Master_Suppliers"),
      fetchSimple("dbo.Master_PortsOfLoading"),
      fetchSimple("dbo.Master_PortsOfDestination"),
      fetchSimple("dbo.Master_ContainerTypes"),
    ]);

    return res.json({
      itemDescriptions,
      companyNames,
      suppliers,
      portsOfLoading,
      portsOfDestination,
      containerTypes,
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

// Create RFQ (logistics only)
app.post("/api/rfqs", authenticate, async (req, res) => {
  if (req.user.role !== "logistics") return res.sendStatus(403);

  const {
    itemDescription,
    companyName,
    materialPONumber,
    supplierName,
    portOfLoading,
    portOfDestination,
    containerType,
    numberOfContainers,
    cargoWeight,
    cargoReadinessDate,
    description,
    vendors,
    attachments,
  } = req.body || {};

  if (
    !itemDescription ||
    !companyName ||
    !materialPONumber ||
    !supplierName ||
    !portOfLoading ||
    !portOfDestination ||
    !containerType ||
    !numberOfContainers ||
    !cargoWeight ||
    !cargoReadinessDate ||
    !Array.isArray(vendors) ||
    vendors.length === 0
  ) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const safeAttachments = Array.isArray(attachments) ? attachments : [];

  try {
    const pool = await getPool();

    // keep masters in sync (insert-only) so RFQ creation never breaks
    await ensureMasterValue(pool, "itemDescriptions", itemDescription);
    await ensureMasterValue(pool, "companyNames", companyName);
    await ensureMasterValue(pool, "suppliers", supplierName);
    await ensureMasterValue(pool, "portsOfLoading", portOfLoading);
    await ensureMasterValue(pool, "portsOfDestination", portOfDestination);
    await ensureMasterValue(pool, "containerTypes", containerType);

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

      .input("numberOfContainers", sql.Int, Number(numberOfContainers))
      .input("cargoWeight", sql.Float, Number(cargoWeight))
      .input("cargoReadinessDate", sql.DateTime2, cargoReadinessDate)
      .input(
        "attachments",
        sql.NVarChar(sql.MAX),
        safeAttachments.length ? JSON.stringify(safeAttachments) : null
      )

      .input("description", sql.NVarChar(1000), description || null)
      .input("vendors", sql.NVarChar(sql.MAX), JSON.stringify(vendors))

      .input("status", sql.NVarChar, "initial")
      .input("createdBy", sql.NVarChar(100), req.user.username).query(`
INSERT INTO dbo.RFQs
  (rfqNumber, itemDescription, companyName, materialPONumber,
   supplierName, portOfLoading, portOfDestination, containerType,
   numberOfContainers, cargoWeight, cargoReadinessDate, description, attachments, vendors,
   status, createdBy, createdAt)
VALUES
  (@rfqNumber, @itemDescription, @companyName, @materialPONumber,
   @supplierName, @portOfLoading, @portOfDestination, @containerType,
   @numberOfContainers, @cargoWeight, @cargoReadinessDate, @description, @attachments, @vendors,
   @status, @createdBy, SYSUTCDATETIME())

      `);

    // fetch vendor emails
    const companyParams = vendors.map((_, i) => `@c${i}`).join(", ");
    let req2 = pool.request();
    vendors.forEach((c, i) => req2.input(`c${i}`, sql.NVarChar, c));
    const emRes = await req2.query(`
      SELECT username AS email
      FROM dbo.Users
      WHERE role = 'vendor' AND company IN (${companyParams})
    `);
    const emails = (emRes.recordset || []).map((r) => r.email).filter(Boolean);

    // build HTML table
    const rows = [
      ["RFQ Number", nextNum],
      ["Item Description", itemDescription],
      ["Company Name", companyName],
      ["Material PO Number", materialPONumber],
      ["Supplier Name", supplierName],
      ["Port of Loading", portOfLoading],
      ["Port of Destination", portOfDestination],
      ["Container Type", containerType],
      ["Number of Containers", numberOfContainers],
      ["Cargo Weight", cargoWeight],
      ["Cargo Readiness Date", new Date(cargoReadinessDate).toLocaleString()],

      ["Description", description || ""],
      [
        "Attachments",
        safeAttachments.length ? `${safeAttachments.length} file(s)` : "0",
      ],
    ];

    const tableHtml = `
      <table border="1" cellpadding="5" cellspacing="0">
        <tr><th align="left">Field</th><th align="left">Value</th></tr>
        ${rows.map(([f, v]) => `<tr><td>${f}</td><td>${v}</td></tr>`).join("")}
      </table>
    `;

    // notify vendors (best-effort) — NEVER fail RFQ creation if email fails
    if (emails.length) {
      try {
        await Promise.all(
          emails.map((email) =>
            graphClient.api(`/users/${SENDER_EMAIL}/sendMail`).post({
              message: {
                subject: `New RFQ Created: ${nextNum}`,
                body: {
                  contentType: "HTML",
                  content: `
                    <p>Dear Vendor,</p>
                    <p>A new RFQ has been created:</p>
                    ${tableHtml}
                    <p>Respond at <a href="https://leafi.premierenergies.com">LEAFI Portal</a></p>
                    <p>Regards,<br/>LEAFI Team</p>
                  `,
                },
                toRecipients: [{ emailAddress: { address: email } }],
              },
              saveToSentItems: true,
            })
          )
        );
      } catch (e) {
        console.error("[GRAPH] sendMail failed (ignored):", e?.message || e);
      }
    }

    res.json({ message: "RFQ created", rfqNumber: nextNum });
  } catch (err) {
    console.error("[API] Create RFQ error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// List quotes for RFQ
app.get("/api/quotes/:rfqId", authenticate, async (req, res) => {
  try {
    const pool = await getPool();
    const quotes = (
      await pool
        .request()
        .input("rfqId", sql.UniqueIdentifier, req.params.rfqId)
        .query("SELECT * FROM dbo.Quotes WHERE rfqId = @rfqId")
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
          SELECT TOP 1 *
          FROM dbo.Quotes
          WHERE rfqId = @rfqId AND vendorName = @vendorName
          ORDER BY createdAt DESC
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

    // fetch live USD→INR
    let USD_TO_INR = 75;
    try {
      const rateRes = await axios.get(EXCHANGE_URL);
      USD_TO_INR = Number(rateRes.data?.conversion_rate || 75);
    } catch (e) {
      console.error("[FX] Exchange API failed, using fallback 75:", e.message);
    }

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

    await pool
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
      .input("mooWRTotal", sql.Float, mooWRTotal).query(`
        INSERT INTO dbo.Quotes
          (rfqId, vendorName, numberOfContainers, shippingLineName, containerType,
           vesselName, vesselETD, vesselETA, seaFreightPerContainer,
           houseDeliveryOrderPerBOL, cfsPerContainer, transportationPerContainer,
           chaChargesHome, chaChargesMOOWR, ediChargesPerBOE,
           mooWRReeWarehousingCharges, transshipOrDirect, quoteValidityDate,
           message, createdAt, homeTotal, mooWRTotal)
        VALUES
          (@rfqId, @vendorName, @numberOfContainers, @shippingLineName, @containerType,
           @vesselName, @vesselETD, @vesselETA, @seaFreightPerContainer,
           @houseDeliveryOrderPerBOL, @cfsPerContainer, @transportationPerContainer,
           @chaChargesHome, @chaChargesMOOWR, @ediChargesPerBOE,
           @mooWRReeWarehousingCharges, @transshipOrDirect, @quoteValidityDate,
           @message, SYSUTCDATETIME(), @homeTotal, @mooWRTotal)
      `);

    // bump RFQ status
    await pool.request().input("rfqId", sql.UniqueIdentifier, d.rfqId).query(`
        UPDATE dbo.RFQs
        SET status = 'evaluation'
        WHERE id = @rfqId AND status = 'initial'
      `);

    // fetch RFQ for email
    const rfqRes = await pool
      .request()
      .input("id", sql.UniqueIdentifier, d.rfqId).query(`
        SELECT rfqNumber, itemDescription, companyName, materialPONumber,
               supplierName, portOfLoading, portOfDestination, containerType,
               numberOfContainers, cargoWeight, cargoReadinessDate,
               description
        FROM dbo.RFQs
        WHERE id = @id
      `);
    const rfq = rfqRes.recordset[0];

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

      await graphClient.api(`/users/${SENDER_EMAIL}/sendMail`).post({
        message: {
          subject: `Quote Submitted for RFQ ${rfq.rfqNumber}`,
          body: {
            contentType: "HTML",
            content: `
              <p>Hello LEAFI Team,</p>
              <h4>RFQ Details</h4>
              ${makeTable(rfqRows)}
              <h4>Quote Details</h4>
              ${makeTable(quoteRows)}
              <p>Regards,<br/>LEAFI System</p>
            `,
          },
          toRecipients: [{ emailAddress: { address: SENDER_EMAIL } }],
        },
        saveToSentItems: true,
      });
    }

    res.json({ message: "Quote submitted and notification sent" });
  } catch (err) {
    console.error("[API] Submit quote error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Allocate containers (logistics only)
app.post("/api/allocations", authenticate, async (req, res) => {
  if (req.user.role !== "logistics") return res.sendStatus(403);

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
               supplierName, portOfLoading, portOfDestination, containerType,
               numberOfContainers, cargoWeight, cargoReadinessDate,
               description
        FROM dbo.RFQs
        WHERE id = @rfqId
      `);
    const rfq = rfqRes.recordset[0];

    const quoteRes = await pool
      .request()
      .input("rfqId", sql.UniqueIdentifier, rfqId)
      .input("vendorName", sql.NVarChar, vendorName).query(`
        SELECT TOP 1 *
        FROM dbo.Quotes
        WHERE rfqId = @rfqId AND vendorName = @vendorName
        ORDER BY createdAt DESC
      `);
    const quote = quoteRes.recordset[0];

    const emailRes = await pool
      .request()
      .input("company", sql.NVarChar, vendorName).query(`
        SELECT TOP 1 username AS email
        FROM dbo.Users
        WHERE company = @company
      `);
    const vendorEmail = emailRes.recordset[0]?.email;

    if (rfq && totalAllocated >= Number(rfq.numberOfContainers || 0)) {
      await pool.request().input("rfqId", sql.UniqueIdentifier, rfqId).query(`
          UPDATE dbo.RFQs
          SET status = 'closed'
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

      await graphClient.api(`/users/${SENDER_EMAIL}/sendMail`).post({
        message: {
          subject: `RFQ ${rfq.rfqNumber} Finalized for ${vendorName}`,
          body: {
            contentType: "HTML",
            content: `
              <p>Hello,</p>
              <h4>RFQ Details</h4>${makeTbl(rfqRows)}
              <h4>Quote Details</h4>${makeTbl(quoteRows2)}
              <h4>Finalization Details</h4>${makeTbl(finalRows)}
              <p>Regards,<br/>LEAFI Team</p>
            `,
          },
          toRecipients: [
            { emailAddress: { address: SENDER_EMAIL } },
            ...(vendorEmail
              ? [{ emailAddress: { address: vendorEmail } }]
              : []),
            { emailAddress: { address: "ramanjulu@premierenergies.com" } },
          ],
        },
        saveToSentItems: true,
      });
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
    ]);
  }
);

// Admin CRUD for master dropdowns
app.get(
  "/api/admin/masters/:key",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const def = getMasterDef(req.params.key);
    if (!def) return res.status(400).json({ message: "Invalid master key" });

    try {
      const pool = await getPool();
      const rows = (
        await pool.request().query(`
        SELECT id, value, isActive, createdAt, updatedAt
        FROM ${def.table}
        ORDER BY value
      `)
      ).recordset;
      res.json(rows || []);
    } catch (err) {
      console.error("[API] admin list master error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

app.post(
  "/api/admin/masters/:key",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const def = getMasterDef(req.params.key);
    if (!def) return res.status(400).json({ message: "Invalid master key" });

    const { value, isActive } = req.body || {};
    const v = String(value || "").trim();
    if (!v) return res.status(400).json({ message: "value required" });

    try {
      const pool = await getPool();
      const r = pool.request();
      if (def.max === sql.MAX) r.input("value", sql.NVarChar(sql.MAX), v);
      else r.input("value", sql.NVarChar(def.max), v);
      r.input(
        "isActive",
        sql.Bit,
        typeof isActive === "boolean" ? isActive : true
      );

      await r.query(`
      INSERT INTO ${def.table}(value, isActive, createdAt)
      VALUES (@value, @isActive, SYSUTCDATETIME())
    `);

      res.json({ ok: true });
    } catch (err) {
      console.error("[API] admin create master error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

app.put(
  "/api/admin/masters/:key/:id",
  authenticate,
  requireAdminOrLogistics,
  async (req, res) => {
    const def = getMasterDef(req.params.key);
    if (!def) return res.status(400).json({ message: "Invalid master key" });

    const { value, isActive } = req.body || {};
    const hasValue = typeof value === "string";
    const hasActive = typeof isActive === "boolean";
    if (!hasValue && !hasActive) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    try {
      const pool = await getPool();
      const r = pool.request().input("id", sql.UniqueIdentifier, req.params.id);

      let sets = [];
      if (hasValue) {
        const v = String(value || "").trim();
        if (!v)
          return res.status(400).json({ message: "value cannot be empty" });
        if (def.max === sql.MAX) r.input("value", sql.NVarChar(sql.MAX), v);
        else r.input("value", sql.NVarChar(def.max), v);
        sets.push("value = @value");
      }
      if (hasActive) {
        r.input("isActive", sql.Bit, isActive);
        sets.push("isActive = @isActive");
      }
      sets.push("updatedAt = SYSUTCDATETIME()");

      await r.query(`
      UPDATE ${def.table}
      SET ${sets.join(", ")}
      WHERE id = @id
    `);

      res.json({ ok: true });
    } catch (err) {
      console.error("[API] admin update master error:", err);
      res.status(500).json({ message: "Server error" });
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
app.get("/api/vendors", authenticate, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT username, name, company
      FROM dbo.Users
      WHERE role = 'vendor'
    `);
    res.json(result.recordset);
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

// Exchange rate endpoint
app.get("/api/rate/usdinr", async (req, res) => {
  try {
    const resp = await axios.get(EXCHANGE_URL);
    res.json({ rate: Number(resp.data?.conversion_rate || 75) });
  } catch (err) {
    console.error("[API] Exchange API error, fallback to 75:", err.message);
    res.json({ rate: 75 });
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
  app.use(express.static(FRONTEND_DIST_PATH));

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

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN (match reference)
// ─────────────────────────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`[LEAFINBOUND] Received ${signal}, shutting down gracefully...`);
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
