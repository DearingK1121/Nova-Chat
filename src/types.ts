export type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type Sessions = Record<string, Message[]>;

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
  memory?: string[];
};

export type Users = Record<string, User>;
