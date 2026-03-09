// root/src/contexts/DataContext.tsx
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { RFQ, QuoteItem, Allocation } from "@/types/rfq.types";
import { useAuth } from "./AuthContext";

interface DataContextType {
  rfqs: RFQ[];
  quotes: QuoteItem[];
  allocations: Allocation[];
  isLoading: boolean;
  isRefreshing: boolean;
  lastRefreshedAt: string | null;
  refreshKey: number;
  refreshAll: () => Promise<void>;
  createRFQ: (
    rfq: Omit<RFQ, "id" | "rfqNumber" | "createdAt" | "status">
  ) => Promise<void>;
  createQuote: (
    quote: Omit<QuoteItem, "id" | "createdAt" | "homeTotal" | "mooWRTotal">
  ) => Promise<{ action: "created" | "updated"; message?: string }>;
  updateQuotePricing: (
    rfqId: string,
    quoteId: string,
    fields: Partial<
      Pick<
        QuoteItem,
        | "seaFreightPerContainer"
        | "houseDeliveryOrderPerBOL"
        | "cfsPerContainer"
        | "transportationPerContainer"
        | "ediChargesPerBOE"
        | "chaChargesHome"
        | "chaChargesMOOWR"
        | "mooWRReeWarehousingCharges"
      >
    >,
    usdToInr?: number
  ) => Promise<void>;
  deleteRFQ: (rfqId: string, reason: string) => Promise<void>;
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshAll = useCallback(async () => {
    if (!user) {
      setRFQs([]);
      setQuotes([]);
      setAllocations([]);
      setIsLoading(false);
      setIsRefreshing(false);
      setLastRefreshedAt(null);
      setRefreshKey((prev) => prev + 1);
      return;
    }

    setIsLoading(true);
    setIsRefreshing(true);
    try {
      const rfqRes = await api.get<RFQ[]>("/rfqs");
      setRFQs(rfqRes.data);

      const quoteArrays = await Promise.all(
        rfqRes.data.map((rfq) =>
          api.get<QuoteItem[]>(`/quotes/${rfq.id}`).then((res) => res.data)
        )
      );
      setQuotes(quoteArrays.flat());

      const allocArrays = await Promise.all(
        rfqRes.data.map((rfq) =>
          api
            .get<Allocation[]>(`/allocations/${rfq.id}`)
            .then((res) => res.data)
        )
      );
      setAllocations(allocArrays.flat());
      setLastRefreshedAt(new Date().toISOString());
      setRefreshKey((prev) => prev + 1);
    } catch (err: any) {
      console.error("Data load error:", err);
      toast.error("Error loading data from server");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void refreshAll();
  }, [authLoading, refreshAll]);

  useEffect(() => {
    if (authLoading || !user) return;

    const intervalId = window.setInterval(() => {
      void refreshAll();
    }, 60 * 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, [authLoading, user, refreshAll]);

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
      const response = await api.post<{
        action: "created" | "updated";
        message?: string;
      }>("/quotes", quoteData);
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
      toast.success(
        response.data?.message ||
          (response.data?.action === "updated"
            ? "Quote updated successfully"
            : "Quote submitted successfully")
      );
      return response.data;
    } catch (err: any) {
      console.error("createQuote error:", err);
      toast.error(err.response?.data?.message || "Failed to submit quote");
      throw err;
    }
  };

  const updateQuotePricing = async (
    rfqId: string,
    quoteId: string,
    fields: Partial<
      Pick<
        QuoteItem,
        | "seaFreightPerContainer"
        | "houseDeliveryOrderPerBOL"
        | "cfsPerContainer"
        | "transportationPerContainer"
        | "ediChargesPerBOE"
        | "chaChargesHome"
        | "chaChargesMOOWR"
        | "mooWRReeWarehousingCharges"
      >
    >,
    usdToInr?: number
  ) => {
    try {
      await api.put(`/quotes/${quoteId}/logistics-pricing`, {
        ...fields,
        usdToInr,
      });

      const rfqQuotesRes = await api.get<QuoteItem[]>(`/quotes/${rfqId}`);
      setQuotes((prev) => [
        ...prev.filter((q) => q.rfqId !== rfqId),
        ...rfqQuotesRes.data,
      ]);
    } catch (err: any) {
      console.error("updateQuotePricing error:", err);
      toast.error(
        err.response?.data?.message || "Failed to save logistics pricing"
      );
      throw err;
    }
  };

  const deleteRFQ = async (rfqId: string, reason: string) => {
    try {
      await api.delete(`/rfqs/${rfqId}`, {
        data: { reason },
      });

      setRFQs((prev) => prev.filter((rfq) => rfq.id !== rfqId));
      setQuotes((prev) => prev.filter((quote) => quote.rfqId !== rfqId));
      setAllocations((prev) =>
        prev.filter((allocation) => allocation.rfqId !== rfqId)
      );
      toast.success("RFQ deleted successfully");
    } catch (err: any) {
      console.error("deleteRFQ error:", err);
      toast.error(err.response?.data?.message || "Failed to delete RFQ");
      throw err;
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
        isRefreshing,
        lastRefreshedAt,
        refreshKey,
        refreshAll,
        createRFQ,
        createQuote,
        updateQuotePricing,
        deleteRFQ,
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
