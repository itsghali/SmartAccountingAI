"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useAppContext } from "@/hooks/useAppContext";
import { cn } from "@/lib/utils";
import {
  Building2,
  CalendarDays,
  ChevronDown,
  LogOut,
  Menu,
  User,
} from "lucide-react";

export default function Topbar({
  onMobileMenuToggle,
}: {
  onMobileMenuToggle?: () => void;
}) {
  const { data: session } = useSession();
  const {
    currentCompanyId,
    currentFiscalYearId,
    setCompany,
    setFiscalYear,
    companies,
    fiscalYears,
    isLoading,
  } = useAppContext();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-white px-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      {/* Mobile menu button */}
      <button
        onClick={onMobileMenuToggle}
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
        aria-label="Toggle menu"
      >
        <Menu className="size-5" />
      </button>

      {/* Brand - visible on mobile when sidebar is hidden */}
      <span className="text-lg font-bold text-slate-900 lg:hidden dark:text-white">
        SmartAccountingAI
      </span>

      <div className="flex-1" />

      {/* Company Selector */}
      <DropdownSelect
        icon={<Building2 className="size-4 text-slate-400" />}
        label="Societe"
        value={currentCompanyId}
        options={companies.map((c) => ({
          value: c.id,
          label: c.name,
          sublabel: c.legalForm ?? undefined,
        }))}
        onChange={setCompany}
        isLoading={isLoading}
        placeholder="Choisir une societe"
      />

      {/* Fiscal Year Selector */}
      <DropdownSelect
        icon={<CalendarDays className="size-4 text-slate-400" />}
        label="Exercice"
        value={currentFiscalYearId}
        options={fiscalYears.map((fy) => ({
          value: fy.id,
          label: fy.label,
          sublabel: fy.status,
        }))}
        onChange={setFiscalYear}
        isLoading={isLoading}
        placeholder="Choisir un exercice"
      />

      {/* User Menu */}
      <UserMenu
        name={session?.user?.name ?? "Utilisateur"}
        role={session?.user?.role ?? ""}
        email={session?.user?.email ?? ""}
      />
    </header>
  );
}

// ─── Dropdown Select Component ───────────────────────────────────────────────

interface DropdownOption {
  value: string;
  label: string;
  sublabel?: string;
}

function DropdownSelect({
  icon,
  label,
  value,
  options,
  onChange,
  isLoading,
  placeholder,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  options: DropdownOption[];
  onChange: (value: string) => void;
  isLoading: boolean;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
          "border-slate-200 bg-white hover:bg-slate-50",
          "dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800",
          open && "ring-2 ring-blue-500/20"
        )}
        disabled={isLoading}
      >
        {icon}
        <span className="max-w-[140px] truncate text-slate-700 dark:text-slate-200">
          {isLoading ? "Chargement..." : selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 text-slate-400 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && options.length > 0 && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-slate-400">
            {label}
          </div>
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full flex-col items-start px-3 py-2 text-sm transition-colors",
                "hover:bg-slate-100 dark:hover:bg-slate-800",
                option.value === value &&
                  "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              )}
            >
              <span className="font-medium">{option.label}</span>
              {option.sublabel && (
                <span className="text-xs text-slate-400">{option.sublabel}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── User Menu Component ─────────────────────────────────────────────────────

function UserMenu({
  name,
  role,
  email,
}: {
  name: string;
  role: string;
  email: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: "Super Admin",
    ADMIN: "Administrateur",
    ACCOUNTANT: "Comptable",
    VIEWER: "Lecteur",
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
          "hover:bg-slate-100 dark:hover:bg-slate-800",
          open && "bg-slate-100 dark:bg-slate-800"
        )}
      >
        <div className="flex size-8 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
          {initials}
        </div>
        <div className="hidden text-left md:block">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {name}
          </p>
          <p className="text-xs text-slate-400">{roleLabels[role] ?? role}</p>
        </div>
        <ChevronDown
          className={cn(
            "hidden size-3.5 text-slate-400 transition-transform md:block",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {name}
            </p>
            <p className="text-xs text-slate-400">{email}</p>
          </div>

          <button
            onClick={() => {
              setOpen(false);
              // Navigate to profile or settings
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <User className="size-4" />
            Mon Profil
          </button>

          <div className="border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={() => {
                setOpen(false);
                signOut({ callbackUrl: "/login" });
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              <LogOut className="size-4" />
              Deconnexion
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
