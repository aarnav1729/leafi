// root/src/pages/logistics/RFQList.tsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/common/StatusBadge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import api from "@/lib/api";
import { RFQ } from "@/types/rfq.types";

interface Vendor {
  username: string;
  name: string;
  company: string;
}

// suppliers.ts
export const SUPPLIERS = [
  "HORAD AUTOMATIC TECHNOLOG",
  "CHANGZHOU GS ENERGYAND TECH CO., LTD",
  "BUDASOL MFG.KFT",
  "CHANGZHOU SVECK PHOTOVOLTNEW MATERIAL CO., LTD",
  "ZHEJIANG TWINSEL ELECTRONTECHNOLOGY CO., LTD.",
  "ZHEJIANG ZHONGHUAN SUNTERPV TECHNOLOGY CO.,LTD",
  "WUXI AUTOWELL SUPPLYCHAIN MANAGEMENT CO LTD",
  "JIANGYIN HAIHONG NEWENERGY TECHNOLOGY CO., LT",
  "JIANGYIN NEW SULV TECHNOL",
  "COVEME SPA",
  "WUXI LEAD INTELLIGENTEQUIPMENT CO, LTD.,",
  "JIANGSU HIGHSTAR BATTERYMANUFACTURING CO.,LTD",
  "PENGYANG PUMP TAIZHOU CO.",
  "TARGRAY INTERNATIONAL INC",
  "HANGZHOU ZHIJIANG SILICONCHEMICALS CO. LTD",
  "GSOLAR POWER CO LTD",
  "CENTRO ENERGY CO., LTD",
  "DONGGUAN DALY ELECTRONICS",
  "SHANDONG TIANQU ALUMINUM",
  "MBC SOLAR ENERGY LIMITED",
  "REIWA (YINGKOU) TRADING C",
  "ENETB2C COMPANY",
  "SHENZHEN GROWATTNEW ENERGY CO.,LIMITED",
  "SENERGY TECHINICAL SERVIC(SHANGAI) CO. LTD",
  "CHANGZHOU MANWE PV TECH C",
  "JIANGYIN XINGTONG METALPRODUCTS CO.,LTD",
  "TONGWEI SOLAR CO., LTD",
  "QC SOLAR (SUZHOU) CORPORA",
  "XINYI SOLAR MALAYSIA SDN",
  "JIANGYIN JINGYING PHOTOVOMATERIALS CO.LTD.",
  "SOL-LITE MANUFACTURING CO",
  "HANGZHOU FIRST APPLIED MALTD.",
  "XI'AN TELISON NEW MATERIA",
  "COVEME ENGINEERED FILMS Z",
  "JOLYWOOD(SUZHOU) SUNWATT",
  "SHANGHAI SOSUN NEW ENERGYTECHNOLOGY CO.,LTD.",
  "WEGOMA ASIA LIMITED",
  "POWERCHINA TRADE SOLUTION",
  "JIANGYIN TIANMU GREEN ENETECHNOLOGY CO.,LTD",
  "CHANGZHOU FUFENG MATERIALTECHNOLOGY CO.,LTD",
  "TAICANG JUREN INTERNATIONTRADE CO., LTD..",
  "SHANDONG TIANQU ENGINEERI",
  "HARTALEGA NGC SDN BHD",
  "SHENZHEN S.C NEW ENERGYTECHNOLOGY CORPORATION",
  "CENTROTHERM INTERNATIONAL",
  "GARBER TRADE LIMITED",
  "FLAT(HONG KONG)CO.,LTD",
  "NINGBO GZX PV TECHNOLOGY",
  "VIVA SOLAR FZC",
  "SHANGHAI SUNTECH POWERTECHNOLOGY CO., LTD",
  "INGENIOUS AUTOMATIC GROUP",
  "H.A.L.M ELEKRONIK GMBH",
  "CHANGZHOU HERSHEY-POWERNEW ENERGY CO.,LTD",
  "SUZHOU AUTOWAY SYSTEM CO.",
  "ZHUHAI GMEE SOLAR EQUIPME",
  "HERAEUS MATERIALS SINGAPO",
  "CHANGZHOU S.C SMART EQUIP",
  "DAS ENVIRONMENTAL EXPERTS",
  "SHANGHAI PENGQIAN TRANSMIEQUIPMENT CO.,LTD",
  "INTERNATIONAL ELECTROTECHCOMMISSION",
  "FREIBERG INSTRUMENTS GMBH",
  "JIA YUE GROUP CO., LTD",
  "DIGI-KEY ELECTRONICS",
  "YINGKOU JINCHEN MACHINERY",
  "TUV NORD (HANGZHOU) CO.,",
  "HERAEUS PHOTOVOLTAICS SIN",
  "SUZHOU ENJOYSUN TECHNOLOG",
  "CHANGZHOU S.C EXACT EQUIP",
  "SOLAMET ELECTRONIC MATERI(H.K) LIMITED",
  "EVOQUA WATER TECHNOLOGIES",
  "SHENZHEN EMBRACE GLORY ELMATERIAL CO.,LTD",
  "ZHONGLI TALESUN HONG KONG",
  "CHANGZHOU FUSION NEW MATECO., LTD",
  "INSPIRED ENERGY CO LTD",
  "NA",
  "JIANGSU FUJIHALO NEW ENER",
  "XINYI SOLAR (HONG KONG) L",
  "FEEJOY TECHNOLOGY(SHANGHA",
  "ATLAS COPCO (WUXI) COMPRE",
  "GCL SOLAR POWER(SUZHOU)LMITED",
  "RENA TECHNOLOGIES GMBH",
  "SUZHOU TOPS NEW MATERIAL",
  "ASIA NEO TECH INDUSTRIALCO., LTD",
  "AKCOME METALS TECHNOLOGY(CO.,LTD",
  "MAXWELL TECHNOLOGY PTE. L",
  "ZHEJIANG AIKO SOLAR TECHNCO., LTD",
  "WUXI RUXING TECHNOLOGYDEVELOPMENT CO. LTD",
  "FRAUNHOFER INSTITUT FUERSOLARE ENER-GIESYSTEM",
  "WUHAN DR LASER TECHNOLOGYCORP., LTD",
  "WUXI HIGHLIGHT NEW ENERGY",
  "GIGA SOLAR MATERIALS CORP",
  "BYSOL-LITE MANUFACTURING",
  "KOMEX INC",
  "BRAVE C&H SUPPLY CO., LTD",
  "GUANGZHOU BAIYUN TECHNOLOCO.,LTD.",
  "SUNFONERGY TECHNOLOGIES (",
  "JIANGSU HUAHENG NEW ENERGCO., LTD.",
  "JIANGXI HONGGE TECHNOLOGY",
  "ROBOTECHNIK INTELLIGENT TCO., LTD.",
  "CHANGZHOU PLET INTERNATIOCO., LTD.",
  "GENERAL SOLUTIONS & TRADI",
  "TANGSHAN YANGTAI IMPORT&EXPORT TRADE CO. LTD.",
  "SHENZHEN S.C NEW ENERGYTECHNOLOGY CORPORATION",
  "SUZHOU SUNERGY TECHNOLOGY",
  "SINGAPORE SATORI PTE.LTD",
  "HENGDIAN GROUP DMEGC MAGN",
  "DUMMY",
  "JANDELENGINEERRING LIMITE",
  "SHENZHEN BEITE PURIFICATICO., LTD",
  "XIAMEN XIANGYU NEW ENERGY",
  "ISRA VISION GMBH",
  "GNBS ECO CO.,LTD",
  "JIANGXI RISUNSOLARSALES C",
  "WUJIANG CSG GLASS CO., LT",
  "DAS ENVIRONMENTAL EQUIPMEPTE LTD",
  "SHENZHEN OUBEL TECHNOLOGY",
  "NMTORNICS (INDIA)- KERRYSEZ UNIT",
  "DONGGUAN CSG SOLAR GLASS",
  "CYBRID TECHNOLOGIES INC",
  "CHIZHOU ANAN ALUMINUM CO.",
  "XINYI PV PRODUCTS(ANHUI)LTD.",
  "RADIATION TECHNOLOGY CO.,",
  "SHENZHEN TOPRAY SOLAR CO.",
  "GUANGDONG JINWAN GAOJINGENERGY TECHNOLOGY",
  "CHUXIONG LONGI SILICON MACO.,LTD",
  "SHANGRAO JIETAI NEW ENERG",
  "SUZHOU SHENGCHENG SOLAR ECO., LTD",
  "CLIMAVENETA CHAT UNION REEQUIPMENT (SHANGHAI) CO.,",
  "SHENGCHENG TECHNOLOGY PTE",
  "PASAN SA",
  "BENTHAM INSTRUMENTS LTD",
  "CHUZHOU JIETAI NEW ENERGYTECHNOLOGY CO.",
  "TECH GATE ENGINEERING PTE",
  "TERASOLAR ENERGY MATERIAL",
  "JIANGSU PROVINCIAL FOREIGTRADE CORPORATION",
  "JIANGSU HUANENG INTELLIGEENERGY SUPPLY CHAIN TECHN",
  "SOLAR LONG PV-TECH (CAMBOCO., LTD.",
  "AIDU ENERGY CO.,LTD",
  "AIDU ENERGY PTE.LTD.",
  "RE PLUS EVENTS, LLC",
  "JIANGYIN TINZE NEW ENERGYTECHNOLOGY CO.,LTD",
  "SHANGHAI HUITIAN NEWMATERIAL CO.,LTD.",
  "ZHONGHUAN HONG KONGHOLDING LIMITED",
  "SEMILAB SEMICONDUCTORPHYSICS LABORATORY CO. LT",
  "SOLAMET ELECTONIC MATERIA(H.K) LIMITED",
  "KINGRAYLAND TECHNOLOGY CO",
  "HK APK LIMITED",
  "SHANHAI SUPER SOLAR NEWENERGY TECHNOLOGY",
  "ZEALWE TECHNICAL CO., LTD",
  "HLA SUPPLY CHAIN SOLUTION",
  "CYBRID TECHNOLOGIES (ZHEJ",
  "SHANGHAI BERLING TECHNOLOCO., LTD",
  "SHANDONG AOSHIGARMENT CO.",
  "ZHANGJIAGANG SIMPULSE-TEC",
  "WATERON TECHNOLOGY (HONGCO., LTD.",
  "XIAMEN C&D COMMODITY TRAD",
  "SINGAPORE ASAHI CHEMICALSOLDER INDUSTRIES PVT LTD",
  "BRIGHTSPOT AUTOMATION LLP",
  "SUZHOU  DRLINK  AUTOMATIOTECHNOLOGY CO, LTD.",
  "NINGBO EXCITON NEWENERGY CO.,LTD",
  "VOYAGER TRADINGPARTNERS LLC",
  "JIANGSU PHOENTY PHOTOELECTECNOLOGY CO.,LTD",
  "JIANGSU MINGHAO NEW MATERSCI-TECH CORPORATION",
  "DRIP CAPITAL, INC.",
  "CV. BALI EXPORT IMPORT",
  "WUXI DK ELECTRONIC MATERICO., LTD",
  "SUZHOU ISILVER MATERIALSCO., LTD.",
  "TIANJIN AIKO SOLAR TECHOLCO., LTD.",
  "ZHEJIANG NINGHAI KIBINGNEW ENERGY MANAGEMENT CO.",
  "JIANGXI TOPSUN SOLAR TECHCO., LTD",
  "PFEIFFER VACUUM SAS",
  "ZHEJIANG RENHE PHOTOVOLTATECHNOLOGY CO.,LTD",
  "JIANGSU MEIKE SOLAR TECHN",
  "WUXI HIGHLIGHT NEW ENERGYTECHNOLOGY CO., LTD",
  "JIANGYIN YUANSHUO METALTECHNOLOGY CO., LTD.",
  "JIANGSU HOLYSUN ELECTRONITECHNOLOGY CO., LTD.",
  "SCENERGY TECHNOLOGY LIMIT",
  "PURITECH CO., LTD.",
  "AIR GAS ELECTRONICMATERIALS ENTERPRISE CO.",
  "ANHUI CSG NEW ENERGYMATERIAL TECHNOLOGY CO.,L",
  "SUZHOU MAXWELL TECHNOLOGICO., LTD.",
  "WUXI LERIN NEW ENERGYTECHNOLOGY CO.,LTD",
  "WUXI U PLUSTECHNOLOGY CO.LTD",
  "HONGYUAN NEW MATERIAL(BAOTOU) CO., LTD.",
  "SUZHOU SHD INTELLIGENTTECHNOLOGIES CO., LTD.",
  "SHUANGLIANG INTERNATIONAL(SHANGHAI) CO., LTD",
  "SHANGHAI XINZHUOZHUANGPRINTING TECHNOLOGY CO.,",
  "VOSTRO ELECTRONICTECHNOLOGY(SUZHOU)CO.,LTD",
  "SUZHOU FLY SOLARTECHNOLOGY CO. , LTD",
  "ZHEJIANG DOUBLE HEAD EAGLIMPORT&EXPORT CO.,LTD.",
  "MEHTA PTE LTD.",
  "HANG YUE TONGCOMPANY LIMITED",
  "XIAMEN CANDOUR CO., LTD",
  "FRINTRUP NB SPECIAL SCREETECHNOLOGY (KUNSHAN) CO.,",
  "SOLAR N PLUS NEW ENERGYTECHNOLOGY CO., LTD.",
  "SNL CORPORATION",
  "DONGGUAN MIVISIONTECHNOLOGY CO., LTD",
  "JIANGSU HAITIANMICROELECTRONICS CORP.",
  "CHANGSHU TOPS PV MATERIAL",
  "FUJIAN  UNITE  MATERIALTECHNOLOGY  CO., LTD.",
  "SUZHOU QIANTONG INSTRUMENEQUIPMENT CO., LTD.",
  "FUSION MATERIAL TECHNOLOG",
  "TONGWEI SOLAR (MEISHAN) C",
  "QINGDAO GAOCE TECHNOLOGY",
  "DONGGUAN MINWEI PHOTOELECTECHNOLOGY",
  "T-SUN NEW ENERGY LIMITED",
  "JIANGSU TONGLING ELECTRIC",
  "GEMUE GEBR MUELLER APPARAGMBH & CO",
  "SICHUAN MEIKE NEW ENERGY",
  "LONGI GREEN ENERGY TECHNO",
  "INTRALINKS INC.",
  "IDEAL DEPOSITION EQUIPMENAND APPLICATIONS(ZHEJIANG",
  "FUZHOU ANTONG NEW MATERIATECHNOLOGY CO.,LTD.",
  "JIANGSU KUNA NEW ENERGY C",
  "SKY GLOVES",
  "VIETNAM ADVANCE FILM MATECOMPANY LIMITED",
  "CHANGZHOU CHENNAI NEW ENECO.,LTD",
  "AN LAM CO., LTD",
  "SUZHOU CHANGQING NEWMATERIAL CO., LTD.",
  "ICB GMBH & CO. KG",
  "C AND B INTERNATIONAL HOL",
  "HUAIAN JIETAI NEW ENERGYTECHNOLOGY CO LTD",
  "SUZHOU YOURBEST NEW-TYPEMATERIALS CO.,LTD",
  "JOHNSON CONTROLS (S) PTE.",
  "FOMEX GLOBAL JOINT STOCK",
  "BETTERIAL ( VIET NAM ) FICOMPANY  LIMITED",
  "SHENZHEN PARTNERAE ELECTR",
  "EMPIRE PUMPS LTD.",
  "JIANGSU LONGHENG NEW ENERCO., LTD",
  "CHUZHOU AIKO SOLAR TECHNO",
  "CE CELL ENGINEERING GMBH",
  "SHANGHAI YANG ER IMPORT ACOMPANY LTD",
  "GUANGZHOU YICHUANG ELECTR",
  "SHENZHEN SOFARSOLAR CO.,",
  "ANHUI SHIJING SOLARPOWERTECHNOLOGY CO.,LTD",
  "SOLAR EQ TECHNOLOGY EUROP",
  "SHAOXING TUOBANG NEWENERGY CO., LTD.",
  "FOXESS CO., LTD.",
  "TONGWEI SOLAR (PENGSHAN)CO., LTD.",
  "WUXI YINGJIE INTELLIGENTEQUIPMENT CO., LTD",
  "VIETNAM SUNERGY CELL COMP",
  "ACE GASES MARKETING SDN B",
  "SCZ GLOBAL L.L.C.-FZ",
  "JIANGSU SIMAOTE TRANSMISS",
  "ISILVER MATERIALS (MALAYS",
  "HUNAN YUJING MACHINERY CO",
  "BOOTH BUILDERS LLC",
  "TAIZHOU XINGYOU SOLAR EQULIMITED COMPANY",
  "SIW MANUFACTURING SDN BHD",
  "SOLVAY LAITIAN (QUZHOU) C",
  "GRUNFELD, DESIDERIO,LEBOWITZ & SILVERMAN LLP",
  "EDWARDS LIMITED",
  "SOLAR MEDIA LIMITED",
  "GUANGXI CSG NEW ENERGYMATERIAL TECHNOLOGY CO.,",
  "ACCESS SOLAR PVT LTD",
  "SK SPECIALTY CO., LTD.",
  "WUXI CHUANGYIDE INTELLIGEEQUIPMENT CO., LTD.",
  "HONGYUAN NEW MATERIAL (BA",
  "HONGYUAN NEW MATERIAL (XU",
  "CYMAX PTE. LTD.",
  "JIANGSU HUAZHONG GAS CO.,",
  "GOKIN SOLAR (HONGKONG) CO",
  "HANWHA ADVANCED MATERIALS",
  "WAVELABS SOLAR METROLOGY",
  "MS/ HANG YUE TONG COMPANY",
  "HANGZHOU COBETTER FILTRATEQUIPMENT CO.,LTD",
  "M/S. LEOSUN INTERNATIONALIMITED",
  "PHAROS MATERIALS CO., LTD",
  "TRANS CHIEF CHEMICAL INDU",
  "WUXI XINDECO INTERNATIONA",
  "INFOLINK CONSULTING CO.,",
  "ALPHAWOOD VIETNAM JOINT S",
  "SJ ENERGY COMPANY LIMITED",
  "JIETAI NEW ENERGY TECHNOL",
  "LUSHAN ADVANCED MATERIALS(MALAYSIA)SDN.BHD",
  "YANCHENG ZHISHENGBOTECHNOLOGY CO.,LTD",
  "TRINA SOLAR (CHANGZHOU) PEQUIPMENT CO., LTD",
  "DR LASER SINGAPORE PTE. L",
  "IDI LASER SERVICES PTE LT",
  "TOYO SOLAR COMPANY LIMITE",
  "LEOSUN INTERNATIONAL TRAD",
  "ANHUI YUBO NEW MATERIALLTECHNOLOGY CO.,LTD",
  "ZHEJIANG JINGSHENG MECHANELECTRICAL CO.,LTD",
];

const RFQList: React.FC = () => {
  const { getUserRFQs, createRFQ } = useData();
  const navigate = useNavigate();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Form state
  const [itemDescription, setItemDescription] =
    useState<RFQ["itemDescription"]>("EVA");
  const [companyName, setCompanyName] = useState<RFQ["companyName"]>("PEPPL");
  const [materialPONumber, setMaterialPONumber] = useState("");
  const [supplierName, setSupplierName] =
    useState<RFQ["supplierName"]>("aarnav");
  const [portOfLoading, setPortOfLoading] =
    useState<RFQ["portOfLoading"]>("beijing");
  const [portOfDestination, setPortOfDestination] =
    useState<RFQ["portOfDestination"]>("chennai");
  const [containerType, setContainerType] =
    useState<RFQ["containerType"]>("LCL");
  const [numberOfContainers, setNumberOfContainers] = useState(1);
  const [cargoWeight, setCargoWeight] = useState(1);
  const [cargoReadinessDate, setCargoReadinessDate] = useState("");
  const [initialQuoteEndTime, setInitialQuoteEndTime] = useState("");
  const [evaluationEndTime, setEvaluationEndTime] = useState("");
  const [description, setDescription] = useState("");

  // Vendors selection
  const [vendors, setVendors] = useState<string[]>([]);
  const [vendorOptions, setVendorOptions] = useState<Vendor[]>([]);

  // Load RFQs
  const rfqs = getUserRFQs().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Fetch vendor list from server
  useEffect(() => {
    const fetchVendors = async () => {
      try {
        const res = await api.get<Vendor[]>("/vendors");
        setVendorOptions(res.data);
      } catch (err) {
        console.error("Failed to load vendors:", err);
      }
    };
    fetchVendors();
  }, []);

  const handleCreateRFQ = () => {
    createRFQ({
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
      createdBy: "aarnav",
    });

    setIsCreateModalOpen(false);
    // Reset form
    setMaterialPONumber("");
    setNumberOfContainers(1);
    setCargoWeight(1);
    setCargoReadinessDate("");
    setInitialQuoteEndTime("");
    setEvaluationEndTime("");
    setDescription("");
    setVendors([]);
  };

  const handleFinalize = (rfqId: string) => {
    navigate(`/logistics/finalize/${rfqId}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">RFQ List</h1>
        <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
          <DialogTrigger asChild>
            <Button>+ Create New</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New RFQ</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="itemDescription">Item Description</Label>
                  <Select
                    value={itemDescription}
                    onValueChange={(value) =>
                      setItemDescription(value as RFQ["itemDescription"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select item" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Ethylene vinyl acetate sheets (EVA)">
                        Ethylene vinyl acetate sheets (EVA)
                      </SelectItem>
                      <SelectItem value="Tinned Copper interconnect-Wire/Ribbon">
                        Tinned Copper interconnect-Wire/Ribbon
                      </SelectItem>
                      <SelectItem value="Tinned Copper interconnect-Bus Bar">
                        Tinned Copper interconnect-Bus Bar
                      </SelectItem>
                      <SelectItem value="Solar tempered glass or solar tempered (anti-reflective coated) glass">
                        Solar tempered glass or solar tempered (anti-reflective
                        coated) glass
                      </SelectItem>
                      <SelectItem value="Photovoltaic cells">
                        Photovoltaic cells
                      </SelectItem>
                      <SelectItem value="Back sheet for Solar Module ( Supplier : Jolywood KFB-30PLUS(WHITE)">
                        Back sheet for Solar Module ( upplier : Jolywood
                        KFB-30PLUS(WHITE))
                      </SelectItem>
                      <SelectItem value="Back sheet- Transparent-for Solar Module (JOLYWOOD FFC JW30PLUS (TRANSPARENT)">
                        Back sheet- Transparent-for Solar Module (JOLYWOOD FFC
                        JW30PLUS (TRANSPARENT))
                      </SelectItem>
                      <SelectItem value="PET Back sheet-for Solar Module">
                        PET Back sheet-for Solar Module
                      </SelectItem>
                      <SelectItem value="Aluminium Profile/Frames">
                        Aluminium Profile/Frames
                      </SelectItem>
                      <SelectItem value="Junction Box (used solar  Photovoltaic Modules)">
                        Junction Box (used solar Photovoltaic Modules)
                      </SelectItem>
                      <SelectItem value="Silicone Sealants used in Manufacturing of solar Photovoltaic Modules">
                        Silicone Sealants used in Manufacturing of solar
                        Photovoltaic Modules
                      </SelectItem>
                      <SelectItem value="POE (polymers of Ehtylene) Film">
                        POE (polymers of Ehtylene) Film
                      </SelectItem>
                      <SelectItem value="EPE Film">EPE Film</SelectItem>
                      <SelectItem value="Membrane Sheet">
                        Membrane Sheet
                      </SelectItem>
                      <SelectItem value="Teflon sheet">Teflon sheet</SelectItem>
                      <SelectItem value="Silver Conductor Front side Metallic Paste & Silver Conductor paste Rear Side">
                        Silver Conductor Front side Metallic Paste & Silver
                        Conductor paste Rear Side
                      </SelectItem>
                      <SelectItem value="Undefused silicon wafers">
                        Undefused silicon wafers
                      </SelectItem>
                      <SelectItem value="Aluminium paste">
                        Aluminium paste
                      </SelectItem>
                      <SelectItem value="Print screen">Print screen</SelectItem>
                      <SelectItem value="Additives">Additives</SelectItem>
                      <SelectItem value="TMA (TRIMETHYLALUMINUM)">
                        TMA (TRIMETHYLALUMINUM)
                      </SelectItem>
                      <SelectItem value="APRON BLUE">APRON BLUE</SelectItem>
                      <SelectItem value="CAP">CAP</SelectItem>
                      <SelectItem value="NITRILE GLOVES">
                        NITRILE GLOVES
                      </SelectItem>
                      <SelectItem value="BEMCOT WIPERS">
                        BEMCOT WIPERS
                      </SelectItem>
                      <SelectItem value="GASES-SILANE">GASES-SILANE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="companyName">Company Name</Label>
                  <Select
                    value={companyName}
                    onValueChange={(value) =>
                      setCompanyName(value as RFQ["companyName"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select company" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value={`Premier Energies Limited SURVEY NO 53 ANNARAM VILLAGAE G P ANNARAM
JINNARAM Mandal MEDAK District, Telangana-502313 India. IEC :
0996000402 PAN : AABCP8800D GST :36AABCP8800D1ZP`}
                      >
                        Premier Energies Limited SURVEY NO 53 ANNARAM VILLAGAE G
                        P ANNARAM
                        <br />
                        JINNARAM Mandal MEDAK District, Telangana-502313 India.
                        <br />
                        IEC : 0996000402 PAN : AABCP8800D GST :36AABCP8800D1ZP
                      </SelectItem>

                      <SelectItem
                        value={`Premier Energies Photovoltaic Private Limited Plot No. 8/B/1/ and
8/B/2 E-City, Raviryala Village, Maheshwaram Mandal, Ranga Reddy,
Telangana, 501359,India. IEC : AAXCS4996H PAN : AAXCS4996H GST :
36AAXCS4996H1ZB`}
                      >
                        Premier Energies Photovoltaic Private Limited
                        <br />
                        Plot No. 8/B/1/ and 8/B/2 E-City, Raviryala Village,
                        <br />
                        Maheshwaram Mandal, Ranga Reddy, Telangana, 501359,
                        India.
                        <br />
                        IEC : AAXCS4996H PAN : AAXCS4996H GST : 36AAXCS4996H1ZB
                      </SelectItem>

                      <SelectItem
                        value={`Premier Energies International Private Limited- Unit 1
Unit-I,Survey No 62 P 63P and 88 P Plot No 8/B/1 and 8/B/2,
Raviryala Srinagar Village, Maheshwaram Mandal, Ranga Reddy
TS,Srinagar Village, Pedda Golconda , Rangareddy,Telangana,501359,India IEC : AATCA8732D PAN: AATCA8732D GST : 36AATCA8732D1ZF`}
                      >
                        Premier Energies International Private Limited – Unit 1
                        <br />
                        Survey No 62 P63P & 88 P, Plot No 8/B/1 & 8/B/2,
                        <br />
                        Raviryala Srinagar Village, Maheshwaram Mandal,
                        <br />
                        Ranga Reddy TS, Pedda Golconda, Telangana 501359, India
                        <br />
                        IEC : AATCA8732D PAN : AATCA8732D GST : 36AATCA8732D1ZF
                      </SelectItem>

                      <SelectItem
                        value={`Premier Energies International Private Limited- Unit 2
Unit-II,Plot No S-95 S-96 S-100 S-101 S-102 S-103 S-104, Raviryala
Srinagar Village Maheswaram, FAB City, Rangareddy, Telangana,
501359,India IEC : AATCA8732D PAN: AATCA8732D GST :
36AATCA8732D1ZF`}
                      >
                        Premier Energies International Private Limited – Unit 2
                        <br />
                        Plot No S-95 to S-104, Raviryala Srinagar Village,
                        Maheswaram
                        <br />
                        FAB City, Rangareddy, Telangana 501359, India
                        <br />
                        IEC : AATCA8732D PAN : AATCA8732D GST : 36AATCA8732D1ZF
                      </SelectItem>

                      <SelectItem
                        value={`Premier energies Global Environment Private Limited Plot No S-95,
S-96, S-100, S-101, S-102, S-103, S-104, Raviryala, Srinagar
Village, Maheswaram, Raviryal Industrial Area, FAB City,
Rangareddy, Telangana – 501359,India. IEC : AALCP9141K PAN:
AALCP9141K GST : 36AALCP9141K1ZW`}
                      >
                        Premier Energies Global Environment Private Limited
                        <br />
                        Plot No S-95 to S-104, Raviryala, Srinagar Village,
                        <br />
                        Maheswaram, Raviryal Industrial Area, FAB City,
                        <br />
                        Rangareddy, Telangana – 501359, India
                        <br />
                        IEC : AALCP9141K PAN : AALCP9141K GST : 36AALCP9141K1ZW
                      </SelectItem>

                      <SelectItem
                        value={`Premier Energies Global Environment Private Limited- Unit 2 Sy No
303 304 305 and 306/2, EMC Maheswaram, Ranga Reddy Dist,
Telangana, 501359 IEC : AALCP9141K PAN: AALCP9141K GST :
36AALCP9141K1ZW`}
                      >
                        Premier Energies Global Environment Private Limited –
                        Unit 2<br />
                        Sy No 303–306/2, EMC Maheswaram, Ranga Reddy Dist,
                        <br />
                        Telangana 501359, India
                        <br />
                        IEC : AALCP9141K PAN : AALCP9141K GST : 36AALCP9141K1ZW
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="materialPONumber">Material PO Number</Label>
                  <Input
                    id="materialPONumber"
                    value={materialPONumber}
                    onChange={(e) => setMaterialPONumber(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="supplierName">Supplier Name</Label>
                  <Select
                    value={supplierName}
                    onValueChange={(value) =>
                      setSupplierName(value as RFQ["supplierName"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPLIERS.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="portOfLoading">Port of Loading</Label>
                  <Select
                    value={portOfLoading}
                    onValueChange={(value) =>
                      setPortOfLoading(value as RFQ["portOfLoading"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select port" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Shanghai">Shanghai</SelectItem>
                      <SelectItem value="Ningbo">Ningbo</SelectItem>
                      <SelectItem value="Port klang">Port klang</SelectItem>
                      <SelectItem value="Haiphong">Haiphong</SelectItem>
                      <SelectItem value="Shekou">Shekou</SelectItem>
                      <SelectItem value="Shenzhen">Shenzhen</SelectItem>
                      <SelectItem value="Tianjin">Tianjin</SelectItem>
                      <SelectItem value="Dalian">Dalian</SelectItem>
                      <SelectItem value="Hamburg">Hamburg</SelectItem>
                      <SelectItem value="Nansha">Nansha</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="portOfDestination">Port of Destination</Label>
                  <Select
                    value={portOfDestination}
                    onValueChange={(value) =>
                      setPortOfDestination(value as RFQ["portOfDestination"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select port" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Nhava Sheva">Nhava Sheva</SelectItem>
                      <SelectItem value="ICD-Hyderabad">
                        ICD-Hyderabad
                      </SelectItem>
                      <SelectItem value="Hyderabad Airport">
                        Hyderabad Airport
                      </SelectItem>
                      <SelectItem value="Chennai Airport">
                        Chennai Airport
                      </SelectItem>
                      <SelectItem value="Mumbai Airport">
                        Mumbai Airport
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="containerType">Container Type</Label>
                  <Select
                    value={containerType}
                    onValueChange={(value) =>
                      setContainerType(value as RFQ["containerType"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select container type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LCL">LCL</SelectItem>
                      <SelectItem value="20' GP">20' GP</SelectItem>
                      <SelectItem value="40' HC">40' HC</SelectItem>
                      <SelectItem value="40' FR">40' FR</SelectItem>
                      <SelectItem value="20' OT">20' OT</SelectItem>
                      <SelectItem value="40' OT">40' OT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="numberOfContainers">
                    Number of Containers
                  </Label>
                  <Input
                    id="numberOfContainers"
                    type="number"
                    min="1"
                    value={numberOfContainers}
                    onChange={(e) =>
                      setNumberOfContainers(parseInt(e.target.value) || 1)
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cargoWeight">
                    Cargo Weight in Container (tons)
                  </Label>
                  <Input
                    id="cargoWeight"
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={cargoWeight}
                    onChange={(e) =>
                      setCargoWeight(parseFloat(e.target.value) || 0.1)
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cargoReadinessDate">
                    Tentative Cargo Readiness Date
                  </Label>
                  <Input
                    id="cargoReadinessDate"
                    type="datetime-local"
                    value={cargoReadinessDate}
                    onChange={(e) => setCargoReadinessDate(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="initialQuoteEndTime">
                    Initial Quote End Time
                  </Label>
                  <Input
                    id="initialQuoteEndTime"
                    type="datetime-local"
                    value={initialQuoteEndTime}
                    onChange={(e) => setInitialQuoteEndTime(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="evaluationEndTime">Evaluation End Time</Label>
                  <Input
                    id="evaluationEndTime"
                    type="datetime-local"
                    value={evaluationEndTime}
                    onChange={(e) => setEvaluationEndTime(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (Optional)</Label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Vendors to send RFQ</Label>
                <div className="border rounded-md p-4 space-y-2">
                  {vendorOptions.map((v) => (
                    <div
                      key={v.company}
                      className="flex items-center space-x-2"
                    >
                      <Checkbox
                        id={`vendor-${v.company}`}
                        checked={vendors.includes(v.company)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setVendors((prev) => [...prev, v.company]);
                          } else {
                            setVendors((prev) =>
                              prev.filter((c) => c !== v.company)
                            );
                          }
                        }}
                      />
                      <label
                        htmlFor={`vendor-${v.company}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {v.name} ({v.company})
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <Button onClick={handleCreateRFQ}>Submit RFQ</Button>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr>
                <th>Actions</th>
                <th>RFQ Number</th>
                <th>Item Description</th>
                <th>Company</th>
                <th>Material PO</th>
                <th>Supplier</th>
                <th>Port of Loading</th>
                <th>Port of Destination</th>
                <th>Container Type</th>
                <th>No. of Containers</th>
                <th>Weight (tons)</th>
                <th>Readiness Date</th>
                <th>Quote End</th>
                <th>Eval End</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rfqs.length === 0 ? (
                <tr>
                  <td colSpan={15} className="text-center py-4">
                    No RFQs found. Create your first RFQ!
                  </td>
                </tr>
              ) : (
                rfqs.map((rfq) => (
                  <tr key={rfq.id}>
                    <td>
                      {rfq.status !== "closed" && (
                        <Button
                          size="sm"
                          onClick={() => handleFinalize(rfq.id)}
                        >
                          Finalize
                        </Button>
                      )}
                      {rfq.status === "closed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleFinalize(rfq.id)}
                        >
                          View
                        </Button>
                      )}
                    </td>
                    <td>{rfq.rfqNumber}</td>
                    <td>{rfq.itemDescription}</td>
                    <td>{rfq.companyName}</td>
                    <td>{rfq.materialPONumber}</td>
                    <td>{rfq.supplierName}</td>
                    <td>{rfq.portOfLoading}</td>
                    <td>{rfq.portOfDestination}</td>
                    <td>{rfq.containerType}</td>
                    <td>{rfq.numberOfContainers}</td>
                    <td>{rfq.cargoWeight}</td>
                    <td>
                      {new Date(rfq.cargoReadinessDate).toLocaleDateString()}
                    </td>
                    <td>
                      {new Date(rfq.initialQuoteEndTime).toLocaleDateString()}
                    </td>
                    <td>
                      {new Date(rfq.evaluationEndTime).toLocaleDateString()}
                    </td>
                    <td>
                      <StatusBadge status={rfq.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default RFQList;
