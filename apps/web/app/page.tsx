import { redirect } from "next/navigation";

export default function Home() {
  // Onboarding wizard auto-detects state and shows a "you're live" card when
  // everything's wired, so it's safe to always land here.
  redirect("/welcome");
}
