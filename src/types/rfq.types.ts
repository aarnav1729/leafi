
export interface RFQ {
  id: string;
  rfqNumber: number;
  itemDescription: "EVA" | "Photovoltaic Cells" | "TMA" | "CAP";
  companyName: "PEPPL" | "PEIPL" | "PEGEPL";
  materialPONumber: string;
  supplierName: "aarnav" | "madhur" | "akanksha" | "ashwin" | "sathvika";
  portOfLoading: "beijing" | "shanghai" | "ningbo";
  portOfDestination: "chennai" | "hyderabad" | "goa";
  containerType: "LCL" | "20' OT" | "40'OT";
  numberOfContainers: number;
  cargoWeight: number; // in tons
  cargoReadinessDate: string;
  initialQuoteEndTime: string;
  evaluationEndTime: string;
  description?: string;
  vendors: string[];
  createdAt: string;
  status: "initial" | "evaluation" | "closed";
  createdBy: string;
}

export interface QuoteItem {
  id: string;
  rfqId: string;
  vendorName: string;
  numberOfContainers: number;
  shippingLineName: string;
  containerType: "LCL" | "20' OT" | "40'OT";
  vesselName: string;
  vesselETD: string;
  vesselETA: string;
  seaFreightPerContainer: number; // USD
  houseDeliveryOrderPerBOL: number; // INR
  cfsPerContainer: number; // INR
  transportationPerContainer: number; // INR
  chaChargesHome: number; // INR
  chaChargesMOOWR: number; // INR
  ediChargesPerBOE: number; // INR
  mooWRReeWarehousingCharges: number; // INR
  transshipOrDirect: "transship" | "direct";
  quoteValidityDate: string;
  message?: string;
  createdAt: string;
  containersAllottedHome?: number;
  containersAllottedMOOWR?: number;
  homeTotal?: number;
  mooWRTotal?: number;
}

export interface Allocation {
  rfqId: string;
  quoteId: string;
  vendorName: string;
  containersAllottedHome: number;
  containersAllottedMOOWR: number;
  reason?: string;
  createdAt: string;
}
