"use client";

import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { formatMAD } from "@/lib/utils/currency";

interface CurrencyInputProps {
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  autoFocus?: boolean;
}

function parseCurrencyValue(input: string): number {
  const cleaned = input.replace(/[\s\u00a0]/g, "");
  if (!cleaned) return 0;

  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : /^(\d{1,3})(\.\d{3})+$/.test(cleaned)
      ? cleaned.replace(/\./g, "")
      : cleaned;

  return Number(normalized);
}

export function CurrencyInput({
  value,
  onChange,
  placeholder = "0.00",
  className = "",
  disabled = false,
  onKeyDown,
  autoFocus,
}: CurrencyInputProps) {
  const [focused, setFocused] = useState(false);
  const [displayValue, setDisplayValue] = useState(value ? value.toString() : "");

  const handleFocus = useCallback(() => {
    setFocused(true);
    setDisplayValue(value ? value.toString() : "");
  }, [value]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    const num = parseCurrencyValue(displayValue);
    if (!isNaN(num) && num >= 0) {
      onChange(Math.round(num * 100) / 100);
    } else {
      setDisplayValue("");
      onChange(0);
    }
  }, [displayValue, onChange]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // Allow digits, dot, comma, and empty
    if (/^[\d.,\s]*$/.test(val)) {
      setDisplayValue(val);
      const num = parseCurrencyValue(val);
      if (!isNaN(num) && num >= 0) {
        onChange(Math.round(num * 100) / 100);
      } else if (!val) {
        onChange(0);
      }
    }
  }, [onChange]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={focused ? displayValue : value ? formatMAD(value) : ""}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className={`text-right font-mono ${className}`}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  );
}
