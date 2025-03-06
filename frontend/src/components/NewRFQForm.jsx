import React, { useState, useEffect } from "react";
import axios from "axios";

const NewRFQForm = () => {
  const [formData, setFormData] = useState({
    RFQNumber: "", // auto-generated
    itemDescription: "",
    companyName: "",
    poNumber: "",
    supplierName: "",
    portOfLoading: "",
    portOfDestination: "",
    containerType: "",
    numberOfContainers: "",
    cargoWeightInContainer: "",
    cargoReadinessDate: "",
    eReverseToggle: false,
    eReverseDate: "",
    eReverseTime: "",
    initialQuoteEndTime: "",
    evaluationEndTime: "",
    RFQClosingDate: "",
    RFQClosingTime: "",
    description: "",
  });

  const [vendors, setVendors] = useState([]);
  const [selectedVendors, setSelectedVendors] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    fetchInboundNextRFQNumber();
    fetchInboundVendors();
  }, []);

  const fetchInboundNextRFQNumber = async () => {
    try {
      const response = await axios.get(
        "http://localhost:8000/api/inbound-next-rfq-number"
      );
      const inboundNum = response.data?.RFQNumber || "";
      setFormData((prev) => ({ ...prev, RFQNumber: inboundNum }));
    } catch (error) {
      console.error("Error fetching inbound next RFQ number:", error);
    }
  };

  const fetchInboundVendors = async () => {
    try {
      const response = await axios.get(
        "http://localhost:8000/api/inbound-vendors"
      );
      console.log("Inbound Vendors Response:", response.data); // Add this line
      setVendors(Array.isArray(response.data) ? response.data : []); // Ensure it's an array
    } catch (error) {
      console.error("Error fetching inbound vendors:", error);
    }
  };

  // Handle vendor checkboxes
  const handleVendorSelection = (vendorId) => {
    setSelectedVendors((prev) => {
      if (prev.includes(vendorId)) return prev.filter((id) => id !== vendorId);
      return [...prev, vendorId];
    });
  };

  // "Select all" or "deselect all"
  const handleSelectAllVendors = (e) => {
    if (e.target.checked) {
      const allIds = vendors.map((v) => v._id);
      setSelectedVendors(allIds);
    } else {
      setSelectedVendors([]);
    }
  };

  // Common change handler
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let error = "";

    // Numeric validation
    if (
      ["numberOfContainers", "cargoWeightInContainer"].includes(name) &&
      value !== ""
    ) {
      if (!/^\d+(\.\d+)?$/.test(value)) {
        error = "Must be a valid number.";
      }
    }

    if (name === "eReverseToggle") {
      // If toggling off eReverse, clear date/time
      setFormData((prev) => ({
        ...prev,
        eReverseToggle: checked,
        eReverseDate: checked ? prev.eReverseDate : "",
        eReverseTime: checked ? prev.eReverseTime : "",
      }));
      setErrors((prevErrors) => ({ ...prevErrors, [name]: error }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
    setErrors((prevErrors) => ({ ...prevErrors, [name]: error }));
  };

  // Submit form
  const handleSubmit = async (e) => {
    e.preventDefault();
    // Check for any validation errors
    const hasErrors = Object.values(errors).some((err) => err);
    if (hasErrors) {
      alert("Please fix errors before submitting.");
      return;
    }

    setIsLoading(true);
    try {
      let eReverseDateTime = null;
      if (
        formData.eReverseToggle &&
        formData.eReverseDate &&
        formData.eReverseTime
      ) {
        eReverseDateTime = new Date(
          `${formData.eReverseDate}T${formData.eReverseTime}`
        );
      }

      const dataToSend = {
        ...formData,
        eReverseDate: eReverseDateTime,
        selectedVendors,
      };

      // Post to your inbound create RFQ route, e.g. /api/rfqsi or /api/inbound-rfq
      const response = await axios.post(
        "http://localhost:8000/api/rfqsi",
        dataToSend
      );
      if (response.status === 201 && response.data.success) {
        alert("Inbound RFQ created successfully!");
        // Reset
        setFormData({
          RFQNumber: "",
          itemDescription: "",
          companyName: "",
          poNumber: "",
          supplierName: "",
          portOfLoading: "",
          portOfDestination: "",
          containerType: "",
          numberOfContainers: "",
          cargoWeightInContainer: "",
          cargoReadinessDate: "",
          eReverseToggle: false,
          eReverseDate: "",
          eReverseTime: "",
          description: "",
          initialQuoteEndTime: "",
          evaluationEndTime: "",
          RFQClosingDate: "",
          RFQClosingTime: "",
        });
        setSelectedVendors([]);
        fetchInboundNextRFQNumber(); // get next # again
      } else {
        alert("Failed to create inbound RFQ.");
      }
    } catch (error) {
      console.error("Error creating inbound RFQ:", error);
      alert("Error creating inbound RFQ.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto mt-8 px-4 py-6 bg-transparent text-black rounded-lg shadow-lg border border-black">
      <h2 className="text-2xl font-bold mb-6 text-center">
        Create New Inbound RFQ
      </h2>

      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        {/* 1. RFQNumber */}
        <div className="mb-4">
          <label className="block text-xl text-black">RFQ Number</label>
          <input
            type="text"
            name="RFQNumber"
            value={formData.RFQNumber || ""} // fallback
            readOnly
            placeholder={isLoading ? "Loading..." : "RFQ Number"}
            className="mt-1 block w-full px-3 py-2 border bg-gray-200 border-black rounded-md shadow-sm"
            required
          />
        </div>

        {/* 2. Item Description */}
        <div className="mb-4">
          <label className="block text-xl text-black">Item Description</label>
          <select
            name="itemDescription"
            value={formData.itemDescription || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md shadow-sm"
            required
          >
            <option value="">Select an Item</option>
            <option value="Ethylene vinyl acetate sheets (EVA)">
              Ethylene vinyl acetate sheets (EVA)
            </option>
            <option value="Tinned Copper interconnect-Wire/Ribbon">
              Tinned Copper interconnect-Wire/Ribbon
            </option>
            <option value="Tinned Copper interconnect-Bus Bar">
              Tinned Copper interconnect-Bus Bar
            </option>
            <option value="Solar tempered glass or solar tempered (anti-reflective coated) glass">
              Solar tempered glass or solar tempered (anti-reflective coated)
              glass
            </option>
            <option value="Photovoltaic cells">Photovoltaic cells</option>
            <option value="Back sheet for Solar Module (Supplier: Jolywood KFB-30PLUS(WHITE)">
              Back sheet for Solar Module (Supplier: Jolywood KFB-30PLUS(WHITE)
            </option>
            <option value="Back sheet- Transparent-for Solar Module (JOLYWOOD FFC JW30PLUS (TRANSPARENT)">
              Back sheet- Transparent-for Solar Module (JOLYWOOD FFC JW30PLUS
              (TRANSPARENT)
            </option>
            <option value="PET Back sheet-for Solar Module">
              PET Back sheet-for Solar Module
            </option>
            <option value="Aluminium Profile/Frames">
              Aluminium Profile/Frames
            </option>
            <option value="Junction Box (used solar Photovoltaic Modules)">
              Junction Box (used solar Photovoltaic Modules)
            </option>
            <option value="Silicone Sealants used in Manufacturing of solar Photovoltaic Modules">
              Silicone Sealants used in Manufacturing of solar Photovoltaic
              Modules
            </option>
            <option value="POE (polymers of Ehtylene) Film">
              POE (polymers of Ehtylene) Film
            </option>
            <option value="EPE Film">EPE Film</option>
            <option value="Membrane Sheet">Membrane Sheet</option>
            <option value="Teflon sheet">Teflon sheet</option>
            <option value="Silver Conductor Front side Metallic Paste &amp; Silver Conductor paste Rear Side">
              Silver Conductor Front side Metallic Paste &amp; Silver Conductor
              paste Rear Side
            </option>
            <option value="Undefused silicon wafers">
              Undefused silicon wafers
            </option>
            <option value="Aluminium paste">Aluminium paste</option>
            <option value="Print screen">Print screen</option>
            <option value="Additives">Additives</option>
            <option value="TMA (TRIMETHYLALUMINUM)">
              TMA (TRIMETHYLALUMINUM)
            </option>
            <option value="APRON BLUE">APRON BLUE</option>
            <option value="CAP">CAP</option>
            <option value="NITRILE GLOVES">NITRILE GLOVES</option>
            <option value="BEMCOT WIPERS">BEMCOT WIPERS</option>
            <option value="GASES-SILANE">GASES-SILANE</option>
          </select>
        </div>

        {/* 3. Company Name */}
        <div className="mb-4">
          <label className="block text-xl text-black">Company Name</label>
          <select
            name="companyName"
            value={formData.companyName || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md shadow-sm"
            required
          >
            <option value="">Select</option>

            <option
              value="Premier Energies Limited SURVEY NO 53 ANNARAM VILLAGAE G P ANNARAM
              JINNARAM Mandal MEDAK District, Telangana-502313 India. IEC :
              0996000402 PAN : AABCP8800D GST :36AABCP8800D1ZP"
            >
              Premier Energies Limited SURVEY NO 53 ANNARAM VILLAGAE G P ANNARAM
              JINNARAM Mandal MEDAK District, Telangana-502313 India. IEC :
              0996000402 PAN : AABCP8800D GST :36AABCP8800D1ZP
            </option>

            <option
              value="Premier Energies Photovoltaic Private Limited Plot No. 8/B/1/ and
              8/B/2 E-City, Raviryala Village, Maheshwaram Mandal, Ranga Reddy,
              Telangana, 501359,India. IEC : AAXCS4996H PAN : AAXCS4996H GST :
              36AAXCS4996H1ZB"
            >
              Premier Energies Photovoltaic Private Limited Plot No. 8/B/1/ and
              8/B/2 E-City, Raviryala Village, Maheshwaram Mandal, Ranga Reddy,
              Telangana, 501359,India. IEC : AAXCS4996H PAN : AAXCS4996H GST :
              36AAXCS4996H1ZB
            </option>
            <option
              value="Premier Energies International Private Limited- Unit 1
              Unit-I,Survey No 62 P 63P and 88 P Plot No 8/B/1 and 8/B/2,
              Raviryala Srinagar Village, Maheshwaram Mandal, Ranga Reddy
              TS,Srinagar Village, Pedda Golconda ,
              Rangareddy,Telangana,501359,India IEC : AATCA8732D PAN: AATCA8732D
              GST : 36AATCA8732D1ZF"
            >
              Premier Energies International Private Limited- Unit 1
              Unit-I,Survey No 62 P 63P and 88 P Plot No 8/B/1 and 8/B/2,
              Raviryala Srinagar Village, Maheshwaram Mandal, Ranga Reddy
              TS,Srinagar Village, Pedda Golconda ,
              Rangareddy,Telangana,501359,India IEC : AATCA8732D PAN: AATCA8732D
              GST : 36AATCA8732D1ZF
            </option>
            <option
              value="Premier Energies International Private Limited- Unit 2
              Unit-II,Plot No S-95 S-96 S-100 S-101 S-102 S-103 S-104, Raviryala
              Srinagar Village Maheswaram, FAB City, Rangareddy, Telangana,
              501359,India IEC : AATCA8732D PAN: AATCA8732D GST :
              36AATCA8732D1ZF"
            >
              Premier Energies International Private Limited- Unit 2
              Unit-II,Plot No S-95 S-96 S-100 S-101 S-102 S-103 S-104, Raviryala
              Srinagar Village Maheswaram, FAB City, Rangareddy, Telangana,
              501359,India IEC : AATCA8732D PAN: AATCA8732D GST :
              36AATCA8732D1ZF
            </option>
            <option
              value="Premier energies Global Environment Private Limited Plot No S-95,
              S-96, S-100, S-101, S-102, S-103, S-104, Raviryala, Srinagar
              Village, Maheswaram, Raviryal Industrial Area, FAB City,
              Rangareddy, Telangana – 501359,India. IEC : AALCP9141K PAN:
              AALCP9141K GST : 36AALCP9141K1ZW"
            >
              Premier energies Global Environment Private Limited Plot No S-95,
              S-96, S-100, S-101, S-102, S-103, S-104, Raviryala, Srinagar
              Village, Maheswaram, Raviryal Industrial Area, FAB City,
              Rangareddy, Telangana – 501359,India. IEC : AALCP9141K PAN:
              AALCP9141K GST : 36AALCP9141K1ZW
            </option>
            <option
              value="Premier Energies Global Environment Private Limited- Unit 2 Sy No
              303 304 305 and 306/2, EMC Maheswaram, Ranga Reddy Dist, ,
              Telangana, 501359 IEC : AALCP9141K PAN: AALCP9141K GST :
              36AALCP9141K1ZW"
            >
              Premier Energies Global Environment Private Limited- Unit 2 Sy No
              303 304 305 and 306/2, EMC Maheswaram, Ranga Reddy Dist, ,
              Telangana, 501359 IEC : AALCP9141K PAN: AALCP9141K GST :
              36AALCP9141K1ZW
            </option>
          </select>
        </div>

        {/* 4. PO Number */}
        <div className="mb-4">
          <label className="block text-xl text-black">Material PO Number</label>
          <input
            type="text"
            name="poNumber"
            value={formData.poNumber || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md shadow-sm"
            required
          />
        </div>

        {/* 5. Supplier Name */}
        <div className="mb-4">
          <label className="block text-xl text-black">Supplier Name</label>
          <select
            name="supplierName"
            value={formData.supplierName || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md shadow-sm"
            required
          >
            <option value="">Select Supplier</option>
            <option value="HORAD AUTOMATIC TECHNOLOG">
              HORAD AUTOMATIC TECHNOLOG
            </option>
            <option value="CHANGZHOU GS ENERGYAND TECH CO., LTD">
              CHANGZHOU GS ENERGYAND TECH CO., LTD
            </option>
            <option value="BUDASOL MFG.KFT">BUDASOL MFG.KFT</option>
            <option value="CHANGZHOU SVECK PHOTOVOLTNEW MATERIAL CO., LTD">
              CHANGZHOU SVECK PHOTOVOLTNEW MATERIAL CO., LTD
            </option>
            <option value="ZHEJIANG TWINSEL ELECTRONTECHNOLOGY CO., LTD.">
              ZHEJIANG TWINSEL ELECTRONTECHNOLOGY CO., LTD.
            </option>
            <option value="ZHEJIANG ZHONGHUAN SUNTERPV TECHNOLOGY CO.,LTD">
              ZHEJIANG ZHONGHUAN SUNTERPV TECHNOLOGY CO.,LTD
            </option>
            <option value="WUXI AUTOWELL SUPPLYCHAIN MANAGEMENT CO LTD">
              WUXI AUTOWELL SUPPLYCHAIN MANAGEMENT CO LTD
            </option>
            <option value="JIANGYIN HAIHONG NEWENERGY TECHNOLOGY CO., LT">
              JIANGYIN HAIHONG NEWENERGY TECHNOLOGY CO., LT
            </option>
            <option value="JIANGYIN NEW SULV TECHNOL">
              JIANGYIN NEW SULV TECHNOL
            </option>
            <option value="COVEME SPA">COVEME SPA</option>
            <option value="WUXI LEAD INTELLIGENTEQUIPMENT CO, LTD,">
              WUXI LEAD INTELLIGENTEQUIPMENT CO, LTD,
            </option>
            <option value="JIANGSU HIGHSTAR BATTERYMANUFACTURING CO.,LTD">
              JIANGSU HIGHSTAR BATTERYMANUFACTURING CO.,LTD
            </option>
            <option value="PENGYANG PUMP TAIZHOU CO.">
              PENGYANG PUMP TAIZHOU CO.
            </option>
            <option value="TARGRAY INTERNATIONAL INC">
              TARGRAY INTERNATIONAL INC
            </option>
            <option value="HANGZHOU ZHIJIANG SILICONCHEMICALS CO. LTD">
              HANGZHOU ZHIJIANG SILICONCHEMICALS CO. LTD
            </option>
            <option value="GSOLAR POWER CO LTD">GSOLAR POWER CO LTD</option>
            <option value="CENTRO ENERGY CO., LTD">
              CENTRO ENERGY CO., LTD
            </option>
            <option value="DONGGUAN DALY ELECTRONICS">
              DONGGUAN DALY ELECTRONICS
            </option>
            <option value="SHANDONG TIANQU ALUMINUM">
              SHANDONG TIANQU ALUMINUM
            </option>
            <option value="MBC SOLAR ENERGY LIMITED">
              MBC SOLAR ENERGY LIMITED
            </option>
            <option value="REIWA (YINGKOU) TRADING C">
              REIWA (YINGKOU) TRADING C
            </option>
            <option value="ENETB2C COMPANY">ENETB2C COMPANY</option>
            <option value="SHENZHEN GROWATTNEW ENERGY CO.,LIMITED">
              SHENZHEN GROWATTNEW ENERGY CO.,LIMITED
            </option>
            <option value="SENERGY TECHINICAL SERVIC(SHANGAI) CO. LTD">
              SENERGY TECHINICAL SERVIC(SHANGAI) CO. LTD
            </option>
            <option value="CHANGZHOU MANWE PV TECH C">
              CHANGZHOU MANWE PV TECH C
            </option>
            <option value="JIANGYIN XINGTONG METALPRODUCTS CO.,LTD">
              JIANGYIN XINGTONG METALPRODUCTS CO.,LTD
            </option>
            <option value="TONGWEI SOLAR CO., LTD">
              TONGWEI SOLAR CO., LTD
            </option>
            <option value="QC SOLAR (SUZHOU) CORPORA">
              QC SOLAR (SUZHOU) CORPORA
            </option>
            <option value="XINYI SOLAR MALAYSIA SDN">
              XINYI SOLAR MALAYSIA SDN
            </option>
            <option value="JIANGYIN JINGYING PHOTOVOMATERIALS CO.LTD.">
              JIANGYIN JINGYING PHOTOVOMATERIALS CO.LTD.
            </option>
            <option value="SOL-LITE MANUFACTURING CO">
              SOL-LITE MANUFACTURING CO
            </option>
            <option value="HANGZHOU FIRST APPLIED MALTD.">
              HANGZHOU FIRST APPLIED MALTD.
            </option>
            <option value="XI'AN TELISON NEW MATERIA">
              XI AN TELISON NEW MATERIAL
            </option>
            <option value="COVEME ENGINEERED FILMS Z">
              COVEME ENGINEERED FILMS Z
            </option>
            <option value="JOLYWOOD(SUZHOU) SUNWATT">
              JOLYWOOD(SUZHOU) SUNWATT
            </option>
            <option value="SHANGHAI SOSUN NEW ENERGYTECHNOLOGY CO.,LTD.">
              SHANGHAI SOSUN NEW ENERGYTECHNOLOGY CO.,LTD.
            </option>
            <option value="WEGOMA ASIA LIMITED">WEGOMA ASIA LIMITED</option>
            <option value="POWERCHINA TRADE SOLUTION">
              POWERCHINA TRADE SOLUTION
            </option>
            <option value="JIANGYIN TIANMU GREEN ENETECHNOLOGY CO.,LTD">
              JIANGYIN TIANMU GREEN ENETECHNOLOGY CO.,LTD
            </option>
            <option value="CHANGZHOU FUFENG MATERIALTECHNOLOGY CO.,LTD">
              CHANGZHOU FUFENG MATERIALTECHNOLOGY CO.,LTD
            </option>
            <option value="TAICANG JUREN INTERNATIONTRADE CO., LTD.">
              TAICANG JUREN INTERNATIONTRADE CO., LTD.
            </option>
            <option value="SHANDONG TIANQU ENGINEERI">
              SHANDONG TIANQU ENGINEERI
            </option>
            <option value="HARTALEGA NGC SDN BHD">HARTALEGA NGC SDN BHD</option>
            <option value="SHENZHEN S.C NEW ENERGYTECHNOLOGY CORPORATION">
              SHENZHEN S.C NEW ENERGYTECHNOLOGY CORPORATION
            </option>
            <option value="CENTROTHERM INTERNATIONAL">
              CENTROTHERM INTERNATIONAL
            </option>
            <option value="GARBER TRADE LIMITED">GARBER TRADE LIMITED</option>
            <option value="FLAT(HONG KONG)CO.,LTD">
              FLAT(HONG KONG)CO.,LTD
            </option>
            <option value="NINGBO GZX PV TECHNOLOGY">
              NINGBO GZX PV TECHNOLOGY
            </option>
            <option value="VIVA SOLAR FZC">VIVA SOLAR FZC</option>
            <option value="SHANGHAI SUNTECH POWERTECHNOLOGY CO., LTD">
              SHANGHAI SUNTECH POWERTECHNOLOGY CO., LTD
            </option>
            <option value="INGENIOUS AUTOMATIC GROUP">
              INGENIOUS AUTOMATIC GROUP
            </option>
            <option value="H.A.L.M ELEKRONIK GMBH">
              H.A.L.M ELEKRONIK GMBH
            </option>
            <option value="CHANGZHOU HERSHEY-POWERNEW ENERGY CO.,LTD">
              CHANGZHOU HERSHEY-POWERNEW ENERGY CO.,LTD
            </option>
            <option value="SUZHOU AUTOWAY SYSTEM CO.">
              SUZHOU AUTOWAY SYSTEM CO.
            </option>
            <option value="ZHUHAI GMEE SOLAR EQUIPME">
              ZHUHAI GMEE SOLAR EQUIPME
            </option>
            <option value="HERAEUS MATERIALS SINGAPO">
              HERAEUS MATERIALS SINGAPO
            </option>
            <option value="CHANGZHOU S.C SMART EQUIP">
              CHANGZHOU S.C SMART EQUIP
            </option>
            <option value="DAS ENVIRONMENTAL EXPERTS">
              DAS ENVIRONMENTAL EXPERTS
            </option>
            <option value="SHANGHAI PENGQIAN TRANSMIEQUIPMENT CO.,LTD">
              SHANGHAI PENGQIAN TRANSMIEQUIPMENT CO.,LTD
            </option>
            <option value="INTERNATIONAL ELECTROTECHCOMMISSION">
              INTERNATIONAL ELECTROTECHCOMMISSION
            </option>
            <option value="FREIBERG INSTRUMENTS GMBH">
              FREIBERG INSTRUMENTS GMBH
            </option>
            <option value="JIA YUE GROUP CO., LTD">
              JIA YUE GROUP CO., LTD
            </option>
            <option value="DIGI-KEY ELECTRONICS">DIGI-KEY ELECTRONICS</option>
            <option value="YINGKOU JINCHEN MACHINERY">
              YINGKOU JINCHEN MACHINERY
            </option>
            <option value="TUV NORD (HANGZHOU) CO.,">
              TUV NORD (HANGZHOU) CO.,
            </option>
            <option value="HERAEUS PHOTOVOLTAICS SIN">
              HERAEUS PHOTOVOLTAICS SIN
            </option>
            <option value="SUZHOU ENJOYSUN TECHNOLOG">
              SUZHOU ENJOYSUN TECHNOLOG
            </option>
            <option value="CHANGZHOU S.C EXACT EQUIP">
              CHANGZHOU S.C EXACT EQUIP
            </option>
            <option value="SOLAMET ELECTRONIC MATERI(H.K) LIMITED">
              SOLAMET ELECTRONIC MATERI(H.K) LIMITED
            </option>
            <option value="EVOQUA WATER TECHNOLOGIES">
              EVOQUA WATER TECHNOLOGIES
            </option>
            <option value="SHENZHEN EMBRACE GLORY ELMATERIAL CO.,LTD">
              SHENZHEN EMBRACE GLORY ELMATERIAL CO.,LTD
            </option>
            <option value="ZHONGLI TALESUN HONG KONG">
              ZHONGLI TALESUN HONG KONG
            </option>
            <option value="CHANGZHOU FUSION NEW MATECO., LTD">
              CHANGZHOU FUSION NEW MATECO., LTD
            </option>
            <option value="INSPIRED ENERGY CO LTD">
              INSPIRED ENERGY CO LTD
            </option>
            <option value="NA">NA</option>
            <option value="JIANGSU FUJIHALO NEW ENER">
              JIANGSU FUJIHALO NEW ENER
            </option>
            <option value="XINYI SOLAR (HONG KONG)">
              XINYI SOLAR (HONG KONG)
            </option>
            <option value="FEEJOY TECHNOLOGY(SHANGHA">
              FEEJOY TECHNOLOGY(SHANGHA
            </option>
            <option value="ATLAS COPCO (WUXI) COMPRE">
              ATLAS COPCO (WUXI) COMPRE
            </option>
            <option value="GCL SOLAR POWER(SUZHOU)LMITED">
              GCL SOLAR POWER(SUZHOU)LMITED
            </option>
            <option value="RENA TECHNOLOGIES GMBH">
              RENA TECHNOLOGIES GMBH
            </option>
            <option value="SUZHOU TOPS NEW MATERIAL">
              SUZHOU TOPS NEW MATERIAL
            </option>
            <option value="ASIA NEO TECH INDUSTRIALCO., LTD">
              ASIA NEO TECH INDUSTRIALCO., LTD
            </option>
            <option value="AKCOME METALS TECHNOLOGY(CO.,LTD">
              AKCOME METALS TECHNOLOGY CO.,LTD
            </option>
            <option value="MAXWELL TECHNOLOGY PTE. L">
              MAXWELL TECHNOLOGY PTE. L
            </option>
            <option value="ZHEJIANG AIKO SOLAR TECHNCO., LTD">
              ZHEJIANG AIKO SOLAR TECHNCO., LTD
            </option>
            <option value="WUXI RUXING TECHNOLOGYDEVELOPMENT CO. LTD">
              WUXI RUXING TECHNOLOGYDEVELOPMENT CO. LTD
            </option>
            <option value="FRAUNHOFER INSTITUT FUERSOLARE ENER-GIESYSTEM">
              FRAUNHOFER INSTITUT FUERSOLARE ENER-GIESYSTEM
            </option>
            <option value="WUHAN DR LASER TECHNOLOGYCORP., LTD">
              WUHAN DR LASER TECHNOLOGYCORP., LTD
            </option>
            <option value="WUXI HIGHLIGHT NEW ENERGY">
              WUXI HIGHLIGHT NEW ENERGY
            </option>
            <option value="GIGA SOLAR MATERIALS CORP">
              GIGA SOLAR MATERIALS CORP
            </option>
            <option value="BYSOL-LITE MANUFACTURING">
              BYSOL-LITE MANUFACTURING
            </option>
            <option value="KOMEX INC">KOMEX INC</option>
            <option value="BRAVE C&H SUPPLY CO., LTD">
              BRAVE C&H SUPPLY CO., LTD
            </option>
            <option value="GUANGZHOU BAIYUN TECHNOLOCO.,LTD.">
              GUANGZHOU BAIYUN TECHNOLOCO.,LTD.
            </option>
            <option value="SUNFONERGY TECHNOLOGIES (">
              SUNFONERGY TECHNOLOGIES
            </option>
            <option value="JIANGSU HUAHENG NEW ENERGCO., LTD.">
              JIANGSU HUAHENG NEW ENERGCO., LTD.
            </option>
            <option value="JIANGXI HONGGE TECHNOLOGY">
              JIANGXI HONGGE TECHNOLOGY
            </option>
            <option value="ROBOTECHNIK INTELLIGENT TCO., LTD.">
              ROBOTECHNIK INTELLIGENT TCO., LTD.
            </option>
            <option value="CHANGZHOU PLET INTERNATIOCO., LTD.">
              CHANGZHOU PLET INTERNATIOCO., LTD.
            </option>
            <option value="GENERAL SOLUTIONS &amp; TRADI">
              GENERAL SOLUTIONS &amp; TRADI
            </option>
            <option value="TANGSHAN YANGTAI IMPORT&amp;EXPORT TRADE CO. LTD.">
              TANGSHAN YANGTAI IMPORT&amp;EXPORT TRADE CO. LTD.
            </option>
            <option value="SHENZHEN S.C NEW ENERGYTECHNOLOGY CORPORATION">
              SHENZHEN S.C NEW ENERGYTECHNOLOGY CORPORATION
            </option>
            <option value="SUZHOU SUNERGY TECHNOLOGY">
              SUZHOU SUNERGY TECHNOLOGY
            </option>
            <option value="SINGAPORE SATORI PTE.LTD">
              SINGAPORE SATORI PTE.LTD
            </option>
            <option value="HENGDIAN GROUP DMEGC MAGN">
              HENGDIAN GROUP DMEGC MAGN
            </option>
            <option value="DAS ENVIRONMENTAL EXPERTS">
              DAS ENVIRONMENTAL EXPERTS
            </option>
            {/* --- Continue with the rest of your supplier options exactly as provided --- */}
            <option value="SHENZHEN BEITE PURIFICATICO., LTD">
              SHENZHEN BEITE PURIFICATICO., LTD
            </option>
            <option value="XIAMEN XIANGYU NEW ENERGY">
              XIAMEN XIANGYU NEW ENERGY
            </option>
            <option value="ISRA VISION GMBH">ISRA VISION GMBH</option>
            <option value="GNBS ECO CO.,LTD">GNBS ECO CO.,LTD</option>
            <option value="JIANGXI RISUNSOLARSALES C">
              JIANGXI RISUNSOLARSALES C
            </option>
            <option value="WUJIANG CSG GLASS CO., LT">
              WUJIANG CSG GLASS CO., LT
            </option>
            <option value="DAS ENVIRONMENTAL EQUIPMEPTE LTD">
              DAS ENVIRONMENTAL EQUIPMEPTE LTD
            </option>
            <option value="SHENZHEN OUBEL TECHNOLOGY">
              SHENZHEN OUBEL TECHNOLOGY
            </option>
            <option value="NMTORNICS (INDIA)- KERRYSEZ UNIT">
              NMTORNICS (INDIA)- KERRYSEZ UNIT
            </option>
            <option value="DONGGUAN CSG SOLAR GLASS">
              DONGGUAN CSG SOLAR GLASS
            </option>
            <option value="CYBRID TECHNOLOGIES INC">
              CYBRID TECHNOLOGIES INC
            </option>
            <option value="CHIZHOU ANAN ALUMINUM CO.">
              CHIZHOU ANAN ALUMINUM CO.
            </option>
            <option value="XINYI PV PRODUCTS(ANHUI)LTD.">
              XINYI PV PRODUCTS(ANHUI)LTD.
            </option>
            <option value="RADIATION TECHNOLOGY CO.,">
              RADIATION TECHNOLOGY CO.,
            </option>
            <option value="SHENZHEN TOPRAY SOLAR CO.">
              SHENZHEN TOPRAY SOLAR CO.
            </option>
            <option value="GUANGDONG JINWAN GAOJINGENERGY TECHNOLOGY">
              GUANGDONG JINWAN GAOJINGENERGY TECHNOLOGY
            </option>
            <option value="CHUXIONG LONGI SILICON MACO.,LTD">
              CHUXIONG LONGI SILICON MACO.,LTD
            </option>
            <option value="SHANGRAO JIETAI NEW ENERG">
              SHANGRAO JIETAI NEW ENERG
            </option>
            <option value="SUZHOU SHENGCHENG SOLAR ECO., LTD">
              SUZHOU SHENGCHENG SOLAR ECO., LTD
            </option>
            <option value="CLIMAVENETA CHAT UNION REEQUIPMENT (SHANGHAI) CO.,">
              CLIMAVENETA CHAT UNION REEQUIPMENT (SHANGHAI) CO.,
            </option>
            <option value="SHENGCHENG TECHNOLOGY PTE">
              SHENGCHENG TECHNOLOGY PTE
            </option>
            <option value="PASAN SA">PASAN SA</option>
            <option value="BENTHAM INSTRUMENTS LTD">
              BENTHAM INSTRUMENTS LTD
            </option>
            <option value="CHUZHOU JIETAI NEW ENERGYTECHNOLOGY CO.">
              CHUZHOU JIETAI NEW ENERGYTECHNOLOGY CO.
            </option>
            <option value="TECH GATE ENGINEERING PTE">
              TECH GATE ENGINEERING PTE
            </option>
            <option value="TERASOLAR ENERGY MATERIAL">
              TERASOLAR ENERGY MATERIAL
            </option>
            <option value="JIANGSU PROVINCIAL FOREIGTRADE CORPORATION">
              JIANGSU PROVINCIAL FOREIGTRADE CORPORATION
            </option>
            <option value="JIANGSU HUANENG INTELLIGEENERGY SUPPLY CHAIN TECHN">
              JIANGSU HUANENG INTELLIGEENERGY SUPPLY CHAIN TECHN
            </option>
            <option value="SOLAR LONG PV-TECH (CAMBOCO., LTD.">
              SOLAR LONG PV-TECH CAMBOCO., LTD.
            </option>
            <option value="AIDU ENERGY CO.,LTD">AIDU ENERGY CO.,LTD</option>
            <option value="AIDU ENERGY PTE.LTD.">AIDU ENERGY PTE.LTD.</option>
            <option value="RE PLUS EVENTS, LLC">RE PLUS EVENTS, LLC</option>
            <option value="JIANGYIN TINZE NEW ENERGYTECHNOLOGY CO.,LTD">
              JIANGYIN TINZE NEW ENERGYTECHNOLOGY CO.,LTD
            </option>
            <option value="SHANGHAI HUITIAN NEWMATERIAL CO.,LTD.">
              SHANGHAI HUITIAN NEWMATERIAL CO.,LTD.
            </option>
            <option value="ZHONGHUAN HONG KONGHOLDING LIMITED">
              ZHONGHUAN HONG KONGHOLDING LIMITED
            </option>
            <option value="SEMILAB SEMICONDUCTORPHYSICS LABORATORY CO. LT">
              SEMILAB SEMICONDUCTORPHYSICS LABORATORY CO. LT
            </option>
            <option value="SOLAMET ELECTONIC MATERIA(H.K) LIMITED">
              SOLAMET ELECTONIC MATERIA(H.K) LIMITED
            </option>
            <option value="KINGRAYLAND TECHNOLOGY CO">
              KINGRAYLAND TECHNOLOGY CO
            </option>
            <option value="HK APK LIMITED">HK APK LIMITED</option>
            <option value="SHANHAI SUPER SOLAR NEWENERGY TECHNOLOGY">
              SHANHAI SUPER SOLAR NEWENERGY TECHNOLOGY
            </option>
            <option value="ZEALWE TECHNICAL CO., LTD">
              ZEALWE TECHNICAL CO., LTD
            </option>
            <option value="HLA SUPPLY CHAIN SOLUTION">
              HLA SUPPLY CHAIN SOLUTION
            </option>
            <option value="CYBRID TECHNOLOGIES (ZHEJ">
              CYBRID TECHNOLOGIES (ZHEJ
            </option>
            <option value="SHANGHAI BERLING TECHNOLOCO., LTD">
              SHANGHAI BERLING TECHNOLOCO., LTD
            </option>
            <option value="SHANDONG AOSHIGARMENT CO.">
              SHANDONG AOSHIGARMENT CO.
            </option>
            <option value="ZHANGJIAGANG SIMPULSE-TEC">
              ZHANGJIAGANG SIMPULSE-TEC
            </option>
            <option value="WATERON TECHNOLOGY (HONGCO., LTD.">
              WATERON TECHNOLOGY HONGCO., LTD.
            </option>
            <option value="XIAMEN C&D COMMODITY TRAD">
              XIAMEN C&D COMMODITY TRAD
            </option>
            <option value="SINGAPORE ASAHI CHEMICALSOLDER INDUSTRIES PVT LTD">
              SINGAPORE ASAHI CHEMICALSOLDER INDUSTRIES PVT LTD
            </option>
            <option value="BRIGHTSPOT AUTOMATION LLP">
              BRIGHTSPOT AUTOMATION LLP
            </option>
            <option value="SUZHOU  DRLINK  AUTOMATIOTECHNOLOGY CO, LTD.">
              SUZHOU DRLINK AUTOMATIOTECHNOLOGY CO, LTD.
            </option>
            <option value="NINGBO EXCITON NEWENERGY CO.,LTD">
              NINGBO EXCITON NEWENERGY CO.,LTD
            </option>
            <option value="VOYAGER TRADINGPARTNERS LLC">
              VOYAGER TRADINGPARTNERS LLC
            </option>
            <option value="JIANGSU PHOENTY PHOTOELECTECNOLOGY CO.,LTD">
              JIANGSU PHOENTY PHOTOELECTECNOLOGY CO.,LTD
            </option>
            <option value="JIANGSU MINGHAO NEW MATERSCI-TECH CORPORATION">
              JIANGSU MINGHAO NEW MATERSCI-TECH CORPORATION
            </option>
            <option value="DRIP CAPITAL, INC.">DRIP CAPITAL, INC.</option>
            <option value="CV. BALI EXPORT IMPORT">
              CV. BALI EXPORT IMPORT
            </option>
            <option value="WUXI DK ELECTRONIC MATERICO., LTD">
              WUXI DK ELECTRONIC MATERICO., LTD
            </option>
            <option value="SUZHOU ISILVER MATERIALSCO., LTD.">
              SUZHOU ISILVER MATERIALSCO., LTD.
            </option>
            <option value="TIANJIN AIKO SOLAR TECHOLCO., LTD.">
              TIANJIN AIKO SOLAR TECHOLCO., LTD.
            </option>
            <option value="ZHEJIANG NINGHAI KIBINGNEW ENERGY MANAGEMENT CO.">
              ZHEJIANG NINGHAI KIBINGNEW ENERGY MANAGEMENT CO.
            </option>
            <option value="JIANGXI TOPSUN SOLAR TECHCO., LTD">
              JIANGXI TOPSUN SOLAR TECHCO., LTD
            </option>
            <option value="PFEIFFER VACUUM SAS">PFEIFFER VACUUM SAS</option>
            <option value="ZHEJIANG RENHE PHOTOVOLTATECHNOLOGY CO.,LTD">
              ZHEJIANG RENHE PHOTOVOLTATECHNOLOGY CO.,LTD
            </option>
            <option value="JIANGSU MEIKE SOLAR TECHN">
              JIANGSU MEIKE SOLAR TECHN
            </option>
            <option value="WUXI HIGHLIGHT NEW ENERGYTECHNOLOGY CO., LTD">
              WUXI HIGHLIGHT NEW ENERGYTECHNOLOGY CO., LTD
            </option>
            <option value="JIANGYIN YUANSHUO METALTECHNOLOGY CO., LTD.">
              JIANGYIN YUANSHUO METALTECHNOLOGY CO., LTD.
            </option>
            <option value="JIANGSU HOLYSUN ELECTRONITECHNOLOGY CO., LTD.">
              JIANGSU HOLYSUN ELECTRONITECHNOLOGY CO., LTD.
            </option>
            <option value="SCENERGY TECHNOLOGY LIMIT">
              SCENERGY TECHNOLOGY LIMIT
            </option>
            <option value="PURITECH CO., LTD.">PURITECH CO., LTD.</option>
            <option value="AIR GAS ELECTRONICMATERIALS ENTERPRISE CO.">
              AIR GAS ELECTRONICMATERIALS ENTERPRISE CO.
            </option>
            <option value="ANHUI CSG NEW ENERGYMATERIAL TECHNOLOGY CO.,L">
              ANHUI CSG NEW ENERGYMATERIAL TECHNOLOGY CO.,L
            </option>
            <option value="SUZHOU MAXWELL TECHNOLOGICO., LTD.">
              SUZHOU MAXWELL TECHNOLOGICO., LTD.
            </option>
            <option value="WUXI LERIN NEW ENERGYTECHNOLOGY CO.,LTD">
              WUXI LERIN NEW ENERGYTECHNOLOGY CO.,LTD
            </option>
            <option value="WUXI U PLUSTECHNOLOGY CO.LTD">
              WUXI U PLUSTECHNOLOGY CO.LTD
            </option>
            <option value="HONGYUAN NEW MATERIAL(BAOTOU) CO., LTD.">
              HONGYUAN NEW MATERIAL(BAOTOU) CO., LTD.
            </option>
            <option value="SUZHOU SHD INTELLIGENTTECHNOLOGIES CO., LTD.">
              SUZHOU SHD INTELLIGENTTECHNOLOGIES CO., LTD.
            </option>
            <option value="SHUANGLIANG INTERNATIONAL(SHANGHAI) CO., LTD">
              SHUANGLIANG INTERNATIONAL(SHANGHAI) CO., LTD
            </option>
            <option value="SHANGHAI XINZHUOZHUANGPRINTING TECHNOLOGY CO.,">
              SHANGHAI XINZHUOZHUANGPRINTING TECHNOLOGY CO.,
            </option>
            <option value="VOSTRO ELECTRONICTECHNOLOGY(SUZHOU)CO.,LTD">
              VOSTRO ELECTRONICTECHNOLOGY(SUZHOU)CO.,LTD
            </option>
            <option value="SUZHOU FLY SOLARTECHNOLOGY CO. , LTD">
              SUZHOU FLY SOLARTECHNOLOGY CO. , LTD
            </option>
            <option value="ZHEJIANG DOUBLE HEAD EAGLIMPORT&amp;EXPORT CO.,LTD.">
              ZHEJIANG DOUBLE HEAD EAGLIMPORT&amp;EXPORT CO.,LTD.
            </option>
            <option value="MEHTA PTE LTD.">MEHTA PTE LTD.</option>
            <option value="HANG YUE TONGCOMPANY LIMITED">
              HANG YUE TONGCOMPANY LIMITED
            </option>
            <option value="XIAMEN CANDOUR CO., LTD">
              XIAMEN CANDOUR CO., LTD
            </option>
            <option value="FRINTRUP NB SPECIAL SCREETECHNOLOGY (KUNSHAN) CO.,">
              FRINTRUP NB SPECIAL SCREETECHNOLOGY (KUNSHAN) CO.,
            </option>
            <option value="SOLAR N PLUS NEW ENERGYTECHNOLOGY CO., LTD.">
              SOLAR N PLUS NEW ENERGYTECHNOLOGY CO., LTD.
            </option>
            <option value="SNL CORPORATION">SNL CORPORATION</option>
            <option value="DONGGUAN MIVISIONTECHNOLOGY CO., LTD">
              DONGGUAN MIVISIONTECHNOLOGY CO., LTD
            </option>
            <option value="JIANGSU HAITIANMICROELECTRONICS CORP.">
              JIANGSU HAITIANMICROELECTRONICS CORP.
            </option>
            <option value="CHANGSHU TOPS PV MATERIAL">
              CHANGSHU TOPS PV MATERIAL
            </option>
            <option value="FUJIAN  UNITE  MATERIALTECHNOLOGY  CO., LTD.">
              FUJIAN UNITE MATERIALTECHNOLOGY CO., LTD.
            </option>
            <option value="SUZHOU QIANTONG INSTRUMENEQUIPMENT CO., LTD.">
              SUZHOU QIANTONG INSTRUMENEQUIPMENT CO., LTD.
            </option>
            <option value="FUSION MATERIAL TECHNOLOG">
              FUSION MATERIAL TECHNOLOG
            </option>
            <option value="TONGWEI SOLAR (MEISHAN) C">
              TONGWEI SOLAR (MEISHAN) C
            </option>
            <option value="QINGDAO GAOCE TECHNOLOGY">
              QINGDAO GAOCE TECHNOLOGY
            </option>
            <option value="DONGGUAN MINWEI PHOTOELECTECHNOLOGY">
              DONGGUAN MINWEI PHOTOELECTECHNOLOGY
            </option>
            <option value="T-SUN NEW ENERGY LIMITED">
              T-SUN NEW ENERGY LIMITED
            </option>
            <option value="JIANGSU TONGLING ELECTRIC">
              JIANGSU TONGLING ELECTRIC
            </option>
            <option value="GEMUE GEBR MUELLER APPARAGMBH &amp; CO">
              GEMUE GEBR MUELLER APPARAGMBH &amp; CO
            </option>
            <option value="SICHUAN MEIKE NEW ENERGY">
              SICHUAN MEIKE NEW ENERGY
            </option>
            <option value="LONGI GREEN ENERGY TECHNO">
              LONGI GREEN ENERGY TECHNO
            </option>
            <option value="INTRALINKS INC.">INTRALINKS INC.</option>
            <option value="IDEAL DEPOSITION EQUIPMENAND APPLICATIONS(ZHEJIANG">
              IDEAL DEPOSITION EQUIPMENAND APPLICATIONS(ZHEJIANG
            </option>
            <option value="FUZHOU ANTONG NEW MATERIATECHNOLOGY CO.,LTD.">
              FUZHOU ANTONG NEW MATERIATECHNOLOGY CO.,LTD.
            </option>
            <option value="JIANGSU KUNA NEW ENERGY C">
              JIANGSU KUNA NEW ENERGY C
            </option>
            <option value="SKY GLOVES">SKY GLOVES</option>
            <option value="VIETNAM ADVANCE FILM MATECOMPANY LIMITED">
              VIETNAM ADVANCE FILM MATECOMPANY LIMITED
            </option>
            <option value="CHANGZHOU CHENNAI NEW ENECO.,LTD">
              CHANGZHOU CHENNAI NEW ENECO.,LTD
            </option>
            <option value="AN LAM CO., LTD">AN LAM CO., LTD</option>
            <option value="SUZHOU CHANGQING NEWMATERIAL CO., LTD.">
              SUZHOU CHANGQING NEWMATERIAL CO., LTD.
            </option>
            <option value="ICB GMBH &amp; CO. KG">ICB GMBH &amp; CO. KG</option>
            <option value="C AND B INTERNATIONAL HOL">
              C AND B INTERNATIONAL HOL
            </option>
            <option value="HUAIAN JIETAI NEW ENERGYTECHNOLOGY CO LTD">
              HUAIAN JIETAI NEW ENERGYTECHNOLOGY CO LTD
            </option>
            <option value="SUZHOU YOURBEST NEW-TYPEMATERIALS CO.,LTD">
              SUZHOU YOURBEST NEW-TYPEMATERIALS CO.,LTD
            </option>
            <option value="JOHNSON CONTROLS (S) PTE.">
              JOHNSON CONTROLS (S) PTE.
            </option>
            <option value="FOMEX GLOBAL JOINT STOCK">
              FOMEX GLOBAL JOINT STOCK
            </option>
            <option value="BETTERIAL ( VIET NAM ) FICOMPANY  LIMITED">
              BETTERIAL ( VIET NAM ) FICOMPANY LIMITED
            </option>
            <option value="SHENZHEN PARTNERAE ELECTR">
              SHENZHEN PARTNERAE ELECTR
            </option>
            <option value="EMPIRE PUMPS LTD.">EMPIRE PUMPS LTD.</option>
            <option value="JIANGSU LONGHENG NEW ENERCO., LTD">
              JIANGSU LONGHENG NEW ENERCO., LTD
            </option>
            <option value="CHUZHOU AIKO SOLAR TECHNO">
              CHUZHOU AIKO SOLAR TECHNO
            </option>
            <option value="CE CELL ENGINEERING GMBH">
              CE CELL ENGINEERING GMBH
            </option>
            <option value="SHANGHAI YANG ER IMPORT ACOMPANY LTD">
              SHANGHAI YANG ER IMPORT ACOMPANY LTD
            </option>
            <option value="GUANGZHOU YICHUANG ELECTR">
              GUANGZHOU YICHUANG ELECTR
            </option>
            <option value="SHENZHEN SOFARSOLAR CO.,">
              SHENZHEN SOFARSOLAR CO.,
            </option>
            <option value="ANHUI SHIJING SOLARPOWERTECHNOLOGY CO.,LTD">
              ANHUI SHIJING SOLARPOWERTECHNOLOGY CO.,LTD
            </option>
            <option value="SOLAR EQ TECHNOLOGY EUROP">
              SOLAR EQ TECHNOLOGY EUROP
            </option>
            <option value="SHAOXING TUOBANG NEWENERGY CO., LTD.">
              SHAOXING TUOBANG NEWENERGY CO., LTD.
            </option>
            <option value="FOXESS CO., LTD.">FOXESS CO., LTD.</option>
            <option value="TONGWEI SOLAR (PENGSHAN)CO., LTD.">
              TONGWEI SOLAR (PENGSHAN)CO., LTD.
            </option>
            {/* Finally, include an "Other" option */}
            <option value="Other">Other</option>
          </select>
        </div>

        {/* If "Other" is selected, show an input field */}
        {formData.supplierName === "Other" && (
          <div className="mb-4">
            <label className="block text-xl text-black">
              Enter Supplier Name
            </label>
            <input
              type="text"
              name="supplierNameOther"
              value={formData.supplierNameOther || ""}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md shadow-sm"
              required
            />
          </div>
        )}

        {/* 6. Port of Loading */}
        <div className="mb-4">
          <label className="block text-xl text-black">Port of Loading</label>
          <select
            name="portOfLoading"
            value={formData.portOfLoading || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md shadow-sm"
            required
          >
            <option value="">Select Port of Loading</option>
            <option value="Shanghai">Shanghai</option>
            <option value="Ningbo">Ningbo</option>
            <option value="Port klang">Port klang</option>
            <option value="Haiphong">Haiphong</option>
            <option value="Shekou">Shekou</option>
            <option value="Shenzhen">Shenzhen</option>
            <option value="Tianjin">Tianjin</option>
            <option value="Dalian">Dalian</option>
            <option value="Hamburg">Hamburg</option>
            <option value="Nansha">Nansha</option>
          </select>
        </div>

        {/* 7. Port of Destination */}
        <div className="mb-4">
          <label className="block text-xl text-black">
            Port of Destination
          </label>
          <select
            name="portOfDestination"
            value={formData.portOfDestination || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md shadow-sm"
            required
          >
            <option value="">Select Destination Port</option>
            <option value="Chennai/Ennore /Kattupalli">
              Chennai/Ennore /Kattupalli
            </option>
            <option value="Nhava Sheva">Nhava Sheva</option>
            <option value="ICD-Hyderabad">ICD-Hyderabad</option>
            <option value="Hyderabad Airport">Hyderabad Airport</option>
            <option value="Chennai airport">Chennai airport</option>
            <option value="Mumbai Airport">Mumbai Airport</option>
          </select>
        </div>

        {/* 8. Container Type */}
        <div className="mb-4">
          <label className="block text-xl text-black">Container Type</label>
          <select
            name="containerType"
            value={formData.containerType || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md shadow-sm"
            required
          >
            <option value="">Select Container Type</option>
            <option value="LCL">LCL</option>
            <option value="20’GP">20’GP</option>
            <option value="40’HC">40’HC</option>
            <option value="40’FR">40’FR</option>
            <option value="40’OT">40’OT</option>
            <option value="20’OT">20’OT</option>
          </select>
        </div>

        {/* 9. Number of Containers */}
        <div className="mb-4">
          <label className="block text-xl text-black">
            Number of Containers
          </label>
          <input
            type="number"
            name="numberOfContainers"
            value={formData.numberOfContainers || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md shadow-sm"
            required
          />
          {errors.numberOfContainers && (
            <p className="text-red-600 font-bold mt-1">
              {errors.numberOfContainers}
            </p>
          )}
        </div>

        {/* 10. Cargo Weight in Container */}
        <div className="mb-4">
          <label className="block text-xl text-black">
            Cargo Weight in Container (In Tons)
          </label>
          <input
            type="number"
            name="cargoWeightInContainer"
            value={formData.cargoWeightInContainer || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md shadow-sm"
            required
          />
          {errors.cargoWeightInContainer && (
            <p className="text-red-600 font-bold mt-1">
              {errors.cargoWeightInContainer}
            </p>
          )}
        </div>

        {/* 11. Cargo Readiness Date */}
        <div className="mb-4">
          <label className="block text-xl text-black">
            Tentative Cargo Readiness Date
          </label>
          <input
            type="date"
            name="cargoReadinessDate"
            value={formData.cargoReadinessDate || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md shadow-sm"
            required
          />
        </div>

        {/* 12. Initial Quote End Time */}
        <div className="mb-4">
          <label className="block text-xl text-black">
            Initial Quote End Time
          </label>
          <input
            type="datetime-local"
            name="initialQuoteEndTime"
            value={formData.initialQuoteEndTime || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md"
            required
          />
        </div>

        {/* 13. Evaluation End Time */}
        <div className="mb-4">
          <label className="block text-xl text-black">
            Evaluation End Time
          </label>
          <input
            type="datetime-local"
            name="evaluationEndTime"
            value={formData.evaluationEndTime || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md"
            required
          />
        </div>

        {/* 14. E-Reverse Toggle 
        <div className="mb-4">
          <label className="block text-xl text-black">
            E-Reverse
          </label>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              name="eReverseToggle"
              checked={!!formData.eReverseToggle}
              onChange={handleChange}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:bg-indigo-600 peer-focus:ring-2 peer-focus:ring-indigo-500 transition-all duration-300"></div>
            <div className="dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-300 transform peer-checked:translate-x-full" />
          </label>
        </div> */}

        {/* Conditionally show eReverseDate/time */}
        {formData.eReverseToggle && (
          <>
            <div className="mb-4">
              <label className="block text-xl text-black">E-Reverse Date</label>
              <input
                type="date"
                name="eReverseDate"
                value={formData.eReverseDate || ""}
                onChange={handleChange}
                className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md"
                required={formData.eReverseToggle}
              />
            </div>
            <div className="mb-4">
              <label className="block text-xl text-black">E-Reverse Time</label>
              <input
                type="time"
                name="eReverseTime"
                value={formData.eReverseTime || ""}
                onChange={handleChange}
                className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md"
                required={formData.eReverseToggle}
              />
            </div>
          </>
        )}

        {/* New Description Field */}
        <div className="mb-4 md:col-span-3">
          <label className="block text-xl text-black">
            Description (Optional)
          </label>
          <textarea
            name="description"
            value={formData.description || ""}
            onChange={handleChange}
            placeholder="Paste any data here..."
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md shadow-sm"
            rows="4"
          />
        </div>

        {/* 15. RFQ Closing Date & Time */}
        <div className="mb-4">
          <label className="block text-xl text-black">RFQ Closing Date</label>
          <input
            type="date"
            name="RFQClosingDate"
            value={formData.RFQClosingDate || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md"
            required
          />
        </div>

        <div className="mb-4">
          <label className="block text-xl text-black">RFQ Closing Time</label>
          <input
            type="time"
            name="RFQClosingTime"
            value={formData.RFQClosingTime || ""}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-black bg-gray-200 rounded-md"
            required
          />
        </div>

        {/* 16. Select Service Providers */}
        <div className="mb-4 md:col-span-3">
          <label className="text-black mb-2 font-bold text-xl">
            Select Service Providers:
          </label>
          <div className="mt-2 overflow-x-auto">
            {vendors.length > 0 ? (
              <table className="min-w-full divide-y border-black rounded-lg divide-black">
                <thead className="bg-gray-700 text-white">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-white">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id="selectAllVendors"
                          checked={
                            vendors.length > 0 &&
                            selectedVendors.length === vendors.length
                          }
                          onChange={handleSelectAllVendors}
                          className="form-checkbox h-4 w-4 text-indigo-600 mr-2"
                        />
                        <label
                          htmlFor="selectAllVendors"
                          className="text-white"
                        >
                          Select All
                        </label>
                      </div>
                    </th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-white">
                      Company / Vendor
                    </th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-white">
                      Email
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-black">
                  {vendors.map((vendor) => (
                    <tr key={vendor._id} className="hover:bg-gray-200">
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          id={vendor._id}
                          checked={selectedVendors.includes(vendor._id)}
                          onChange={() => handleVendorSelection(vendor._id)}
                          className="form-checkbox h-4 w-4 text-indigo-600"
                        />
                      </td>
                      <td className="px-4 py-2 text-sm text-black">
                        {vendor.vendorName}
                      </td>
                      <td className="px-4 py-2 text-sm text-black">
                        {vendor.email}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No inbound vendors available to select.</p>
            )}
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          className={`md:col-span-3 bg-indigo-600 hover:bg-indigo-900 text-white font-bold py-2 px-4 rounded ${
            isLoading ? "cursor-not-allowed opacity-50" : ""
          }`}
          disabled={isLoading}
        >
          {isLoading ? "Submitting..." : "Submit Inbound RFQ"}
        </button>
      </form>
    </div>
  );
};

export default NewRFQForm;
