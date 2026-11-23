export interface Document {
  id: string;
  title: string;
  body: string;
  archived: boolean;
  updatedAt: string;
}

export interface Comment {
  id: string;
  documentId: string;
  author: string;
  text: string;
}

export interface Session {
  userId: string;
  name: string;
}
