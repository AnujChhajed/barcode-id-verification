import { createFileRoute, Outlet } from "@tanstack/react-router";

// ABB Plant 3 — Personnel Management Route Layout
export const Route = createFileRoute("/_authenticated/personnel")({
  component: () => <Outlet />,
});
