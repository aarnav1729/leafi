import { useState, useEffect } from "react";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { StatusBadge } from "@/components/common/StatusBadge";
import { format } from "date-fns";
import { RFQ, QuoteItem } from "@/types/rfq.types";

const VendorRFQList = () => {
  const { user } = useAuth();
  const { getVendorRFQs, createQuote, getQuotesByRFQId } = useData();

  const [selectedRFQ, setSelectedRFQ] = useState<RFQ | null>(null);
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [usdToInr, setUsdToInr] = useState<number>(75);

  // Form state
  const [numberOfContainers, setNumberOfContainers] = useState(1);
  const [shippingLineName, setShippingLineName] = useState("");
  const [vesselName, setVesselName] = useState("");
  const [vesselETD, setVesselETD] = useState("");
  const [vesselETA, setVesselETA] = useState("");
  const [seaFreightPerContainer, setSeaFreightPerContainer] = useState("");
  const [houseDeliveryOrderPerBOL, setHouseDeliveryOrderPerBOL] = useState("");
  const [cfsPerContainer, setCfsPerContainer] = useState("");
  const [transportationPerContainer, setTransportationPerContainer] =
    useState("");
  const [chaChargesHome, setChaChargesHome] = useState("");
  const [chaChargesMOOWR, setChaChargesMOOWR] = useState("");
  const [ediChargesPerBOE, setEdiChargesPerBOE] = useState("");
  const [mooWRReeWarehousingCharges, setMooWRReeWarehousingCharges] =
    useState("");

  const [transshipOrDirect, setTransshipOrDirect] = useState<
    "transship" | "direct"
  >("direct");
  const [quoteValidityDate, setQuoteValidityDate] = useState("");
  const [message, setMessage] = useState("");

  // Attachment viewer (inline)
  const [attachmentViewerOpen, setAttachmentViewerOpen] = useState(false);
  const [attachmentPreviewError, setAttachmentPreviewError] = useState(false);
  const [activeAttachment, setActiveAttachment] = useState<{
    name: string;
    rawHref: string;
    viewSrc: string;
    kind: "pdf" | "image" | "office" | "other";
  } | null>(null);

  const rfqs = getVendorRFQs().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const openQuoteModal = async (rfq: RFQ) => {
    setSelectedRFQ(rfq);

    // default baseline (same as today)
    setNumberOfContainers(rfq.numberOfContainers);

    // IMPORTANT: clear old values so switching RFQs doesn't show stale fields
    resetForm();

    setQuoteModalOpen(true);

    // Prefill from vendor's latest quote (if any) using already-loaded DataContext quotes
    const allQuotesForRfq = getQuotesByRFQId(rfq.id) || [];

    const latestMine = allQuotesForRfq
      .filter((x) => x.vendorName === user?.company)
      .sort(
        (a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];

    if (latestMine) {
      const toStr = (v: any) =>
        v === null || v === undefined ? "" : String(v);

      setNumberOfContainers(
        Number(latestMine.numberOfContainers || rfq.numberOfContainers)
      );
      setShippingLineName(latestMine.shippingLineName || "");
      setVesselName(latestMine.vesselName || "");
      setVesselETD(toDateInputValue((latestMine as any).vesselETD));
      setVesselETA(toDateInputValue((latestMine as any).vesselETA));
      setSeaFreightPerContainer(toStr(latestMine.seaFreightPerContainer));
      setHouseDeliveryOrderPerBOL(toStr(latestMine.houseDeliveryOrderPerBOL));
      setCfsPerContainer(toStr(latestMine.cfsPerContainer));
      setTransportationPerContainer(
        toStr(latestMine.transportationPerContainer)
      );
      setChaChargesHome(toStr(latestMine.chaChargesHome));
      setChaChargesMOOWR(toStr(latestMine.chaChargesMOOWR));
      setEdiChargesPerBOE(toStr(latestMine.ediChargesPerBOE));
      setMooWRReeWarehousingCharges(
        toStr(latestMine.mooWRReeWarehousingCharges)
      );

      setTransshipOrDirect(
        ((latestMine as any).transshipOrDirect as "transship" | "direct") ||
          "direct"
      );
      setQuoteValidityDate(
        toDateInputValue((latestMine as any).quoteValidityDate)
      );
      setMessage(latestMine.message || "");
    }
  };

  // ★ Fetch the live rate once:
  useEffect(() => {
    fetch("https://14.194.111.58:30443/api/rate/usdinr")
      .then((res) => res.json())
      .then(({ rate }) => setUsdToInr(rate))
      .catch(() => setUsdToInr(75));
  }, []);

  const handleSubmitQuote = () => {
    if (!selectedRFQ || !user?.company) return;

    createQuote({
      rfqId: selectedRFQ.id,
      vendorName: user.company,
      numberOfContainers,
      shippingLineName,
      containerType: selectedRFQ.containerType,
      vesselName,
      vesselETD,
      vesselETA,
      seaFreightPerContainer: toNum(seaFreightPerContainer),
      houseDeliveryOrderPerBOL: toNum(houseDeliveryOrderPerBOL),
      cfsPerContainer: toNum(cfsPerContainer),
      transportationPerContainer: toNum(transportationPerContainer),
      chaChargesHome: toNum(chaChargesHome),
      chaChargesMOOWR: toNum(chaChargesMOOWR),
      ediChargesPerBOE: toNum(ediChargesPerBOE),
      mooWRReeWarehousingCharges: toNum(mooWRReeWarehousingCharges),

      transshipOrDirect,
      quoteValidityDate,
      message,
    });

    // Reset form and close modal
    setQuoteModalOpen(false);
    setSelectedRFQ(null);
    resetForm();
  };

  const resetForm = () => {
    setShippingLineName("");
    setVesselName("");
    setVesselETD("");
    setVesselETA("");
    setSeaFreightPerContainer("");
    setHouseDeliveryOrderPerBOL("");
    setCfsPerContainer("");
    setTransportationPerContainer("");
    setChaChargesHome("");
    setChaChargesMOOWR("");
    setEdiChargesPerBOE("");
    setMooWRReeWarehousingCharges("");

    setTransshipOrDirect("direct");
    setQuoteValidityDate("");
    setMessage("");
  };

  const toNum = (v: any) => {
    if (v === "" || v === null || v === undefined) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // Calculate totals for display in the form
  const seaFreightUSD = toNum(seaFreightPerContainer);
  const houseDO = toNum(houseDeliveryOrderPerBOL);
  const cfs = toNum(cfsPerContainer);
  const transport = toNum(transportationPerContainer);
  const chaHome = toNum(chaChargesHome);
  const chaMoowr = toNum(chaChargesMOOWR);
  const edi = toNum(ediChargesPerBOE);
  const moowrRewh = toNum(mooWRReeWarehousingCharges);

  const seaFreightINR = seaFreightUSD * usdToInr;

  const homeTotalINR =
    seaFreightINR + houseDO + cfs + transport + edi + chaHome;

  const mooWRTotalINR =
    seaFreightINR + houseDO + cfs + transport + edi + moowrRewh + chaMoowr;

  const isQuoteAllowed = (rfq: RFQ) => {
    // Only block quoting when RFQ is closed
    return rfq.status !== "closed";
  };

  const toDateInputValue = (d: any) => {
    if (!d) return "";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  // --- attachments/description helpers (robust against DB string or array) ---
  const parseAttachments = (raw: any): any[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;

    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const getAttachmentName = (a: any, idx: number) => {
    return (
      a?.name ||
      a?.fileName ||
      a?.filename ||
      a?.originalname ||
      a?.key ||
      a?.path ||
      `Attachment ${idx + 1}`
    );
  };

  const getAttachmentHref = (a: any): string | null => {
    const url = a?.url || a?.href || a?.link;
    if (typeof url === "string" && url.trim()) return url;

    const dataUrl = a?.dataUrl || a?.dataURI;
    if (typeof dataUrl === "string" && dataUrl.startsWith("data:"))
      return dataUrl;

    const b64 = a?.base64 || a?.content;
    if (typeof b64 === "string" && b64.length > 200) {
      // fallback: treat as base64 binary
      return `data:application/octet-stream;base64,${b64}`;
    }

    return null;
  };

  const normalizeHref = (href: string) => {
    if (!href) return href;
    if (href.startsWith("data:")) return href;
    if (href.startsWith("http://") || href.startsWith("https://")) return href;

    // handle relative paths
    if (href.startsWith("/")) return `${window.location.origin}${href}`;
    return `${window.location.origin}/${href}`;
  };

  const guessKind = (nameOrHref: string) => {
    const s = String(nameOrHref || "").toLowerCase();
    if (s.includes(".pdf")) return "pdf" as const;

    if (
      s.endsWith(".png") ||
      s.endsWith(".jpg") ||
      s.endsWith(".jpeg") ||
      s.endsWith(".webp") ||
      s.endsWith(".gif") ||
      s.endsWith(".bmp") ||
      s.endsWith(".svg")
    ) {
      return "image" as const;
    }

    if (
      s.endsWith(".doc") ||
      s.endsWith(".docx") ||
      s.endsWith(".xls") ||
      s.endsWith(".xlsx") ||
      s.endsWith(".ppt") ||
      s.endsWith(".pptx")
    ) {
      return "office" as const;
    }

    return "other" as const;
  };

  const buildViewSrc = (rawHref: string, name: string) => {
    const href = normalizeHref(rawHref);
    const kind = guessKind(name || href);

    // Office docs: try Office Online viewer (works only if file is reachable from internet)
    if (kind === "office" && href && !href.startsWith("data:")) {
      return {
        kind,
        viewSrc: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(
          href
        )}`,
      };
    }

    return { kind, viewSrc: href };
  };

  const openAttachmentViewer = (att: any, idx: number) => {
    const rawHref = getAttachmentHref(att);
    if (!rawHref) return;

    const name = getAttachmentName(att, idx);
    const built = buildViewSrc(rawHref, name);

    setAttachmentPreviewError(false);
    setActiveAttachment({
      name,
      rawHref: normalizeHref(rawHref),
      viewSrc: built.viewSrc,
      kind: built.kind,
    });
    setAttachmentViewerOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">RFQ List</h1>
      </div>

      <div className="rounded-md border">
        <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr>
                <th>Actions</th>
                <th>RFQ Number</th>
                <th>Item</th>
                <th>Company</th>
                <th>Supplier</th>
                <th>Loading Port</th>
                <th>Destination Port</th>
                <th>Container Type</th>
                <th>No. of Containers</th>
                <th>Weight (tons)</th>
                <th>Readiness Date</th>
                <th>PO Number</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rfqs.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-4">
                    No RFQs found for your company.
                  </td>
                </tr>
              ) : (
                rfqs.map((rfq) => (
                  <tr key={rfq.id}>
                    <td>
                      {isQuoteAllowed(rfq) ? (
                        <Button size="sm" onClick={() => openQuoteModal(rfq)}>
                          Quote
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" disabled>
                          Quote
                        </Button>
                      )}
                    </td>
                    <td>{rfq.rfqNumber}</td>
                    <td>{rfq.itemDescription}</td>
                    <td>{rfq.companyName}</td>
                    <td>{rfq.supplierName}</td>
                    <td>{rfq.portOfLoading}</td>
                    <td>{rfq.portOfDestination}</td>
                    <td>{rfq.containerType}</td>
                    <td>{rfq.numberOfContainers}</td>
                    <td>{rfq.cargoWeight}</td>
                    <td>
                      {new Date(rfq.cargoReadinessDate).toLocaleDateString()}
                    </td>
                    <td>{rfq.materialPONumber}</td>
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

      {/* Quote submission modal */}
      <Dialog open={quoteModalOpen} onOpenChange={setQuoteModalOpen}>
        <DialogContent className="w-[95vw] md:w-[80vw] max-w-none max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Submit Quote for RFQ #{selectedRFQ?.rfqNumber}
            </DialogTitle>
          </DialogHeader>

          {selectedRFQ && (
            <div className="grid gap-6 py-4">
              {/* RFQ details */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Item Description</Label>
                  <div className="mt-1 font-medium">
                    {selectedRFQ.itemDescription}
                  </div>
                </div>
                <div>
                  <Label>Company Name</Label>
                  <div className="mt-1 font-medium">
                    {selectedRFQ.companyName}
                  </div>
                </div>
                <div>
                  <Label>Material PO Number</Label>
                  <div className="mt-1 font-medium">
                    {selectedRFQ.materialPONumber}
                  </div>
                </div>
                <div>
                  <Label>Supplier Name</Label>
                  <div className="mt-1 font-medium">
                    {selectedRFQ.supplierName}
                  </div>
                </div>
                <div>
                  <Label>Port of Loading</Label>
                  <div className="mt-1 font-medium">
                    {selectedRFQ.portOfLoading}
                  </div>
                </div>
                <div>
                  <Label>Port of Destination</Label>
                  <div className="mt-1 font-medium">
                    {selectedRFQ.portOfDestination}
                  </div>
                </div>
                <div>
                  <Label>Container Type</Label>
                  <div className="mt-1 font-medium">
                    {selectedRFQ.containerType}
                  </div>
                </div>
                <div>
                  <Label>Number of Containers</Label>
                  <div className="mt-1 font-medium">
                    {selectedRFQ.numberOfContainers}
                  </div>
                </div>
                <div>
                  <Label>Cargo Weight</Label>
                  <div className="mt-1 font-medium">
                    {selectedRFQ.cargoWeight} tons
                  </div>
                </div>
                <div>
                  <Label>Cargo Readiness Date</Label>
                  <div className="mt-1 font-medium">
                    {new Date(
                      selectedRFQ.cargoReadinessDate
                    ).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Message + Attachments (shown to vendor) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-md border p-3 bg-muted/20">
                  <Label>Message from Logistics</Label>
                  <div className="mt-2 text-sm whitespace-pre-wrap">
                    {(selectedRFQ as any).description?.trim()
                      ? (selectedRFQ as any).description
                      : "—"}
                  </div>
                </div>

                <div className="rounded-md border p-3 bg-muted/20">
                  <Label>Attachments</Label>
                  <div className="mt-2">
                    {parseAttachments((selectedRFQ as any).attachments)
                      .length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        No attachments
                      </div>
                    ) : (
                      <ul className="space-y-2">
                        {parseAttachments((selectedRFQ as any).attachments).map(
                          (att: any, idx: number) => {
                            const href = getAttachmentHref(att);
                            const name = getAttachmentName(att, idx);

                            return (
                              <li
                                key={idx}
                                className="flex items-center justify-between gap-3"
                              >
                                <div className="text-sm truncate">{name}</div>
                                {href ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      openAttachmentViewer(att, idx)
                                    }
                                  >
                                    View
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    (no link)
                                  </span>
                                )}
                              </li>
                            );
                          }
                        )}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              {/* Inline attachment viewer */}
              <Dialog
                open={attachmentViewerOpen}
                onOpenChange={setAttachmentViewerOpen}
              >
                <DialogContent className="w-[95vw] md:w-[85vw] max-w-none h-[90vh] overflow-hidden">
                  <DialogHeader>
                    <DialogTitle>
                      {activeAttachment?.name || "Attachment"}
                    </DialogTitle>
                  </DialogHeader>

                  <div className="h-[78vh] rounded-md border bg-background overflow-hidden">
                    {!activeAttachment?.viewSrc ? (
                      <div className="p-4 text-sm text-muted-foreground">
                        No preview available.
                      </div>
                    ) : attachmentPreviewError ? (
                      <div className="p-4 text-sm">
                        <div className="text-muted-foreground">
                          Preview blocked/unavailable (common if the file URL
                          disallows embedding / requires auth).
                        </div>

                        {/* Fallback: allow download in same tab */}
                        <div className="mt-3">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              if (activeAttachment?.rawHref) {
                                window.location.href = activeAttachment.rawHref; // same-tab navigation/download
                              }
                            }}
                          >
                            Download / Open
                          </Button>
                        </div>
                      </div>
                    ) : activeAttachment.kind === "image" ? (
                      <img
                        src={activeAttachment.viewSrc}
                        alt={activeAttachment.name}
                        className="w-full h-full object-contain"
                        onError={() => setAttachmentPreviewError(true)}
                      />
                    ) : (
                      <iframe
                        title={activeAttachment.name}
                        src={activeAttachment.viewSrc}
                        className="w-full h-full"
                        onError={() => setAttachmentPreviewError(true)}
                      />
                    )}
                  </div>
                </DialogContent>
              </Dialog>

              <div className="border-t mt-4 pt-4">
                <h3 className="text-lg font-medium mb-4">Quote Details</h3>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="numberOfContainers">
                      Number of Containers
                    </Label>
                    <Input
                      id="numberOfContainers"
                      type="number"
                      min="1"
                      max={selectedRFQ.numberOfContainers}
                      value={numberOfContainers}
                      onChange={(e) =>
                        setNumberOfContainers(parseInt(e.target.value) || 1)
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="shippingLineName">Shipping Line Name</Label>
                    <Input
                      id="shippingLineName"
                      value={shippingLineName}
                      onChange={(e) => setShippingLineName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="containerType">Container Type</Label>
                    <Input
                      id="containerType"
                      value={selectedRFQ.containerType}
                      disabled
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="vesselName">Vessel Name</Label>
                    <Input
                      id="vesselName"
                      value={vesselName}
                      onChange={(e) => setVesselName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="vesselETD">Vessel ETD</Label>
                    <Input
                      id="vesselETD"
                      type="date"
                      value={vesselETD}
                      onChange={(e) => setVesselETD(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="vesselETA">Vessel ETA</Label>
                    <Input
                      id="vesselETA"
                      type="date"
                      value={vesselETA}
                      onChange={(e) => setVesselETA(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="seaFreightPerContainer">
                      Sea Freight Per Container (USD)
                    </Label>
                    <Input
                      id="seaFreightPerContainer"
                      type="number"
                      min="0"
                      step="0.01"
                      value={seaFreightPerContainer}
                      onChange={(e) =>
                        setSeaFreightPerContainer(e.target.value)
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="houseDeliveryOrderPerBOL">
                      House Delivery Order Per Bill of Lading (INR)
                    </Label>
                    <Input
                      id="houseDeliveryOrderPerBOL"
                      type="number"
                      min="0"
                      step="0.01"
                      value={houseDeliveryOrderPerBOL}
                      onChange={(e) =>
                        setHouseDeliveryOrderPerBOL(e.target.value)
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cfsPerContainer">
                      CFS Per Container (INR)
                    </Label>
                    <Input
                      id="cfsPerContainer"
                      type="number"
                      min="0"
                      step="0.01"
                      value={cfsPerContainer}
                      onChange={(e) => setCfsPerContainer(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="transportationPerContainer">
                      Transportation Per Container (INR)
                    </Label>
                    <Input
                      id="transportationPerContainer"
                      type="number"
                      min="0"
                      step="0.01"
                      value={transportationPerContainer}
                      onChange={(e) =>
                        setTransportationPerContainer(e.target.value)
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="chaChargesHome">
                      CHA Charges - Home Per Container (INR)
                    </Label>
                    <Input
                      id="chaChargesHome"
                      type="number"
                      min="0"
                      step="0.01"
                      value={chaChargesHome}
                      onChange={(e) => setChaChargesHome(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="chaChargesMOOWR">
                      CHA Charges - MOOWR Scheme Per Container (INR)
                    </Label>
                    <Input
                      id="chaChargesMOOWR"
                      type="number"
                      min="0"
                      step="0.01"
                      value={chaChargesMOOWR}
                      onChange={(e) => setChaChargesMOOWR(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ediChargesPerBOE">
                      EDI Charges Per BOE (INR)
                    </Label>
                    <Input
                      id="ediChargesPerBOE"
                      type="number"
                      min="0"
                      step="0.01"
                      value={ediChargesPerBOE}
                      onChange={(e) => setEdiChargesPerBOE(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="mooWRReeWarehousingCharges">
                      MOOWR Re-Warehousing Charges per BOE (INR)
                    </Label>
                    <Input
                      id="mooWRReeWarehousingCharges"
                      type="number"
                      min="0"
                      step="0.01"
                      value={mooWRReeWarehousingCharges}
                      onChange={(e) =>
                        setMooWRReeWarehousingCharges(e.target.value)
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="transshipOrDirect">
                      Transship or Direct
                    </Label>
                    <Select
                      value={transshipOrDirect}
                      onValueChange={(value) =>
                        setTransshipOrDirect(value as "transship" | "direct")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select option" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direct">Direct</SelectItem>
                        <SelectItem value="transship">Transship</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="quoteValidityDate">
                      Quote Validity Date
                    </Label>
                    <Input
                      id="quoteValidityDate"
                      type="date"
                      value={quoteValidityDate}
                      onChange={(e) => setQuoteValidityDate(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2 mt-4">
                  <Label htmlFor="message">Message (Optional)</Label>
                  <Input
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </div>

                {/* Total calculations */}
                <div className="grid grid-cols-2 gap-4 mt-6 bg-muted/20 p-4 rounded-lg">
                  <div className="space-y-2">
                    <Label className="text-lg">
                      Total with CHA - Home (INR)
                    </Label>
                    <div className="text-xl font-bold">
                      ₹{homeTotalINR.toFixed(2)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Sea Freight (₹{seaFreightINR.toFixed(2)}) + House Delivery
                      (₹
                      {houseDO.toFixed(2)}) + CFS (₹{cfs.toFixed(2)}) +
                      Transportation (₹
                      {transport.toFixed(2)}) + EDI (₹{edi.toFixed(2)}) +
                      CHA-Home (₹
                      {chaHome.toFixed(2)})
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-lg">
                      Total with CHA - MOOWR (INR)
                    </Label>
                    <div className="text-xl font-bold">
                      ₹{mooWRTotalINR.toFixed(2)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Sea Freight (₹{seaFreightINR.toFixed(2)}) + House Delivery
                      (₹
                      {houseDO.toFixed(2)}) + CFS (₹{cfs.toFixed(2)}) +
                      Transportation (₹
                      {transport.toFixed(2)}) + EDI (₹{edi.toFixed(2)}) + MOOWR
                      Re-Warehousing (₹
                      {moowrRewh.toFixed(2)}) + CHA-MOOWR (₹
                      {chaMoowr.toFixed(2)})
                    </div>
                  </div>
                </div>
              </div>

              <Button onClick={handleSubmitQuote} className="mt-4">
                Submit Quote
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VendorRFQList;
