import type { GeneralFacilityRecord } from '../src/utils/generalFacility';

// key identifies an editable reference entry, not an official facility ID.
export interface ManagedGeneralFacility extends GeneralFacilityRecord { key: string }
export interface GeneralFacilityDirectoryState {
  revision: number;
  added: ManagedGeneralFacility[];
  removedKeys: string[];
  updatedAt?: string;
  updatedBy?: string;
}
export interface GeneralFacilityDirectoryResponse {
  revision: number;
  facilities: ManagedGeneralFacility[];
  canEdit: boolean;
}
