import React from "react";
import { useData } from "@/contexts/DataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  LineChart,
  Line,
  AreaChart,
  Area,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  ChartLine,
  ChartPie,
  ContainerIcon,
  FileHeart,
  Ship,
  Filter,
  Download,
  RefreshCcw,
  Building2,
  MapPin,
  Users,
  Clock,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AnyRecord = Record<string, any>;

const AdminDashboard = () => {
  const { rfqs, quotes, allocations } = useData();

  const fmt = React.useMemo(
    () => ({
      num: (v: any) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      },
      money: (v: any) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return "₹0.00";
        return `₹${n.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      },
      pct: (v: any) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return "0%";
        return `${(n * 100).toFixed(1)}%`;
      },
      date: (v: any) => {
        if (!v) return null;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
      },
      dayKey: (d: Date) => {
        // YYYY-MM-DD
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${dd}`;
      },
      monthKey: (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        return `${y}-${m}`;
      },
      humanDays: (ms: number) => {
        if (!Number.isFinite(ms) || ms <= 0) return "0d";
        const days = ms / (1000 * 60 * 60 * 24);
        if (days < 1) return `${Math.max(0, Math.round(days * 24))}h`;
        if (days < 7) return `${days.toFixed(1)}d`;
        return `${Math.round(days)}d`;
      },
    }),
    []
  );

  const palette = React.useMemo(
    () => [
      "#3b82f6",
      "#10b981",
      "#f59e0b",
      "#ef4444",
      "#8b5cf6",
      "#06b6d4",
      "#22c55e",
      "#e11d48",
      "#a855f7",
      "#0ea5e9",
      "#f97316",
      "#14b8a6",
    ],
    []
  );

  const now = React.useMemo(() => new Date(), []);
  const defaultFrom = React.useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }, []);

  const [rangePreset, setRangePreset] = React.useState<
    "7d" | "30d" | "90d" | "ytd" | "all" | "custom"
  >("30d");
  const [from, setFrom] = React.useState<string>(fmt.dayKey(defaultFrom));
  const [to, setTo] = React.useState<string>(fmt.dayKey(now));

  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [containerTypeFilter, setContainerTypeFilter] =
    React.useState<string>("all");
  const [polFilter, setPolFilter] = React.useState<string>("all");
  const [podFilter, setPodFilter] = React.useState<string>("all");
  const [vendorFilter, setVendorFilter] = React.useState<string>("all");

  const applyPreset = React.useCallback(
    (preset: typeof rangePreset) => {
      setRangePreset(preset);

      const end = new Date();
      const start = new Date();

      if (preset === "7d") start.setDate(end.getDate() - 7);
      else if (preset === "30d") start.setDate(end.getDate() - 30);
      else if (preset === "90d") start.setDate(end.getDate() - 90);
      else if (preset === "ytd") {
        start.setMonth(0, 1);
        start.setHours(0, 0, 0, 0);
      } else if (preset === "all") {
        // keep current from/to, filtering will ignore
      } else if (preset === "custom") {
        // keep current from/to
      }

      if (preset !== "all" && preset !== "custom") {
        setFrom(fmt.dayKey(start));
        setTo(fmt.dayKey(end));
      }
    },
    [fmt]
  );

  const dateRange = React.useMemo(() => {
    if (rangePreset === "all")
      return { from: null as Date | null, to: null as Date | null };
    const f = fmt.date(from);
    const t = fmt.date(to);
    if (!f || !t) return { from: null as Date | null, to: null as Date | null };
    const fromDate = new Date(f);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(t);
    toDate.setHours(23, 59, 59, 999);
    return { from: fromDate, to: toDate };
  }, [from, to, rangePreset, fmt]);

  const allStatuses = React.useMemo(() => {
    const s = new Set<string>();
    (rfqs || []).forEach((r: AnyRecord) => {
      if (r?.status) s.add(String(r.status));
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rfqs]);

  const allContainerTypes = React.useMemo(() => {
    const s = new Set<string>();
    (rfqs || []).forEach((r: AnyRecord) => {
      if (r?.containerType) s.add(String(r.containerType));
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rfqs]);

  const allPOL = React.useMemo(() => {
    const s = new Set<string>();
    (rfqs || []).forEach((r: AnyRecord) => {
      if (r?.portOfLoading) s.add(String(r.portOfLoading));
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rfqs]);

  const allPOD = React.useMemo(() => {
    const s = new Set<string>();
    (rfqs || []).forEach((r: AnyRecord) => {
      if (r?.portOfDestination) s.add(String(r.portOfDestination));
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rfqs]);

  const allVendors = React.useMemo(() => {
    const s = new Set<string>();
    (quotes || []).forEach((q: AnyRecord) => {
      if (q?.vendorName) s.add(String(q.vendorName));
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [quotes]);

  const rfqMatchesFilters = React.useCallback(
    (rfq: AnyRecord) => {
      if (!rfq) return false;

      // Date filter (by RFQ createdAt)
      if (dateRange.from && dateRange.to) {
        const d = fmt.date(rfq.createdAt);
        if (!d) return false;
        if (d < dateRange.from || d > dateRange.to) return false;
      }

      if (statusFilter !== "all" && String(rfq.status) !== statusFilter)
        return false;
      if (
        containerTypeFilter !== "all" &&
        String(rfq.containerType) !== containerTypeFilter
      )
        return false;
      if (polFilter !== "all" && String(rfq.portOfLoading) !== polFilter)
        return false;
      if (podFilter !== "all" && String(rfq.portOfDestination) !== podFilter)
        return false;

      return true;
    },
    [dateRange, fmt, statusFilter, containerTypeFilter, polFilter, podFilter]
  );

  const filteredRFQs = React.useMemo(() => {
    return (rfqs || []).filter(rfqMatchesFilters);
  }, [rfqs, rfqMatchesFilters]);

  const rfqIdSet = React.useMemo(() => {
    const s = new Set<string>();
    filteredRFQs.forEach((r: AnyRecord) => {
      if (r?.id) s.add(String(r.id));
    });
    return s;
  }, [filteredRFQs]);

  const filteredQuotes = React.useMemo(() => {
    return (quotes || []).filter((q: AnyRecord) => {
      if (!q) return false;

      // Only quotes whose RFQ passes the filters
      if (!rfqIdSet.has(String(q.rfqId))) return false;

      // Vendor filter
      if (vendorFilter !== "all" && String(q.vendorName) !== vendorFilter)
        return false;

      // Optional: date filter by quote createdAt (keeps behavior consistent for large time windows)
      if (dateRange.from && dateRange.to) {
        const d = fmt.date(q.createdAt);
        if (!d) return false;
        if (d < dateRange.from || d > dateRange.to) return false;
      }

      return true;
    });
  }, [quotes, rfqIdSet, vendorFilter, dateRange, fmt]);

  const quoteIdSet = React.useMemo(() => {
    const s = new Set<string>();
    filteredQuotes.forEach((q: AnyRecord) => {
      if (q?.id) s.add(String(q.id));
    });
    return s;
  }, [filteredQuotes]);

  const filteredAllocations = React.useMemo(() => {
    return (allocations || []).filter((a: AnyRecord) => {
      if (!a) return false;
      // allocations reference quoteId and rfqId
      if (a?.rfqId && !rfqIdSet.has(String(a.rfqId))) return false;
      if (a?.quoteId && !quoteIdSet.has(String(a.quoteId))) return false;

      // keep within date window by allocation createdAt if present, else by RFQ window already applied
      if (dateRange.from && dateRange.to && a?.createdAt) {
        const d = fmt.date(a.createdAt);
        if (d && (d < dateRange.from || d > dateRange.to)) return false;
      }

      return true;
    });
  }, [allocations, rfqIdSet, quoteIdSet, dateRange, fmt]);

  const quoteById = React.useMemo(() => {
    const m = new Map<string, AnyRecord>();
    (quotes || []).forEach((q: AnyRecord) => {
      if (q?.id) m.set(String(q.id), q);
    });
    return m;
  }, [quotes]);

  const rfqById = React.useMemo(() => {
    const m = new Map<string, AnyRecord>();
    (rfqs || []).forEach((r: AnyRecord) => {
      if (r?.id) m.set(String(r.id), r);
    });
    return m;
  }, [rfqs]);

  const aggregation = React.useMemo(() => {
    const totals = {
      rfqs: filteredRFQs.length,
      quotes: filteredQuotes.length,
      allocations: filteredAllocations.length,
      requestedContainers: 0,
      allocatedContainers: 0,
      pendingContainers: 0,
      fullyAllocatedRFQs: 0,
      avgQuotesPerRFQ: 0,
      avgQuoteLatencyMs: 0,
      allocationCost: 0,
      avgCostPerAllocatedContainer: 0,
      bestPossibleCostLowerBound: 0,
      savingsVsLowerBound: 0,
    };

    // requested containers
    totals.requestedContainers = filteredRFQs.reduce(
      (sum: number, r: AnyRecord) => sum + fmt.num(r.numberOfContainers),
      0
    );

    // allocations containers + cost
    let cost = 0;
    let allocContainers = 0;
    filteredAllocations.forEach((a: AnyRecord) => {
      const q = quoteById.get(String(a.quoteId));
      const homeQty = fmt.num(a.containersAllottedHome);
      const moowrQty = fmt.num(a.containersAllottedMOOWR);
      const homeRate = fmt.num(q?.homeTotal);
      const moowrRate = fmt.num(q?.mooWRTotal);
      allocContainers += homeQty + moowrQty;
      cost += homeQty * homeRate + moowrQty * moowrRate;
    });

    totals.allocatedContainers = allocContainers;
    totals.allocationCost = cost;
    totals.pendingContainers = Math.max(
      0,
      totals.requestedContainers - totals.allocatedContainers
    );
    totals.avgCostPerAllocatedContainer =
      totals.allocatedContainers > 0
        ? totals.allocationCost / totals.allocatedContainers
        : 0;

    // quotes per rfq & quote latency
    const quotesByRfq = new Map<string, AnyRecord[]>();
    filteredQuotes.forEach((q: AnyRecord) => {
      const rid = String(q.rfqId);
      if (!quotesByRfq.has(rid)) quotesByRfq.set(rid, []);
      quotesByRfq.get(rid)!.push(q);
    });

    totals.avgQuotesPerRFQ = totals.rfqs > 0 ? totals.quotes / totals.rfqs : 0;

    // average quote response latency (quote.createdAt - rfq.createdAt)
    let latSum = 0;
    let latN = 0;
    filteredQuotes.forEach((q: AnyRecord) => {
      const rfq = rfqById.get(String(q.rfqId));
      const qd = fmt.date(q.createdAt);
      const rd = fmt.date(rfq?.createdAt);
      if (!qd || !rd) return;
      const ms = qd.getTime() - rd.getTime();
      if (ms >= 0) {
        latSum += ms;
        latN += 1;
      }
    });
    totals.avgQuoteLatencyMs = latN > 0 ? latSum / latN : 0;

    // fully allocated RFQs (based on allocations within filtered window)
    const allocByRfq = new Map<string, number>();
    filteredAllocations.forEach((a: AnyRecord) => {
      const rid = String(a.rfqId);
      const n =
        fmt.num(a.containersAllottedHome) + fmt.num(a.containersAllottedMOOWR);
      allocByRfq.set(rid, (allocByRfq.get(rid) || 0) + n);
    });

    filteredRFQs.forEach((r: AnyRecord) => {
      const rid = String(r.id);
      const req = fmt.num(r.numberOfContainers);
      const got = allocByRfq.get(rid) || 0;
      if (req > 0 && got >= req) totals.fullyAllocatedRFQs += 1;
    });

    // best possible cost lower bound (very conservative):
    // For each RFQ: take min(homeTotal, mooWRTotal) across all quotes, multiply by requested containers.
    // This is not the real optimum (since schemes differ), but gives a strong "best-case" benchmark.
    let lowerBound = 0;
    filteredRFQs.forEach((r: AnyRecord) => {
      const rid = String(r.id);
      const req = fmt.num(r.numberOfContainers);
      const qs = quotesByRfq.get(rid) || [];
      if (!qs.length || req <= 0) return;
      let best = Infinity;
      qs.forEach((q: AnyRecord) => {
        const h = fmt.num(q.homeTotal);
        const m = fmt.num(q.mooWRTotal);
        const candidate = Math.min(h || Infinity, m || Infinity);
        if (Number.isFinite(candidate) && candidate < best) best = candidate;
      });
      if (Number.isFinite(best) && best !== Infinity) {
        lowerBound += best * req;
      }
    });

    totals.bestPossibleCostLowerBound = lowerBound;
    totals.savingsVsLowerBound =
      totals.bestPossibleCostLowerBound > 0
        ? Math.max(0, totals.allocationCost - totals.bestPossibleCostLowerBound)
        : 0;

    return totals;
  }, [
    filteredRFQs,
    filteredQuotes,
    filteredAllocations,
    fmt,
    quoteById,
    rfqById,
  ]);

  const statusData = React.useMemo(() => {
    const counts: Record<string, number> = {};
    filteredRFQs.forEach((r: AnyRecord) => {
      const k = String(r.status || "unknown");
      counts[k] = (counts[k] || 0) + 1;
    });
    const entries = Object.entries(counts)
      .map(([name, value], idx) => ({
        name,
        value,
        color: palette[idx % palette.length],
      }))
      .sort((a, b) => b.value - a.value);
    return entries;
  }, [filteredRFQs, palette]);

  const containerTypeData = React.useMemo(() => {
    const counts: Record<string, number> = {};
    filteredRFQs.forEach((r: AnyRecord) => {
      const k = String(r.containerType || "unknown");
      counts[k] = (counts[k] || 0) + fmt.num(r.numberOfContainers);
    });
    const entries = Object.entries(counts)
      .map(([name, value], idx) => ({
        name,
        value,
        color: palette[idx % palette.length],
      }))
      .sort((a, b) => b.value - a.value);
    return entries;
  }, [filteredRFQs, fmt, palette]);

  const topPortsLoading = React.useMemo(() => {
    const counts: Record<string, number> = {};
    filteredRFQs.forEach((r: AnyRecord) => {
      const k = String(r.portOfLoading || "unknown");
      counts[k] = (counts[k] || 0) + fmt.num(r.numberOfContainers);
    });
    return Object.entries(counts)
      .map(([name, value], idx) => ({
        name,
        value,
        color: palette[idx % palette.length],
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredRFQs, fmt, palette]);

  const topPortsDestination = React.useMemo(() => {
    const counts: Record<string, number> = {};
    filteredRFQs.forEach((r: AnyRecord) => {
      const k = String(r.portOfDestination || "unknown");
      counts[k] = (counts[k] || 0) + fmt.num(r.numberOfContainers);
    });
    return Object.entries(counts)
      .map(([name, value], idx) => ({
        name,
        value,
        color: palette[idx % palette.length],
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredRFQs, fmt, palette]);

  const vendorParticipation = React.useMemo(() => {
    const counts: Record<string, number> = {};
    filteredQuotes.forEach((q: AnyRecord) => {
      const k = String(q.vendorName || "unknown");
      counts[k] = (counts[k] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value], idx) => ({
        name,
        value,
        color: palette[idx % palette.length],
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }, [filteredQuotes, palette]);

  const vendorWinShare = React.useMemo(() => {
    // containers won + spend by vendor from allocations
    const byVendor: Record<
      string,
      { vendor: string; containers: number; spend: number; avg: number }
    > = {};

    filteredAllocations.forEach((a: AnyRecord) => {
      const q = quoteById.get(String(a.quoteId));
      const vendor = String(q?.vendorName || "unknown");

      const homeQty = fmt.num(a.containersAllottedHome);
      const moowrQty = fmt.num(a.containersAllottedMOOWR);
      const containers = homeQty + moowrQty;

      const homeRate = fmt.num(q?.homeTotal);
      const moowrRate = fmt.num(q?.mooWRTotal);
      const spend = homeQty * homeRate + moowrQty * moowrRate;

      if (!byVendor[vendor]) {
        byVendor[vendor] = { vendor, containers: 0, spend: 0, avg: 0 };
      }
      byVendor[vendor].containers += containers;
      byVendor[vendor].spend += spend;
    });

    const rows = Object.values(byVendor)
      .map((r) => ({
        ...r,
        avg: r.containers > 0 ? r.spend / r.containers : 0,
      }))
      .sort((a, b) => b.containers - a.containers)
      .slice(0, 12);

    return rows;
  }, [filteredAllocations, quoteById, fmt]);

  const allocationCoverageByStatus = React.useMemo(() => {
    const allocByRfq = new Map<string, number>();
    filteredAllocations.forEach((a: AnyRecord) => {
      const rid = String(a.rfqId);
      const n =
        fmt.num(a.containersAllottedHome) + fmt.num(a.containersAllottedMOOWR);
      allocByRfq.set(rid, (allocByRfq.get(rid) || 0) + n);
    });

    const byStatus: Record<
      string,
      { status: string; requested: number; allocated: number; pending: number }
    > = {};

    filteredRFQs.forEach((r: AnyRecord) => {
      const status = String(r.status || "unknown");
      const req = fmt.num(r.numberOfContainers);
      const got = allocByRfq.get(String(r.id)) || 0;

      if (!byStatus[status]) {
        byStatus[status] = { status, requested: 0, allocated: 0, pending: 0 };
      }
      byStatus[status].requested += req;
      byStatus[status].allocated += Math.min(req, got);
      byStatus[status].pending += Math.max(0, req - got);
    });

    return Object.values(byStatus).sort((a, b) => b.requested - a.requested);
  }, [filteredRFQs, filteredAllocations, fmt]);

  const trendMonthly = React.useMemo(() => {
    const monthBuckets: Record<
      string,
      {
        name: string;
        rfqs: number;
        quotes: number;
        requested: number;
        allocated: number;
        spend: number;
      }
    > = {};

    const addMonth = (key: string) => {
      if (!monthBuckets[key]) {
        monthBuckets[key] = {
          name: key,
          rfqs: 0,
          quotes: 0,
          requested: 0,
          allocated: 0,
          spend: 0,
        };
      }
      return monthBuckets[key];
    };

    filteredRFQs.forEach((r: AnyRecord) => {
      const d = fmt.date(r.createdAt);
      if (!d) return;
      const k = fmt.monthKey(d);
      const b = addMonth(k);
      b.rfqs += 1;
      b.requested += fmt.num(r.numberOfContainers);
    });

    filteredQuotes.forEach((q: AnyRecord) => {
      const d = fmt.date(q.createdAt);
      if (!d) return;
      const k = fmt.monthKey(d);
      const b = addMonth(k);
      b.quotes += 1;
    });

    filteredAllocations.forEach((a: AnyRecord) => {
      const rfq = rfqById.get(String(a.rfqId));
      const d = fmt.date(a.createdAt) || fmt.date(rfq?.createdAt);
      if (!d) return;
      const k = fmt.monthKey(d);
      const b = addMonth(k);

      const q = quoteById.get(String(a.quoteId));
      const homeQty = fmt.num(a.containersAllottedHome);
      const moowrQty = fmt.num(a.containersAllottedMOOWR);
      const homeRate = fmt.num(q?.homeTotal);
      const moowrRate = fmt.num(q?.mooWRTotal);
      b.allocated += homeQty + moowrQty;
      b.spend += homeQty * homeRate + moowrQty * moowrRate;
    });

    return Object.values(monthBuckets).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [
    filteredRFQs,
    filteredQuotes,
    filteredAllocations,
    fmt,
    rfqById,
    quoteById,
  ]);

  const quoteLatencyBuckets = React.useMemo(() => {
    const buckets = [
      { name: "< 6h", value: 0 },
      { name: "6–24h", value: 0 },
      { name: "1–3d", value: 0 },
      { name: "3–7d", value: 0 },
      { name: "> 7d", value: 0 },
    ];

    filteredQuotes.forEach((q: AnyRecord) => {
      const rfq = rfqById.get(String(q.rfqId));
      const qd = fmt.date(q.createdAt);
      const rd = fmt.date(rfq?.createdAt);
      if (!qd || !rd) return;

      const hours = (qd.getTime() - rd.getTime()) / (1000 * 60 * 60);
      if (hours < 0) return;

      if (hours < 6) buckets[0].value += 1;
      else if (hours < 24) buckets[1].value += 1;
      else if (hours < 24 * 3) buckets[2].value += 1;
      else if (hours < 24 * 7) buckets[3].value += 1;
      else buckets[4].value += 1;
    });

    return buckets;
  }, [filteredQuotes, rfqById, fmt]);

  const leafiFollowVsDeviate = React.useMemo(() => {
    // If allocation.reason exists => deviation (strong signal).
    // Otherwise, assume "followed" (best available signal without re-running optimizer here).
    let followed = 0;
    let deviated = 0;

    filteredAllocations.forEach((a: AnyRecord) => {
      const hasReason = String(a?.reason || "").trim().length > 0;
      if (hasReason) deviated += 1;
      else followed += 1;
    });

    return [
      { name: "Followed (no reason)", value: followed, color: "#10b981" },
      { name: "Deviated (has reason)", value: deviated, color: "#ef4444" },
    ];
  }, [filteredAllocations]);

  const exportCSV = React.useCallback(() => {
    const rows: string[][] = [];

    rows.push(["Metric", "Value"]);
    rows.push(["Total RFQs", String(aggregation.rfqs)]);
    rows.push(["Total Quotes", String(aggregation.quotes)]);
    rows.push(["Total Allocations", String(aggregation.allocations)]);
    rows.push([
      "Requested Containers",
      String(aggregation.requestedContainers),
    ]);
    rows.push([
      "Allocated Containers",
      String(aggregation.allocatedContainers),
    ]);
    rows.push(["Pending Containers", String(aggregation.pendingContainers)]);
    rows.push(["Fully Allocated RFQs", String(aggregation.fullyAllocatedRFQs)]);
    rows.push([
      "Avg Quotes per RFQ",
      String(aggregation.avgQuotesPerRFQ.toFixed(2)),
    ]);
    rows.push([
      "Avg Quote Latency",
      fmt.humanDays(aggregation.avgQuoteLatencyMs),
    ]);
    rows.push(["Allocation Spend", String(aggregation.allocationCost)]);
    rows.push([
      "Avg Cost per Allocated Container",
      String(aggregation.avgCostPerAllocatedContainer),
    ]);
    rows.push([
      "Best-Case Benchmark (Lower Bound)",
      String(aggregation.bestPossibleCostLowerBound),
    ]);
    rows.push([
      "Spend Above Benchmark",
      String(aggregation.savingsVsLowerBound),
    ]);

    rows.push([]);
    rows.push(["Top Vendors (Participation)"]);
    rows.push(["Vendor", "Quotes"]);
    vendorParticipation.forEach((v) =>
      rows.push([String(v.name), String(v.value)])
    );

    rows.push([]);
    rows.push(["Top Vendors (Allocated Containers)"]);
    rows.push(["Vendor", "Containers", "Spend", "Avg/Container"]);
    vendorWinShare.forEach((v) =>
      rows.push([
        v.vendor,
        String(v.containers),
        String(v.spend),
        String(v.avg),
      ])
    );

    const csv = rows
      .map((r) =>
        r
          .map((c) => {
            const s = String(c ?? "");
            const escaped = s.replace(/"/g, '""');
            return `"${escaped}"`;
          })
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics_export_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [aggregation, fmt, vendorParticipation, vendorWinShare]);

  const resetFilters = React.useCallback(() => {
    applyPreset("30d");
    setStatusFilter("all");
    setContainerTypeFilter("all");
    setPolFilter("all");
    setPodFilter("all");
    setVendorFilter("all");
  }, [applyPreset]);

  const headerRangeLabel = React.useMemo(() => {
    if (rangePreset === "all") return "All time";
    if (rangePreset !== "custom") {
      if (rangePreset === "7d") return "Last 7 days";
      if (rangePreset === "30d") return "Last 30 days";
      if (rangePreset === "90d") return "Last 90 days";
      if (rangePreset === "ytd") return "Year to date";
    }
    return `${from} → ${to}`;
  }, [rangePreset, from, to]);

  const chartConfigCommon = React.useMemo(() => {
    return {
      value: { label: "Value", color: palette[0] },
      rfqs: { label: "RFQs", color: palette[0] },
      quotes: { label: "Quotes", color: palette[1] },
      requested: { label: "Requested", color: palette[2] },
      allocated: { label: "Allocated", color: palette[1] },
      pending: { label: "Pending", color: palette[3] },
      spend: { label: "Spend", color: palette[4] },
    };
  }, [palette]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className="font-semibold">
              Analytics
            </Badge>
            <span>•</span>
            <span className="font-medium">{headerRangeLabel}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={resetFilters}>
            <RefreshCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <Button variant="outline" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Range</div>
            <Select
              value={rangePreset}
              onValueChange={(v: any) => applyPreset(v)}
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

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Status</div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {allStatuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Container Type</div>
            <Select
              value={containerTypeFilter}
              onValueChange={setContainerTypeFilter}
            >
              <SelectTrigger>
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {allContainerTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Vendor</div>
            <Select value={vendorFilter} onValueChange={setVendorFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All vendors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {allVendors.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Port of Loading</div>
            <Select value={polFilter} onValueChange={setPolFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All POL" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {allPOL.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              Port of Destination
            </div>
            <Select value={podFilter} onValueChange={setPodFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All POD" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {allPOD.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden lg:block" />
          <div className="hidden lg:block" />
          <div className="hidden lg:block" />
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">RFQs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">{aggregation.rfqs}</div>
                <div className="text-xs text-muted-foreground">
                  {aggregation.fullyAllocatedRFQs} fully allocated
                </div>
              </div>
              <FileHeart className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Quotes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">{aggregation.quotes}</div>
                <div className="text-xs text-muted-foreground">
                  Avg {Number(aggregation.avgQuotesPerRFQ).toFixed(2)} / RFQ
                </div>
              </div>
              <ChartLine className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Containers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">
                  {aggregation.allocatedContainers}/
                  {aggregation.requestedContainers}
                </div>
                <div className="text-xs text-muted-foreground">
                  {aggregation.pendingContainers} pending
                </div>
              </div>
              <ContainerIcon className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Spend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">
                  {fmt.money(aggregation.allocationCost)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Avg {fmt.money(aggregation.avgCostPerAllocatedContainer)} /
                  container
                </div>
              </div>
              <Ship className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="ports">Ports</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Status Pie */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ChartPie className="h-5 w-5" />
                  RFQ Status Distribution
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[320px]">
                <ChartContainer
                  config={chartConfigCommon}
                  className="h-full w-full"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={95}
                        labelLine={false}
                        label={({ name, percent }) =>
                          `${String(name)} ${Number(percent * 100).toFixed(0)}%`
                        }
                      >
                        {statusData.map((entry, idx) => (
                          <Cell key={`status-${idx}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Container Types */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ContainerIcon className="h-5 w-5" />
                  Containers by Type
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[320px]">
                <ChartContainer
                  config={chartConfigCommon}
                  className="h-full w-full"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={containerTypeData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="name"
                        interval={0}
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <Bar dataKey="value" name="Containers">
                        {containerTypeData.map((entry, idx) => (
                          <Cell key={`ctype-${idx}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          {/* Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ChartLine className="h-5 w-5" />
                Monthly Trends
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[340px]">
              <ChartContainer
                config={chartConfigCommon}
                className="h-full w-full"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendMonthly}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="name"
                      interval="preserveStartEnd"
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="requested"
                      name="Requested Containers"
                      fill={palette[2]}
                      stroke={palette[2]}
                      fillOpacity={0.25}
                    />
                    <Area
                      type="monotone"
                      dataKey="allocated"
                      name="Allocated Containers"
                      fill={palette[1]}
                      stroke={palette[1]}
                      fillOpacity={0.25}
                    />
                    <Line
                      type="monotone"
                      dataKey="rfqs"
                      name="RFQs"
                      stroke={palette[0]}
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="quotes"
                      name="Quotes"
                      stroke={palette[4]}
                      strokeWidth={2}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Coverage by Status + Benchmark */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Allocation Coverage by Status
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[320px]">
                <ChartContainer
                  config={chartConfigCommon}
                  className="h-full w-full"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={allocationCoverageByStatus}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="status"
                        interval={0}
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <Bar
                        dataKey="allocated"
                        name="Allocated"
                        stackId="a"
                        fill={palette[1]}
                      />
                      <Bar
                        dataKey="pending"
                        name="Pending"
                        stackId="a"
                        fill={palette[3]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5" />
                  Spend vs Best-Case Benchmark
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 gap-3">
                  <div className="flex items-center justify-between rounded border p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Ship className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        Actual Spend
                      </span>
                    </div>
                    <div className="font-semibold">
                      {fmt.money(aggregation.allocationCost)}
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded border p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <ChartLine className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        Best-Case Lower Bound
                      </span>
                    </div>
                    <div className="font-semibold">
                      {fmt.money(aggregation.bestPossibleCostLowerBound)}
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded border p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <TrendingDown className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        Above Benchmark
                      </span>
                    </div>
                    <div className="font-semibold">
                      {fmt.money(aggregation.savingsVsLowerBound)}
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Note: The benchmark is a conservative best-case estimate
                    using the minimum of (HOME, MOOWR) totals across quotes per
                    RFQ, scaled by requested containers. It’s meant as a
                    directional indicator—not the exact optimal allocation.
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* VENDORS */}
        <TabsContent value="vendors" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Vendor Participation (Top 12)
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[340px]">
                <ChartContainer
                  config={chartConfigCommon}
                  className="h-full w-full"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={vendorParticipation}
                      layout="vertical"
                      margin={{ left: 24 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={160}
                        tick={{ fontSize: 12 }}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <Bar dataKey="value" name="Quotes" fill={palette[4]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Ship className="h-5 w-5" />
                  Vendor Win Share (Allocated Containers)
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[340px]">
                <ChartContainer
                  config={chartConfigCommon}
                  className="h-full w-full"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={vendorWinShare}
                      layout="vertical"
                      margin={{ left: 24 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis
                        type="category"
                        dataKey="vendor"
                        width={160}
                        tick={{ fontSize: 12 }}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value: any, name: any, item: any) => {
                              if (String(name) === "spend")
                                return [fmt.money(value), "Spend"];
                              if (String(name) === "avg")
                                return [fmt.money(value), "Avg/Container"];
                              return [String(value), String(name)];
                            }}
                          />
                        }
                      />
                      <Legend />
                      <Bar
                        dataKey="containers"
                        name="Containers"
                        fill={palette[1]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Vendor Leaders Table
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4">Vendor</th>
                    <th className="py-2 pr-4">Allocated Containers</th>
                    <th className="py-2 pr-4">Spend</th>
                    <th className="py-2 pr-4">Avg / Container</th>
                  </tr>
                </thead>
                <tbody>
                  {vendorWinShare.length ? (
                    vendorWinShare.map((v) => (
                      <tr key={v.vendor} className="border-b">
                        <td className="py-2 pr-4 font-medium">{v.vendor}</td>
                        <td className="py-2 pr-4">{v.containers}</td>
                        <td className="py-2 pr-4">{fmt.money(v.spend)}</td>
                        <td className="py-2 pr-4">{fmt.money(v.avg)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="py-6 text-muted-foreground" colSpan={4}>
                        No allocation data available for the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PORTS */}
        <TabsContent value="ports" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Top Ports of Loading (by Containers)
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[340px]">
                <ChartContainer
                  config={chartConfigCommon}
                  className="h-full w-full"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={topPortsLoading}
                      layout="vertical"
                      margin={{ left: 24 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={160}
                        tick={{ fontSize: 12 }}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <Bar dataKey="value" name="Containers">
                        {topPortsLoading.map((e, idx) => (
                          <Cell key={`pol-${idx}`} fill={e.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Top Ports of Destination (by Containers)
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[340px]">
                <ChartContainer
                  config={chartConfigCommon}
                  className="h-full w-full"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={topPortsDestination}
                      layout="vertical"
                      margin={{ left: 24 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={160}
                        tick={{ fontSize: 12 }}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <Bar dataKey="value" name="Containers">
                        {topPortsDestination.map((e, idx) => (
                          <Cell key={`pod-${idx}`} fill={e.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* PERFORMANCE */}
        <TabsContent value="performance" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Quote Response Time (Distribution)
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[320px]">
                <ChartContainer
                  config={chartConfigCommon}
                  className="h-full w-full"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={quoteLatencyBuckets}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="name"
                        interval={0}
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <Bar dataKey="value" name="Quotes" fill={palette[0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ChartPie className="h-5 w-5" />
                  LEAFI Follow vs Deviation (Signal)
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[320px]">
                <ChartContainer
                  config={chartConfigCommon}
                  className="h-full w-full"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={leafiFollowVsDeviate}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={95}
                        labelLine={false}
                        label={({ name, percent }) =>
                          `${String(name)} ${Number(percent * 100).toFixed(0)}%`
                        }
                      >
                        {leafiFollowVsDeviate.map((entry, idx) => (
                          <Cell key={`leafi-${idx}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <div className="mt-3 text-xs text-muted-foreground">
                  This uses a pragmatic signal: allocations with a non-empty
                  “reason” are treated as deviations. If you want exact “follow
                  vs deviate”, we can mirror the optimizer’s recommendation per
                  RFQ and compare the finalized allocation against it.
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Ops KPIs
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">
                  Avg quote response time
                </div>
                <div className="text-lg font-semibold">
                  {fmt.humanDays(aggregation.avgQuoteLatencyMs)}
                </div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">
                  Fully allocated RFQ rate
                </div>
                <div className="text-lg font-semibold">
                  {aggregation.rfqs > 0
                    ? fmt.pct(aggregation.fullyAllocatedRFQs / aggregation.rfqs)
                    : "0%"}
                </div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">
                  Allocation completion
                </div>
                <div className="text-lg font-semibold">
                  {aggregation.requestedContainers > 0
                    ? fmt.pct(
                        aggregation.allocatedContainers /
                          aggregation.requestedContainers
                      )
                    : "0%"}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminDashboard;
