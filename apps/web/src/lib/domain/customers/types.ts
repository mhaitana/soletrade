import type { CustomerId, WorkspaceId } from "@/types/ids";

export interface CustomerInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  notes?: string | null;
}

export type CustomerPatch = Partial<CustomerInput>;

export interface CustomerRow {
  id: CustomerId;
  workspaceId: WorkspaceId;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}
