# Rancangan Skema Database Angkringan POS

Dokumen ini mendokumentasikan analisis database lokal saat ini, strategi migrasi aman tanpa merusak data lama, serta spesifikasi lengkap struktur database Dexie.js (IndexedDB) dan mapping relasional ke PostgreSQL (Cloud Replica).

---

## 1. Audit Database Saat Ini (Status Quo)

Aplikasi saat ini menggunakan **Dexie.js v4** dengan nama database `AngkringanDB` pada skema **Version 5** (`src/lib/db.ts`).

### Skema Database v5 Saat Ini:
```typescript
categories: '++id, name, created_at',
menu_items: '++id, category_id, name, price, created_at',
sales: '++id, transaction_date, payment_method, status',
sale_details: '++id, sale_id, item_id',
expenses: '++id, expense_date, category',
inventory: '++id, name, last_updated',
customers: '++id, name'
```

### Evaluasi Keterbatasan Skema Saat Ini:
1. **Identitas Data:** Menggunakan integer auto-increment lokal (`++id`). Hal ini rentan bentrok jika di masa depan data direplikasi ke cloud tanpa UUID unik global.
2. **Ketiadaan Tracking Sinkronisasi:** Tidak ada penanda `sync_status`, `updated_at`, atau `deleted_at` (soft-delete), sehingga perubahan lokal tidak dapat dilacak untuk sinkronisasi diferensial ke backend.
3. **Pemisahan Pengeluaran dan Pembelian:** Belum ada entitas `purchases` (pembelian barang dagangan/kulakan). Saat ini pembelian dicampur aduk ke dalam tabel `expenses` kategori "Bahan Baku" atau disunting manual pada stok gudang.
4. **Ketiadaan Modul Konsinyasi:** Belum ada pencatatan penitip barang (*consignor*), periode titipan (*consignment batches*), kuantitas titip/retur/laku, dan rekap pembayaran setoran.
5. **Ketiadaan Sesi Kas Harian (Cash Session):** Tidak ada pencatatan pembukaan kasir (modal awal kas), uang fisik aktual, dan rekonsiliasi kas riil vs sistem saat penutupan harian.

---

## 2. Prinsip & Strategi Migrasi Tanpa Merusak Data (Zero Data Loss)

Untuk menjamin data transaksi pemilik angkringan tidak hilang atau rusak:
1. **Pertahankan Kolom Kunci Primer `id` (Auto-increment Numeric):**
   - Tetap pertahankan `id: number` sebagai primary key lokal di IndexedDB agar relasi historis yang ada (`sale_id`, `category_id`, `inventory_id`) tetap valid 100%.
2. **Tambahkan Kolom `uuid` Unik Global:**
   - Tambahkan kolom `uuid: string` bertipe UUID v4 (`crypto.randomUUID()`) pada setiap entitas.
   - Buat indeks unik `&uuid` di Dexie.
   - Pada migrasi Dexie Version 6, jalankan fungsi upgrade untuk mengenerate `uuid` otomatis bagi setiap baris data lama yang belum memilikinya.
3. **Standarisasi Kolom Audit & Sinkronisasi:**
   - `created_at: number` (Unix Epoch timestamp ms)
   - `updated_at: number` (Unix Epoch timestamp ms)
   - `deleted_at?: number | null` (Untuk soft-delete agar sinkronisasi cloud mengetahui data yang dihapus)
   - `sync_status: 'synced' | 'pending' | 'failed'`
4. **Migrasi Deklaratif Dexie:**
   - Gunakan `this.version(6).stores({...}).upgrade(tx => { ... })` sehingga database pengguna otomatis ter-upgrade tanpa menghapus database IndexedDB lama.

---

## 3. Skema Dexie.js (IndexedDB) Versi 6 (Diusulkan)

### Definisi Tabel dan Index di Dexie:
```typescript
this.version(6).stores({
  // Tabel Master & Operasional Lama (Diperkaya)
  categories: '++id, &uuid, name, created_at, sync_status',
  menu_items: '++id, &uuid, category_id, name, price, inventory_id, is_active, sync_status',
  inventory: '++id, &uuid, name, stock, unit, cost_per_unit, last_updated, sync_status',
  customers: '++id, &uuid, name, phone, is_active, sync_status',
  
  // Transaksi Penjualan (Diperkaya dengan nomor nota & session_id)
  sales: '++id, &uuid, invoice_number, transaction_date, payment_method, status, session_id, sync_status',
  sale_details: '++id, &uuid, sale_id, sale_uuid, item_id, item_uuid',

  // Biaya Operasional (Non-Kulakan)
  expenses: '++id, &uuid, expense_date, category, payment_method, session_id, sync_status',

  // Modul Pembelian Barang Dagangan (Kulakan)
  purchases: '++id, &uuid, invoice_number, purchase_date, supplier_name, payment_method, session_id, sync_status',
  purchase_details: '++id, &uuid, purchase_id, purchase_uuid, inventory_id',

  // Modul Konsinyasi (Titip Jual)
  consignors: '++id, &uuid, name, phone, is_active, sync_status',
  consignment_batches: '++id, &uuid, batch_code, consignor_id, start_date, end_date, status, session_id, sync_status',
  consignment_items: '++id, &uuid, batch_id, batch_uuid, menu_item_id, item_name',
  consignment_settlements: '++id, &uuid, settlement_number, batch_id, consignor_id, settlement_date, payment_method, session_id, sync_status',

  // Modul Kasir: Sesi Buka & Tutup Kas Harian
  cash_sessions: '++id, &uuid, session_date, opened_at, closed_at, status, sync_status',

  // Antrean Sinkronisasi & Konfigurasi Lokal
  sync_queue: '++id, &queue_id, entity_type, entity_uuid, action, status, created_at',
  app_settings: '&key, updated_at',
  backup_history: '++id, backup_date, backup_type, status'
});
```

---

## 4. Rincian Tipe Entitas TypeScript (`src/lib/db.ts`)

### A. Tabel Master

```typescript
export interface Category {
  id?: number;
  uuid: string;
  name: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  sync_status: 'synced' | 'pending' | 'failed';
}

export interface MenuItem {
  id?: number;
  uuid: string;
  category_id: number;
  name: string;
  price: number;
  image?: string;
  inventory_id?: number;
  is_consignment?: boolean;       // Penanda apakah item ini merupakan titipan
  consignment_item_id?: number;   // Relasi ke barang konsinyasi aktif
  is_active: boolean;             // True jika item tampil di kasir
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  sync_status: 'synced' | 'pending' | 'failed';
}

export interface Inventory {
  id?: number;
  uuid: string;
  name: string;
  stock: number;
  unit: string;                   // 'Pcs', 'Bungkus', 'Porsi', 'Kg', dll.
  cost_per_unit: number;          // Harga beli / HPP satuan
  min_stock_alert?: number;       // Batas peringatan stok menipis
  last_updated: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  sync_status: 'synced' | 'pending' | 'failed';
}

export interface Customer {
  id?: number;
  uuid: string;
  name: string;
  phone?: string;
  is_active: boolean;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  sync_status: 'synced' | 'pending' | 'failed';
}
```

### B. Transaksi Penjualan (Kasir)

```typescript
export interface Sale {
  id?: number;
  uuid: string;
  invoice_number: string;         // Format: TRX-YYYYMMDD-XXXX
  transaction_date: number;
  subtotal: number;
  discount_amount: number;
  promo_name?: string;
  total_amount: number;           // subtotal - discount_amount
  payment_method: "Cash" | "QRIS";
  cash_tendered?: number;         // Nominal uang tunai diterima
  cash_change?: number;           // Uang kembalian
  status: "paid" | "void";
  customer_name?: string;
  is_member?: boolean;
  session_id?: number;            // Foreign key ke cash_sessions aktif
  session_uuid?: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  sync_status: 'synced' | 'pending' | 'failed';
}

export interface SaleDetail {
  id?: number;
  uuid: string;
  sale_id: number;
  sale_uuid: string;
  item_id: number;
  item_uuid?: string;
  item_name: string;
  quantity: number;
  price_at_sale: number;
  cost_at_sale?: number;          // HPP saat transaksi (untuk akurasi laba kotor)
  subtotal: number;               // quantity * price_at_sale
  created_at: number;
}
```

### C. Pembelian Barang Dagangan (Kulakan)

```typescript
export interface Purchase {
  id?: number;
  uuid: string;
  invoice_number: string;         // Format: PUR-YYYYMMDD-XXXX
  purchase_date: number;
  supplier_name?: string;         // Contoh: Agen Sembako, Grosir Rokok
  payment_method: "Cash" | "Transfer";
  total_amount: number;
  notes?: string;
  session_id?: number;            // FK ke cash_sessions (jika dibayar tunai dari kas warung)
  session_uuid?: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  sync_status: 'synced' | 'pending' | 'failed';
}

export interface PurchaseDetail {
  id?: number;
  uuid: string;
  purchase_id: number;
  purchase_uuid: string;
  inventory_id?: number;          // Jika langsung menambah stok gudang
  inventory_uuid?: string;
  item_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  subtotal: number;
  created_at: number;
}
```

### D. Pengeluaran Operasional (Non-Kulakan)

```typescript
export interface Expense {
  id?: number;
  uuid: string;
  expense_date: number;
  category: "Operasional" | "Listrik & Air" | "Gas & Arang" | "Sewa" | "Gaji" | "Lain-lain";
  description: string;
  amount: number;
  payment_method: "Cash" | "Transfer";
  session_id?: number;            // FK ke cash_sessions (jika tunai keluar dari kas)
  session_uuid?: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  sync_status: 'synced' | 'pending' | 'failed';
}
```

### E. Manajemen Konsinyasi (Titip Jual)

```typescript
export interface Consignor {
  id?: number;
  uuid: string;
  name: string;                   // Nama pemilik barang titipan (cth: Bu Siti)
  phone?: string;
  address?: string;
  is_active: boolean;
  notes?: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  sync_status: 'synced' | 'pending' | 'failed';
}

export interface ConsignmentBatch {
  id?: number;
  uuid: string;
  batch_code: string;             // Format: CSG-YYYYMMDD-XXXX
  consignor_id: number;
  consignor_uuid: string;
  start_date: number;             // Awal periode penerimaan barang
  end_date: number;               // Akhir periode (cth: 14 hari)
  status: "active" | "settled";   // settled jika sudah direkap & disetor
  total_sales_value: number;      // Total nilai kotor omzet barang titipan
  total_payout_due: number;       // Hak setor ke penitip (qty_terjual * nilai_setor_satuan)
  total_paid: number;             // Yang sudah dibayarkan
  payment_status: "unpaid" | "partial" | "paid";
  session_id?: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  sync_status: 'synced' | 'pending' | 'failed';
}

export interface ConsignmentItem {
  id?: number;
  uuid: string;
  batch_id: number;
  batch_uuid: string;
  menu_item_id?: number;          // Tautan ke menu kasir agar otomatis terjual saat di kasir
  item_name: string;              // Contoh: "Keripik Tahu", "Tahu Bakso"
  qty_received: number;           // Barang masuk (cth: 30)
  qty_sold: number;               // Barang laku (cth: 22)
  qty_returned: number;           // Barang retur/kembali (cth: 8)
  sell_price: number;             // Harga jual ke pembeli (cth: Rp3.000)
  payout_per_unit: number;        // Nilai setoran ke penitip (cth: Rp2.000)
  subtotal_payout: number;        // qty_sold * payout_per_unit (cth: Rp44.000)
  angkot_profit: number;          // qty_sold * (sell_price - payout_per_unit) (cth: Rp22.000)
  created_at: number;
  updated_at: number;
}

export interface ConsignmentSettlement {
  id?: number;
  uuid: string;
  settlement_number: string;      // Format: STL-YYYYMMDD-XXXX
  batch_id: number;
  batch_uuid: string;
  consignor_id: number;
  consignor_uuid: string;
  settlement_date: number;
  amount_paid: number;            // Nominal uang yang diserahkan ke penitip
  payment_method: "Cash" | "Transfer";
  notes?: string;
  session_id?: number;            // FK ke cash_sessions (jika bayar tunai dari laci)
  session_uuid?: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  sync_status: 'synced' | 'pending' | 'failed';
}
```

### F. Sesi Kas Buka & Tutup Harian

```typescript
export interface CashSession {
  id?: number;
  uuid: string;
  session_date: string;           // YYYY-MM-DD
  opened_at: number;              // Timestamp buka
  closed_at?: number | null;      // Timestamp tutup
  initial_cash: number;           // Modal awal kas di laci (cth: Rp150.000)
  
  // Kalkulasi Otomatis Sesi Tunai:
  total_cash_sales: number;       // (+) Penjualan tunai
  total_cash_purchases: number;   // (-) Pembelian tunai keluar dari kas
  total_cash_expenses: number;    // (-) Pengeluaran operasional tunai
  total_cash_settlements: number; // (-) Pembayaran setoran konsinyasi tunai
  
  // Info Non-Kas (Dicatat terpisah, TIDAK masuk laci):
  total_qris_sales: number;       // Penjualan via QRIS (masuk rekening bank)
  total_transfer_expenses: number;// Pengeluaran via transfer bank
  
  // Rekonsiliasi Kas Fisik:
  expected_cash: number;          // Modal Awal + Cash In - Cash Out
  actual_cash?: number;           // Uang tunai riil dihitung tangan di laci
  cash_difference?: number;       // actual_cash - expected_cash (0 = pas, minus = selisih kurang)
  
  status: "open" | "closed";
  notes?: string;
  created_at: number;
  updated_at: number;
  sync_status: 'synced' | 'pending' | 'failed';
}
```

### G. Antrean Sinkronisasi & Backup

```typescript
export interface SyncQueue {
  id?: number;
  queue_id: string;               // UUID item antrean
  entity_type: 'sales' | 'purchases' | 'expenses' | 'consignments' | 'inventory' | 'cash_sessions' | 'menu_items' | 'categories';
  entity_uuid: string;
  action: 'insert' | 'update' | 'delete';
  payload: any;                   // Data JSON lengkap
  status: 'pending' | 'syncing' | 'failed';
  retry_count: number;
  last_error?: string;
  created_at: number;
  updated_at: number;
}

export interface AppSetting {
  key: string;                    // 'store_name', 'google_drive_connected', 'last_backup_time', dll.
  value: any;
  updated_at: number;
}

export interface BackupHistory {
  id?: number;
  uuid: string;
  backup_date: number;
  backup_type: 'auto' | 'manual';
  destination: 'local' | 'gdrive' | 'both';
  file_name: string;
  file_size: number;
  checksum: string;               // SHA-256 hash untuk verifikasi integritas
  status: 'success' | 'failed';
  error_message?: string;
  created_at: number;
}
```

---

## 5. Skema Relasional PostgreSQL (Cloud Mirror)

Backend REST API menggunakan skema PostgreSQL yang identik strukturnya, dengan `uuid` sebagai PRIMARY KEY untuk menjamin integritas replikasi tanpa bentrok auto-increment.

```sql
-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Master Categories
CREATE TABLE categories (
    uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

-- Master Menu Items
CREATE TABLE menu_items (
    uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_uuid UUID REFERENCES categories(uuid),
    name VARCHAR(150) NOT NULL,
    price NUMERIC(15, 2) NOT NULL,
    image TEXT,
    inventory_uuid UUID,
    is_active BOOLEAN DEFAULT TRUE,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

-- Master Inventory
CREATE TABLE inventory (
    uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
    unit VARCHAR(30) NOT NULL,
    cost_per_unit NUMERIC(15, 2) NOT NULL DEFAULT 0,
    last_updated BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

-- Cash Sessions (Buka/Tutup Kas)
CREATE TABLE cash_sessions (
    uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_date DATE NOT NULL,
    opened_at BIGINT NOT NULL,
    closed_at BIGINT,
    initial_cash NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_cash_sales NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_qris_sales NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_cash_purchases NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_cash_expenses NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_cash_settlements NUMERIC(15, 2) NOT NULL DEFAULT 0,
    expected_cash NUMERIC(15, 2) NOT NULL DEFAULT 0,
    actual_cash NUMERIC(15, 2),
    cash_difference NUMERIC(15, 2),
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    notes TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

-- Sales & Details
CREATE TABLE sales (
    uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    transaction_date BIGINT NOT NULL,
    subtotal NUMERIC(15, 2) NOT NULL,
    discount_amount NUMERIC(15, 2) DEFAULT 0,
    promo_name VARCHAR(100),
    total_amount NUMERIC(15, 2) NOT NULL,
    payment_method VARCHAR(20) NOT NULL,
    cash_tendered NUMERIC(15, 2),
    cash_change NUMERIC(15, 2),
    status VARCHAR(20) NOT NULL DEFAULT 'paid',
    customer_name VARCHAR(100),
    is_member BOOLEAN DEFAULT FALSE,
    session_uuid UUID REFERENCES cash_sessions(uuid),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

CREATE TABLE sale_details (
    uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sale_uuid UUID REFERENCES sales(uuid) ON DELETE CASCADE,
    item_uuid UUID REFERENCES menu_items(uuid),
    item_name VARCHAR(150) NOT NULL,
    quantity INTEGER NOT NULL,
    price_at_sale NUMERIC(15, 2) NOT NULL,
    cost_at_sale NUMERIC(15, 2),
    subtotal NUMERIC(15, 2) NOT NULL,
    created_at BIGINT NOT NULL
);

-- Purchases & Details
CREATE TABLE purchases (
    uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    purchase_date BIGINT NOT NULL,
    supplier_name VARCHAR(150),
    payment_method VARCHAR(20) NOT NULL,
    total_amount NUMERIC(15, 2) NOT NULL,
    notes TEXT,
    session_uuid UUID REFERENCES cash_sessions(uuid),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

CREATE TABLE purchase_details (
    uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_uuid UUID REFERENCES purchases(uuid) ON DELETE CASCADE,
    inventory_uuid UUID REFERENCES inventory(uuid),
    item_name VARCHAR(150) NOT NULL,
    quantity NUMERIC(12, 2) NOT NULL,
    unit VARCHAR(30) NOT NULL,
    unit_price NUMERIC(15, 2) NOT NULL,
    subtotal NUMERIC(15, 2) NOT NULL,
    created_at BIGINT NOT NULL
);

-- Operational Expenses
CREATE TABLE expenses (
    uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expense_date BIGINT NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    payment_method VARCHAR(20) NOT NULL,
    session_uuid UUID REFERENCES cash_sessions(uuid),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

-- Consignments
CREATE TABLE consignors (
    uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30),
    address TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

CREATE TABLE consignment_batches (
    uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_code VARCHAR(50) UNIQUE NOT NULL,
    consignor_uuid UUID REFERENCES consignors(uuid),
    start_date BIGINT NOT NULL,
    end_date BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    total_sales_value NUMERIC(15, 2) DEFAULT 0,
    total_payout_due NUMERIC(15, 2) DEFAULT 0,
    total_paid NUMERIC(15, 2) DEFAULT 0,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
    session_uuid UUID REFERENCES cash_sessions(uuid),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

CREATE TABLE consignment_items (
    uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_uuid UUID REFERENCES consignment_batches(uuid) ON DELETE CASCADE,
    item_name VARCHAR(150) NOT NULL,
    qty_received INTEGER NOT NULL DEFAULT 0,
    qty_sold INTEGER NOT NULL DEFAULT 0,
    qty_returned INTEGER NOT NULL DEFAULT 0,
    sell_price NUMERIC(15, 2) NOT NULL,
    payout_per_unit NUMERIC(15, 2) NOT NULL,
    subtotal_payout NUMERIC(15, 2) NOT NULL DEFAULT 0,
    angkot_profit NUMERIC(15, 2) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE TABLE consignment_settlements (
    uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    settlement_number VARCHAR(50) UNIQUE NOT NULL,
    batch_uuid UUID REFERENCES consignment_batches(uuid),
    consignor_uuid UUID REFERENCES consignors(uuid),
    settlement_date BIGINT NOT NULL,
    amount_paid NUMERIC(15, 2) NOT NULL,
    payment_method VARCHAR(20) NOT NULL,
    notes TEXT,
    session_uuid UUID REFERENCES cash_sessions(uuid),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);
```
