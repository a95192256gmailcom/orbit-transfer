
import { FileChunk } from '../types';

const CHUNK_SIZE = 16384; // 16KB chunks for optimal RTC throughput

export class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private onMessageCallback: ((data: any) => void) | null = null;
  private signalChannel: BroadcastChannel;
  private roomId: string;

  constructor(roomId: string) {
    this.roomId = roomId;
    // Using BroadcastChannel to simulate signaling between tabs/devices for this demo
    this.signalChannel = new BroadcastChannel(`orbit_signal_${roomId}`);
    this.signalChannel.onmessage = this.handleSignal.bind(this);
  }

  private async handleSignal(event: MessageEvent) {
    const { type, data } = event.data;

    switch (type) {
      case 'OFFER':
        await this.handleOffer(data);
        break;
      case 'ANSWER':
        await this.handleAnswer(data);
        break;
      case 'ICE_CANDIDATE':
        await this.handleIceCandidate(data);
        break;
    }
  }

  private initPeerConnection() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        // Convert to JSON to avoid DataCloneError
        this.signalChannel.postMessage({ type: 'ICE_CANDIDATE', data: event.candidate.toJSON() });
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      this.setDataChannel(event.channel);
    };
  }

  private setDataChannel(channel: RTCDataChannel) {
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';
    
    this.dataChannel.onmessage = (event) => {
      if (this.onMessageCallback) {
        this.onMessageCallback(event.data);
      }
    };

    this.dataChannel.onopen = () => console.log('P2P Channel Open');
    this.dataChannel.onclose = () => console.log('P2P Channel Closed');
  }

  async createOffer() {
    this.initPeerConnection();
    if (!this.peerConnection) return;

    const channel = this.peerConnection.createDataChannel('fileTransfer');
    this.setDataChannel(channel);

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    // RTCSessionDescriptionInit is already serializable; removed .toJSON() which is not defined on the type
    this.signalChannel.postMessage({ type: 'OFFER', data: offer });
  }

  private async handleOffer(offer: RTCSessionDescriptionInit) {
    this.initPeerConnection();
    if (!this.peerConnection) return;

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    // RTCSessionDescriptionInit is already serializable; removed .toJSON() which is not defined on the type
    this.signalChannel.postMessage({ type: 'ANSWER', data: answer });
  }

  private async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (!this.peerConnection) return;
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.peerConnection) return;
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error('Error adding ICE candidate', e);
    }
  }

  setOnMessage(callback: (data: any) => void) {
    this.onMessageCallback = callback;
  }

  async sendFile(file: File, onProgress: (progress: number) => void) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('P2P Connection not ready');
    }

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const reader = new FileReader();
    let offset = 0;

    // Send metadata first
    this.dataChannel.send(JSON.stringify({
      type: 'METADATA',
      name: file.name,
      size: file.size,
      mimeType: file.type
    }));

    const readNext = () => {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      if (this.dataChannel && buffer) {
        // High-performance check for buffer congestion
        if (this.dataChannel.bufferedAmount > this.dataChannel.bufferedAmountLowThreshold) {
          this.dataChannel.onbufferedamountlow = () => {
            if (this.dataChannel) {
                this.dataChannel.onbufferedamountlow = null;
                this.dataChannel.send(buffer);
                offset += buffer.byteLength;
                onProgress(Math.min(100, (offset / file.size) * 100));
                if (offset < file.size) readNext();
            }
          };
        } else {
          this.dataChannel.send(buffer);
          offset += buffer.byteLength;
          onProgress(Math.min(100, (offset / file.size) * 100));
          if (offset < file.size) readNext();
        }
      }
    };

    readNext();
  }

  destroy() {
    this.signalChannel.close();
    this.dataChannel?.close();
    this.peerConnection?.close();
  }
}
