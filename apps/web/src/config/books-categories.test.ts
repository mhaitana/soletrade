import { describe, expect, it } from "vitest";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  categoriesForType,
  categoryLabel,
  isBookCategory,
} from "@/config/books-categories";

describe("books-categories catalog", () => {
  it("has non-empty income and expense lists", () => {
    expect(INCOME_CATEGORIES.length).toBeGreaterThan(0);
    expect(EXPENSE_CATEGORIES.length).toBeGreaterThan(0);
  });

  it("has unique keys within each list", () => {
    const incomeKeys = INCOME_CATEGORIES.map((c) => c.key);
    const expenseKeys = EXPENSE_CATEGORIES.map((c) => c.key);
    expect(new Set(incomeKeys).size).toBe(incomeKeys.length);
    expect(new Set(expenseKeys).size).toBe(expenseKeys.length);
  });

  it("categoriesForType returns the matching list", () => {
    expect(categoriesForType("income")).toBe(INCOME_CATEGORIES);
    expect(categoriesForType("expense")).toBe(EXPENSE_CATEGORIES);
  });

  it("isBookCategory validates slugs against the type's list", () => {
    expect(isBookCategory("income", "sales")).toBe(true);
    expect(isBookCategory("income", "services")).toBe(true);
    expect(isBookCategory("expense", "rent")).toBe(true);
    // rent is an expense category, not an income category
    expect(isBookCategory("income", "rent")).toBe(false);
    // sales is an income category, not an expense category
    expect(isBookCategory("expense", "sales")).toBe(false);
    // unknown slug
    expect(isBookCategory("income", "nope")).toBe(false);
  });

  it("categoryLabel returns the human label or null", () => {
    expect(categoryLabel("income", "sales")).toBe("Sales");
    expect(categoryLabel("expense", "rent")).toBe("Rent");
    expect(categoryLabel("income", "rent")).toBeNull();
    expect(categoryLabel("expense", "unknown")).toBeNull();
  });
});
