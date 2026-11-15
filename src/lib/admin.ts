/**
 * Admin-Builder checks for pages that predate accounts. "Admin" now simply means the
 * signed-in person has the Admin-Builder role (see shared/people.ts).
 */
import { useAuth } from "./auth";

export function useAdmin() {
  const auth = useAuth();
  return { ready: !auth.loading, pinRequired: true, isAdmin: auth.isAdmin, lock: () => undefined };
}
