import type { VehicleExpenseType } from "@/lib/domain/database-enums";
import type {
  DriveEarningId,
  DriveExpenseId,
  DriveTripId,
  FileId,
  VehicleId,
  WorkspaceId,
} from "@/types/ids";

export interface EarningInput {
  /** Slug from `drive-platforms`, validated. */
  platform: string;
  /** Integer cents, must be > 0. */
  amountCents: number;
  currency?: string;
  /** User-chosen earning date. */
  date: Date;
  description: string;
  notes?: string | null;
}

export type EarningPatch = Partial<EarningInput>;

export interface EarningRow {
  id: DriveEarningId;
  workspaceId: WorkspaceId;
  platform: string;
  amountCents: number;
  currency: string;
  date: Date;
  description: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TripInput {
  /** Slug from `drive-platforms`, validated. */
  platform: string;
  vehicleId?: VehicleId | null;
  /** Integer meters (smallest unit), must be > 0. */
  distanceMeters: number;
  /** User-chosen trip date. */
  date: Date;
  purpose?: string | null;
  notes?: string | null;
}

export type TripPatch = Partial<TripInput>;

export interface TripRow {
  id: DriveTripId;
  workspaceId: WorkspaceId;
  platform: string;
  vehicleId?: VehicleId | null;
  distanceMeters: number;
  date: Date;
  purpose: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VehicleInput {
  name: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  odometerKm?: number | null;
  active?: boolean;
}

export type VehiclePatch = Partial<VehicleInput>;

export interface VehicleRow {
  id: VehicleId;
  workspaceId: WorkspaceId;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  odometerKm: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpenseInput {
  vehicleId: VehicleId;
  type: VehicleExpenseType;
  amountCents: number;
  currency?: string;
  date: Date;
  description: string;
  odometerKm?: number | null;
  notes?: string | null;
  receiptFileId?: FileId | null;
}

export type ExpensePatch = Partial<Omit<ExpenseInput, "vehicleId">>;

export interface ExpenseRow {
  id: DriveExpenseId;
  workspaceId: WorkspaceId;
  vehicleId: VehicleId;
  type: VehicleExpenseType;
  amountCents: number;
  currency: string;
  date: Date;
  description: string;
  odometerKm: number | null;
  notes: string | null;
  receiptFileId: FileId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DriveSettingsRow {
  mileageRateCentsPerKm: number;
  defaultVehicleId: VehicleId | null;
}
