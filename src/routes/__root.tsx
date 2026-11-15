import { createRootRoute, Outlet, Link, useRouterState } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { LayoutDashboard, Store, Clock, BarChart3, Settings, ArrowUpDown } from "lucide-react";
import { useEffect } from "react";
import { LocalNotifications } from "@capacitor/local-notifications";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  // Ambil path lokasi saat ini untuk logika tombol back
  const location = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const setupNativeAndroid = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          await LocalNotifications.requestPermissions();
          await KeepAwake.keepAwake();
          await StatusBar.setStyle({ style: Style.Dark });
          await StatusBar.setBackgroundColor({ color: "#09090b" });

          CapacitorApp.removeAllListeners();
          CapacitorApp.addListener("backButton", () => {
            const activeDialog = document.querySelector('[role="dialog"]');
            if (activeDialog) {
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            } else {
              if (window.location.pathname === "/" || window.location.pathname === "/dashboard") {
                const confirmExit = confirm("Yakin ingin keluar dari aplikasi?");
                if (confirmExit) {
                  CapacitorApp.exitApp();
                }
              } else {
                window.history.back();
              }
            }
          });
        } catch (e) {
          console.error("Gagal setup native fitur", e);
        }
      }
    };

    setupNativeAndroid();

    return () => {
      if (Capacitor.isNativePlatform()) {
        CapacitorApp.removeAllListeners();
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased pb-24">
      <Outlet />
      <Toaster position="top-center" richColors />

      {/* Navbar Responsif dengan 6 Menu Navigasi Utama */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur border-t border-border flex justify-around items-center h-20 pb-safe shadow-[0_-4px_12px_rgba(0,0,0,0.15)] md:max-w-2xl md:mx-auto md:bottom-3 md:rounded-2xl md:border md:shadow-lg">
        <NavItem to="/dashboard" icon={<LayoutDashboard className="h-5 w-5" />} label="Dasbor" />
        <NavItem to="/" icon={<Store className="h-5 w-5" />} label="Kasir" />
        <NavItem to="/riwayat" icon={<Clock className="h-5 w-5" />} label="Riwayat" />
        <NavItem to="/pengeluaran" icon={<ArrowUpDown className="h-5 w-5" />} label="Catat" />
        <NavItem to="/laporan" icon={<BarChart3 className="h-5 w-5" />} label="Laporan" />
        <NavItem to="/kelola" icon={<Settings className="h-5 w-5" />} label="Kelola" />
      </nav>
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center justify-center w-full h-full text-muted-foreground hover:text-primary transition-colors [&.active]:text-primary"
    >
      {icon}
      <span className="text-[10.5px] mt-1 font-bold">{label}</span>
    </Link>
  );
}
