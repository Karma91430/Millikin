import { getSettings, setSettings } from "@/lib/db";

export async function GET() {
  return Response.json(getSettings());
}

export async function POST(req: Request) {
  setSettings(await req.json());
  return Response.json(getSettings());
}
