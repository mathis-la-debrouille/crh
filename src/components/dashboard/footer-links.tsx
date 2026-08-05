"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function FooterLinks() {
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function disconnect(type: "google" | "whatsapp") {
    if (!confirm(`Déconnecter ${type === "google" ? "Google" : "WhatsApp"} ? Tu pourras te reconnecter plus tard.`)) return;
    setDisconnecting(type);
    await fetch("/api/user/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    setDisconnecting(null);
    window.location.reload();
  }

  async function confirmDelete() {
    setDeleting(true);
    await fetch("/api/user/delete", { method: "DELETE" });
    await signOut({ redirect: false });
    window.location.href = "/";
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-xs text-slate-400">
        <button
          onClick={() => window.open("/api/user/export", "_blank")}
          className="hover:text-slate-600 hover:underline"
        >
          Exporter mes données
        </button>
        <span>·</span>
        <button
          onClick={() => disconnect("google")}
          disabled={disconnecting === "google"}
          className="hover:text-slate-600 hover:underline disabled:opacity-50"
        >
          {disconnecting === "google" ? "Déconnexion…" : "Déconnecter Google"}
        </button>
        <span>·</span>
        <button
          onClick={() => disconnect("whatsapp")}
          disabled={disconnecting === "whatsapp"}
          className="hover:text-slate-600 hover:underline disabled:opacity-50"
        >
          {disconnecting === "whatsapp" ? "Déconnexion…" : "Déconnecter WhatsApp"}
        </button>
        <span>·</span>
        <span>Plan gratuit</span>
        <span>·</span>
        <button onClick={() => setShowDeleteModal(true)} className="text-red-400 hover:text-red-600 hover:underline">
          Supprimer mon compte
        </button>
      </div>

      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => !deleting && setShowDeleteModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-red-100 bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-red-600">Danger zone</p>
            <p className="mt-2 text-sm text-slate-600">
              Supprime définitivement ton compte, tous tes messages, contacts et l&apos;historique de l&apos;agent.
              Cette action est irréversible.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowDeleteModal(false)} disabled={deleting}>
                Annuler
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={confirmDelete}
                disabled={deleting}
                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                {deleting ? "Suppression…" : "Supprimer mon compte"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
