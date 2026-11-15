import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useState, useMemo, useEffect } from "react";
import {
  db,
  type Expense,
  type Purchase,
  type Consignor,
  type ConsignmentBatch,
  type ConsignmentItem,
  generateInvoiceNumber,
  generateUUID,
} from "@/lib/db";
import { formatRupiah } from "@/lib/format";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import {
  getActiveCashSession,
  openCashSession,
  closeCashSession,
  calculateSessionSummary,
} from "@/lib/session-helper";
import {
  receiveConsignmentItem,
  returnConsignmentStock,
  recordConsignmentPayment,
  computeBatchSummary,
} from "@/lib/consignment-service";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Trash2,
  TrendingDown,
  ShoppingBag,
  Zap,
  Plus,
  Package,
  Layers,
  Store,
  DollarSign,
  User,
  CheckCircle2,
  AlertCircle,
  FileText,
  RotateCcw,
  History,
  Calendar,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/pengeluaran")({
  head: () => ({ meta: [{ title: "Catat Operasional — Angkringan POS" }] }),
  component: OperasionalHubPage,
});

function OperasionalHubPage() {
  const [activeTab, setActiveTab] = useState("beban");

  return (
    <div className="p-4 space-y-4 pb-28 max-w-4xl mx-auto">
      <header>
        <h1 className="text-xl font-bold tracking-tight">Catat Operasional</h1>
        <p className="text-xs text-muted-foreground">
          Kelola arus keluar kas: beban usaha, kulakan dagangan, konsinyasi & sesi kas
        </p>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="overflow-x-auto no-scrollbar pb-1">
          <TabsList className="grid grid-cols-4 w-full h-13 rounded-2xl bg-muted/60 p-1">
            <TabsTrigger
              value="beban"
              className="rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm"
            >
              <TrendingDown className="h-4 w-4 text-destructive" />
              <span>Beban</span>
            </TabsTrigger>
            <TabsTrigger
              value="kulakan"
              className="rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm"
            >
              <ShoppingBag className="h-4 w-4 text-blue-600" />
              <span>Kulakan</span>
            </TabsTrigger>
            <TabsTrigger
              value="konsinyasi"
              className="rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm"
            >
              <Layers className="h-4 w-4 text-amber-500" />
              <span>Konsinyasi</span>
            </TabsTrigger>
            <TabsTrigger
              value="sesi"
              className="rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm"
            >
              <Store className="h-4 w-4 text-primary" />
              <span>Sesi Kas</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="beban" className="m-0 mt-3 outline-none">
          <ExpensesTab />
        </TabsContent>
        <TabsContent value="kulakan" className="m-0 mt-3 outline-none">
          <PurchasesTab />
        </TabsContent>
        <TabsContent value="konsinyasi" className="m-0 mt-3 outline-none">
          <ConsignmentTab />
        </TabsContent>
        <TabsContent value="sesi" className="m-0 mt-3 outline-none">
          <CashSessionTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ==========================================
// 1. TAB BIAYA OPERASIONAL (NON-KULAKAN)
// ==========================================
const OPERATIONAL_CATEGORIES = [
  "Operasional",
  "Es Batu",
  "Gas & Arang",
  "Listrik & Air",
  "Kebersihan & Plastik",
  "Gaji",
  "Sewa",
  "Lain-lain",
];

const OPERATIONAL_TEMPLATES = [
  { label: "🧊 Es Batu", desc: "Beli Es Batu Balok/Kristal", cat: "Es Batu" },
  { label: "🔥 Gas LPG", desc: "Isi Ulang Gas LPG 3kg", cat: "Gas & Arang" },
  { label: "🪵 Arang", desc: "Beli Arang Bakar", cat: "Gas & Arang" },
  { label: "⚡ Token Listrik", desc: "Beli Token Listrik", cat: "Listrik & Air" },
  {
    label: "🛍️ Plastik/Kresek",
    desc: "Beli Plastik & Kertas Bungkus",
    cat: "Kebersihan & Plastik",
  },
];

function ExpensesTab() {
  const [timeFilter, setTimeFilter] = useState<"today" | "yesterday" | "this_month" | "all">(
    "today",
  );
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(OPERATIONAL_CATEGORIES[0]);
  const [paymentMethod, setPaymentMethod] = useState<"Cash" | "Transfer">("Cash");

  const expenses = useLiveQuery(() => {
    const now = new Date();
    if (timeFilter === "all")
      return db.expenses.orderBy("expense_date").reverse().limit(150).toArray();

    let start = 0;
    let end = now.getTime() + 86400000;
    if (timeFilter === "today") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      end = start + 86400000;
    } else if (timeFilter === "yesterday") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
      end = start + 86400000;
    } else if (timeFilter === "this_month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    }
    return db.expenses.where("expense_date").between(start, end).reverse().toArray();
  }, [timeFilter]);

  const totalExpenseFiltered = useMemo(() => {
    return expenses?.reduce((sum, e) => sum + e.amount, 0) || 0;
  }, [expenses]);

  const applyTemplate = (t: (typeof OPERATIONAL_TEMPLATES)[0]) => {
    setDescription(t.desc);
    setCategory(t.cat);
    toast.success(`${t.label} dipilih`, { duration: 1000 });
  };

  const submitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseInt(amount.replace(/\D/g, "")) || 0;
    if (!description.trim() || amt <= 0) {
      toast.error("Lengkapi deskripsi dan nominal pengeluaran");
      return;
    }

    const activeSession = await getActiveCashSession();

    await db.expenses.add({
      uuid: generateUUID(),
      expense_date: new Date(date).getTime(),
      description: description.trim(),
      amount: amt,
      category,
      payment_method: paymentMethod,
      session_id: paymentMethod === "Cash" ? activeSession?.id : undefined,
      created_at: Date.now(),
      updated_at: Date.now(),
      sync_status: "synced",
    });

    setDescription("");
    setAmount("");
    toast.success("Biaya operasional berhasil dicatat!");
  };

  const removeExpense = async (id: number) => {
    if (confirm("Hapus catatan beban pengeluaran ini?")) {
      await db.expenses.delete(id);
      toast.success("Berhasil dihapus");
    }
  };

  return (
    <div className="space-y-4">
      {/* Kartu Formulir Tambah Beban */}
      <form
        onSubmit={submitExpense}
        className="bg-card border-2 border-border rounded-2xl p-4 sm:p-5 shadow-sm space-y-3.5"
      >
        <div className="flex justify-between items-center pb-2 border-b">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <TrendingDown className="h-4 w-4 text-destructive" /> Input Beban Operasional
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={paymentMethod === "Cash" ? "default" : "outline"}
              className="h-8 rounded-lg text-xs font-bold"
              onClick={() => setPaymentMethod("Cash")}
            >
              Tunai (Kas Laci)
            </Button>
            <Button
              type="button"
              size="sm"
              variant={paymentMethod === "Transfer" ? "default" : "outline"}
              className="h-8 rounded-lg text-xs font-bold"
              onClick={() => setPaymentMethod("Transfer")}
            >
              Transfer Bank
            </Button>
          </div>
        </div>

        <div>
          <Label className="text-xs font-bold text-muted-foreground ml-1 mb-2 flex items-center gap-1">
            <Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-500" /> Template Cepat
          </Label>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {OPERATIONAL_TEMPLATES.map((t, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => applyTemplate(t)}
                className="whitespace-nowrap bg-muted/60 hover:bg-muted border border-border rounded-full px-3.5 py-1.5 text-xs font-semibold active:scale-95 transition-transform"
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs font-bold ml-1">Keterangan Pengeluaran</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Contoh: Es batu kristal 2 kantong"
              className="h-12 rounded-xl"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold ml-1">Nominal (Rp)</Label>
            <Input
              inputMode="numeric"
              value={amount ? formatRupiah(parseInt(amount.replace(/\D/g, "")) || 0) : ""}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              placeholder="Rp 0"
              className="h-12 rounded-xl font-bold text-destructive"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs font-bold ml-1">Kategori</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {OPERATIONAL_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold ml-1">Tanggal</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
        </div>

        <Button type="submit" className="w-full h-12 rounded-xl font-bold text-base mt-2">
          Simpan Beban Operasional
        </Button>
      </form>

      {/* Filter dan Ringkasan */}
      <div className="flex justify-between items-center">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          <Button
            size="sm"
            variant={timeFilter === "today" ? "default" : "outline"}
            className="rounded-full h-9 px-4 text-xs font-bold"
            onClick={() => setTimeFilter("today")}
          >
            Hari Ini
          </Button>
          <Button
            size="sm"
            variant={timeFilter === "yesterday" ? "default" : "outline"}
            className="rounded-full h-9 px-4 text-xs font-bold"
            onClick={() => setTimeFilter("yesterday")}
          >
            Kemarin
          </Button>
          <Button
            size="sm"
            variant={timeFilter === "this_month" ? "default" : "outline"}
            className="rounded-full h-9 px-4 text-xs font-bold"
            onClick={() => setTimeFilter("this_month")}
          >
            Bulan Ini
          </Button>
          <Button
            size="sm"
            variant={timeFilter === "all" ? "default" : "outline"}
            className="rounded-full h-9 px-4 text-xs font-bold"
            onClick={() => setTimeFilter("all")}
          >
            Semua
          </Button>
        </div>

        <div className="text-right">
          <span className="text-[10px] text-muted-foreground uppercase font-bold block">
            Total Beban
          </span>
          <span className="text-sm font-black text-destructive">
            {formatRupiah(totalExpenseFiltered)}
          </span>
        </div>
      </div>

      {/* Daftar Pengeluaran */}
      <div className="space-y-2">
        {expenses?.map((e) => (
          <div
            key={e.id}
            className="bg-card border rounded-2xl p-3.5 shadow-sm flex items-center justify-between"
          >
            <div>
              <div className="font-bold text-sm">{e.description}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
                <span className="bg-muted px-2 py-0.5 rounded font-semibold">{e.category}</span>
                <span>{format(e.expense_date, "dd MMM yyyy", { locale: idLocale })}</span>
                <span
                  className={
                    e.payment_method === "Transfer"
                      ? "text-blue-600 font-bold"
                      : "text-green-600 font-bold"
                  }
                >
                  {e.payment_method || "Cash"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-black text-sm text-destructive">{formatRupiah(e.amount)}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={() => e.id && removeExpense(e.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}

        {expenses?.length === 0 && (
          <div className="text-center py-10 text-muted-foreground text-xs opacity-60">
            Tidak ada catatan beban operasional pada periode ini.
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 2. TAB KULAKAN (PEMBELIAN BARANG DAGANGAN)
// ==========================================
function PurchasesTab() {
  const inventoryList = useLiveQuery(() => db.inventory.toArray(), []);
  const [purchaseDate, setPurchaseDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [supplierName, setSupplierName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"Cash" | "Transfer">("Cash");
  const [itemName, setItemName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("Bungkus");
  const [unitPrice, setUnitPrice] = useState("");
  const [autoUpdateStock, setAutoUpdateStock] = useState(true);
  const [selectedInventoryId, setSelectedInventoryId] = useState<string>("none");

  const purchases = useLiveQuery(
    () => db.purchases.orderBy("purchase_date").reverse().limit(100).toArray(),
    [],
  );

  const totalPurchases = useMemo(() => {
    return purchases?.reduce((sum, p) => sum + p.total_amount, 0) || 0;
  }, [purchases]);

  const subtotalCalc = useMemo(() => {
    const q = parseFloat(qty) || 0;
    const price = parseInt(unitPrice.replace(/\D/g, "")) || 0;
    return Math.round(q * price);
  }, [qty, unitPrice]);

  const handleSelectInventory = (val: string) => {
    setSelectedInventoryId(val);
    if (val !== "none") {
      const inv = inventoryList?.find((i) => String(i.id) === val);
      if (inv) {
        setItemName(inv.name);
        setUnit(inv.unit);
        setUnitPrice(String(inv.cost_per_unit || ""));
      }
    }
  };

  const submitPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = parseFloat(qty) || 0;
    const price = parseInt(unitPrice.replace(/\D/g, "")) || 0;
    if (!itemName.trim() || q <= 0 || price <= 0) {
      toast.error("Lengkapi nama barang, jumlah kuantitas, dan harga beli");
      return;
    }

    const total = Math.round(q * price);
    const invoiceNumber = generateInvoiceNumber("PUR");
    const activeSession = await getActiveCashSession();

    try {
      await db.transaction("rw", db.purchases, db.purchase_details, db.inventory, async () => {
        const purchaseId = await db.purchases.add({
          uuid: generateUUID(),
          invoice_number: invoiceNumber,
          purchase_date: new Date(purchaseDate).getTime(),
          supplier_name: supplierName.trim() || undefined,
          payment_method: paymentMethod,
          total_amount: total,
          session_id: paymentMethod === "Cash" ? activeSession?.id : undefined,
          created_at: Date.now(),
          updated_at: Date.now(),
          sync_status: "synced",
        });

        await db.purchase_details.add({
          uuid: generateUUID(),
          purchase_id: purchaseId,
          item_name: itemName.trim(),
          quantity: q,
          unit: unit.trim() || "Pcs",
          unit_price: price,
          subtotal: total,
          created_at: Date.now(),
        });

        // Update stok gudang jika opsi aktif
        if (autoUpdateStock) {
          let targetInv = null;
          if (selectedInventoryId !== "none") {
            targetInv = await db.inventory.get(Number(selectedInventoryId));
          } else {
            targetInv = await db.inventory
              .filter((i) => i.name.toLowerCase() === itemName.trim().toLowerCase())
              .first();
          }

          if (targetInv && targetInv.id) {
            await db.inventory.update(targetInv.id, {
              stock: targetInv.stock + q,
              cost_per_unit: price,
              last_updated: Date.now(),
            });
          } else {
            // Tambahkan entri baru ke gudang
            await db.inventory.add({
              uuid: generateUUID(),
              name: itemName.trim(),
              stock: q,
              unit: unit.trim() || "Pcs",
              cost_per_unit: price,
              last_updated: Date.now(),
              created_at: Date.now(),
              updated_at: Date.now(),
              sync_status: "synced",
            });
          }
        }
      });

      toast.success(`Kulakan ${itemName} (${q} ${unit}) berhasil dicatat!`);
      setItemName("");
      setQty("");
      setUnitPrice("");
      setSelectedInventoryId("none");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Gagal mencatat pembelian kulakan");
    }
  };

  const removePurchase = async (id: number) => {
    if (confirm("Hapus catatan pembelian kulakan ini?")) {
      await db.transaction("rw", db.purchases, db.purchase_details, async () => {
        await db.purchases.delete(id);
        await db.purchase_details.where("purchase_id").equals(id).delete();
      });
      toast.success("Catatan kulakan dihapus");
    }
  };

  return (
    <div className="space-y-4">
      {/* Form Input Pembelian */}
      <form
        onSubmit={submitPurchase}
        className="bg-card border-2 border-border rounded-2xl p-4 sm:p-5 shadow-sm space-y-3.5"
      >
        <div className="flex justify-between items-center pb-2 border-b">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ShoppingBag className="h-4 w-4 text-blue-600" /> Catat Pembelian Dagangan (Kulakan)
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={paymentMethod === "Cash" ? "default" : "outline"}
              className="h-8 rounded-lg text-xs font-bold"
              onClick={() => setPaymentMethod("Cash")}
            >
              Tunai (Kas Laci)
            </Button>
            <Button
              type="button"
              size="sm"
              variant={paymentMethod === "Transfer" ? "default" : "outline"}
              className="h-8 rounded-lg text-xs font-bold"
              onClick={() => setPaymentMethod("Transfer")}
            >
              Transfer Bank
            </Button>
          </div>
        </div>

        {/* Tautkan ke Gudang */}
        <div className="space-y-1">
          <Label className="text-xs font-bold ml-1 text-muted-foreground">
            Pilih dari Stok Gudang (Opsional)
          </Label>
          <Select value={selectedInventoryId} onValueChange={handleSelectInventory}>
            <SelectTrigger className="h-11 rounded-xl">
              <SelectValue placeholder="Pilih barang yang sudah ada..." />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="none">-- Tulis Barang Baru --</SelectItem>
              {inventoryList?.map((inv) => (
                <SelectItem key={inv.id} value={String(inv.id)}>
                  {inv.name} (Stok: {inv.stock} {inv.unit})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs font-bold ml-1">Nama Barang Dagangan</Label>
            <Input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="Contoh: Rokok Surya 12, Kopi Kapal Api"
              className="h-12 rounded-xl font-bold"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold ml-1">Nama Toko / Grosir (Opsional)</Label>
            <Input
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="Contoh: Toko Berkah, Grosir Utama"
              className="h-12 rounded-xl"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="space-y-1">
            <Label className="text-xs font-bold ml-1">Jumlah</Label>
            <Input
              type="number"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="10"
              className="h-12 rounded-xl font-black text-center"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold ml-1">Satuan</Label>
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="Bungkus"
              className="h-12 rounded-xl text-center"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold ml-1">Harga Beli/Satuan</Label>
            <Input
              inputMode="numeric"
              value={unitPrice ? formatRupiah(parseInt(unitPrice.replace(/\D/g, "")) || 0) : ""}
              onChange={(e) => setUnitPrice(e.target.value.replace(/\D/g, ""))}
              placeholder="Rp 0"
              className="h-12 rounded-xl font-bold text-right text-blue-600"
            />
          </div>
        </div>

        {/* Subtotal & Opsi Gudang */}
        <div className="bg-muted/40 p-3.5 rounded-xl border flex flex-col sm:flex-row justify-between sm:items-center gap-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="autoStock"
              checked={autoUpdateStock}
              onCheckedChange={(c) => setAutoUpdateStock(Boolean(c))}
            />
            <label htmlFor="autoStock" className="text-xs font-bold cursor-pointer">
              Otomatis tambah kuantitas ke stok gudang
            </label>
          </div>

          <div className="text-right">
            <span className="text-[10px] text-muted-foreground uppercase font-bold mr-2">
              Total Pembelian:
            </span>
            <span className="text-lg font-black text-blue-600">{formatRupiah(subtotalCalc)}</span>
          </div>
        </div>

        <Button
          type="submit"
          className="w-full h-12 rounded-xl font-bold text-base mt-2 bg-blue-600 hover:bg-blue-700 text-white"
        >
          Simpan Pembelian Kulakan
        </Button>
      </form>

      {/* Ringkasan & Riwayat */}
      <div className="flex justify-between items-center">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Riwayat Kulakan
        </h3>
        <span className="text-xs font-bold text-muted-foreground">
          Total: <strong className="text-foreground">{formatRupiah(totalPurchases)}</strong>
        </span>
      </div>

      <div className="space-y-2">
        {purchases?.map((p) => (
          <div
            key={p.id}
            className="bg-card border rounded-2xl p-3.5 shadow-sm flex items-center justify-between"
          >
            <div>
              <div className="font-bold text-sm">
                {p.supplier_name ? `Grosir: ${p.supplier_name}` : p.invoice_number}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
                <span>{p.invoice_number}</span>
                <span>•</span>
                <span>{format(p.purchase_date, "dd MMM yyyy", { locale: idLocale })}</span>
                <span
                  className={
                    p.payment_method === "Transfer"
                      ? "text-blue-600 font-bold"
                      : "text-green-600 font-bold"
                  }
                >
                  {p.payment_method}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-black text-sm text-blue-600">
                {formatRupiah(p.total_amount)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={() => p.id && removePurchase(p.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}

        {purchases?.length === 0 && (
          <div className="text-center py-10 text-muted-foreground text-xs opacity-60">
            Belum ada catatan pembelian kulakan barang dagangan.
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 3. TAB KONSINYASI (TITIP JUAL)
// ==========================================
function ConsignmentTab() {
  const consignors = useLiveQuery(() => db.consignors.toArray(), []);
  const batches = useLiveQuery(
    () => db.consignment_batches.orderBy("start_date").reverse().toArray(),
    [],
  );
  const items = useLiveQuery(() => db.consignment_items.toArray(), []);
  const returns = useLiveQuery(
    () => db.consignment_returns.orderBy("return_date").reverse().toArray(),
    [],
  );
  const payments = useLiveQuery(
    () => db.consignment_payments.orderBy("payment_date").reverse().toArray(),
    [],
  );

  const [batchFilter, setBatchFilter] = useState<"all" | "active" | "settled">("active");

  // State Dialog
  const [addConsignorOpen, setAddConsignorOpen] = useState(false);
  const [addBatchOpen, setAddBatchOpen] = useState(false);
  const [returnModal, setReturnModal] = useState<{
    batch: ConsignmentBatch;
    item: ConsignmentItem;
  } | null>(null);
  const [settleModal, setSettleModal] = useState<{
    batch: ConsignmentBatch;
    item: ConsignmentItem;
  } | null>(null);
  const [historyModal, setHistoryModal] = useState<{
    batch: ConsignmentBatch;
    item: ConsignmentItem;
  } | null>(null);

  // State Form Penitip Baru
  const [consignorName, setConsignorName] = useState("");
  const [consignorPhone, setConsignorPhone] = useState("");
  const [consignorPeriod, setConsignorPeriod] = useState<"7" | "14" | "30" | "custom">("14");
  const [consignorNotes, setConsignorNotes] = useState("");

  // State Form Penerimaan Batch
  const [selectedConsignorId, setSelectedConsignorId] = useState("");
  const [consignmentItemName, setConsignmentItemName] = useState("");
  const [qtyReceived, setQtyReceived] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [payoutPerUnit, setPayoutPerUnit] = useState("");
  const [batchPeriodType, setBatchPeriodType] = useState<"7" | "14" | "30" | "custom">("14");
  const [customStartDateStr, setCustomStartDateStr] = useState(format(new Date(), "yyyy-MM-dd"));
  const [customEndDateStr, setCustomEndDateStr] = useState(
    format(new Date(Date.now() + 14 * 86400000), "yyyy-MM-dd"),
  );
  const [batchNotes, setBatchNotes] = useState("");

  // State Form Retur Mandiri
  const [returnQtyStr, setReturnQtyStr] = useState("1");
  const [returnNotes, setReturnNotes] = useState("");
  const [returnDateStr, setReturnDateStr] = useState(format(new Date(), "yyyy-MM-dd"));

  // State Form Penyelesaian & Pembayaran
  const [amountPaidStr, setAmountPaidStr] = useState("");
  const [settlementMethod, setSettlementMethod] = useState<"Cash" | "Transfer">("Cash");
  const [markAsSettled, setMarkAsSettled] = useState(true);
  const [paymentNotes, setPaymentNotes] = useState("");

  // Saat penitip dipilih, auto-isi default period-nya
  useEffect(() => {
    if (selectedConsignorId && consignors) {
      const c = consignors.find((c) => String(c.id) === selectedConsignorId);
      if (c && c.default_period_days) {
        if (c.default_period_days === "custom") {
          setBatchPeriodType("custom");
        } else {
          setBatchPeriodType(String(c.default_period_days) as "7" | "14" | "30");
        }
      }
    }
  }, [selectedConsignorId, consignors]);

  // Submit Pendaftaran Penitip
  const submitConsignor = async () => {
    if (!consignorName.trim()) return toast.error("Nama penitip wajib diisi");
    const periodVal = consignorPeriod === "custom" ? "custom" : Number(consignorPeriod);

    await db.consignors.add({
      uuid: generateUUID(),
      name: consignorName.trim(),
      phone: consignorPhone.trim() || undefined,
      notes: consignorNotes.trim() || undefined,
      default_period_days: periodVal,
      is_active: true,
      created_at: Date.now(),
      updated_at: Date.now(),
      sync_status: "synced",
    });
    toast.success(`Penitip ${consignorName} berhasil didaftarkan!`);
    setConsignorName("");
    setConsignorPhone("");
    setConsignorNotes("");
    setAddConsignorOpen(false);
  };

  // Submit Penerimaan Barang Titipan
  const submitBatch = async () => {
    const cId = Number(selectedConsignorId);
    const qtyIn = parseInt(qtyReceived) || 0;
    const sPrice = parseInt(sellPrice.replace(/\D/g, "")) || 0;
    const pPrice = parseInt(payoutPerUnit.replace(/\D/g, "")) || 0;

    if (!cId || !consignmentItemName.trim() || qtyIn <= 0 || sPrice <= 0 || pPrice <= 0) {
      return toast.error("Lengkapi semua data batch titipan barang!");
    }

    if (pPrice > sPrice) {
      return toast.error("Nilai setoran ke penitip tidak boleh lebih besar dari harga jual!");
    }

    let periodVal: number | "custom" = 14;
    let customStart: number | undefined;
    let customEnd: number | undefined;

    if (batchPeriodType === "custom") {
      periodVal = "custom";
      customStart = new Date(customStartDateStr).getTime();
      customEnd = new Date(customEndDateStr).getTime();
      if (isNaN(customStart) || isNaN(customEnd) || customEnd <= customStart) {
        return toast.error("Rentang tanggal periode kustom tidak valid!");
      }
    } else {
      periodVal = Number(batchPeriodType);
    }

    try {
      await receiveConsignmentItem({
        consignorId: cId,
        itemName: consignmentItemName.trim(),
        qtyReceived: qtyIn,
        sellPrice: sPrice,
        payoutPerUnit: pPrice,
        periodDays: periodVal,
        customStartDate: customStart,
        customEndDate: customEnd,
        notes: batchNotes.trim() || undefined,
      });

      toast.success(
        `Batch titipan ${consignmentItemName} (${qtyIn} bungkus) aktif & terhubung ke Gudang & Kasir!`,
      );
      setConsignmentItemName("");
      setQtyReceived("");
      setSellPrice("");
      setPayoutPerUnit("");
      setBatchNotes("");
      setAddBatchOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mencatat penerimaan barang titipan");
    }
  };

  // Eksekusi Retur Mandiri ke Penjual
  const handleConfirmReturn = async () => {
    if (!returnModal) return;
    const qty = parseInt(returnQtyStr) || 0;
    if (qty <= 0) return toast.error("Jumlah retur harus lebih besar dari 0");

    const retDate = new Date(returnDateStr).getTime() || Date.now();

    try {
      const res = await returnConsignmentStock({
        batchId: returnModal.batch.id!,
        qtyToReturn: qty,
        returnDate: retDate,
        notes: returnNotes.trim() || undefined,
      });

      toast.success(
        `Berhasil retur ${qty} bungkus ${returnModal.item.item_name}! Sisa di batch: ${res.remainingInBatch} bungkus.`,
      );
      setReturnModal(null);
      setReturnQtyStr("1");
      setReturnNotes("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses retur barang");
    }
  };

  // Eksekusi Pembayaran Setoran & Penyelesaian
  const handleConfirmPayment = async () => {
    if (!settleModal) return;
    const amount = parseInt(amountPaidStr.replace(/\D/g, "")) || 0;
    if (amount <= 0 && !markAsSettled) {
      return toast.error("Masukkan nominal pembayaran yang valid!");
    }

    try {
      if (amount > 0) {
        await recordConsignmentPayment({
          batchId: settleModal.batch.id!,
          consignorId: settleModal.batch.consignor_id,
          amount,
          paymentMethod: settlementMethod,
          notes: paymentNotes.trim() || undefined,
        });
      }

      if (markAsSettled) {
        await db.consignment_batches.update(settleModal.batch.id!, {
          status: "settled",
          updated_at: Date.now(),
        });
      }

      toast.success(
        amount > 0
          ? `Pembayaran setoran ${formatRupiah(amount)} (${settlementMethod}) berhasil dicatat!`
          : "Status batch diperbarui menjadi selesai!",
      );
      setSettleModal(null);
      setAmountPaidStr("");
      setPaymentNotes("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses pembayaran setoran");
    }
  };

  // Filter batch sesuai tab
  const filteredBatches = useMemo(() => {
    if (!batches) return [];
    if (batchFilter === "all") return batches;
    return batches.filter((b) => b.status === batchFilter);
  }, [batches, batchFilter]);

  const activeBatchCount = useMemo(
    () => batches?.filter((b) => b.status === "active").length || 0,
    [batches],
  );
  const settledBatchCount = useMemo(
    () => batches?.filter((b) => b.status === "settled").length || 0,
    [batches],
  );

  return (
    <div className="space-y-4">
      {/* Tombol Aksi Utama */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          onClick={() => setAddConsignorOpen(true)}
          variant="outline"
          className="h-12 rounded-xl font-bold text-xs sm:text-sm border-2"
        >
          <User className="h-4 w-4 mr-1.5 text-primary" /> Kelola Penitip ({consignors?.length || 0}
          )
        </Button>
        <Button
          onClick={() => setAddBatchOpen(true)}
          className="h-12 rounded-xl font-bold text-xs sm:text-sm shadow-sm"
        >
          <Plus className="h-4 w-4 mr-1.5" /> Terima Barang Titipan
        </Button>
      </div>

      {/* Filter Status Batch */}
      <div className="grid grid-cols-3 gap-2 bg-muted/60 p-1 rounded-xl">
        <button
          type="button"
          onClick={() => setBatchFilter("active")}
          className={`py-2 text-xs font-bold rounded-lg transition-all ${
            batchFilter === "active"
              ? "bg-card text-amber-600 shadow-sm"
              : "text-muted-foreground hover:text-amber-600"
          }`}
        >
          Aktif ({activeBatchCount})
        </button>
        <button
          type="button"
          onClick={() => setBatchFilter("settled")}
          className={`py-2 text-xs font-bold rounded-lg transition-all ${
            batchFilter === "settled"
              ? "bg-card text-green-600 shadow-sm"
              : "text-muted-foreground hover:text-green-600"
          }`}
        >
          Selesai ({settledBatchCount})
        </button>
        <button
          type="button"
          onClick={() => setBatchFilter("all")}
          className={`py-2 text-xs font-bold rounded-lg transition-all ${
            batchFilter === "all"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Semua ({batches?.length || 0})
        </button>
      </div>

      {/* List Batch Konsinyasi */}
      <div className="space-y-3">
        {filteredBatches.map((b) => {
          const consignor = consignors?.find((c) => c.id === b.consignor_id);
          const cItem = items?.find((it) => it.batch_id === b.id);
          if (!cItem) return null;

          const s = computeBatchSummary(b, cItem, consignor);

          return (
            <div
              key={b.id}
              className={`border-2 rounded-2xl p-4 shadow-sm space-y-3.5 transition-all ${
                b.status === "active"
                  ? s.isOverdue
                    ? "bg-card border-destructive/40 ring-1 ring-destructive/20"
                    : s.isDueSoon
                      ? "bg-card border-amber-500/40"
                      : "bg-card border-border"
                  : "bg-muted/30 border-border opacity-90"
              }`}
            >
              {/* Header Kartu Batch */}
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-black text-base text-foreground">{cItem.item_name}</span>

                    {/* Status Periode */}
                    {b.status === "settled" ? (
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/30">
                        Selesai (Arsip)
                      </span>
                    ) : s.isOverdue ? (
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-destructive/15 text-destructive border border-destructive/30 flex items-center gap-1">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        Lewat Batas ({Math.abs(s.daysRemaining)} hr)
                      </span>
                    ) : s.isDueSoon ? (
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        Jatuh Tempo ({s.daysRemaining} hr lagi)
                      </span>
                    ) : (
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/30">
                        Aktif (Sisa {s.daysRemaining} hr)
                      </span>
                    )}

                    {/* Status Pembayaran */}
                    <span
                      className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                        s.paymentStatus === "paid"
                          ? "bg-green-500/15 text-green-700 dark:text-green-400"
                          : s.paymentStatus === "partial"
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {s.paymentStatus === "paid"
                        ? "Lunas"
                        : s.paymentStatus === "partial"
                          ? "Cicilan"
                          : "Belum Bayar"}
                    </span>
                  </div>

                  <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5">
                    <span>
                      Penitip: <strong>{consignor?.name || "Mitra Titipan"}</strong>
                    </span>
                    <span>•</span>
                    <span className="font-mono text-[11px]">{b.batch_code}</span>
                    <span>•</span>
                    <span className="text-[11px]">
                      {format(b.start_date, "dd MMM")} - {format(b.end_date, "dd MMM yyyy")}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold block">
                    Harga Jual
                  </span>
                  <span className="text-base font-black text-primary">
                    {formatRupiah(cItem.sell_price)}
                  </span>
                </div>
              </div>

              {/* Grid 4 Kuantitas Barang */}
              <div className="grid grid-cols-4 gap-1.5 bg-muted/40 p-2.5 rounded-xl border text-center text-xs">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                    Masuk
                  </span>
                  <span className="font-black text-foreground">{s.qtyReceived}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                    Terjual
                  </span>
                  <span className="font-black text-green-600">{s.qtySold}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                    Diretur
                  </span>
                  <span className="font-black text-destructive">{s.qtyReturned}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                    Sisa Stok
                  </span>
                  <span
                    className={`font-black ${s.remainingStock > 0 ? "text-blue-600" : "text-muted-foreground"}`}
                  >
                    {s.remainingStock}
                  </span>
                </div>
              </div>

              {/* Rincian Finansial & Hak Setor */}
              <div className="bg-card border rounded-xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Omzet Penjualan Titipan:</span>
                  <span className="font-bold">{formatRupiah(s.totalSalesValue)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">
                    Hak Setor ({s.qtySold} x {formatRupiah(cItem.payout_per_unit)}):
                  </span>
                  <strong className="text-amber-600 font-black">
                    {formatRupiah(s.totalPayoutDue)}
                  </strong>
                </div>
                <div className="flex justify-between items-center text-green-700 dark:text-green-400 font-semibold">
                  <span>Keuntungan Angkringan:</span>
                  <span>{formatRupiah(s.grossProfit)}</span>
                </div>
                <div className="border-t pt-1.5 flex justify-between items-center text-[11px]">
                  <span className="text-muted-foreground">
                    Terbayar: <strong>{formatRupiah(s.totalPaid)}</strong>
                  </span>
                  <span
                    className={
                      s.remainingPayout > 0
                        ? "text-destructive font-black"
                        : "text-green-600 font-bold"
                    }
                  >
                    {s.remainingPayout > 0
                      ? `Kurang ${formatRupiah(s.remainingPayout)}`
                      : "Semua Terbayar"}
                  </span>
                </div>
              </div>

              {/* Alert jika masih ada sisa stok barang */}
              {s.remainingStock > 0 && b.status === "active" && (
                <div className="bg-blue-500/10 border border-blue-500/20 px-3 py-2 rounded-xl flex items-center justify-between text-xs text-blue-700 dark:text-blue-400">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Package className="h-3.5 w-3.5 shrink-0" />
                    Sisa {s.remainingStock} porsi di warung/gudang.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setReturnModal({ batch: b, item: cItem });
                      setReturnQtyStr(String(s.remainingStock));
                    }}
                    className="font-bold underline text-[11px] hover:opacity-80"
                  >
                    Retur Sekarang
                  </button>
                </div>
              )}

              {/* Tombol Aksi Interaktif */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={s.remainingStock <= 0}
                  className="h-10 rounded-xl font-bold text-xs border-2"
                  onClick={() => {
                    setReturnModal({ batch: b, item: cItem });
                    setReturnQtyStr("1");
                    setReturnNotes("");
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1 text-destructive" /> Retur (
                  {s.remainingStock})
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  className="h-10 rounded-xl font-bold text-xs border-2"
                  onClick={() => setHistoryModal({ batch: b, item: cItem })}
                >
                  <History className="h-3.5 w-3.5 mr-1" /> Riwayat
                </Button>

                <Button
                  size="sm"
                  className="h-10 rounded-xl font-bold text-xs bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
                  onClick={() => {
                    setSettleModal({ batch: b, item: cItem });
                    setAmountPaidStr(s.remainingPayout > 0 ? String(s.remainingPayout) : "0");
                    setMarkAsSettled(b.status === "active");
                  }}
                >
                  <DollarSign className="h-3.5 w-3.5 mr-1" /> Penyelesaian
                </Button>
              </div>
            </div>
          );
        })}

        {filteredBatches.length === 0 && (
          <div className="text-center py-14 text-muted-foreground text-xs opacity-60">
            Tidak ada batch konsinyasi pada kategori ini.
          </div>
        )}
      </div>

      {/* ─── MODAL 1: Tambah Penitip Baru ─── */}
      <Dialog open={addConsignorOpen} onOpenChange={setAddConsignorOpen}>
        <DialogContent
          className="rounded-3xl max-w-[90vw] sm:max-w-[400px] p-6"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Tambah Data Penitip</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-bold ml-1">Nama Penitip</Label>
              <Input
                value={consignorName}
                onChange={(e) => setConsignorName(e.target.value)}
                placeholder="Contoh: Bu Siti, Mbak Anis"
                className="h-12 rounded-xl font-bold"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold ml-1">Nomor WhatsApp / HP</Label>
              <Input
                value={consignorPhone}
                onChange={(e) => setConsignorPhone(e.target.value)}
                placeholder="Contoh: 08123456789"
                className="h-12 rounded-xl"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold ml-1">Periode Default Penitip</Label>
              <Select
                value={consignorPeriod}
                onValueChange={(v) => setConsignorPeriod(v as "7" | "14" | "30" | "custom")}
              >
                <SelectTrigger className="h-12 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="7">7 Hari (Mingguan)</SelectItem>
                  <SelectItem value="14">14 Hari (Standar 2 Minggu)</SelectItem>
                  <SelectItem value="30">30 Hari (Bulanan)</SelectItem>
                  <SelectItem value="custom">Periode Kustom (Fleksibel)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold ml-1">Catatan Tambahan</Label>
              <Input
                value={consignorNotes}
                onChange={(e) => setConsignorNotes(e.target.value)}
                placeholder="Alamat atau jadwal antar"
                className="h-11 rounded-xl"
              />
            </div>
            <Button onClick={submitConsignor} className="w-full h-12 rounded-xl font-bold mt-2">
              Daftarkan Penitip
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL 2: Terima Barang Titipan Baru ─── */}
      <Dialog open={addBatchOpen} onOpenChange={setAddBatchOpen}>
        <DialogContent
          className="rounded-3xl max-w-[90vw] sm:max-w-[440px] max-h-[85vh] overflow-y-auto p-6"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Terima Barang Titipan Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-bold ml-1">Pilih Penitip</Label>
              <Select value={selectedConsignorId} onValueChange={setSelectedConsignorId}>
                <SelectTrigger className="h-12 rounded-xl">
                  <SelectValue placeholder="Pilih pemilik barang..." />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {consignors?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name} {c.phone ? `(${c.phone})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-bold ml-1">Nama Barang Titipan</Label>
              <Input
                value={consignmentItemName}
                onChange={(e) => setConsignmentItemName(e.target.value)}
                placeholder="Contoh: Keripik Tahu, Tahu Bakso"
                className="h-12 rounded-xl font-bold"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] font-bold ml-1">Jumlah Masuk</Label>
                <Input
                  type="number"
                  value={qtyReceived}
                  onChange={(e) => setQtyReceived(e.target.value)}
                  placeholder="30"
                  className="h-12 rounded-xl text-center font-black"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] font-bold ml-1">Harga Jual</Label>
                <Input
                  inputMode="numeric"
                  value={sellPrice ? formatRupiah(parseInt(sellPrice.replace(/\D/g, "")) || 0) : ""}
                  onChange={(e) => setSellPrice(e.target.value.replace(/\D/g, ""))}
                  placeholder="Rp 3.000"
                  className="h-12 rounded-xl text-right font-bold text-primary"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] font-bold ml-1">Nilai Setoran</Label>
                <Input
                  inputMode="numeric"
                  value={
                    payoutPerUnit
                      ? formatRupiah(parseInt(payoutPerUnit.replace(/\D/g, "")) || 0)
                      : ""
                  }
                  onChange={(e) => setPayoutPerUnit(e.target.value.replace(/\D/g, ""))}
                  placeholder="Rp 2.000"
                  className="h-12 rounded-xl text-right font-bold text-amber-600"
                />
              </div>
            </div>

            {/* Pengaturan Periode Customizable */}
            <div className="space-y-1.5 pt-1">
              <Label className="text-xs font-bold ml-1">Durasi Periode Konsinyasi</Label>
              <Select
                value={batchPeriodType}
                onValueChange={(v) => setBatchPeriodType(v as "7" | "14" | "30" | "custom")}
              >
                <SelectTrigger className="h-12 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="7">7 Hari (Mingguan)</SelectItem>
                  <SelectItem value="14">14 Hari (Standar 2 Minggu)</SelectItem>
                  <SelectItem value="30">30 Hari (Bulanan)</SelectItem>
                  <SelectItem value="custom">Pilih Tanggal Manual (Custom)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {batchPeriodType === "custom" && (
              <div className="grid grid-cols-2 gap-2 bg-muted/40 p-3 rounded-xl border">
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold">Tanggal Mulai</Label>
                  <Input
                    type="date"
                    value={customStartDateStr}
                    onChange={(e) => setCustomStartDateStr(e.target.value)}
                    className="h-11 rounded-lg text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold">Tanggal Selesai</Label>
                  <Input
                    type="date"
                    value={customEndDateStr}
                    onChange={(e) => setCustomEndDateStr(e.target.value)}
                    className="h-11 rounded-lg text-xs"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs font-bold ml-1">Catatan Tambahan (Opsional)</Label>
              <Input
                value={batchNotes}
                onChange={(e) => setBatchNotes(e.target.value)}
                placeholder="Contoh: Titipan batch weekend"
                className="h-11 rounded-xl"
              />
            </div>

            <Button onClick={submitBatch} className="w-full h-12 rounded-xl font-bold mt-2">
              Simpan Batch Titipan
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL 3: Retur Fisik ke Penjual ─── */}
      <Dialog open={Boolean(returnModal)} onOpenChange={(o) => !o && setReturnModal(null)}>
        <DialogContent
          className="rounded-3xl max-w-[90vw] sm:max-w-[400px] p-6"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Retur ke Penjual</DialogTitle>
          </DialogHeader>
          {returnModal && (
            <div className="space-y-3.5 py-2">
              <div className="bg-muted/40 p-3 rounded-xl border text-xs space-y-1">
                <div className="font-bold text-sm text-foreground">
                  {returnModal.item.item_name}
                </div>
                <div className="text-muted-foreground">
                  Sisa Tersedia di Batch Ini:{" "}
                  <strong className="text-blue-600">
                    {returnModal.item.qty_received -
                      returnModal.item.qty_sold -
                      returnModal.item.qty_returned}{" "}
                    bungkus
                  </strong>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Retur akan otomatis memotong stok Gudang fisik dan tidak dihitung sebagai
                  penjualan atau beban.
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold ml-1">Jumlah yang Dikembalikan</Label>
                <Input
                  type="number"
                  min="1"
                  max={
                    returnModal.item.qty_received -
                    returnModal.item.qty_sold -
                    returnModal.item.qty_returned
                  }
                  value={returnQtyStr}
                  onChange={(e) => setReturnQtyStr(e.target.value)}
                  className="h-12 rounded-xl font-black text-center text-destructive text-lg"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold ml-1">Tanggal Retur</Label>
                <Input
                  type="date"
                  value={returnDateStr}
                  onChange={(e) => setReturnDateStr(e.target.value)}
                  className="h-11 rounded-xl text-sm"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold ml-1">Alasan / Catatan (Opsional)</Label>
                <Input
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="Contoh: Kadaluarsa, ditarik pemilik"
                  className="h-11 rounded-xl text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button
                  variant="outline"
                  className="h-12 rounded-xl font-bold"
                  onClick={() => setReturnModal(null)}
                >
                  Batal
                </Button>
                <Button
                  variant="destructive"
                  className="h-12 rounded-xl font-bold"
                  onClick={handleConfirmReturn}
                >
                  Konfirmasi Retur
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── MODAL 4: Rekap Penyelesaian & Pembayaran Bertahap ─── */}
      <Dialog open={Boolean(settleModal)} onOpenChange={(o) => !o && setSettleModal(null)}>
        <DialogContent
          className="rounded-3xl max-w-[90vw] sm:max-w-[440px] max-h-[85vh] overflow-y-auto p-6"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              Penyelesaian & Pembayaran Setoran
            </DialogTitle>
          </DialogHeader>
          {settleModal &&
            (() => {
              const consignor = consignors?.find((c) => c.id === settleModal.batch.consignor_id);
              const s = computeBatchSummary(settleModal.batch, settleModal.item, consignor);

              return (
                <div className="space-y-3.5 py-2">
                  <div className="bg-muted/40 p-3 rounded-xl border text-xs space-y-1">
                    <div className="font-bold text-sm text-foreground">
                      {settleModal.item.item_name}
                    </div>
                    <div className="text-muted-foreground">
                      Penitip: <strong>{consignor?.name || "Mitra Titipan"}</strong> • Batch{" "}
                      {settleModal.batch.batch_code}
                    </div>
                  </div>

                  {/* Rekapitulasi Aktual */}
                  <div className="grid grid-cols-4 gap-1.5 bg-muted/60 p-2.5 rounded-xl border text-center text-xs">
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Diterima</span>
                      <span className="font-black text-foreground">{s.qtyReceived}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Terjual</span>
                      <span className="font-black text-green-600">{s.qtySold}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Diretur</span>
                      <span className="font-black text-destructive">{s.qtyReturned}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Sisa</span>
                      <span className="font-black text-blue-600">{s.remainingStock}</span>
                    </div>
                  </div>

                  {/* Perhitungan Hak Setoran */}
                  <div className="bg-amber-500/10 border border-amber-500/25 p-3 rounded-xl space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span>Total Penjualan Konsinyasi:</span>
                      <strong className="text-foreground">{formatRupiah(s.totalSalesValue)}</strong>
                    </div>
                    <div className="flex justify-between text-amber-700 dark:text-amber-400 font-bold">
                      <span>Total Hak Setor ke Penitip:</span>
                      <span className="text-sm font-black">{formatRupiah(s.totalPayoutDue)}</span>
                    </div>
                    <div className="flex justify-between text-green-700 dark:text-green-400 font-semibold">
                      <span>Keuntungan Bersih Toko:</span>
                      <span>{formatRupiah(s.grossProfit)}</span>
                    </div>
                    <div className="border-t border-amber-500/20 pt-1.5 flex justify-between">
                      <span>Sudah Dibayar Sebelumnya:</span>
                      <strong className="text-foreground">{formatRupiah(s.totalPaid)}</strong>
                    </div>
                    <div className="flex justify-between text-sm font-black pt-0.5">
                      <span className="text-destructive">Sisa Tagihan Setor:</span>
                      <span className="text-destructive">{formatRupiah(s.remainingPayout)}</span>
                    </div>
                  </div>

                  {/* Alert jika masih ada sisa stok barang */}
                  {s.remainingStock > 0 && (
                    <div className="bg-amber-500/10 border border-amber-500/30 p-2.5 rounded-xl text-xs text-amber-800 dark:text-amber-400 flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                      <div>
                        <strong>Perhatian:</strong> Masih ada{" "}
                        <strong className="text-foreground">{s.remainingStock} bungkus</strong>{" "}
                        barang di warung. Pastikan sisa barang telah diretur fisik ke pemilik
                        sebelum periode batch ini ditutup sepenuhnya.
                      </div>
                    </div>
                  )}

                  {/* Form Input Pembayaran */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between items-center">
                      <Label className="text-xs font-bold ml-1">Nominal Pembayaran Sekarang</Label>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className={`text-[10px] px-2 py-0.5 rounded font-bold transition-all ${
                            settlementMethod === "Cash"
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "bg-muted text-muted-foreground"
                          }`}
                          onClick={() => setSettlementMethod("Cash")}
                        >
                          Tunai Laci
                        </button>
                        <button
                          type="button"
                          className={`text-[10px] px-2 py-0.5 rounded font-bold transition-all ${
                            settlementMethod === "Transfer"
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "bg-muted text-muted-foreground"
                          }`}
                          onClick={() => setSettlementMethod("Transfer")}
                        >
                          Transfer
                        </button>
                      </div>
                    </div>
                    <Input
                      inputMode="numeric"
                      value={
                        amountPaidStr
                          ? formatRupiah(parseInt(amountPaidStr.replace(/\D/g, "")) || 0)
                          : ""
                      }
                      onChange={(e) => setAmountPaidStr(e.target.value.replace(/\D/g, ""))}
                      placeholder="Rp 0"
                      className="h-12 rounded-xl font-black text-amber-600 text-lg"
                    />
                    <span className="text-[10px] text-muted-foreground block ml-1">
                      {settlementMethod === "Cash"
                        ? "Pembayaran tunai otomatis dicatat sebagai pengeluaran kas fisik di laci hari ini."
                        : "Pembayaran transfer tidak mempengaruhi uang fisik di laci kasir."}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-bold ml-1">Catatan Pembayaran (Opsional)</Label>
                    <Input
                      value={paymentNotes}
                      onChange={(e) => setPaymentNotes(e.target.value)}
                      placeholder="Contoh: Cicilan tahap 1, lunas tunai"
                      className="h-11 rounded-xl text-sm"
                    />
                  </div>

                  {/* Opsi Tandai Periode Ditutup */}
                  <div className="flex items-center gap-2 bg-muted/40 p-2.5 rounded-xl border">
                    <Checkbox
                      id="markSettledCheck"
                      checked={markAsSettled}
                      onCheckedChange={(c) => setMarkAsSettled(Boolean(c))}
                    />
                    <label htmlFor="markSettledCheck" className="text-xs font-bold cursor-pointer">
                      Tandai Periode Batch Ini Ditutup / Selesai
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <Button
                      variant="outline"
                      className="h-12 rounded-xl font-bold"
                      onClick={() => setSettleModal(null)}
                    >
                      Batal
                    </Button>
                    <Button
                      className="h-12 rounded-xl font-bold bg-amber-600 hover:bg-amber-700 text-white"
                      onClick={handleConfirmPayment}
                    >
                      Simpan Pembayaran
                    </Button>
                  </div>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>

      {/* ─── MODAL 5: Riwayat Retur & Pembayaran Batch ─── */}
      <Dialog open={Boolean(historyModal)} onOpenChange={(o) => !o && setHistoryModal(null)}>
        <DialogContent
          className="rounded-3xl max-w-[90vw] sm:max-w-[460px] max-h-[85vh] overflow-y-auto p-6"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Riwayat Transaksi Batch</DialogTitle>
          </DialogHeader>
          {historyModal &&
            (() => {
              const batchReturns =
                returns?.filter((r) => r.batch_id === historyModal.batch.id) || [];
              const batchPayments =
                payments?.filter((p) => p.batch_id === historyModal.batch.id) || [];

              return (
                <div className="space-y-4 py-2 text-xs">
                  <div className="bg-muted/40 p-3 rounded-xl border space-y-1">
                    <div className="font-bold text-sm text-foreground">
                      {historyModal.item.item_name}
                    </div>
                    <div className="text-muted-foreground">
                      Kode Batch:{" "}
                      <strong className="font-mono">{historyModal.batch.batch_code}</strong>
                    </div>
                  </div>

                  {/* Sub-bagian 1: Riwayat Retur */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center font-bold text-foreground">
                      <span className="flex items-center gap-1.5">
                        <RotateCcw className="h-3.5 w-3.5 text-destructive" />
                        Riwayat Pengembalian (Retur Fisik)
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Total: {batchReturns.reduce((s, r) => s + r.qty_returned, 0)} bungkus
                      </span>
                    </div>

                    <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
                      {batchReturns.map((r) => (
                        <div
                          key={r.id}
                          className="bg-card border rounded-xl p-2.5 flex justify-between items-center"
                        >
                          <div>
                            <div className="font-bold text-destructive">
                              {r.qty_returned} bungkus diretur
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {format(r.return_date, "dd MMM yyyy, HH:mm", { locale: idLocale })}
                              {r.notes ? ` • ${r.notes}` : ""}
                            </div>
                          </div>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {r.return_number}
                          </span>
                        </div>
                      ))}
                      {batchReturns.length === 0 && (
                        <div className="text-center py-4 text-muted-foreground text-[11px] opacity-60">
                          Belum ada retur fisik pada batch ini.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Sub-bagian 2: Riwayat Pembayaran */}
                  <div className="space-y-2 pt-2 border-t">
                    <div className="flex justify-between items-center font-bold text-foreground">
                      <span className="flex items-center gap-1.5">
                        <DollarSign className="h-3.5 w-3.5 text-green-600" />
                        Riwayat Pembayaran Setoran
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Total: {formatRupiah(batchPayments.reduce((s, p) => s + p.amount_paid, 0))}
                      </span>
                    </div>

                    <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
                      {batchPayments.map((p) => (
                        <div
                          key={p.id}
                          className="bg-card border rounded-xl p-2.5 flex justify-between items-center"
                        >
                          <div>
                            <div className="font-black text-green-600">
                              {formatRupiah(p.amount_paid)}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {format(p.payment_date, "dd MMM yyyy, HH:mm", { locale: idLocale })} •{" "}
                              <span className="font-bold">{p.payment_method}</span>
                              {p.notes ? ` • ${p.notes}` : ""}
                            </div>
                          </div>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {p.payment_number}
                          </span>
                        </div>
                      ))}
                      {batchPayments.length === 0 && (
                        <div className="text-center py-4 text-muted-foreground text-[11px] opacity-60">
                          Belum ada riwayat pembayaran setoran pada batch ini.
                        </div>
                      )}
                    </div>
                  </div>

                  <Button
                    className="w-full h-11 rounded-xl font-bold mt-2"
                    onClick={() => setHistoryModal(null)}
                  >
                    Tutup Riwayat
                  </Button>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==========================================
// 4. TAB SESI KAS (BUKA & TUTUP ANGKRIAN)
// ==========================================
function CashSessionTab() {
  const activeSession = useLiveQuery(
    () => db.cash_sessions.where("status").equals("open").last(),
    [],
  );
  const closedSessions = useLiveQuery(
    () => db.cash_sessions.where("status").equals("closed").reverse().limit(30).toArray(),
    [],
  );
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof calculateSessionSummary>
  > | null>(null);

  const [initialCashInput, setInitialCashInput] = useState("");
  const [actualCashInput, setActualCashInput] = useState("");
  const [notesInput, setNotesInput] = useState("");

  useEffect(() => {
    if (activeSession?.id) {
      calculateSessionSummary(activeSession.id).then(setSummary).catch(console.error);
    } else {
      setSummary(null);
    }
  }, [activeSession]);

  const handleOpen = async () => {
    const nominal = parseInt(initialCashInput.replace(/\D/g, "")) || 0;
    try {
      await openCashSession(nominal, notesInput);
      toast.success("Sesi kasir berhasil dibuka!");
      setInitialCashInput("");
      setNotesInput("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Gagal membuka sesi kasir");
    }
  };

  const handleClose = async () => {
    if (!activeSession?.id) return;
    const actual = parseInt(actualCashInput.replace(/\D/g, "")) || 0;
    try {
      const closed = await closeCashSession(activeSession.id, actual, notesInput);
      const diff = closed.cash_difference || 0;
      if (diff === 0) toast.success("Sesi ditutup: Kas pas!");
      else if (diff > 0) toast.success(`Sesi ditutup: Kas lebih ${formatRupiah(diff)}`);
      else toast.warning(`Sesi ditutup: Kas selisih kurang ${formatRupiah(diff)}`);
      setActualCashInput("");
      setNotesInput("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Gagal menutup sesi kasir");
    }
  };

  return (
    <div className="space-y-4">
      {/* Kartu Status Sesi Aktif */}
      {activeSession ? (
        <div className="bg-card border-2 border-primary/30 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
          <div className="flex justify-between items-center pb-2 border-b">
            <div>
              <span className="text-[10px] bg-green-500/20 text-green-700 font-black px-2 py-0.5 rounded uppercase">
                Sesi Berjalan (Warung Buka)
              </span>
              <div className="text-xs text-muted-foreground mt-1">
                Dibuka:{" "}
                {format(activeSession.opened_at, "dd MMMM yyyy, HH:mm", { locale: idLocale })}
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-muted-foreground uppercase font-bold block">
                Modal Awal
              </span>
              <span className="text-sm font-black text-foreground">
                {formatRupiah(activeSession.initial_cash)}
              </span>
            </div>
          </div>

          {summary && (
            <div className="space-y-2 text-xs bg-muted/40 p-3.5 rounded-xl border">
              <div className="flex justify-between">
                <span>Modal Awal Kas:</span>
                <span className="font-bold">{formatRupiah(summary.initialCash)}</span>
              </div>
              <div className="flex justify-between text-green-600">
                <span>+ Penjualan Tunai ({summary.salesCount} nota):</span>
                <span className="font-bold">+{formatRupiah(summary.cashSales)}</span>
              </div>
              <div className="flex justify-between text-destructive">
                <span>- Pembelian Kulakan Tunai ({summary.purchasesCount}):</span>
                <span className="font-bold">-{formatRupiah(summary.cashPurchases)}</span>
              </div>
              <div className="flex justify-between text-destructive">
                <span>- Pengeluaran Beban Tunai ({summary.expensesCount}):</span>
                <span className="font-bold">-{formatRupiah(summary.cashExpenses)}</span>
              </div>
              <div className="flex justify-between text-destructive">
                <span>- Setoran Konsinyasi Tunai ({summary.settlementsCount}):</span>
                <span className="font-bold">-{formatRupiah(summary.cashSettlements)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-black text-sm">
                <span>Kas Fisik Seharusnya di Laci:</span>
                <span className="text-primary font-black text-base">
                  {formatRupiah(summary.expectedCash)}
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground italic">
                *Penjualan QRIS: {formatRupiah(summary.qrisSales)} (tidak masuk laci uang fisik).
              </div>
            </div>
          )}

          {/* Form Penutupan Kas */}
          <div className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label className="text-xs font-bold ml-1">
                Input Uang Tunai Fisik di Laci Saat Ini (Rp)
              </Label>
              <Input
                inputMode="numeric"
                value={
                  actualCashInput
                    ? formatRupiah(parseInt(actualCashInput.replace(/\D/g, "")) || 0)
                    : ""
                }
                onChange={(e) => setActualCashInput(e.target.value.replace(/\D/g, ""))}
                placeholder="Hitung uang riil di laci..."
                className="h-14 rounded-xl text-center font-black text-xl"
              />
            </div>

            {actualCashInput && summary && (
              <div
                className={`p-3 rounded-xl border text-center text-xs font-bold ${
                  parseInt(actualCashInput.replace(/\D/g, "")) - summary.expectedCash === 0
                    ? "bg-green-500/10 text-green-700 border-green-500/20"
                    : parseInt(actualCashInput.replace(/\D/g, "")) - summary.expectedCash > 0
                      ? "bg-blue-500/10 text-blue-700 border-blue-500/20"
                      : "bg-destructive/10 text-destructive border-destructive/20"
                }`}
              >
                Selisih Kas:{" "}
                {formatRupiah(parseInt(actualCashInput.replace(/\D/g, "")) - summary.expectedCash)}
              </div>
            )}

            <Button
              onClick={handleClose}
              className="w-full h-12 rounded-xl font-bold bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              Rekonsiliasi & Tutup Kasir
            </Button>
          </div>
        </div>
      ) : (
        /* Form Pembukaan Kasir */
        <div className="bg-card border-2 border-border rounded-2xl p-4 sm:p-5 shadow-sm space-y-3.5">
          <div className="flex items-center gap-2 pb-2 border-b">
            <Store className="h-5 w-5 text-primary" />
            <h2 className="text-sm font-bold">Buka Sesi Kasir Baru</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Mulai aktivitas penjualan harian dengan mencatat modal awal uang pecahan untuk kembalian
            di laci kasir.
          </p>

          <div className="space-y-1">
            <Label className="text-xs font-bold ml-1">Modal Awal Kas di Laci (Rp)</Label>
            <Input
              inputMode="numeric"
              value={
                initialCashInput
                  ? formatRupiah(parseInt(initialCashInput.replace(/\D/g, "")) || 0)
                  : ""
              }
              onChange={(e) => setInitialCashInput(e.target.value.replace(/\D/g, ""))}
              placeholder="Contoh: Rp 150.000"
              className="h-14 rounded-xl text-xl font-black text-center"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold ml-1">Catatan Pembukaan (Opsional)</Label>
            <Input
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              placeholder="Contoh: Buka tepat jam 17:00"
              className="h-11 rounded-xl"
            />
          </div>

          <Button onClick={handleOpen} className="w-full h-12 rounded-xl font-bold text-base">
            Buka Kasir Sekarang
          </Button>
        </div>
      )}

      {/* Riwayat Sesi Penutupan Kas Harian */}
      <div className="space-y-2 pt-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Riwayat Penutupan Kas Harian
        </h3>
        {closedSessions?.map((cs) => (
          <div key={cs.id} className="bg-card border rounded-2xl p-3.5 shadow-sm space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold">{cs.session_date}</span>
              <span
                className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                  (cs.cash_difference || 0) === 0
                    ? "bg-green-500/10 text-green-700"
                    : (cs.cash_difference || 0) > 0
                      ? "bg-blue-500/10 text-blue-700"
                      : "bg-destructive/10 text-destructive"
                }`}
              >
                {(cs.cash_difference || 0) === 0
                  ? "Kas Pas"
                  : `Selisih: ${formatRupiah(cs.cash_difference || 0)}`}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground bg-muted/30 p-2 rounded-xl">
              <div>
                Modal: <strong className="text-foreground">{formatRupiah(cs.initial_cash)}</strong>
              </div>
              <div>
                Tunai Masuk:{" "}
                <strong className="text-green-600">+{formatRupiah(cs.total_cash_sales)}</strong>
              </div>
              <div>
                Uang Fisik:{" "}
                <strong className="text-primary">{formatRupiah(cs.actual_cash || 0)}</strong>
              </div>
            </div>
          </div>
        ))}

        {closedSessions?.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-xs opacity-60">
            Belum ada riwayat sesi kas yang ditutup.
          </div>
        )}
      </div>
    </div>
  );
}
