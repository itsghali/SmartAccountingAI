"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";

interface Account {
  id: string;
  code: string;
  label: string;
  classNumber: number;
}

interface AccountSearchProps {
  companyId: string;
  value: string;
  onChange: (code: string, label: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  autoFocus?: boolean;
  className?: string;
}

export function AccountSearch({
  companyId,
  value,
  onChange,
  onKeyDown,
  autoFocus,
  className,
}: AccountSearchProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<Account[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suppressSearchRef = useRef(false);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const search = useCallback(
    async (term: string) => {
      if (!term || term.length < 1) {
        setResults([]);
        setIsOpen(false);
        return;
      }

      try {
        const res = await fetch(
          `/api/accounts?companyId=${companyId}&search=${encodeURIComponent(term)}`
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data.slice(0, 15));
          setIsOpen(data.length > 0);
          setSelectedIndex(0);
        }
      } catch {
        // Ignore
      }
    },
    [companyId]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isFocused) return;
      if (suppressSearchRef.current) {
        suppressSearchRef.current = false;
        return;
      }
      search(query);
    }, 200);
    return () => clearTimeout(timer);
  }, [isFocused, query, search]);

  const selectAccount = useCallback(
    (account: Account) => {
      suppressSearchRef.current = true;
      setQuery(account.code);
      onChange(account.code, account.label);
      setIsOpen(false);
    },
    [onChange]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextQuery = e.target.value;
      setQuery(nextQuery);
      onChange(nextQuery.trim(), "");
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter" && results[selectedIndex]) {
          e.preventDefault();
          selectAccount(results[selectedIndex]);
        } else if (e.key === "Escape") {
          setIsOpen(false);
        }
      } else if (e.key === "F4") {
        e.preventDefault();
        search(query || "");
      }

      onKeyDown?.(e);
    },
    [isOpen, results, selectedIndex, selectAccount, onKeyDown, query, search]
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className || ""}`}>
      <Input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          setIsFocused(true);
          if (query) {
            search(query);
          }
        }}
        onBlur={() => setIsFocused(false)}
        placeholder="Code ou libellé..."
        className="font-mono"
        autoFocus={autoFocus}
      />
      {isOpen && results.length > 0 && (
        <div className="absolute z-50 w-[400px] mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
          {results.map((account, index) => (
            <button
              key={account.id}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex justify-between ${
                index === selectedIndex ? "bg-blue-50" : ""
              }`}
              onClick={() => selectAccount(account)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="font-mono font-medium text-blue-700">{account.code}</span>
              <span className="text-gray-600 ml-2 truncate">{account.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
