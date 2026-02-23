export type ProjectStatus = 'draft' | 'submitted' | 'in_review' | 'corrections' | 'approved';
export type ProjectType = 'new_construction' | 'renovation' | 'addition' | 'tenant_improvement' | 'demolition' | 'other';

export interface Project {
  id: string;
  user_id: string;
  name: string;
  address: string | null;
  project_url: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  jurisdiction: string | null;
  project_type: ProjectType | null;
  status: ProjectStatus;
  description: string | null;
  estimated_value: number | null;
  square_footage: number | null;
  permit_number: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  deadline: string | null;
  notes: string | null;
  portal_status: string | null;
  last_checked_at: string | null;
  portal_data: unknown | null;
  created_at: string;
  updated_at: string;
}

export const PROJECT_STATUS_CONFIG: Record<ProjectStatus, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  draft: {
    label: 'Draft',
    color: 'text-slate-700',
    bgColor: 'bg-slate-100',
    borderColor: 'border-slate-300',
  },
  submitted: {
    label: 'Submitted',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
    borderColor: 'border-blue-300',
  },
  in_review: {
    label: 'In Review',
    color: 'text-amber-700',
    bgColor: 'bg-amber-100',
    borderColor: 'border-amber-300',
  },
  corrections: {
    label: 'Corrections',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-300',
  },
  approved: {
    label: 'Approved',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-100',
    borderColor: 'border-emerald-300',
  },
};

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  new_construction: 'New Construction',
  renovation: 'Renovation',
  addition: 'Addition',
  tenant_improvement: 'Tenant Improvement',
  demolition: 'Demolition',
  other: 'Other',
};

export const STATUS_ORDER: ProjectStatus[] = ['draft', 'submitted', 'in_review', 'corrections', 'approved'];
