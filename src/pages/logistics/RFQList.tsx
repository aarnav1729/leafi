// root/src/pages/logistics/RFQList.tsx
import React, { useState, useEffect, useMemo } from "react";
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
import { toast } from "sonner";
import { RFQ } from "@/types/rfq.types";

interface Vendor {
  username: string;
  name: string;
  company: string;
}

type LookupRow = { id: string | number; value: string };

type LookupsResponse = {
  itemDescriptions: LookupRow[];
  companyNames: LookupRow[];
  suppliers: LookupRow[];
  portsOfLoading: LookupRow[];
  portsOfDestination: LookupRow[];
  incoterms?: LookupRow[];
  containerTypes: LookupRow[];
  vendors: Vendor[]; // optional (we still use /vendors below)
};

// suppliers.ts

// Fallback list if backend /lookups doesn't include incoterms yet
const DEFAULT_INCOTERMS = [
  "EXW",
  "FCA",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
];

const RFQList: React.FC = () => {
  const { getUserRFQs, createRFQ } = useData();
  const navigate = useNavigate();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [lookups, setLookups] = useState<LookupsResponse | null>(null);

  // Form state
  const [itemDescription, setItemDescription] =
    useState<RFQ["itemDescription"]>("");

  const [companyName, setCompanyName] = useState<RFQ["companyName"]>("");
  const [materialPONumber, setMaterialPONumber] = useState("");
  const [supplierName, setSupplierName] = useState<RFQ["supplierName"]>("");
  const [portOfLoading, setPortOfLoading] = useState<RFQ["portOfLoading"]>("");
  const [portOfDestination, setPortOfDestination] =
    useState<RFQ["portOfDestination"]>("");
  const [incoterms, setIncoterms] = useState<NonNullable<RFQ["incoterms"]>>("");
  const [containerType, setContainerType] = useState<RFQ["containerType"]>("");
  const [numberOfContainers, setNumberOfContainers] = useState(1);
  const [cargoWeight, setCargoWeight] = useState(1);
  const [cargoReadinessFrom, setCargoReadinessFrom] = useState("");
  const [cargoReadinessTo, setCargoReadinessTo] = useState("");

  const [description, setDescription] = useState("");

  // Attachments (optional) — stored as data URLs (base64) and sent to backend
  type RFQAttachment = {
    name: string;
    type: string;
    size: number;
    dataUrl: string; // "data:...base64,..."
  };

  const [attachments, setAttachments] = useState<RFQAttachment[]>([]);

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  async function addFilesAsAttachments(files: FileList | File[]) {
    const arr = Array.from(files || []);
    if (!arr.length) return;

    const mapped = await Promise.all(
      arr.map(async (f) => ({
        name: f.name,
        type: f.type || "application/octet-stream",
        size: f.size,
        dataUrl: await fileToDataUrl(f),
      }))
    );

    // Append (do not overwrite)
    setAttachments((prev) => [...prev, ...mapped]);
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  // Vendors selection
  const [vendors, setVendors] = useState<string[]>([]);
  const [vendorOptions, setVendorOptions] = useState<Vendor[]>([]);

  // Load RFQs
  const rfqs = getUserRFQs().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // =========================
  // Table: search/sort/filter/pagination
  // =========================

  type SortDir = "asc" | "desc";
  type SortConfig = { key: string; dir: SortDir };

  const [globalQuery, setGlobalQuery] = useState("");
  const [colFilters, setColFilters] = useState<Record<string, string>>({
    rfqNumber: "",
    itemDescription: "",
    companyName: "",
    materialPONumber: "",
    supplierName: "",
    portOfLoading: "",
    portOfDestination: "",
    incoterms: "",
    containerType: "",
    numberOfContainers: "",
    cargoWeight: "",
    cargoReadinessDate: "",
    status: "",
  });

  const [sort, setSort] = useState<SortConfig>({
    key: "createdAt",
    dir: "desc",
  });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const setFilter = (key: string, value: string) => {
    setColFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearAllFilters = () => {
    setGlobalQuery("");
    setColFilters({
      rfqNumber: "",
      itemDescription: "",
      companyName: "",
      materialPONumber: "",
      supplierName: "",
      portOfLoading: "",
      portOfDestination: "",
      incoterms: "",
      containerType: "",
      numberOfContainers: "",
      cargoWeight: "",
      cargoReadinessDate: "",
      status: "",
    });
    setSort({ key: "createdAt", dir: "desc" });
    setPage(1);
  };

  // Reset to page 1 whenever user changes filters/search/pageSize
  useEffect(() => {
    setPage(1);
  }, [globalQuery, colFilters, pageSize, sort.key, sort.dir]);

  const norm = (v: any) =>
    String(v ?? "")
      .trim()
      .toLowerCase();

  const splitReadiness = (v: any) => {
    const raw = String(v ?? "");
    const [from, to] = raw.includes("|") ? raw.split("|") : [raw, ""];
    return { from: from || "", to: to || "" };
  };

  const formatDateKey = (d: any) => {
    if (!d) return "";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    // Useful for "contains" search like 2025-12-22
    return `${yyyy}-${mm}-${dd}`;
  };

  const toggleSort = (key: string) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "asc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  };

  const sortIndicator = (key: string) => {
    if (sort.key !== key) return ""; // no indicator when not sorted
    return sort.dir === "asc" ? "ASC" : "DESC";
  };

  const matchesColumnFilter = (rfq: RFQ) => {
    const f = colFilters;

    const statusOk = !f.status || norm(rfq.status) === norm(f.status);

    const rd = splitReadiness((rfq as any).cargoReadinessDate);
    const readinessKey = [formatDateKey(rd.from), formatDateKey(rd.to)]
      .filter(Boolean)
      .join(" | ");

    return (
      statusOk &&
      (!f.rfqNumber ||
        norm((rfq as any).rfqNumber).includes(norm(f.rfqNumber))) &&
      (!f.itemDescription ||
        norm((rfq as any).itemDescription).includes(norm(f.itemDescription))) &&
      (!f.companyName ||
        norm((rfq as any).companyName).includes(norm(f.companyName))) &&
      (!f.materialPONumber ||
        norm((rfq as any).materialPONumber).includes(
          norm(f.materialPONumber)
        )) &&
      (!f.supplierName ||
        norm((rfq as any).supplierName).includes(norm(f.supplierName))) &&
      (!f.portOfLoading ||
        norm((rfq as any).portOfLoading).includes(norm(f.portOfLoading))) &&
      (!f.portOfDestination ||
        norm((rfq as any).portOfDestination).includes(
          norm(f.portOfDestination)
        )) &&
      (!f.incoterms ||
        norm((rfq as any).incoterms).includes(norm(f.incoterms))) &&
      (!f.containerType ||
        norm((rfq as any).containerType).includes(norm(f.containerType))) &&
      (!f.numberOfContainers ||
        norm((rfq as any).numberOfContainers).includes(
          norm(f.numberOfContainers)
        )) &&
      (!f.cargoWeight ||
        norm((rfq as any).cargoWeight).includes(norm(f.cargoWeight))) &&
      (!f.cargoReadinessDate ||
        readinessKey.includes(norm(f.cargoReadinessDate)))
    );
  };

  const matchesGlobal = (rfq: RFQ) => {
    if (!globalQuery.trim()) return true;
    const q = norm(globalQuery);

    const hay = [
      (rfq as any).rfqNumber,
      (rfq as any).itemDescription,
      (rfq as any).companyName,
      (rfq as any).materialPONumber,
      (rfq as any).supplierName,
      (rfq as any).portOfLoading,
      (rfq as any).portOfDestination,
      (rfq as any).incoterms,
      (rfq as any).containerType,
      (rfq as any).numberOfContainers,
      (rfq as any).cargoWeight,
      formatDateKey((rfq as any).cargoReadinessDate),
      (rfq as any).status,
    ]
      .map(norm)
      .join(" | ");

    return hay.includes(q);
  };

  const filteredSorted = useMemo(() => {
    const filtered = rfqs.filter(
      (r) => matchesGlobal(r) && matchesColumnFilter(r)
    );

    const key = sort.key;
    const dir = sort.dir;

    const getVal = (r: any) => {
      // Treat readiness date and createdAt as dates for sorting
      if (key === "cargoReadinessDate") {
        const { from } = splitReadiness(r[key]);
        const t = new Date(from).getTime();
        return Number.isNaN(t) ? 0 : t;
      }

      if (key === "createdAt") {
        const t = new Date(r[key]).getTime();
        return Number.isNaN(t) ? 0 : t;
      }

      // Numeric sorts
      if (
        key === "rfqNumber" ||
        key === "numberOfContainers" ||
        key === "cargoWeight"
      ) {
        const n = Number(r[key]);
        return Number.isNaN(n) ? 0 : n;
      }

      // Default: string
      return norm(r[key]);
    };

    const sorted = [...filtered].sort((a: any, b: any) => {
      const av = getVal(a);
      const bv = getVal(b);

      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }

      return dir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [rfqs, globalQuery, colFilters, sort]);

  const total = filteredSorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const paged = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredSorted.slice(start, start + pageSize);
  }, [filteredSorted, safePage, pageSize]);

  useEffect(() => {
    const fetchLookups = async () => {
      try {
        const res = await api.get<LookupsResponse>("/lookups");
        console.log("LOOKUPS counts:", {
          itemDescriptions: res.data?.itemDescriptions?.length,
          companyNames: res.data?.companyNames?.length,
          suppliers: res.data?.suppliers?.length,
          portsOfLoading: res.data?.portsOfLoading?.length,
          portsOfDestination: res.data?.portsOfDestination?.length,
          incoterms: res.data?.incoterms?.length,
          containerTypes: res.data?.containerTypes?.length,
        });

        setLookups(res.data);
      } catch (err) {
        console.error("Failed to load lookups:", err);
      }
    };
    fetchLookups();
  }, []);

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
    const po = String(materialPONumber || "").trim();

    if (!po) {
      toast.error("Material PO Number is required");
      return;
    }

    if (!incoterms) {
      toast.error("Incoterms is required");
      return;
    }

    if (!cargoReadinessFrom || !cargoReadinessTo) {
      toast.error("Cargo readiness window (From/To) is required");
      return;
    }

    const fromT = new Date(cargoReadinessFrom).getTime();
    const toT = new Date(cargoReadinessTo).getTime();
    if (!Number.isFinite(fromT) || !Number.isFinite(toT)) {
      toast.error("Invalid cargo readiness date/time");
      return;
    }
    if (toT < fromT) {
      toast.error("Cargo Readiness To cannot be before From");
      return;
    }

    createRFQ({
      itemDescription,
      companyName,
      materialPONumber: po,
      supplierName,
      portOfLoading,
      portOfDestination,
      incoterms,
      containerType,
      numberOfContainers,
      cargoWeight,

      // ✅ Send separately (backend expects these)
      cargoReadinessFrom,
      cargoReadinessTo,

      // ✅ Optional legacy field: keep FROM only (do NOT send pipe)
      cargoReadinessDate: cargoReadinessFrom,

      description,
      vendors,
      attachments,
      createdBy: "aarnav",
    });

    setIsCreateModalOpen(false);

    // Reset form
    setMaterialPONumber("");
    setNumberOfContainers(1);
    setCargoWeight(1);
    setCargoReadinessFrom("");
    setCargoReadinessTo("");
    setIncoterms("");
    setDescription("");
    setVendors([]);
    setAttachments([]);
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
          <DialogContent className="w-[90vw] max-w-[90vw] max-h-[90vh] overflow-y-auto">
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
                      {(lookups?.itemDescriptions || [])
                        .filter((r) => String(r.value || "").trim() !== "")
                        .map((r) => (
                          <SelectItem key={r.id} value={r.value}>
                            {r.value}
                          </SelectItem>
                        ))}
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
                    <SelectTrigger className="h-auto">
                      <SelectValue placeholder="Select company" />
                    </SelectTrigger>

                    <SelectContent className="max-w-[520px]">
                      {(lookups?.companyNames || []).map((r) => (
                        <SelectItem
                          key={r.id}
                          value={r.value}
                          className="whitespace-pre-wrap break-words"
                        >
                          {r.value}
                        </SelectItem>
                      ))}
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
                      {(lookups?.suppliers || []).map((r) => (
                        <SelectItem key={r.id} value={r.value}>
                          {r.value}
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
                      {(lookups?.portsOfLoading || []).map((r) => (
                        <SelectItem key={r.id} value={r.value}>
                          {r.value}
                        </SelectItem>
                      ))}
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
                      {(lookups?.portsOfDestination || []).map((r) => (
                        <SelectItem key={r.id} value={r.value}>
                          {r.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="incoterms">Incoterms</Label>
                  <Select value={incoterms} onValueChange={setIncoterms}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select incoterms" />
                    </SelectTrigger>
                    <SelectContent>
                      {((lookups?.incoterms || [])
                        .map((r) => String(r.value || "").trim())
                        .filter(Boolean).length
                        ? (lookups?.incoterms || []).map((r) => ({
                            id: r.id,
                            value: String(r.value || "").trim(),
                          }))
                        : DEFAULT_INCOTERMS.map((v) => ({
                            id: v,
                            value: v,
                          }))
                      ).map((r) => (
                        <SelectItem key={String(r.id)} value={r.value}>
                          {r.value}
                        </SelectItem>
                      ))}
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
                      {(lookups?.containerTypes || []).map((r) => (
                        <SelectItem key={r.id} value={r.value}>
                          {r.value}
                        </SelectItem>
                      ))}
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
                  <Label>Tentative Cargo Readiness Window</Label>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label
                        htmlFor="cargoReadinessFrom"
                        className="text-xs text-muted-foreground"
                      >
                        From
                      </Label>
                      <Input
                        id="cargoReadinessFrom"
                        type="datetime-local"
                        value={cargoReadinessFrom}
                        onChange={(e) => setCargoReadinessFrom(e.target.value)}
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <Label
                        htmlFor="cargoReadinessTo"
                        className="text-xs text-muted-foreground"
                      >
                        To
                      </Label>
                      <Input
                        id="cargoReadinessTo"
                        type="datetime-local"
                        value={cargoReadinessTo}
                        onChange={(e) => setCargoReadinessTo(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">
                  Description (Optional) — you can paste images here
                </Label>

                {/* Keep description as text; pasted images go into attachments automatically */}
                <textarea
                  id="description"
                  className="min-h-[90px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onPaste={async (e) => {
                    // If clipboard contains images, capture them as attachments
                    const items = Array.from(e.clipboardData?.items || []);
                    const imageItems = items.filter((it) =>
                      it.type?.startsWith("image/")
                    );
                    if (!imageItems.length) return;

                    e.preventDefault(); // prevent weird text insertion
                    const files: File[] = [];

                    for (const it of imageItems) {
                      const f = it.getAsFile();
                      if (f) {
                        // give a nicer name for pasted blobs
                        const ext = (
                          f.type.split("/")[1] || "png"
                        ).toLowerCase();
                        const named = new File(
                          [f],
                          `pasted-${Date.now()}.${ext}`,
                          {
                            type: f.type,
                          }
                        );
                        files.push(named);
                      }
                    }

                    if (files.length) {
                      await addFilesAsAttachments(files);

                      // Optional: add a marker into description text so it "feels" inline
                      setDescription((prev) => {
                        const marker = files
                          .map((f) => `[Image: ${f.name}]`)
                          .join("\n");
                        return prev ? `${prev}\n${marker}` : marker;
                      });
                    }
                  }}
                  placeholder="Type details… Paste an image here (Ctrl+V) to attach it."
                />

                <div className="grid gap-2">
                  <Label htmlFor="rfqAttachments">Attachments (Optional)</Label>
                  <Input
                    id="rfqAttachments"
                    type="file"
                    multiple
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (files && files.length) {
                        await addFilesAsAttachments(files);
                        e.target.value = ""; // allow selecting same file again
                      }
                    }}
                  />

                  {attachments.length > 0 && (
                    <div className="border rounded-md p-3 space-y-2">
                      <div className="text-sm font-medium">
                        Attachments ({attachments.length})
                      </div>

                      <div className="grid gap-2">
                        {attachments.map((a, idx) => {
                          const isImage = a.type.startsWith("image/");
                          return (
                            <div
                              key={`${a.name}-${idx}`}
                              className="flex items-start justify-between gap-3 border rounded-md p-2"
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-medium break-words">
                                  {a.name}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {a.type || "file"} •{" "}
                                  {(a.size / 1024).toFixed(1)} KB
                                </div>

                                {isImage && (
                                  <img
                                    src={a.dataUrl}
                                    alt={a.name}
                                    className="mt-2 max-h-40 rounded-md border"
                                  />
                                )}
                              </div>

                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => removeAttachment(idx)}
                              >
                                Remove
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
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

      {/* Table controls */}
      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Input
            value={globalQuery}
            onChange={(e) => setGlobalQuery(e.target.value)}
            placeholder="Search all columns…"
            className="w-[320px] max-w-full"
          />
          <Button type="button" variant="outline" onClick={clearAllFilters}>
            Clear
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Showing {total === 0 ? 0 : (safePage - 1) * pageSize + 1}–
            {Math.min(safePage * pageSize, total)} of {total}
          </span>

          <Select
            value={String(pageSize)}
            onValueChange={(v) => setPageSize(Number(v))}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Page size" />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 50, 100].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="w-full flex justify-center">
        <div className="rounded-md border w-full lg:w-[90vw] lg:max-w-[90vw]">
          <div className="overflow-x-auto">
            <table className="w-full data-table !mx-0 !max-w-none text-[15px] [&_th]:px-3 [&_th]:py-3 [&_td]:px-3 [&_td]:py-3 md:[&_th]:px-4 md:[&_td]:px-4">
              <thead>
                <tr>
                  <th>Actions</th>

                  <th>
                    <button
                      type="button"
                      className="font-semibold underline-offset-2 hover:underline"
                      onClick={() => toggleSort("rfqNumber")}
                    >
                      RFQ Number {sortIndicator("rfqNumber")}
                    </button>
                  </th>

                  <th>
                    <button
                      type="button"
                      className="font-semibold underline-offset-2 hover:underline"
                      onClick={() => toggleSort("itemDescription")}
                    >
                      Item Description {sortIndicator("itemDescription")}
                    </button>
                  </th>

                  <th>
                    <button
                      type="button"
                      className="font-semibold underline-offset-2 hover:underline"
                      onClick={() => toggleSort("companyName")}
                    >
                      Company {sortIndicator("companyName")}
                    </button>
                  </th>

                  <th>
                    <button
                      type="button"
                      className="font-semibold underline-offset-2 hover:underline"
                      onClick={() => toggleSort("materialPONumber")}
                    >
                      Material PO Number {sortIndicator("materialPONumber")}
                    </button>
                  </th>

                  <th>
                    <button
                      type="button"
                      className="font-semibold underline-offset-2 hover:underline"
                      onClick={() => toggleSort("supplierName")}
                    >
                      Supplier {sortIndicator("supplierName")}
                    </button>
                  </th>

                  <th>
                    <button
                      type="button"
                      className="font-semibold underline-offset-2 hover:underline"
                      onClick={() => toggleSort("portOfLoading")}
                    >
                      Port of Loading {sortIndicator("portOfLoading")}
                    </button>
                  </th>

                  <th>
                    <button
                      type="button"
                      className="font-semibold underline-offset-2 hover:underline"
                      onClick={() => toggleSort("portOfDestination")}
                    >
                      Port of Destination {sortIndicator("portOfDestination")}
                    </button>
                  </th>

                  <th>
                    <button
                      type="button"
                      className="font-semibold underline-offset-2 hover:underline"
                      onClick={() => toggleSort("containerType")}
                    >
                      Container Type {sortIndicator("containerType")}
                    </button>
                  </th>

                  <th>
                    <button
                      type="button"
                      className="font-semibold underline-offset-2 hover:underline"
                      onClick={() => toggleSort("containerType")}
                    >
                      Container Type {sortIndicator("containerType")}
                    </button>
                  </th>

                  <th>
                    <button
                      type="button"
                      className="font-semibold underline-offset-2 hover:underline"
                      onClick={() => toggleSort("numberOfContainers")}
                    >
                      No. of Containers {sortIndicator("numberOfContainers")}
                    </button>
                  </th>

                  <th>
                    <button
                      type="button"
                      className="font-semibold underline-offset-2 hover:underline"
                      onClick={() => toggleSort("cargoWeight")}
                    >
                      Weight (tons) {sortIndicator("cargoWeight")}
                    </button>
                  </th>

                  <th>
                    <button
                      type="button"
                      className="font-semibold underline-offset-2 hover:underline"
                      onClick={() => toggleSort("cargoReadinessDate")}
                    >
                      Readiness Date {sortIndicator("cargoReadinessDate")}
                    </button>
                  </th>

                  <th>
                    <button
                      type="button"
                      className="font-semibold underline-offset-2 hover:underline"
                      onClick={() => toggleSort("status")}
                    >
                      Status {sortIndicator("status")}
                    </button>
                  </th>
                </tr>

                {/* Filter row */}
                <tr>
                  <th />

                  <th>
                    <Input
                      value={colFilters.rfqNumber}
                      onChange={(e) => setFilter("rfqNumber", e.target.value)}
                      placeholder="Filter…"
                      className="h-8"
                    />
                  </th>

                  <th>
                    <Input
                      value={colFilters.itemDescription}
                      onChange={(e) =>
                        setFilter("itemDescription", e.target.value)
                      }
                      placeholder="Filter…"
                      className="h-8"
                    />
                  </th>

                  <th>
                    <Input
                      value={colFilters.companyName}
                      onChange={(e) => setFilter("companyName", e.target.value)}
                      placeholder="Filter…"
                      className="h-8"
                    />
                  </th>

                  <th>
                    <Input
                      value={colFilters.materialPONumber}
                      onChange={(e) =>
                        setFilter("materialPONumber", e.target.value)
                      }
                      placeholder="Filter…"
                      className="h-8"
                    />
                  </th>

                  <th>
                    <Input
                      value={colFilters.supplierName}
                      onChange={(e) =>
                        setFilter("supplierName", e.target.value)
                      }
                      placeholder="Filter…"
                      className="h-8"
                    />
                  </th>

                  <th>
                    <Input
                      value={colFilters.portOfLoading}
                      onChange={(e) =>
                        setFilter("portOfLoading", e.target.value)
                      }
                      placeholder="Filter…"
                      className="h-8"
                    />
                  </th>

                  <th>
                    <Input
                      value={colFilters.portOfDestination}
                      onChange={(e) =>
                        setFilter("portOfDestination", e.target.value)
                      }
                      placeholder="Filter…"
                      className="h-8"
                    />
                  </th>

                  <th>
                    <Input
                      value={colFilters.incoterms}
                      onChange={(e) => setFilter("incoterms", e.target.value)}
                      placeholder="EXW / FOB …"
                      className="h-8"
                    />
                  </th>

                  <th>
                    <Input
                      value={colFilters.containerType}
                      onChange={(e) =>
                        setFilter("containerType", e.target.value)
                      }
                      placeholder="Filter…"
                      className="h-8"
                    />
                  </th>

                  <th>
                    <Input
                      value={colFilters.numberOfContainers}
                      onChange={(e) =>
                        setFilter("numberOfContainers", e.target.value)
                      }
                      placeholder="Filter…"
                      className="h-8"
                    />
                  </th>

                  <th>
                    <Input
                      value={colFilters.cargoWeight}
                      onChange={(e) => setFilter("cargoWeight", e.target.value)}
                      placeholder="Filter…"
                      className="h-8"
                    />
                  </th>

                  <th>
                    <Input
                      value={colFilters.cargoReadinessDate}
                      onChange={(e) =>
                        setFilter("cargoReadinessDate", e.target.value)
                      }
                      placeholder="YYYY-MM-DD"
                      className="h-8"
                    />
                  </th>

                  <th>
                    <Select
                      value={colFilters.status || "__ALL__"}
                      onValueChange={(v) =>
                        setFilter("status", v === "__ALL__" ? "" : v)
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__ALL__">All</SelectItem>

                        {Array.from(
                          new Set(rfqs.map((r: any) => String(r.status || "")))
                        )
                          .filter(Boolean)
                          .sort()
                          .map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </th>
                </tr>
              </thead>

              <tbody>
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="text-center py-4">
                      No RFQs found. Create your first RFQ!
                    </td>
                  </tr>
                ) : (
                  paged.map((rfq) => (
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
                      <td className="whitespace-pre-wrap break-words max-w-[320px]">
                        {rfq.companyName}
                      </td>

                      <td>{rfq.materialPONumber}</td>
                      <td>{rfq.supplierName}</td>
                      <td>{rfq.portOfLoading}</td>
                      <td>{rfq.portOfDestination}</td>
                      <td>{(rfq as any).incoterms || "-"}</td>
                      <td>{rfq.containerType}</td>
                      <td>{rfq.numberOfContainers}</td>
                      <td>{rfq.cargoWeight}</td>
                      <td>
                        {(() => {
                          const rd = splitReadiness(
                            (rfq as any).cargoReadinessDate
                          );
                          const fromTxt = rd.from
                            ? new Date(rd.from).toLocaleDateString()
                            : "";
                          const toTxt = rd.to
                            ? new Date(rd.to).toLocaleDateString()
                            : "";
                          return toTxt ? `${fromTxt} → ${toTxt}` : fromTxt;
                        })()}
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
      {/* Pagination */}
      <div className="flex items-center justify-between mt-3">
        <div className="text-sm text-muted-foreground">
          Page {safePage} of {totalPages}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
          >
            Prev
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RFQList;
