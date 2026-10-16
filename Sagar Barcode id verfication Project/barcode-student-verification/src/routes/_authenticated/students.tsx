import { createFileRoute, Outlet } from "@tanstack/react-router";

// This file is a transparent layout — the real pages are:
//   students.index.tsx  →  /students   (list)
//   students.$id.tsx    →  /students/:id  (editor / new)
export const Route = createFileRoute("/_authenticated/students")({
  component: () => <Outlet />,
});
