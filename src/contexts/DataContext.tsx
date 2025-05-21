
import React, { createContext, useContext, useState, useEffect } from "react";
import { toast } from "sonner";
import { RFQ, QuoteItem, Allocation } from "@/types/rfq.types";
import { useAuth } from "./AuthContext";

interface DataContextType {
  rfqs: RFQ[];
  quotes: QuoteItem[];
  allocations: Allocation[];
  createRFQ: (rfq: Omit<RFQ, "id" | "rfqNumber" | "createdAt" | "status">) => void;
  createQuote: (quote: Omit<QuoteItem, "id" | "createdAt" | "homeTotal" | "mooWRTotal">) => void;
  finalizeRFQ: (rfqId: string, allocation: Omit<Allocation, "createdAt">) => void;
  getUserRFQs: () => RFQ[];
  getVendorRFQs: () => RFQ[];
  getVendorAllottedRFQs: () => RFQ[];
  getRFQById: (id: string) => RFQ | undefined;
  getQuotesByRFQId: (rfqId: string) => QuoteItem[];
  getAllocationsByRFQId: (rfqId: string) => Allocation[];
  isLoading: boolean;
}

const DataContext = createContext<DataContextType>({
  rfqs: [],
  quotes: [],
  allocations: [],
  createRFQ: () => {},
  createQuote: () => {},
  finalizeRFQ: () => {},
  getUserRFQs: () => [],
  getVendorRFQs: () => [],
  getVendorAllottedRFQs: () => [],
  getRFQById: () => undefined,
  getQuotesByRFQId: () => [],
  getAllocationsByRFQId: () => [],
  isLoading: false,
});

export const useData = () => useContext(DataContext);

const USD_TO_INR_RATE = 75; // Fixed conversion rate for demo

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ 
  children 
}) => {
  const { user } = useAuth();
  const [rfqs, setRFQs] = useState<RFQ[]>([]);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [nextRFQNumber, setNextRFQNumber] = useState(1000);

  // Load data from localStorage on component mount
  useEffect(() => {
    const loadData = () => {
      try {
        const storedRFQs = localStorage.getItem("rfqs");
        if (storedRFQs) {
          setRFQs(JSON.parse(storedRFQs));
        }

        const storedQuotes = localStorage.getItem("quotes");
        if (storedQuotes) {
          setQuotes(JSON.parse(storedQuotes));
        }

        const storedAllocations = localStorage.getItem("allocations");
        if (storedAllocations) {
          setAllocations(JSON.parse(storedAllocations));
        }

        const storedNextRFQNumber = localStorage.getItem("nextRFQNumber");
        if (storedNextRFQNumber) {
          setNextRFQNumber(parseInt(storedNextRFQNumber, 10));
        }

        setIsLoading(false);
      } catch (error) {
        console.error("Error loading data from localStorage:", error);
        toast.error("Error loading data");
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  // Save data to localStorage whenever it changes
  useEffect(() => {
    if (!isLoading) {
      localStorage.setItem("rfqs", JSON.stringify(rfqs));
      localStorage.setItem("quotes", JSON.stringify(quotes));
      localStorage.setItem("allocations", JSON.stringify(allocations));
      localStorage.setItem("nextRFQNumber", nextRFQNumber.toString());
    }
  }, [rfqs, quotes, allocations, nextRFQNumber, isLoading]);

  // Create a new RFQ
  const createRFQ = (
    rfqData: Omit<RFQ, "id" | "rfqNumber" | "createdAt" | "status">
  ) => {
    const newRFQ: RFQ = {
      ...rfqData,
      id: crypto.randomUUID(),
      rfqNumber: nextRFQNumber,
      createdAt: new Date().toISOString(),
      status: "initial",
    };

    setRFQs([...rfqs, newRFQ]);
    setNextRFQNumber(nextRFQNumber + 1);
    toast.success("RFQ created successfully");
  };

  // Create a new quote for an RFQ
  const createQuote = (
    quoteData: Omit<QuoteItem, "id" | "createdAt" | "homeTotal" | "mooWRTotal">
  ) => {
    // Calculate totals
    const seaFreightInINR = quoteData.seaFreightPerContainer * USD_TO_INR_RATE;
    
    const homeTotal = 
      seaFreightInINR + 
      quoteData.houseDeliveryOrderPerBOL + 
      quoteData.cfsPerContainer + 
      quoteData.transportationPerContainer + 
      quoteData.ediChargesPerBOE + 
      quoteData.chaChargesHome;
    
    const mooWRTotal = 
      seaFreightInINR + 
      quoteData.houseDeliveryOrderPerBOL + 
      quoteData.cfsPerContainer + 
      quoteData.transportationPerContainer + 
      quoteData.ediChargesPerBOE + 
      quoteData.mooWRReeWarehousingCharges + 
      quoteData.chaChargesMOOWR;

    const newQuote: QuoteItem = {
      ...quoteData,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      homeTotal,
      mooWRTotal
    };

    setQuotes([...quotes, newQuote]);
    
    // Update RFQ status to evaluation if it was in initial state
    setRFQs(rfqs.map(rfq => 
      rfq.id === quoteData.rfqId && rfq.status === "initial" 
        ? { ...rfq, status: "evaluation" } 
        : rfq
    ));
    
    toast.success("Quote submitted successfully");
  };

  // Finalize an RFQ with allocations
  const finalizeRFQ = (rfqId: string, allocation: Omit<Allocation, "createdAt">) => {
    const newAllocation: Allocation = {
      ...allocation,
      createdAt: new Date().toISOString(),
    };

    setAllocations([...allocations, newAllocation]);
    
    // Update RFQ status to closed
    setRFQs(rfqs.map(rfq => 
      rfq.id === rfqId ? { ...rfq, status: "closed" } : rfq
    ));
    
    toast.success("RFQ finalized successfully");
  };

  // Get RFQs for the current user (logistics role)
  const getUserRFQs = () => {
    if (!user || user.role !== "logistics") return [];
    return rfqs;
  };

  // Get RFQs for a vendor
  const getVendorRFQs = () => {
    if (!user || user.role !== "vendor") return [];
    
    // Return RFQs where the current vendor is in the vendors list
    return rfqs.filter(rfq => 
      rfq.vendors.includes(user.company || "")
    );
  };

  // Get RFQs that have been allotted to the current vendor
  const getVendorAllottedRFQs = () => {
    if (!user || user.role !== "vendor") return [];
    
    // Find RFQ ids where this vendor has allocations
    const rfqIds = allocations
      .filter(alloc => alloc.vendorName === user.company)
      .map(alloc => alloc.rfqId);
    
    // Return RFQs with these IDs
    return rfqs.filter(rfq => rfqIds.includes(rfq.id));
  };

  // Get an RFQ by its ID
  const getRFQById = (id: string) => {
    return rfqs.find(rfq => rfq.id === id);
  };

  // Get quotes for a specific RFQ
  const getQuotesByRFQId = (rfqId: string) => {
    return quotes.filter(quote => quote.rfqId === rfqId);
  };

  // Get allocations for a specific RFQ
  const getAllocationsByRFQId = (rfqId: string) => {
    return allocations.filter(alloc => alloc.rfqId === rfqId);
  };

  return (
    <DataContext.Provider
      value={{
        rfqs,
        quotes,
        allocations,
        createRFQ,
        createQuote,
        finalizeRFQ,
        getUserRFQs,
        getVendorRFQs,
        getVendorAllottedRFQs,
        getRFQById,
        getQuotesByRFQId,
        getAllocationsByRFQId,
        isLoading,
      }}
    >
      {children}
    </DataContext.Provider>
  );
};
