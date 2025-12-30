
const CHUNK_SIZE = 16384;

export class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private onMessageCallback: ((data: any) => void) | null = null;
  private onStatusChangeCallback: ((connected: boolean, state?: string) => void) | null = null;
  private signalChannel: BroadcastChannel;
  private roomId: string;
  private isHost: boolean;
  
  // Track active transfers to support pausing and resuming
  private activeTransfers = new Map<string, { 
    file: File, 
    offset: number, 
    onProgress: (progress: number) => void,
    isPaused: boolean 
  }>();

  constructor(roomId: string, isHost: boolean) {
    this.roomId = roomId;
    this.isHost = isHost;
    this.signalChannel = new BroadcastChannel(`orbit_signal_${roomId}`);
    this.signalChannel.onmessage = this.handleSignal.bind(this);
    
    this.initPeerConnection();
    
    if (this.isHost) {
      this.setupDataChannel();
    } else {
      setTimeout(() => {
        this.signalChannel.postMessage({ type: 'PRESENCE_ANNOUNCE' });
      }, 1000);
    }
  }

  private async handleSignal(event: MessageEvent) {
    const { type, data } = event.data;
    if (!this.peerConnection) return;

    switch (type) {
      case 'PRESENCE_ANNOUNCE':
        if (this.isHost) {
          this.createOffer();
        }
        break;
      case 'OFFER':
        if (!this.isHost) await this.handleOffer(data);
        break;
      case 'ANSWER':
        if (this.isHost) await this.handleAnswer(data);
        break;
      case 'ICE_CANDIDATE':
        await this.handleIceCandidate(data);
        break;
    }
  }

  private initPeerConnection() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    });

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalChannel.postMessage({ type: 'ICE_CANDIDATE', data: event.candidate.toJSON() });
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      this.setDataChannel(event.channel);
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      if (state === 'connected') {
        this.onStatusChangeCallback?.(true, state);
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.onStatusChangeCallback?.(false, state);
      }
    };
  }

  private setupDataChannel() {
    if (!this.peerConnection) return;
    const channel = this.peerConnection.createDataChannel('orbitTransfer', { ordered: true });
    this.setDataChannel(channel);
  }

  private setDataChannel(channel: RTCDataChannel) {
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';
    
    this.dataChannel.onmessage = (event) => {
      this.onMessageCallback?.(event.data);
    };

    this.dataChannel.onopen = () => {
      this.onStatusChangeCallback?.(true, 'open');
    };

    this.dataChannel.onclose = () => {
      this.onStatusChangeCallback?.(false, 'closed');
    };
  }

  async createOffer(): Promise<string | null> {
    if (!this.peerConnection || !this.isHost) return null;
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    this.signalChannel.postMessage({ type: 'OFFER', data: offer });
    return JSON.stringify(offer);
  }

  async handleOffer(offer: RTCSessionDescriptionInit): Promise<string | null> {
    if (!this.peerConnection) return null;
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    this.signalChannel.postMessage({ type: 'ANSWER', data: answer });
    return JSON.stringify(answer);
  }

  async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (!this.peerConnection) return;
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.peerConnection) return;
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('ICE Candidate skipped');
    }
  }

  async getManualToken(): Promise<string> {
    if (!this.peerConnection?.localDescription) {
      await this.createOffer();
    }
    return btoa(JSON.stringify(this.peerConnection?.localDescription));
  }

  async processManualToken(token: string) {
    try {
      const data = JSON.parse(atob(token));
      if (data.type === 'offer') {
        await this.handleOffer(data);
      } else if (data.type === 'answer') {
        await this.handleAnswer(data);
      }
    } catch (e) {
      throw new Error("Invalid Handshake Token");
    }
  }

  setOnMessage(callback: (data: any) => void) {
    this.onMessageCallback = callback;
  }

  setOnStatusChange(callback: (connected: boolean, state?: string) => void) {
    this.onStatusChangeCallback = callback;
  }

  // New method to pause a file transfer
  pauseTransfer(fileId: string) {
    const transfer = this.activeTransfers.get(fileId);
    if (transfer) {
      transfer.isPaused = true;
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.dataChannel.send(JSON.stringify({ type: 'TRANSFER_CONTROL', id: fileId, action: 'PAUSE' }));
      }
    }
  }

  // New method to resume a file transfer
  resumeTransfer(fileId: string) {
    const transfer = this.activeTransfers.get(fileId);
    if (transfer && transfer.isPaused) {
      transfer.isPaused = false;
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.dataChannel.send(JSON.stringify({ type: 'TRANSFER_CONTROL', id: fileId, action: 'RESUME' }));
      }
      this.processChunks(fileId);
    }
  }

  private processChunks(fileId: string) {
    const transfer = this.activeTransfers.get(fileId);
    if (!transfer || transfer.isPaused || !this.dataChannel || this.dataChannel.readyState !== 'open') return;

    const { file, onProgress } = transfer;
    const reader = new FileReader();

    const readNext = () => {
      if (transfer.isPaused) return;
      
      const slice = file.slice(transfer.offset, transfer.offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      if (this.dataChannel && buffer) {
        if (this.dataChannel.bufferedAmount > 2 * 1024 * 1024) {
          this.dataChannel.onbufferedamountlow = () => {
            if (this.dataChannel) {
              this.dataChannel.onbufferedamountlow = null;
              this.sendChunk(fileId, buffer, readNext);
            }
          };
        } else {
          this.sendChunk(fileId, buffer, readNext);
        }
      }
    };

    readNext();
  }

  private sendChunk(fileId: string, buffer: ArrayBuffer, next: () => void) {
    const transfer = this.activeTransfers.get(fileId);
    if (!transfer || !this.dataChannel) return;

    this.dataChannel.send(buffer);
    transfer.offset += buffer.byteLength;
    transfer.onProgress(Math.min(100, (transfer.offset / transfer.file.size) * 100));

    if (transfer.offset < transfer.file.size) {
      next();
    } else {
      this.activeTransfers.delete(fileId);
    }
  }

  async sendFile(fileId: string, file: File, onProgress: (progress: number) => void) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Connection disconnected.');
    }

    // Initialize metadata
    this.dataChannel.send(JSON.stringify({
      type: 'METADATA',
      id: fileId,
      name: file.name,
      size: file.size,
      mimeType: file.type
    }));

    this.activeTransfers.set(fileId, { file, offset: 0, onProgress, isPaused: false });
    this.processChunks(fileId);
  }

  destroy() {
    this.signalChannel.close();
    this.dataChannel?.close();
    this.peerConnection?.close();
  }
}
