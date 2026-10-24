/** Browser-safe customer fields used by document pickers. */
export interface PickerCustomer {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
}
