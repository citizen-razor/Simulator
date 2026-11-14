/** Tells people who aren't Admin-Builders that a page is view-only for them. */
import { useAdmin } from "../lib/admin";

export function AdminBar({ what }: { what: string }) {
  const admin = useAdmin();
  if (!admin.ready || admin.isAdmin) return null;
  return <div className="alert warn small">🔒 View only. Editing {what} is for Admin-Builders.</div>;
}
