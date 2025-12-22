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
import { Badge } from "@/components/ui/badge";
import { Maximize2, X } from "lucide-react";

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

type TableMode = "leafi" | "logistics";
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
    fetch(`${API_BASE_URL}/rate/usdinr`)
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
      const home = seaInINR + hdo + cfs + trn + edi + chaHome;
      const moowr = home + ware + chaMoowr;

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
      const offered = quotes.find(
        (q: any) => q.id === quoteId
      )!.numberOfContainers;
      const take = Math.min(offered, remaining);
      if (!draft[quoteId]) {
        draft[quoteId] = {
          containersAllottedHome: 0,
          containersAllottedMOOWR: 0,
        };
      }
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

  const logisticsTotalPrice = useMemo(() => {
    return Object.entries(alloc).reduce((sum, [qid, a]) => {
      return (
        sum +
        a.containersAllottedHome * (logisticsTotals[qid]?.home || 0) +
        a.containersAllottedMOOWR * (logisticsTotals[qid]?.moowr || 0)
      );
    }, 0);
  }, [alloc, logisticsTotals]);

  const priceDeltaVsLeafi = useMemo(
    () => logisticsTotalPrice - vendorAutoPrice,
    [logisticsTotalPrice, vendorAutoPrice]
  );

  const allocationValid = rfq != null && totalAllocated > 0;

  const computeMaxForRow = (quoteId: string) => {
    if (!rfq) return 0;
    const prev = alloc[quoteId] || {
      containersAllottedHome: 0,
      containersAllottedMOOWR: 0,
    };
    const others =
      totalAllocated -
      (prev.containersAllottedHome + prev.containersAllottedMOOWR);
    return Math.max(0, rfq.numberOfContainers - others);
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

    const maxForRow = computeMaxForRow(quoteId);
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

    navigate("/dashboard");
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

  const onFinalizeClick = () => {
    if (!rfq) return;

    const full = totalAllocated === rfq.numberOfContainers;
    const deviatesAlloc = !isAllocEqualToAuto;
    const deviatesPrice = hasAnyPriceEdits;

    if (full && (deviatesAlloc || deviatesPrice)) {
      setReasonModal(true);
      return;
    }

    storeFinalisation();
  };

  if (!rfq) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">RFQ not found</h2>
        <Button onClick={() => navigate("/dashboard")}>
          Return to Dashboard
        </Button>
      </div>
    );
  }
  if (!quotes.length) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">
          No quotes submitted for this RFQ yet
        </h2>
        <Button onClick={() => navigate("/dashboard")}>Back</Button>
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
        <div>
          <div className="text-muted-foreground">Quote End</div>
          <div className="font-medium">{fmt.date(rfq.initialQuoteEndTime)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Eval End</div>
          <div className="font-medium">{fmt.date(rfq.evaluationEndTime)}</div>
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
    const isLogistics = mode === "logistics";
    const state = isLogistics ? alloc : autoAlloc;

    return (
      <div className="grid gap-4">
        {quotes.map((q: any) => {
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

          const rowMax = computeMaxForRow(q.id);

          const totalsForRow = isLogistics ? logisticsTotals : baseTotals;
          const lineTotal =
            scheme === "home"
              ? totalsForRow[q.id]?.home || 0
              : totalsForRow[q.id]?.moowr || 0;

          const allottedCost = thisAllotted * lineTotal;

          const seaFreightUsd = isLogistics
            ? getQuoteValue(q, q.id, "seaFreightPerContainer")
            : fmt.num(q.seaFreightPerContainer);

          const seaFreightInr = seaFreightUsd * usdToInr;

          const hdo = isLogistics
            ? getQuoteValue(q, q.id, "houseDeliveryOrderPerBOL")
            : fmt.num(q.houseDeliveryOrderPerBOL);

          const cfs = isLogistics
            ? getQuoteValue(q, q.id, "cfsPerContainer")
            : fmt.num(q.cfsPerContainer);

          const trn = isLogistics
            ? getQuoteValue(q, q.id, "transportationPerContainer")
            : fmt.num(q.transportationPerContainer);

          const edi = isLogistics
            ? getQuoteValue(q, q.id, "ediChargesPerBOE")
            : fmt.num(q.ediChargesPerBOE);

          const chaHome = isLogistics
            ? getQuoteValue(q, q.id, "chaChargesHome")
            : fmt.num(q.chaChargesHome);

          const chaMoowr = isLogistics
            ? getQuoteValue(q, q.id, "chaChargesMOOWR")
            : fmt.num(q.chaChargesMOOWR);

          const ware = isLogistics
            ? getQuoteValue(q, q.id, "mooWRReeWarehousingCharges")
            : fmt.num(q.mooWRReeWarehousingCharges);

          const labelCls = "w-64 pr-4 text-muted-foreground";
          const rowCls = "border-b last:border-b-0";
          const cellCls = "py-2 align-top";

          return (
            <div
              key={`${q.id}-${mode}-${scheme}`}
              className="rounded-lg border bg-background overflow-hidden"
            >
              {/* Vendor header */}
              <div className="px-4 py-3 border-b flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">
                    {fmt.plain(q.vendorName)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Quoted Containers:{" "}
                    <span className="font-medium">
                      {fmt.plain(q.numberOfContainers)}
                    </span>
                    {" • "}
                    Scheme:{" "}
                    <span className="font-medium">{scheme.toUpperCase()}</span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-xs text-muted-foreground">
                    Allotted Cost
                  </div>
                  <div className="font-bold">{fmt.money(allottedCost)}</div>
                </div>
              </div>

              {/* Vertical table */}
              <div className="p-4">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>
                        Allotted ({scheme.toUpperCase()})
                      </td>
                      <td className={cellCls}>
                        {isLogistics ? (
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
                            className="w-32"
                          />
                        ) : (
                          <span className="font-medium">{thisAllotted}</span>
                        )}
                        {existingVal > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Already saved:{" "}
                            <span className="font-medium">{existingVal}</span>
                          </div>
                        )}
                      </td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>
                        Line Total (INR)
                      </td>
                      <td className={cellCls}>{fmt.money(lineTotal)}</td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>T/D</td>
                      <td className={cellCls}>
                        {fmt.plain(q.transshipOrDirect)}
                      </td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>
                        Shipping Line
                      </td>
                      <td className={cellCls}>
                        {fmt.plain(q.shippingLineName)}
                      </td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>Vessel</td>
                      <td className={cellCls}>{fmt.plain(q.vesselName)}</td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>ETD</td>
                      <td className={cellCls}>{fmt.date(q.vesselETD)}</td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>ETA</td>
                      <td className={cellCls}>{fmt.date(q.vesselETA)}</td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>
                        Sea Freight/Container (USD)
                      </td>
                      <td className={cellCls}>
                        {isLogistics ? (
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={seaFreightUsd}
                            onChange={(e) =>
                              changePrice(
                                q.id,
                                "seaFreightPerContainer",
                                parseFloat(e.currentTarget.value) || 0
                              )
                            }
                            className="w-40"
                          />
                        ) : (
                          <span className="font-medium">
                            {fmt.num(seaFreightUsd).toFixed(2)}
                          </span>
                        )}
                        <div className="text-xs text-muted-foreground mt-1">
                          Sea Freight/Container (INR):{" "}
                          <span className="font-medium">
                            {fmt.money(seaFreightInr)}
                          </span>{" "}
                          <span className="ml-2">
                            (USD→INR:{" "}
                            <span className="font-semibold">
                              {usdToInr.toFixed(4)}
                            </span>
                            )
                          </span>
                        </div>
                      </td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>
                        HDO per BOL (INR)
                      </td>
                      <td className={cellCls}>
                        {isLogistics ? (
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={hdo}
                            onChange={(e) =>
                              changePrice(
                                q.id,
                                "houseDeliveryOrderPerBOL",
                                parseFloat(e.currentTarget.value) || 0
                              )
                            }
                            className="w-40"
                          />
                        ) : (
                          fmt.money(q.houseDeliveryOrderPerBOL)
                        )}
                      </td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>
                        CFS/Container (INR)
                      </td>
                      <td className={cellCls}>
                        {isLogistics ? (
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={cfs}
                            onChange={(e) =>
                              changePrice(
                                q.id,
                                "cfsPerContainer",
                                parseFloat(e.currentTarget.value) || 0
                              )
                            }
                            className="w-40"
                          />
                        ) : (
                          fmt.money(q.cfsPerContainer)
                        )}
                      </td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>
                        Transport/Container (INR)
                      </td>
                      <td className={cellCls}>
                        {isLogistics ? (
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={trn}
                            onChange={(e) =>
                              changePrice(
                                q.id,
                                "transportationPerContainer",
                                parseFloat(e.currentTarget.value) || 0
                              )
                            }
                            className="w-40"
                          />
                        ) : (
                          fmt.money(q.transportationPerContainer)
                        )}
                      </td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>
                        EDI per BOE (INR)
                      </td>
                      <td className={cellCls}>
                        {isLogistics ? (
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={edi}
                            onChange={(e) =>
                              changePrice(
                                q.id,
                                "ediChargesPerBOE",
                                parseFloat(e.currentTarget.value) || 0
                              )
                            }
                            className="w-40"
                          />
                        ) : (
                          fmt.money(q.ediChargesPerBOE)
                        )}
                      </td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>
                        CHA Home (INR)
                      </td>
                      <td className={cellCls}>
                        {isLogistics ? (
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={chaHome}
                            onChange={(e) =>
                              changePrice(
                                q.id,
                                "chaChargesHome",
                                parseFloat(e.currentTarget.value) || 0
                              )
                            }
                            className="w-40"
                          />
                        ) : (
                          fmt.money(q.chaChargesHome)
                        )}
                      </td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>
                        CHA MOOWR (INR)
                      </td>
                      <td className={cellCls}>
                        {isLogistics ? (
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={chaMoowr}
                            onChange={(e) =>
                              changePrice(
                                q.id,
                                "chaChargesMOOWR",
                                parseFloat(e.currentTarget.value) || 0
                              )
                            }
                            className="w-40"
                          />
                        ) : (
                          fmt.money(q.chaChargesMOOWR)
                        )}
                      </td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>
                        MOOWR Re-warehousing/BOE (INR)
                      </td>
                      <td className={cellCls}>
                        {isLogistics ? (
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={ware}
                            onChange={(e) =>
                              changePrice(
                                q.id,
                                "mooWRReeWarehousingCharges",
                                parseFloat(e.currentTarget.value) || 0
                              )
                            }
                            className="w-44"
                          />
                        ) : (
                          fmt.money(q.mooWRReeWarehousingCharges)
                        )}
                      </td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>
                        Quote Validity
                      </td>
                      <td className={cellCls}>
                        {fmt.date(q.quoteValidityDate)}
                      </td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>Message</td>
                      <td className={`${cellCls} whitespace-pre-wrap`}>
                        {fmt.plain(q.message)}
                      </td>
                    </tr>

                    <tr className={rowCls}>
                      <td className={`${labelCls} ${cellCls}`}>
                        Quote Created
                      </td>
                      <td className={cellCls}>{fmt.datetime(q.createdAt)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
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
                onClick={() => openFullscreen(title, mode, scheme)}
                title="Open table in full screen"
              >
                <Maximize2 className="h-4 w-4 mr-2" />
                Full screen
              </Button>
            </div>
          </div>

          {isLogistics ? (
            <div className="text-xs text-muted-foreground">
              You can edit both allocation and pricing fields below. Totals
              update instantly.
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              LEAFI recommendation (read-only).
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Finalize RFQ #{rfq.rfqNumber}</h1>
        <Button variant="outline" onClick={() => navigate("/dashboard")}>
          Back
        </Button>
      </div>

      {rfqInfoGrid}

      {/* Vendor (LEAFI) Allocation */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Vendor Allocation</h2>
        <Badge variant="secondary" className="font-semibold">
          LEAFI (read-only)
        </Badge>
      </div>

      {/* one below the other (no side-by-side) */}
      <div className="grid gap-6">
        {renderTable("Vendor CHA-HOME", "leafi", "home")}
        {renderTable("Vendor CHA-MOOWR", "leafi", "moowr")}
      </div>

      <Card className="w-full max-w-full">
        <CardContent className="pt-6">
          <div className="flex flex-col gap-1 text-right">
            <div className="font-bold">
              LEAFI total vehicles: {vendorAutoTotal}
            </div>
            <div className="font-bold">
              LEAFI total price: {fmt.money(vendorAutoPrice)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Logistics Allocation */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Logistics Allocation</h2>
        <Badge
          variant={hasAnyPriceEdits ? "default" : "secondary"}
          className="font-semibold"
        >
          Logistics {hasAnyPriceEdits ? "(price edited)" : ""}
        </Badge>
      </div>

      {/* one below the other (no side-by-side) */}
      <div className="grid gap-6">
        {renderTable("Logistics CHA-HOME", "logistics", "home")}
        {renderTable("Logistics CHA-MOOWR", "logistics", "moowr")}
      </div>

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
                (Logistics − LEAFI)
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
