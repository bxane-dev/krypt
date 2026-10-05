export type User = {
  id: string;
  username: string;
  displayName: string;
  publicKey: string;
  avatarUrl?: string | null;
  role?: string;
};

export type Conversation = {
  id: string;
  type: 'direct' | 'group';
  name?: string | null;
  createdAt: string;
  lastMessageAt?: string | null;
  members: User[];
};

export type Envelope = {
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
};

export type Reaction = {
  messageId: string;
  userId: string;
  emoji: string;
  username: string;
};

export type EncryptedMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  envelope: Envelope | null;
  type: 'text' | 'image';
  replyToId?: string | null;
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  reactions: Reaction[];
};

export type Payload =
  | { kind: 'text'; text: string }
  | { kind: 'image'; dataUrl: string; caption?: string };

export type DecryptedMessage = EncryptedMessage & { payload?: Payload | null };


export type Device = {
  id: string;
  name: string;
  platform: string;
  publicKey: string;
  keyVersion: number;
  createdAt: string;
  lastSeenAt: string;
  revokedAt?: string | null;
  current: boolean;
};
