import { forward } from "@/lib/proxy";

export async function POST(req: Request) {
  return forward(req, "chat/completions");
}
