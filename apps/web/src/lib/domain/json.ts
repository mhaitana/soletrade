/** JSON values shared by browser-safe DTOs and persistence adapters. */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
