/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useData } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const USD_TO_INR_RATE = 75;

interface LineTotals {
  home: number;
  moowr: number;
}

interface AllocDraft {
  containersAllottedHome: number;
  containersAllottedMOOWR: number;
}

const FinalizeRFQ: React.FC = () => {
  const { rfqId } = useParams<{ rfqId: string }>();
  const navigate = useNavigate();
  const {
    getRFQById,
    getQuotesByRFQId,
    getAllocationsByRFQId,
    finalizeRFQ,
  } = useData();

  const rfq = getRFQById(rfqId || "");
  const quotes = getQuotesByRFQId(rfqId || "");

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
        m[a.quoteId] = { containersAllottedHome: 0, containersAllottedMOOWR: 0 };
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

  const [reasonModal, setReasonModal] = useState(false);
  const [deviationReason, setDeviationReason] = useState("");

  /* ─────────────── COMPUTE LINE TOTALS ─────────────── */
  const totals: Record<string, LineTotals> = useMemo(() => {
    const t: Record<string, LineTotals> = {};
    quotes.forEach((q) => {
      const sea = q.seaFreightPerContainer * USD_TO_INR_RATE;
      t[q.id] = {
        home:
          sea +
          q.houseDeliveryOrderPerBOL +
          q.cfsPerContainer +
          q.transportationPerContainer +
          q.ediChargesPerBOE +
          q.chaChargesHome,
        moowr:
          sea +
          q.houseDeliveryOrderPerBOL +
          q.cfsPerContainer +
          q.transportationPerContainer +
          q.ediChargesPerBOE +
          q.mooWRReeWarehousingCharges +
          q.chaChargesMOOWR,
      };
    });
    return t;
  }, [quotes]);

  /* ───── AUTO (LEAFI) ALLOCATION ONCE ───── */
  useEffect(() => {
    if (!rfq || !quotes.length || Object.keys(autoAlloc).length) return;

    type Slot = { quoteId: string; scheme: "home" | "moowr"; price: number };
    const slots: Slot[] = [];

    quotes.forEach((q) => {
      slots.push({ quoteId: q.id, scheme: "home", price: totals[q.id].home });
      slots.push({ quoteId: q.id, scheme: "moowr", price: totals[q.id].moowr });
    });

    slots.sort((a, b) => a.price - b.price);

    let remaining = rfq.numberOfContainers;
    const draft: Record<string, AllocDraft> = {};

    for (const { quoteId, scheme } of slots) {
      if (remaining === 0) break;
      const offered = quotes.find((q) => q.id === quoteId)!.numberOfContainers;
      const take = Math.min(offered, remaining);
      if (!draft[quoteId]) {
        draft[quoteId] = { containersAllottedHome: 0, containersAllottedMOOWR: 0 };
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
  }, [rfq, quotes, totals, existingTotal]);

  /* ─────────────── SUMS & PRICES ─────────────── */
  // total user‐allocated so far (including previous partials + current)
  const totalAllocated = useMemo(
    () =>
      Object.values(alloc).reduce(
        (sum, a) => sum + a.containersAllottedHome + a.containersAllottedMOOWR,
        0
      ),
    [alloc]
  );

  // LEAFI totals (read‐only)
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
          a.containersAllottedHome * (totals[qid]?.home || 0) +
          a.containersAllottedMOOWR * (totals[qid]?.moowr || 0),
        0
      ),
    [autoAlloc, totals]
  );

  const allocationValid = rfq != null && totalAllocated > 0;

  // Compute per‐row max based on remaining
  const computeMaxForRow = (quoteId: string) => {
    if (!rfq) return 0;
    const prev = alloc[quoteId] || { containersAllottedHome: 0, containersAllottedMOOWR: 0 };
    const others = totalAllocated - (prev.containersAllottedHome + prev.containersAllottedMOOWR);
    return Math.max(0, rfq.numberOfContainers - others);
  };

  /* ─────────────── EDIT HANDLER ─────────────── */
  const changeAlloc = (
    quoteId: string,
    scheme: "home" | "moowr",
    raw: number
  ) => {
    if (!rfq) return;
    const prevAllocated = alloc[quoteId] || { containersAllottedHome: 0, containersAllottedMOOWR: 0 };
    const existingValue =
      existingMap[quoteId]?.[
        scheme === "home" ? "containersAllottedHome" : "containersAllottedMOOWR"
      ] || 0;

    // how much this row *could* take
    const maxForRow = computeMaxForRow(quoteId);
    // clamp raw between 0..maxForRow
    const clamped = Math.min(Math.max(0, raw), maxForRow);
    // never drop below already‐saved
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

  /* ─────────────── FINAL SUBMIT ─────────────── */
  const storeFinalisation = async () => {
    if (!rfq) return;

    for (const [qid, a] of Object.entries(alloc)) {
      // skip if nothing new beyond existing
      const existed = existingMap[qid] || { containersAllottedHome: 0, containersAllottedMOOWR: 0 };
      const deltaHome = a.containersAllottedHome - existed.containersAllottedHome;
      const deltaMoowr = a.containersAllottedMOOWR - existed.containersAllottedMOOWR;
      if (deltaHome <= 0 && deltaMoowr <= 0) continue;

      const q = quotes.find((x) => x.id === qid);
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

    // if partial, stay on page
    if (totalAllocated < rfq.numberOfContainers) {
      toast.success(`Saved partial allocation (${totalAllocated}/${rfq.numberOfContainers}).`);
      return;
    }

    // fully done
    navigate("/dashboard");
  };

  const onFinalizeClick = () => {
    if (!rfq) return;
    // only require reason if finishing and deviating
    const cheapest = quotes.reduce((a, b) =>
      totals[a.id].home + totals[a.id].moowr <= totals[b.id].home + totals[b.id].moowr ? a : b
    );
    const optHome = totals[cheapest.id].home <= totals[cheapest.id].moowr
      ? rfq.numberOfContainers
      : 0;
    const optMoowr = rfq.numberOfContainers - optHome;
    const chosen = alloc[cheapest.id] || { containersAllottedHome: 0, containersAllottedMOOWR: 0 };
    const deviates = chosen.containersAllottedHome !== optHome || chosen.containersAllottedMOOWR !== optMoowr;

    if (deviates && totalAllocated === rfq.numberOfContainers) {
      setReasonModal(true);
    } else {
      storeFinalisation();
    }
  };

  /* ─────────────── EARLY EXITS ─────────────── */
  if (!rfq) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">RFQ not found</h2>
        <Button onClick={() => navigate("/dashboard")}>Return to Dashboard</Button>
      </div>
    );
  }
  if (!quotes.length) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">No quotes submitted for this RFQ yet</h2>
        <Button onClick={() => navigate("/dashboard")}>Back</Button>
      </div>
    );
  }

  /* ─────────────── TABLE RENDERER ─────────────── */
  const renderTable = (
    title: string,
    editable: boolean,
    scheme: "home" | "moowr"
  ) => (
    <Card key={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full data-table text-sm">
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Offered</th>
              <th>Allotted</th>
              <th>T/D</th>
              <th>Line</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => {
              const state = editable ? alloc : autoAlloc;
              const thisAllotted =
                state[q.id]?.[
                  scheme === "home" ? "containersAllottedHome" : "containersAllottedMOOWR"
                ] || 0;
              const existingVal =
                existingMap[q.id]?.[
                  scheme === "home" ? "containersAllottedHome" : "containersAllottedMOOWR"
                ] || 0;
              const rowMax = computeMaxForRow(q.id);

              return (
                <tr key={q.id}>
                  <td>{q.vendorName}</td>
                  <td>{q.numberOfContainers}</td>
                  <td>
                    {editable ? (
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
                        className="w-16"
                      />
                    ) : (
                      thisAllotted
                    )}
                  </td>
                  <td>{q.transshipOrDirect}</td>
                  <td>{q.shippingLineName}</td>
                  <td>{q.containerType}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Finalize RFQ #{rfq.rfqNumber}</h1>
        <Button variant="outline" onClick={() => navigate("/dashboard")}>
          Back
        </Button>
      </div>

      {/* Vendor (LEAFI) Allocation */}
      <h2 className="text-xl font-bold">Vendor Allocation (auto)</h2>
      <div className="grid gap-6 md:grid-cols-2">
        {renderTable("Vendor CHA-HOME (auto)", false, "home")}
        {renderTable("Vendor CHA-MOOWR (auto)", false, "moowr")}
      </div>
      <div className="text-right space-y-1">
        <div className="font-bold">LEAFI total vehicles: {vendorAutoTotal}</div>
        <div className="font-bold">
          LEAFI total price: ₹{vendorAutoPrice.toFixed(2)}
        </div>
      </div>

      {/* Logistics Allocation */}
      <h2 className="text-xl font-bold">Logistics Allocation (edit)</h2>
      <div className="grid gap-6 md:grid-cols-2">
        {renderTable("Logistics CHA-HOME", true, "home")}
        {renderTable("Logistics CHA-MOOWR", true, "moowr")}
      </div>
      <div className="text-right space-y-1">
        <div className="font-bold">Logistics total vehicles: {totalAllocated}</div>
        <div className="font-bold">
          Logistics total price: ₹
          {Object.entries(alloc)
            .reduce(
              (sum, [qid, a]) =>
                sum +
                a.containersAllottedHome * (totals[qid]?.home || 0) +
                a.containersAllottedMOOWR * (totals[qid]?.moowr || 0),
              0
            )
            .toFixed(2)}
        </div>
      </div>

      {/* Finalize/Save Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between p-4 border rounded bg-muted/20">
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

      {/* Deviation Modal */}
      <Dialog open={reasonModal} onOpenChange={setReasonModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reason for Deviation</DialogTitle>
          </DialogHeader>
          <Label htmlFor="reason" className="block mb-2">
            Please explain why this differs from the lowest-cost allocation:
          </Label>
          <Textarea
            id="reason"
            rows={4}
            value={deviationReason}
            onChange={(e) => setDeviationReason(e.target.value)}
          />
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
