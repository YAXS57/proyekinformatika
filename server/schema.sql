-- ===================================================================
-- Skema Database PostgreSQL Cloud Mirror — Angkringan POS
-- ===================================================================
-- Menjamin replikasi idempoten dari IndexedDB lokal ke Cloud Mirror
-- Menggunakan UUID sebagai kunci utama tanpa bentrok auto-increment.
-- ===================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. KATEGORI
CREATE TABLE IF NOT EXISTS categories (
    uuid UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

-- 2. GUDANG / INVENTARIS
CREATE TABLE IF NOT EXISTS inventory (
    uuid UUID PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
    unit VARCHAR(30) NOT NULL,
    cost_per_unit NUMERIC(15, 2) NOT NULL DEFAULT 0,
    min_stock_alert NUMERIC(12, 2),
    last_updated BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

-- 3. MENU ITEMS
CREATE TABLE IF NOT EXISTS menu_items (
    uuid UUID PRIMARY KEY,
    category_uuid UUID REFERENCES categories(uuid),
    name VARCHAR(150) NOT NULL,
    price NUMERIC(15, 2) NOT NULL,
    image TEXT,
    inventory_uuid UUID REFERENCES inventory(uuid),
    is_consignment BOOLEAN DEFAULT FALSE,
    consignment_item_id INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

-- 4. PELANGGAN / MEMBER
CREATE TABLE IF NOT EXISTS customers (
    uuid UUID PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30),
    is_active BOOLEAN DEFAULT TRUE,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

-- 5. SESI KAS BUKA / TUTUP HARIAN
CREATE TABLE IF NOT EXISTS cash_sessions (
    uuid UUID PRIMARY KEY,
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

-- 6. PENJUALAN (SALES)
CREATE TABLE IF NOT EXISTS sales (
    uuid UUID PRIMARY KEY,
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

-- 7. DETAIL PENJUALAN (SALE DETAILS)
CREATE TABLE IF NOT EXISTS sale_details (
    uuid UUID PRIMARY KEY,
    sale_uuid UUID REFERENCES sales(uuid) ON DELETE CASCADE,
    item_uuid UUID,
    item_name VARCHAR(150) NOT NULL,
    quantity INTEGER NOT NULL,
    price_at_sale NUMERIC(15, 2) NOT NULL,
    cost_at_sale NUMERIC(15, 2),
    subtotal NUMERIC(15, 2) NOT NULL,
    created_at BIGINT NOT NULL
);

-- 8. PENGELUARAN OPERASIONAL (EXPENSES)
CREATE TABLE IF NOT EXISTS expenses (
    uuid UUID PRIMARY KEY,
    expense_date BIGINT NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    category VARCHAR(80) NOT NULL,
    payment_method VARCHAR(20) NOT NULL DEFAULT 'Cash',
    session_uuid UUID REFERENCES cash_sessions(uuid),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

-- 9. PEMBELIAN BARANG DAGANGAN / KULAKAN (PURCHASES)
CREATE TABLE IF NOT EXISTS purchases (
    uuid UUID PRIMARY KEY,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    purchase_date BIGINT NOT NULL,
    supplier_name VARCHAR(150),
    payment_method VARCHAR(20) NOT NULL DEFAULT 'Cash',
    total_amount NUMERIC(15, 2) NOT NULL,
    notes TEXT,
    session_uuid UUID REFERENCES cash_sessions(uuid),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

-- 10. DETAIL PEMBELIAN (PURCHASE DETAILS)
CREATE TABLE IF NOT EXISTS purchase_details (
    uuid UUID PRIMARY KEY,
    purchase_uuid UUID REFERENCES purchases(uuid) ON DELETE CASCADE,
    inventory_uuid UUID REFERENCES inventory(uuid),
    item_name VARCHAR(150) NOT NULL,
    quantity NUMERIC(12, 2) NOT NULL,
    unit VARCHAR(30) NOT NULL,
    unit_price NUMERIC(15, 2) NOT NULL,
    subtotal NUMERIC(15, 2) NOT NULL,
    created_at BIGINT NOT NULL
);

-- 11. PENITIP KONSINYASI (CONSIGNORS)
CREATE TABLE IF NOT EXISTS consignors (
    uuid UUID PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30),
    address TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

-- 12. BATCH KONSINYASI (CONSIGNMENT BATCHES)
CREATE TABLE IF NOT EXISTS consignment_batches (
    uuid UUID PRIMARY KEY,
    batch_code VARCHAR(50) UNIQUE NOT NULL,
    consignor_uuid UUID REFERENCES consignors(uuid),
    start_date BIGINT NOT NULL,
    end_date BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    total_sales_value NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_payout_due NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_paid NUMERIC(15, 2) NOT NULL DEFAULT 0,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
    session_uuid UUID REFERENCES cash_sessions(uuid),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

-- 13. ITEM KONSINYASI (CONSIGNMENT ITEMS)
CREATE TABLE IF NOT EXISTS consignment_items (
    uuid UUID PRIMARY KEY,
    batch_uuid UUID REFERENCES consignment_batches(uuid) ON DELETE CASCADE,
    menu_item_uuid UUID,
    item_name VARCHAR(150) NOT NULL,
    qty_received INTEGER NOT NULL DEFAULT 0,
    qty_sold INTEGER NOT NULL DEFAULT 0,
    qty_returned INTEGER NOT NULL DEFAULT 0,
    sell_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
    payout_per_unit NUMERIC(15, 2) NOT NULL DEFAULT 0,
    subtotal_payout NUMERIC(15, 2) NOT NULL DEFAULT 0,
    angkot_profit NUMERIC(15, 2) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

-- 14. SETORAN KONSINYASI (CONSIGNMENT SETTLEMENTS)
CREATE TABLE IF NOT EXISTS consignment_settlements (
    uuid UUID PRIMARY KEY,
    settlement_number VARCHAR(50) UNIQUE NOT NULL,
    batch_uuid UUID REFERENCES consignment_batches(uuid),
    consignor_uuid UUID REFERENCES consignors(uuid),
    settlement_date BIGINT NOT NULL,
    amount_paid NUMERIC(15, 2) NOT NULL,
    payment_method VARCHAR(20) NOT NULL DEFAULT 'Cash',
    notes TEXT,
    session_uuid UUID REFERENCES cash_sessions(uuid),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

-- 15. RIWAYAT BACKUP ARSIP CLOUD
CREATE TABLE IF NOT EXISTS backup_history (
    uuid UUID PRIMARY KEY,
    backup_date BIGINT NOT NULL,
    backup_type VARCHAR(20) NOT NULL,
    destination VARCHAR(20) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL,
    gdrive_file_id VARCHAR(100),
    error_message TEXT,
    created_at BIGINT NOT NULL
);
