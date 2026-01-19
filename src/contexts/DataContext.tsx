// root/src/contexts/DataContext.tsx
import React, { createContext, useContext, useState, useEffect } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { RFQ, QuoteItem, Allocation } from "@/types/rfq.types";
import { useAuth } from "./AuthContext";

interface DataContextType {
  rfqs: RFQ[];
  quotes: QuoteItem[];
  allocations: Allocation[];
  isLoading: boolean;
  createRFQ: (
    rfq: Omit<RFQ, "id" | "rfqNumber" | "createdAt" | "status">
  ) => Promise<void>;
  createQuote: (
    quote: Omit<QuoteItem, "id" | "createdAt" | "homeTotal" | "mooWRTotal">
  ) => Promise<void>;
  finalizeRFQ: (
    rfqId: string,
    allocation: Omit<Allocation, "createdAt">
  ) => Promise<void>;
  getUserRFQs: () => RFQ[];
  getVendorRFQs: () => RFQ[];
  getVendorAllottedRFQs: () => RFQ[];
  getRFQById: (id: string) => RFQ | undefined;
  getQuotesByRFQId: (rfqId: string) => QuoteItem[];
  getAllocationsByRFQId: (rfqId: string) => Allocation[];
}

export const DataContext = createContext<DataContextType>(
  {} as DataContextType
);

export const useData = () => useContext(DataContext);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, isLoading: authLoading } = useAuth();

  const [rfqs, setRFQs] = useState<RFQ[]>([]);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // wait until auth finishes
    if (authLoading) return;

    if (!user) {
      // no user means clear data
      setRFQs([]);
      setQuotes([]);
      setAllocations([]);
      setIsLoading(false);
      return;
    }

    const loadAll = async () => {
      setIsLoading(true);
      try {
        // 1) fetch RFQs
        const rfqRes = await api.get<RFQ[]>("/rfqs");
        setRFQs(rfqRes.data);

        // 2) fetch quotes for each RFQ
        const quoteArrays = await Promise.all(
          rfqRes.data.map((rfq) =>
            api.get<QuoteItem[]>(`/quotes/${rfq.id}`).then((res) => res.data)
          )
        );
        setQuotes(quoteArrays.flat());

        // 3) fetch allocations for each RFQ
        const allocArrays = await Promise.all(
          rfqRes.data.map((rfq) =>
            api
              .get<Allocation[]>(`/allocations/${rfq.id}`)
              .then((res) => res.data)
          )
        );
        setAllocations(allocArrays.flat());
      } catch (err: any) {
        console.error("Data load error:", err);
        toast.error("Error loading data from server");
      } finally {
        setIsLoading(false);
      }
    };

    loadAll();
  }, [user, authLoading]);

  // Create a new RFQ
  const createRFQ = async (
    rfqData: Omit<RFQ, "id" | "rfqNumber" | "createdAt" | "status">
  ) => {
    try {
      await api.post("/rfqs", rfqData);
      const rfqRes = await api.get<RFQ[]>("/rfqs");
      setRFQs(rfqRes.data);
      toast.success("RFQ created successfully");
    } catch (err: any) {
      console.error("createRFQ error:", err);
      toast.error(err.response?.data?.message || "Failed to create RFQ");
    }
  };

  // Create a new Quote
  const createQuote = async (
    quoteData: Omit<QuoteItem, "id" | "createdAt" | "homeTotal" | "mooWRTotal">
  ) => {
    try {
      await api.post("/quotes", quoteData);
      // refresh quotes for that RFQ
      const rfqQuotesRes = await api.get<QuoteItem[]>(
        `/quotes/${quoteData.rfqId}`
      );
      setQuotes((prev) => [
        ...prev.filter((q) => q.rfqId !== quoteData.rfqId),
        ...rfqQuotesRes.data,
      ]);
      // refresh RFQs
      const rfqRes = await api.get<RFQ[]>("/rfqs");
      setRFQs(rfqRes.data);
      toast.success("Quote submitted successfully");
    } catch (err: any) {
      console.error("createQuote error:", err);
      toast.error(err.response?.data?.message || "Failed to submit quote");
    }
  };

  // Finalize an RFQ (allocations)
  const finalizeRFQ = async (
    rfqId: string,
    allocation: Omit<Allocation, "createdAt">
  ) => {
    try {
      await api.post("/allocations", allocation);
      // refresh allocations for that RFQ
      const allocRes = await api.get<Allocation[]>(`/allocations/${rfqId}`);
      setAllocations((prev) => [
        ...prev.filter((a) => a.rfqId !== rfqId),
        ...allocRes.data,
      ]);
      // refresh RFQs
      const rfqRes = await api.get<RFQ[]>("/rfqs");
      setRFQs(rfqRes.data);
      toast.success("RFQ finalized successfully");
    } catch (err: any) {
      console.error("finalizeRFQ error:", err);
      toast.error(err.response?.data?.message || "Failed to finalize RFQ");
    }
  };

  const getUserRFQs = () => {
    if (!user) return [];

    if (user.role === "logistics") return rfqs;

    if (user.role === "admin") return rfqs; 

    return [];
  };

  const getVendorRFQs = () => {
    if (user?.role !== "vendor") return [];
    return rfqs.filter((r) => r.vendors.includes(user.company!));
  };

  const getVendorAllottedRFQs = () => {
    if (user?.role !== "vendor") return [];
    const rfqIds = allocations
      .filter((a) => a.vendorName === user.company)
      .map((a) => a.rfqId);
    return rfqs.filter((r) => rfqIds.includes(r.id));
  };

  const getRFQById = (id: string) => {
    return rfqs.find((r) => r.id === id);
  };

  const getQuotesByRFQId = (rfqId: string) => {
    return quotes.filter((q) => q.rfqId === rfqId);
  };

  const getAllocationsByRFQId = (rfqId: string) => {
    return allocations.filter((a) => a.rfqId === rfqId);
  };

  return (
    <DataContext.Provider
      value={{
        rfqs,
        quotes,
        allocations,
        isLoading,
        createRFQ,
        createQuote,
        finalizeRFQ,
        getUserRFQs,
        getVendorRFQs,
        getVendorAllottedRFQs,
        getRFQById,
        getQuotesByRFQId,
        getAllocationsByRFQId,
      }}
    >
      {children}
    </DataContext.Provider>
  );
};
