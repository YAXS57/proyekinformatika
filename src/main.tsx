import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { initSyncService } from "./lib/sync-service";
import { checkAndRunAutoBackup } from "./lib/backup-service";

// Import file CSS yang sudah kita beri konfigurasi -webkit-touch-callout: none
import "./styles.css";

// Matikan menu konteks (pop-up salin/tempel) secara paksa
window.addEventListener(
  "contextmenu",
  (event) => {
    event.preventDefault();
    event.stopPropagation();
    return false;
  },
  true,
);

// Inisialisasi Service Sinkronisasi Latar Belakang & Backup Otomatis
initSyncService("http://localhost:3001");
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    checkAndRunAutoBackup();
  });
  // Periksa saat startup setelah 5 detik
  setTimeout(() => {
    checkAndRunAutoBackup();
  }, 5000);
}

const router = createRouter({ routeTree });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
