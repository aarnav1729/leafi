//import
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const sql = require("mssql");
const axios = require("axios");

//exchange rate API
const EXCHANGE_API_KEY = "d2406e1855e3251be1c691b4";
const EXCHANGE_URL = `https://v6.exchangerate-api.com/v6/${EXCHANGE_API_KEY}/pair/USD/INR`;

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3337;

// Database config
const dbConfig = {
  user: "SPOT_USER",
  password: "Premier#3801",
  server: "10.0.40.10",
  port: 1433,
  database: "SPOT_UAT",
  options: {
    trustServerCertificate: true,
    encrypt: false,
    connectionTimeout: 60000,
  },
};

// outlook emails
const { Client } = require("@microsoft/microsoft-graph-client");
const { ClientSecretCredential } = require("@azure/identity");

// outlook credentials
const CLIENT_ID = "5a58e660-dc7b-49ec-a48c-1fffac02f721";
const CLIENT_SECRET = "6_I8Q~U7IbS~NERqNeszoCRs2kETiO1Yc3cXAaup";
const TENANT_ID = "1c3de7f3-f8d1-41d3-8583-2517cf3ba3b1";
const SENDER_EMAIL = "leaf@premierenergies.com";

// create auth credential & Graph client
const credential = new ClientSecretCredential(
  TENANT_ID,
  CLIENT_ID,
  CLIENT_SECRET
);
const client = Client.initWithMiddleware({
  authProvider: {
    getAccessToken: async () => {
      const tokenResponse = await credential.getToken(
        "https://graph.microsoft.com/.default"
      );
      return tokenResponse.token;
    },
  },
});

app.use(cors());
app.use(express.json());

// --- Basic Auth middleware ---
async function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) return res.sendStatus(401);
  const [username, password] = Buffer.from(auth.split(" ")[1], "base64")
    .toString()
    .split(":");
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool
      .request()
      .input("username", sql.NVarChar, username)
      .input("password", sql.NVarChar, password).query(`
        SELECT id, username, role, name, company
        FROM dbo.Users
        WHERE username=@username AND password=@password
      `);
    if (!result.recordset.length) return res.sendStatus(401);
    req.user = result.recordset[0];
    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.sendStatus(500);
  }
}

// --- DB init & seed ---
async function initDb() {
  try {
    const pool = await sql.connect(dbConfig);
    await pool.request().batch(`
      IF OBJECT_ID('dbo.Users','U') IS NULL
      CREATE TABLE dbo.Users (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        username NVARCHAR(50) NOT NULL UNIQUE,
        password NVARCHAR(255) NOT NULL,
        role NVARCHAR(20) NOT NULL,
        name NVARCHAR(100) NOT NULL,
        company NVARCHAR(100) NULL
      );
      IF OBJECT_ID('dbo.RFQs','U') IS NULL
      CREATE TABLE dbo.RFQs (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        rfqNumber INT NOT NULL UNIQUE,
        itemDescription NVARCHAR(50) NOT NULL,
        companyName NVARCHAR(50) NOT NULL,
        materialPONumber NVARCHAR(100) NOT NULL,
        supplierName NVARCHAR(100) NOT NULL,
        portOfLoading NVARCHAR(50) NOT NULL,
        portOfDestination NVARCHAR(50) NOT NULL,
        containerType NVARCHAR(20) NOT NULL,
        numberOfContainers INT NOT NULL,
        cargoWeight FLOAT NOT NULL,
        cargoReadinessDate DATETIME2 NOT NULL,
        initialQuoteEndTime DATETIME2 NOT NULL,
        evaluationEndTime DATETIME2 NOT NULL,
        description NVARCHAR(500) NULL,
        vendors NVARCHAR(MAX) NOT NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        status NVARCHAR(20) NOT NULL,
        createdBy NVARCHAR(50) NOT NULL
      );
      IF OBJECT_ID('dbo.Quotes','U') IS NULL
      CREATE TABLE dbo.Quotes (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        rfqId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.RFQs(id),
        vendorName NVARCHAR(100) NOT NULL,
        numberOfContainers INT NOT NULL,
        shippingLineName NVARCHAR(100) NOT NULL,
        containerType NVARCHAR(20) NOT NULL,
        vesselName NVARCHAR(100) NOT NULL,
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
        message NVARCHAR(500) NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        containersAllottedHome INT NULL,
        containersAllottedMOOWR INT NULL,
        homeTotal FLOAT NULL,
        mooWRTotal FLOAT NULL
      );
      IF OBJECT_ID('dbo.Allocations','U') IS NULL
      CREATE TABLE dbo.Allocations (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        rfqId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.RFQs(id),
        quoteId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Quotes(id),
        vendorName NVARCHAR(100) NOT NULL,
        containersAllottedHome INT NOT NULL,
        containersAllottedMOOWR INT NOT NULL,
        reason NVARCHAR(500) NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    `);

    // Drop unique constraint on username so we can seed duplicates
    await pool.request().batch(`
      DECLARE @uq VARCHAR(200);
      SELECT @uq = kc.name
      FROM sys.key_constraints kc
      JOIN sys.index_columns ic ON kc.parent_object_id=ic.object_id AND kc.unique_index_id=ic.index_id
      JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
      WHERE kc.parent_object_id=OBJECT_ID('dbo.Users') AND kc.type='UQ' AND c.name='username';
      IF @uq IS NOT NULL EXEC('ALTER TABLE dbo.Users DROP CONSTRAINT [' + @uq + ']');
    `);

    // Seed users once
    await pool.request().batch(`
      IF NOT EXISTS(SELECT 1 FROM dbo.Users WHERE username='aarnav' AND password='aarnav1729')
        INSERT dbo.Users(username,password,role,name) VALUES('aarnav','aarnav1729','logistics','Aarnav');
      IF NOT EXISTS(SELECT 1 FROM dbo.Users WHERE username='nav' AND password='nav')
        INSERT dbo.Users(username,password,role,name,company) VALUES('nav','nav','vendor','Nav','LEAFI');
      IF NOT EXISTS(SELECT 1 FROM dbo.Users WHERE username='aarnav' AND password='aarnav')
        INSERT dbo.Users(username,password,role,name) VALUES('aarnav','aarnav','admin','Aarnav (Admin)');
      IF NOT EXISTS(SELECT 1 FROM dbo.Users WHERE username='van' AND password='van')
        INSERT dbo.Users(username,password,role,name,company) VALUES('van','van','vendor','LEAFO','LEAFO');
    `);

    console.log("✅ DB initialized & users seeded");
  } catch (err) {
    console.error("❌ DB init error:", err);
    process.exit(1);
  }
}

// --- Auth ---
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool
      .request()
      .input("username", sql.NVarChar, username)
      .input("password", sql.NVarChar, password).query(`
        SELECT id,username,role,name,company
        FROM dbo.Users
        WHERE username=@username AND password=@password
      `);
    if (!result.recordset.length) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// --- RFQs ---
app.get("/api/rfqs", authenticate, async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const all = (await pool.request().query("SELECT * FROM dbo.RFQs"))
      .recordset;
    if (req.user.role === "vendor") {
      return res.json(
        all.filter((r) => JSON.parse(r.vendors).includes(req.user.company))
      );
    }
    res.json(all);
  } catch (err) {
    console.error("Fetch RFQs error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/rfqs/:id", authenticate, async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const rfq = (
      await pool
        .request()
        .input("id", sql.UniqueIdentifier, req.params.id)
        .query("SELECT * FROM dbo.RFQs WHERE id=@id")
    ).recordset[0];
    if (!rfq) return res.sendStatus(404);
    res.json(rfq);
  } catch (err) {
    console.error("Fetch RFQ by ID error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

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
    initialQuoteEndTime,
    evaluationEndTime,
    description,
    vendors,
  } = req.body;

  try {
    const pool = await sql.connect(dbConfig);
    const maxRes = await pool
      .request()
      .query("SELECT MAX(rfqNumber) AS maxNum FROM dbo.RFQs");
    const nextNum = (maxRes.recordset[0].maxNum || 1000) + 1;

    // 1) Insert RFQ
    await pool
      .request()
      .input("rfqNumber", sql.Int, nextNum)
      .input("itemDescription", sql.NVarChar, itemDescription)
      .input("companyName", sql.NVarChar, companyName)
      .input("materialPONumber", sql.NVarChar, materialPONumber)
      .input("supplierName", sql.NVarChar, supplierName)
      .input("portOfLoading", sql.NVarChar, portOfLoading)
      .input("portOfDestination", sql.NVarChar, portOfDestination)
      .input("containerType", sql.NVarChar, containerType)
      .input("numberOfContainers", sql.Int, numberOfContainers)
      .input("cargoWeight", sql.Float, cargoWeight)
      .input("cargoReadinessDate", sql.DateTime2, cargoReadinessDate)
      .input("initialQuoteEndTime", sql.DateTime2, initialQuoteEndTime)
      .input("evaluationEndTime", sql.DateTime2, evaluationEndTime)
      .input("description", sql.NVarChar, description)
      .input("vendors", sql.NVarChar, JSON.stringify(vendors))
      .input("status", sql.NVarChar, "initial")
      .input("createdBy", sql.NVarChar, req.user.username).query(`
        INSERT INTO dbo.RFQs
          (rfqNumber, itemDescription, companyName, materialPONumber,
           supplierName, portOfLoading, portOfDestination, containerType,
           numberOfContainers, cargoWeight, cargoReadinessDate,
           initialQuoteEndTime, evaluationEndTime, description, vendors,
           status, createdBy, createdAt)
        VALUES
          (@rfqNumber,@itemDescription,@companyName,@materialPONumber,
           @supplierName,@portOfLoading,@portOfDestination,@containerType,
           @numberOfContainers,@cargoWeight,@cargoReadinessDate,
           @initialQuoteEndTime,@evaluationEndTime,@description,@vendors,
           @status,@createdBy,SYSUTCDATETIME())
      `);

    // 2) Fetch vendor emails
    const companyParams = vendors.map((v, i) => `@company${i}`).join(", ");
    let request = pool.request();
    vendors.forEach((v, i) => request.input(`company${i}`, sql.NVarChar, v));
    const emailRes = await request.query(`
      SELECT username AS email
      FROM dbo.Users
      WHERE role='vendor' AND company IN (${companyParams})
    `);
    const emails = emailRes.recordset.map((r) => r.email);

    // 3) Build HTML table with RFQ details
    const tableRows = [
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
      [
        "Initial Quote End Time",
        new Date(initialQuoteEndTime).toLocaleString(),
      ],
      ["Evaluation End Time", new Date(evaluationEndTime).toLocaleString()],
      ["Description", description || ""],
    ];
    const tableHtml = `
      <table border="1" cellpadding="5" cellspacing="0">
        <tr><th align="left">Field</th><th align="left">Value</th></tr>
        ${tableRows
          .map(([f, v]) => `<tr><td>${f}</td><td>${v}</td></tr>`)
          .join("")}
      </table>
    `;

    // 4) Send email to each vendor
    await Promise.all(
      emails.map((email) =>
        client.api(`/users/${SENDER_EMAIL}/sendMail`).post({
          message: {
            subject: `New RFQ Created: ${nextNum}`,
            body: {
              contentType: "HTML",
              content: `
              <p>Dear Vendor,</p>
              <p>A new RFQ has been created with the following details:</p>
              ${tableHtml}
              <p>View and respond here: <a href="https://leafi.premierenergiesphotovoltaic.com">leafi.premierenergiesphotovoltaic.com</a></p>
              <p>Thanks & Regards,<br/>LEAFI Team</p>
            `,
            },
            toRecipients: [{ emailAddress: { address: email } }],
          },
          saveToSentItems: true,
        })
      )
    );

    res.json({ message: "RFQ created", rfqNumber: nextNum });
  } catch (err) {
    console.error("Create RFQ error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// --- Quotes ---
app.get("/api/quotes/:rfqId", authenticate, async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const quotes = (
      await pool
        .request()
        .input("rfqId", sql.UniqueIdentifier, req.params.rfqId)
        .query("SELECT * FROM dbo.Quotes WHERE rfqId=@rfqId")
    ).recordset;
    res.json(quotes);
  } catch (err) {
    console.error("Fetch quotes error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/quotes", authenticate, async (req, res) => {
  if (req.user.role !== "vendor") return res.sendStatus(403);
  const d = req.body;
  try {
    const pool = await sql.connect(dbConfig);

    // 1) Fetch live USD→INR rate (fallback to 75 on error)
    let USD_TO_INR;
    try {
      const rateRes = await axios.get(EXCHANGE_URL);
      USD_TO_INR = rateRes.data.conversion_rate;
    } catch (apiErr) {
      console.error("Exchange API error:", apiErr);
    }

    // 1) Compute totals
    const seaInINR = d.seaFreightPerContainer * USD_TO_INR;
    const homeTotal =
      seaInINR +
      d.houseDeliveryOrderPerBOL +
      d.cfsPerContainer +
      d.transportationPerContainer +
      d.ediChargesPerBOE +
      d.chaChargesHome;
    const mooWRTotal =
      homeTotal + d.mooWRReeWarehousingCharges + d.chaChargesMOOWR;

    // 2) Insert or update quote
    // Here we assume INSERT for initial submission; adapt to UPSERT if needed
    await pool
      .request()
      .input("rfqId", sql.UniqueIdentifier, d.rfqId)
      .input("vendorName", sql.NVarChar, req.user.company)
      .input("numberOfContainers", sql.Int, d.numberOfContainers)
      .input("shippingLineName", sql.NVarChar, d.shippingLineName)
      .input("containerType", sql.NVarChar, d.containerType)
      .input("vesselName", sql.NVarChar, d.vesselName)
      .input("vesselETD", sql.DateTime2, d.vesselETD)
      .input("vesselETA", sql.DateTime2, d.vesselETA)
      .input("seaFreightPerContainer", sql.Float, d.seaFreightPerContainer)
      .input("houseDeliveryOrderPerBOL", sql.Float, d.houseDeliveryOrderPerBOL)
      .input("cfsPerContainer", sql.Float, d.cfsPerContainer)
      .input(
        "transportationPerContainer",
        sql.Float,
        d.transportationPerContainer
      )
      .input("chaChargesHome", sql.Float, d.chaChargesHome)
      .input("chaChargesMOOWR", sql.Float, d.chaChargesMOOWR)
      .input("ediChargesPerBOE", sql.Float, d.ediChargesPerBOE)
      .input(
        "mooWRReeWarehousingCharges",
        sql.Float,
        d.mooWRReeWarehousingCharges
      )
      .input("transshipOrDirect", sql.NVarChar, d.transshipOrDirect)
      .input("quoteValidityDate", sql.DateTime2, d.quoteValidityDate)
      .input("message", sql.NVarChar, d.message)
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

    // 3) Update RFQ status if initial
    await pool
      .request()
      .input("rfqId", sql.UniqueIdentifier, d.rfqId)
      .query(
        `UPDATE dbo.RFQs SET status='evaluation' WHERE id=@rfqId AND status='initial'`
      );

    // 4) Fetch RFQ details
    const rfqRes = await pool
      .request()
      .input("id", sql.UniqueIdentifier, d.rfqId).query(`
        SELECT rfqNumber, itemDescription, companyName, materialPONumber,
               supplierName, portOfLoading, portOfDestination, containerType,
               numberOfContainers, cargoWeight, cargoReadinessDate,
               initialQuoteEndTime, evaluationEndTime, description
        FROM dbo.RFQs
        WHERE id=@id
      `);
    const rfq = rfqRes.recordset[0];

    // 5) Build HTML tables
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
      [
        "Initial Quote End Time",
        new Date(rfq.initialQuoteEndTime).toLocaleString(),
      ],
      ["Evaluation End Time", new Date(rfq.evaluationEndTime).toLocaleString()],
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
      ["Sea Freight (per container)", d.seaFreightPerContainer],
      ["HDO per BOL", d.houseDeliveryOrderPerBOL],
      ["CFS per container", d.cfsPerContainer],
      ["Transportation per container", d.transportationPerContainer],
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
        ${rows.map(([f, v]) => `<tr><td>${f}</td><td>${v}</td></tr>`).join("")}
      </table>
    `;
    const rfqTable = makeTable(rfqRows);
    const quoteTable = makeTable(quoteRows);

    // 6) Send notification email
    await client.api(`/users/${SENDER_EMAIL}/sendMail`).post({
      message: {
        subject: `Quote Submitted for RFQ ${rfq.rfqNumber}`,
        body: {
          contentType: "HTML",
          content: `
              <p>Hello LEAFI Team,</p>
              <p>A vendor has submitted/updated a quote. See details below:</p>
              <h4>RFQ Details</h4>
              ${rfqTable}
              <h4>Quote Details</h4>
              ${quoteTable}
              <p>Thanks & Regards,<br/>LEAFI System</p>
            `,
        },
        toRecipients: [
          { emailAddress: { address: "leaf@premierenergies.com" } },
        ],
      },
      saveToSentItems: true,
    });

    // 7) Respond
    res.json({ message: "Quote submitted and notification sent" });
  } catch (err) {
    console.error("Submit quote error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// --- Allocations ---
app.post("/api/allocations", authenticate, async (req, res) => {
  if (req.user.role !== "logistics") return res.sendStatus(403);
  const {
    rfqId,
    quoteId,
    vendorName,
    containersAllottedHome,
    containersAllottedMOOWR,
    reason,
  } = req.body;

  try {
    const pool = await sql.connect(dbConfig);

    // 1) Insert allocation
    await pool
      .request()
      .input("rfqId", sql.UniqueIdentifier, rfqId)
      .input("quoteId", sql.UniqueIdentifier, quoteId)
      .input("vendorName", sql.NVarChar, vendorName)
      .input("containersAllottedHome", sql.Int, containersAllottedHome)
      .input("containersAllottedMOOWR", sql.Int, containersAllottedMOOWR)
      .input("reason", sql.NVarChar, reason).query(`
        INSERT INTO dbo.Allocations
          (rfqId, quoteId, vendorName, containersAllottedHome, containersAllottedMOOWR, reason, createdAt)
        VALUES
          (@rfqId, @quoteId, @vendorName, @containersAllottedHome, @containersAllottedMOOWR, @reason, SYSUTCDATETIME())
      `);

    // 2) Sum total allocated so far
    const sumRes = await pool
      .request()
      .input("rfqId", sql.UniqueIdentifier, rfqId).query(`
        SELECT SUM(containersAllottedHome + containersAllottedMOOWR) AS total
        FROM dbo.Allocations
        WHERE rfqId = @rfqId
      `);
    const totalAllocated = sumRes.recordset[0].total || 0;

    // 3) Fetch RFQ’s required total and details
    const rfqRes = await pool
      .request()
      .input("rfqId", sql.UniqueIdentifier, rfqId).query(`
        SELECT
          rfqNumber, itemDescription, companyName, materialPONumber,
          supplierName, portOfLoading, portOfDestination, containerType,
          numberOfContainers, cargoWeight, cargoReadinessDate,
          initialQuoteEndTime, evaluationEndTime, description
        FROM dbo.RFQs
        WHERE id = @rfqId
      `);
    const rfq = rfqRes.recordset[0];

    // 4) Fetch this vendor’s quote details
    const quoteRes = await pool
      .request()
      .input("rfqId", sql.UniqueIdentifier, rfqId)
      .input("vendorName", sql.NVarChar, vendorName).query(`
        SELECT
          numberOfContainers, shippingLineName, containerType,
          vesselName, vesselETD, vesselETA, seaFreightPerContainer,
          houseDeliveryOrderPerBOL, cfsPerContainer, transportationPerContainer,
          chaChargesHome, chaChargesMOOWR, ediChargesPerBOE,
          mooWRReeWarehousingCharges, transshipOrDirect,
          quoteValidityDate, message, homeTotal, mooWRTotal
        FROM dbo.Quotes
        WHERE rfqId = @rfqId AND vendorName = @vendorName
        ORDER BY createdAt DESC
      `);
    const quote = quoteRes.recordset[0];

    // 5) Get the vendor’s email
    const emailRes = await pool
      .request()
      .input("company", sql.NVarChar, vendorName).query(`
        SELECT username AS email
        FROM dbo.Users
        WHERE company = @company
      `);
    const vendorEmail = emailRes.recordset[0]?.email;

    // 6) Close RFQ if fully allocated
    if (totalAllocated >= rfq.numberOfContainers) {
      await pool.request().input("rfqId", sql.UniqueIdentifier, rfqId).query(`
          UPDATE dbo.RFQs
          SET status = 'closed'
          WHERE id = @rfqId
        `);
    }

    // 7) Build HTML tables
    const makeTable = (rows) => `
      <table border="1" cellpadding="5" cellspacing="0">
        <tr><th align="left">Field</th><th align="left">Value</th></tr>
        ${rows.map(([f, v]) => `<tr><td>${f}</td><td>${v}</td></tr>`).join("")}
      </table>
    `;

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
      [
        "Initial Quote End Time",
        new Date(rfq.initialQuoteEndTime).toLocaleString(),
      ],
      ["Evaluation End Time", new Date(rfq.evaluationEndTime).toLocaleString()],
      ["Description", rfq.description || ""],
    ];

    const quoteRows = [
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
      ["Reason", reason],
    ];

    const rfqTable = makeTable(rfqRows);
    const quoteTable = makeTable(quoteRows);
    const finalTable = makeTable(finalRows);

    // 8) Send notification email
    await client.api(`/users/${SENDER_EMAIL}/sendMail`).post({
      message: {
        subject: `RFQ ${rfq.rfqNumber} Finalized for ${vendorName}`,
        body: {
          contentType: "HTML",
          content: `
              <p>Hello,</p>
              <p>The following RFQ has been finalized/allocated:</p>
              <h4>RFQ Details</h4>${rfqTable}
              <h4>Quote Details</h4>${quoteTable}
              <h4>Finalization Details</h4>${finalTable}
              <p>Thanks & Regards,<br/>LEAFI Team</p>
            `,
        },
        toRecipients: [
          { emailAddress: { address: "leaf@premierenergies.com" } },
          { emailAddress: { address: vendorEmail } },
          { emailAddress: { address: "ramanjulu@premierenergies.com" } },
        ],
      },
      saveToSentItems: true,
    });

    // 9) Respond
    res.json({
      message: "Allocation recorded and notifications sent",
      totalAllocated,
    });
  } catch (err) {
    console.error("Allocation/finalization error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Returns all Users with role = 'vendor'
app.get("/api/vendors", authenticate, async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query(`
        SELECT username, name, company
        FROM dbo.Users
        WHERE role = 'vendor'
      `);
    // e.g. [{ username: 'nav', name: 'Nav', company: 'LEAFI' }, ...]
    res.json(result.recordset);
  } catch (err) {
    console.error("Fetch vendors error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Return all allocations for a single RFQ  ← NEW  (front-end relies on it)
app.get("/api/allocations/:rfqId", authenticate, async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool
      .request()
      .input("rfqId", sql.UniqueIdentifier, req.params.rfqId)
      .query("SELECT * FROM dbo.Allocations WHERE rfqId=@rfqId");
    res.json(result.recordset);
  } catch (err) {
    console.error("Fetch allocations error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/rate/usdinr", async (req, res) => {
  try {
    const resp = await axios.get(EXCHANGE_URL);
    console.log("🔄 Live USD→INR fetched:", resp.data.conversion_rate);
    return res.json({ rate: resp.data.conversion_rate });
  } catch (err) {
    console.error("⚠️ Exchange API error, falling back to 75 →", err.message);
    return res.json({ rate: 75 });
  }
});

// Start
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server listening on http://localhost:${PORT}`);
  });
});
