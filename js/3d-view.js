// 3d-view.js - Three.js 3D Shogi Board, Piece, and Camera Renderer

import { PIECE_TYPES, SENTE, GOTE, PIECE_NAMES } from './shogi-engine.js';
import { sounds } from './sound.js';

export class Shogi3DView {
  constructor(containerId, onSquareClick, onHandPieceClick) {
    this.container = document.getElementById(containerId);
    this.onSquareClick = onSquareClick;
    this.onHandPieceClick = onHandPieceClick;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.boardMesh = null;
    this.pieceMeshes = new Map(); // key: "y_x" -> Mesh
    this.handPieceMeshes = new Map(); // key: "owner_type" -> Group/Mesh

    this.highlightMarkers = [];
    this.selectedSquare = null;
    this.selectedHandPiece = null;

    this.boardSize = 9;
    this.squareSize = 1.0;
    this.boardThickness = 0.6;
    this.perspective = SENTE;

    this.texturesCache = new Map();

    this.lastEngine = null;

    this.initScene();
    this.animate();
    window.addEventListener('resize', () => this.onWindowResize());
    this.container.addEventListener('pointerdown', (e) => this.onPointerDown(e));

    // Webフォント(Shippori Mincho等)の読み込み完了前に駒文字テクスチャが
    // 生成されてしまうと、フォールバックフォントのまま固定キャッシュされて
    // 文字が不明瞭になる。読み込み完了後にテクスチャを作り直す。
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        this.texturesCache.clear();
        if (this.lastEngine) this.updateBoardState(this.lastEngine);
      });
    }
  }

  initScene() {
    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a0c);
    this.scene.fog = new THREE.FogExp2(0x0a0a0c, 0.025);

    // 2. Camera
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    this.setCameraPerspective(SENTE);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // 4. OrbitControls
    // ドラッグでの自由回転を無効化（盤が勝手に回転する問題の解消）。
    // 視点変更はダブルクリックによるプリセット切替のみ、ズームだけ許可する。
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.enableRotate = false; // ← 単クリックのドラッグで回転させない
    this.controls.enablePan = false;
    this.controls.enableZoom = true;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 22;

    // 視点は常に真上固定（3Dモデル・質感は維持しつつ、斜め視点による
    // 自陣位置の誤認を避けるため）。手番側に応じて画面の上下手前が
    // 入れ替わる2状態のみを持つ。詳細は setCameraPerspective 参照。
    this.viewIndex = 0;

    // 5. Lighting (Optimized for zero glare and high contrast at all camera angles)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff5e6, 0.4);
    dirLight.position.set(8, 18, 12);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.0001;
    this.scene.add(dirLight);

    const softFillLight = new THREE.PointLight(0xd4af37, 0.3, 20);
    softFillLight.position.set(-8, 8, -8);
    this.scene.add(softFillLight);


    // 6. Environment Floor & Shogi Board
    this.createEnvironment();
    this.createBoard();
    this.createKomadai();
  }

  // 床・和モダンな暗闇空間
  createEnvironment() {
    const floorGeo = new THREE.PlaneGeometry(50, 50);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x121218,
      roughness: 0.8,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  // 3D将棋盤の作成
  createBoard() {
    const boardWidth = 9.4 * this.squareSize;
    const boardDepth = 9.8 * this.squareSize;
    const geo = new THREE.BoxGeometry(boardWidth, this.boardThickness, boardDepth);

    // 将棋盤の木目テクスチャ生成
    const woodTexture = this.generateWoodTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: woodTexture,
      roughness: 0.4,
      metalness: 0.1
    });

    this.boardMesh = new THREE.Mesh(geo, mat);
    this.boardMesh.position.y = -this.boardThickness / 2;
    this.boardMesh.receiveShadow = true;
    this.boardMesh.castShadow = true;
    this.scene.add(this.boardMesh);

    // 盤面の9x9グリッド線
    const gridHelper = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: 0x2c1d11, linewidth: 2 });

    const halfW = (9 * this.squareSize) / 2;
    const halfD = (9 * this.squareSize) / 2;

    for (let i = 0; i <= 9; i++) {
      const pos = -halfW + i * this.squareSize;

      // 縦線
      const vGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(pos, 0.005, -halfD),
        new THREE.Vector3(pos, 0.005, halfD)
      ]);
      gridHelper.add(new THREE.Line(vGeo, lineMat));

      // 横線
      const hGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-halfW, 0.005, pos),
        new THREE.Vector3(halfW, 0.005, pos)
      ]);
      gridHelper.add(new THREE.Line(hGeo, lineMat));
    }

    // 星（星の点4つ）
    const starPoints = [[2.5, 2.5], [2.5, -2.5], [-2.5, 2.5], [-2.5, -2.5]];
    starPoints.forEach(([sx, sz]) => {
      const starGeo = new THREE.CircleGeometry(0.06, 16);
      const starMat = new THREE.MeshBasicMaterial({ color: 0x2c1d11 });
      const star = new THREE.Mesh(starGeo, starMat);
      star.rotation.x = -Math.PI / 2;
      star.position.set(sx * this.squareSize, 0.006, sz * this.squareSize);
      gridHelper.add(star);
    });

    this.scene.add(gridHelper);
  }

  // 立体駒台 (Komadai)
  createKomadai() {
    const kGeo = new THREE.BoxGeometry(2.4, 0.4, 2.4);
    const woodTex = this.generateWoodTexture();
    const kMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.5 });

    // 先手駒台 (右下)
    const senteKomadai = new THREE.Mesh(kGeo, kMat);
    senteKomadai.position.set(6.2, -0.2, 3.8);
    senteKomadai.receiveShadow = true;
    senteKomadai.castShadow = true;
    this.scene.add(senteKomadai);

    // 後手駒台 (左上)
    const goteKomadai = new THREE.Mesh(kGeo, kMat);
    goteKomadai.position.set(-6.2, -0.2, -3.8);
    goteKomadai.receiveShadow = true;
    goteKomadai.castShadow = true;
    this.scene.add(goteKomadai);
  }

  // テクスチャ生成 (Canvasによる和木目)
  generateWoodTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // ほんがや（木目）グラデーション
    const grad = ctx.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, '#dcb36c');
    grad.addColorStop(0.5, '#c89e54');
    grad.addColorStop(1, '#b58b42');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // 木目ライン
    ctx.strokeStyle = 'rgba(120, 80, 30, 0.12)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 50; i++) {
      ctx.beginPath();
      const y = Math.random() * 512;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(170, y + 20, 340, y - 20, 512, y);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  // 3D駒ポリゴンの作成 (マット質感の親ポリゴン + Z-fighting防止の文字ラベル)
  createPieceMesh(pieceType, owner) {
    const group = new THREE.Group();

    // 1. 駒の土台3D形状 (五角形 ExtrudeGeometry - マットつや消し仕上げ)
    const shape = new THREE.Shape();
    const w = 0.38;
    const h = 0.46;
    const topW = 0.26;

    shape.moveTo(-w, -h);
    shape.lineTo(w, -h);
    shape.lineTo(topW, h);
    shape.lineTo(0, h + 0.08);
    shape.lineTo(-topW, h);
    shape.closePath();

    const extrudeSettings = {
      steps: 1,
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 3
    };

    const baseGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    baseGeo.center();

    // 反射しないマットな本榧仕上げ (roughness: 0.9, metalness: 0.0)
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0xdfc6a6,
      roughness: 0.9,
      metalness: 0.0
    });

    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    // 2. 表面文字ラベル
    //    depthTest=false + renderOrder=999 により、真上・斜め・真横のいずれの
    //    カメラ角度でも文字が土台や他の駒に隠れず必ず最前面に描画される。
    //    DoubleSide にすることで、180度回転させた後手の駒でも文字が消えない。
    const labelGeo = new THREE.PlaneGeometry(0.8, 1.0);
    const textTexture = this.getPieceTextTexture(pieceType, owner);

    const labelMat = new THREE.MeshBasicMaterial({
      map: textTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const labelMesh = new THREE.Mesh(labelGeo, labelMat);
    labelMesh.position.z = 0.1;
    labelMesh.renderOrder = 999; // 常に最前面へ優先描画
    group.add(labelMesh);

    // X軸に-90度回転させて盤上に設置
    group.rotation.x = -Math.PI / 2;

    // 後手の場合は駒を180度回転
    if (owner === GOTE) {
      group.rotation.z = Math.PI;
    }

    group.userData = { pieceType, owner };
    return group;
  }


  // 駒の文字テクスチャ生成 (標準和風フォント併用で確実に文字を描画)
  getPieceTextTexture(pieceType, owner) {
    const key = `${pieceType}_${owner}`;
    if (this.texturesCache.has(key)) {
      return this.texturesCache.get(key);
    }

    // 高解像度キャンバス（近距離・真上視点でのボケを抑える）
    const SIZE = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');

    // 1. 完全透明背景
    ctx.clearRect(0, 0, SIZE, SIZE);

    // 2. 表示文字
    const name = PIECE_NAMES[pieceType] || '歩';
    const isPromoted = ['TO', 'NY', 'NK', 'NG', 'UM', 'RY'].includes(pieceType);

    let displayName = name;
    if (pieceType === PIECE_TYPES.OU) {
      displayName = (owner === SENTE) ? '王' : '玉';
    }

    // 3. 視認性を最優先したフォント。行書体などの崩し書体は複雑な字形が
    //    潰れて読みにくく、かつローカル未導入環境ではフォールバックで
    //    表示が揺れるため使用しない。Google Fontsで確実に読み込まれる
    //    Shippori Mincho(極太)を主体とし、明朝系フォールバックのみに限定する。
    ctx.font = '800 ' + (SIZE * 0.58) + 'px "Shippori Mincho", "Noto Serif JP", "Yu Mincho", "MS Mincho", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const cx = SIZE / 2;
    const cy = SIZE * 0.49;

    // 輪郭を先に太く描き、文字の芯を強調（視認性向上）
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = SIZE * 0.045;
    ctx.strokeStyle = isPromoted ? 'rgba(255, 235, 235, 0.95)' : 'rgba(255, 248, 225, 0.95)';
    ctx.strokeText(displayName, cx, cy);

    // 影（立体感）
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = SIZE * 0.008;
    ctx.shadowOffsetY = SIZE * 0.008;

    // 漆黒 / 朱赤で塗り
    ctx.fillStyle = isPromoted ? '#c80000' : '#0a0a0c';
    ctx.fillText(displayName, cx, cy);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    // 斜め・真上視点での文字ボケを抑える異方性フィルタリング
    if (this.renderer) {
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    }
    this.texturesCache.set(key, texture);
    return texture;
  }




  // 盤面グリッド座標 (x: 0..8, y: 0..8) -> 3D World Position
  // 棋譜表記 file = 9 - x に合わせ、先手視点で1筋(x=8)が画面右、9筋(x=0)が画面左に来るよう
  // worldX = (x - 4) とする（従来は 4 - x で左右反転しており、飛と角が逆に見えていた）。
  gridToWorld(y, x, height = 0.08) {
    const worldX = (x - 4) * this.squareSize;
    const worldZ = (y - 4) * this.squareSize;
    return new THREE.Vector3(worldX, height, worldZ);
  }

  // 3Dワールド座標 -> 盤面グリッド (y, x)
  worldToGrid(pos) {
    const x = Math.round(pos.x / this.squareSize + 4);
    const y = Math.round(pos.z / this.squareSize + 4);
    if (x >= 0 && x < 9 && y >= 0 && y < 9) {
      return { y, x };
    }
    return null;
  }

  // 全3D駒の同期更新
  updateBoardState(boardEngine) {
    this.lastEngine = boardEngine;
    // 既存の駒メッシュをクリア
    this.pieceMeshes.forEach(mesh => this.scene.remove(mesh));
    this.pieceMeshes.clear();

    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const piece = boardEngine.board[y][x];
        if (piece) {
          const mesh = this.createPieceMesh(piece.type, piece.owner);
          const pos = this.gridToWorld(y, x);
          mesh.position.copy(pos);
          mesh.userData.gridPos = { y, x };

          this.scene.add(mesh);
          this.pieceMeshes.set(`${y}_${x}`, mesh);
        }
      }
    }

    // 持ち駒 (Komadai) の描画更新
    this.updateHandPieces(boardEngine.hands);
  }

  // 持ち駒の3D表示
  updateHandPieces(hands) {
    // 既存の持ち駒メッシュ削除
    this.handPieceMeshes.forEach(mesh => this.scene.remove(mesh));
    this.handPieceMeshes.clear();

    const renderHand = (owner, baseX, baseZ) => {
      let offsetIndex = 0;
      const pieceOrder = ['FU', 'KY', 'KE', 'GI', 'KI', 'KA', 'HI'];

      pieceOrder.forEach(type => {
        const count = hands[owner][type];
        if (count > 0) {
          const mesh = this.createPieceMesh(type, owner);
          const offsetX = (offsetIndex % 3) * 0.7 - 0.7;
          const offsetZ = Math.floor(offsetIndex / 3) * 0.7 - 0.7;

          mesh.position.set(baseX + offsetX, 0.08, baseZ + offsetZ);
          mesh.userData.isHand = true;
          mesh.userData.pieceType = type;
          mesh.userData.owner = owner;

          this.scene.add(mesh);
          this.handPieceMeshes.set(`${owner}_${type}`, mesh);
          offsetIndex++;
        }
      });
    };

    renderHand(SENTE, 6.2, 3.8);  // 先手駒台
    renderHand(GOTE, -6.2, -3.8); // 後手駒台
  }

  // 移動可能なマスの3Dマーカー（光るリング）を表示
  showLegalMoveHighlights(moves) {
    this.clearHighlights();

    moves.forEach(m => {
      const geo = new THREE.RingGeometry(0.2, 0.38, 32);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd700,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      const pos = this.gridToWorld(m.y, m.x, 0.02);
      ring.position.copy(pos);

      this.scene.add(ring);
      this.highlightMarkers.push(ring);
    });
  }

  clearHighlights() {
    this.highlightMarkers.forEach(m => this.scene.remove(m));
    this.highlightMarkers = [];
  }

  // 視点切り替え (Sente / Gote / 視点反転)
  // 斜め視点だと「自陣が画面のどちら側に来るか」を毎回目視確認しないと
  // 誤認しやすいため、視点は質感を保ったまま常に真上固定とし、
  // 手番側に応じて画面上で自陣が必ず手前（下側）に来るよう回転させる。
  // カメラは (0, 高さ, ±ε) の真上に置き、その ε の符号だけを反転させる。
  // 真上からの俯瞰では ε の符号が画面のロール（上下・左右の向き）を
  // 一意に決めるため、camera.up を直接書き換えるより
  // OrbitControls の内部状態と安全に整合する。
  setCameraPerspective(owner) {
    this.perspective = owner;
    const eps = (owner === SENTE) ? 0.001 : -0.001;
    this.camera.position.set(0, 15.5, eps);
    this.viewIndex = (owner === SENTE) ? 0 : 1;
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  togglePerspective() {
    this.setCameraPerspective(-this.perspective);
  }

  // ポインタ入力の振り分け：
  //   単クリック  → 駒の選択・移動（コマ操作はワンクリック）
  //   ダブルクリック → 視点プリセットを切り替え（カメラはダブルクリックで動く）
  // ダブルクリックの1クリック目を250ms保留し、続けて2クリック目が来たら
  // 駒操作をキャンセルしてカメラ切替に回すことで、両者を明確に分離する。
  onPointerDown(event) {
    if (document.querySelector('.modal.active')) return;

    if (this._clickTimer) {
      clearTimeout(this._clickTimer);
      this._clickTimer = null;
      this.cycleCameraView();
      return;
    }

    const captured = { clientX: event.clientX, clientY: event.clientY };
    this._clickTimer = setTimeout(() => {
      this._clickTimer = null;
      this.handleSingleClick(captured);
    }, 250);
  }

  handleSingleClick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);

    if (intersects.length > 0) {
      for (const hit of intersects) {
        // レイがヒットするのは駒グループの子メッシュ（土台・文字）なので、
        // userData を持つ親（駒グループ）まで遡って判定する。
        // これをしないと持ち駒 (isHand) が拾えず、駒台の駒を打てない。
        let node = hit.object;
        while (node) {
          if (node.userData && node.userData.isHand) {
            sounds.playPiecePlace();
            this.onHandPieceClick(node.userData.pieceType, node.userData.owner);
            return;
          }
          if (node.userData && node.userData.gridPos) {
            const g = node.userData.gridPos;
            this.onSquareClick(g.y, g.x);
            return;
          }
          node = node.parent;
        }

        // 盤面（空きマス）をクリックした場合は交点座標からマスを求める
        if (hit.object === this.boardMesh) {
          const grid = this.worldToGrid(hit.point);
          if (grid) {
            this.onSquareClick(grid.y, grid.x);
            return;
          }
        }
      }
    }
  }

  // ダブルクリックでの視点切替。視点は真上固定のため、先後反転と同じ挙動にする。
  cycleCameraView() {
    this.togglePerspective();
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    if (this.controls) this.controls.update();

    // ハイライトリングの回転アニメーション
    this.highlightMarkers.forEach(ring => {
      ring.rotation.z += 0.02;
    });

    this.renderer.render(this.scene, this.camera);
  }
}
