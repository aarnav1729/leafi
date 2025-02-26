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
    companyName: { type: String, required: true },
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
    // NEW FIELD: Store the final user allocation (split into home and MOOWR)
    userAllocation: {
      type: Object,
      default: { home: [], moowr: [] }
    }
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

const QuoteI = mongoose.model("quotesi", quoteISchema);


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


app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  // Check if the user is admin
  if (username === "aarnav" && password === "aarnav") {
    // Return success response with role 'admin'
    return res
      .status(200)
      .json({ success: true, role: "admin", username: "aarnav" });
  }

  try {
    // Find the user without specifying the role
    const user = await UserI.findOne({ username, password });

    if (user) {
      if (user.status === "approved") {
        return res
          .status(200)
          .json({ success: true, role: user.role, username: user.username });
      } else {
        return res
          .status(403)
          .json({ success: false, message: "Account pending admin approval" });
      }
    } else {
      return res
        .status(401)
        .json({ success: false, message: "Invalid username or password" });
    }
  } catch (error) {
    console.error("Error during login:", error);
    return res.status(500).json({ success: false });
  }
});

app.post("/api/usersi", async (req, res) => {
  const { username, password, role, email, contactNumber } = req.body;
  try {
    // Optionally, check for an existing user to prevent duplicates.
    const existingUser = await UserI.findOne({ $or: [{ username }, { email }, { contactNumber }] });
    if (existingUser) {
      return res.status(400).json({ error: "User with the provided username, email, or contact number already exists." });
    }
    
    const newUser = new UserI({
      username,
      password,
      role,
      email,
      contactNumber
    });
    
    await newUser.save();
    res.status(201).json({
      message: "Inbound user created successfully.",
      user: {
        id: newUser._id,
        username: newUser.username,
        role: newUser.role,
        email: newUser.email,
        contactNumber: newUser.contactNumber
      }
    });
  } catch (error) {
    console.error("Error creating inbound user:", error);
    res.status(500).json({ error: "Failed to create inbound user." });
  }
});


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


// finalize Inbound RFQ Allocation
// Finalize Inbound RFQ Allocation Endpoint
// Finalize Inbound RFQ Allocation Endpoint
app.post("/api/rfqsi/:id/finalize-allocation", async (req, res) => {
  try {
    const { id } = req.params;
    const { homeAllocation, moowrAllocation, finalizeReason } = req.body;

    // Find the RFQ document
    const rfq = await RFQI.findById(id);
    if (!rfq) {
      return res.status(404).json({ error: "RFQ not found." });
    }
    if (rfq.status === "closed") {
      return res.status(400).json({ error: "RFQ has already been finalized." });
    }

    // Validate that the total allocated containers equal the required number
    const totalAllocatedHome = homeAllocation.reduce(
      (sum, alloc) => sum + (alloc.containersAllotted || 0),
      0
    );
    const totalAllocatedMoowr = moowrAllocation.reduce(
      (sum, alloc) => sum + (alloc.containersAllotted || 0),
      0
    );
    const totalAllocated = totalAllocatedHome + totalAllocatedMoowr;
    if (totalAllocated !== rfq.numberOfContainers) {
      return res.status(400).json({
        error: `Total containers allocated (${totalAllocated}) does not match required (${rfq.numberOfContainers}).`
      });
    }

    // Update each QuoteI record for the given RFQ with the final allocation.
    const combinedAllocations = [...homeAllocation, ...moowrAllocation];
    for (const alloc of combinedAllocations) {
      await QuoteI.findOneAndUpdate(
        { rfqId: id, vendorName: alloc.vendorName },
        {
          price: alloc.price,
          containersAllotted: alloc.containersAllotted,
          label: alloc.label,
          finalized: true, // optional flag indicating that the quote is finalized
        }
      );
    }

    // Check if the RFQ document already has a userAllocation field;
    // if not, initialize it.
    if (!rfq.userAllocation) {
      rfq.userAllocation = { home: [], moowr: [] };
    }

    // Store the user's final allocation and finalize reason in the RFQ document.
    rfq.status = "closed";
    rfq.finalizeReason = finalizeReason;
    rfq.userAllocation = { home: homeAllocation, moowr: moowrAllocation };
    await rfq.save();

    // Send confirmation emails to vendors.
    // (Here we assume each allocation object contains an 'email' field. Otherwise, you may need to look up the vendor's email by vendorName.)
    const vendorEmailsSet = new Set();
    combinedAllocations.forEach((alloc) => {
      if (alloc.email) {
        vendorEmailsSet.add(alloc.email);
      }
    });
    const vendorEmails = Array.from(vendorEmailsSet);

    const emailPromises = vendorEmails.map((email) => {
      const emailContent = {
        message: {
          subject: "Final Allocation Confirmed for RFQ " + rfq.rfqNumber,
          body: {
            contentType: "HTML",
            content: `
              <p>Dear Vendor,</p>
              <p>The final allocation for RFQ <strong>${rfq.rfqNumber}</strong> has been confirmed.</p>
              <p>Your final allocation details can be found in your account.
              ${finalizeReason ? `<br/><br/><strong>User Reason for Allocation Difference:</strong> ${finalizeReason}` : ""}
              </p>
              <p>Thank you,<br/>Team LEAF</p>
            `,
          },
          toRecipients: [{ emailAddress: { address: email } }],
          from: { emailAddress: { address: SENDER_EMAIL } },
        },
      };
      return client.api(`/users/${SENDER_EMAIL}/sendMail`).post(emailContent);
    });
    await Promise.all(emailPromises);

    res.status(200).json({
      message:
        "Allocation finalized, user allocation stored, and confirmation emails sent to vendors."
    });
  } catch (error) {
    console.error("Error finalizing allocation:", error);
    res.status(500).json({ error: "Failed to finalize allocation." });
  }
});

// start the server
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});