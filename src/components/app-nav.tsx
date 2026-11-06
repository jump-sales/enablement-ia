"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Brand } from "./brand";

export type NavItem = { href: string; label: string; soon?: boolean };

export function AppNav({ items, orgName, userName, roleLabel }: { items: NavItem[]; orgName: string; userName: string; roleLabel: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function signOut() {
    await authClient.signOut();
    router.replace("/entrar");
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between bg-navy px-4 py-3 lg:hidden">
        <Brand inverted />
        <button className="rounded px-2 py-1 text-sm text-white ring-1 ring-white/30" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="nav">
          Menu
        </button>
      </div>
      <aside
        id="nav"
        className={`${open ? "block" : "hidden"} bg-navy text-white lg:fixed lg:inset-y-0 lg:left-0 lg:block lg:w-64`}
        aria-label="Navegação principal"
      >
        <div className="hidden px-5 py-5 lg:block">
          <Brand inverted />
        </div>
        <div className="mx-4 mb-4 rounded-md bg-navy-800 px-3 py-2">
          <div className="truncate text-sm font-medium">{orgName}</div>
          <div className="text-xs text-white/70">{roleLabel}</div>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {items.map((i) => {
            const active = pathname === i.href || pathname.startsWith(i.href + "/");
            return (
              <Link
                key={i.href}
                href={i.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                  active ? "bg-orange font-semibold text-navy" : "text-white/85 hover:bg-navy-700"
                }`}
              >
                {i.label}
                {i.soon && <span className={`text-[10px] uppercase tracking-wide ${active ? "text-navy/70" : "text-white/50"}`}>em breve</span>}
              </Link>
            );
          })}
        </nav>
        <div className="mt-6 border-t border-white/10 px-5 py-4 lg:absolute lg:inset-x-0 lg:bottom-0">
          <div className="truncate text-sm">{userName}</div>
          <button onClick={signOut} className="mt-1 text-xs text-white/70 underline hover:text-white">
            Sair
          </button>
        </div>
      </aside>
    </>
  );
}
