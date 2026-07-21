"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import type { PaymentMethods, PaymentMethod } from "@/shared/types/payment-methods";

interface PaymentMethodsEditorProps {
  value: PaymentMethods;
  onChange: (methods: PaymentMethods) => void;
  disabled?: boolean;
}

function makeNewMethod<T extends PaymentMethod["type"]>(
  type: T,
): Extract<PaymentMethod, { type: T }> {
  if (type === "bank_transfer") {
    return { type, accountName: "", bsb: "", accountNumber: "" } as Extract<
      PaymentMethod,
      { type: T }
    >;
  }
  if (type === "paypal") {
    return { type, email: "" } as Extract<PaymentMethod, { type: T }>;
  }
  return { type, identifier: "" } as Extract<PaymentMethod, { type: T }>;
}

export function PaymentMethodsEditor({ value, onChange, disabled }: PaymentMethodsEditorProps) {
  const editorId = useId();

  function replace(index: number, method: PaymentMethod) {
    onChange(value.map((m, i) => (i === index ? method : m)));
  }

  function add(type: PaymentMethod["type"]) {
    onChange([...value, makeNewMethod(type)]);
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= value.length) return;
    const copy = [...value];
    const [item] = copy.splice(index, 1);
    if (item === undefined) return;
    copy.splice(next, 0, item);
    onChange(copy);
  }

  return (
    <div className="space-y-4">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payment methods configured.</p>
      ) : (
        value.map((method, index) => (
          <div
            key={`${editorId}-${index}`}
            className="rounded-md border border-border bg-background p-3"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <select
                aria-label={`Payment method ${index + 1} type`}
                value={method.type}
                disabled={disabled}
                onChange={(e) => {
                  const type = e.target.value as PaymentMethod["type"];
                  replace(index, makeNewMethod(type));
                }}
                className="h-8 max-md:h-11 max-md:text-base rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="paypal">PayPal</option>
                <option value="payid">PayID</option>
              </select>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 max-md:size-11"
                  disabled={disabled || index === 0}
                  aria-label="Move up"
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 max-md:size-11"
                  disabled={disabled || index === value.length - 1}
                  aria-label="Move down"
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 max-md:size-11 text-destructive"
                  disabled={disabled}
                  aria-label="Remove payment method"
                  onClick={() => remove(index)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor={`${editorId}-label-${index}`}
                  className="text-xs text-muted-foreground"
                >
                  Label (optional)
                </Label>
                <Input
                  id={`${editorId}-label-${index}`}
                  value={method.label ?? ""}
                  onChange={(e) => replace(index, { ...method, label: e.target.value })}
                  placeholder="e.g. Direct deposit"
                  maxLength={80}
                  disabled={disabled}
                />
              </div>

              {method.type === "bank_transfer" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${editorId}-accountName-${index}`} className="text-xs">
                      Account name
                    </Label>
                    <Input
                      id={`${editorId}-accountName-${index}`}
                      value={method.accountName}
                      onChange={(e) => replace(index, { ...method, accountName: e.target.value })}
                      required
                      disabled={disabled}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${editorId}-bankName-${index}`} className="text-xs">
                      Bank name (optional)
                    </Label>
                    <Input
                      id={`${editorId}-bankName-${index}`}
                      value={method.bankName ?? ""}
                      onChange={(e) => replace(index, { ...method, bankName: e.target.value })}
                      disabled={disabled}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${editorId}-bsb-${index}`} className="text-xs">
                      BSB
                    </Label>
                    <Input
                      id={`${editorId}-bsb-${index}`}
                      value={method.bsb}
                      onChange={(e) => replace(index, { ...method, bsb: e.target.value })}
                      required
                      className="tabular-nums"
                      disabled={disabled}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${editorId}-accountNumber-${index}`} className="text-xs">
                      Account number
                    </Label>
                    <Input
                      id={`${editorId}-accountNumber-${index}`}
                      value={method.accountNumber}
                      onChange={(e) => replace(index, { ...method, accountNumber: e.target.value })}
                      required
                      className="tabular-nums"
                      disabled={disabled}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={`${editorId}-reference-${index}`} className="text-xs">
                      Payment reference (optional)
                    </Label>
                    <Input
                      id={`${editorId}-reference-${index}`}
                      value={method.reference ?? ""}
                      onChange={(e) => replace(index, { ...method, reference: e.target.value })}
                      placeholder="e.g. Use invoice number"
                      disabled={disabled}
                    />
                  </div>
                </div>
              ) : null}

              {method.type === "paypal" ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`${editorId}-email-${index}`} className="text-xs">
                    PayPal email
                  </Label>
                  <Input
                    id={`${editorId}-email-${index}`}
                    type="email"
                    value={method.email}
                    onChange={(e) => replace(index, { ...method, email: e.target.value })}
                    required
                    disabled={disabled}
                  />
                </div>
              ) : null}

              {method.type === "payid" ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`${editorId}-identifier-${index}`} className="text-xs">
                    PayID identifier
                  </Label>
                  <Input
                    id={`${editorId}-identifier-${index}`}
                    value={method.identifier}
                    onChange={(e) => replace(index, { ...method, identifier: e.target.value })}
                    required
                    disabled={disabled}
                  />
                </div>
              ) : null}
            </div>
          </div>
        ))
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => add("bank_transfer")}
        >
          <Plus className="size-4" aria-hidden /> Bank transfer
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => add("paypal")}
        >
          <Plus className="size-4" aria-hidden /> PayPal
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => add("payid")}
        >
          <Plus className="size-4" aria-hidden /> PayID
        </Button>
      </div>
    </div>
  );
}
