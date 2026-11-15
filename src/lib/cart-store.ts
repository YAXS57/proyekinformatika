/**
 * Cart Store — Penyimpanan Keranjang Belanja
 * ===========================================
 * Menggunakan dual-layer persistence:
 * 1. In-memory (cepat, untuk render React)
 * 2. IndexedDB via Dexie app_settings (tahan crash & refresh)
 *
 * Fallback ke localStorage jika IndexedDB gagal.
 */

import { useSyncExternalStore } from "react";
import type { MenuItem } from "./db";
import { db } from "./db";

export interface CartLine {
  item: MenuItem;
  qty: number;
}

const CART_KEY = "angkringan_cart_state";

// ─── Load Awal (dari IndexedDB, fallback localStorage) ──────

const loadCartSync = (): CartLine[] => {
  try {
    const saved = localStorage.getItem(CART_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

// Muat dari IndexedDB secara async, lalu update in-memory
async function loadCartFromDB(): Promise<CartLine[]> {
  try {
    const setting = await db.app_settings.get(CART_KEY);
    if (setting && Array.isArray(setting.value)) {
      return setting.value as CartLine[];
    }
  } catch {
    // IndexedDB tidak tersedia, fallback ke localStorage
  }
  return loadCartSync();
}

// ─── In-Memory State ─────────────────────────────────────────

let cart: CartLine[] = loadCartSync();
const listeners = new Set<() => void>();

// Inisialisasi async: muat dari IndexedDB saat app ready
loadCartFromDB().then((loaded) => {
  if (loaded.length > 0 || cart.length === 0) {
    cart = loaded;
    listeners.forEach((l) => l());
  }
});

// ─── Persist ke IndexedDB + localStorage ─────────────────────

function persist() {
  // 1. localStorage (sinkron, fallback)
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {
    // Quota exceeded — abaikan, IndexedDB sebagai utama
  }

  // 2. IndexedDB (async, tahan crash)
  db.app_settings
    .put({
      key: CART_KEY,
      value: cart,
      updated_at: Date.now(),
    })
    .catch(() => {
      // Abaikan jika IndexedDB gagal
    });
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

// ─── Cart Store API ──────────────────────────────────────────

export const cartStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get() {
    return cart;
  },
  add(item: MenuItem) {
    const existing = cart.find((c) => c.item.id === item.id);
    if (existing) {
      cart = cart.map((c) => (c.item.id === item.id ? { ...c, qty: c.qty + 1 } : c));
    } else {
      cart = [...cart, { item, qty: 1 }];
    }
    emit();
  },
  setQty(itemId: number, qty: number) {
    cart =
      qty <= 0
        ? cart.filter((c) => c.item.id !== itemId)
        : cart.map((c) => (c.item.id === itemId ? { ...c, qty } : c));
    emit();
  },
  clear() {
    cart = [];
    emit();
  },
};

// ─── React Hook ──────────────────────────────────────────────

export function useCart() {
  return useSyncExternalStore(cartStore.subscribe, cartStore.get, cartStore.get);
}

// ─── Utility ─────────────────────────────────────────────────

export const cartTotal = (lines: CartLine[]) =>
  lines.reduce((sum, l) => sum + l.item.price * l.qty, 0);

export const cartCount = (lines: CartLine[]) => lines.reduce((sum, l) => sum + l.qty, 0);
