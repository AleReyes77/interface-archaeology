import { NextResponse } from "next/server";
import { DocumentService } from "@/server/document-service";

export async function GET() {
  return NextResponse.json(await DocumentService.list());
}

export async function POST(request: Request) {
  const input = await request.json();
  const created = await DocumentService.create(input);
  return NextResponse.json(created, { status: 201 });
}
