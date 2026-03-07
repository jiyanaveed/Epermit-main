import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Rocket,
  Loader2,
  Plus,
  Trash2,
  Upload,
  FileText,
  Building2,
  User,
  KeyRound,
  AlertTriangle,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import type { Project } from '@/types/project';

interface Professional {
  id: string;
  name: string;
  licenseType: string;
  licenseNumber: string;
  role: string;
}

interface DocumentFile {
  id: string;
  file: File;
  documentType: string;
}

interface PortalCredential {
  id: string;
  jurisdiction: string;
  portal_username: string;
  login_url: string | null;
}

interface StartFilingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onFilingStarted?: (filingId: string) => void;
}

const PROPERTY_TYPES = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'mixed_use', label: 'Mixed Use' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'institutional', label: 'Institutional' },
];

const LICENSE_TYPES = [
  { value: 'architect', label: 'Architect' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'expediter', label: 'Expediter' },
  { value: 'master_electrician', label: 'Master Electrician' },
  { value: 'master_plumber', label: 'Master Plumber' },
  { value: 'master_hvac', label: 'Master HVAC' },
];

const PROFESSIONAL_ROLES = [
  { value: 'architect_of_record', label: 'Architect of Record' },
  { value: 'structural_engineer', label: 'Structural Engineer' },
  { value: 'mep_engineer', label: 'MEP Engineer' },
  { value: 'general_contractor', label: 'General Contractor' },
  { value: 'permit_expediter', label: 'Permit Expediter' },
  { value: 'owner', label: 'Owner' },
];

const DOCUMENT_TYPES = [
  { value: 'plan', label: 'Plans / Drawings' },
  { value: 'cost_estimate', label: 'Cost Estimate' },
  { value: 'contract', label: 'Contract' },
  { value: 'eif', label: 'Environmental Intake Form (EIF)' },
  { value: 'checklist', label: 'Checklist' },
  { value: 'specification', label: 'Specification' },
  { value: 'other', label: 'Other' },
];

function generateId() {
  return crypto.randomUUID();
}

export function StartFilingDialog({
  open,
  onOpenChange,
  project,
  onFilingStarted,
}: StartFilingDialogProps) {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [credentials, setCredentials] = useState<PortalCredential[]>([]);
  const [loadingCredentials, setLoadingCredentials] = useState(false);

  const [propertyAddress, setPropertyAddress] = useState(project.address || '');
  const [scopeOfWork, setScopeOfWork] = useState(project.description || '');
  const [constructionValue, setConstructionValue] = useState<string>(
    project.estimated_value?.toString() || ''
  );
  const [propertyType, setPropertyType] = useState<string>('');
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('');

  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [documents, setDocuments] = useState<DocumentFile[]>([]);

  useEffect(() => {
    if (open && user) {
      loadCredentials();
    }
  }, [open, user]);

  useEffect(() => {
    if (open) {
      setPropertyAddress(project.address || '');
      setScopeOfWork(project.description || '');
      setConstructionValue(project.estimated_value?.toString() || '');
    }
  }, [open, project]);

  async function loadCredentials() {
    if (!user) return;
    setLoadingCredentials(true);
    try {
      const { data, error } = await supabase
        .from('portal_credentials')
        .select('id, jurisdiction, portal_username, login_url')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCredentials(data || []);

      if (data && data.length > 0 && !selectedCredentialId) {
        const dcCred = data.find((c: PortalCredential) =>
          c.jurisdiction?.toLowerCase().includes('dc')
        );
        if (dcCred) {
          setSelectedCredentialId(dcCred.id);
        }
      }
    } catch (err) {
      console.error('Failed to load credentials:', err);
    } finally {
      setLoadingCredentials(false);
    }
  }

  function addProfessional() {
    setProfessionals((prev) => [
      ...prev,
      {
        id: generateId(),
        name: '',
        licenseType: '',
        licenseNumber: '',
        role: '',
      },
    ]);
  }

  function updateProfessional(id: string, field: keyof Professional, value: string) {
    setProfessionals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  }

  function removeProfessional(id: string) {
    setProfessionals((prev) => prev.filter((p) => p.id !== id));
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const newDocs: DocumentFile[] = Array.from(files).map((file) => ({
      id: generateId(),
      file,
      documentType: 'plan',
    }));
    setDocuments((prev) => [...prev, ...newDocs]);
    e.target.value = '';
  }

  function updateDocumentType(id: string, type: string) {
    setDocuments((prev) =>
      prev.map((d) => (d.id === id ? { ...d, documentType: type } : d))
    );
  }

  function removeDocument(id: string) {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleStartPreflight() {
    if (!user) {
      toast.error('You must be logged in');
      return;
    }

    if (!propertyAddress.trim()) {
      toast.error('Property address is required');
      return;
    }

    if (!scopeOfWork.trim()) {
      toast.error('Scope of work is required');
      return;
    }

    if (!propertyType) {
      toast.error('Please select a property type');
      return;
    }

    setSubmitting(true);

    try {
      const { data: filing, error: filingError } = await supabase
        .from('permit_filings')
        .insert({
          project_id: project.id,
          user_id: user.id,
          filing_status: 'preflight',
          property_address: propertyAddress.trim(),
          scope_of_work: scopeOfWork.trim(),
          construction_value: constructionValue ? parseFloat(constructionValue) : null,
          property_type: propertyType,
        })
        .select('id')
        .single();

      if (filingError) throw filingError;

      const filingId = filing.id;

      if (professionals.length > 0) {
        const validProfessionals = professionals.filter(
          (p) => p.name.trim() && p.licenseNumber.trim()
        );

        if (validProfessionals.length > 0) {
          const { error: profError } = await supabase
            .from('filing_professionals')
            .insert(
              validProfessionals.map((p) => ({
                filing_id: filingId,
                professional_name: p.name.trim(),
                license_type: p.licenseType || 'other',
                license_number: p.licenseNumber.trim(),
                role_on_project: p.role || 'other',
              }))
            );

          if (profError) {
            console.error('Failed to insert professionals:', profError);
          }
        }
      }

      if (documents.length > 0) {
        const docInserts = documents.map((d, idx) => ({
          filing_id: filingId,
          document_name: d.file.name,
          document_type: d.documentType,
          file_size_bytes: d.file.size,
          file_format: d.file.name.split('.').pop()?.toLowerCase() || 'unknown',
          validation_status: 'pending' as const,
          upload_order: idx + 1,
        }));

        const { error: docError } = await supabase
          .from('filing_documents')
          .insert(docInserts);

        if (docError) {
          console.error('Failed to insert documents:', docError);
        }
      }

      try {
        await supabase.functions.invoke('permitwizard-preflight', {
          body: {
            filing_id: filingId,
            credential_id: selectedCredentialId || null,
          },
        });
      } catch (preflightErr) {
        console.warn('Pre-flight invocation sent (may run async):', preflightErr);
      }

      toast.success('Filing created! Pre-flight pipeline started.');
      onFilingStarted?.(filingId);
      onOpenChange(false);
    } catch (err: any) {
      console.error('Failed to start filing:', err);
      toast.error(err.message || 'Failed to create filing');
    } finally {
      setSubmitting(false);
    }
  }

  const isValid =
    propertyAddress.trim() !== '' &&
    scopeOfWork.trim() !== '' &&
    propertyType !== '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-dialog-title">
            <Rocket className="h-5 w-5" />
            Start PermitWizard Filing
          </DialogTitle>
          <DialogDescription>
            Provide project details to initiate the 9-agent autonomous filing pipeline.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6">
            <div className="space-y-4">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Project Details
              </h4>

              <div className="space-y-2">
                <Label>Property Address *</Label>
                <Input
                  data-testid="input-property-address"
                  value={propertyAddress}
                  onChange={(e) => setPropertyAddress(e.target.value)}
                  placeholder="123 Main St NW, Washington, DC 20001"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Property Type *</Label>
                  <Select value={propertyType} onValueChange={setPropertyType}>
                    <SelectTrigger data-testid="select-property-type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROPERTY_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Construction Value ($)</Label>
                  <Input
                    data-testid="input-construction-value"
                    type="number"
                    value={constructionValue}
                    onChange={(e) => setConstructionValue(e.target.value)}
                    placeholder="150000"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Scope of Work *</Label>
                <Textarea
                  data-testid="input-scope-of-work"
                  rows={3}
                  value={scopeOfWork}
                  onChange={(e) => setScopeOfWork(e.target.value)}
                  placeholder="Describe the construction work to be performed..."
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Professionals
                </h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addProfessional}
                  data-testid="button-add-professional"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>

              {professionals.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No professionals added yet. Add architects, engineers, or contractors.
                </p>
              )}

              {professionals.map((prof, idx) => (
                <Card key={prof.id}>
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        Professional #{idx + 1}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeProfessional(prof.id)}
                        data-testid={`button-remove-professional-${idx}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Full Name</Label>
                        <Input
                          data-testid={`input-professional-name-${idx}`}
                          value={prof.name}
                          onChange={(e) => updateProfessional(prof.id, 'name', e.target.value)}
                          placeholder="Jane Doe"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">License Number</Label>
                        <Input
                          data-testid={`input-professional-license-${idx}`}
                          value={prof.licenseNumber}
                          onChange={(e) =>
                            updateProfessional(prof.id, 'licenseNumber', e.target.value)
                          }
                          placeholder="DC-12345"
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">License Type</Label>
                        <Select
                          value={prof.licenseType}
                          onValueChange={(v) => updateProfessional(prof.id, 'licenseType', v)}
                        >
                          <SelectTrigger data-testid={`select-license-type-${idx}`}>
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent>
                            {LICENSE_TYPES.map((lt) => (
                              <SelectItem key={lt.value} value={lt.value}>
                                {lt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Role on Project</Label>
                        <Select
                          value={prof.role}
                          onValueChange={(v) => updateProfessional(prof.id, 'role', v)}
                        >
                          <SelectTrigger data-testid={`select-role-${idx}`}>
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent>
                            {PROFESSIONAL_ROLES.map((r) => (
                              <SelectItem key={r.value} value={r.value}>
                                {r.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Documents
                </h4>
                <Label
                  htmlFor="filing-doc-upload"
                  className="cursor-pointer"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    data-testid="button-upload-documents"
                  >
                    <span>
                      <Upload className="h-4 w-4 mr-1" />
                      Upload
                    </span>
                  </Button>
                  <input
                    id="filing-doc-upload"
                    type="file"
                    multiple
                    accept=".pdf,.dwg,.dxf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={handleFileSelect}
                    data-testid="input-file-upload"
                  />
                </Label>
              </div>

              {documents.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No documents uploaded. Upload plans, cost estimates, contracts, etc.
                </p>
              )}

              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 p-2 rounded-md bg-muted"
                  data-testid={`doc-item-${doc.id}`}
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" data-testid={`text-doc-name-${doc.id}`}>
                      {doc.file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(doc.file.size)}
                    </p>
                  </div>
                  <Select
                    value={doc.documentType}
                    onValueChange={(v) => updateDocumentType(doc.id, v)}
                  >
                    <SelectTrigger className="w-[140px]" data-testid={`select-doc-type-${doc.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_TYPES.map((dt) => (
                        <SelectItem key={dt.value} value={dt.value}>
                          {dt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeDocument(doc.id)}
                    data-testid={`button-remove-doc-${doc.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-4">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                Portal Credentials
              </h4>

              {loadingCredentials ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading credentials...
                </div>
              ) : credentials.length === 0 ? (
                <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    No portal credentials found. Add them in Settings to enable portal automation.
                  </p>
                </div>
              ) : (
                <Select value={selectedCredentialId} onValueChange={setSelectedCredentialId}>
                  <SelectTrigger data-testid="select-portal-credential">
                    <SelectValue placeholder="Select portal credential" />
                  </SelectTrigger>
                  <SelectContent>
                    {credentials.map((cred) => (
                      <SelectItem key={cred.id} value={cred.id}>
                        <span className="flex items-center gap-2">
                          <span>{cred.jurisdiction}</span>
                          <Badge variant="secondary" className="text-xs">
                            {cred.portal_username}
                          </Badge>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-filing"
          >
            Cancel
          </Button>
          <Button
            onClick={handleStartPreflight}
            disabled={submitting || !isValid}
            data-testid="button-start-preflight"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Start Pre-Flight
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
