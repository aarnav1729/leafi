import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useData } from "@/contexts/DataContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { StatusBadge } from "@/components/common/StatusBadge";

type ReportRow = {
  portOfLoading: string;
  containerType: string;
  containersQty: number;
  oceanFreightUsd: number;
  quoteDate: string;
};

type RangePreset = "7d" | "30d" | "90d" | "ytd" | "all" | "custom";

function fmtUsd(v: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function fmtMoney(v: number | null | undefined) {
  const n = Number(v);
  return Number.isFinite(n)
    ? `₹${n.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : "—";
}

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(d: string | Date | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayKey(date: string | Date | null | undefined) {
  if (!date) return "";
  const dt = new Date(date);
  if (Number.isNaN(dt.getTime())) return "";
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toDate(value: string | null | undefined) {
  if (!value) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export default function ReportsPage() {
  const { refreshKey, rfqs, quotes, allocations } = useData();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [portFilter, setPortFilter] = useState<string>("");
  const [containerFilter, setContainerFilter] = useState<string>("");
  const [legacyReportOpen, setLegacyReportOpen] = useState(false);
  const [activityReportOpen, setActivityReportOpen] = useState(false);

  const now = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }, [refreshKey]);

  const [rangePreset, setRangePreset] = useState<RangePreset>("30d");
  const [from, setFrom] = useState<string>(dayKey(defaultFrom));
  const [to, setTo] = useState<string>(dayKey(now));

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setErr("");

        const res = await fetch("/api/admin/reports/ocean-freight-top3", {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        });

        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${t || res.statusText}`);
        }

        const data = (await res.json()) as ReportRow[];
        if (!alive) return;
        setRows(Array.isArray(data) ? data : []);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load report");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const applyPreset = React.useCallback((preset: RangePreset) => {
    setRangePreset(preset);

    const end = new Date();
    const start = new Date();

    if (preset === "7d") start.setDate(end.getDate() - 7);
    else if (preset === "30d") start.setDate(end.getDate() - 30);
    else if (preset === "90d") start.setDate(end.getDate() - 90);
    else if (preset === "ytd") {
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
    }

    if (preset !== "all" && preset !== "custom") {
      setFrom(dayKey(start));
      setTo(dayKey(end));
    }
  }, []);

  const dateRange = useMemo(() => {
    if (rangePreset === "all") {
      return { from: null as Date | null, to: null as Date | null };
    }

    const fromDate = toDate(from);
    const toDateValue = toDate(to);
    if (!fromDate || !toDateValue) {
      return { from: null as Date | null, to: null as Date | null };
    }

    const normalizedFrom = new Date(fromDate);
    normalizedFrom.setHours(0, 0, 0, 0);

    const normalizedTo = new Date(toDateValue);
    normalizedTo.setHours(23, 59, 59, 999);

    return {
      from: normalizedFrom,
      to: normalizedTo,
    };
  }, [from, to, rangePreset]);

  const isWithinRange = React.useCallback(
    (value: string | Date | null | undefined) => {
      const dt = value ? new Date(value) : null;
      if (!dt || Number.isNaN(dt.getTime())) return false;
      if (!dateRange.from || !dateRange.to) return true;
      return dt >= dateRange.from && dt <= dateRange.to;
    },
    [dateRange]
  );

  const portOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const v = String(r.portOfLoading || "").trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const containerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const v = String(r.containerType || "").trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const pf = String(portFilter || "").trim().toLowerCase();
    const cf = String(containerFilter || "").trim().toLowerCase();

    return rows.filter((r) => {
      const portOk = !pf
        ? true
        : String(r.portOfLoading || "").trim().toLowerCase() === pf;
      const contOk = !cf
        ? true
        : String(r.containerType || "").trim().toLowerCase() === cf;
      return portOk && contOk;
    });
  }, [rows, portFilter, containerFilter]);

  const dailyReportDays = useMemo(() => {
    const grouped = new Map<string, any[]>();

    const visibleRfqs = [...rfqs]
      .filter((rfq) => isWithinRange(rfq.createdAt))
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

    for (const rfq of visibleRfqs) {
      const rfqQuotes = quotes
        .filter((quote) => quote.rfqId === rfq.id)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

      const rfqAllocations = allocations.filter(
        (allocation) => allocation.rfqId === rfq.id
      );

      const allocationByQuoteId = new Map<
        string,
        {
          home: number;
          moowr: number;
          reasons: string[];
          vendorName: string;
        }
      >();

      for (const allocation of rfqAllocations) {
        const existing = allocationByQuoteId.get(allocation.quoteId) || {
          home: 0,
          moowr: 0,
          reasons: [],
          vendorName: allocation.vendorName,
        };
        existing.home += Number(allocation.containersAllottedHome || 0);
        existing.moowr += Number(allocation.containersAllottedMOOWR || 0);
        if (allocation.reason?.trim()) {
          existing.reasons.push(allocation.reason.trim());
        }
        allocationByQuoteId.set(allocation.quoteId, existing);
      }

      const quoteRows = rfqQuotes.map((quote) => {
        const allocation = allocationByQuoteId.get(quote.id);
        const hasHome = Number(allocation?.home || 0) > 0;
        const hasMoowr = Number(allocation?.moowr || 0) > 0;
        const homeTotal = Number(quote.homeTotal || 0);
        const moowrTotal = Number(quote.mooWRTotal || 0);

        let lineTotalLabel = "Best Line Total";
        let lineTotalValue = fmtMoney(
          homeTotal > 0 && moowrTotal > 0
            ? Math.min(homeTotal, moowrTotal)
            : homeTotal || moowrTotal
        );

        if (hasHome && !hasMoowr) {
          lineTotalLabel = "Allocated HOME Total";
          lineTotalValue = fmtMoney(homeTotal);
        } else if (hasMoowr && !hasHome) {
          lineTotalLabel = "Allocated MOOWR Total";
          lineTotalValue = fmtMoney(moowrTotal);
        } else if (hasHome && hasMoowr) {
          lineTotalLabel = "Allocated Mixed Total";
          lineTotalValue = `${fmtMoney(homeTotal)} / ${fmtMoney(moowrTotal)}`;
        }

        return {
          ...quote,
          lineTotalLabel,
          lineTotalValue,
          allocation,
          isAllocated: Boolean(allocation && (allocation.home > 0 || allocation.moowr > 0)),
          deviationReasons: Array.from(new Set(allocation?.reasons || [])),
        };
      });

      const allocationSummary = Array.from(
        rfqAllocations.reduce((map, allocation) => {
          const existing = map.get(allocation.vendorName) || {
            vendorName: allocation.vendorName,
            home: 0,
            moowr: 0,
            reasons: [] as string[],
          };
          existing.home += Number(allocation.containersAllottedHome || 0);
          existing.moowr += Number(allocation.containersAllottedMOOWR || 0);
          if (allocation.reason?.trim()) {
            existing.reasons.push(allocation.reason.trim());
          }
          map.set(allocation.vendorName, existing);
          return map;
        }, new Map<string, { vendorName: string; home: number; moowr: number; reasons: string[] }>())
      ).map(([, value]) => ({
        ...value,
        reasons: Array.from(new Set(value.reasons)),
      }));

      const key = dayKey(rfq.createdAt);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)?.push({
        rfq,
        quoteRows,
        allocationSummary,
        allocatedVendorNames: new Set(allocationSummary.map((item) => item.vendorName)),
      });
    }

    return Array.from(grouped.entries()).map(([key, items]) => ({
      key,
      label: fmtDate(key),
      items,
    }));
  }, [allocations, isWithinRange, quotes, rfqs]);

  const titleRight = useMemo(() => {
    if (loading) return "Loading…";
    if (err) return "Error";
    const active = (portFilter ? 1 : 0) + (containerFilter ? 1 : 0);
    return active
      ? `${filteredRows.length} row(s) (of ${rows.length})`
      : `${rows.length} row(s)`;
  }, [loading, err, rows.length, filteredRows.length, portFilter, containerFilter]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Daily RFQ activity with quotes, allocations, and deviation visibility.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Time range</div>
            <Select
              value={rangePreset}
              onValueChange={(value) => applyPreset(value as RangePreset)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="ytd">Year to date</SelectItem>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">From</div>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setRangePreset("custom");
              }}
              disabled={rangePreset === "all"}
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">To</div>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setRangePreset("custom");
              }}
              disabled={rangePreset === "all"}
            />
          </div>

          <div className="rounded-xl border bg-background px-4 py-3 text-sm text-muted-foreground">
            {dailyReportDays.length} day group(s)
          </div>
        </div>
      </div>

      <Collapsible
        open={legacyReportOpen}
        onOpenChange={setLegacyReportOpen}
        className="rounded-xl border bg-background"
      >
        <div className="flex flex-col gap-4 border-b px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-lg font-semibold">
              Ocean Freight Top 3 Report
            </div>
            <p className="text-sm text-muted-foreground">
              Existing report, now collapsed by default.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="text-xs text-muted-foreground">Port of Loading</div>
              <select
                value={portFilter}
                onChange={(e) => setPortFilter(e.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">All</option>
                {portOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-xs text-muted-foreground">Container Type</div>
              <select
                value={containerFilter}
                onChange={(e) => setContainerFilter(e.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">All</option>
                {containerOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-sm text-muted-foreground">{titleRight}</div>

            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm">
                {legacyReportOpen ? "Hide report" : "Show report"}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent>
          <div className="overflow-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="p-2 sm:p-3 font-semibold">Port of Loading</th>
                  <th className="p-2 sm:p-3 font-semibold">Container Type</th>
                  <th className="p-2 sm:p-3 font-semibold">Containers Qty</th>
                  <th className="p-2 sm:p-3 font-semibold">
                    Ocean Freight / Container (in $)
                  </th>
                  <th className="p-2 sm:p-3 font-semibold">Date of Quote</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td className="p-2 sm:p-3" colSpan={5}>
                      Loading…
                    </td>
                  </tr>
                ) : err ? (
                  <tr>
                    <td className="p-2 sm:p-3 text-red-600" colSpan={5}>
                      {err}
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td className="p-2 sm:p-3" colSpan={5}>
                      No data available.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-2 sm:p-3">{r.portOfLoading || "—"}</td>
                      <td className="p-2 sm:p-3">{r.containerType || "—"}</td>
                      <td className="p-2 sm:p-3">{Number(r.containersQty || 0)}</td>
                      <td className="p-2 sm:p-3">
                        {fmtUsd(Number(r.oceanFreightUsd))}
                      </td>
                      <td className="p-2 sm:p-3">{fmtDate(r.quoteDate)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible
        open={activityReportOpen}
        onOpenChange={setActivityReportOpen}
        className="rounded-xl border bg-background"
      >
        <div className="flex flex-col gap-4 border-b px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-lg font-semibold">
              Daily RFQ Activity Report
            </div>
            <p className="text-sm text-muted-foreground">
              RFQs floated by day, quotes received, allocations, and deviation visibility.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-sm text-muted-foreground">
              {dailyReportDays.length} day group(s)
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm">
                {activityReportOpen ? "Hide report" : "Show report"}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent>
          <div className="space-y-4 p-4">
            {dailyReportDays.length === 0 ? (
              <div className="rounded-xl border bg-background p-6 text-sm text-muted-foreground">
                No RFQ activity found for the selected time range.
              </div>
            ) : (
              dailyReportDays.map((day) => (
                <Collapsible
                  key={day.key}
                  defaultOpen={false}
                  className="rounded-xl border bg-background"
                >
                  <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                    <div>
                      <div className="text-lg font-semibold">{day.label}</div>
                      <div className="text-sm text-muted-foreground">
                        {day.items.length} RFQ(s) floated
                      </div>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" size="sm">
                        View day
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </CollapsibleTrigger>
                  </div>

                  <CollapsibleContent>
                    <div className="space-y-4 p-4">
                      {day.items.map(
                        ({
                          rfq,
                          quoteRows,
                          allocationSummary,
                          allocatedVendorNames,
                        }) => (
                          <div
                            key={rfq.id}
                            className="rounded-xl border bg-muted/10"
                          >
                            <div className="flex flex-col gap-4 border-b px-4 py-4">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-lg font-semibold">
                                      RFQ #{rfq.rfqNumber}
                                    </div>
                                    <StatusBadge status={rfq.status} />
                                  </div>
                                  <div className="text-sm font-medium text-foreground">
                                    {rfq.itemDescription}
                                  </div>
                                  <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
                                    <div>Company: {rfq.companyName}</div>
                                    <div>Material PO: {rfq.materialPONumber}</div>
                                    <div>
                                      Route: {rfq.portOfLoading} to{" "}
                                      {rfq.portOfDestination}
                                    </div>
                                    <div>
                                      Created: {fmtDateTime(rfq.createdAt)}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                <div className="min-w-0 rounded-lg border bg-background px-3 py-3 text-sm">
                                  <div className="text-xs text-muted-foreground">
                                    Quotes Received
                                  </div>
                                  <div className="mt-1 break-words text-base font-semibold sm:text-lg">
                                    {quoteRows.length}
                                  </div>
                                </div>
                                <div className="min-w-0 rounded-lg border bg-background px-3 py-3 text-sm">
                                  <div className="text-xs text-muted-foreground">
                                    Allocated Vendors
                                  </div>
                                  <div className="mt-1 break-words text-base font-semibold sm:text-lg">
                                    {allocationSummary.length}
                                  </div>
                                </div>
                                <div className="min-w-0 rounded-lg border bg-background px-3 py-3 text-sm">
                                  <div className="text-xs text-muted-foreground">
                                    Containers
                                  </div>
                                  <div className="mt-1 break-words text-base font-semibold sm:text-lg">
                                    {rfq.numberOfContainers}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="grid gap-4 p-4 xl:grid-cols-[2fr_1fr]">
                              <div className="space-y-3">
                                <div className="text-sm font-semibold">
                                  Quotes Received Per RFQ
                                </div>

                                {quoteRows.length === 0 ? (
                                  <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
                                    No quotes received.
                                  </div>
                                ) : (
                                  quoteRows.map((quote) => (
                                    <Collapsible
                                      key={quote.id}
                                      defaultOpen={false}
                                      className={`rounded-lg border bg-background ${
                                        quote.isAllocated
                                          ? "border-emerald-300 bg-emerald-50/50"
                                          : ""
                                      }`}
                                    >
                                      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                          <div className="flex flex-wrap items-center gap-2">
                                            <div className="font-medium">
                                              {quote.vendorName}
                                            </div>
                                            {quote.isAllocated && (
                                              <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                                                Allocated Vendor
                                              </Badge>
                                            )}
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            {quote.lineTotalLabel}:{" "}
                                            {quote.lineTotalValue}
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                          {quote.deviationReasons.length > 0 && (
                                            <Badge variant="destructive">
                                              Deviation
                                            </Badge>
                                          )}
                                          <CollapsibleTrigger asChild>
                                            <Button variant="outline" size="sm">
                                              Breakdown
                                              <ChevronDown className="h-4 w-4" />
                                            </Button>
                                          </CollapsibleTrigger>
                                        </div>
                                      </div>

                                      <CollapsibleContent className="border-t px-4 py-3">
                                        <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                                          <div>
                                            Quoted containers:{" "}
                                            {quote.numberOfContainers}
                                          </div>
                                          <div>
                                            Shipping line: {quote.shippingLineName}
                                          </div>
                                          <div>
                                            Transship/Direct:{" "}
                                            {quote.transshipOrDirect}
                                          </div>
                                          <div>
                                            Sea Freight: $
                                            {fmtUsd(
                                              Number(quote.seaFreightPerContainer)
                                            )}
                                          </div>
                                          <div>
                                            HDO/BOL:{" "}
                                            {fmtMoney(
                                              quote.houseDeliveryOrderPerBOL
                                            )}
                                          </div>
                                          <div>
                                            CFS: {fmtMoney(quote.cfsPerContainer)}
                                          </div>
                                          <div>
                                            Transportation:{" "}
                                            {fmtMoney(
                                              quote.transportationPerContainer
                                            )}
                                          </div>
                                          <div>
                                            EDI/BOE:{" "}
                                            {fmtMoney(quote.ediChargesPerBOE)}
                                          </div>
                                          <div>
                                            CHA HOME:{" "}
                                            {fmtMoney(quote.chaChargesHome)}
                                          </div>
                                          <div>
                                            CHA MOOWR:{" "}
                                            {fmtMoney(quote.chaChargesMOOWR)}
                                          </div>
                                          <div>
                                            Re-warehousing:{" "}
                                            {fmtMoney(
                                              quote.mooWRReeWarehousingCharges
                                            )}
                                          </div>
                                          <div>
                                            HOME Total:{" "}
                                            {fmtMoney(quote.homeTotal)}
                                          </div>
                                          <div>
                                            MOOWR Total:{" "}
                                            {fmtMoney(quote.mooWRTotal)}
                                          </div>
                                          <div>
                                            Quoted at:{" "}
                                            {fmtDateTime(quote.createdAt)}
                                          </div>
                                        </div>
                                      </CollapsibleContent>
                                    </Collapsible>
                                  ))
                                )}
                              </div>

                              <div className="space-y-3">
                                <div className="text-sm font-semibold">
                                  Allocation Vendor Summary
                                </div>

                                {allocationSummary.length === 0 ? (
                                  <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
                                    No allocation recorded yet.
                                  </div>
                                ) : (
                                  allocationSummary.map((allocation) => (
                                    <div
                                      key={allocation.vendorName}
                                      className={`rounded-lg border bg-background p-3 ${
                                        allocatedVendorNames.has(
                                          allocation.vendorName
                                        )
                                          ? "border-emerald-300 bg-emerald-50/60"
                                          : ""
                                      }`}
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex flex-wrap items-center gap-2 font-medium">
                                          <span>{allocation.vendorName}</span>
                                          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                                            Allocated
                                          </Badge>
                                        </div>
                                        {allocation.reasons.length > 0 && (
                                          <Badge variant="destructive">
                                            Deviation
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="mt-2 grid gap-1 text-sm text-muted-foreground">
                                        <div>
                                          HOME allocated: {allocation.home}
                                        </div>
                                        <div>
                                          MOOWR allocated: {allocation.moowr}
                                        </div>
                                        {allocation.reasons.length > 0 && (
                                          <div className="rounded-md bg-destructive/10 px-2 py-2 text-destructive">
                                            Reason:{" "}
                                            {allocation.reasons.join(" | ")}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
