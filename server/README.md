# Angkringan POS — Cloud Service & Mirror Backend

Layanan cloud pendukung untuk aplikasi **Angkringan POS**.

## Fitur Utama:
1. **Idempotent Batch Sync (`POST /api/v1/sync`):**
   Menerima antrean mutasi data dari IndexedDB lokal (`db.sync_queue`) dan melakukan upsert aman ke PostgreSQL berdasarkan `uuid`.
2. **PostgreSQL Mirror Database:**
   Salinan data operasional terstruktur di cloud yang dapat digunakan untuk analitik atau pemulihan darurat.
3. **Google Drive Backup Uploader (`POST /api/v1/backup/gdrive`):**
   Menyimpan arsip snapshot JSON terenkripsi/terverifikasi SHA-256 langsung ke folder Google Drive pemilik angkringan tanpa pernah membocorkan kredensial atau private key ke perangkat kasir (frontend).
4. **Health Check (`GET /api/v1/health`):**
   Mendeteksi status koneksi database PostgreSQL dan integrasi Google Drive.

---

## Cara Menjalankan Secara Lokal

1. Salin template environment variables:
   ```bash
   cp .env.example .env
   ```
2. Isi variabel `DATABASE_URL` dengan kredensial PostgreSQL Anda.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Eksekusi skema database:
   ```bash
   psql -d angkringan_pos -f schema.sql
   ```
5. Jalankan server:
   ```bash
   npm run dev
   ```
