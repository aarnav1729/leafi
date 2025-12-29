// root/src/pages/admin/Users.tsx
import React, { useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Role = "admin" | "logistics" | "vendor";

type UserRow = {
  id: string;
  username: string;
  role: Role;
  name: string;
  company: string | null;
};

function getAuthHeader(): string | null {
  try {
    const stored = localStorage.getItem("rfq_user");
    const token = localStorage.getItem("rfq_session_token");
    if (!stored || !token) return null;
    const user = JSON.parse(stored) as { username?: string };
    const username = String(user?.username || "").trim();
    if (!username || !token) return null;
    return `Basic ${btoa(`${username}:${token}`)}`;
  } catch {
    return null;
  }
}

async function api<T>(
  url: string,
  opts: RequestInit = {}
): Promise<
  { ok: true; data: T } | { ok: false; status: number; message: string }
> {
  const auth = getAuthHeader();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as any),
  };
  if (auth) headers.Authorization = auth;

  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const message =
      String(parsed?.message || parsed?.error || text || "Request failed") ||
      "Request failed";
    return { ok: false, status: res.status, message };
  }
  return { ok: true, data: parsed as T };
}

function normalizeUsername(v: string) {
  return String(v || "").trim();
}

function autoPassword(username: string) {
  // Simple MVP default: same as username (you can change later)
  return normalizeUsername(username) || "changeme";
}

const ROLES: Role[] = ["admin", "logistics", "vendor"];

type EditState =
  | { open: false }
  | {
      open: true;
      mode: "create" | "edit";
      row?: UserRow;
      form: {
        username: string;
        name: string;
        role: Role;
        company: string;
        password: string;
      };
    };

const PAGE_SIZE = 12;

export default function Users() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [page, setPage] = useState(1);

  const [edit, setEdit] = useState<EditState>({ open: false });

  const me = useMemo(() => {
    try {
      const stored = localStorage.getItem("rfq_user");
      return stored ? (JSON.parse(stored) as any) : null;
    } catch {
      return null;
    }
  }, []);

  const refresh = async () => {
    setLoading(true);
    const r = await api<UserRow[]>("/api/admin/users", { method: "GET" });
    setLoading(false);

    if (!r.ok) {
      toast.error(r.status === 403 ? "Forbidden (admin only)" : r.message);
      return;
    }

    setRows(Array.isArray(r.data) ? r.data : []);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (roleFilter === "all" ? true : r.role === roleFilter))
      .filter((r) => {
        if (!q) return true;
        return (
          r.username.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          String(r.company || "")
            .toLowerCase()
            .includes(q) ||
          r.role.toLowerCase().includes(q)
        );
      });
  }, [rows, query, roleFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const pageRows = useMemo(() => {
    const p = Math.min(Math.max(1, page), totalPages);
    const start = (p - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [query, roleFilter]);

  const openCreate = () => {
    setEdit({
      open: true,
      mode: "create",
      form: {
        username: "",
        name: "",
        role: "vendor",
        company: "",
        password: "",
      },
    });
  };

  const openEdit = (row: UserRow) => {
    setEdit({
      open: true,
      mode: "edit",
      row,
      form: {
        username: row.username || "",
        name: row.name || "",
        role: row.role,
        company: row.company || "",
        password: "", // blank => keep as-is unless set
      },
    });
  };

  const closeDialog = () => setEdit({ open: false });

  const submit = async () => {
    if (!edit.open) return;
    const f = edit.form;

    const username = normalizeUsername(f.username);
    const name = String(f.name || "").trim();
    const role = f.role;
    const company = String(f.company || "").trim();

    if (!username) return toast.error("Username is required");
    if (!name) return toast.error("Name is required");
    if (!ROLES.includes(role)) return toast.error("Invalid role");

    if (role === "vendor" && !company) {
      return toast.error("Company is required for vendor users");
    }

    // password rules:
    // - create: required because dbo.Users.password is NOT NULL
    // - edit: optional; if blank => keep existing
    let password = String(f.password || "").trim();
    if (edit.mode === "create") {
      if (!password) password = autoPassword(username);
    }

    const payload: any = {
      username,
      name,
      role,
      company: company || null,
    };
    if (edit.mode === "create") payload.password = password;
    if (edit.mode === "edit" && password) payload.password = password;

    const url =
      edit.mode === "create"
        ? "/api/admin/users"
        : `/api/admin/users/${edit.row!.id}`;

    const method = edit.mode === "create" ? "POST" : "PUT";

    const r = await api<{ ok: true }>(url, {
      method,
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      toast.error(r.message);
      return;
    }

    toast.success(edit.mode === "create" ? "User created" : "User updated");
    closeDialog();
    refresh();
  };

  const del = async (row: UserRow) => {
    const myUsername = String(me?.username || "").toLowerCase();
    if (row.username.toLowerCase() === myUsername) {
      return toast.error("You cannot delete your own user");
    }

    const yes = window.confirm(
      `Delete user "${row.username}"?\n\nThis will permanently remove the user.`
    );
    if (!yes) return;

    const r = await api<{ ok: true }>(`/api/admin/users/${row.id}`, {
      method: "DELETE",
    });

    if (!r.ok) {
      toast.error(r.message);
      return;
    }

    toast.success("User deleted");
    refresh();
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-xl">Users</CardTitle>
            <div className="text-sm text-muted-foreground">
              Admin-only: create, edit, and delete users.
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={refresh} variant="outline" disabled={loading}>
              Refresh
            </Button>
            <Button onClick={openCreate}>New User</Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <Label className="text-xs">Search</Label>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search username, name, company, role…"
              />
            </div>

            <div>
              <Label className="text-xs">Role</Label>
              <Select
                value={roleFilter}
                onValueChange={(v) => setRoleFilter(v as any)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Username</TableHead>
                  <TableHead className="min-w-[220px]">Name</TableHead>
                  <TableHead className="min-w-[140px]">Role</TableHead>
                  <TableHead className="min-w-[220px]">Company</TableHead>
                  <TableHead className="min-w-[220px] text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5} className="py-6">
                        <div className="h-4 w-full bg-muted animate-pulse rounded" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : pageRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center">
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : (
                  pageRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm">
                        {r.username}
                      </TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{r.role}</Badge>
                      </TableCell>
                      <TableCell>{r.company || "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(r)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => del(r)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {filtered.length} user(s)
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </Button>
              <div className="text-sm">
                Page <span className="font-medium">{page}</span> /{" "}
                <span className="font-medium">{totalPages}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={edit.open} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {edit.open && edit.mode === "create"
                ? "Create User"
                : "Edit User"}
            </DialogTitle>
          </DialogHeader>

          {edit.open && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Username</Label>
                  <Input
                    value={edit.form.username}
                    onChange={(e) =>
                      setEdit((s) =>
                        s.open
                          ? {
                              ...s,
                              form: { ...s.form, username: e.target.value },
                            }
                          : s
                      )
                    }
                    placeholder="e.g. aarnavsingh or user@premierenergies.com"
                    disabled={edit.mode === "edit"} // safer (unique key)
                  />
                  {edit.mode === "edit" && (
                    <div className="text-xs text-muted-foreground">
                      Username is locked (unique index).
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input
                    value={edit.form.name}
                    onChange={(e) =>
                      setEdit((s) =>
                        s.open
                          ? {
                              ...s,
                              form: { ...s.form, name: e.target.value },
                            }
                          : s
                      )
                    }
                    placeholder="Full name"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Role</Label>
                  <Select
                    value={edit.form.role}
                    onValueChange={(v) =>
                      setEdit((s) =>
                        s.open
                          ? { ...s, form: { ...s.form, role: v as Role } }
                          : s
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label>Company</Label>
                  <Input
                    value={edit.form.company}
                    onChange={(e) =>
                      setEdit((s) =>
                        s.open
                          ? {
                              ...s,
                              form: { ...s.form, company: e.target.value },
                            }
                          : s
                      )
                    }
                    placeholder="Required for vendor"
                  />
                  {edit.form.role === "vendor" && (
                    <div className="text-xs text-muted-foreground">
                      Vendors must have a company (used for RFQ vendor
                      matching).
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label>
                  Password{" "}
                  <span className="text-xs text-muted-foreground">
                    {edit.mode === "edit"
                      ? "(leave blank to keep existing)"
                      : "(required by DB; auto-filled if blank)"}
                  </span>
                </Label>
                <Input
                  value={edit.form.password}
                  onChange={(e) =>
                    setEdit((s) =>
                      s.open
                        ? {
                            ...s,
                            form: { ...s.form, password: e.target.value },
                          }
                        : s
                    )
                  }
                  placeholder={
                    edit.mode === "edit"
                      ? "•••••• (optional)"
                      : "Set a password"
                  }
                  type="text"
                />
              </div>
            </div>
          )}

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={submit}>
              {edit.open && edit.mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
