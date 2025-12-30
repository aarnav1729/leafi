// root/src/pages/logistics/Masters.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";

type MasterKey =
  | "itemDescriptions"
  | "companyNames"
  | "suppliers"
  | "portsOfLoading"
  | "portsOfDestination"
  | "containerTypes";

type MasterRow = {
  id: string;
  value: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string | null;
};

type MasterMeta = {
  key: MasterKey;
  label: string;
  helper?: string;
  multiline?: boolean;
  maxHint?: string;
};
type TransporterRow = {
  id: string;
  vendorCode: string;
  vendorName: string;
  vendorEmail: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string | null;
};

const FALLBACK_META: MasterMeta[] = [
  {
    key: "itemDescriptions",
    label: "Item Descriptions",
    helper: "Used in RFQ create modal → Item Description",
    multiline: false,
    maxHint: "Up to 500 chars",
  },
  {
    key: "companyNames",
    label: "Company Names",
    helper: "Used in RFQ create modal → Company Name (supports multi-line)",
    multiline: true,
    maxHint: "No practical limit (NVARCHAR(MAX))",
  },
  {
    key: "suppliers",
    label: "Suppliers",
    helper: "Used in RFQ create modal → Supplier Name",
    multiline: false,
    maxHint: "Up to 255 chars",
  },
  {
    key: "portsOfLoading",
    label: "Ports of Loading",
    helper: "Used in RFQ create modal → Port of Loading",
    multiline: false,
    maxHint: "Up to 100 chars",
  },
  {
    key: "portsOfDestination",
    label: "Ports of Destination",
    helper: "Used in RFQ create modal → Port of Destination",
    multiline: false,
    maxHint: "Up to 100 chars",
  },
  {
    key: "containerTypes",
    label: "Container Types",
    helper: "Used in RFQ create modal → Container Type",
    multiline: false,
    maxHint: "Up to 50 chars",
  },
];

function normalizeValue(v: string) {
  // keep newlines if any, just trim outside
  return String(v ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

const Masters: React.FC = () => {
  const [meta, setMeta] = useState<MasterMeta[]>(FALLBACK_META);
  const [transporters, setTransporters] = useState<TransporterRow[]>([]);
  const [transportersLoading, setTransportersLoading] = useState(false);
  const [transportersQuery, setTransportersQuery] = useState("");

  const [transporterAddOpen, setTransporterAddOpen] = useState(false);
  const [newTransporterCode, setNewTransporterCode] = useState("");
  const [newTransporterName, setNewTransporterName] = useState("");
  const [newTransporterEmail, setNewTransporterEmail] = useState("");
  const [newTransporterIsActive, setNewTransporterIsActive] = useState(true);

  const [editingTransporter, setEditingTransporter] =
    useState<TransporterRow | null>(null);

  const [rowsByKey, setRowsByKey] = useState<Record<string, MasterRow[]>>({});
  const [loadingByKey, setLoadingByKey] = useState<Record<string, boolean>>({});
  const [queryByKey, setQueryByKey] = useState<Record<string, string>>({});

  // Add dialog state per master
  const [addOpenKey, setAddOpenKey] = useState<MasterKey | null>(null);
  const [newValue, setNewValue] = useState("");
  const [newIsActive, setNewIsActive] = useState(true);

  // Edit state
  const [editing, setEditing] = useState<{
    key: MasterKey;
    id: string;
    value: string;
    isActive: boolean;
  } | null>(null);

  const setLoading = (key: MasterKey, v: boolean) => {
    setLoadingByKey((p) => ({ ...p, [key]: v }));
  };

  const fetchMeta = useCallback(async () => {
    // Optional endpoint; if not present, fallback_meta is used.
    try {
      const res = await api.get<{ key: MasterKey; label: string }[]>(
        "/admin/masters"
      );
      if (Array.isArray(res.data) && res.data.length) {
        // Merge server meta with fallback hints (multiline/helper/maxHint)
        const merged = res.data.map((m) => {
          const f = FALLBACK_META.find((x) => x.key === m.key);
          return {
            key: m.key,
            label: m.label || f?.label || String(m.key),
            helper: f?.helper,
            multiline: f?.multiline,
            maxHint: f?.maxHint,
          } as MasterMeta;
        });
        setMeta(merged);
      }
    } catch {
      // ignore - endpoint might not exist; fallback is fine
    }
  }, []);

  const fetchRows = useCallback(async (key: MasterKey) => {
    setLoading(key, true);
    try {
      const res = await api.get<MasterRow[]>(`/admin/masters/${key}`);
      setRowsByKey((p) => ({ ...p, [key]: res.data || [] }));
    } catch (err: any) {
      console.error("Failed to load master:", key, err);
      toast({
        title: "Failed to load",
        description: `Could not load ${key}`,
        variant: "destructive",
      });
    } finally {
      setLoading(key, false);
    }
  }, []);

  const fetchTransporters = useCallback(async () => {
    setTransportersLoading(true);
    try {
      const res = await api.get<TransporterRow[]>("/admin/transporters");
      setTransporters(res.data || []);
    } catch (err: any) {
      console.error("Failed to load transporters", err);
      toast({
        title: "Failed to load",
        description: "Could not load transporter master",
        variant: "destructive",
      });
    } finally {
      setTransportersLoading(false);
    }
  }, []);

  const filteredTransporters = useMemo(() => {
    const q = transportersQuery.trim().toLowerCase();
    if (!q) return transporters;
    return transporters.filter((t) => {
      const a = `${t.vendorCode} ${t.vendorName} ${
        t.vendorEmail || ""
      }`.toLowerCase();
      return a.includes(q);
    });
  }, [transporters, transportersQuery]);

  const refreshAll = useCallback(async () => {
    await Promise.all(meta.map((m) => fetchRows(m.key)));
  }, [meta, fetchRows]);

  useEffect(() => {
    fetchMeta().finally(() => {
      // load everything once
      Promise.all(FALLBACK_META.map((m) => fetchRows(m.key))).catch(() => {});
      fetchTransporters().catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openAdd = (key: MasterKey) => {
    setAddOpenKey(key);
    setNewValue("");
    setNewIsActive(true);
  };

  const submitAdd = async () => {
    if (!addOpenKey) return;
    const key = addOpenKey;
    const v = normalizeValue(newValue);
    if (!v) {
      toast({
        title: "Value required",
        description: "Please enter a value.",
        variant: "destructive",
      });
      return;
    }

    try {
      await api.post(`/admin/masters/${key}`, {
        value: v,
        isActive: newIsActive,
      });
      toast({ title: "Created", description: "Master value added." });
      setAddOpenKey(null);
      setNewValue("");
      setNewIsActive(true);
      await fetchRows(key);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to create master value";
      toast({
        title: "Create failed",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const startEdit = (key: MasterKey, row: MasterRow) => {
    setEditing({
      key,
      id: row.id,
      value: row.value ?? "",
      isActive: !!row.isActive,
    });
  };

  const cancelEdit = () => setEditing(null);

  const saveEdit = async () => {
    if (!editing) return;

    const v = normalizeValue(editing.value);
    if (!v) {
      toast({
        title: "Value required",
        description: "Value cannot be empty.",
        variant: "destructive",
      });
      return;
    }

    try {
      await api.put(`/admin/masters/${editing.key}/${editing.id}`, {
        value: v,
        isActive: editing.isActive,
      });
      toast({ title: "Saved", description: "Changes updated." });
      const key = editing.key;
      setEditing(null);
      await fetchRows(key);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to update master value";
      toast({
        title: "Update failed",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const disableRow = async (key: MasterKey, id: string) => {
    const ok = window.confirm(
      "Disable this value? (It will be hidden from dropdowns)"
    );
    if (!ok) return;

    try {
      await api.delete(`/admin/masters/${key}/${id}`);
      toast({ title: "Disabled", description: "Value disabled." });
      await fetchRows(key);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to disable master value";
      toast({
        title: "Disable failed",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const enableRow = async (key: MasterKey, row: MasterRow) => {
    // enable by PUT isActive=true
    try {
      await api.put(`/admin/masters/${key}/${row.id}`, { isActive: true });
      toast({ title: "Enabled", description: "Value enabled." });
      await fetchRows(key);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to enable master value";
      toast({
        title: "Enable failed",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const filteredRows = useCallback(
    (key: MasterKey) => {
      const rows = rowsByKey[key] || [];
      const q = (queryByKey[key] || "").trim().toLowerCase();
      if (!q) return rows;
      return rows.filter((r) =>
        String(r.value || "")
          .toLowerCase()
          .includes(q)
      );
    },
    [rowsByKey, queryByKey]
  );

  const totalCounts = useMemo(() => {
    const out: Record<string, { total: number; active: number }> = {};
    for (const m of meta) {
      const rows = rowsByKey[m.key] || [];
      out[m.key] = {
        total: rows.length,
        active: rows.filter((r) => !!r.isActive).length,
      };
    }
    return out;
  }, [meta, rowsByKey]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Masters</h1>
          <p className="text-sm text-muted-foreground">
            Manage dropdown master values used across RFQ flows.
          </p>
        </div>

        <Button variant="outline" onClick={refreshAll}>
          Refresh All
        </Button>
      </div>

      <Accordion type="multiple" defaultValue={[]}>
        <AccordionItem value="transporters">
          <AccordionTrigger>
            <div className="flex items-center justify-between w-full pr-3">
              <div className="text-left">
                <div className="font-semibold">Transporter Master</div>
                <div className="text-xs text-muted-foreground">
                  Freight vendor options (code + name + email for notifications)
                </div>
              </div>
              <div className="text-xs text-muted-foreground hidden sm:block">
                Used in RFQ → vendor selection + email notifications
              </div>
            </div>
          </AccordionTrigger>

          <AccordionContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <Label className="sr-only">Search</Label>
                  <Input
                    placeholder="Search code / name / email..."
                    value={transportersQuery}
                    onChange={(e) => setTransportersQuery(e.target.value)}
                  />
                </div>

                <Dialog
                  open={transporterAddOpen}
                  onOpenChange={setTransporterAddOpen}
                >
                  <DialogTrigger asChild>
                    <Button
                      onClick={() => {
                        setNewTransporterCode("");
                        setNewTransporterName("");
                        setNewTransporterEmail("");
                        setNewTransporterIsActive(true);
                        setTransporterAddOpen(true);
                      }}
                    >
                      + Add
                    </Button>
                  </DialogTrigger>

                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Add Transporter</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Vendor Code</Label>
                          <Input
                            value={newTransporterCode}
                            onChange={(e) =>
                              setNewTransporterCode(e.target.value)
                            }
                            placeholder="e.g., VENDORA"
                          />
                          <p className="text-xs text-muted-foreground">
                            This is what gets stored in RFQ vendors array.
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label>Vendor Name</Label>
                          <Input
                            value={newTransporterName}
                            onChange={(e) =>
                              setNewTransporterName(e.target.value)
                            }
                            placeholder="e.g., Vendor A Logistics"
                          />
                        </div>

                        <div className="space-y-2 sm:col-span-2">
                          <Label>Vendor Email (optional)</Label>
                          <Input
                            value={newTransporterEmail}
                            onChange={(e) =>
                              setNewTransporterEmail(e.target.value)
                            }
                            placeholder="e.g., vendora@premierenergies.com"
                          />
                          <p className="text-xs text-muted-foreground">
                            Used for RFQ notifications. Leave empty if not
                            needed.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border rounded-md p-3">
                        <div>
                          <div className="font-medium text-sm">Active</div>
                          <div className="text-xs text-muted-foreground">
                            Only active transporters appear as options
                          </div>
                        </div>
                        <Switch
                          checked={newTransporterIsActive}
                          onCheckedChange={setNewTransporterIsActive}
                        />
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={() => setTransporterAddOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={async () => {
                            const vendorCode = newTransporterCode.trim();
                            const vendorName = newTransporterName.trim();
                            const vendorEmail = newTransporterEmail.trim();

                            if (!vendorCode || !vendorName) {
                              toast({
                                title: "Missing fields",
                                description:
                                  "Vendor Code and Vendor Name are required.",
                                variant: "destructive",
                              });
                              return;
                            }

                            try {
                              await api.post("/admin/transporters", {
                                vendorCode,
                                vendorName,
                                vendorEmail: vendorEmail || null,
                                isActive: newTransporterIsActive,
                              });
                              toast({
                                title: "Created",
                                description: "Transporter added.",
                              });
                              setTransporterAddOpen(false);
                              await fetchTransporters();
                            } catch (err: any) {
                              const msg =
                                err?.response?.data?.message ||
                                err?.message ||
                                "Failed to create transporter";
                              toast({
                                title: "Create failed",
                                description: msg,
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          Create
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                <Button
                  variant="outline"
                  onClick={fetchTransporters}
                  disabled={transportersLoading}
                >
                  {transportersLoading ? "Loading..." : "Refresh"}
                </Button>
              </div>

              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left">
                      <th className="p-3 w-[160px]">Code</th>
                      <th className="p-3">Name</th>
                      <th className="p-3">Email</th>
                      <th className="p-3 w-[120px]">Active</th>
                      <th className="p-3 w-[220px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transportersLoading ? (
                      <tr>
                        <td className="p-3" colSpan={5}>
                          Loading...
                        </td>
                      </tr>
                    ) : filteredTransporters.length === 0 ? (
                      <tr>
                        <td className="p-3 text-muted-foreground" colSpan={5}>
                          No transporters found.
                        </td>
                      </tr>
                    ) : (
                      filteredTransporters.map((t) => {
                        const isEditing = editingTransporter?.id === t.id;
                        const et = isEditing ? editingTransporter! : t;

                        return (
                          <tr
                            key={t.id}
                            className="border-b last:border-b-0 align-top"
                          >
                            <td className="p-3">
                              {isEditing ? (
                                <Input
                                  value={et.vendorCode}
                                  onChange={(e) =>
                                    setEditingTransporter((p) =>
                                      p
                                        ? { ...p, vendorCode: e.target.value }
                                        : p
                                    )
                                  }
                                />
                              ) : (
                                <div className="font-mono">{t.vendorCode}</div>
                              )}
                            </td>

                            <td className="p-3">
                              {isEditing ? (
                                <Input
                                  value={et.vendorName}
                                  onChange={(e) =>
                                    setEditingTransporter((p) =>
                                      p
                                        ? { ...p, vendorName: e.target.value }
                                        : p
                                    )
                                  }
                                />
                              ) : (
                                <div className="break-words">
                                  {t.vendorName}
                                </div>
                              )}
                            </td>

                            <td className="p-3">
                              {isEditing ? (
                                <Input
                                  value={et.vendorEmail || ""}
                                  onChange={(e) =>
                                    setEditingTransporter((p) =>
                                      p
                                        ? {
                                            ...p,
                                            vendorEmail: e.target.value || null,
                                          }
                                        : p
                                    )
                                  }
                                />
                              ) : (
                                <div className="break-words text-muted-foreground">
                                  {t.vendorEmail || "—"}
                                </div>
                              )}
                            </td>

                            <td className="p-3">
                              {isEditing ? (
                                <Switch
                                  checked={!!et.isActive}
                                  onCheckedChange={(v) =>
                                    setEditingTransporter((p) =>
                                      p ? { ...p, isActive: v } : p
                                    )
                                  }
                                />
                              ) : (
                                <div className="flex items-center gap-2">
                                  <div
                                    className={`h-2.5 w-2.5 rounded-full ${
                                      t.isActive
                                        ? "bg-green-500"
                                        : "bg-gray-400"
                                    }`}
                                  />
                                  <span>{t.isActive ? "Yes" : "No"}</span>
                                </div>
                              )}
                            </td>

                            <td className="p-3">
                              {isEditing ? (
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    onClick={async () => {
                                      try {
                                        await api.put(
                                          `/admin/transporters/${et.id}`,
                                          {
                                            vendorCode: et.vendorCode.trim(),
                                            vendorName: et.vendorName.trim(),
                                            vendorEmail:
                                              (et.vendorEmail || "").trim() ||
                                              null,
                                            isActive: !!et.isActive,
                                          }
                                        );
                                        toast({
                                          title: "Saved",
                                          description: "Transporter updated.",
                                        });
                                        setEditingTransporter(null);
                                        await fetchTransporters();
                                      } catch (err: any) {
                                        const msg =
                                          err?.response?.data?.message ||
                                          err?.message ||
                                          "Failed to update transporter";
                                        toast({
                                          title: "Update failed",
                                          description: msg,
                                          variant: "destructive",
                                        });
                                      }
                                    }}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditingTransporter(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex gap-2 flex-wrap">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditingTransporter(t)}
                                  >
                                    Edit
                                  </Button>

                                  {t.isActive ? (
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      onClick={async () => {
                                        const ok = window.confirm(
                                          "Disable this transporter?"
                                        );
                                        if (!ok) return;
                                        try {
                                          await api.delete(
                                            `/admin/transporters/${t.id}`
                                          );
                                          toast({
                                            title: "Disabled",
                                            description:
                                              "Transporter disabled.",
                                          });
                                          await fetchTransporters();
                                        } catch (err: any) {
                                          const msg =
                                            err?.response?.data?.message ||
                                            err?.message ||
                                            "Failed to disable transporter";
                                          toast({
                                            title: "Disable failed",
                                            description: msg,
                                            variant: "destructive",
                                          });
                                        }
                                      }}
                                    >
                                      Disable
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      onClick={async () => {
                                        try {
                                          await api.put(
                                            `/admin/transporters/${t.id}`,
                                            { isActive: true }
                                          );
                                          toast({
                                            title: "Enabled",
                                            description: "Transporter enabled.",
                                          });
                                          await fetchTransporters();
                                        } catch (err: any) {
                                          const msg =
                                            err?.response?.data?.message ||
                                            err?.message ||
                                            "Failed to enable transporter";
                                          toast({
                                            title: "Enable failed",
                                            description: msg,
                                            variant: "destructive",
                                          });
                                        }
                                      }}
                                    >
                                      Enable
                                    </Button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-muted-foreground">
                Tip: Set Vendor Email for VENDORA/VENDORB so RFQ notifications
                go to the right transporter inbox.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        {meta.map((m) => {
          const counts = totalCounts[m.key] || { total: 0, active: 0 };
          const rows = filteredRows(m.key);
          const isLoading = !!loadingByKey[m.key];
          const multiline = !!m.multiline;

          return (
            <AccordionItem key={m.key} value={m.key}>
              <AccordionTrigger>
                <div className="flex items-center justify-between w-full pr-3">
                  <div className="text-left">
                    <div className="font-semibold">{m.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {counts.active}/{counts.total} active
                      {m.maxHint ? ` • ${m.maxHint}` : ""}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground hidden sm:block">
                    {m.helper || ""}
                  </div>
                </div>
              </AccordionTrigger>

              <AccordionContent>
                <div className="space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-[220px]">
                      <Label className="sr-only">Search</Label>
                      <Input
                        placeholder="Search..."
                        value={queryByKey[m.key] || ""}
                        onChange={(e) =>
                          setQueryByKey((p) => ({
                            ...p,
                            [m.key]: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <Dialog
                      open={addOpenKey === m.key}
                      onOpenChange={(o) => setAddOpenKey(o ? m.key : null)}
                    >
                      <DialogTrigger asChild>
                        <Button onClick={() => openAdd(m.key)}>+ Add</Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Add {m.label}</DialogTitle>
                        </DialogHeader>

                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Label>Value</Label>
                            {multiline ? (
                              <Textarea
                                value={newValue}
                                onChange={(e) => setNewValue(e.target.value)}
                                placeholder="Enter value..."
                                className="min-h-[140px]"
                              />
                            ) : (
                              <Input
                                value={newValue}
                                onChange={(e) => setNewValue(e.target.value)}
                                placeholder="Enter value..."
                              />
                            )}
                            <p className="text-xs text-muted-foreground">
                              Tip: Company Names can be multi-line; others are
                              typically single-line.
                            </p>
                          </div>

                          <div className="flex items-center justify-between border rounded-md p-3">
                            <div>
                              <div className="font-medium text-sm">Active</div>
                              <div className="text-xs text-muted-foreground">
                                Only active values appear in dropdowns
                              </div>
                            </div>
                            <Switch
                              checked={newIsActive}
                              onCheckedChange={setNewIsActive}
                            />
                          </div>

                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              onClick={() => setAddOpenKey(null)}
                            >
                              Cancel
                            </Button>
                            <Button onClick={submitAdd}>Create</Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>

                    <Button
                      variant="outline"
                      onClick={() => fetchRows(m.key)}
                      disabled={isLoading}
                    >
                      {isLoading ? "Loading..." : "Refresh"}
                    </Button>
                  </div>

                  <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr className="text-left">
                          <th className="p-3 w-[70%]">Value</th>
                          <th className="p-3 w-[120px]">Active</th>
                          <th className="p-3 w-[220px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {isLoading ? (
                          <tr>
                            <td className="p-3" colSpan={3}>
                              Loading...
                            </td>
                          </tr>
                        ) : rows.length === 0 ? (
                          <tr>
                            <td
                              className="p-3 text-muted-foreground"
                              colSpan={3}
                            >
                              No values found.
                            </td>
                          </tr>
                        ) : (
                          rows.map((r) => {
                            const isEditing =
                              editing?.key === m.key && editing?.id === r.id;
                            return (
                              <tr
                                key={r.id}
                                className="border-b last:border-b-0 align-top"
                              >
                                <td className="p-3">
                                  {isEditing ? (
                                    multiline ? (
                                      <Textarea
                                        value={editing.value}
                                        onChange={(e) =>
                                          setEditing((p) =>
                                            p
                                              ? { ...p, value: e.target.value }
                                              : p
                                          )
                                        }
                                        className="min-h-[120px] whitespace-pre-wrap"
                                      />
                                    ) : (
                                      <Input
                                        value={editing.value}
                                        onChange={(e) =>
                                          setEditing((p) =>
                                            p
                                              ? { ...p, value: e.target.value }
                                              : p
                                          )
                                        }
                                      />
                                    )
                                  ) : (
                                    <div className="whitespace-pre-wrap break-words">
                                      {r.value}
                                    </div>
                                  )}
                                </td>

                                <td className="p-3">
                                  {isEditing ? (
                                    <Switch
                                      checked={editing.isActive}
                                      onCheckedChange={(v) =>
                                        setEditing((p) =>
                                          p ? { ...p, isActive: v } : p
                                        )
                                      }
                                    />
                                  ) : (
                                    <div className="flex items-center gap-2">
                                      <div
                                        className={`h-2.5 w-2.5 rounded-full ${
                                          r.isActive
                                            ? "bg-green-500"
                                            : "bg-gray-400"
                                        }`}
                                      />
                                      <span>{r.isActive ? "Yes" : "No"}</span>
                                    </div>
                                  )}
                                </td>

                                <td className="p-3">
                                  {isEditing ? (
                                    <div className="flex gap-2">
                                      <Button size="sm" onClick={saveEdit}>
                                        Save
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={cancelEdit}
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                  ) : (
                                    <div className="flex gap-2 flex-wrap">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => startEdit(m.key, r)}
                                      >
                                        Edit
                                      </Button>

                                      {r.isActive ? (
                                        <Button
                                          size="sm"
                                          variant="destructive"
                                          onClick={() =>
                                            disableRow(m.key, r.id)
                                          }
                                        >
                                          Disable
                                        </Button>
                                      ) : (
                                        <Button
                                          size="sm"
                                          onClick={() => enableRow(m.key, r)}
                                        >
                                          Enable
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Note: “Delete” is a soft-disable. Disabled values won’t show
                    in dropdowns.
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
};

export default Masters;
