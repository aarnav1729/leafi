import React, { useEffect, useMemo, useState } from "react";

type ReportRow = {
  portOfLoading: string;
  containerType: string; // (previously labeled as Vehicle Type)
  containersQty: number;
  oceanFreightUsd: number;
  quoteDate: string; // ISO
};

function fmtUsd(v: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function fmtDate(d: string) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function ReportsPage() {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  // ✅ Filters
  const [portFilter, setPortFilter] = useState<string>("");
  const [containerFilter, setContainerFilter] = useState<string>("");

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
  }, []);

  // ✅ Build dropdown options from loaded data
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

  // ✅ Filtered view (Port + Container Type)
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

  const hasRows = filteredRows.length > 0;

  const titleRight = useMemo(() => {
    if (loading) return "Loading…";
    if (err) return "Error";
    const active =
      (portFilter ? 1 : 0) + (containerFilter ? 1 : 0);
    return active
      ? `${filteredRows.length} row(s) (of ${rows.length})`
      : `${rows.length} row(s)`;
  }, [loading, err, rows.length, filteredRows.length, portFilter, containerFilter]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Ocean freight (USD): Latest 3 quotes per Port of Loading & Container Type
          </p>
        </div>

        {/* ✅ Filters + count */}
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
        </div>
      </div>

      <div className="rounded-xl border bg-background overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="p-3 font-semibold">Port of Loading</th>
                <th className="p-3 font-semibold">Container Type</th>
                <th className="p-3 font-semibold">Containers Qty</th>
                <th className="p-3 font-semibold text-wrap">
                  Ocean Freight / Container (in $) 
                </th>
                <th className="p-3 font-semibold">Date of Quote</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td className="p-3" colSpan={5}>
                    Loading…
                  </td>
                </tr>
              ) : err ? (
                <tr>
                  <td className="p-3 text-red-600" colSpan={5}>
                    {err}
                  </td>
                </tr>
              ) : !hasRows ? (
                <tr>
                  <td className="p-3" colSpan={5}>
                    No data available.
                  </td>
                </tr>
              ) : (
                filteredRows.map((r, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="p-3">{r.portOfLoading || "—"}</td>
                    <td className="p-3">{r.containerType || "—"}</td>
                    <td className="p-3">{Number(r.containersQty || 0)}</td>
                    <td className="p-3">{fmtUsd(Number(r.oceanFreightUsd))}</td>
                    <td className="p-3">{fmtDate(r.quoteDate)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
