/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useData } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Maximize2, X, ChevronDown } from "lucide-react";

const API_BASE_URL = `${window.location.origin}/api`;

interface LineTotals {
  home: number;
  moowr: number;
}

interface AllocDraft {
  containersAllottedHome: number;
  containersAllottedMOOWR: number;
}

type PriceField =
  | "seaFreightPerContainer"
  | "houseDeliveryOrderPerBOL"
  | "cfsPerContainer"
  | "transportationPerContainer"
  | "ediChargesPerBOE"
  | "chaChargesHome"
  | "chaChargesMOOWR"
  | "mooWRReeWarehousingCharges";

type PriceDraft = Partial<Record<PriceField, number>>;

type TableMode = "leafi" | "logistics" | "combined";

type Scheme = "home" | "moowr";

const fmt = {
  num: (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  },
  date: (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
  },
  datetime: (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
  },
  money: (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? `₹${n.toFixed(2)}` : "₹0.00";
  },
  plain: (v: any) => (v === null || v === undefined ? "" : String(v)),
  diffMoney: (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "₹0.00";
    const sign = n > 0 ? "+" : n < 0 ? "−" : "";
    const abs = Math.abs(n);
    return `${sign}₹${abs.toFixed(2)}`;
  },
};

const FinalizeRFQ: React.FC = () => {
  const { rfqId } = useParams<{ rfqId: string }>();
  const navigate = useNavigate();
  const { getRFQById, getQuotesByRFQId, getAllocationsByRFQId, finalizeRFQ } =
    useData();

  const rfq = getRFQById(rfqId || "");
  const quotes = getQuotesByRFQId(rfqId || "");

  // display-only FX (used for showing Sea Freight INR; logistics price edits also use this FX)
  const [usdToInr, setUsdToInr] = useState<number>(75);

  useEffect(() => {
    fetch(`${API_BASE_URL}/rate/usdinr`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const rate = Number(d?.rate);
        setUsdToInr(Number.isFinite(rate) ? rate : 75);
      })
      .catch(() => setUsdToInr(75));
  }, []);

  // Load all saved allocations for this RFQ (may be multiple partials)
  const existingAllocations = useMemo(
    () => getAllocationsByRFQId(rfqId || ""),
    [getAllocationsByRFQId, rfqId]
  );

  // Map quoteId → sum of already‐saved allocations
  const existingMap: Record<string, AllocDraft> = useMemo(() => {
    const m: Record<string, AllocDraft> = {};
    for (const a of existingAllocations) {
      if (!m[a.quoteId]) {
        m[a.quoteId] = {
          containersAllottedHome: 0,
          containersAllottedMOOWR: 0,
        };
      }
      m[a.quoteId].containersAllottedHome += a.containersAllottedHome;
      m[a.quoteId].containersAllottedMOOWR += a.containersAllottedMOOWR;
    }
    return m;
  }, [existingAllocations]);

  // Total already‐saved
  const existingTotal = useMemo(
    () =>
      Object.values(existingMap).reduce(
        (sum, a) => sum + a.containersAllottedHome + a.containersAllottedMOOWR,
        0
      ),
    [existingMap]
  );

  // autoAlloc = LEAFI’s cheapest‐combo suggestion (read‐only)
  const [autoAlloc, setAutoAlloc] = useState<Record<string, AllocDraft>>({});
  // alloc = user’s manual (partial) allocations
  const [alloc, setAlloc] = useState<Record<string, AllocDraft>>(existingMap);

  // logistics price edits (per quoteId)
  const [priceEdits, setPriceEdits] = useState<Record<string, PriceDraft>>({});

  const [reasonModal, setReasonModal] = useState(false);
  const [deviationReason, setDeviationReason] = useState("");
  // Collapsible: Vendor submission + LEAFI (collapsed by default)
  const [vendorLeafiOpen, setVendorLeafiOpen] = useState(false);

  // Fullscreen table dialog
  const [tableFs, setTableFs] = useState<{
    open: boolean;
    title: string;
    mode: TableMode;
    scheme: Scheme;
  }>({ open: false, title: "", mode: "leafi", scheme: "home" });

  const openFullscreen = (title: string, mode: TableMode, scheme: Scheme) => {
    setTableFs({ open: true, title, mode, scheme });
  };

  const getQuoteValue = (q: any, quoteId: string, field: PriceField) => {
    const edited = priceEdits[quoteId]?.[field];
    if (edited === null || edited === undefined) return fmt.num(q?.[field]);
    return fmt.num(edited);
  };

  const hasAnyPriceEdits = useMemo(() => {
    for (const q of quotes) {
      const ed = priceEdits[q.id];
      if (!ed) continue;
      const fields = Object.keys(ed) as PriceField[];
      for (const f of fields) {
        const v = ed[f];
        if (v === null || v === undefined) continue;
        const orig = fmt.num(q?.[f]);
        if (Math.abs(fmt.num(v) - orig) > 1e-9) return true;
      }
    }
    return false;
  }, [priceEdits, quotes]);

  /* ─────────────── BASE (LEAFI) LINE TOTALS ─────────────── */
  const baseTotals: Record<string, LineTotals> = useMemo(() => {
    const t: Record<string, LineTotals> = {};
    quotes.forEach((q: any) => {
      const hasHomeStored =
        q.homeTotal !== null &&
        q.homeTotal !== undefined &&
        !Number.isNaN(Number(q.homeTotal));
      const hasMoowrStored =
        q.mooWRTotal !== null &&
        q.mooWRTotal !== undefined &&
        !Number.isNaN(Number(q.mooWRTotal));

      // Fallback recompute (only if stored totals absent) — mirror server formula
      const seaInINR = fmt.num(q.seaFreightPerContainer) * usdToInr;

      const recomputeHome =
        seaInINR +
        fmt.num(q.houseDeliveryOrderPerBOL) +
        fmt.num(q.cfsPerContainer) +
        fmt.num(q.transportationPerContainer) +
        fmt.num(q.ediChargesPerBOE) +
        fmt.num(q.chaChargesHome);

      const recomputeMoowr =
        recomputeHome +
        fmt.num(q.mooWRReeWarehousingCharges) +
        fmt.num(q.chaChargesMOOWR);

      t[q.id] = {
        home: hasHomeStored ? fmt.num(q.homeTotal) : recomputeHome,
        moowr: hasMoowrStored ? fmt.num(q.mooWRTotal) : recomputeMoowr,
      };
    });
    return t;
  }, [quotes, usdToInr]);

  /* ─────────────── LOGISTICS (EDITABLE) LINE TOTALS ─────────────── */
  const logisticsTotals: Record<string, LineTotals> = useMemo(() => {
    const t: Record<string, LineTotals> = {};
    quotes.forEach((q: any) => {
      const quoteId = q.id;

      const seaUsd = getQuoteValue(q, quoteId, "seaFreightPerContainer");
      const seaInINR = seaUsd * usdToInr;

      const hdo = getQuoteValue(q, quoteId, "houseDeliveryOrderPerBOL");
      const cfs = getQuoteValue(q, quoteId, "cfsPerContainer");
      const trn = getQuoteValue(q, quoteId, "transportationPerContainer");
      const edi = getQuoteValue(q, quoteId, "ediChargesPerBOE");
      const chaHome = getQuoteValue(q, quoteId, "chaChargesHome");
      const chaMoowr = getQuoteValue(q, quoteId, "chaChargesMOOWR");
      const ware = getQuoteValue(q, quoteId, "mooWRReeWarehousingCharges");

      // Mirror server formula with edited values
      // HOME scheme (explicit — no MOOWR costs)
      const home = seaInINR + hdo + cfs + trn + edi + chaHome;

      // MOOWR scheme (HOME base + MOOWR-only costs)
      const moowr = seaInINR + hdo + cfs + trn + edi + chaMoowr + ware;

      t[quoteId] = { home, moowr };
    });
    return t;
  }, [quotes, usdToInr, priceEdits]);

  /* ───── AUTO (LEAFI) ALLOCATION ONCE ───── */
  useEffect(() => {
    if (!rfq || !quotes.length || Object.keys(autoAlloc).length) return;

    type Slot = { quoteId: string; scheme: "home" | "moowr"; price: number };
    const slots: Slot[] = [];

    quotes.forEach((q: any) => {
      slots.push({
        quoteId: q.id,
        scheme: "home",
        price: baseTotals[q.id]?.home || 0,
      });
      slots.push({
        quoteId: q.id,
        scheme: "moowr",
        price: baseTotals[q.id]?.moowr || 0,
      });
    });

    slots.sort((a, b) => a.price - b.price);

    let remaining = rfq.numberOfContainers;
    const draft: Record<string, AllocDraft> = {};

    for (const { quoteId, scheme } of slots) {
      if (remaining === 0) break;

      const qRef = quotes.find((q: any) => q.id === quoteId);
      const offered = fmt.num(qRef?.numberOfContainers);

      if (!draft[quoteId]) {
        draft[quoteId] = {
          containersAllottedHome: 0,
          containersAllottedMOOWR: 0,
        };
      }

      // ✅ shared vendor capacity across HOME + MOOWR
      const alreadyTaken =
        fmt.num(draft[quoteId].containersAllottedHome) +
        fmt.num(draft[quoteId].containersAllottedMOOWR);

      const remainingCapacityForThisVendor = Math.max(
        0,
        offered - alreadyTaken
      );
      if (remainingCapacityForThisVendor === 0) continue;

      const take = Math.min(remainingCapacityForThisVendor, remaining);
      if (take <= 0) continue;

      if (scheme === "home") draft[quoteId].containersAllottedHome += take;
      else draft[quoteId].containersAllottedMOOWR += take;

      remaining -= take;
    }

    setAutoAlloc(draft);

    // Only seed manual allocations if none existed before
    if (existingTotal === 0) {
      setAlloc(draft);
    }
  }, [rfq, quotes, baseTotals, existingTotal]);

  /* ─────────────── SUMS & PRICES ─────────────── */
  const totalAllocated = useMemo(
    () =>
      Object.values(alloc).reduce(
        (sum, a) => sum + a.containersAllottedHome + a.containersAllottedMOOWR,
        0
      ),
    [alloc]
  );
  const schemeAllocated = useMemo(() => {
    const home = Object.values(alloc).reduce(
      (s, a) => s + fmt.num(a.containersAllottedHome),
      0
    );
    const moowr = Object.values(alloc).reduce(
      (s, a) => s + fmt.num(a.containersAllottedMOOWR),
      0
    );
    return { home, moowr };
  }, [alloc]);

  const schemeLogisticsPrice = useMemo(() => {
    const home = Object.entries(alloc).reduce((sum, [qid, a]) => {
      return (
        sum +
        fmt.num(a.containersAllottedHome) * (logisticsTotals[qid]?.home || 0)
      );
    }, 0);

    const moowr = Object.entries(alloc).reduce((sum, [qid, a]) => {
      return (
        sum +
        fmt.num(a.containersAllottedMOOWR) * (logisticsTotals[qid]?.moowr || 0)
      );
    }, 0);

    return { home, moowr };
  }, [alloc, logisticsTotals]);

  const vendorAutoTotal = useMemo(
    () =>
      Object.values(autoAlloc).reduce(
        (sum, a) => sum + a.containersAllottedHome + a.containersAllottedMOOWR,
        0
      ),
    [autoAlloc]
  );

  const vendorAutoPrice = useMemo(
    () =>
      Object.entries(autoAlloc).reduce(
        (sum, [qid, a]) =>
          sum +
          a.containersAllottedHome * (baseTotals[qid]?.home || 0) +
          a.containersAllottedMOOWR * (baseTotals[qid]?.moowr || 0),
        0
      ),
    [autoAlloc, baseTotals]
  );
  /* ─────────────── LEAFI COMPARABLE (same count as current allocation) ─────────────── */
  const leafiComparable = useMemo(() => {
    if (!rfq || !quotes.length) return { total: 0, price: 0 };

    const target = Math.max(0, fmt.num(totalAllocated || 0));
    if (target === 0) return { total: 0, price: 0 };

    type Slot = { quoteId: string; scheme: "home" | "moowr"; price: number };
    const slots: Slot[] = [];

    for (const q of quotes as any[]) {
      slots.push({
        quoteId: q.id,
        scheme: "home",
        price: baseTotals[q.id]?.home || 0,
      });
      slots.push({
        quoteId: q.id,
        scheme: "moowr",
        price: baseTotals[q.id]?.moowr || 0,
      });
    }

    slots.sort((a, b) => a.price - b.price);

    let remaining = target;
    const draft: Record<string, AllocDraft> = {};

    for (const { quoteId, scheme } of slots) {
      if (remaining === 0) break;

      const qRef = quotes.find((q: any) => q.id === quoteId);
      const offered = fmt.num(qRef?.numberOfContainers);

      if (!draft[quoteId]) {
        draft[quoteId] = {
          containersAllottedHome: 0,
          containersAllottedMOOWR: 0,
        };
      }

      const alreadyTaken =
        fmt.num(draft[quoteId].containersAllottedHome) +
        fmt.num(draft[quoteId].containersAllottedMOOWR);

      const remainingCapacityForThisVendor = Math.max(
        0,
        offered - alreadyTaken
      );
      if (remainingCapacityForThisVendor === 0) continue;

      const take = Math.min(remainingCapacityForThisVendor, remaining);
      if (take <= 0) continue;

      if (scheme === "home") draft[quoteId].containersAllottedHome += take;
      else draft[quoteId].containersAllottedMOOWR += take;

      remaining -= take;
    }

    const total = Object.values(draft).reduce(
      (s, a) => s + a.containersAllottedHome + a.containersAllottedMOOWR,
      0
    );

    const price = Object.entries(draft).reduce((sum, [qid, a]) => {
      return (
        sum +
        a.containersAllottedHome * (baseTotals[qid]?.home || 0) +
        a.containersAllottedMOOWR * (baseTotals[qid]?.moowr || 0)
      );
    }, 0);

    return { total, price };
  }, [rfq, quotes, baseTotals, totalAllocated]);

  const logisticsTotalPrice = useMemo(() => {
    return Object.entries(alloc).reduce((sum, [qid, a]) => {
      return (
        sum +
        a.containersAllottedHome * (logisticsTotals[qid]?.home || 0) +
        a.containersAllottedMOOWR * (logisticsTotals[qid]?.moowr || 0)
      );
    }, 0);
  }, [alloc, logisticsTotals]);

  const leafiRefPrice = useMemo(() => {
    // If fully allocated, compare against full LEAFI recommendation.
    if (rfq && totalAllocated === rfq.numberOfContainers)
      return vendorAutoPrice;
    // Otherwise compare against LEAFI cheapest for the SAME allocated count.
    return leafiComparable.price;
  }, [rfq, totalAllocated, vendorAutoPrice, leafiComparable.price]);

  const priceDeltaVsLeafi = useMemo(
    () => logisticsTotalPrice - leafiRefPrice,
    [logisticsTotalPrice, leafiRefPrice]
  );

  const allocationValid = rfq != null && totalAllocated > 0;

  const computeMaxForRow = (quoteId: string, scheme: Scheme) => {
    if (!rfq) return 0;

    const prev = alloc[quoteId] || {
      containersAllottedHome: 0,
      containersAllottedMOOWR: 0,
    };

    const offered =
      fmt.num(quotes.find((q: any) => q.id === quoteId)?.numberOfContainers) ||
      0;

    const otherSchemeVal =
      scheme === "home"
        ? fmt.num(prev.containersAllottedMOOWR)
        : fmt.num(prev.containersAllottedHome);

    // total allocated in OTHER rows (exclude this row total)
    const currentRowTotal =
      fmt.num(prev.containersAllottedHome) +
      fmt.num(prev.containersAllottedMOOWR);
    const others = totalAllocated - currentRowTotal;

    // cap by RFQ remaining given other rows + the other scheme in this row
    const maxByRFQ = Math.max(
      0,
      rfq.numberOfContainers - others - otherSchemeVal
    );

    // cap by vendor offer (shared across HOME+MOOWR)
    const maxByOffer = Math.max(0, offered - otherSchemeVal);

    // keep >= already-saved minimum for this scheme (so max never < min)
    const existingVal =
      existingMap[quoteId]?.[
        scheme === "home" ? "containersAllottedHome" : "containersAllottedMOOWR"
      ] || 0;

    return Math.max(existingVal, Math.min(maxByRFQ, maxByOffer));
  };

  const changeAlloc = (
    quoteId: string,
    scheme: "home" | "moowr",
    raw: number
  ) => {
    if (!rfq) return;

    const prevAllocated = alloc[quoteId] || {
      containersAllottedHome: 0,
      containersAllottedMOOWR: 0,
    };
    const existingValue =
      existingMap[quoteId]?.[
        scheme === "home" ? "containersAllottedHome" : "containersAllottedMOOWR"
      ] || 0;

    const maxForRow = computeMaxForRow(quoteId, scheme);

    const clamped = Math.min(Math.max(0, raw), maxForRow);
    const newValue = Math.max(existingValue, clamped);

    setAlloc((cur) => ({
      ...cur,
      [quoteId]: {
        ...prevAllocated,
        [scheme === "home"
          ? "containersAllottedHome"
          : "containersAllottedMOOWR"]: newValue,
      },
    }));
  };

  const changePrice = (quoteId: string, field: PriceField, raw: number) => {
    const val = Math.max(0, fmt.num(raw));
    setPriceEdits((cur) => ({
      ...cur,
      [quoteId]: {
        ...(cur[quoteId] || {}),
        [field]: val,
      },
    }));
  };

  const storeFinalisation = async () => {
    if (requiresDeviationReason && !deviationReason.trim()) {
      toast.error(
        "Please provide a reason for deviation from LEAFI allocation."
      );
      return;
    }

    if (!rfq) return;

    for (const [qid, a] of Object.entries(alloc)) {
      const existed = existingMap[qid] || {
        containersAllottedHome: 0,
        containersAllottedMOOWR: 0,
      };
      const deltaHome =
        a.containersAllottedHome - existed.containersAllottedHome;
      const deltaMoowr =
        a.containersAllottedMOOWR - existed.containersAllottedMOOWR;
      if (deltaHome <= 0 && deltaMoowr <= 0) continue;

      const q = quotes.find((x: any) => x.id === qid);
      if (!q) continue;

      await finalizeRFQ(rfq.id, {
        rfqId: rfq.id,
        quoteId: qid,
        vendorName: q.vendorName,
        containersAllottedHome: deltaHome,
        containersAllottedMOOWR: deltaMoowr,
        reason: deviationReason || undefined,
      });
    }

    if (totalAllocated < rfq.numberOfContainers) {
      toast.success(
        `Saved partial allocation (${totalAllocated}/${rfq.numberOfContainers}).`
      );
      return;
    }

    navigate("/app");
  };

  const isAllocEqualToAuto = useMemo(() => {
    const allQuoteIds = new Set<string>([
      ...Object.keys(autoAlloc || {}),
      ...Object.keys(alloc || {}),
    ]);

    for (const qid of allQuoteIds) {
      const a = autoAlloc[qid] || {
        containersAllottedHome: 0,
        containersAllottedMOOWR: 0,
      };
      const b = alloc[qid] || {
        containersAllottedHome: 0,
        containersAllottedMOOWR: 0,
      };

      if (
        fmt.num(a.containersAllottedHome) !== fmt.num(b.containersAllottedHome)
      )
        return false;
      if (
        fmt.num(a.containersAllottedMOOWR) !==
        fmt.num(b.containersAllottedMOOWR)
      )
        return false;
    }
    return true;
  }, [autoAlloc, alloc]);

  const requiresDeviationReason = useMemo(() => {
    if (!rfq) return false;

    return (
      !isAllocEqualToAuto || // allocation differs from LEAFI
      hasAnyPriceEdits || // logistics edited pricing
      Math.abs(priceDeltaVsLeafi) > 0 // total price differs
    );
  }, [rfq, isAllocEqualToAuto, hasAnyPriceEdits, priceDeltaVsLeafi]);

  const onFinalizeClick = () => {
    if (!rfq) return;

    // If deviation exists → force reason modal
    if (requiresDeviationReason) {
      setReasonModal(true);
      return;
    }

    // Otherwise proceed directly
    storeFinalisation();
    setDeviationReason("");
    setReasonModal(false);
  };

  if (!rfq) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">RFQ not found</h2>
        <Button onClick={() => navigate("/app")}>Return to Dashboard</Button>
      </div>
    );
  }
  if (!quotes.length) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">
          No quotes submitted for this RFQ yet
        </h2>
        <Button onClick={() => navigate("/app")}>Back</Button>
      </div>
    );
  }

  const rfqInfoGrid = (
    <Card>
      <CardHeader>
        <CardTitle>RFQ Details</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 text-sm">
        <div>
          <div className="text-muted-foreground">RFQ Number</div>
          <div className="font-medium">{rfq.rfqNumber}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Status</div>
          <div className="font-medium">{fmt.plain(rfq.status)}</div>
        </div>
        <div className="md:col-span-2">
          <div className="text-muted-foreground">Item</div>
          <div className="font-medium">{fmt.plain(rfq.itemDescription)}</div>
        </div>
        <div className="md:col-span-2">
          <div className="text-muted-foreground">Company</div>
          <div className="font-medium whitespace-pre-wrap">
            {fmt.plain(rfq.companyName)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Supplier</div>
          <div className="font-medium">{fmt.plain(rfq.supplierName)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">PO Number</div>
          <div className="font-medium">{fmt.plain(rfq.materialPONumber)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Loading Port</div>
          <div className="font-medium">{fmt.plain(rfq.portOfLoading)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Destination Port</div>
          <div className="font-medium">{fmt.plain(rfq.portOfDestination)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Container Type</div>
          <div className="font-medium">{fmt.plain(rfq.containerType)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Req. Containers</div>
          <div className="font-medium">{fmt.plain(rfq.numberOfContainers)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Weight (tons)</div>
          <div className="font-medium">{fmt.plain(rfq.cargoWeight)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Readiness Date</div>
          <div className="font-medium">{fmt.date(rfq.cargoReadinessDate)}</div>
        </div>

        <div className="md:col-span-2">
          <div className="text-muted-foreground">Description</div>
          <div className="font-medium whitespace-pre-wrap">
            {fmt.plain(rfq.description)}
          </div>
        </div>
        <div className="md:col-span-2 text-xs text-muted-foreground">
          USD→INR used for Sea Freight INR (and logistics price edits):{" "}
          <span className="font-semibold">{usdToInr.toFixed(4)}</span>
        </div>
      </CardContent>
    </Card>
  );

  const renderTableBody = (mode: TableMode, scheme: Scheme) => {
    const isLogisticsOnly = mode === "logistics";
    const isCombined = mode === "combined";

    // For old modes: state is either alloc (logistics) or autoAlloc (leafi)
    const state = isLogisticsOnly ? alloc : autoAlloc;

    type RowDef = {
      key: string;
      label?: string;
      kind?: "section";
      render?: (q: any) => React.ReactNode;
    };

    const fieldThCls =
      "text-left font-semibold p-2 border-b min-w-[200px] sticky left-0 bg-background z-20";

    const vendorThCls = "text-left font-semibold p-2 border-b min-w-[180px]";

    const fieldTdCls =
      "p-2 align-top text-muted-foreground font-medium whitespace-nowrap sticky left-0 bg-background z-10";

    const vendorTdCls = "p-2 align-top";
    const standoutFieldTdCls =
      "p-2 align-top font-semibold text-foreground whitespace-nowrap sticky left-0 bg-background z-10 border-l-4 border-primary";

    const standoutVendorTdCls = "p-2 align-top bg-primary/5";

    // ----------------------------
    // Combined: Quote-fields rows + Logistics editable rows (same vendor columns)
    // ----------------------------
    if (isCombined) {
      const rowsTop: RowDef[] = [
        // ---------------- Quote fields ----------------
        {
          key: "quotedContainers",
          label: "Quoted Containers",
          render: (q) => fmt.plain(q.numberOfContainers),
        },
        {
          key: "td",
          label: "T/D",
          render: (q) => fmt.plain(q.transshipOrDirect),
        },
        {
          key: "shippingLine",
          label: "Shipping Line",
          render: (q) => fmt.plain(q.shippingLineName),
        },
        {
          key: "vessel",
          label: "Vessel",
          render: (q) => fmt.plain(q.vesselName),
        },
        { key: "etd", label: "ETD", render: (q) => fmt.date(q.vesselETD) },
        { key: "eta", label: "ETA", render: (q) => fmt.date(q.vesselETA) },

        {
          key: "seaUsd_vendor",
          label: "Sea Freight/Container (USD)",
          render: (q) => (
            <span className="font-medium">
              {fmt.num(q.seaFreightPerContainer).toFixed(2)}
            </span>
          ),
        },
        {
          key: "seaInr_vendor",
          label: "Sea Freight/Container (INR)",
          render: (q) =>
            fmt.money(fmt.num(q.seaFreightPerContainer) * usdToInr),
        },
        {
          key: "hdo_vendor",
          label: "HDO per BOL (INR)",
          render: (q) => fmt.money(q.houseDeliveryOrderPerBOL),
        },
        {
          key: "cfs_vendor",
          label: "CFS/Container (INR)",
          render: (q) => fmt.money(q.cfsPerContainer),
        },
        {
          key: "trn_vendor",
          label: "Transport/Container (INR)",
          render: (q) => fmt.money(q.transportationPerContainer),
        },
        {
          key: "edi_vendor",
          label: "EDI per BOE (INR)",
          render: (q) => fmt.money(q.ediChargesPerBOE),
        },
        {
          key: "chaHome_vendor",
          label: "CHA Home (INR)",
          render: (q) => fmt.money(q.chaChargesHome),
        },
        {
          key: "chaMoowr_vendor",
          label: "CHA MOOWR (INR)",
          render: (q) => fmt.money(q.chaChargesMOOWR),
        },
        {
          key: "ware_vendor",
          label: "MOOWR Re-warehousing/BOE (INR)",
          render: (q) => fmt.money(q.mooWRReeWarehousingCharges),
        },

        {
          key: "validity",
          label: "Quote Validity",
          render: (q) => fmt.date(q.quoteValidityDate),
        },
        {
          key: "message",
          label: "Message",
          render: (q) => (
            <div className="min-w-[220px] whitespace-pre-wrap">
              {fmt.plain(q.message)}
            </div>
          ),
        },
        {
          key: "createdAt",
          label: "Quote Created",
          render: (q) => fmt.datetime(q.createdAt),
        },

        // ---------------- LEAFI (read-only) ----------------
        {
          key: "allotted_leafi",
          label: `Allotted (${scheme.toUpperCase()}) - LEAFI`,
          render: (q) => {
            const v =
              autoAlloc[q.id]?.[
                scheme === "home"
                  ? "containersAllottedHome"
                  : "containersAllottedMOOWR"
              ] || 0;
            return <span className="font-medium">{v}</span>;
          },
        },
        {
          key: "lineTotal_leafi",
          label: `Line Total (${scheme.toUpperCase()}) - LEAFI`,
          render: (q) => {
            const lineTotal =
              scheme === "home"
                ? baseTotals[q.id]?.home || 0
                : baseTotals[q.id]?.moowr || 0;
            return fmt.money(lineTotal);
          },
        },
        {
          key: "allottedCost_leafi",
          label: `Allotted Cost (${scheme.toUpperCase()}) - LEAFI`,
          render: (q) => {
            const a =
              autoAlloc[q.id]?.[
                scheme === "home"
                  ? "containersAllottedHome"
                  : "containersAllottedMOOWR"
              ] || 0;
            const lt =
              scheme === "home"
                ? baseTotals[q.id]?.home || 0
                : baseTotals[q.id]?.moowr || 0;
            return <span className="font-semibold">{fmt.money(a * lt)}</span>;
          },
        },
      ];

      const isHome = scheme === "home";
      const isMoowr = scheme === "moowr";

      const rowsLog: RowDef[] = [
        // ---------------- Logistics finalisation (editable) ----------------
        {
          key: "allotted_log",
          label: `Allotted (${scheme.toUpperCase()}) - Logistics`,
          render: (q) => {
            const thisAllotted =
              alloc[q.id]?.[
                scheme === "home"
                  ? "containersAllottedHome"
                  : "containersAllottedMOOWR"
              ] || 0;

            const existingVal =
              existingMap[q.id]?.[
                scheme === "home"
                  ? "containersAllottedHome"
                  : "containersAllottedMOOWR"
              ] || 0;

            const rowMax = computeMaxForRow(q.id, scheme);

            return (
              <div className="flex flex-col gap-1">
                <Input
                  type="number"
                  min={existingVal}
                  max={rowMax}
                  value={thisAllotted}
                  onChange={(e) =>
                    changeAlloc(
                      q.id,
                      scheme,
                      parseInt(e.currentTarget.value, 10) || 0
                    )
                  }
                  className="w-28 h-10 text-base font-semibold border-2 border-primary focus-visible:ring-2 focus-visible:ring-primary"
                />

                {existingVal > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    Saved:{" "}
                    <span className="font-semibold text-foreground">
                      {existingVal}
                    </span>
                  </div>
                )}
              </div>
            );
          },
        },

        {
          key: "seaUsd_log",
          label: "Sea Freight/Container (USD) - Logistics",
          render: (q) => {
            const v = getQuoteValue(q, q.id, "seaFreightPerContainer");
            return (
              <Input
                type="number"
                step="0.01"
                min={0}
                value={v}
                onChange={(e) =>
                  changePrice(
                    q.id,
                    "seaFreightPerContainer",
                    parseFloat(e.currentTarget.value) || 0
                  )
                }
                className="w-24"
              />
            );
          },
        },
        {
          key: "hdo_log",
          label: "HDO per BOL (INR) - Logistics",
          render: (q) => {
            const v = getQuoteValue(q, q.id, "houseDeliveryOrderPerBOL");
            return (
              <Input
                type="number"
                step="0.01"
                min={0}
                value={v}
                onChange={(e) =>
                  changePrice(
                    q.id,
                    "houseDeliveryOrderPerBOL",
                    parseFloat(e.currentTarget.value) || 0
                  )
                }
                className="w-24"
              />
            );
          },
        },
        {
          key: "cfs_log",
          label: "CFS/Container (INR) - Logistics",
          render: (q) => {
            const v = getQuoteValue(q, q.id, "cfsPerContainer");
            return (
              <Input
                type="number"
                step="0.01"
                min={0}
                value={v}
                onChange={(e) =>
                  changePrice(
                    q.id,
                    "cfsPerContainer",
                    parseFloat(e.currentTarget.value) || 0
                  )
                }
                className="w-24"
              />
            );
          },
        },
        {
          key: "trn_log",
          label: "Transport/Container (INR) - Logistics",
          render: (q) => {
            const v = getQuoteValue(q, q.id, "transportationPerContainer");
            return (
              <Input
                type="number"
                step="0.01"
                min={0}
                value={v}
                onChange={(e) =>
                  changePrice(
                    q.id,
                    "transportationPerContainer",
                    parseFloat(e.currentTarget.value) || 0
                  )
                }
                className="w-24"
              />
            );
          },
        },
        {
          key: "edi_log",
          label: "EDI per BOE (INR) - Logistics",
          render: (q) => {
            const v = getQuoteValue(q, q.id, "ediChargesPerBOE");
            return (
              <Input
                type="number"
                step="0.01"
                min={0}
                value={v}
                onChange={(e) =>
                  changePrice(
                    q.id,
                    "ediChargesPerBOE",
                    parseFloat(e.currentTarget.value) || 0
                  )
                }
                className="w-24"
              />
            );
          },
        },
        isHome && {
          key: "chaHome_log",
          label: "CHA Home (INR) - Logistics",
          render: (q) => {
            const v = getQuoteValue(q, q.id, "chaChargesHome");
            return (
              <Input
                type="number"
                step="0.01"
                min={0}
                value={v}
                onChange={(e) =>
                  changePrice(
                    q.id,
                    "chaChargesHome",
                    parseFloat(e.currentTarget.value) || 0
                  )
                }
                className="w-24"
              />
            );
          },
        },

        isMoowr && {
          key: "chaMoowr_log",
          label: "CHA MOOWR (INR) - Logistics",
          render: (q) => {
            const v = getQuoteValue(q, q.id, "chaChargesMOOWR");
            return (
              <Input
                type="number"
                step="0.01"
                min={0}
                value={v}
                onChange={(e) =>
                  changePrice(
                    q.id,
                    "chaChargesMOOWR",
                    parseFloat(e.currentTarget.value) || 0
                  )
                }
                className="w-24"
              />
            );
          },
        },

        isMoowr && {
          key: "ware_log",
          label: "MOOWR Re-warehousing/BOE (INR) - Logistics",
          render: (q) => {
            const v = getQuoteValue(q, q.id, "mooWRReeWarehousingCharges");
            return (
              <Input
                type="number"
                step="0.01"
                min={0}
                value={v}
                onChange={(e) =>
                  changePrice(
                    q.id,
                    "mooWRReeWarehousingCharges",
                    parseFloat(e.currentTarget.value) || 0
                  )
                }
                className="w-28"
              />
            );
          },
        },

        {
          key: "lineTotal_log",
          label: `Line Total (${scheme.toUpperCase()}) - Logistics`,
          render: (q) => {
            const lt =
              scheme === "home"
                ? logisticsTotals[q.id]?.home || 0
                : logisticsTotals[q.id]?.moowr || 0;
            return fmt.money(lt);
          },
        },
        {
          key: "allottedCost_log",
          label: `Allotted Cost (${scheme.toUpperCase()}) - Logistics`,
          render: (q) => {
            const a =
              alloc[q.id]?.[
                scheme === "home"
                  ? "containersAllottedHome"
                  : "containersAllottedMOOWR"
              ] || 0;
            const lt =
              scheme === "home"
                ? logisticsTotals[q.id]?.home || 0
                : logisticsTotals[q.id]?.moowr || 0;
            return <span className="font-semibold">{fmt.money(a * lt)}</span>;
          },
        },
      ].filter((r): r is RowDef => Boolean(r));

      const renderMatrix = (rowsToRender: RowDef[], headerLabel?: string) => (
        <div className="w-full">
          {headerLabel && (
            <div className="px-3 pb-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {headerLabel}
              </div>
            </div>
          )}

          <table className="w-max min-w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-background z-30">
              <tr>
                <th className={fieldThCls}>Field</th>
                {quotes.map((q: any) => (
                  <th
                    key={q.id}
                    className={vendorThCls}
                    title={fmt.plain(q.vendorName)}
                  >
                    <div className="font-semibold truncate max-w-[160px]">
                      {fmt.plain(q.vendorName)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Offered:{" "}
                      <span className="font-medium">
                        {fmt.plain(q.numberOfContainers)}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rowsToRender.map((r) => {
                const isAllottedLog = r.key === "allotted_log";
                return (
                  <tr
                    key={r.key}
                    className={`border-b last:border-b-0 ${
                      isAllottedLog ? "bg-primary/5" : ""
                    }`}
                  >
                    <td
                      className={
                        isAllottedLog ? standoutFieldTdCls : fieldTdCls
                      }
                    >
                      {r.label}
                      {isAllottedLog && (
                        <div className="text-[11px] font-normal text-muted-foreground">
                          Priority field
                        </div>
                      )}
                    </td>
                    {quotes.map((q: any) => (
                      <td
                        key={`${r.key}-${q.id}`}
                        className={
                          isAllottedLog ? standoutVendorTdCls : vendorTdCls
                        }
                      >
                        {r.render?.(q)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );

      return (
        <div className="w-full space-y-4">
          {/* Bottom: Logistics highlighted container */}
          <div className="rounded-xl border-2 bg-muted/20">
            <div className="px-4 pt-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">
                    Logistics finalisation (editable)
                  </div>
                  <Badge variant="default" className="shrink-0">
                    Editable
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  Update allocation + cost fields below. Totals update
                  instantly.
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  {hasAnyPriceEdits && (
                    <Badge variant="default" className="shrink-0">
                      Price edited
                    </Badge>
                  )}
                  <Badge variant="secondary" className="shrink-0">
                    {scheme.toUpperCase()} Alloc:{" "}
                    <span className="ml-1 font-semibold">
                      {schemeAllocated[scheme]}
                    </span>
                  </Badge>
                </div>

                <div className="text-xs text-muted-foreground text-right">
                  Scheme cost:{" "}
                  <span className="font-semibold">
                    {fmt.money(schemeLogisticsPrice[scheme])}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 pt-3">
              <div className="rounded-lg border bg-background">
                <div className="p-4">{renderMatrix(rowsLog)}</div>
              </div>
            </div>
          </div>

          {/* Top: Vendor submission + LEAFI (collapsible; collapsed by default) */}
          <div className="rounded-lg border bg-background">
            <div className="px-4 pt-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  Vendor submission + LEAFI recommendation
                </div>
                <div className="text-xs text-muted-foreground">
                  Vendor inputs are read-only here; LEAFI allocation/cost shown
                  for comparison.
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0"
                onClick={() => {
                  setVendorLeafiOpen((s) => !s);
                }}
                aria-expanded={vendorLeafiOpen}
              >
                <ChevronDown
                  className={`h-4 w-4 mr-2 transition-transform ${
                    vendorLeafiOpen ? "rotate-180" : ""
                  }`}
                />
                {vendorLeafiOpen ? "Hide" : "Show"}
              </Button>
            </div>

            {vendorLeafiOpen ? (
              <div className="p-4">{renderMatrix(rowsTop)}</div>
            ) : (
              <div className="px-4 pb-4 pt-3 text-xs text-muted-foreground">
                Collapsed (click <span className="font-medium">Show</span> to
                view vendor fields + LEAFI recommendation).
              </div>
            )}
          </div>
        </div>
      );
    }

    // ----------------------------
    // Existing behavior for non-combined (your current matrix, unchanged)
    // ----------------------------
    const rows: RowDef[] = [
      {
        key: "quotedContainers",
        label: "Quoted Containers",
        render: (q) => fmt.plain(q.numberOfContainers),
      },
      {
        key: "allotted",
        label: `Allotted (${scheme.toUpperCase()})`,
        render: (q) => {
          const thisAllotted =
            state[q.id]?.[
              scheme === "home"
                ? "containersAllottedHome"
                : "containersAllottedMOOWR"
            ] || 0;

          const existingVal =
            existingMap[q.id]?.[
              scheme === "home"
                ? "containersAllottedHome"
                : "containersAllottedMOOWR"
            ] || 0;

          const rowMax = computeMaxForRow(q.id, scheme);

          if (!isLogisticsOnly)
            return <span className="font-medium">{thisAllotted}</span>;

          return (
            <div className="flex flex-col gap-1">
              <Input
                type="number"
                min={existingVal}
                max={rowMax}
                value={thisAllotted}
                onChange={(e) =>
                  changeAlloc(
                    q.id,
                    scheme,
                    parseInt(e.currentTarget.value, 10) || 0
                  )
                }
                className="w-28"
              />
              {existingVal > 0 && (
                <div className="text-[11px] text-muted-foreground">
                  Saved: <span className="font-medium">{existingVal}</span>
                </div>
              )}
            </div>
          );
        },
      },
    ];

    return (
      <div className="w-full">
        <table className="w-max min-w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-background z-10">
            <tr>
              <th className="text-left font-semibold p-3 border-b min-w-[260px]">
                Field
              </th>
              {quotes.map((q: any) => (
                <th
                  key={q.id}
                  className="text-left font-semibold p-3 border-b min-w-[260px]"
                  title={fmt.plain(q.vendorName)}
                >
                  <div className="font-semibold truncate max-w-[160px]">
                    {fmt.plain(q.vendorName)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Offered:{" "}
                    <span className="font-medium">
                      {fmt.plain(q.numberOfContainers)}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b last:border-b-0">
                <td className="p-3 align-top text-muted-foreground font-medium whitespace-nowrap">
                  {r.label}
                </td>
                {quotes.map((q: any) => (
                  <td key={`${r.key}-${q.id}`} className="p-3 align-top">
                    {r.render?.(q)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderTable = (title: string, mode: TableMode, scheme: Scheme) => {
    const isLogistics = mode === "logistics";
    return (
      <Card key={`${mode}-${title}-${scheme}`} className="w-full max-w-full">
        <CardHeader className="space-y-1">
          <div className="flex items-start sm:items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 min-w-0">
              {title}{" "}
              <Badge variant={isLogistics ? "default" : "secondary"}>
                {isLogistics ? "Logistics" : "LEAFI"}
              </Badge>
            </CardTitle>

            <div className="flex items-center gap-2 shrink-0">
              <div className="text-xs text-muted-foreground">
                Scheme:{" "}
                <span className="font-semibold">{scheme.toUpperCase()}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => {
                  openFullscreen(title, mode, scheme);
                }}
                title="Open table in full screen"
              >
                <Maximize2 className="h-4 w-4 mr-2" />
                Full screen
              </Button>
            </div>
          </div>

          {isLogistics ? (
            <div className="text-xs text-muted-foreground">
              LEAFI recommendation (read-only).
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              You can edit both allocation and pricing fields below. Totals
              update instantly.
            </div>
          )}
        </CardHeader>

        {/* Keep all horizontal scroll INSIDE table area */}
        <CardContent className="max-w-full min-w-0 p-0 grid">
          {/* single scroll container owns BOTH X + Y, like fullscreen */}
          <div
            className="w-full overflow-auto"
            style={{
              maxHeight: "min(70vh, 720px)",
              WebkitOverflowScrolling: "touch",
              scrollbarGutter: "stable" as any,
            }}
          >
            <div className="p-4">{renderTableBody(mode, scheme)}</div>
          </div>
        </CardContent>
      </Card>
    );
  };

  // Full-width breakout wrapper: ensures this page uses full viewport width even inside a centered Layout container.
  // Also prevents page-level horizontal scroll; tables handle their own scroll.

  return (
    <div className="space-y-6 max-w-full overflow-x-hidden">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Finalize RFQ #{rfq.rfqNumber}</h1>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/app")}>
            Back
          </Button>
        </div>
      </div>

      {rfqInfoGrid}

      {/* Vendor Quote Summary (one row per vendor) */}
      <Card className="w-full max-w-full">
        <CardHeader className="space-y-1">
          <CardTitle>Vendor Quote Summary</CardTitle>
          <div className="text-xs text-muted-foreground">
            Quick comparison of key non-price fields across vendor submissions.
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div
            className="w-full overflow-auto"
            style={{
              maxHeight: "min(50vh, 520px)",
              WebkitOverflowScrolling: "touch",
              scrollbarGutter: "stable" as any,
            }}
          >
            <div className="min-w-[1200px] p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[160px]">Vendor</TableHead>
                    <TableHead className="min-w-[160px]">
                      Number of Containers
                    </TableHead>
                    <TableHead className="min-w-[180px]">
                      Shipping Line Name
                    </TableHead>
                    <TableHead className="min-w-[140px]">
                      Container Type
                    </TableHead>
                    <TableHead className="min-w-[180px]">Vessel Name</TableHead>
                    <TableHead className="min-w-[140px]">Vessel ETD</TableHead>
                    <TableHead className="min-w-[140px]">Vessel ETA</TableHead>
                    <TableHead className="min-w-[160px]">
                      Transship or Direct
                    </TableHead>
                    <TableHead className="min-w-[160px]">
                      Quote Validity Date
                    </TableHead>
                    <TableHead className="min-w-[320px]">
                      Message (Optional)
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {quotes.map((q: any) => (
                    <TableRow key={q.id}>
                      <TableCell className="font-semibold">
                        {fmt.plain(q.vendorName)}
                      </TableCell>
                      <TableCell>{fmt.plain(q.numberOfContainers)}</TableCell>
                      <TableCell>{fmt.plain(q.shippingLineName)}</TableCell>
                      <TableCell>{fmt.plain(q.containerType)}</TableCell>
                      <TableCell>{fmt.plain(q.vesselName)}</TableCell>
                      <TableCell>{fmt.date(q.vesselETD)}</TableCell>
                      <TableCell>{fmt.date(q.vesselETA)}</TableCell>
                      <TableCell>{fmt.plain(q.transshipOrDirect)}</TableCell>
                      <TableCell>{fmt.date(q.quoteValidityDate)}</TableCell>
                      <TableCell className="whitespace-pre-wrap">
                        {fmt.plain(q.message)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vendor (LEAFI) Allocation */}
      {/* Allocation (2 tables only) */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Allocation Comparison</h2>
        <Badge
          variant={hasAnyPriceEdits ? "default" : "secondary"}
          className="font-semibold"
        >
          LEAFI + Logistics {hasAnyPriceEdits ? "(price edited)" : ""}
        </Badge>
      </div>

      <div className="grid gap-6">
        {renderTable("CHA-HOME (All Vendors)", "combined", "home")}
        {renderTable("CHA-MOOWR (All Vendors)", "combined", "moowr")}
      </div>

      {/* one below the other (no side-by-side) 
      <Card className="w-full max-w-full">
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            Vendor Allocation (LEAFI)
            <Badge variant="secondary">HOME + MOOWR</Badge>
          </CardTitle>
          <div className="text-xs text-muted-foreground">
            Two views under one section for easier comparison.
          </div>
        </CardHeader>

        <CardContent className="grid gap-6">
          {renderTable("Vendor CHA-HOME", "leafi", "home")}
          {renderTable("Vendor CHA-MOOWR", "leafi", "moowr")}
        </CardContent>
      </Card>

      <Card className="w-full max-w-full">
        <CardContent className="pt-6">
          <div className="flex flex-col gap-1 text-right">
            <div className="font-bold">
              LEAFI total vehicles:{" "}
              {rfq && totalAllocated === rfq.numberOfContainers
                ? vendorAutoTotal
                : leafiComparable.total}
            </div>
            <div className="font-bold">
              LEAFI total price:{" "}
              {rfq && totalAllocated === rfq.numberOfContainers
                ? fmt.money(vendorAutoPrice)
                : fmt.money(leafiComparable.price)}
            </div>

            {rfq && totalAllocated !== rfq.numberOfContainers && (
              <div className="text-xs text-muted-foreground">
                (Comparable for current allocation: {totalAllocated} containers)
              </div>
            )}
          </div>
        </CardContent>
      </Card>*/}

      <Card className="w-full max-w-full">
        <CardContent className="pt-6">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded border p-3">
              <div className="text-xs text-muted-foreground">
                Logistics total vehicles
              </div>
              <div className="text-lg font-bold">{totalAllocated}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-muted-foreground">
                Logistics total price
              </div>
              <div className="text-lg font-bold">
                {fmt.money(logisticsTotalPrice)}
              </div>
              <div className="text-xs text-muted-foreground">
                Uses USD→INR:{" "}
                <span className="font-semibold">{usdToInr.toFixed(4)}</span>
              </div>
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-muted-foreground">
                Δ vs LEAFI total price
              </div>
              <div className="text-lg font-bold">
                {fmt.diffMoney(priceDeltaVsLeafi)}
              </div>
              <div className="text-xs text-muted-foreground">
                (Logistics − LEAFI
                {rfq && totalAllocated !== rfq.numberOfContainers
                  ? " (comparable)"
                  : ""}
                )
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Finalize/Save Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between p-4 border rounded bg-muted/20 w-full max-w-full">
        <div className="text-lg font-bold">
          Allocated: {totalAllocated} / {rfq.numberOfContainers}
        </div>
        <Button
          disabled={!allocationValid || rfq.status === "closed"}
          onClick={onFinalizeClick}
        >
          {rfq.status === "closed"
            ? "Already Finalized"
            : totalAllocated === rfq.numberOfContainers
            ? "Finalize Allocation"
            : "Save Allocation"}
        </Button>
      </div>

      {/* Fullscreen Table Dialog */}
      <Dialog
        open={tableFs.open}
        onOpenChange={(open) => setTableFs((s) => ({ ...s, open }))}
      >
        <DialogContent className="max-w-[98vw] w-[98vw] h-[92vh] p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
            <div className="flex flex-col">
              <div className="text-base font-semibold">{tableFs.title}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Badge
                  variant={
                    tableFs.mode === "logistics" ? "default" : "secondary"
                  }
                >
                  {tableFs.mode === "logistics" ? "Logistics" : "LEAFI"}
                </Badge>
                <span>
                  Scheme:{" "}
                  <span className="font-semibold">
                    {tableFs.scheme.toUpperCase()}
                  </span>
                </span>
                <span className="hidden md:inline">
                  (Scroll inside table; page stays fixed)
                </span>
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTableFs((s) => ({ ...s, open: false }))}
              title="Close"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Both horizontal and vertical scrolling inside */}
          <div className="h-[calc(92vh-56px)] overflow-auto p-4">
            <div className="rounded border bg-background">
              <div className="p-3 border-b text-xs text-muted-foreground">
                {tableFs.mode === "logistics"
                  ? "Editable: allocation + price fields"
                  : "Read-only: LEAFI recommendation"}
              </div>
              <div className="p-3">
                {renderTableBody(tableFs.mode, tableFs.scheme)}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deviation Modal */}
      <Dialog open={reasonModal} onOpenChange={setReasonModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reason for Deviation</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              A reason is required when the final decision differs from LEAFI’s
              recommendation and/or when pricing is edited.
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">LEAFI total</div>
                {rfq && totalAllocated !== rfq.numberOfContainers && (
                  <div className="text-[11px] text-muted-foreground">
                    Comparable for {totalAllocated} containers
                  </div>
                )}

                <div className="font-semibold">
                  {fmt.money(vendorAutoPrice)}
                </div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">
                  Logistics total
                </div>
                <div className="font-semibold">
                  {fmt.money(logisticsTotalPrice)}
                </div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">Difference</div>
                <div className="font-semibold">
                  {fmt.diffMoney(priceDeltaVsLeafi)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  USD→INR used: {usdToInr.toFixed(4)}
                </div>
              </div>
            </div>

            <Label htmlFor="reason" className="block">
              Please explain the deviation:
            </Label>
            <Textarea
              id="reason"
              rows={4}
              value={deviationReason}
              onChange={(e) => setDeviationReason(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setReasonModal(false)}>
              Cancel
            </Button>
            <Button
              disabled={!deviationReason.trim()}
              onClick={storeFinalisation}
            >
              Submit
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FinalizeRFQ;
