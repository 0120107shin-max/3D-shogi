// p2p-manager.js - WebRTC P2P Multiplayer Manager using PeerJS

export class P2PManager {
  constructor(onConnect, onReceiveData, onError) {
    this.peer = null;
    this.conn = null;
    this.peerId = null;
    this.onConnect = onConnect;
    this.onReceiveData = onReceiveData;
    this.onError = onError;
    this.isHost = false;
  }

  // PeerJS初期化
  init() {
    return new Promise((resolve, reject) => {
      // PeerJS インスタンス作成 (PeerJS Cloud Server 利用)
      this.peer = new Peer();

      this.peer.on('open', (id) => {
        this.peerId = id;
        console.log('P2P Peer initialized. ID:', id);
        resolve(id);
      });

      // 他の相手からの接続をリスン (ホストモード)
      this.peer.on('connection', (connection) => {
        this.conn = connection;
        this.isHost = true;
        this.setupConnectionHandlers();
        if (this.onConnect) this.onConnect(true);
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        if (this.onError) this.onError(err);
        reject(err);
      });
    });
  }

  // ゲストとしてホストの Peer ID へ接続
  connectToHost(targetPeerId) {
    if (!this.peer) return;
    this.isHost = false;
    this.conn = this.peer.connect(targetPeerId);
    this.setupConnectionHandlers();
  }

  setupConnectionHandlers() {
    if (!this.conn) return;

    this.conn.on('open', () => {
      console.log('P2P connection established with peer!');
      if (this.onConnect) this.onConnect(false);
    });

    this.conn.on('data', (data) => {
      console.log('P2P Data received:', data);
      if (this.onReceiveData) this.onReceiveData(data);
    });

    this.conn.on('close', () => {
      console.log('P2P Connection closed');
      if (this.onError) this.onError('接続が切断されました');
    });
  }

  // 着手・指し手データの送信
  sendMove(moveData) {
    if (this.conn && this.conn.open) {
      this.conn.send({
        type: 'MOVE',
        move: moveData
      });
    }
  }

  // ゲーム設定の同期送信
  sendGameSettings(settings) {
    if (this.conn && this.conn.open) {
      this.conn.send({
        type: 'SETTINGS',
        settings
      });
    }
  }

  // 投了・降参データの送信
  sendResign() {
    if (this.conn && this.conn.open) {
      this.conn.send({ type: 'RESIGN' });
    }
  }

  // 接続試行のキャンセル・後始末（設定画面へ「戻る」際に呼び出す）
  destroy() {
    try { if (this.conn) this.conn.close(); } catch (e) { /* noop */ }
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* noop */ }
    this.conn = null;
    this.peer = null;
  }
}
