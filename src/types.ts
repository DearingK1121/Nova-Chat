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

export type SessionPref = {
  model?: string;
  requests?: number[]; // timestamps (ms) of requests for rate limiting
};

export type SessionPrefs = Record<string, SessionPref>;
