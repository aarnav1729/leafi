export interface RFQ {
  id: string;
  rfqNumber: number;

  // These must be string because UI uses long descriptive values (and many options)
  itemDescription: string;
  companyName: string;
  materialPONumber: string;
  supplierName: string;
  portOfLoading: string;
  portOfDestination: string;
  containerType: string;

  numberOfContainers: number;
  cargoWeight: number; // in tons
  cargoReadinessDate: string;

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
  containerType: string;
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
