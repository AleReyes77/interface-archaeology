import { NextResponse } from "next/server";
import { DocumentService } from "@/server/document-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const doc = await DocumentService.get(id);
  return doc ? NextResponse.json(doc) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  const updated = await DocumentService.update(id, await request.json());
  return NextResponse.json(updated);
}
