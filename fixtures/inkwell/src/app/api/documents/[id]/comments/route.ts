import { NextResponse } from "next/server";
import { listComments, insertComment } from "@/server/comment-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  return NextResponse.json(await listComments(id));
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const { text } = await request.json();
  await insertComment(id, "anonymous", text);
  return new NextResponse(null, { status: 204 });
}
