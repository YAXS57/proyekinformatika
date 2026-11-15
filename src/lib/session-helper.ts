import { db, type CashSession } from "./db";

/**
 * Mendapatkan sesi kasir yang sedang aktif (berstatus 'open')
 */
export async function getActiveCashSession(): Promise<CashSession | null> {
  try {
    const session = await db.cash_sessions.where("status").equals("open").last();
    return session || null;
  } catch {
    return null;
  }
}

/**
 * Membuka sesi kasir baru dengan modal awal
 */
export async function openCashSession(initialCash: number, notes?: string): Promise<CashSession> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const sessionDate = `${y}-${m}-${d}`;

  const existing = await getActiveCashSession();
  if (existing) {
    throw new Error(
      "Masih ada sesi kasir yang belum ditutup. Tutup sesi sebelumnya terlebih dahulu.",
    );
  }

  const newSession: CashSession = {
    session_date: sessionDate,
    opened_at: Date.now(),
    closed_at: null,
    initial_cash: Math.max(0, initialCash),
    total_cash_sales: 0,
    total_qris_sales: 0,
    total_cash_purchases: 0,
    total_cash_expenses: 0,
    total_cash_settlements: 0,
    expected_cash: Math.max(0, initialCash),
    actual_cash: undefined,
    cash_difference: undefined,
    status: "open",
    notes: notes?.trim() || undefined,
    created_at: Date.now(),
    updated_at: Date.now(),
    sync_status: "synced",
  };

  const id = await db.cash_sessions.add(newSession);
  return { ...newSession, id };
}

/**
 * Mengkalkulasi angka riil sesi kasir berdasarkan transaksi yang tercatat
 */
export async function calculateSessionSummary(sessionId: number) {
  const session = await db.cash_sessions.get(sessionId);
  if (!session) throw new Error("Sesi kasir tidak ditemukan");

  const sales = await db.sales.where("session_id").equals(sessionId).toArray();
  const purchases = await db.purchases.where("session_id").equals(sessionId).toArray();
  const expenses = await db.expenses.where("session_id").equals(sessionId).toArray();
  const settlements = await db.consignment_settlements
    .where("session_id")
    .equals(sessionId)
    .toArray();

  let cashSales = 0;
  let qrisSales = 0;
  sales.forEach((s) => {
    if (s.status !== "void") {
      if (s.payment_method === "Cash") cashSales += s.total_amount;
      if (s.payment_method === "QRIS") qrisSales += s.total_amount;
    }
  });

  let cashPurchases = 0;
  purchases.forEach((p) => {
    if (p.payment_method === "Cash") cashPurchases += p.total_amount;
  });

  let cashExpenses = 0;
  expenses.forEach((e) => {
    if (!e.payment_method || e.payment_method === "Cash") cashExpenses += e.amount;
  });

  let cashSettlements = 0;
  settlements.forEach((st) => {
    if (!st.payment_method || st.payment_method === "Cash") cashSettlements += st.amount_paid;
  });

  const expectedCash =
    session.initial_cash + cashSales - cashPurchases - cashExpenses - cashSettlements;

  return {
    initialCash: session.initial_cash,
    cashSales,
    qrisSales,
    cashPurchases,
    cashExpenses,
    cashSettlements,
    expectedCash: Math.round(expectedCash),
    salesCount: sales.length,
    purchasesCount: purchases.length,
    expensesCount: expenses.length,
    settlementsCount: settlements.length,
  };
}

/**
 * Menutup sesi kasir dengan rekonsiliasi kas fisik
 */
export async function closeCashSession(
  sessionId: number,
  actualCash: number,
  notes?: string,
): Promise<CashSession> {
  const summary = await calculateSessionSummary(sessionId);
  const diff = actualCash - summary.expectedCash;

  const updateData = {
    closed_at: Date.now(),
    total_cash_sales: summary.cashSales,
    total_qris_sales: summary.qrisSales,
    total_cash_purchases: summary.cashPurchases,
    total_cash_expenses: summary.cashExpenses,
    total_cash_settlements: summary.cashSettlements,
    expected_cash: summary.expectedCash,
    actual_cash: actualCash,
    cash_difference: diff,
    status: "closed" as const,
    notes: notes?.trim() || undefined,
    updated_at: Date.now(),
    sync_status: "synced" as const,
  };

  await db.cash_sessions.update(sessionId, updateData);
  const updated = await db.cash_sessions.get(sessionId);
  return updated!;
}
