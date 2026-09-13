import { createFileRoute } from "@tanstack/react-router";
import { Home } from "@/components/auth/home";

export const Route = createFileRoute("/")({
  component: Home,
});
