import { H264MSEPlayer } from "./h264MsePlayer";
import { H264WebCodecsPlayer } from "./h264WebCodecsPlayer";

type PlayerLike =
  | "mjpeg-native"
  | H264WebCodecsPlayer
  | H264MSEPlayer
  | null;

export class StreamPlayerManager {
  private container: HTMLElement;
  currentMode: string | null = null;
  currentPlayer: PlayerLike = null;

  mjpegImage: HTMLImageElement | null = null;
  h264Video: HTMLVideoElement | null = null;
  h264Canvas: HTMLCanvasElement | null = null;

  capabilities: {
    mjpeg: boolean;
    mse: boolean;
    webcodecs: boolean;
    h264Codec: string | null;
  };

  private _mjpegFrameCount?: number;

  constructor(containerElement: HTMLElement) {
    this.container = containerElement;
    this.capabilities = this.detectCapabilities();
    console.log("🎬 [PlayerManager] 浏览器能力:", this.capabilities);
  }

  private detectCapabilities() {
    const caps = {
      mjpeg: true,
      mse: false,
      webcodecs: false,
      h264Codec: null as string | null,
    };

    if (typeof MediaSource !== "undefined") {
      caps.mse = true;
      const codecs = [
        'video/mp4; codecs="avc1.640028"',
        'video/mp4; codecs="avc1.64001f"',
        'video/mp4; codecs="avc1.42001e"',
      ];
      for (const codec of codecs) {
        if (MediaSource.isTypeSupported(codec)) {
          caps.h264Codec = codec;
          break;
        }
      }
    }

    if (typeof (window as any).VideoDecoder !== "undefined" && typeof (window as any).EncodedVideoChunk !== "undefined") {
      caps.webcodecs = true;
    }

    return caps;
  }

  async switchMode(mode: "mjpeg" | "h264", options: { forceMSE?: boolean } = {}) {
    console.log(`🔄 [PlayerManager] 切换模式: ${this.currentMode} → ${mode}`);
    await this.destroyCurrentPlayer();

    if (mode === "h264") {
      await this.initH264Player(options);
    } else {
      this.initMJPEGPlayer();
    }

    this.currentMode = mode;
    console.log(`✅ [PlayerManager] 模式切换完成: ${mode}`);

    return {
      mode,
      playerType: this.getPlayerType(),
      capabilities: this.capabilities,
    };
  }

  private initMJPEGPlayer() {
    console.log("🎬 [PlayerManager] 初始化MJPEG播放器");

    if (this.h264Video) this.h264Video.style.display = "none";
    if (this.h264Canvas) this.h264Canvas.style.display = "none";

    if (!this.mjpegImage) {
      this.mjpegImage = document.getElementById("remoteImage") as HTMLImageElement | null;
      if (!this.mjpegImage) {
        this.mjpegImage = document.createElement("img");
        this.mjpegImage.id = "remoteImage";
        this.mjpegImage.style.width = "100%";
        this.mjpegImage.style.height = "100%";
        this.mjpegImage.style.objectFit = "contain";
        this.container.appendChild(this.mjpegImage);
        console.log("✅ [PlayerManager] 创建了新的remoteImage元素");
      } else {
        console.log("✅ [PlayerManager] 找到现有的remoteImage元素");
      }
    }

    this.mjpegImage.style.display = "block";
    this.currentPlayer = "mjpeg-native";
    console.log("✅ [PlayerManager] MJPEG播放器就绪，元素:", this.mjpegImage);
  }

  private async initH264Player(options: { forceMSE?: boolean } = {}) {
    console.log("🎬 [PlayerManager] 初始化H.264播放器");
    if (this.mjpegImage) this.mjpegImage.style.display = "none";

    if (this.capabilities.webcodecs && !options.forceMSE) {
      await this.initWebCodecsPlayer();
      return;
    }

    if (this.capabilities.mse && this.capabilities.h264Codec) {
      await this.initMSEPlayer();
      return;
    }

    throw new Error("浏览器不支持H.264播放");
  }

  private async initWebCodecsPlayer() {
    console.log("🎬 [PlayerManager] 使用WebCodecs播放器");
    if (!this.container) throw new Error("Container元素不存在，无法创建H.264播放器");

    if (!this.h264Canvas) {
      this.h264Canvas = document.createElement("canvas");
      this.h264Canvas.id = "h264Canvas";
      this.h264Canvas.width = 1920;
      this.h264Canvas.height = 1080;
      this.h264Canvas.style.width = "100%";
      this.h264Canvas.style.height = "100%";
      this.h264Canvas.style.objectFit = "contain";
      this.h264Canvas.style.backgroundColor = "#000";
      this.container.appendChild(this.h264Canvas);
      console.log("✅ [PlayerManager] 创建了新的h264Canvas元素");
    }

    this.h264Canvas.style.display = "block";
    this.currentPlayer = new H264WebCodecsPlayer(this.h264Canvas);
    await this.currentPlayer.init();
    console.log("✅ [PlayerManager] WebCodecs播放器就绪");
  }

  private async initMSEPlayer() {
    console.log("🎬 [PlayerManager] 使用MSE播放器");
    if (!this.h264Video) {
      this.h264Video = document.createElement("video");
      this.h264Video.id = "h264Video";
      this.h264Video.className = "remote-stream";
      this.h264Video.autoplay = true;
      this.h264Video.muted = true;
      this.h264Video.playsInline = true;
      this.container.appendChild(this.h264Video);
    }

    this.h264Video.style.display = "block";
    this.currentPlayer = new H264MSEPlayer(this.h264Video);
    await this.currentPlayer.init();
    console.log("✅ [PlayerManager] MSE播放器就绪");
  }

  async destroyCurrentPlayer() {
    if (!this.currentPlayer || this.currentPlayer === "mjpeg-native") return;
    console.log("🛑 [PlayerManager] 销毁当前播放器");
    try {
      if ((this.currentPlayer as any).destroy) {
        await (this.currentPlayer as any).destroy();
      }
    } catch (e) {
      console.error("❌ [PlayerManager] 销毁播放器失败:", e);
    }
    this.currentPlayer = null;
  }

  receiveInitData(initData: Uint8Array) {
    if (!this.currentPlayer || this.currentPlayer === "mjpeg-native") return;
    const player = this.currentPlayer as any;
    if (player.receiveInitData) player.receiveInitData(initData);
  }

  receiveFrame(frameData: Uint8Array, pts: number, isKeyframe: boolean) {
    if (!this.currentPlayer || this.currentPlayer === "mjpeg-native") return;
    const player = this.currentPlayer as any;
    if (player.receiveFrame) player.receiveFrame(frameData, pts, isKeyframe);
  }

  receiveMJPEGFrame(blob: Blob) {
    if (!this.mjpegImage) {
      console.warn("[PlayerManager] MJPEG播放器未初始化，尝试初始化...");
      this.initMJPEGPlayer();
    }
    if (!this.mjpegImage) {
      console.error("[PlayerManager] MJPEG播放器初始化失败");
      return;
    }

    if (this.mjpegImage.style.display !== "block") {
      this.mjpegImage.style.display = "block";
      console.log("[PlayerManager] 显示MJPEG播放元素");
    }

    const url = URL.createObjectURL(blob);
    if (this.mjpegImage.src && this.mjpegImage.src.startsWith("blob:")) {
      URL.revokeObjectURL(this.mjpegImage.src);
    }
    this.mjpegImage.src = url;

    if (!this._mjpegFrameCount) this._mjpegFrameCount = 0;
    this._mjpegFrameCount++;
    if (this._mjpegFrameCount % 100 === 1) {
      const rect = this.mjpegImage.getBoundingClientRect();
      console.log(`[PlayerManager] MJPEG帧更新: ${this._mjpegFrameCount}`, {
        visible: this.mjpegImage.offsetParent !== null,
        display: this.mjpegImage.style.display,
        position: `${rect.x},${rect.y} ${rect.width}x${rect.height}`,
        hasSrc: !!this.mjpegImage.src,
      });
    }
  }

  getPlayerElement(): HTMLElement | null {
    if (this.currentMode === "mjpeg") return this.mjpegImage;
    if (this.h264Canvas) return this.h264Canvas;
    if (this.h264Video) return this.h264Video;
    return null;
  }

  getPlayerType() {
    if (this.currentMode === "mjpeg") return "MJPEG (兼容模式)";
    if (this.currentPlayer instanceof H264WebCodecsPlayer) return "H.264 WebCodecs (硬件加速)";
    if (this.currentPlayer instanceof H264MSEPlayer) return "H.264 MSE (标准模式)";
    return "未知";
  }

  getStats() {
    if (!this.currentPlayer || this.currentPlayer === "mjpeg-native") {
      return { mode: "mjpeg", stats: "Native img element" };
    }
    return {
      mode: this.currentMode,
      playerType: this.getPlayerType(),
      stats: (this.currentPlayer as any).getStats ? (this.currentPlayer as any).getStats() : null,
    };
  }

  getRecommendedMode() {
    if (this.capabilities.webcodecs) {
      return { mode: "h264", reason: "WebCodecs支持，最佳性能", playerType: "webcodecs" };
    }
    if (this.capabilities.mse && this.capabilities.h264Codec) {
      return { mode: "h264", reason: "MSE支持，良好性能", playerType: "mse" };
    }
    return { mode: "mjpeg", reason: "兼容模式", playerType: "native" };
  }
}

