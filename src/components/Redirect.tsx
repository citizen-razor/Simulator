import { useEffect } from "react";
/** Replaces the current address (no history entry), for links to things you can't open. */
export function Redirect({ to }: { to: string }) {
  useEffect(() => {
    location.replace(to);
  }, [to]);
  return null;
}
