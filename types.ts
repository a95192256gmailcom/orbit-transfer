
export enum TransferStatus {
  UPLOADING = 'UPLOADING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  PENDING = 'PENDING',
  CONNECTING = 'CONNECTING'
}

export interface SharedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
  timestamp: number;
  status: TransferStatus;
  progress: number;
  sender: 'Mac' | 'Android';
  aiInsight?: string;
  errorMessage?: string;
  isP2P?: boolean;
}

export interface HistoryItem {
  id: string;
  name: string;
  size: number;
  type: string;
  timestamp: number;
  sender: 'Mac' | 'Android';
  aiInsight?: string;
}

export interface RoomState {
  roomId: string;
  participants: string[];
  files: SharedFile[];
}

export interface FileChunk {
  fileId: string;
  chunkIndex: number;
  totalChunks: number;
  data: ArrayBuffer;
}
