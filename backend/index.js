// import all required modules
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const cron = require("node-cron");
const moment = require("moment-timezone");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

// outlook emails
const { Client } = require("@microsoft/microsoft-graph-client");
const { ClientSecretCredential } = require("@azure/identity");

// outlook credentials
const CLIENT_ID = "5a58e660-dc7b-49ec-a48c-1fffac02f721";
const CLIENT_SECRET = "6_I8Q~U7IbS~NERqNeszoCRs2kETiO1Yc3cXAaup";
const TENANT_ID = "1c3de7f3-f8d1-41d3-8583-2517cf3ba3b1";
const SENDER_EMAIL = "leaf@premierenergies.com";

// creating an authentication credential for microsoft graph apis
const credential = new ClientSecretCredential(
  TENANT_ID,
  CLIENT_ID,
  CLIENT_SECRET
);

// creating a microsoft graph client
const client = Client.initWithMiddleware({
  authProvider: {
    getAccessToken: async () => {
      const tokenResponse = await credential.getToken("https://graph.microsoft.com/.default");
      return tokenResponse.token;
    },
  },
});

// create express app
const app = express();
const server = http.createServer(app);

// create socket.io server
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT"],
    allowedHeaders: ["Authorization", "Content-Type"],
    credentials: true,
  },
});

// middleware
app.use(cors({ origin: "*" }));
app.use(express.json());

// monogdb atlas connection string
mongoose
  .connect(
    "mongodb+srv://aarnavsingh836:Cucumber1729@rr.oldse8x.mongodb.net/?retryWrites=true&w=majority&appName=rr",
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    }
  )
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));


// 1) inbound vendor schema/Model
const vendorISchema = new mongoose.Schema(
  {
    username: { type: String, unique: true },
    vendorName: { type: String, unique: true },
    password: { type: String },
    email: { type: String, unique: true, required: true },
    contactNumber: { type: String, unique: true, required: true },
  },
  {
    collection: "vendorsi",
    timestamps: true,
  }
);
const VendorI = mongoose.model("VendorI", vendorISchema);

// 2) Inbound RFQ Schema/Model
const rfqISchema = new mongoose.Schema(
  {
    rfqNumber: { type: String, required: true, unique: true },
    itemDescription: { type: String, required: true },
    companyName: {
      type: String,
      required: true,
    },
    poNumber: { type: String, required: true },
    supplierName: { type: String, required: true },
    portOfLoading: { type: String, required: true },
    portOfDestination: { type: String, required: true },
    containerType: { type: String, required: true },
    numberOfContainers: { type: Number, required: true },
    cargoWeightInContainer: { type: Number, required: true },
    cargoReadinessDate: { type: Date, required: true },
    initialQuoteEndTime: { type: Date, required: true },
    evaluationEndTime: { type: Date, required: true },
    rfqClosingDate: { type: Date, required: true },
    rfqClosingTime: { type: String, required: true },
    eReverseToggle: { type: Boolean, default: false },
    eReverseDate: { type: Date },
    eReverseTime: { type: String },
    status: {
      type: String,
      enum: ["initial", "evaluation", "closed"],
      default: "initial",
    },
    finalizeReason: { type: String },
    l1Price: { type: Number },
    l1VendorId: { type: mongoose.Schema.Types.ObjectId, ref: "VendorI" },
    selectedVendors: [{ type: mongoose.Schema.Types.ObjectId, ref: "VendorI" }],
    vendorActions: [
      {
        action: String,
        vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "VendorI" },
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  {
    collection: "rfqsi",
    timestamps: true,
  }
);
const RFQI = mongoose.model("RFQI", rfqISchema);

// 3) Inbound Quote Schema/Model
const quoteISchema = new mongoose.Schema(
  {
    rfqId: { type: mongoose.Schema.Types.ObjectId, ref: "RFQI" },
    vendorName: String,
    companyName: String,
    message: String,
    numberOfContainers: Number,
    validityPeriod: { type: Date, required: true },
    label: String,
    containerAllotted: Number,
    shippingLineName: String,
    containerType: String,
    vesselName: String,
    vesselETD: { type: Date, required: true },
    vesselETA: { type: Date, required: true },
    seaFreightPerContainer: Number,
    houseDO: String,
    cfs: String,
    transportation: Number,
    chaChargesHome: Number,
    chaChargesMOOWR: Number,
  },
  {
    collection: "quotesi",
    timestamps: true,
  }
);
const QuoteI = mongoose.model("QuoteI", quoteISchema);

// 4) Inbound User Schema/Model
const userISchema = new mongoose.Schema(
  {
    username: { type: String, unique: true },
    password: { type: String },
    email: { type: String, unique: true, required: true },
    contactNumber: { type: String, unique: true, required: true },
    role: { type: String, enum: ["vendor", "factory"], required: true },
    status: { type: String, enum: ["pending", "approved"], default: "pending" },
  },
  {
    collection: "usersi",
    timestamps: true,
  }
);
const UserI = mongoose.model("UserI", userISchema);

// 5) Inbound Verification Schema/Model
const verificationISchema = new mongoose.Schema(
  {
    email: { type: String, required: true },
    otp: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 300 },
  },
  {
    collection: "verificationi",
    timestamps: true,
  }
);
const VerificationI = mongoose.model("VerificationI", verificationISchema);

//--------------------------------------------------
// (Below) Outbound or existing code can remain as-is
//--------------------------------------------------

// (Outbound) Vendor
const vendorSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  vendorName: { type: String, unique: true },
  password: String,
  email: { type: String, unique: true, required: true },
  contactNumber: { type: String, unique: true, required: true },
});
const Vendor = mongoose.model("Vendor", vendorSchema);

// (Outbound) Quote
const quoteSchema = new mongoose.Schema(
  {
    rfqId: { type: mongoose.Schema.Types.ObjectId, ref: "RFQ" },
    vendorName: String,
    companyName: String,
    price: Number,
    message: String,
    numberOfTrucks: Number,
    validityPeriod: String,
    label: String,
    trucksAllotted: Number,
    numberOfVehiclesPerDay: {
      type: Number,
      required: true,
      min: 1,
      max: 99,
    },
  },
  { timestamps: true }
);
const Quote = mongoose.model("Quote", quoteSchema);

// (Outbound) User
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  email: { type: String, unique: true, required: true },
  contactNumber: { type: String, unique: true, required: true },
  role: { type: String, enum: ["vendor", "factory"], required: true },
  status: { type: String, enum: ["pending", "approved"], default: "pending" },
});
const User = mongoose.model("User", userSchema);

// (Outbound) RFQ
const rfqSchema = new mongoose.Schema(
  {
    RFQNumber: String,
    shortName: String,
    companyType: String,
    sapOrder: String,
    itemType: String,
    customerName: String,
    originLocation: String,
    dropLocationState: String,
    dropLocationDistrict: String,
    address: { type: String, required: true },
    pincode: {
      type: String,
      required: true,
      validate: {
        validator: function (v) {
          return /^\d{6}$/.test(v);
        },
        message: (props) =>
          `${props.value} is not a valid pincode. It should be exactly 6 digits.`,
      },
    },
    vehicleType: String,
    additionalVehicleDetails: String,
    numberOfVehicles: Number,
    weight: String,
    budgetedPriceBySalesDept: Number,
    maxAllowablePrice: Number,
    eReverseDate: { type: Date, required: false },
    eReverseTime: { type: String, required: false },
    vehiclePlacementBeginDate: Date,
    vehiclePlacementEndDate: Date,
    status: {
      type: String,
      enum: ["initial", "evaluation", "closed"],
      default: "initial",
    },
    initialQuoteEndTime: { type: Date, required: true },
    evaluationEndTime: { type: Date, required: true },
    finalizeReason: { type: String },
    l1Price: Number,
    l1VendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
    RFQClosingDate: Date,
    RFQClosingTime: { type: String, required: true },
    eReverseToggle: { type: Boolean, default: false },
    rfqType: { type: String, enum: ["Long Term", "D2D"], default: "D2D" },
    selectedVendors: [{ type: mongoose.Schema.Types.ObjectId, ref: "Vendor" }],
    vendorActions: [
      {
        action: String,
        vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);
const RFQ = mongoose.model("RFQ", rfqSchema);

// (Outbound) Verification
const verificationSchema = new mongoose.Schema({
  email: { type: String, required: true },
  otp: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 },
});
const Verification = mongoose.model("Verification", verificationSchema);

//--------------------------------------------------
// EMAIL SENDING HELPER FOR OUTBOUND ONLY
//--------------------------------------------------
async function sendRFQEmail(rfqData, selectedVendorIds) {
  const excludedFields = [
    "_id",
    "budgetedPriceBySalesDept",
    "maxAllowablePrice",
    "customerName",
    "selectedVendors",
    "vendorActions",
    "createdAt",
    "updatedAt",
    "__v",
    "eReverseTime",
    "eReverseDate",
    "sapOrder",
    "status",
    "eReverseToggle",
  ];

  try {
    let vendorsToEmail;

    if (selectedVendorIds && selectedVendorIds.length > 0) {
      vendorsToEmail = await Vendor.find(
        { _id: { $in: selectedVendorIds } },
        "email vendorName"
      );
    } else {
      vendorsToEmail = [];
    }

    const vendorEmails = vendorsToEmail.map((vendor) => vendor.email);

    if (vendorEmails.length > 0) {
      for (const vendor of vendorsToEmail) {
        const emailContent = {
          message: {
            subject: "New RFQ Posted - Submit Initial Quote",
            body: {
              contentType: "HTML",
              content: `
                  <p>Dear Vendor,</p>
                  <p>You are one of the selected vendors for ${rfqData.RFQNumber}.</p>
                  <p>Initial Quote End Time: ${moment(rfqData.initialQuoteEndTime)
                    .tz("Asia/Kolkata")
                    .format("YYYY-MM-DD HH:mm")}</p>
                  <p>Evaluation Period End Time: ${moment(rfqData.evaluationEndTime)
                    .tz("Asia/Kolkata")
                    .format("YYYY-MM-DD HH:mm")}</p>
                  <p>Please log in to your account to submit your quote.</p>
        
                <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; inline-size: 100%;">
                  <thead>
                    <tr>
                      <th style="background-color: #f2f2f2;">Field</th>
                      <th style="background-color: #f2f2f2;">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${Object.entries(rfqData)
                      .filter(([key]) => !excludedFields.includes(key))
                      .map(
                        ([key, value]) => `
                      <tr>
                        <td style="padding: 8px; text-align: start;">${key.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase())}</td>
                        <td style="padding: 8px; text-align: start;">${value}</td>
                      </tr>
                    `
                      )
                      .join("")}
                  </tbody>
                </table>
                <p>We look forward to receiving your quote.</p>
                <p>Best regards,<br/>Team LEAF.</p>
              `,
            },
            toRecipients: [
              {
                emailAddress: {
                  address: vendor.email,
                },
              },
            ],
            from: {
              emailAddress: {
                address: "leaf@premierenergies.com",
              },
            },
          },
        };

        await client.api(`/users/${SENDER_EMAIL}/sendMail`).post(emailContent);
        console.log(`Email sent to ${vendor.email}`);
      }
      return { success: true };
    } else {
      console.log("No selected vendors to send emails to.");
      return { success: false };
    }
  } catch (error) {
    console.error("Error sending RFQ email:", error);
    return { success: false };
  }
}

//--------------------------------------------------
// NEW ENDPOINT: GET all inbound RFQs
//--------------------------------------------------
app.get("/api/rfqsi", async (req, res) => {
  try {
    const rfqs = await RFQI.find().lean();
    res.status(200).json(rfqs);
  } catch (error) {
    console.error("Error fetching inbound RFQs:", error);
    res.status(500).json({ error: "Failed to fetch inbound RFQs" });
  }
});

//--------------------------------------------------
// NEW ENDPOINT: GET all inbound quotes for a given RFQ ID
//--------------------------------------------------
app.get("/api/quotesi/:rfqId", async (req, res) => {
  try {
    const { rfqId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(rfqId)) {
      return res.status(400).json({ error: "Invalid RFQ ID." });
    }
    // FIX: Use the inbound QuoteI model instead of Quote
    const quotes = await QuoteI.find({ rfqId }).lean();
    res.status(200).json(quotes);
  } catch (error) {
    console.error("Error fetching inbound quotes by RFQ:", error);
    res.status(500).json({ error: "Failed to fetch inbound quotes by RFQ." });
  }
});

//--------------------------------------------------
// INBOUND: Next inbound RFQ number
//--------------------------------------------------
app.get("/api/inbound-next-rfq-number", async (req, res) => {
  try {
    const lastInboundRFQ = await RFQI.findOne().sort({ _id: -1 });
    let nextNumber;
    if (lastInboundRFQ) {
      const numericPart = parseInt(lastInboundRFQ.rfqNumber.replace(/\D/g, ""), 10);
      nextNumber = `RFQ${numericPart + 1}`;
    } else {
      nextNumber = "RFQ1";
    }
    res.status(200).json({ RFQNumber: nextNumber });
  } catch (error) {
    console.error("Error fetching inbound next RFQ number:", error);
    res.status(500).json({ error: "Failed to fetch inbound next RFQ number" });
  }
});

//--------------------------------------------------
// INBOUND: Fetch inbound vendors from "vendorsi"
//--------------------------------------------------
app.get("/api/inbound-vendors", async (req, res) => {
  try {
    const inboundVendors = await VendorI.find();
    res.status(200).json(inboundVendors);
  } catch (error) {
    console.error("Error fetching inbound vendors:", error);
    res.status(500).json({ error: "Failed to fetch inbound vendors" });
  }
});

//--------------------------------------------------
// INBOUND: Create a new inbound RFQ in "rfqsi"
//--------------------------------------------------
app.post("/api/rfqsi", async (req, res) => {
  try {
    const {
      RFQNumber,
      itemDescription,
      companyName,
      poNumber,
      supplierName,
      portOfLoading,
      portOfDestination,
      containerType,
      numberOfContainers,
      cargoWeightInContainer,
      cargoReadinessDate,
      eReverseToggle,
      eReverseDate,
      eReverseTime,
      initialQuoteEndTime,
      evaluationEndTime,
      RFQClosingDate,
      RFQClosingTime,
      selectedVendors,
    } = req.body;

    const newRFQ = new RFQI({
      rfqNumber: RFQNumber,
      itemDescription,
      companyName,
      poNumber,
      supplierName,
      portOfLoading,
      portOfDestination,
      containerType,
      numberOfContainers,
      cargoWeightInContainer,
      cargoReadinessDate,
      eReverseToggle,
      eReverseDate: eReverseToggle ? eReverseDate : null,
      eReverseTime: eReverseToggle ? eReverseTime : null,
      initialQuoteEndTime,
      evaluationEndTime,
      rfqClosingDate: RFQClosingDate,
      rfqClosingTime: RFQClosingTime,
      selectedVendors,
    });

    await newRFQ.save();

    res.status(201).json({
      success: true,
      message: "Inbound RFQ created successfully",
      inboundRFQId: newRFQ._id,
    });
  } catch (error) {
    console.error("Error creating inbound RFQ:", error);
    res.status(500).json({ error: "Failed to create inbound RFQ" });
  }
});

//--------------------------------------------------
// INBOUND: Create a new inbound vendor
//--------------------------------------------------
app.post("/api/vendorsi", async (req, res) => {
  const { username, vendorName, password, email, contactNumber } = req.body;
  try {
    const existingVendor = await VendorI.findOne({
      $or: [{ username }, { email }, { contactNumber }, { vendorName }],
    });
    if (existingVendor) {
      return res.status(400).json({
        error: "Vendor with the provided username, email, contact number, or vendor name already exists.",
      });
    }
    const newVendor = new VendorI({
      username,
      vendorName,
      password,
      email,
      contactNumber,
    });
    await newVendor.save();
    res.status(201).json({
      message: "Inbound vendor created successfully.",
      vendor: {
        id: newVendor._id,
        username: newVendor.username,
        vendorName: newVendor.vendorName,
        email: newVendor.email,
        contactNumber: newVendor.contactNumber,
      },
    });
  } catch (error) {
    console.error("Error creating inbound vendor:", error);
    res.status(500).json({ error: "Failed to create inbound vendor." });
  }
});

//--------------------------------------------------
// INBOUND: Fetch inbound RFQs for a specific vendor
//--------------------------------------------------
app.get("/api/rfqsi/vendor/:username", async (req, res) => {
  const { username } = req.params;
  try {
    const vendor = await VendorI.findOne({ username });
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found." });
    }
    const rfqs = await RFQI.find({ selectedVendors: vendor._id })
      .populate("selectedVendors", "username vendorName email contactNumber")
      .lean();
    res.status(200).json(rfqs);
  } catch (error) {
    console.error("Error fetching RFQs for vendor:", error);
    res.status(500).json({ error: "Failed to fetch RFQs for vendor." });
  }
});

//--------------------------------------------------
// INBOUND: Fetch inbound quotes for a specific vendor
//--------------------------------------------------
app.get("/api/quotesi/vendor/:username", async (req, res) => {
  const { username } = req.params;
  try {
    const vendor = await VendorI.findOne({ username });
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found." });
    }
    const quotes = await QuoteI.find({ vendorName: username })
      .populate("rfqId", "rfqNumber itemDescription companyName")
      .lean();
    res.status(200).json(quotes);
  } catch (error) {
    console.error("Error fetching quotes for vendor:", error);
    res.status(500).json({ error: "Failed to fetch quotes for vendor." });
  }
});

//--------------------------------------------------
// INBOUND: Fetch a specific inbound quote by RFQ ID and Vendor Username
//--------------------------------------------------
app.get("/api/quotesi/rfq/:rfqId/vendor/:username", async (req, res) => {
  const { rfqId, username } = req.params;
  try {
    if (!mongoose.Types.ObjectId.isValid(rfqId)) {
      return res.status(400).json({ error: "Invalid RFQ ID." });
    }
    const quote = await QuoteI.findOne({ rfqId, vendorName: username })
      .populate("rfqId", "rfqNumber companyName")
      .lean();
    if (!quote) {
      return res.status(404).json({ error: "Quote not found." });
    }
    res.status(200).json(quote);
  } catch (error) {
    console.error("Error fetching specific quote:", error);
    res.status(500).json({ error: "Failed to fetch the quote." });
  }
});

//--------------------------------------------------
// INBOUND: Create a new inbound quote
//--------------------------------------------------
app.post("/api/quotesi", async (req, res) => {
  try {
    const {
      rfqId,
      vendorName,
      numberOfContainers,
      validityPeriod,
      shippingLineName,
      containerType,
      vesselName,
      vesselETD,
      vesselETA,
      seaFreightPerContainer,
      houseDO,
      cfs,
      transportation,
      chaChargesHome,
      chaChargesMOOWR,
      message,
    } = req.body;
    if (
      !rfqId ||
      !vendorName ||
      numberOfContainers == null ||
      !validityPeriod ||
      !shippingLineName ||
      !containerType ||
      !vesselName ||
      !vesselETD ||
      !vesselETA ||
      seaFreightPerContainer == null ||
      !houseDO ||
      !cfs ||
      transportation == null ||
      chaChargesHome == null ||
      chaChargesMOOWR == null
    ) {
      return res.status(400).json({ error: "Missing required fields." });
    }
    if (!mongoose.Types.ObjectId.isValid(rfqId)) {
      return res.status(400).json({ error: "Invalid RFQ ID." });
    }
    const rfq = await RFQI.findById(rfqId);
    if (!rfq) {
      return res.status(404).json({ error: "RFQ not found." });
    }
    if (rfq.status === "closed") {
      return res.status(400).json({ error: "RFQ is closed. Cannot submit quotes." });
    }
    const vendor = await VendorI.findOne({ username: vendorName });
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found." });
    }
    if (!rfq.selectedVendors.includes(vendor._id)) {
      return res.status(403).json({ error: "Vendor not selected for this RFQ." });
    }
    let existingQuote = await QuoteI.findOne({ rfqId, vendorName });
    if (existingQuote) {
      return res.status(409).json({ error: "Quote already exists. Use update endpoint." });
    }
    const newQuote = new QuoteI({
      rfqId,
      vendorName,
      companyName: rfq.companyName,
      numberOfContainers: Number(numberOfContainers),
      validityPeriod: new Date(validityPeriod),
      shippingLineName,
      containerType,
      vesselName,
      vesselETD: new Date(vesselETD),
      vesselETA: new Date(vesselETA),
      seaFreightPerContainer: Number(seaFreightPerContainer),
      houseDO,
      cfs,
      transportation: Number(transportation),
      chaChargesHome: Number(chaChargesHome),
      chaChargesMOOWR: Number(chaChargesMOOWR),
      message,
    });
    await newQuote.save();
    res.status(201).json({
      message: "Quote submitted successfully.",
      quote: newQuote,
    });
  } catch (error) {
    console.error("Error submitting inbound quote:", error);
    res.status(500).json({ error: "Failed to submit inbound quote." });
  }
});

//--------------------------------------------------
// INBOUND: Update an existing inbound quote
//--------------------------------------------------
app.put("/api/quotesi/:quoteId", async (req, res) => {
  try {
    const { quoteId } = req.params;
    const {
      price,
      message,
      numberOfContainers,
      validityPeriod,
      numberOfContainersPerDay,
      shippingLineName,
      containerType,
      vesselName,
      vesselETD,
      vesselETA,
      seaFreightPerContainer,
      houseDO,
      cfs,
      transportation,
      chaChargesHome,
      chaChargesMOOWR,
    } = req.body;
    if (!mongoose.Types.ObjectId.isValid(quoteId)) {
      return res.status(400).json({ error: "Invalid Quote ID." });
    }
    const existingQuote = await QuoteI.findById(quoteId);
    if (!existingQuote) {
      return res.status(404).json({ error: "Quote not found." });
    }
    const rfq = await RFQI.findById(existingQuote.rfqId);
    if (!rfq) {
      return res.status(404).json({ error: "Associated RFQ not found." });
    }
    if (rfq.status === "closed") {
      return res.status(400).json({ error: "RFQ is closed. Cannot update quotes." });
    }
    if (price != null) existingQuote.price = Number(price);
    if (message !== undefined) existingQuote.message = message;
    if (numberOfContainers != null)
      existingQuote.numberOfContainers = Number(numberOfContainers);
    if (validityPeriod !== undefined)
      existingQuote.validityPeriod = validityPeriod.toString();
    if (numberOfContainersPerDay != null)
      existingQuote.numberOfContainersPerDay = Number(numberOfContainersPerDay);
    if (shippingLineName !== undefined)
      existingQuote.shippingLineName = shippingLineName;
    if (containerType !== undefined)
      existingQuote.containerType = containerType;
    if (vesselName !== undefined)
      existingQuote.vesselName = vesselName;
    if (vesselETD !== undefined)
      existingQuote.vesselETD = vesselETD;
    if (vesselETA !== undefined)
      existingQuote.vesselETA = vesselETA;
    if (seaFreightPerContainer != null)
      existingQuote.seaFreightPerContainer = Number(seaFreightPerContainer);
    if (houseDO !== undefined) existingQuote.houseDO = houseDO;
    if (cfs !== undefined) existingQuote.cfs = cfs;
    if (transportation != null)
      existingQuote.transportation = Number(transportation);
    if (chaChargesHome != null)
      existingQuote.chaChargesHome = Number(chaChargesHome);
    if (chaChargesMOOWR != null)
      existingQuote.chaChargesMOOWR = Number(chaChargesMOOWR);
    await existingQuote.save();
    res.status(200).json({
      message: "Quote updated successfully.",
      quote: existingQuote,
    });
  } catch (error) {
    console.error("Error updating inbound quote:", error);
    res.status(500).json({ error: "Failed to update inbound quote." });
  }
});

//--------------------------------------------------
// INBOUND: Fetch a specific inbound RFQ by ID
//--------------------------------------------------
app.get("/api/rfqsi/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid RFQ ID." });
    }
    const rfq = await RFQI.findById(id)
      .populate("selectedVendors", "username vendorName email contactNumber")
      .lean();
    if (!rfq) {
      return res.status(404).json({ error: "RFQ not found." });
    }
    res.status(200).json(rfq);
  } catch (error) {
    console.error("Error fetching inbound RFQ:", error);
    res.status(500).json({ error: "Failed to fetch RFQ." });
  }
});

//--------------------------------------------------
// NEW ENDPOINT: Finalize Inbound RFQ Allocation
//--------------------------------------------------
app.post("/api/rfqsi/:id/finalize-allocation", async (req, res) => {
  try {
    const { id } = req.params;
    const { homeAllocation, moowrAllocation, finalizeReason } = req.body;

    // Fetch the inbound RFQ
    const rfq = await RFQI.findById(id);
    if (!rfq) {
      return res.status(404).json({ error: "RFQ not found." });
    }
    if (rfq.status === "closed") {
      return res.status(400).json({ error: "RFQ has already been finalized." });
    }

    // Compare home and moowr allocations (by vendor name and containersAllotted)
    const homeData = homeAllocation.map((alloc) => ({
      vendorName: alloc.vendorName,
      containersAllotted: alloc.containersAllotted,
    }));
    const moowrData = moowrAllocation.map((alloc) => ({
      vendorName: alloc.vendorName,
      containersAllotted: alloc.containersAllotted,
    }));
    const allocationsMatch = JSON.stringify(homeData) === JSON.stringify(moowrData);

    // If allocations differ and no finalize reason is provided, return error.
    if (!allocationsMatch && (!finalizeReason || finalizeReason.trim() === "")) {
      return res.status(400).json({ error: "Please provide a reason for the difference in allocation." });
    }

    // Update all QuoteI documents associated with this RFQ based on homeAllocation
    for (const alloc of homeAllocation) {
      await QuoteI.findOneAndUpdate(
        { rfqId: id, vendorName: alloc.vendorName },
        {
          price: alloc.price,
          containerAllotted: alloc.containersAllotted,
          label: alloc.label,
        }
      );
    }

    // Update RFQ status and save finalize reason if provided
    rfq.status = "closed";
    if (finalizeReason) {
      rfq.finalizeReason = finalizeReason;
    }
    await rfq.save();

    // (Optionally, send emails to vendors here using your email-sending helper)

    res.status(200).json({ message: "Allocation finalized and notifications sent." });
  } catch (error) {
    console.error("Error finalizing allocation:", error);
    res.status(500).json({ error: "Failed to finalize allocation." });
  }
});

//--------------------------------------------------
// (Remaining outbound endpoints remain unchanged)
//--------------------------------------------------

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});