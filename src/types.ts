export type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type Sessions = Record<string, Message[]>;
