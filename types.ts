
export enum TransferStatus {
  UPLOADING = 'UPLOADING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  PENDING = 'PENDING'
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
}

export interface RoomState {
  roomId: string;
  participants: string[];
  files: SharedFile[];
}
