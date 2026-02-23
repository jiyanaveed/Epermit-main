import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, KeyRound, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface PortalCredential {
  id: string;
  user_id: string;
  jurisdiction: string;
  portal_username: string;
  portal_password: string;
  permit_number: string | null;
  project_address: string | null;
  project_id: string | null;
  created_at: string;
}

interface ProjectOption {
  id: string;
  name: string;
  permit_number: string | null;
  address: string | null;
}

const defaultForm = {
  jurisdiction: "",
  portal_username: "",
  portal_password: "",
  project_address: "",
  linkedProjectId: "" as string,
  createNewProject: false,
};

export function PortalCredentialsManager() {
  const { user } = useAuth();
  const [credentials, setCredentials] = useState<PortalCredential[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const fetchCredentials = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("portal_credentials")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load credentials");
      console.error(error);
    } else {
      setCredentials((data as PortalCredential[]) || []);
    }
    setLoading(false);
  }, [user]);

  const fetchProjects = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, permit_number, address")
      .eq("user_id", user.id);
    if (!error) {
      setProjects((data as ProjectOption[]) || []);
    }
  }, [user]);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  useEffect(() => {
    if (dialogOpen && user) {
      fetchProjects();
    }
  }, [dialogOpen, user, fetchProjects]);

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...defaultForm });
    setDialogOpen(true);
  };

  const openEdit = (row: PortalCredential) => {
    setEditingId(row.id);
    setForm({
      jurisdiction: row.jurisdiction,
      portal_username: row.portal_username,
      portal_password: row.portal_password,
      project_address: row.project_address ?? "",
      linkedProjectId: row.project_id ?? "",
      createNewProject: false,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!user) return;
    if (!form.jurisdiction.trim() || !form.portal_username.trim() || !form.portal_password.trim()) {
      toast.error("Jurisdiction, username, and password are required");
      return;
    }
    if (!form.linkedProjectId && !form.createNewProject) {
      toast.error("Link to a project is required for portal monitoring");
      return;
    }

    setSaving(true);
    try {
      let projectId: string | null = null;
      let permitNumber: string | null = null;

      if (form.linkedProjectId && !form.createNewProject) {
        projectId = form.linkedProjectId;
        const { data: proj } = await supabase
          .from("projects")
          .select("permit_number")
          .eq("id", projectId)
          .eq("user_id", user.id)
          .maybeSingle();
        permitNumber = (proj?.permit_number as string) ?? null;
      } else if (form.createNewProject) {
        const { data: newProject, error } = await supabase
          .from("projects")
          .insert({
            user_id: user.id,
            name: `New project – ${form.jurisdiction.trim()}`,
            jurisdiction: form.jurisdiction.trim(),
          })
          .select("id")
          .single();
        if (error) throw error;
        projectId = newProject?.id ?? null;
        if (!projectId) throw new Error("Failed to create project");
      }

      const payload = {
        user_id: user.id,
        jurisdiction: form.jurisdiction.trim(),
        portal_username: form.portal_username.trim(),
        portal_password: form.portal_password.trim(),
        permit_number: permitNumber,
        project_address: form.project_address.trim() || null,
        project_id: projectId,
      };

      if (editingId) {
        const { error } = await supabase
          .from("portal_credentials")
          .update(payload)
          .eq("id", editingId)
          .eq("user_id", user.id);
        if (error) throw error;
        toast.success("Credentials updated");
      } else {
        const { error } = await supabase.from("portal_credentials").insert(payload);
        if (error) throw error;
        toast.success("Credentials added");
      }
      setDialogOpen(false);
      fetchCredentials();
    } catch (e: unknown) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    const { error } = await supabase
      .from("portal_credentials")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) {
      toast.error("Failed to delete");
    } else {
      toast.success("Credentials removed");
      setCredentials((prev) => prev.filter((c) => c.id !== id));
    }
    setDeleteId(null);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Portal Credentials
              </CardTitle>
              <CardDescription>
                Add and manage login details for jurisdiction portals (used by the Portal Monitor Agent).
              </CardDescription>
            </div>
            <Button onClick={openAdd} className="bg-accent hover:bg-accent/90">
              <Plus className="mr-2 h-4 w-4" />
              Add New
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : credentials.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No credentials saved. Click &quot;Add New&quot; to add jurisdiction portal logins.
            </p>
          ) : (
            <ul className="space-y-3">
              {credentials.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border bg-muted/30"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{c.jurisdiction}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {c.portal_username}
                      {c.permit_number ? ` · Permit: ${c.permit_number}` : ""}
                    </p>
                    {c.project_address && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{c.project_address}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => openEdit(c)}>
                      <Pencil className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">Edit</span>
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteId(c.id)}>
                      <Trash2 className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">Delete</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit credentials" : "Add portal credentials"}</DialogTitle>
            <DialogDescription>
              Enter login details for a jurisdiction portal. These are used by the Portal Monitor Agent.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="jurisdiction">Jurisdiction</Label>
              <Input
                id="jurisdiction"
                placeholder="e.g. Fairfax County, Washington DC"
                value={form.jurisdiction}
                onChange={(e) => setForm((f) => ({ ...f, jurisdiction: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="portal_username">Username</Label>
              <Input
                id="portal_username"
                placeholder="Portal username"
                value={form.portal_username}
                onChange={(e) => setForm((f) => ({ ...f, portal_username: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="portal_password">Password</Label>
              <Input
                id="portal_password"
                type={showPassword ? "text" : "password"}
                placeholder="Portal password"
                value={form.portal_password}
                onChange={(e) => setForm((f) => ({ ...f, portal_password: e.target.value }))}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? "Hide" : "Show"} password
              </Button>
            </div>
            <div className="grid gap-2">
              <Label>Link to Project <span className="text-destructive">*</span></Label>
              <Select
                value={form.createNewProject ? "__none__" : (form.linkedProjectId || "__none__")}
                onValueChange={(v) => {
                  if (v === "__none__") {
                    setForm((f) => ({ ...f, linkedProjectId: "" }));
                  } else {
                    setForm((f) => ({ ...f, createNewProject: false, linkedProjectId: v }));
                  }
                }}
                disabled={form.createNewProject}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.address ? ` · ${p.address}` : ""}
                      {p.permit_number ? ` (${p.permit_number})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="createNewProject"
                  checked={form.createNewProject}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({
                      ...f,
                      createNewProject: !!checked,
                      linkedProjectId: checked ? "" : f.linkedProjectId,
                    }))
                  }
                />
                <Label htmlFor="createNewProject" className="text-sm font-normal cursor-pointer">
                  Or create a new project for this permit
                </Label>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project_address">Project address (optional)</Label>
              <Input
                id="project_address"
                placeholder="Project address"
                value={form.project_address}
                onChange={(e) => setForm((f) => ({ ...f, project_address: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                saving ||
                !form.jurisdiction.trim() ||
                !form.portal_username.trim() ||
                !form.portal_password.trim() ||
                (!form.linkedProjectId && !form.createNewProject)
              }
              className="bg-accent hover:bg-accent/90"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingId ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete credentials?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the saved portal login. You can add it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && handleDelete(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
