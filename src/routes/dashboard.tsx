import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useState, useEffect, useMemo } from "react";
import { db } from "@/lib/db";
import { formatRupiah } from "@/lib/format";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { openCashSession, closeCashSession, calculateSessionSummary } from "@/lib/session-helper";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Store,
  DollarSign,
  TrendingDown,
  ShoppingBag,
  Wallet,
  Clock,
  Wifi,
  WifiOff,
  Database,
  ArrowRight,
  PlusCircle,
  Receipt,
  Package,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Angkringan POS" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [openSessionModal, setOpenSessionModal] = useState(false);
  const [closeSessionModal, setCloseSessionModal] = useState(false);
  const [initialCashStr, setInitialCashStr] = useState("");
  const [actualCashStr, setActualCashStr] = useState("");
  const [sessionNotes, setSessionNotes] = useState("");
  const [currentSummary, setCurrentSummary] = useState<Awaited<
    ReturnType<typeof calculateSessionSummary>
  > | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Ambil sesi kasir aktif
  const activeSession = useLiveQuery(
    () => db.cash_sessions.where("status").equals("open").last(),
    [],
  );

  // Hitung angka sesi kasir secara langsung
  useEffect(() => {
    if (activeSession?.id) {
      calculateSessionSummary(activeSession.id).then(setCurrentSummary).catch(console.error);
    } else {
      setCurrentSummary(null);
    }
  }, [activeSession]);

  // Transaksi Hari Ini
  const todayStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }, []);

  const todayEnd = useMemo(() => todayStart + 86400000, [todayStart]);

  const salesToday = useLiveQuery(
    () => db.sales.where("transaction_date").between(todayStart, todayEnd).reverse().toArray(),
    [todayStart, todayEnd],
  );

  const purchasesToday = useLiveQuery(
    () => db.purchases.where("purchase_date").between(todayStart, todayEnd).toArray(),
    [todayStart, todayEnd],
  );

  const expensesToday = useLiveQuery(
    () => db.expenses.where("expense_date").between(todayStart, todayEnd).toArray(),
    [todayStart, todayEnd],
  );

  const recentSales = useLiveQuery(
    () => db.sales.orderBy("transaction_date").reverse().limit(5).toArray(),
    [],
  );

  const lastBackup = useLiveQuery(() => db.backup_history.reverse().first(), []);

  // Kalkulasi Metrik Hari Ini
  const totalOmzetHariIni = useMemo(() => {
    return (
      salesToday?.reduce((sum, s) => (s.status !== "void" ? sum + s.total_amount : sum), 0) || 0
    );
  }, [salesToday]);

  const totalPembelianHariIni = useMemo(() => {
    return purchasesToday?.reduce((sum, p) => sum + p.total_amount, 0) || 0;
  }, [purchasesToday]);

  const totalPengeluaranHariIni = useMemo(() => {
    return expensesToday?.reduce((sum, e) => sum + e.amount, 0) || 0;
  }, [expensesToday]);

  const estimasiLabaHariIni = totalOmzetHariIni - totalPengeluaranHariIni;

  const handleOpenSession = async () => {
    const nominal = parseInt(initialCashStr.replace(/\D/g, "")) || 0;
    try {
      await openCashSession(nominal, sessionNotes);
      toast.success(`Kasir dibuka dengan modal awal ${formatRupiah(nominal)}`);
      setOpenSessionModal(false);
      setInitialCashStr("");
      setSessionNotes("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Gagal membuka sesi kasir");
    }
  };

  const handleCloseSession = async () => {
    if (!activeSession?.id) return;
    const actual = parseInt(actualCashStr.replace(/\D/g, "")) || 0;
    try {
      const closed = await closeCashSession(activeSession.id, actual, sessionNotes);
      const selisih = closed.cash_difference || 0;
      if (selisih === 0) {
        toast.success("Sesi kasir ditutup. Kas pas tanpa selisih!");
      } else if (selisih > 0) {
        toast.success(`Sesi kasir ditutup. Kas lebih: +${formatRupiah(selisih)}`);
      } else {
        toast.warning(`Sesi kasir ditutup. Kas selisih kurang: ${formatRupiah(selisih)}`);
      }
      setCloseSessionModal(false);
      setActualCashStr("");
      setSessionNotes("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Gagal menutup sesi kasir");
    }
  };

  return (
    <div className="p-4 space-y-4 pb-28 max-w-4xl mx-auto">
      {/* Header Utama */}
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Angkringan POS</h1>
          <p className="text-xs text-muted-foreground">
            {format(new Date(), "EEEE, dd MMMM yyyy", { locale: idLocale })}
          </p>
        </div>

        {/* Status Jaringan & Backup */}
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${
              isOnline
                ? "bg-green-500/10 border-green-500/20 text-green-600"
                : "bg-amber-500/10 border-amber-500/20 text-amber-600"
            }`}
          >
            {isOnline ? (
              <>
                <Wifi className="h-3.5 w-3.5" /> Online
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5" /> Offline
              </>
            )}
          </div>
        </div>
      </header>

      {/* Banner Status Sesi Kasir Buka/Tutup */}
      <div
        className={`border-2 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row justify-between sm:items-center gap-3 ${
          activeSession
            ? "bg-primary/5 border-primary/20"
            : "bg-muted/40 border-dashed border-border"
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`p-3 rounded-xl mt-0.5 ${
              activeSession
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <Store className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                  activeSession
                    ? "bg-green-500/20 text-green-700 dark:text-green-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {activeSession ? "Warung Buka" : "Warung Tutup"}
              </span>
              {activeSession && (
                <span className="text-xs text-muted-foreground">
                  Dibuka pk{" "}
                  {format(activeSession.opened_at, "HH:mm", {
                    locale: idLocale,
                  })}
                </span>
              )}
            </div>

            <div className="mt-1">
              {activeSession ? (
                <div>
                  <div className="text-sm font-semibold">
                    Modal Awal:{" "}
                    <strong className="text-foreground">
                      {formatRupiah(activeSession.initial_cash)}
                    </strong>
                  </div>
                  {currentSummary && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Estimasi Kas Fisik Laci:{" "}
                      <strong className="text-primary font-bold">
                        {formatRupiah(currentSummary.expectedCash)}
                      </strong>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Sesi kasir belum dibuka. Buka sesi untuk mencatat modal kas awal.
                </p>
              )}
            </div>
          </div>
        </div>

        <div>
          {activeSession ? (
            <Button
              variant="outline"
              className="w-full sm:w-auto h-11 rounded-xl font-bold border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => {
                if (currentSummary) {
                  setActualCashStr(String(currentSummary.expectedCash));
                }
                setCloseSessionModal(true);
              }}
            >
              Tutup Kasir Harian
            </Button>
          ) : (
            <Button
              className="w-full sm:w-auto h-11 rounded-xl font-bold shadow-sm"
              onClick={() => setOpenSessionModal(true)}
            >
              <PlusCircle className="h-4 w-4 mr-2" /> Buka Kasir Sekarang
            </Button>
          )}
        </div>
      </div>

      {/* Grid 4 Metrik Keuangan Hari Ini */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Omzet Penjualan */}
        <div className="bg-card border-2 border-border rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Penjualan Hari Ini
            </span>
            <DollarSign className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="text-lg sm:text-xl font-black text-primary">
              {formatRupiah(totalOmzetHariIni)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {salesToday?.length || 0} Transaksi Nota
            </div>
          </div>
        </div>

        {/* Pembelian Kulakan */}
        <div className="bg-card border-2 border-border rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Kulakan Hari Ini</span>
            <ShoppingBag className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <div className="text-lg sm:text-xl font-black text-blue-600">
              {formatRupiah(totalPembelianHariIni)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {purchasesToday?.length || 0} Catatan Kulakan
            </div>
          </div>
        </div>

        {/* Biaya Operasional */}
        <div className="bg-card border-2 border-border rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Beban Operasional
            </span>
            <TrendingDown className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <div className="text-lg sm:text-xl font-black text-destructive">
              {formatRupiah(totalPengeluaranHariIni)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {expensesToday?.length || 0} Pengeluaran Beban
            </div>
          </div>
        </div>

        {/* Laba Bersih */}
        <div
          className={`border-2 rounded-2xl p-4 shadow-sm flex flex-col justify-between ${
            estimasiLabaHariIni >= 0
              ? "bg-green-500/5 border-green-500/20"
              : "bg-destructive/5 border-destructive/20"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider ${
                estimasiLabaHariIni >= 0 ? "text-green-700" : "text-destructive"
              }`}
            >
              Laba Bersih Hari Ini
            </span>
            <Wallet
              className={`h-4 w-4 ${
                estimasiLabaHariIni >= 0 ? "text-green-600" : "text-destructive"
              }`}
            />
          </div>
          <div>
            <div
              className={`text-lg sm:text-xl font-black ${
                estimasiLabaHariIni >= 0 ? "text-green-600" : "text-destructive"
              }`}
            >
              {formatRupiah(Math.abs(estimasiLabaHariIni))}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Omzet - Beban</div>
          </div>
        </div>
      </div>

      {/* Tombol Pintasan Cepat (Action Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Link
          to="/"
          className="bg-primary text-primary-foreground p-3.5 rounded-2xl flex items-center justify-between font-bold text-sm shadow-sm active:scale-98 transition-transform"
        >
          <span>Kasir POS</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          to="/pengeluaran"
          className="bg-card hover:bg-muted/50 border-2 border-border p-3.5 rounded-2xl flex items-center justify-between font-bold text-sm active:scale-98 transition-transform"
        >
          <span className="flex items-center gap-1.5">
            <Receipt className="h-4 w-4 text-primary" /> Beban Operasional
          </span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link
          to="/pengeluaran"
          className="bg-card hover:bg-muted/50 border-2 border-border p-3.5 rounded-2xl flex items-center justify-between font-bold text-sm active:scale-98 transition-transform"
        >
          <span className="flex items-center gap-1.5">
            <Package className="h-4 w-4 text-blue-600" /> Kulakan Stok
          </span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link
          to="/pengeluaran"
          className="bg-card hover:bg-muted/50 border-2 border-border p-3.5 rounded-2xl flex items-center justify-between font-bold text-sm active:scale-98 transition-transform"
        >
          <span className="flex items-center gap-1.5">
            <Layers className="h-4 w-4 text-amber-500" /> Konsinyasi
          </span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>

      {/* Transaksi Terakhir & Status Backup */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Transaksi Terkini (2 Kolom di Desktop) */}
        <div className="sm:col-span-2 bg-card border-2 border-border rounded-2xl p-4 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-bold">Transaksi Penjualan Terkini</h2>
            </div>
            <Link
              to="/riwayat"
              className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
            >
              Lihat Semua <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="divide-y divide-border">
            {recentSales && recentSales.length > 0 ? (
              recentSales.map((s) => (
                <div key={s.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold flex items-center gap-2">
                      <span>{s.customer_name || "Guest"}</span>
                      {s.is_member && (
                        <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1.5 py-0.2 rounded font-black">
                          MEMBER
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {s.invoice_number || "TRX-NOTA"} •{" "}
                      {format(s.transaction_date, "HH:mm, dd MMM", {
                        locale: idLocale,
                      })}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-black text-primary">
                      {formatRupiah(s.total_amount)}
                    </div>
                    <div
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded inline-block ${
                        s.payment_method === "QRIS"
                          ? "bg-blue-500/10 text-blue-600"
                          : "bg-green-500/10 text-green-600"
                      }`}
                    >
                      {s.payment_method}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground text-xs opacity-60">
                Belum ada transaksi penjualan tercatat.
              </div>
            )}
          </div>
        </div>

        {/* Status Backup & Sistem (1 Kolom) */}
        <div className="bg-card border-2 border-border rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Database className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold">Status Pencadangan</h2>
            </div>

            <div className="space-y-2 text-xs">
              <div className="bg-muted/40 p-3 rounded-xl border">
                <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                  Pencadangan Terakhir
                </span>
                <span className="font-semibold text-foreground text-xs mt-0.5 block">
                  {lastBackup
                    ? format(lastBackup.created_at, "dd MMM yyyy, HH:mm", {
                        locale: idLocale,
                      })
                    : "Belum pernah dicadangkan"}
                </span>
                {lastBackup && (
                  <span className="text-[10px] text-muted-foreground mt-0.5 block truncate">
                    {lastBackup.file_name}
                  </span>
                )}
              </div>

              <div className="bg-muted/40 p-3 rounded-xl border">
                <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                  Penyimpanan Data Utama
                </span>
                <span className="font-semibold text-foreground text-xs mt-0.5 block">
                  IndexedDB Lokal (Offline-First)
                </span>
                <span className="text-[10px] text-green-600 font-bold mt-0.5 block">
                  ✔ Siap beroperasi tanpa internet
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t">
            <Link to="/kelola">
              <Button variant="outline" className="w-full h-10 rounded-xl text-xs font-bold">
                Buka Pengaturan Backup
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Modal Buka Kasir */}
      <Dialog open={openSessionModal} onOpenChange={setOpenSessionModal}>
        <DialogContent
          className="rounded-3xl max-w-[90vw] sm:max-w-[400px] p-6"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-xl">Buka Kasir Angkringan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Masukkan modal awal uang kembalian yang dimasukkan ke laci kasir sebelum mulai
              melayani pelanggan.
            </p>
            <div className="space-y-1.5">
              <Label className="font-bold text-xs">Modal Awal Kas (Rp)</Label>
              <Input
                inputMode="numeric"
                placeholder="Contoh: 150000"
                value={initialCashStr}
                onChange={(e) => setInitialCashStr(e.target.value.replace(/\D/g, ""))}
                className="h-14 text-xl font-black rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="font-bold text-xs">Catatan Pembukaan (Opsional)</Label>
              <Input
                placeholder="Contoh: Buka tepat jam 17:00"
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button
                variant="outline"
                className="h-12 rounded-xl font-bold"
                onClick={() => setOpenSessionModal(false)}
              >
                Batal
              </Button>
              <Button className="h-12 rounded-xl font-bold" onClick={handleOpenSession}>
                Buka Sesi
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Tutup Kasir & Rekonsiliasi Kas */}
      <Dialog open={closeSessionModal} onOpenChange={setCloseSessionModal}>
        <DialogContent
          className="rounded-3xl max-w-[90vw] sm:max-w-[420px] p-6 max-h-[85vh] overflow-y-auto"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-xl">Tutup Kasir & Hitung Fisik</DialogTitle>
          </DialogHeader>

          {currentSummary && (
            <div className="space-y-4 py-2">
              <div className="bg-muted/50 border rounded-2xl p-3.5 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Modal Awal:</span>
                  <span className="font-bold">{formatRupiah(currentSummary.initialCash)}</span>
                </div>
                <div className="flex justify-between text-green-600">
                  <span>+ Penjualan Tunai:</span>
                  <span className="font-bold">+{formatRupiah(currentSummary.cashSales)}</span>
                </div>
                {currentSummary.cashPurchases > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>- Pembelian Kulakan Tunai:</span>
                    <span className="font-bold">-{formatRupiah(currentSummary.cashPurchases)}</span>
                  </div>
                )}
                {currentSummary.cashExpenses > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>- Pengeluaran Beban Tunai:</span>
                    <span className="font-bold">-{formatRupiah(currentSummary.cashExpenses)}</span>
                  </div>
                )}
                {currentSummary.cashSettlements > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>- Setoran Konsinyasi Tunai:</span>
                    <span className="font-bold">
                      -{formatRupiah(currentSummary.cashSettlements)}
                    </span>
                  </div>
                )}
                <div className="border-t pt-2 flex justify-between font-black text-sm">
                  <span>Kas Seharusnya di Laci:</span>
                  <span className="text-primary font-black">
                    {formatRupiah(currentSummary.expectedCash)}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground italic">
                  *Penjualan QRIS ({formatRupiah(currentSummary.qrisSales)}) tidak masuk laci kas
                  fisik.
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="font-bold text-xs">Uang Tunai Fisik Aktual di Laci (Rp)</Label>
                <Input
                  inputMode="numeric"
                  placeholder="Hitung uang riil di laci..."
                  value={actualCashStr}
                  onChange={(e) => setActualCashStr(e.target.value.replace(/\D/g, ""))}
                  className="h-14 text-xl font-black rounded-xl text-center"
                />
              </div>

              {actualCashStr && (
                <div
                  className={`p-3 rounded-xl border text-center text-xs font-bold ${
                    parseInt(actualCashStr.replace(/\D/g, "")) - currentSummary.expectedCash === 0
                      ? "bg-green-500/10 border-green-500/20 text-green-700"
                      : parseInt(actualCashStr.replace(/\D/g, "")) - currentSummary.expectedCash > 0
                        ? "bg-blue-500/10 border-blue-500/20 text-blue-700"
                        : "bg-destructive/10 border-destructive/20 text-destructive"
                  }`}
                >
                  Selisih Kas:{" "}
                  {formatRupiah(
                    parseInt(actualCashStr.replace(/\D/g, "")) - currentSummary.expectedCash,
                  )}
                  {parseInt(actualCashStr.replace(/\D/g, "")) - currentSummary.expectedCash === 0 &&
                    " (Pas!)"}
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="font-bold text-xs">Catatan Penutupan</Label>
                <Input
                  placeholder="Catatan hari ini (opsional)..."
                  value={sessionNotes}
                  onChange={(e) => setSessionNotes(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button
                  variant="outline"
                  className="h-12 rounded-xl font-bold"
                  onClick={() => setCloseSessionModal(false)}
                >
                  Batal
                </Button>
                <Button
                  className="h-12 rounded-xl font-bold bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  onClick={handleCloseSession}
                >
                  Simpan & Tutup Kasir
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
