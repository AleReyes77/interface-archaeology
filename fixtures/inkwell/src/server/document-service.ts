import { prisma } from "./db";
import type { Document } from "@/types";

export class DocumentService {
  static async list(): Promise<Document[]> {
    return prisma.document.findMany({ where: { archived: false }, orderBy: { updatedAt: "desc" } });
  }

  static async get(id: string) {
    return prisma.document.findUnique({ where: { id } });
  }

  static async create(input: Pick<Document, "title" | "body">) {
    return prisma.document.create({ data: input });
  }

  static async update(id: string, input: Partial<Document>) {
    const existing = await DocumentService.get(id);
    if (!existing) throw new Error("Document not found");
    return prisma.document.update({ where: { id }, data: input });
  }

  static async archive(id: string) {
    return prisma.document.update({ where: { id }, data: { archived: true } });
  }
}
