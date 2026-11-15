import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("[PostgreSQL Pool Error]", err);
});

/**
 * Tes koneksi ke database PostgreSQL
 */
export async function testConnection(): Promise<boolean> {
  try {
    const res = await pool.query("SELECT NOW()");
    return !!res.rows[0];
  } catch (err) {
    console.error("[PostgreSQL] Gagal konek ke database:", err);
    return false;
  }
}

/**
 * Handler Upsert Idempoten berdasarkan UUID
 */
export async function upsertEntity(
  entityType: string,
  entityUuid: string,
  action: "insert" | "update" | "delete",
  payload: Record<string, any>,
): Promise<void> {
  const client = await pool.connect();

  try {
    if (action === "delete") {
      // Soft-delete di database mirror cloud
      await client.query(
        `UPDATE ${entityType} SET deleted_at = $1, updated_at = $1 WHERE uuid = $2`,
        [Date.now(), entityUuid],
      );
      return;
    }

    // Mapping per tabel untuk upsert
    switch (entityType) {
      case "categories": {
        await client.query(
          `INSERT INTO categories (uuid, name, created_at, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (uuid) DO UPDATE SET
             name = EXCLUDED.name,
             updated_at = EXCLUDED.updated_at,
             deleted_at = EXCLUDED.deleted_at`,
          [
            entityUuid,
            payload.name,
            payload.created_at || Date.now(),
            payload.updated_at || Date.now(),
            payload.deleted_at || null,
          ],
        );
        break;
      }

      case "menu_items": {
        await client.query(
          `INSERT INTO menu_items (uuid, category_uuid, name, price, image, inventory_uuid, is_consignment, consignment_item_id, is_active, created_at, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (uuid) DO UPDATE SET
             name = EXCLUDED.name,
             price = EXCLUDED.price,
             category_uuid = EXCLUDED.category_uuid,
             inventory_uuid = EXCLUDED.inventory_uuid,
             is_consignment = EXCLUDED.is_consignment,
             is_active = EXCLUDED.is_active,
             updated_at = EXCLUDED.updated_at,
             deleted_at = EXCLUDED.deleted_at`,
          [
            entityUuid,
            payload.category_uuid || null,
            payload.name,
            payload.price,
            payload.image || null,
            payload.inventory_uuid || null,
            payload.is_consignment || false,
            payload.consignment_item_id || null,
            payload.is_active !== undefined ? payload.is_active : true,
            payload.created_at || Date.now(),
            payload.updated_at || Date.now(),
            payload.deleted_at || null,
          ],
        );
        break;
      }

      case "inventory": {
        await client.query(
          `INSERT INTO inventory (uuid, name, stock, unit, cost_per_unit, min_stock_alert, last_updated, created_at, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (uuid) DO UPDATE SET
             name = EXCLUDED.name,
             stock = EXCLUDED.stock,
             unit = EXCLUDED.unit,
             cost_per_unit = EXCLUDED.cost_per_unit,
             min_stock_alert = EXCLUDED.min_stock_alert,
             last_updated = EXCLUDED.last_updated,
             updated_at = EXCLUDED.updated_at,
             deleted_at = EXCLUDED.deleted_at`,
          [
            entityUuid,
            payload.name,
            payload.stock || 0,
            payload.unit || "Pcs",
            payload.cost_per_unit || 0,
            payload.min_stock_alert || null,
            payload.last_updated || Date.now(),
            payload.created_at || Date.now(),
            payload.updated_at || Date.now(),
            payload.deleted_at || null,
          ],
        );
        break;
      }

      case "customers": {
        await client.query(
          `INSERT INTO customers (uuid, name, phone, is_active, created_at, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (uuid) DO UPDATE SET
             name = EXCLUDED.name,
             phone = EXCLUDED.phone,
             is_active = EXCLUDED.is_active,
             updated_at = EXCLUDED.updated_at,
             deleted_at = EXCLUDED.deleted_at`,
          [
            entityUuid,
            payload.name,
            payload.phone || null,
            payload.is_active !== undefined ? payload.is_active : true,
            payload.created_at || Date.now(),
            payload.updated_at || Date.now(),
            payload.deleted_at || null,
          ],
        );
        break;
      }

      case "sales": {
        await client.query(
          `INSERT INTO sales (uuid, invoice_number, transaction_date, subtotal, discount_amount, promo_name, total_amount, payment_method, cash_tendered, cash_change, status, customer_name, is_member, session_uuid, created_at, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT (uuid) DO UPDATE SET
             subtotal = EXCLUDED.subtotal,
             discount_amount = EXCLUDED.discount_amount,
             total_amount = EXCLUDED.total_amount,
             payment_method = EXCLUDED.payment_method,
             cash_tendered = EXCLUDED.cash_tendered,
             cash_change = EXCLUDED.cash_change,
             status = EXCLUDED.status,
             customer_name = EXCLUDED.customer_name,
             updated_at = EXCLUDED.updated_at,
             deleted_at = EXCLUDED.deleted_at`,
          [
            entityUuid,
            payload.invoice_number,
            payload.transaction_date,
            payload.subtotal || payload.total_amount,
            payload.discount_amount || 0,
            payload.promo_name || null,
            payload.total_amount,
            payload.payment_method,
            payload.cash_tendered || null,
            payload.cash_change || null,
            payload.status || "paid",
            payload.customer_name || null,
            payload.is_member || false,
            payload.session_uuid || null,
            payload.created_at || Date.now(),
            payload.updated_at || Date.now(),
            payload.deleted_at || null,
          ],
        );
        break;
      }

      case "sale_details": {
        await client.query(
          `INSERT INTO sale_details (uuid, sale_uuid, item_uuid, item_name, quantity, price_at_sale, cost_at_sale, subtotal, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (uuid) DO UPDATE SET
             quantity = EXCLUDED.quantity,
             price_at_sale = EXCLUDED.price_at_sale,
             cost_at_sale = EXCLUDED.cost_at_sale,
             subtotal = EXCLUDED.subtotal`,
          [
            entityUuid,
            payload.sale_uuid,
            payload.item_uuid || null,
            payload.item_name,
            payload.quantity,
            payload.price_at_sale,
            payload.cost_at_sale || null,
            payload.subtotal,
            payload.created_at || Date.now(),
          ],
        );
        break;
      }

      case "expenses": {
        await client.query(
          `INSERT INTO expenses (uuid, expense_date, description, amount, category, payment_method, session_uuid, created_at, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (uuid) DO UPDATE SET
             description = EXCLUDED.description,
             amount = EXCLUDED.amount,
             category = EXCLUDED.category,
             payment_method = EXCLUDED.payment_method,
             updated_at = EXCLUDED.updated_at,
             deleted_at = EXCLUDED.deleted_at`,
          [
            entityUuid,
            payload.expense_date,
            payload.description,
            payload.amount,
            payload.category,
            payload.payment_method || "Cash",
            payload.session_uuid || null,
            payload.created_at || Date.now(),
            payload.updated_at || Date.now(),
            payload.deleted_at || null,
          ],
        );
        break;
      }

      case "purchases": {
        await client.query(
          `INSERT INTO purchases (uuid, invoice_number, purchase_date, supplier_name, payment_method, total_amount, notes, session_uuid, created_at, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (uuid) DO UPDATE SET
             supplier_name = EXCLUDED.supplier_name,
             payment_method = EXCLUDED.payment_method,
             total_amount = EXCLUDED.total_amount,
             notes = EXCLUDED.notes,
             updated_at = EXCLUDED.updated_at,
             deleted_at = EXCLUDED.deleted_at`,
          [
            entityUuid,
            payload.invoice_number,
            payload.purchase_date,
            payload.supplier_name || null,
            payload.payment_method || "Cash",
            payload.total_amount,
            payload.notes || null,
            payload.session_uuid || null,
            payload.created_at || Date.now(),
            payload.updated_at || Date.now(),
            payload.deleted_at || null,
          ],
        );
        break;
      }

      case "cash_sessions": {
        await client.query(
          `INSERT INTO cash_sessions (uuid, session_date, opened_at, closed_at, initial_cash, total_cash_sales, total_qris_sales, total_cash_purchases, total_cash_expenses, total_cash_settlements, expected_cash, actual_cash, cash_difference, status, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT (uuid) DO UPDATE SET
             closed_at = EXCLUDED.closed_at,
             total_cash_sales = EXCLUDED.total_cash_sales,
             total_qris_sales = EXCLUDED.total_qris_sales,
             total_cash_purchases = EXCLUDED.total_cash_purchases,
             total_cash_expenses = EXCLUDED.total_cash_expenses,
             total_cash_settlements = EXCLUDED.total_cash_settlements,
             expected_cash = EXCLUDED.expected_cash,
             actual_cash = EXCLUDED.actual_cash,
             cash_difference = EXCLUDED.cash_difference,
             status = EXCLUDED.status,
             notes = EXCLUDED.notes,
             updated_at = EXCLUDED.updated_at`,
          [
            entityUuid,
            payload.session_date,
            payload.opened_at,
            payload.closed_at || null,
            payload.initial_cash || 0,
            payload.total_cash_sales || 0,
            payload.total_qris_sales || 0,
            payload.total_cash_purchases || 0,
            payload.total_cash_expenses || 0,
            payload.total_cash_settlements || 0,
            payload.expected_cash || 0,
            payload.actual_cash !== undefined ? payload.actual_cash : null,
            payload.cash_difference !== undefined ? payload.cash_difference : null,
            payload.status || "open",
            payload.notes || null,
            payload.created_at || Date.now(),
            payload.updated_at || Date.now(),
          ],
        );
        break;
      }

      default:
        console.warn(`[Upsert] Tipe entitas ${entityType} belum ditangani secara spesifik.`);
        break;
    }
  } finally {
    client.release();
  }
}
