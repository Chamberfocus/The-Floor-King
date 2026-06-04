import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";

// The root route just sends people to the right place based on auth state.
export default async function Home() {
  const user = await getUser();
  redirect(user ? "/dashboard" : "/login");
}
