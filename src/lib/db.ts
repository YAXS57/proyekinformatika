import Dexie, { Table } from "dexie";

// Helper UUID generator dengan fallback multi-environment
export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Helper untuk format nomor nota/invoice otomatis
export function generateInvoiceNumber(prefix: string = "TRX"): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${y}${m}${d}-${rand}`;
}

export type SyncStatus = "synced" | "pending" | "failed";

// 1. KATEGORI
export interface Category {
  id?: number;
  uuid?: string;
  name: string;
  created_at: number;
  updated_at?: number;
  deleted_at?: number | null;
  sync_status?: SyncStatus;
}

// 2. MENU ITEM
export interface MenuItem {
  id?: number;
  uuid?: string;
  category_id: number;
  name: string;
  price: number;
  image?: string;
  inventory_id?: number; // Penghubung ke Gudang
  is_consignment?: boolean; // Penanda barang titipan
  consignment_item_id?: number;
  is_active?: boolean;
  created_at: number;
  updated_at?: number;
  deleted_at?: number | null;
  sync_status?: SyncStatus;
}

// 3. INVENTARIS / GUDANG
export interface Inventory {
  id?: number;
  uuid?: string;
  name: string;
  stock: number;
  unit: string;
  cost_per_unit: number;
  item_type?: "owned" | "consignment"; // Pembeda kepemilikan stok
  consignor_id?: number; // Relasi ke penitip jika item_type === "consignment"
  consignor_name?: string;
  consignment_item_id?: number;
  min_stock_alert?: number;
  last_updated: number;
  created_at?: number;
  updated_at?: number;
  deleted_at?: number | null;
  sync_status?: SyncStatus;
}

// 4. PELANGGAN / MEMBER
export interface Customer {
  id?: number;
  uuid?: string;
  name: string;
  phone?: string;
  is_active?: boolean;
  created_at?: number;
  updated_at?: number;
  deleted_at?: number | null;
  sync_status?: SyncStatus;
}

// 5. PENJUALAN (SALES)
export interface Sale {
  id?: number;
  uuid?: string;
  invoice_number?: string; // TRX-YYYYMMDD-XXXX
  transaction_date: number;
  subtotal?: number;
  discount_amount?: number;
  promo_name?: string;
  total_amount: number;
  payment_method: "Cash" | "QRIS";
  cash_tendered?: number;
  cash_change?: number;
  status: "paid" | "unpaid" | "void";
  customer_name?: string;
  is_member?: boolean;
  session_id?: number;
  session_uuid?: string;
  created_at?: number;
  updated_at?: number;
  deleted_at?: number | null;
  sync_status?: SyncStatus;
}

// 6. DETAIL PENJUALAN (SALE DETAILS)
export interface SaleDetail {
  id?: number;
  uuid?: string;
  sale_id: number;
  sale_uuid?: string;
  item_id: number;
  item_uuid?: string;
  item_name: string;
  quantity: number;
  price_at_sale: number;
  cost_at_sale?: number;
  subtotal: number;
  is_consignment?: boolean;
  consignment_batch_id?: number;
  consignment_item_id?: number;
  payout_at_sale?: number; // Snapshot hak setoran penitip per unit saat transaksi
  created_at?: number;
}

// 7. PENGELUARAN OPERASIONAL (EXPENSES)
export interface Expense {
  id?: number;
  uuid?: string;
  expense_date: number;
  description: string;
  amount: number;
  category: string;
  payment_method?: "Cash" | "Transfer";
  session_id?: number;
  session_uuid?: string;
  created_at?: number;
  updated_at?: number;
  deleted_at?: number | null;
  sync_status?: SyncStatus;
}

// 8. PEMBELIAN BARANG DAGANGAN / KULAKAN (PURCHASES)
export interface Purchase {
  id?: number;
  uuid?: string;
  invoice_number: string; // PUR-YYYYMMDD-XXXX
  purchase_date: number;
  supplier_name?: string;
  payment_method: "Cash" | "Transfer";
  total_amount: number;
  notes?: string;
  session_id?: number;
  session_uuid?: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  sync_status?: SyncStatus;
}

export interface PurchaseDetail {
  id?: number;
  uuid?: string;
  purchase_id: number;
  purchase_uuid?: string;
  inventory_id?: number;
  inventory_uuid?: string;
  item_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  subtotal: number;
  created_at: number;
}

// 9. KONSINYASI (TITIP JUAL)
export interface Consignor {
  id?: number;
  uuid?: string;
  name: string;
  phone?: string;
  address?: string;
  default_period_days?: number | "custom"; // 7, 14, 30, atau custom
  is_active: boolean;
  notes?: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  sync_status?: SyncStatus;
}

export interface ConsignmentBatch {
  id?: number;
  uuid?: string;
  batch_code: string; // CSG-YYYYMMDD-XXXX
  consignor_id: number;
  consignor_uuid?: string;
  start_date: number;
  end_date: number;
  period_days?: number | "custom";
  status: "active" | "settled";
  total_sales_value: number;
  total_payout_due: number;
  total_paid: number;
  payment_status: "unpaid" | "partial" | "paid";
  total_returned_qty?: number;
  notes?: string;
  session_id?: number;
  session_uuid?: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  sync_status?: SyncStatus;
}

export interface ConsignmentItem {
  id?: number;
  uuid?: string;
  batch_id: number;
  batch_uuid?: string;
  menu_item_id?: number;
  menu_item_uuid?: string;
  inventory_id?: number;
  inventory_uuid?: string;
  category_id?: number;
  unit?: string;
  item_name: string;
  qty_received: number;
  qty_sold: number;
  qty_returned: number;
  sell_price: number;
  payout_per_unit: number;
  subtotal_payout: number;
  angkot_profit: number;
  created_at: number;
  updated_at: number;
}

export interface ConsignmentReturn {
  id?: number;
  uuid?: string;
  return_number: string; // RET-YYYYMMDD-XXXX
  batch_id: number;
  batch_uuid?: string;
  item_id?: number;
  item_name: string;
  inventory_id?: number;
  return_date: number;
  qty_returned: number;
  notes?: string;
  session_id?: number;
  session_uuid?: string;
  created_at: number;
  updated_at?: number;
  deleted_at?: number | null;
  sync_status?: SyncStatus;
}

export interface ConsignmentSettlement {
  id?: number;
  uuid?: string;
  settlement_number: string; // STL-YYYYMMDD-XXXX
  batch_id: number;
  batch_uuid?: string;
  consignor_id: number;
  consignor_uuid?: string;
  settlement_date: number;
  total_sales: number;
  total_payout_due: number;
  total_paid: number;
  amount_paid: number;
  payment_method: "Cash" | "Transfer";
  payment_status: "unpaid" | "partial" | "paid";
  notes?: string;
  session_id?: number;
  session_uuid?: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  sync_status?: SyncStatus;
}

export interface ConsignmentPayment {
  id?: number;
  uuid?: string;
  payment_number: string; // PAY-YYYYMMDD-XXXX
  settlement_id?: number;
  settlement_uuid?: string;
  batch_id: number;
  batch_uuid?: string;
  consignor_id: number;
  consignor_uuid?: string;
  payment_date: number;
  amount_paid: number;
  payment_method: "Cash" | "Transfer";
  notes?: string;
  session_id?: number;
  session_uuid?: string;
  created_at: number;
  updated_at?: number;
  deleted_at?: number | null;
  sync_status?: SyncStatus;
}

// 10. SESI KAS BUKA / TUTUP HARIAN
export interface CashSession {
  id?: number;
  uuid?: string;
  session_date: string; // YYYY-MM-DD
  opened_at: number;
  closed_at?: number | null;
  initial_cash: number;
  total_cash_sales: number;
  total_qris_sales: number;
  total_cash_purchases: number;
  total_cash_expenses: number;
  total_cash_settlements: number;
  expected_cash: number;
  actual_cash?: number;
  cash_difference?: number;
  status: "open" | "closed";
  notes?: string;
  created_at: number;
  updated_at: number;
  sync_status?: SyncStatus;
}

// 11. ANTREAN SINKRONISASI & SETTINGS
export interface SyncQueue {
  id?: number;
  queue_id: string;
  entity_type: string;
  entity_uuid: string;
  action: "insert" | "update" | "delete";
  payload: unknown;
  status: "pending" | "syncing" | "failed";
  retry_count: number;
  last_error?: string;
  created_at: number;
  updated_at: number;
}

export interface AppSetting {
  key: string;
  value: unknown;
  updated_at: number;
}

export interface BackupHistory {
  id?: number;
  uuid?: string;
  backup_date: number;
  backup_type: "auto" | "manual";
  destination: "local" | "gdrive" | "both";
  file_name: string;
  file_size: number;
  checksum?: string;
  status: "success" | "failed";
  error_message?: string;
  created_at: number;
}

export class AngkringanDB extends Dexie {
  categories!: Table<Category, number>;
  menu_items!: Table<MenuItem, number>;
  sales!: Table<Sale, number>;
  sale_details!: Table<SaleDetail, number>;
  expenses!: Table<Expense, number>;
  inventory!: Table<Inventory, number>;
  customers!: Table<Customer, number>;

  // Tabel Baru
  purchases!: Table<Purchase, number>;
  purchase_details!: Table<PurchaseDetail, number>;
  consignors!: Table<Consignor, number>;
  consignment_batches!: Table<ConsignmentBatch, number>;
  consignment_items!: Table<ConsignmentItem, number>;
  consignment_returns!: Table<ConsignmentReturn, number>;
  consignment_settlements!: Table<ConsignmentSettlement, number>;
  consignment_payments!: Table<ConsignmentPayment, number>;
  cash_sessions!: Table<CashSession, number>;
  sync_queue!: Table<SyncQueue, number>;
  app_settings!: Table<AppSetting, string>;
  backup_history!: Table<BackupHistory, number>;

  constructor() {
    super("AngkringanDB");

    // Versi 5 (Historis lama, tetap didefinisikan agar migrasi aman)
    this.version(5).stores({
      categories: "++id, name, created_at",
      menu_items: "++id, category_id, name, price, created_at",
      sales: "++id, transaction_date, payment_method, status",
      sale_details: "++id, sale_id, item_id",
      expenses: "++id, expense_date, category",
      inventory: "++id, name, last_updated",
      customers: "++id, name",
    });

    // Versi 6 (Skema Baru dengan UUID, Audit Columns, dan Modul Lengkap)
    this.version(6)
      .stores({
        categories: "++id, uuid, name, created_at, sync_status",
        menu_items: "++id, uuid, category_id, name, price, inventory_id, is_active, sync_status",
        sales:
          "++id, uuid, invoice_number, transaction_date, payment_method, status, session_id, sync_status",
        sale_details: "++id, uuid, sale_id, sale_uuid, item_id",
        expenses: "++id, uuid, expense_date, category, payment_method, session_id, sync_status",
        inventory: "++id, uuid, name, stock, unit, cost_per_unit, last_updated, sync_status",
        customers: "++id, uuid, name, phone, is_active, sync_status",

        purchases:
          "++id, uuid, invoice_number, purchase_date, payment_method, session_id, sync_status",
        purchase_details: "++id, uuid, purchase_id, purchase_uuid, inventory_id",
        consignors: "++id, uuid, name, is_active, sync_status",
        consignment_batches:
          "++id, uuid, batch_code, consignor_id, start_date, end_date, status, session_id, sync_status",
        consignment_items: "++id, uuid, batch_id, batch_uuid, menu_item_id, item_name",
        consignment_settlements:
          "++id, uuid, settlement_number, batch_id, consignor_id, settlement_date, session_id, sync_status",
        cash_sessions: "++id, uuid, session_date, opened_at, closed_at, status, sync_status",
        sync_queue: "++id, queue_id, entity_type, entity_uuid, action, status, created_at",
        app_settings: "key, updated_at",
        backup_history: "++id, backup_date, backup_type, status",
      })
      .upgrade(async (tx) => {
        const now = Date.now();

        await tx
          .table("categories")
          .toCollection()
          .modify((cat: Category) => {
            if (!cat.uuid) cat.uuid = generateUUID();
            if (!cat.updated_at) cat.updated_at = cat.created_at || now;
            if (!cat.sync_status) cat.sync_status = "synced";
          });

        await tx
          .table("menu_items")
          .toCollection()
          .modify((item: MenuItem) => {
            if (!item.uuid) item.uuid = generateUUID();
            if (!item.updated_at) item.updated_at = item.created_at || now;
            if (item.is_active === undefined) item.is_active = true;
            if (!item.sync_status) item.sync_status = "synced";
          });

        await tx
          .table("inventory")
          .toCollection()
          .modify((inv: Inventory) => {
            if (!inv.uuid) inv.uuid = generateUUID();
            if (!inv.created_at) inv.created_at = inv.last_updated || now;
            if (!inv.updated_at) inv.updated_at = inv.last_updated || now;
            if (!inv.sync_status) inv.sync_status = "synced";
          });

        await tx
          .table("customers")
          .toCollection()
          .modify((cust: Customer) => {
            if (!cust.uuid) cust.uuid = generateUUID();
            if (!cust.created_at) cust.created_at = now;
            if (!cust.updated_at) cust.updated_at = now;
            if (cust.is_active === undefined) cust.is_active = true;
            if (!cust.sync_status) cust.sync_status = "synced";
          });

        await tx
          .table("sales")
          .toCollection()
          .modify((sale: Sale) => {
            if (!sale.uuid) sale.uuid = generateUUID();
            if (!sale.invoice_number) sale.invoice_number = generateInvoiceNumber("TRX");
            if (!sale.created_at) sale.created_at = sale.transaction_date || now;
            if (!sale.updated_at) sale.updated_at = sale.transaction_date || now;
            if (sale.subtotal === undefined)
              sale.subtotal = sale.total_amount + (sale.discount_amount || 0);
            if (!sale.sync_status) sale.sync_status = "synced";
          });

        await tx
          .table("sale_details")
          .toCollection()
          .modify((detail: SaleDetail) => {
            if (!detail.uuid) detail.uuid = generateUUID();
            if (!detail.created_at) detail.created_at = now;
          });

        await tx
          .table("expenses")
          .toCollection()
          .modify((exp: Expense) => {
            if (!exp.uuid) exp.uuid = generateUUID();
            if (!exp.created_at) exp.created_at = exp.expense_date || now;
            if (!exp.updated_at) exp.updated_at = exp.expense_date || now;
            if (!exp.payment_method) exp.payment_method = "Cash";
            if (!exp.sync_status) exp.sync_status = "synced";
          });
      });

    // Versi 7: Indeks created_at pada menu_items dan backup_history
    this.version(7).stores({
      menu_items:
        "++id, uuid, category_id, name, price, inventory_id, is_active, created_at, sync_status",
      backup_history: "++id, backup_date, created_at, backup_type, status",
    });

    // Versi 8: Perluasan Modul Konsinyasi (Integrasi Gudang, Kasir, Retur, & Pembayaran Bertahap)
    this.version(8)
      .stores({
        inventory:
          "++id, uuid, name, stock, unit, cost_per_unit, item_type, consignor_id, last_updated, sync_status",
        menu_items:
          "++id, uuid, category_id, name, price, inventory_id, is_consignment, is_active, created_at, sync_status",
        sale_details:
          "++id, uuid, sale_id, sale_uuid, item_id, is_consignment, consignment_batch_id",
        consignors: "++id, uuid, name, is_active, default_period_days, sync_status",
        consignment_batches:
          "++id, uuid, batch_code, consignor_id, start_date, end_date, status, payment_status, session_id, sync_status",
        consignment_items:
          "++id, uuid, batch_id, batch_uuid, menu_item_id, inventory_id, item_name",
        consignment_returns:
          "++id, uuid, return_number, batch_id, item_id, return_date, session_id, sync_status",
        consignment_settlements:
          "++id, uuid, settlement_number, batch_id, consignor_id, settlement_date, payment_status, session_id, sync_status",
        consignment_payments:
          "++id, uuid, payment_number, settlement_id, batch_id, consignor_id, payment_date, session_id, sync_status",
      })
      .upgrade(async (tx) => {
        // 1. Migrasi data lama: pastikan seluruh item inventori lama bertipe "owned"
        await tx
          .table("inventory")
          .toCollection()
          .modify((inv: Inventory) => {
            if (!inv.item_type) inv.item_type = "owned";
          });

        // 2. Pastikan consignor lama memiliki default_period_days = 14
        await tx
          .table("consignors")
          .toCollection()
          .modify((csg: Consignor) => {
            if (!csg.default_period_days) csg.default_period_days = 14;
          });

        // 3. Pastikan consignment_batches lama memiliki total_returned_qty dan default status
        await tx
          .table("consignment_batches")
          .toCollection()
          .modify((batch: ConsignmentBatch) => {
            if (batch.total_returned_qty === undefined) batch.total_returned_qty = 0;
            if (!batch.payment_status) batch.payment_status = "unpaid";
          });
      });
  }
}

export const db = new AngkringanDB();
