import { createFileRoute, Navigate } from "@tanstack/react-router";

// Backward-compatibility alias route: redirects /students to /personnel
export const Route = createFileRoute("/_authenticated/students")({
  component: () => <Navigate to="/personnel" replace />,
});
